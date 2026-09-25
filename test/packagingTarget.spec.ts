/**
 * The VSIX is what it claims to be (production audit, 2026-09-24). The build
 * and freshness half of packaging is packaging.spec.ts.
 *
 * - It is one VSIX for Windows x64 and Linux x64, packaged after the gates.
 * - `check-dist --universal` refuses a package missing either target's Claude
 *   Code binary (or carrying the wrong kind, a stub, or a stray target), either
 *   ripgrep, Forge's plugin, or the manifest fields vsce needs unattended.
 * - The bundled ripgrep and binary are found where the package puts them, and
 *   made executable on Linux when the archive carried no execute bit.
 * - The unused CLI copy under resources/claude-code/ stays out of the VSIX.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extensionRoot, resolveRipgrep } from '../src/services/fileSystemService';
import { RELEASE_TARGETS, ensureExecutable, releaseBinaryName, unsupportedPlatformMessage } from '../src/services/claude/cliLaunch';

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

describe('the manifest', () => {
  it('names its repository, so vsce runs unattended', () => {
    expect(manifest.repository?.url).toBe('https://github.com/AmineXSaid/FORGE.git');
  });

  // Found by the end-to-end run in code-server (Phase 4): three view/title
  // entries without icons drew as the text "Forge: New Conversation Ctrl+N"
  // over the chat's header. The official contributes no view/title menu; its
  // webview header carries New Conversation and Past Conversations.
  it('contributes no view/title menu, as the official', () => {
    expect(manifest.contributes.menus['view/title']).toBeUndefined();
  });

  it('gives every title-bar (navigation) entry an icon, so none draws as text', () => {
    const icons = new Map(manifest.contributes.commands.map((c: { command: string; icon?: unknown }) => [c.command, c.icon]));
    for (const [menu, entries] of Object.entries(manifest.contributes.menus as Record<string, Array<{ command: string; group?: string }>>)) {
      if (!menu.endsWith('/title')) continue;
      for (const entry of entries) {
        if (entry.group?.startsWith('navigation')) expect(icons.get(entry.command), `${menu}: ${entry.command}`).toBeTruthy();
      }
    }
  });

  it('packages one VSIX for Windows and Linux, after lint, typecheck, tests and the brand gates', () => {
    const pack: string = manifest.scripts.package;
    expect(pack.startsWith('pnpm run verify && ')).toBe(true);
    expect(manifest.scripts.verify).toBe('pnpm run lint && pnpm run typecheck:all && pnpm test && pnpm run lint:forge');
    expect(manifest.scripts['vscode:prepublish']).toBe(
      'pnpm run build:webview && pnpm run fetch:native && pnpm run build:extension:universal && pnpm run lint:dist:universal'
    );
    expect(manifest.scripts['fetch:native']).toBe('node scripts/fetch-native-binaries.mjs');
    expect(manifest.scripts['build:extension:universal']).toBe('tsx esbuild.ts --production --universal');
    expect(manifest.scripts['lint:dist:universal']).toBe('node scripts/check-dist.mjs --universal');
    // No --target: vsce makes a universal package, installable on both.
    expect(pack).toMatch(/vsce package --no-dependencies -o forge\.vsix$/);
    expect(pack).not.toContain('--target');
  });

  it('ships a CHANGELOG, and keeps the unused CLI copy out', () => {
    expect(fs.existsSync(path.join(ROOT, 'CHANGELOG.md'))).toBe(true);
    const ignore = fs.readFileSync(path.join(ROOT, '.vscodeignore'), 'utf8').split(/\r?\n/);
    expect(ignore).toContain('resources/claude-code/**');
    expect(ignore).not.toContain('changelog.md');
    // A dev build's single binary and the fetch cache never ship.
    expect(ignore).toContain('resources/native-binary/**');
    expect(ignore).toContain('.forge-cache/**');
  });

  it('names the same release targets in the host, the build, the fetch script and check-dist', () => {
    expect([...RELEASE_TARGETS]).toEqual(['win32-x64', 'linux-x64']);
    for (const file of ['scripts/fetch-native-binaries.mjs', 'scripts/check-dist.mjs']) {
      expect(fs.readFileSync(path.join(ROOT, file), 'utf8'), file).toContain("RELEASE_TARGETS = ['win32-x64', 'linux-x64']");
    }
    expect(fs.readFileSync(path.join(ROOT, 'esbuild.ts'), 'utf8')).toContain('for (const releaseTarget of RELEASE_TARGETS)');
    expect(releaseBinaryName('win32-x64')).toBe('claude.exe');
    expect(releaseBinaryName('linux-x64')).toBe('claude');
  });
});

describe('the platform', () => {
  it('is Windows x64 and Linux x64 (glibc)', () => {
    expect(unsupportedPlatformMessage('win32', 'x64')).toBeUndefined();
    expect(unsupportedPlatformMessage('linux', 'x64', { musl: false })).toBeUndefined();
  });

  it('says a musl Linux has no binary, at activation and on a failed launch', () => {
    expect(unsupportedPlatformMessage('linux', 'x64', { musl: true })).toBe(
      'Forge runs on Windows x64 and Linux x64 (glibc). This VS Code is linux-x64 on musl libc, which is untested.',
    );
    expect(unsupportedPlatformMessage('linux', 'x64', { musl: true, binaryMissing: true })).toMatch(/on musl libc, and this build has no Claude Code binary for it\.$/);
  });

  it.each([['darwin', 'arm64'], ['win32', 'arm64'], ['linux', 'arm64']])('%s-%s is told plainly', (platform, arch) => {
    expect(unsupportedPlatformMessage(platform, arch)).toBe(`Forge runs on Windows x64 and Linux x64 (glibc). This VS Code is ${platform}-${arch}, which is untested.`);
    expect(unsupportedPlatformMessage(platform, arch, { binaryMissing: true })).toBe(
      `Forge runs on Windows x64 and Linux x64 (glibc). This VS Code is ${platform}-${arch}, and this build has no Claude Code binary for it.`,
    );
  });

  it('makes a Linux binary executable when the VSIX carried no execute bit, and leaves Windows alone', () => {
    const changed: string[] = [];
    const ops = (executable: boolean) => ({ canExecute: () => executable, makeExecutable: (f: string) => changed.push(f) });
    expect(ensureExecutable('/ext/claude', 'linux', ops(false))).toBe(true);
    expect(ensureExecutable('/ext/claude', 'linux', ops(true))).toBe(false);
    expect(ensureExecutable('C:\\ext\\claude.exe', 'win32', ops(false))).toBe(false);
    expect(changed).toEqual(['/ext/claude']);
    // For real, on this machine's file system.
    if (process.platform !== 'win32') {
      const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-x-')), 'claude');
      fs.writeFileSync(file, '#!/bin/sh\n', { mode: 0o644 });
      expect(ensureExecutable(file)).toBe(true);
      expect(fs.statSync(file).mode & 0o111).toBe(0o111);
    }
  });
});

describe('ripgrep', () => {
  it('is looked for under the extension, from the bundle and from the sources', () => {
    expect(extensionRoot(path.join('/ext', 'forge', 'dist'))).toBe(path.join('/ext', 'forge'));
    expect(extensionRoot(path.join(ROOT, 'src', 'services'))).toBe(ROOT);
  });

  it('is the bundled rg.exe on Windows x64 and rg on Linux x64, prepared before use', () => {
    const win = path.join('/ext/forge', 'resources', 'ripgrep', 'x64-win32', 'rg.exe');
    expect(resolveRipgrep('/ext/forge', 'win32', 'x64', (f) => f === win)).toBe(win);
    const linux = path.join('/ext/forge', 'resources', 'ripgrep', 'x64-linux', 'rg');
    const prepared: string[] = [];
    expect(resolveRipgrep('/ext/forge', 'linux', 'x64', (f) => f === linux, (f) => prepared.push(f))).toBe(linux);
    expect(prepared).toEqual([linux]);
  });

  it('falls back to rg on PATH, as the official does', () => {
    expect(resolveRipgrep('/ext/forge', 'win32', 'x64', () => false)).toBe('rg.exe');
    expect(resolveRipgrep('/ext/forge', 'linux', 'x64', () => false)).toBe('rg');
    expect(resolveRipgrep('/ext/forge', 'darwin', 'arm64', () => true)).toBe('rg');
  });

  it('ships in the repository for both targets, with its licence', () => {
    expect(fs.existsSync(path.join(ROOT, 'resources/ripgrep/x64-win32/rg.exe'))).toBe(true);
    expect(fs.readFileSync(path.join(ROOT, 'resources/ripgrep/x64-linux/rg')).subarray(0, 4).toString('latin1')).toBe('\x7fELF');
    expect(fs.readFileSync(path.join(ROOT, 'resources/ripgrep/COPYING'), 'utf8')).toMatch(/Unlicense and MIT/);
  });
});

describe('check-dist --universal', () => {
  let dir: string;

  const write = (rel: string, content: string | Buffer) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  const exe = (size: number) => Buffer.concat([Buffer.from('MZ'), Buffer.alloc(size)]);
  const elf = (size: number) => Buffer.concat([Buffer.from('\x7fELF', 'latin1'), Buffer.alloc(size)]);
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-dist.mjs'), '--root', dir, ...args], { encoding: 'utf8' });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-dist-'));
    write('src/a.ts', 'x');
    write('package.json', JSON.stringify({ repository: { url: 'https://example.com/x.git' } }));
    // The bundles are built after the sources.
    const later = new Date(Date.now() + 60_000);
    write('dist/extension.cjs', 'x');
    write('dist/media/main.js', 'x');
    fs.utimesSync(path.join(dir, 'dist/extension.cjs'), later, later);
    fs.utimesSync(path.join(dir, 'dist/media/main.js'), later, later);
    write('resources/forge-plugin/.claude-plugin/plugin.json', JSON.stringify({ name: 'forge' }));
    write('resources/forge-plugin/output-styles/expert.md', '---\nname: Expert\n---\n');
    write('resources/native-binaries/win32-x64/claude.exe', exe(11 * 1024 * 1024));
    write('resources/native-binaries/linux-x64/claude', elf(11 * 1024 * 1024));
    write('resources/ripgrep/x64-win32/rg.exe', exe(10));
    write('resources/ripgrep/x64-linux/rg', elf(10));
    write('resources/ripgrep/COPYING', 'MIT');
    write('CHANGELOG.md', '# Changelog');
    write('.vscodeignore', 'src/**\nresources/claude-code/**\nresources/native-binary/**\n');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('passes a complete package', () => {
    const result = run('--universal');
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/universal VSIX contents are complete \(win32-x64, linux-x64/);
  });

  it.each([
    ['no Windows binary', () => fs.rmSync(path.join(dir, 'resources/native-binaries/win32-x64/claude.exe')), /win32-x64\/claude\.exe is missing/],
    ['no Linux binary', () => fs.rmSync(path.join(dir, 'resources/native-binaries/linux-x64/claude')), /linux-x64\/claude is missing/],
    ['a claude.exe that is not a Windows executable', () => write('resources/native-binaries/win32-x64/claude.exe', elf(11 * 1024 * 1024)), /claude\.exe is not a Windows executable/],
    ['a Linux claude that is not an ELF', () => write('resources/native-binaries/linux-x64/claude', exe(11 * 1024 * 1024)), /linux-x64\/claude is not a Linux executable/],
    ['a stub binary', () => write('resources/native-binaries/linux-x64/claude', elf(100)), /under 10 MB/],
    ['something else beside a binary', () => write('resources/native-binaries/win32-x64/claude', 'x'), /win32-x64\/ holds more than claude\.exe: claude/],
    ['a target that is not released', () => write('resources/native-binaries/darwin-arm64/claude', elf(10)), /not released: darwin-arm64/],
    ['no Windows ripgrep', () => fs.rmSync(path.join(dir, 'resources/ripgrep/x64-win32/rg.exe')), /rg\.exe is missing/],
    ['no Linux ripgrep', () => fs.rmSync(path.join(dir, 'resources/ripgrep/x64-linux/rg')), /x64-linux\/rg is missing/],
    ['a Linux ripgrep that is not an ELF', () => write('resources/ripgrep/x64-linux/rg', exe(10)), /x64-linux\/rg is not a Linux executable/],
    ['no ripgrep licence', () => fs.rmSync(path.join(dir, 'resources/ripgrep/COPYING')), /COPYING is missing/],
    ['no plugin manifest', () => fs.rmSync(path.join(dir, 'resources/forge-plugin/.claude-plugin/plugin.json')), /plugin\.json is missing/],
    ['a plugin manifest that does not parse', () => write('resources/forge-plugin/.claude-plugin/plugin.json', '{'), /does not parse/],
    ['no Expert style', () => fs.rmSync(path.join(dir, 'resources/forge-plugin/output-styles/expert.md')), /expert\.md is missing/],
    ['no repository', () => write('package.json', '{}'), /no repository\.url/],
    ['no CHANGELOG', () => fs.rmSync(path.join(dir, 'CHANGELOG.md')), /CHANGELOG\.md is missing/],
    ['the CLI copy not excluded', () => write('.vscodeignore', 'src/**\nresources/native-binary/**\n'), /does not exclude resources\/claude-code/],
    ['the dev binary not excluded', () => write('.vscodeignore', 'src/**\nresources/claude-code/**\n'), /does not exclude resources\/native-binary/],
  ])('refuses a package with %s', (_what, breakIt, message) => {
    breakIt();
    const result = run('--universal');
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(message);
  });

  it('refuses a single-platform --target: Forge ships one VSIX', () => {
    const result = run('--target', 'win32-x64');
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/one VSIX for win32-x64 and linux-x64; pass --universal/);
  });

  it('still refuses stale bundles, as before', () => {
    const earlier = new Date(Date.now() - 3_600_000);
    fs.utimesSync(path.join(dir, 'dist/extension.cjs'), earlier, earlier);
    const result = run('--universal');
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/dist\/extension\.cjs is \d+ minute\(s\) older/);
  });

  it('without --universal, checks the plugin but not the binaries', () => {
    fs.rmSync(path.join(dir, 'resources/native-binaries'), { recursive: true });
    expect(run().status).toBe(0);
    fs.rmSync(path.join(dir, 'resources/forge-plugin/output-styles/expert.md'));
    expect(run().status).toBe(1);
  });
});
