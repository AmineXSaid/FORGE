/**
 * The Agent SDK must survive being bundled to CJS.
 *
 * Reported from a real install as three unrelated-looking failures, all in one
 * log: every `query()` died on `Cannot read properties of undefined (reading
 * 'propagation')`, the session list died on `hs is not a function`, and
 * `list_sessions` died on `The argument 'filename' must be a file URL object,
 * file URL string, or absolute path string. Received undefined`.
 *
 * One cause. `import.meta.url` has no meaning in CommonJS, so esbuild emits
 * `undefined` for it -- and the SDK is ESM that calls
 * `createRequire(import.meta.url)` while its module body runs. That throws,
 * which aborts the rest of that module's initialisation, which is where the
 * OpenTelemetry namespace the SDK vendors is bound. `$X.propagation.inject(...)`
 * then reads `propagation` off `undefined` on every single query.
 *
 * Nothing in the rest of the suite could catch it: vitest imports the SDK from
 * `node_modules` as ESM, where `import.meta.url` is real and everything works.
 * The defect exists only in the bundle the user actually installs. So this spec
 * builds one, the same way `esbuild.ts` does, and runs it.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Inside the project, because the fixture has to resolve the SDK the same way
 * `src/extension.ts` does.
 */
const TMP = join(ROOT, '.bundle-probe');

/** The banner and define `esbuild.ts` applies. Kept here so the spec can build without it too. */
const BANNER = 'const __forgeImportMetaUrl = require("url").pathToFileURL(__filename).href;';
const DEFINE = { 'import.meta.url': '__forgeImportMetaUrl' };

/**
 * Importing the SDK is enough. The `createRequire` call is at module scope, so
 * the bundle fails while loading -- no CLI binary and no `query()` needed.
 */
const FIXTURE = "import '@anthropic-ai/claude-agent-sdk';\nconsole.log('LOADED_OK');\n";

function buildAndRun(withDefine: boolean): { ok: boolean; output: string } {
  mkdirSync(TMP, { recursive: true });
  const entry = join(TMP, 'entry.mjs');
  const outfile = join(TMP, withDefine ? 'with-define.cjs' : 'without-define.cjs');
  writeFileSync(entry, FIXTURE);

  esbuild.buildSync({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['vscode'],
    logLevel: 'silent',
    ...(withDefine ? { banner: { js: BANNER }, define: DEFINE } : {}),
  });

  try {
    const stdout = execFileSync(process.execPath, [outfile], { encoding: 'utf8', stdio: 'pipe' });
    return { ok: stdout.includes('LOADED_OK'), output: stdout };
  } catch (error: any) {
    return { ok: false, output: String(error?.stderr ?? error?.message ?? error) };
  }
}

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('the SDK in a CJS bundle', () => {
  it('fails to load without an `import.meta.url` define', () => {
    // The guard rail is only meaningful if the thing it guards against is real.
    // This is the user's third error message, reproduced from a clean build.
    const { ok, output } = buildAndRun(false);

    expect(ok).toBe(false);
    expect(output).toContain('must be a file URL object');
  }, 60_000);

  it('loads when `import.meta.url` is defined', () => {
    const { ok, output } = buildAndRun(true);

    expect(ok, `bundle did not load: ${output}`).toBe(true);
  }, 60_000);
});

describe('the real build config', () => {
  const config = readFileSync(join(ROOT, 'esbuild.ts'), 'utf8');

  it('defines `import.meta.url` for the extension host bundle', () => {
    // If this is ever dropped, every `query()` breaks in the packaged
    // extension and nothing else in the suite will notice.
    expect(config).toContain("'import.meta.url'");
    expect(config).toContain('pathToFileURL(__filename)');
  });

  it('uses the same banner identifier the define refers to', () => {
    // A banner that declares one name and a define that substitutes another
    // produces a ReferenceError at load, which is worse than the bug above.
    const banner = /const (\w+) = require\("url"\)\.pathToFileURL/.exec(config)?.[1];
    expect(banner).toBeTruthy();
    expect(config).toContain(`'import.meta.url': '${banner}'`);
  });
});
