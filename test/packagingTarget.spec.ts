/**
 * The VSIX is what it claims to be (production audit, 2026-09-24). The build
 * and freshness half of packaging is packaging.spec.ts.
 *
 * - It is packaged for `win32-x64`, after the gates, and says so.
 * - `check-dist --target win32-x64` refuses a package without the Windows
 *   Claude Code binary, with another OS's binary beside it, without ripgrep or
 *   Forge's plugin, or without the manifest fields vsce needs unattended.
 * - The bundled ripgrep is found where the package puts it.
 * - The unused CLI copy under resources/claude-code/ stays out of the VSIX.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extensionRoot, resolveRipgrep } from '../src/services/fileSystemService';
import { SUPPORTED_PLATFORM, unsupportedPlatformMessage } from '../src/services/claude/cliLaunch';

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

  it('packages for win32-x64 only, after lint, typecheck, tests and the brand gates', () => {
    const pack: string = manifest.scripts.package;
    expect(pack.startsWith('pnpm run verify && ')).toBe(true);
    expect(manifest.scripts.verify).toBe('pnpm run lint && pnpm run typecheck:all && pnpm test && pnpm run lint:forge');
    expect(pack).toContain('pnpm run build:extension:win32');
    expect(manifest.scripts['build:extension:win32']).toBe('tsx esbuild.ts --production --target win32-x64');
    expect(pack).toContain('pnpm run lint:dist:win32');
    expect(manifest.scripts['lint:dist:win32']).toBe('node scripts/check-dist.mjs --target win32-x64');
    expect(pack).toMatch(/vsce package --no-dependencies --target win32-x64\b/);
  });

  it('ships a CHANGELOG, and keeps the unused CLI copy out', () => {
    expect(fs.existsSync(path.join(ROOT, 'CHANGELOG.md'))).toBe(true);
    const ignore = fs.readFileSync(path.join(ROOT, '.vscodeignore'), 'utf8').split(/\r?\n/);
    expect(ignore).toContain('resources/claude-code/**');
    expect(ignore).not.toContain('changelog.md');
  });
});

describe('the platform', () => {
  it('is win32-x64', () => {
    expect(SUPPORTED_PLATFORM).toBe('win32-x64');
    expect(unsupportedPlatformMessage('win32', 'x64')).toBeUndefined();
  });

  it.each([['linux', 'x64'], ['darwin', 'arm64'], ['win32', 'arm64']])('%s-%s is told plainly', (platform, arch) => {
    expect(unsupportedPlatformMessage(platform, arch)).toBe(`Forge runs on Windows x64 only. This VS Code is ${platform}-${arch}, which is untested.`);
    expect(unsupportedPlatformMessage(platform, arch, { binaryMissing: true })).toBe(
      `Forge runs on Windows x64 only. This VS Code is ${platform}-${arch}, and this build has no Claude Code binary for it.`,
    );
  });
});

describe('ripgrep', () => {
  it('is looked for under the extension, from the bundle and from the sources', () => {
    expect(extensionRoot(path.join('/ext', 'forge', 'dist'))).toBe(path.join('/ext', 'forge'));
    expect(extensionRoot(path.join(ROOT, 'src', 'services'))).toBe(ROOT);
  });

  it('is the bundled rg.exe on Windows x64', () => {
    const bundled = path.join('/ext/forge', 'resources', 'ripgrep', 'x64-win32', 'rg.exe');
    expect(resolveRipgrep('/ext/forge', 'win32', 'x64', (f) => f === bundled)).toBe(bundled);
  });

  it('falls back to rg on PATH, as the official does', () => {
    expect(resolveRipgrep('/ext/forge', 'win32', 'x64', () => false)).toBe('rg.exe');
    expect(resolveRipgrep('/ext/forge', 'linux', 'x64', () => true)).toBe('rg');
  });

  it('ships in the repository with its licence', () => {
    expect(fs.existsSync(path.join(ROOT, 'resources/ripgrep/x64-win32/rg.exe'))).toBe(true);
    expect(fs.readFileSync(path.join(ROOT, 'resources/ripgrep/COPYING'), 'utf8')).toMatch(/Unlicense and MIT/);
  });
});

describe('check-dist --target win32-x64', () => {
  let dir: string;

  const write = (rel: string, content: string | Buffer) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  const exe = (size: number) => Buffer.concat([Buffer.from('MZ'), Buffer.alloc(size)]);
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
    write('resources/native-binary/claude.exe', exe(11 * 1024 * 1024));
    write('resources/ripgrep/x64-win32/rg.exe', exe(10));
    write('resources/ripgrep/COPYING', 'MIT');
    write('CHANGELOG.md', '# Changelog');
    write('.vscodeignore', 'src/**\nresources/claude-code/**\n');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('passes a complete package', () => {
    const result = run('--target', 'win32-x64');
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/win32-x64 contents are complete/);
  });

  it.each([
    ['no claude.exe', () => fs.rmSync(path.join(dir, 'resources/native-binary/claude.exe')), /claude\.exe is missing/],
    ['a claude.exe that is not a Windows executable', () => write('resources/native-binary/claude.exe', Buffer.alloc(11 * 1024 * 1024)), /not a Windows executable/],
    ['a stub claude.exe', () => write('resources/native-binary/claude.exe', exe(100)), /under 10 MB/],
    ['a Linux binary beside it', () => write('resources/native-binary/claude', 'elf'), /holds more than claude\.exe: claude/],
    ['no ripgrep', () => fs.rmSync(path.join(dir, 'resources/ripgrep/x64-win32/rg.exe')), /rg\.exe is missing/],
    ['no ripgrep licence', () => fs.rmSync(path.join(dir, 'resources/ripgrep/COPYING')), /COPYING is missing/],
    ['no plugin manifest', () => fs.rmSync(path.join(dir, 'resources/forge-plugin/.claude-plugin/plugin.json')), /plugin\.json is missing/],
    ['a plugin manifest that does not parse', () => write('resources/forge-plugin/.claude-plugin/plugin.json', '{'), /does not parse/],
    ['no Expert style', () => fs.rmSync(path.join(dir, 'resources/forge-plugin/output-styles/expert.md')), /expert\.md is missing/],
    ['no repository', () => write('package.json', '{}'), /no repository\.url/],
    ['no CHANGELOG', () => fs.rmSync(path.join(dir, 'CHANGELOG.md')), /CHANGELOG\.md is missing/],
    ['the CLI copy not excluded', () => write('.vscodeignore', 'src/**\n'), /does not exclude resources\/claude-code/],
  ])('refuses a package with %s', (_what, breakIt, message) => {
    breakIt();
    const result = run('--target', 'win32-x64');
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(message);
  });

  it('refuses a target Forge does not ship for', () => {
    const result = run('--target', 'linux-x64');
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/win32-x64 only/);
  });

  it('still refuses stale bundles, as before', () => {
    const earlier = new Date(Date.now() - 3_600_000);
    fs.utimesSync(path.join(dir, 'dist/extension.cjs'), earlier, earlier);
    const result = run('--target', 'win32-x64');
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/dist\/extension\.cjs is \d+ minute\(s\) older/);
  });

  it('without a target, checks the plugin but not the Windows files', () => {
    fs.rmSync(path.join(dir, 'resources/native-binary/claude.exe'));
    expect(run().status).toBe(0);
    fs.rmSync(path.join(dir, 'resources/forge-plugin/output-styles/expert.md'));
    expect(run().status).toBe(1);
  });
});
