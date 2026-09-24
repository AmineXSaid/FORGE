#!/usr/bin/env node
/**
 * `pnpm run release:check`: everything a release has to pass, in order,
 * stopping at the first failure.
 *
 *   1. lint                 eslint, warnings capped
 *   2. typecheck:all        extension host + webview
 *   3. test                 vitest
 *   4. lint:forge           brand, tokens, command registry
 *   5. build                lint + lint:forge + both bundles (host platform)
 *   6. win32 bundle + dist  build:extension:win32, then check-dist --target win32-x64
 *                           (claude.exe alone, ripgrep, the plugin, the manifest)
 *   7. package              vsce package --target win32-x64 (what `pnpm run
 *                           package` runs once its own verify has passed, which
 *                           steps 1-4 already are)
 *   8. smoke install        the VSIX into an isolated VS Code, then the e2e
 *                           scenarios 15 (Restricted Mode), 1 (install) and 2
 *                           (first message) against the stub gateway
 *
 * Options: --code <Code.exe> (default: the per-user or system install),
 * --skip-smoke (steps 1-7 only; the result then says the smoke was not run).
 *
 * The VSIX is Windows-only, so step 8 runs on Windows; elsewhere it is
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

const run = (command, commandArgs) => () => {
  const result = spawnSync(command, commandArgs, { cwd: ROOT, stdio: 'inherit', shell: IS_WIN });
  return result.status === 0 ? { ok: true } : { ok: false, detail: `exit ${result.status ?? result.signal}` };
};

const VSIX = path.join(ROOT, 'forge-win32-x64.vsix');

const steps = [
  ['lint', 'pnpm run lint', run('pnpm', ['run', 'lint'])],
  ['typecheck:all', 'pnpm run typecheck:all', run('pnpm', ['run', 'typecheck:all'])],
  ['test', 'pnpm test', run('pnpm', ['test'])],
  ['lint:forge', 'pnpm run lint:forge', run('pnpm', ['run', 'lint:forge'])],
  ['build', 'pnpm run build', run('pnpm', ['run', 'build'])],
  [
    'win32 bundle + dist',
    'pnpm run build:extension:win32 && pnpm run lint:dist:win32',
    () => {
      const bundle = run('pnpm', ['run', 'build:extension:win32'])();
      return bundle.ok ? run('pnpm', ['run', 'lint:dist:win32'])() : bundle;
    },
  ],
  ['package', 'vsce package --target win32-x64', run('npx', ['vsce', 'package', '--no-dependencies', '--target', 'win32-x64', '-o', VSIX])],
  [
    'smoke install',
    'e2e scenarios 15, 1, 2',
    () => {
      if (args.includes('--skip-smoke')) return { ok: false, skipped: true, detail: 'not run (--skip-smoke)' };
      if (!IS_WIN) return { ok: false, detail: 'not run: the win32-x64 VSIX installs only on Windows' };
      const code = findCode();
      if (!code) return { ok: false, detail: 'not run: no VS Code found (pass --code <Code.exe>)' };
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-release-smoke-'));
      const smoke = spawnSync(
        process.execPath,
        [path.join(ROOT, '.claude/skills/ui-parity/e2e/launch.mjs'), '--code', code, '--vsix', VSIX, '--stub', '--only', '15,1,2', '--root', root],
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
