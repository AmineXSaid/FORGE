/**
 * Which `claude` binary Forge spawns, and the environment it gets.
 *
 * Since @anthropic-ai/claude-agent-sdk 0.2.113 the SDK runs a native Claude Code
 * binary shipped in a per-platform optional dependency; there is no bundled
 * cli.js any more, and the SDK's arguments follow the CLI of its own release
 * (0.3.274 pairs with CLI 2.1.274 and emits flags such as `--thinking` that an
 * older cli.js rejects). So Forge resolves the binary exactly the way the
 * official extension host does, and never falls back to a script.
 *
 * Kept free of `vscode` so the build script and the specs can import it.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

/** The SDK's own package-name prefix for its per-platform binaries (`yu` in sdk.mjs). */
export const SDK_PLATFORM_PACKAGE_PREFIX = '@anthropic-ai/claude-agent-sdk';

export interface ClaudeBinaryHost {
  platform: NodeJS.Platform | string;
  arch: string;
  /** Resolve a path relative to the extension root (`ExtensionContext.asAbsolutePath`). */
  asAbsolutePath(relativePath: string): string;
  exists(absolutePath: string): boolean;
  isMusl(): boolean;
}

/** An error carrying the official host's `errorClass` (`Rh0`). */
export class ClaudeBinaryError extends Error {
  constructor(message: string, readonly errorClass: string) {
    super(message);
    this.name = 'ClaudeBinaryError';
  }
}

/** The official `jh0`: a musl libc on Linux (the loader files, else `ldd /bin/ls`). */
export function isMuslLinux(platform: string = process.platform): boolean {
  if (platform !== 'linux') return false;
  try {
    if (existsSync('/lib/libc.musl-x86_64.so.1') || existsSync('/lib/libc.musl-aarch64.so.1')) return true;
    const out = execSync('ldd /bin/ls 2>/dev/null', {
      env: process.env,
      maxBuffer: 1e6,
      timeout: 20000,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    return out.includes('musl');
  } catch {
    return false;
  }
}

/**
 * The official `xh0`, in its order:
 *   resources/native-binaries/<platform>-<arch>[-musl]/claude[.exe]
 *   resources/native-binaries/win32-x64/claude.exe      (win32-arm64 only)
 *   resources/native-binary/claude[.exe]
 */
export function findClaudeBinary(host: ClaudeBinaryHost): string | undefined {
  const binary = host.platform === 'win32' ? 'claude.exe' : 'claude';
  const archDir = host.isMusl() ? `${host.arch}-musl` : host.arch;

  const exact = host.asAbsolutePath(path.join('resources', 'native-binaries', `${host.platform}-${archDir}`, binary));
  if (host.exists(exact)) return exact;

  if (host.platform === 'win32' && host.arch === 'arm64') {
    const x64 = host.asAbsolutePath(path.join('resources', 'native-binaries', 'win32-x64', binary));
    if (host.exists(x64)) return x64;
  }

  const single = host.asAbsolutePath(path.join('resources', 'native-binary', binary));
  if (host.exists(single)) return single;

  return undefined;
}

/** The official `o1$` without a process wrapper: the binary, or an `unsupported_platform` error. */
export function resolveClaudeExecutable(host: ClaudeBinaryHost): string {
  const found = findClaudeBinary(host);
  if (!found) {
    throw new ClaudeBinaryError(
      `Unsupported platform: ${host.platform}-${host.arch}. No compatible Claude Code binary found.`,
      'unsupported_platform'
    );
  }
  return found;
}

/**
 * The SDK's per-platform binary specifiers, in the order its `AG` tries them
 * (musl first on a musl Linux). The build copies the first one that resolves
 * into `resources/native-binary/`, which is where `findClaudeBinary` looks.
 */
export function sdkPlatformBinarySpecifiers(platform: string, arch: string, preferMusl: boolean): string[] {
  const ext = platform === 'win32' ? '.exe' : '';
  const prefix = SDK_PLATFORM_PACKAGE_PREFIX;
  const packages =
    platform === 'android'
      ? [`${prefix}-linux-${arch}-android`]
      : platform === 'linux'
        ? preferMusl
          ? [`${prefix}-linux-${arch}-musl`, `${prefix}-linux-${arch}`]
          : [`${prefix}-linux-${arch}`, `${prefix}-linux-${arch}-musl`]
        : [`${prefix}-${platform}-${arch}`];
  return packages.map((pkg) => `${pkg}/claude${ext}`);
}

/**
 * The variables the official host (`l3`) sets on the CLI environment before the
 * user's own `environmentVariables`:
 * - `MCP_CONNECTION_NONBLOCKING`: MCP servers connect in the background (the
 *   SDK default since 0.3.142, set explicitly by the official host);
 * - `CLAUDE_CODE_ENABLE_TASKS=0`: keep `TodoWrite`. SDK sessions switched to the
 *   Task tools in 0.3.142, and the transcript's todo list reads `TodoWrite`.
 */
export const OFFICIAL_CLI_ENV_DEFAULTS: Readonly<Record<string, string>> = Object.freeze({
  MCP_CONNECTION_NONBLOCKING: 'true',
  CLAUDE_CODE_ENABLE_TASKS: '0',
});

/**
 * The entrypoint the official host (`l3`) stamps on the CLI environment, *after*
 * the user's own `environmentVariables`, so it cannot be overridden.
 *
 * It is not cosmetic. The CLI only sends `unavailable_models` in its initialize
 * response when `CLAUDE_CODE_ENTRYPOINT` is on its allowlist, which is exactly
 * `["claude-vscode"]` in CLI 2.1.274 (`UNAVAILABLE_MODELS_HOST_ENTRYPOINTS`).
 * Without it the SDK fills in `sdk-ts` and the picker's greyed rows never arrive.
 */
export const OFFICIAL_CLI_ENTRYPOINT = 'claude-vscode';

/** The last step of the official `l3`: the entrypoint wins over everything before it. */
export function withOfficialEntrypoint(env: Record<string, string>): Record<string, string> {
  return { ...env, CLAUDE_CODE_ENTRYPOINT: OFFICIAL_CLI_ENTRYPOINT };
}

/**
 * The environment a CLI launch runs with: Forge's launch defaults, the host's,
 * the official defaults, the endpoint's, and the user's own variables.
 *
 * The user's variables win over the host's and the defaults, but not over the
 * endpoint's relay keys (address, token, model). Those are one choice the user
 * made in the endpoint setup, and a leftover `ANTHROPIC_API_KEY` from an
 * Anthropic-direct setup used to replace the relay token, so every message
 * came back "Forge relay: bad token". `shadowed` names the user variables that
 * lost, so the caller can say so in the log rather than drop them silently.
 */
export function mergeLaunchEnvironment(
  base: Record<string, string>,
  endpointEnv: Record<string, string>,
  customVars: Record<string, string>,
  forgeDefaults: Record<string, string> = {},
): { env: Record<string, string>; shadowed: string[] } {
  const shadowed = Object.keys(customVars).filter((key) => key in endpointEnv && customVars[key] !== endpointEnv[key]);
  return {
    // Forge's own defaults (`ConfigurationService.forgeLaunchDefaults`) are the
    // lowest layer: they are only the names nothing else sets.
    env: withOfficialEntrypoint({ ...forgeDefaults, ...base, ...OFFICIAL_CLI_ENV_DEFAULTS, ...customVars, ...endpointEnv }),
    shadowed,
  };
}

/**
 * What the chat says when a launch fails or the CLI stops mid-turn.
 *
 * The webview shows this in its error banner, so it has to make sense to
 * someone who has never seen the output channel: a missing binary and a
 * platform Forge does not ship for used to reach the chat as nothing at all
 * (production audit, 2026-09-24). Anything not recognised keeps its own text.
 */
/** The one platform Forge ships for (the VSIX is packaged `--target win32-x64`). */
export const SUPPORTED_PLATFORM = 'win32-x64';

/**
 * Why this platform is unsupported, or undefined on Windows x64. Shown once at
 * activation, and by the chat's error banner when a launch fails for want of a
 * binary. A build for another target (a local `pnpm run build`) can still
 * carry a binary, so only the launch failure says it is missing.
 */
export function unsupportedPlatformMessage(
  platform: string = process.platform,
  arch: string = process.arch,
  { binaryMissing = false }: { binaryMissing?: boolean } = {},
): string | undefined {
  if (`${platform}-${arch}` === SUPPORTED_PLATFORM) return undefined;
  const base = `Forge runs on Windows x64 only. This VS Code is ${platform}-${arch}`;
  return binaryMissing ? `${base}, and this build has no Claude Code binary for it.` : `${base}, which is untested.`;
}

const MISSING_BINARY = 'The Claude Code binary is missing from this Forge install. Reinstall the Forge extension.';

export function describeLaunchError(
  error: unknown,
  platform: string = process.platform,
  arch: string = process.arch,
): string {
  const message = (error instanceof Error ? error.message : String(error ?? '')).replace(/^(\w*Error):\s*/, '').trim();
  if ((error instanceof ClaudeBinaryError && error.errorClass === 'unsupported_platform') || /^Unsupported platform:/.test(message)) {
    // On the supported platform this error only means the bundled binary is
    // gone (a damaged install): say that, not "Unsupported platform: win32-x64"
    // (found by the end-to-end run, 2026-09-24).
    return unsupportedPlatformMessage(platform, arch, { binaryMissing: true }) ?? MISSING_BINARY;
  }
  const notFound = message.match(/^Claude CLI not found at:\s*(.+)$/);
  if (notFound || /\bspawn\b.*\bENOENT\b/.test(message)) {
    const where = notFound ? ` (${notFound[1].trim()})` : '';
    return `The Claude Code binary is missing from this Forge install${where}. Reinstall the Forge extension.`;
  }
  const exited = message.match(/process exited with code (-?\d+)/i);
  if (exited) {
    const reason = stderrReason(message);
    const said = reason ? `: ${reason}${/[.!?]$/.test(reason) ? '' : '.'}` : '.';
    return `Claude Code stopped unexpectedly (exit code ${exited[1]})${said} The Forge output channel has the details.`;
  }
  const killed = message.match(/process terminated by signal (\w+)/i);
  if (killed) {
    return `Claude Code was stopped by the system (${killed[1]}). The Forge output channel has the details.`;
  }
  return message || 'Claude Code stopped unexpectedly. The Forge output channel has the details.';
}

/** A `--debug-to-stderr` line (`2026-09-24T18:24:36.605Z [DEBUG] …`) or a stack frame. */
const STDERR_NOISE = /^(?:\d{4}-\d\d-\d\dT\S+\s+)?\[(?:DEBUG|INFO|WARN|WARNING|ERROR|TRACE|VERBOSE)\]|^\s+at\s/;

/**
 * The CLI's own last word before it exited: the SDK appends the stderr tail to
 * its exit error (`… exited with code 1. stderr: <tail>`, `formatStderrTail`),
 * and the official shows that message whole. Forge's stderr is mostly debug
 * log, so only the last line that is not one is kept, e.g. "--dangerously-skip-
 * permissions cannot be used with root/sudo privileges for security reasons"
 * or "error: unknown option '--foo'" from `forge.cliArgs`. The tail's first
 * line can be cut mid-word (the SDK keeps the last N characters), so it is
 * only used when it is the only line.
 */
export function stderrReason(message: string): string | undefined {
  const at = message.indexOf('. stderr: ');
  if (at < 0) return undefined;
  const lines = message.slice(at + '. stderr: '.length).split(/\r?\n/);
  const candidates = (lines.length > 1 ? lines.slice(1) : lines)
    .filter((line) => !STDERR_NOISE.test(line))
    .map((line) => line.trim())
    .filter(Boolean);
  const last = candidates.at(-1);
  return last && last.length > 240 ? `${last.slice(0, 239)}…` : last;
}

/**
 * An abort: the SDK's `AbortError` ("Claude Code process aborted by user",
 * "Operation aborted"), which is what closing a query Forge no longer needs
 * ends with. Not a failure to report.
 */
export function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // The SDK's abort class does not set `name`, so its messages are matched too.
  return error.name === 'AbortError' || /^(Claude Code process aborted by user|Operation aborted|Connection aborted)/.test(error.message);
}
