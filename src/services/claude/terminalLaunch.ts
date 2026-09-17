/**
 * "Open Forge in Terminal": the official `claude-vscode.terminal.open` command,
 * ported.
 *
 * The official host answers `open_claude_in_terminal` by validating the webview's
 * payload with `JI0` and then running that command, which builds a command line
 * and drops it into a fresh terminal (`Qd0` in `extension.js`). Everything here
 * is the pure half of that: the validator, the Windows shell detection and the
 * quoting. The terminal itself is created in `handlers.ts`, which is the only
 * part that needs `vscode`.
 *
 * **One deliberate divergence.** The official resolves `claude` on PATH
 * (`PX("claude", true)`) and falls back to the bare name `claude` whenever the
 * shell can be trusted to find it. Forge ships its own native binary inside the
 * extension (`cliLaunch.ts`), so there is nothing on PATH to fall back to and the
 * absolute path is always quoted for the detected shell. That is also the point:
 * the terminal must run the same binary the SDK session runs, not whatever a
 * `claude` on PATH happens to be.
 *
 * Kept free of `vscode` so the specs can import it.
 */

/** The shells the official distinguishes on Windows (`Qa$`). */
export type WindowsShellKind = 'powershell' | 'cmd' | 'bash' | 'unknown';

/** The official `location` values (`$d0`). */
export type TerminalLocation = 'bottom' | 'window' | 'beside';

/** Where the terminal is created: an editor column, or the panel. */
export type TerminalPlacement = 'beside' | 'one' | 'panel';

/** The official `XI0`: a bare slash command and nothing else. */
export const SLASH_COMMAND_RE = /^\/[a-z][a-z-]{0,63}$/;

/** The official `SD0`: the session id shape. */
export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The official error thrown when `JI0` rejects the payload, verbatim. */
export const INVALID_REQUEST_MESSAGE =
  'open_claude_in_terminal: only a bare slash command and --resume <session id> can be passed from the webview';

/**
 * Forge's counterpart to the official `Xa$`. The official blocks a PowerShell
 * launch it cannot resolve; Forge blocks the one path shape Command Prompt
 * cannot be handed safely, because `%` is expanded even inside double quotes and
 * there is no escape for it on an interactive command line.
 */
export const UNQUOTABLE_FOR_CMD_MESSAGE =
  "Forge's Claude CLI sits at a path containing '%' or '!', which Command Prompt expands instead of passing through, so the launch was blocked. " +
  'Set `terminal.integrated.defaultProfile.windows` to PowerShell or Git Bash, or install the extension under a path without those characters.';

/** A launch refused before a terminal was created. */
export class TerminalLaunchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TerminalLaunchError';
  }
}

/** The official `y0`: a session id, or `null`. */
export function validateSessionId(id: unknown): string | null {
  if (typeof id !== 'string') return null;
  return SESSION_ID_RE.test(id) ? id : null;
}

/** The official `$d0`. */
export function isTerminalLocation(value: unknown): value is TerminalLocation {
  return typeof value === 'string' && ['bottom', 'window', 'beside'].includes(value);
}

/**
 * The official `JI0`, ported literally: `prompt` is absent or a bare slash
 * command; `args` is absent, empty, or exactly `["--resume", <session id>]`.
 * Note that the official does **not** validate `location` here -- the command
 * registration drops an unrecognised one (`$d0(W)?W:void 0`).
 */
export function isValidOpenClaudeInTerminalRequest(request: { prompt?: unknown; args?: unknown }): boolean {
  const { prompt, args } = request;
  const promptOk = prompt === undefined || (typeof prompt === 'string' && SLASH_COMMAND_RE.test(prompt));
  const argsOk =
    args === undefined ||
    (Array.isArray(args) &&
      (args.length === 0 || (args.length === 2 && args[0] === '--resume' && validateSessionId(args[1]) !== null)));
  return promptOk && argsOk;
}

/**
 * The official `az`: POSIX single-quote quoting. Everything `JI0` accepts
 * (`--resume`, a session id, `/slash-command`) matches the safe-character class,
 * so accepted arguments pass through unchanged and the result is the same in
 * every shell.
 */
export function shellQuote(parts: readonly unknown[]): string {
  return parts
    .map((part) => {
      const value = String(part);
      if (value === '') return "''";
      if (/^[A-Za-z0-9_./:=@+,-]+$/.test(value)) return value;
      return "'" + value.replaceAll("'", `'"'"'`) + "'";
    })
    .join(' ');
}

/** The official `P6$`: a profile path reduced to a comparable basename. */
export function basenameKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .replace(/.*[\\/]/, '')
    .replace(/^[a-z]:/, '')
    .replace(/[. ]+$/, '');
}

/** The official `al0`: a profile path VS Code could not use as a shell. */
export function isUnusableProfilePath(value: string): boolean {
  if (/[<>"|?*]/.test(value)) return true;
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) < 32) return true;
  }
  return value
    .replace(/^[A-Za-z]:/, '')
    .replace(/\$\{[^}]*\}/g, '')
    .includes(':');
}

const POWERSHELL_NAMES = new Set(['powershell', 'pwsh']); // the official `ol0`
const BASH_NAMES = new Set(['bash', 'sh', 'zsh', 'wsl']); // the official `rl0`
const EXECUTABLE_SUFFIX = /\.(exe|com|bat|cmd)$/; // the official `en$`
const PROFILE_SOURCES = new Set(['PowerShell', 'Git Bash']); // the official `nl0`

/** The official `$a$`: a basename to a shell kind. */
export function shellKindFromBasename(name: string): WindowsShellKind {
  const stem = name.replace(EXECUTABLE_SUFFIX, '');
  if (stem === '') return 'unknown';
  if (POWERSHELL_NAMES.has(stem)) return 'powershell';
  if (stem === 'cmd') return 'cmd';
  if (BASH_NAMES.has(stem)) return 'bash';
  return 'unknown';
}

/** The official `sl0`: a profile path to a shell kind, `${env:...}` and 8.3 names included. */
function shellKindFromPath(value: string): WindowsShellKind {
  const name = basenameKey(value);
  if (name.includes('${')) return 'powershell';
  if (/~\d+$/.test(name.replace(EXECUTABLE_SUFFIX, ''))) return 'powershell';
  return shellKindFromBasename(name);
}

/** The official `tl0`: one kind for a profile's list of paths. */
function shellKindFromPaths(paths: readonly string[]): WindowsShellKind {
  const kinds = paths.map(shellKindFromPath);
  const first = kinds[0] ?? 'unknown';
  if (kinds.every((kind) => kind === first)) return first;
  if (kinds.includes('powershell')) return 'powershell';
  if (kinds.includes('cmd')) return 'cmd';
  return 'unknown';
}

/** What `el0` reads out of `terminal.integrated` before `Qa$` classifies it. */
export interface WindowsTerminalProfile {
  profileName?: unknown;
  profileSource?: string;
  profilePath?: unknown;
  suppressBuiltinName?: boolean;
  envShell?: string;
}

/** The official `tn$`: the `profiles.windows` entry the default profile names. */
export function readDefaultProfile(
  profiles: unknown,
  defaultProfile: string | undefined
): Pick<WindowsTerminalProfile, 'profileSource' | 'profilePath' | 'suppressBuiltinName'> {
  if (!defaultProfile || typeof profiles !== 'object' || profiles === null) return {};
  if (!Object.hasOwn(profiles, defaultProfile)) return {};
  const entry = (profiles as Record<string, unknown>)[defaultProfile];
  if (typeof entry === 'object' && entry !== null) {
    const profile = entry as { source?: unknown; path?: unknown };
    if (profile.source !== undefined) {
      return typeof profile.source === 'string' && PROFILE_SOURCES.has(profile.source)
        ? { suppressBuiltinName: true, profileSource: profile.source }
        : { suppressBuiltinName: true };
    }
    if (profile.path !== undefined) return { suppressBuiltinName: true, profilePath: profile.path };
  }
  return { suppressBuiltinName: true };
}

/** The official `Qa$`: which shell the Windows default profile will start. */
export function detectWindowsShell(profile: WindowsTerminalProfile): WindowsShellKind {
  if (profile.profileSource === 'PowerShell') return 'powershell';
  if (profile.profileSource === 'Git Bash') return 'bash';

  const raw = profile.profilePath;
  const paths = (Array.isArray(raw) ? raw : [raw])
    .map((entry) => {
      if (typeof entry === 'object' && entry !== null) {
        const nested = (entry as { path?: unknown }).path;
        if (typeof nested === 'string') return nested;
      }
      return entry;
    })
    .filter(
      (entry): entry is string =>
        typeof entry === 'string' && basenameKey(entry) !== '' && !isUnusableProfilePath(entry.replace(/^\\\\\?\\/, ''))
    );

  const fromPaths = shellKindFromPaths(paths);
  if (fromPaths !== 'unknown') return fromPaths;

  const name = !profile.suppressBuiltinName && typeof profile.profileName === 'string' ? profile.profileName : '';
  if (name === 'PowerShell' || name === 'Windows PowerShell') return 'powershell';
  if (name === 'Command Prompt') return 'cmd';
  if (name === 'Git Bash' || name.endsWith(' (WSL)')) return 'bash';

  if (paths.length === 0) {
    const envName = basenameKey(profile.envShell);
    if (envName === '') return 'powershell';
    return shellKindFromBasename(envName);
  }
  return 'unknown';
}

/**
 * The official `Ja$`, with Forge's bundled binary in place of the PATH lookup.
 * Only PowerShell needs the call operator; Command Prompt and an unrecognised
 * shell share the double-quoted form, and bash takes POSIX quoting.
 */
export function quoteExecutable(platform: string, executable: string, shell: WindowsShellKind): string {
  if (platform !== 'win32') return shellQuote([executable]);
  if (shell === 'powershell') return `& '${executable.replaceAll(/['‘-‛]/g, (quote) => quote + quote)}'`;
  if (shell === 'bash') return shellQuote([executable]);
  if (/[%!]/.test(executable)) throw new TerminalLaunchError(UNQUOTABLE_FOR_CMD_MESSAGE);
  return `"${executable}"`;
}

/** The official `za$`: the executable, then the args, then the prompt. */
export function buildCommandLine(executable: string, args: readonly string[] = [], prompt?: string): string {
  const parts = [...args];
  if (prompt) parts.push(prompt);
  return parts.length > 0 ? `${executable} ${shellQuote(parts)}` : executable;
}

/**
 * The official `Ya$`: dispose the terminal once the command it was created for
 * has finished cleanly. A quoted command line is left alone, because the shell
 * reports it differently from what was sent.
 */
export function shouldDisposeAfterExecution(
  commandLine: string,
  expected: string,
  exitCode: number | undefined
): boolean {
  if (exitCode !== 0) return false;
  if (commandLine.startsWith('claude ')) return true;
  if (commandLine !== expected) return false;
  return !expected.startsWith('"');
}

/**
 * The official location mapping in `Qd0`: `beside` and an absent location open
 * beside the editor, `window` opens in column one and is then moved to a new
 * window, and `bottom` gets no view column at all -- the terminal panel.
 */
export function terminalPlacement(location: TerminalLocation | undefined): TerminalPlacement {
  if (location === 'beside' || location === undefined) return 'beside';
  if (location === 'window') return 'one';
  return 'panel';
}
