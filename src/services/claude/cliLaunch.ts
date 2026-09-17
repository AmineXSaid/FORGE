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
