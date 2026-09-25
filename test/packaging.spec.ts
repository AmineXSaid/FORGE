/**
 * The packaging path, because a broken one shipped a broken extension.
 *
 * What happened: `pnpm run package` was `vsce package --no-dependencies`, and
 * the build was attached to it through a `prepackage` hook. pnpm no longer runs
 * pre/post hooks for arbitrary script names, so `package` went straight to vsce
 * and shipped whatever was already in `dist/`. The VSIX that came out held a
 * webview bundle built eight minutes earlier and an extension host bundle built
 * seven hours earlier. The new webview sent `open_settings`; the old host had no
 * case for it and threw `Unknown request type`; every "/" menu row did nothing
 * at all, which is exactly what was reported.
 *
 * The hook was also unrunnable on this platform: `sed -i ''` is BSD syntax and
 * GNU sed reads the `''` as the script, so the step exits 2 on Windows and
 * Linux. Even where hooks do run, packaging would have aborted.
 *
 * It happened again on Windows (2026-09-25), from the other side. The build
 * lived in `pnpm run package`, and running `vsce package` directly skipped it:
 * the VSIX held 24 files and 5.7 MB instead of 1296 files and 208 MB, with no
 * `dist/media` (a blank panel) and no Claude Code binary ("Unsupported
 * platform: win32-x64"). The build is now `vscode:prepublish`, which is not an
 * npm pre hook: vsce itself runs it (`npm run vscode:prepublish`) before every
 * package, whichever way it is called.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

describe('packaging always builds what it packages', () => {
  it('builds in vscode:prepublish, which vsce runs before packaging however it is called', () => {
    const prepublish = manifest.scripts['vscode:prepublish'];
    expect(prepublish).toContain('pnpm run build:webview');
    expect(prepublish).toContain('pnpm run build:extension:universal');
    // `pnpm run package` goes through vsce, so it builds too, and only once.
    expect(manifest.scripts.package).toContain('vsce package');
    expect(manifest.scripts.package).not.toContain('build:');
  });

  it('checks dist, last, before vsce zips it', () => {
    const prepublish = manifest.scripts['vscode:prepublish'];
    expect(prepublish).toMatch(/&& pnpm run lint:dist:universal$/);
  });

  it('skips the npm dependency walk for a plain `vsce package` too', () => {
    // Everything the host needs is bundled into dist/; pnpm's node_modules is not npm's.
    expect((manifest as unknown as { vsce?: { dependencies?: boolean } }).vsce?.dependencies).toBe(false);
  });

  it('has no prepackage or postpackage hook left to depend on', () => {
    expect(manifest.scripts.prepackage).toBeUndefined();
    expect(manifest.scripts.postpackage).toBeUndefined();
  });

  it('builds both halves of the extension', () => {
    // A `build` that produced only one of them is the failure mode above.
    expect(manifest.scripts.build).toContain('build:webview');
    expect(manifest.scripts.build).toContain('build:extension');
  });

  it('runs no BSD-only sed', () => {
    // `sed -i ''` works on macOS and fails everywhere else, so a script
    // carrying it is a script that only some machines can run.
    for (const [name, script] of Object.entries(manifest.scripts)) {
      expect(`${name}: ${script}`).not.toContain("sed -i ''");
    }
  });
});

describe('the freshness guard itself', () => {
  const guard = readFileSync(join(ROOT, 'scripts/check-dist.mjs'), 'utf8');

  it('checks the extension host bundle', () => {
    expect(guard).toContain('dist/extension.cjs');
  });

  it('checks the webview bundle', () => {
    // The skew between the two is the dangerous part: one bundle newer than
    // the other fails silently, where a missing bundle fails loudly.
    expect(guard).toContain('dist/media/main.js');
  });

  it('exits non-zero when it finds a problem', () => {
    expect(guard).toContain('process.exit(1)');
  });
});
