/**
 * Fail if `dist/` cannot have come from the sources that are on disk.
 *
 * This exists because of a real shipped bug. `pnpm run package` used to lean on
 * a `prepackage` hook to build first; pnpm no longer runs pre/post hooks for
 * arbitrary scripts, so `package` went straight to `vsce package` and shipped
 * whatever happened to be in `dist/`. The VSIX that came out held a webview
 * bundle built minutes earlier and an extension host bundle seven hours older.
 * The new webview sent `open_settings`; the old host had no case for it and
 * threw `Unknown request type`; every "/" menu row did nothing at all.
 *
 * Both halves of the extension are checked, because it is the *skew* between
 * them that is dangerous -- a host and a webview that disagree about the
 * protocol fail silently, where a missing bundle fails loudly.
 *
 * Usage: node scripts/check-dist.mjs
 */
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The two bundles a VSIX cannot work without. */
const BUNDLES = [
  { path: 'dist/extension.cjs', built_by: 'pnpm run build:extension' },
  { path: 'dist/media/main.js', built_by: 'pnpm run build:webview' },
];

/** Source trees either bundle is built from, plus the manifest vsce reads. */
const SOURCES = ['src', 'package.json'];

/** Newest mtime under a file or directory, ignoring nothing -- this is a guard. */
function newest(path, acc = { at: 0, file: '' }) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return acc;
  }
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) newest(join(path, entry), acc);
    return acc;
  }
  if (stat.mtimeMs > acc.at) {
    acc.at = stat.mtimeMs;
    acc.file = relative(ROOT, path);
  }
  return acc;
}

const source = SOURCES.reduce((acc, rel) => newest(join(ROOT, rel), acc), { at: 0, file: '' });
const problems = [];

for (const bundle of BUNDLES) {
  let stat;
  try {
    stat = statSync(join(ROOT, bundle.path));
  } catch {
    problems.push(`${bundle.path} is missing — run \`${bundle.built_by}\`.`);
    continue;
  }
  if (stat.mtimeMs < source.at) {
    const behind = Math.round((source.at - stat.mtimeMs) / 60000);
    problems.push(
      `${bundle.path} is ${behind} minute(s) older than ${source.file} — run \`${bundle.built_by}\`.`,
    );
  }
}

if (problems.length) {
  console.error('check-dist: dist/ is stale, so a package built now would ship mismatched halves:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('check-dist: dist/extension.cjs and dist/media/main.js are both newer than src/.');
