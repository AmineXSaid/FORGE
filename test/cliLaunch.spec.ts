/**
 * Tests for the Claude Code binary Forge spawns (the official host's `xh0` /
 * `o1$`) and the environment defaults it copies from `l3`.
 *
 * Agent SDK 0.3.x has no cli.js and passes flags only its own CLI release knows,
 * so the refusals matter most: a script must never be picked, and a missing
 * binary must fail with the official error rather than launch something older.
 */
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  ClaudeBinaryError,
  OFFICIAL_CLI_ENV_DEFAULTS,
  findClaudeBinary,
  isMuslLinux,
  resolveClaudeExecutable,
  sdkPlatformBinarySpecifiers,
  type ClaudeBinaryHost,
} from '../src/services/claude/cliLaunch';

const ROOT = path.join('/ext');

function host(overrides: Partial<ClaudeBinaryHost> & { files?: string[] } = {}): ClaudeBinaryHost {
  const files = new Set((overrides.files ?? []).map((f) => path.join(ROOT, f)));
  return {
    platform: 'win32',
    arch: 'x64',
    asAbsolutePath: (relativePath) => path.join(ROOT, relativePath),
    exists: (absolutePath) => files.has(absolutePath),
    isMusl: () => false,
    ...overrides,
  };
}

const rel = (...parts: string[]) => path.join(...parts);

describe('findClaudeBinary (official xh0)', () => {
  it('prefers resources/native-binaries/<platform>-<arch>', () => {
    const h = host({
      files: [rel('resources', 'native-binaries', 'win32-x64', 'claude.exe'), rel('resources', 'native-binary', 'claude.exe')],
    });
    expect(findClaudeBinary(h)).toBe(path.join(ROOT, 'resources', 'native-binaries', 'win32-x64', 'claude.exe'));
  });

  it('falls back to resources/native-binary/claude[.exe]', () => {
    expect(findClaudeBinary(host({ files: [rel('resources', 'native-binary', 'claude.exe')] }))).toBe(
      path.join(ROOT, 'resources', 'native-binary', 'claude.exe')
    );
    const linux = host({ platform: 'linux', files: [rel('resources', 'native-binary', 'claude')] });
    expect(findClaudeBinary(linux)).toBe(path.join(ROOT, 'resources', 'native-binary', 'claude'));
  });

  it('names the binary claude.exe only on win32', () => {
    const darwin = host({ platform: 'darwin', arch: 'arm64', files: [rel('resources', 'native-binaries', 'darwin-arm64', 'claude')] });
    expect(findClaudeBinary(darwin)).toBe(path.join(ROOT, 'resources', 'native-binaries', 'darwin-arm64', 'claude'));
    const wrongName = host({ platform: 'darwin', arch: 'arm64', files: [rel('resources', 'native-binaries', 'darwin-arm64', 'claude.exe')] });
    expect(findClaudeBinary(wrongName)).toBeUndefined();
  });

  it('adds -musl to the directory on a musl Linux, and does not use the glibc one', () => {
    const musl = host({
      platform: 'linux',
      isMusl: () => true,
      files: [rel('resources', 'native-binaries', 'linux-x64-musl', 'claude'), rel('resources', 'native-binaries', 'linux-x64', 'claude')],
    });
    expect(findClaudeBinary(musl)).toBe(path.join(ROOT, 'resources', 'native-binaries', 'linux-x64-musl', 'claude'));
    const onlyGlibc = host({ platform: 'linux', isMusl: () => true, files: [rel('resources', 'native-binaries', 'linux-x64', 'claude')] });
    expect(findClaudeBinary(onlyGlibc)).toBeUndefined();
  });

  it('runs the win32-x64 binary on win32-arm64 when there is no arm64 one', () => {
    const arm = host({ arch: 'arm64', files: [rel('resources', 'native-binaries', 'win32-x64', 'claude.exe')] });
    expect(findClaudeBinary(arm)).toBe(path.join(ROOT, 'resources', 'native-binaries', 'win32-x64', 'claude.exe'));
    const armLinux = host({ platform: 'linux', arch: 'arm64', files: [rel('resources', 'native-binaries', 'win32-x64', 'claude.exe')] });
    expect(findClaudeBinary(armLinux)).toBeUndefined();
  });

  it('never picks the old bundled cli.js', () => {
    const h = host({ files: [rel('resources', 'claude-code', 'cli.js')] });
    expect(findClaudeBinary(h)).toBeUndefined();
  });
});

describe('resolveClaudeExecutable (official o1$)', () => {
  it('returns the binary when one is there', () => {
    const h = host({ files: [rel('resources', 'native-binary', 'claude.exe')] });
    expect(resolveClaudeExecutable(h)).toBe(path.join(ROOT, 'resources', 'native-binary', 'claude.exe'));
  });

  it('throws the official unsupported_platform error when none is there, even with cli.js present', () => {
    const h = host({ platform: 'freebsd', arch: 'x64', files: [rel('resources', 'claude-code', 'cli.js')] });
    let caught: unknown;
    try {
      resolveClaudeExecutable(h);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ClaudeBinaryError);
    expect((caught as ClaudeBinaryError).errorClass).toBe('unsupported_platform');
    expect((caught as Error).message).toBe('Unsupported platform: freebsd-x64. No compatible Claude Code binary found.');
  });
});

describe('sdkPlatformBinarySpecifiers (the SDK AG order)', () => {
  it('maps win32 and darwin to one package', () => {
    expect(sdkPlatformBinarySpecifiers('win32', 'x64', false)).toEqual(['@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe']);
    expect(sdkPlatformBinarySpecifiers('darwin', 'arm64', true)).toEqual(['@anthropic-ai/claude-agent-sdk-darwin-arm64/claude']);
  });

  it('tries glibc then musl on Linux, or musl first when preferred', () => {
    expect(sdkPlatformBinarySpecifiers('linux', 'x64', false)).toEqual([
      '@anthropic-ai/claude-agent-sdk-linux-x64/claude',
      '@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude',
    ]);
    expect(sdkPlatformBinarySpecifiers('linux', 'arm64', true)).toEqual([
      '@anthropic-ai/claude-agent-sdk-linux-arm64-musl/claude',
      '@anthropic-ai/claude-agent-sdk-linux-arm64/claude',
    ]);
  });

  it('maps android to the linux android package', () => {
    expect(sdkPlatformBinarySpecifiers('android', 'arm64', false)).toEqual(['@anthropic-ai/claude-agent-sdk-linux-arm64-android/claude']);
  });
});

describe('isMuslLinux (official jh0)', () => {
  it('is false off Linux without probing', () => {
    expect(isMuslLinux('win32')).toBe(false);
    expect(isMuslLinux('darwin')).toBe(false);
  });
});

describe('OFFICIAL_CLI_ENV_DEFAULTS (official l3)', () => {
  it('keeps TodoWrite and background MCP connection, and nothing else', () => {
    expect(OFFICIAL_CLI_ENV_DEFAULTS).toEqual({ MCP_CONNECTION_NONBLOCKING: 'true', CLAUDE_CODE_ENABLE_TASKS: '0' });
  });

  it('cannot be mutated by a caller', () => {
    expect(Object.isFrozen(OFFICIAL_CLI_ENV_DEFAULTS)).toBe(true);
  });
});

describe('ClaudeSdkService.checkCliHealth without a bundled binary', () => {
  it('reports the official unsupported_platform message instead of throwing', async () => {
    const vscode = await import('vscode');
    const { InstantiationServiceBuilder } = await import('../src/di/instantiationServiceBuilder');
    const { registerServices } = await import('../src/services/serviceRegistry');
    const { IClaudeSdkService } = await import('../src/services/claude/ClaudeSdkService');
    const context = {
      extensionMode: vscode.ExtensionMode.Test,
      subscriptions: [],
      extensionPath: path.join(ROOT, 'no-such-extension'),
      asAbsolutePath: (p: string) => path.join(ROOT, 'no-such-extension', p),
      globalState: { get: () => undefined, update: () => Promise.resolve() },
      workspaceState: { get: () => undefined, update: () => Promise.resolve() },
    } as unknown as import('vscode').ExtensionContext;
    const builder = new InstantiationServiceBuilder();
    registerServices(builder, context);
    const result = await builder.seal().invokeFunction((accessor) => accessor.get(IClaudeSdkService).checkCliHealth());
    expect(result.ok).toBe(false);
    expect(result.error).toBe(`Unsupported platform: ${process.platform}-${process.arch}. No compatible Claude Code binary found.`);
  });
});
