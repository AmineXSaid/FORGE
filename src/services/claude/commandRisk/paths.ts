/**
 * Which paths must never be destroyed, and which are merely worth a prompt.
 *
 * The lists here came out of a real incident: a user lost their home directory.
 * The distinctions they encode are therefore not theoretical.
 *
 * Two of them matter more than the rest:
 *
 *   - **Exact versus recursive.** `~/.config` is protected as a directory, but
 *     `~/.config/app/stale.toml` is not: deleting individual config files is
 *     something people legitimately do all day, and protecting every file under
 *     a protected root would make the classifier so noisy it would be ignored.
 *     `/etc` is the opposite -- its contents are as unrecoverable as the
 *     directory itself.
 *   - **`/home` and `/Users` are not recursive.** A user's own project lives
 *     under them, so protecting them recursively would flag ordinary work. The
 *     home directory itself is protected separately.
 */
import * as path from 'node:path';

export interface RiskContext {
  /** Where the command will run. Targets under it are bounded. */
  workingDirectory?: string;
  homeDirectory?: string;
  /** True when the working directory is inside a git repo, so edits are recoverable. */
  gitTracked?: boolean;
}

/** Credential stores. Protected recursively: everything inside is a secret. */
const PROTECTED_CREDENTIAL_SUBPATHS = ['.ssh', '.gnupg', '.aws', '.kube', '.docker'];

/**
 * Directories whose wholesale destruction is unacceptable, but whose individual
 * files are legitimately edited and removed all the time. Matched exactly.
 */
const PROTECTED_HOME_SUBPATHS = [
  '.config',
  '.forge',
  '.claude',
  '.local',
  '.local/share',
  'Documents',
  'Desktop',
];

/** Absolute system paths that must never be recursively destroyed. */
const PROTECTED_SYSTEM_PATHS = [
  '/', '/bin', '/boot', '/dev', '/etc', '/lib', '/lib64', '/opt', '/proc',
  '/root', '/sbin', '/srv', '/sys', '/usr', '/var',
  '/Applications', '/System', '/Library', '/Users', '/home',
];

/**
 * System paths where the contents are as critical as the directory itself, so
 * deleting a single file inside them is also unacceptable.
 */
const SYSTEM_PATHS_PROTECTED_RECURSIVELY = [
  '/bin', '/boot', '/dev', '/etc', '/lib', '/lib64', '/proc', '/sbin', '/sys',
  '/usr', '/var/lib', '/System', '/Library',
];

/**
 * The three standard device sinks.
 *
 * Exempted *before* the recursive `/dev` rule, which would otherwise swallow
 * them and flag every ordinary `cmd > /dev/null`.
 */
const SAFE_DEVICE_SINKS = ['/dev/null', '/dev/stdout', '/dev/stderr'];

/** Normalise for comparison: forward slashes, no trailing slash, no case games. */
function normalize(p: string): string {
  const unified = p.replace(/\\/g, '/');
  const collapsed = unified.replace(/\/+/g, '/');
  const trimmed = collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed;
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

function isUnder(child: string, parent: string): boolean {
  const c = normalize(child);
  const p = normalize(parent);
  return c === p || c.startsWith(p === '/' ? '/' : `${p}/`);
}

/**
 * Resolve a raw argument into a path for comparison.
 *
 * `~` is expanded because it is unambiguous. `$VAR` is deliberately **not**
 * expanded: the value is unknown here, and guessing would be worse than
 * admitting it. An unexpanded variable is reported as unknown so the caller
 * escalates rather than assuming the best case.
 */
export function expand(raw: string, ctx: RiskContext): { path: string; unknown: boolean } {
  let value = raw;
  let unknown = false;

  if (value === '~' && ctx.homeDirectory) {
    value = ctx.homeDirectory;
  } else if (value.startsWith('~/') && ctx.homeDirectory) {
    value = path.posix.join(normalize(ctx.homeDirectory), value.slice(2));
  }

  if (/\$\{?\w+/.test(value)) {
    // `$HOME` and `${HOME}` are the ones that actually matter, and treating
    // them as the home directory is more accurate than treating them as opaque.
    if (/^\$\{?HOME\}?(\/|$)/.test(value) && ctx.homeDirectory) {
      value = value.replace(/^\$\{?HOME\}?/, normalize(ctx.homeDirectory));
    } else {
      unknown = true;
    }
  }

  if (!path.posix.isAbsolute(normalize(value)) && !/^[a-zA-Z]:/.test(value) && ctx.workingDirectory) {
    value = path.posix.join(normalize(ctx.workingDirectory), normalize(value));
  }

  return { path: normalize(value), unknown };
}

/**
 * Would destroying this path be unacceptable no matter the justification?
 */
export function isCatastrophicTarget(target: string, ctx: RiskContext): boolean {
  const p = normalize(target);

  // Before the recursive /dev rule below, which would otherwise swallow them.
  if (SAFE_DEVICE_SINKS.some((sink) => normalize(sink) === p)) return false;

  if (PROTECTED_SYSTEM_PATHS.some((sys) => normalize(sys) === p)) return true;
  if (SYSTEM_PATHS_PROTECTED_RECURSIVELY.some((sys) => isUnder(p, sys))) return true;

  const home = ctx.homeDirectory ? normalize(ctx.homeDirectory) : undefined;
  if (!home) return false;

  // The home directory itself.
  if (p === home) return true;

  // Credential stores, including anything inside them.
  if (PROTECTED_CREDENTIAL_SUBPATHS.some((sub) => isUnder(p, `${home}/${sub}`))) return true;

  // Config and document roots, but not their individual files.
  return PROTECTED_HOME_SUBPATHS.some((sub) => normalize(`${home}/${sub}`) === p);
}

export type TargetClass = 'harmless' | 'bounded' | 'outside' | 'catastrophic' | 'unknown';

/**
 * How much scrutiny destroying this path earns.
 *
 *   bounded       inside the working directory, or a temp dir -- recoverable
 *                 or disposable, so it runs with a record kept
 *   outside       irreversible and reaches outside the working directory
 *   catastrophic  home, root or credentials -- never runs
 *   unknown       the parser could not resolve it, which escalates rather
 *                 than being assumed safe
 */
export function classifyTarget(raw: string, ctx: RiskContext): TargetClass {
  const { path: resolved, unknown } = expand(raw, ctx);

  // Writing to a device sink destroys nothing, so it earns no finding at all.
  // Without this it would fall through to "outside the working directory" and
  // turn every ordinary `cmd > /dev/null` into a permission prompt.
  if (SAFE_DEVICE_SINKS.some((sink) => normalize(sink) === resolved)) return 'harmless';

  // Checked first: a glob or variable that resolves *into* a protected root is
  // still catastrophic, and `unknown` must not downgrade that.
  if (isCatastrophicTarget(resolved, ctx)) return 'catastrophic';

  // A wildcard directly under a protected root is the `rm -rf /*` shape.
  if (/[*?]/.test(raw)) {
    const parent = normalize(path.posix.dirname(resolved));
    if (isCatastrophicTarget(parent, ctx)) return 'catastrophic';
  }

  if (unknown) return 'unknown';

  const temp = ['/tmp', '/var/tmp', '/private/tmp'];
  if (temp.some((t) => isUnder(resolved, t))) return 'bounded';

  if (ctx.workingDirectory && isUnder(resolved, ctx.workingDirectory)) {
    // The working directory *itself* is not bounded: wiping the whole project
    // is a different act from deleting a file in it.
    return normalize(resolved) === normalize(ctx.workingDirectory) ? 'outside' : 'bounded';
  }

  return 'outside';
}

/** Exposed for tests and for explaining a refusal. */
export const ProtectedPaths = {
  homeSubpaths: () => [...PROTECTED_HOME_SUBPATHS],
  credentialSubpaths: () => [...PROTECTED_CREDENTIAL_SUBPATHS],
  systemPaths: () => [...PROTECTED_SYSTEM_PATHS],
  recursiveSystemPaths: () => [...SYSTEM_PATHS_PROTECTED_RECURSIVELY],
  safeDeviceSinks: () => [...SAFE_DEVICE_SINKS],
};
