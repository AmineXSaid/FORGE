/**
 * CLI flag passthrough for the Forge backend.
 *
 * Forge runs the real `claude` binary through @anthropic-ai/claude-agent-sdk, so
 * the CLI is the backend. The SDK exposes `extraArgs` as its escape hatch: any
 * key/value here is appended to the spawned command line. This module turns the
 * `forge.cliArgs` setting into that map.
 *
 * It is deliberately gated. CLI flags drift between versions and a bad flag can
 * either kill the process or, worse, silently corrupt the stream protocol the SDK
 * talks over. So flags are sorted into three groups:
 *
 *   PROTOCOL  the SDK's wire contract depends on them. Hard-rejected -- passing
 *             one would break the transport, not just the request.
 *   MANAGED   the SDK already derives these from its own Options. Allowed, but
 *             warned about, because the result is a duplicated flag whose winner
 *             depends on the CLI's own argument precedence.
 *   FREE      everything else. Passed straight through.
 */

/** Flags whose values the SDK's stream transport depends on. Never passed through. */
const PROTOCOL_FLAGS = new Set([
  'print',
  'p',
  'output-format',
  'input-format',
  'include-partial-messages',
]);

/**
 * Flags the SDK already emits from its typed Options. Passing them again appends
 * a second occurrence rather than replacing the first.
 */
const MANAGED_FLAGS = new Map<string, string>([
  ['model', 'set by the Model selector (forge.selectedModel)'],
  ['permission-mode', 'set by the permission-mode selector'],
  ['resume', 'set by session restore'],
  ['continue', 'set by session restore'],
  ['settings', 'points at ~/.claude/forge.json for profile hot-reload'],
  ['cwd', 'set from the active workspace folder'],
  ['append-system-prompt', 'set via the systemPrompt option'],
]);

export interface CliArgDecision {
  flag: string;
  value: string | null;
  reason: string;
}

export interface CliArgsBuild {
  /** The merged map to hand to the SDK. */
  extraArgs: Record<string, string | null>;
  /** Flags refused outright, with why. */
  rejected: CliArgDecision[];
  /** Flags accepted but overlapping an SDK-managed option. */
  warned: CliArgDecision[];
  /** Flags accepted cleanly. */
  accepted: CliArgDecision[];
}

/** Accept `--add-dir`, `-p`, or a bare `add-dir`; normalise to the bare name. */
function normalizeFlag(raw: string): string {
  return raw.trim().replace(/^-+/, '');
}

/**
 * Coerce a configured value into what `extraArgs` accepts: a string, or null for
 * a valueless boolean flag. `true` means "present with no value"; `false` means
 * "leave it off entirely" so a flag can be disabled without deleting the key.
 */
function normalizeValue(raw: unknown): string | null | undefined {
  if (raw === null || raw === true || raw === '') return null;
  if (raw === false || raw === undefined) return undefined;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'bigint') return String(raw);
  if (Array.isArray(raw)) return raw.map((v) => String(v)).join(',');
  return undefined;
}

/**
 * Merge user-configured CLI flags over Forge's built-in ones.
 *
 * @param base      flags Forge always sets (debug, settings, ...)
 * @param configured raw value of the `forge.cliArgs` setting
 */
export function buildExtraArgs(
  base: Record<string, string | null>,
  configured: unknown,
): CliArgsBuild {
  const out: Record<string, string | null> = { ...base };
  const rejected: CliArgDecision[] = [];
  const warned: CliArgDecision[] = [];
  const accepted: CliArgDecision[] = [];

  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) {
    return { extraArgs: out, rejected, warned, accepted };
  }

  for (const [rawFlag, rawValue] of Object.entries(configured as Record<string, unknown>)) {
    const flag = normalizeFlag(rawFlag);
    if (!flag) continue;

    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(flag)) {
      rejected.push({ flag, value: null, reason: 'not a valid flag name' });
      continue;
    }

    if (PROTOCOL_FLAGS.has(flag)) {
      rejected.push({
        flag,
        value: null,
        reason: 'reserved: the SDK stream protocol depends on this flag',
      });
      continue;
    }

    const value = normalizeValue(rawValue);
    if (value === undefined) {
      // Explicitly disabled (false), or an unusable type. Drop any built-in too,
      // so `{"debug": false}` is how you turn Forge's own debug flag off.
      if (rawValue === false) {
        delete out[flag];
        accepted.push({ flag, value: null, reason: 'disabled' });
      } else {
        rejected.push({ flag, value: null, reason: `unsupported value type: ${typeof rawValue}` });
      }
      continue;
    }

    out[flag] = value;
    const managed = MANAGED_FLAGS.get(flag);
    if (managed) {
      warned.push({ flag, value, reason: `also ${managed}; the CLI decides which wins` });
    } else {
      accepted.push({ flag, value, reason: 'passthrough' });
    }
  }

  return { extraArgs: out, rejected, warned, accepted };
}

/** One-line summary for the output channel. */
export function describeBuild(build: CliArgsBuild): string[] {
  const lines: string[] = [];
  const render = (d: CliArgDecision) => `--${d.flag}${d.value === null ? '' : ` ${d.value}`}`;
  for (const d of build.accepted) lines.push(`  + ${render(d)}  (${d.reason})`);
  for (const d of build.warned) lines.push(`  ! ${render(d)}  -- ${d.reason}`);
  for (const d of build.rejected) lines.push(`  x --${d.flag}  REJECTED: ${d.reason}`);
  return lines;
}
