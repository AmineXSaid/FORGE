/**
 * `pnpm run release:check` (production audit, Phase 5): every gate in the
 * order the plan gives, and a smoke install that is never claimed when it did
 * not run.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.join(__dirname, '..');
// LF whatever the checkout: git on Windows converts to CRLF, and the patterns below say \n.
const script = fs.readFileSync(path.join(ROOT, 'scripts/release-check.mjs'), 'utf8').replace(/\r\n/g, '\n');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

describe('release:check', () => {
  it('is the script in package.json', () => {
    expect(manifest.scripts['release:check']).toBe('node scripts/release-check.mjs');
  });

  it('runs the gates in the plan order: lint, typecheck, test, lint:forge, build, universal dist, package, smoke', () => {
    const order = ["'lint'", "'typecheck:all'", "'test'", "'lint:forge'", "'build'", "'universal bundle + dist'", "'package'", "'smoke install'"].map((name) =>
      script.indexOf(`[${name},`) >= 0 ? script.indexOf(`[${name},`) : script.indexOf(`    ${name},`),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('packages one VSIX for every target: fetch, universal build, check-dist --universal, then vsce without --target', () => {
    expect(script).toContain("['fetch:native', 'build:extension:universal', 'lint:dist:universal']");
    expect(script).toContain("run('npx', ['vsce', 'package', '--no-dependencies', '-o', VSIX])");
    expect(script).not.toContain("'--target'");
    expect(script).toContain("path.join(ROOT, 'forge.vsix')");
  });

  it('smoke-installs through the e2e kit on either platform: Restricted Mode, install, first message, on the stub', () => {
    expect(script).toMatch(/launch\.mjs'\), \.\.\.host, '--vsix', VSIX, '--stub', '--only', '15,1,2'/);
    expect(script).toContain("const host = code ? ['--code', code] : ['--code-server', codeServer];");
  });

  it('reports the smoke as not run, and fails, when no VS Code or code-server is found', () => {
    expect(script).toMatch(/if \(!code && !codeServer\) \{\n\s+return \{ ok: false, detail: `not run: no VS Code found/);
    expect(script).toContain("process.exit(failed ? 1 : 0)");
  });
});
