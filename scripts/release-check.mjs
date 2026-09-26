#!/usr/bin/env node
/**
 * `pnpm run release:check`: everything a release has to pass, in order,
 * stopping at the first failure.
 *
 *   1. lint                     eslint, warnings capped
 *   2. typecheck:all            extension host + webview
 *   3. test                     vitest
 *   4. lint:forge               brand, tokens, command registry
 *   5. build                    lint + lint:forge + both bundles (host platform)
 *   6. universal bundle + dist  fetch:native, build:extension:universal, then
 *                               check-dist --universal (a claude binary per
 *                               target, ripgrep per target, the plugin, the manifest)
 *   7. package                  vsce package, one VSIX for Windows x64 and
 *                               Linux x64 (what `pnpm run package` runs once its
 *                               own verify has passed, which steps 1-4 already are).
 *                               vsce runs `vscode:prepublish` first, which builds
 *                               the webview and the universal bundle again and
 *                               re-checks dist, so the package never depends on
 *                               what step 6 left behind
 *   8. smoke install            the VSIX into an isolated VS Code, then the e2e
 *                               scenarios 15 (Restricted Mode), 1 (install) and 2
 *                               (first message) against the stub gateway
 *
 * Options: --code <Code.exe|code> (desktop VS Code; on Windows the per-user or
 * system install is found by itself), --code-server <bin> (Linux; also
 * FORGE_CODE_SERVER, or ~/cs/node_modules/.bin/code-server as the e2e README
 * installs it), --skip-smoke (steps 1-7 only; the result then says the smoke
 * was not run).
 *
 * A smoke install that cannot run (no VS Code or code-server found) is
 * reported as not run and the check fails, rather than claiming a smoke test
 * that did not happen.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

function findCode() {
  const explicit = opt('--code');
  if (explicit) return explicit;
  if (!IS_WIN) return undefined;
  return [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft VS Code', 'Code.exe'),
  ].find((candidate) => candidate && fs.existsSync(candidate));
}

/** code-server, the headless stand-in on Linux (the e2e README installs it under ~/cs). */
function findCodeServer() {
  const explicit = opt('--code-server') ?? process.env.FORGE_CODE_SERVER;
  if (explicit) return explicit;
  if (IS_WIN) return undefined;
  const usual = path.join(os.homedir(), 'cs', 'node_modules', '.bin', 'code-server');
  return fs.existsSync(usual) ? usual : undefined;
}

const run = (command, commandArgs) => () => {
  const result = spawnSync(command, commandArgs, { cwd: ROOT, stdio: 'inherit', shell: IS_WIN });
  return result.status === 0 ? { ok: true } : { ok: false, detail: `exit ${result.status ?? result.signal}` };
};

const VSIX = path.join(ROOT, 'forge.vsix');

const steps = [
  ['lint', 'pnpm run lint', run('pnpm', ['run', 'lint'])],
  ['typecheck:all', 'pnpm run typecheck:all', run('pnpm', ['run', 'typecheck:all'])],
  ['test', 'pnpm test', run('pnpm', ['test'])],
  ['lint:forge', 'pnpm run lint:forge', run('pnpm', ['run', 'lint:forge'])],
  ['build', 'pnpm run build', run('pnpm', ['run', 'build'])],
  [
    'universal bundle + dist',
    'pnpm run fetch:native && pnpm run build:extension:universal && pnpm run lint:dist:universal',
    () => {
      for (const script of ['fetch:native', 'build:extension:universal', 'lint:dist:universal']) {
        const step = run('pnpm', ['run', script])();
        if (!step.ok) return step;
      }
      return { ok: true };
    },
  ],
  ['package', 'vsce package (one VSIX: win32-x64 + linux-x64)', run('npx', ['vsce', 'package', '--no-dependencies', '-o', VSIX])],
  [
    'smoke install',
    'e2e scenarios 15, 1, 2',
    () => {
      if (args.includes('--skip-smoke')) return { ok: false, skipped: true, detail: 'not run (--skip-smoke)' };
      const code = findCode();
      const codeServer = code ? undefined : findCodeServer();
      if (!code && !codeServer) {
        return { ok: false, detail: `not run: no VS Code found (pass ${IS_WIN ? '--code <Code.exe>' : '--code <code> or --code-server <bin>'})` };
      }
      const host = code ? ['--code', code] : ['--code-server', codeServer];
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-release-smoke-'));
      const smoke = spawnSync(
        process.execPath,
        [path.join(ROOT, '.claude/skills/ui-parity/e2e/launch.mjs'), ...host, '--vsix', VSIX, '--stub', '--only', '15,1,2', '--root', root],
        { cwd: ROOT, stdio: 'inherit' },
      );
      return smoke.status === 0 ? { ok: true, detail: `report: ${path.join(root, 'report', 'report.md')}` } : { ok: false, detail: `see ${path.join(root, 'report', 'report.md')}` };
    },
  ],
];

const results = [];
let failed = false;
for (const [name, command, step] of steps) {
  if (failed) {
    results.push({ name, command, verdict: 'not run', seconds: 0 });
    continue;
  }
  console.log(`\n=== ${name}: ${command}`);
  const started = Date.now();
  const outcome = step();
  const seconds = Math.round((Date.now() - started) / 1000);
  results.push({ name, command, verdict: outcome.ok ? 'pass' : outcome.skipped ? 'skipped' : 'FAIL', detail: outcome.detail, seconds });
  if (!outcome.ok) failed = true;
}

console.log('\n| # | Step | Command | Result | Time |');
console.log('| --- | --- | --- | --- | --- |');
results.forEach((r, i) => console.log(`| ${i + 1} | ${r.name} | \`${r.command}\` | ${r.verdict}${r.detail ? ` (${r.detail})` : ''} | ${r.seconds}s |`));
console.log(failed ? '\nrelease:check FAILED' : '\nrelease:check passed');
process.exit(failed ? 1 : 0);
