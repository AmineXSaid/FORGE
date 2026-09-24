/**
 * `pnpm run release:check` (production audit, Phase 5): every gate in the
 * order the plan gives, and a smoke install that is never claimed when it did
 * not run.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(ROOT, 'scripts/release-check.mjs'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

describe('release:check', () => {
  it('is the script in package.json', () => {
    expect(manifest.scripts['release:check']).toBe('node scripts/release-check.mjs');
  });

  it('runs the gates in the plan order: lint, typecheck, test, lint:forge, build, win32 dist, package, smoke', () => {
    const order = ["'lint'", "'typecheck:all'", "'test'", "'lint:forge'", "'build'", "'win32 bundle + dist'", "'package'", "'smoke install'"].map((name) =>
      script.indexOf(`[${name},`) >= 0 ? script.indexOf(`[${name},`) : script.indexOf(`    ${name},`),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('packages for win32-x64 after check-dist --target win32-x64', () => {
    expect(script).toContain("run('pnpm', ['run', 'lint:dist:win32'])");
    expect(script).toContain("'--target', 'win32-x64'");
  });

  it('smoke-installs through the e2e kit: Restricted Mode, install, first message, on the stub', () => {
    expect(script).toMatch(/launch\.mjs'\), '--code', code, '--vsix', VSIX, '--stub', '--only', '15,1,2'/);
  });

  it('reports the smoke as not run, and fails, when it cannot run', () => {
    expect(script).toMatch(/if \(!IS_WIN\) return \{ ok: false, detail: 'not run: the win32-x64 VSIX installs only on Windows' \}/);
    expect(script).toMatch(/if \(!code\) return \{ ok: false, detail: 'not run: no VS Code found/);
    expect(script).toContain("process.exit(failed ? 1 : 0)");
  });
});
