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
 * `--target win32-x64` (what `pnpm run package` passes) also checks what the
 * VSIX for that platform has to carry besides the two bundles, because each of
 * these has been missing or wrong in a VSIX before (production audit,
 * 2026-09-24):
 *   - the Claude Code binary for the target, and nothing else, in
 *     resources/native-binary/ (a Windows VSIX with no claude.exe cannot start
 *     a session; one with a Linux `claude` beside it carries 200 MB of dead weight);
 *   - Forge's own plugin (the Expert output style);
 *   - the bundled ripgrep, for file search;
 *   - the manifest fields and files vsce needs to run unattended.
 *
 * Usage: node scripts/check-dist.mjs [--target win32-x64] [--root <dir>]
 */
import { existsSync, openSync, readFileSync, readSync, closeSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// `--root <dir>` checks another tree (the spec's fixtures); the repository otherwise.
const rootIndex = process.argv.indexOf('--root');
const ROOT = rootIndex >= 0 ? process.argv[rootIndex + 1] : join(dirname(fileURLToPath(import.meta.url)), '..');

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

// ---------------------------------------------------------------- contents ---

const targetIndex = process.argv.indexOf('--target');
const target = targetIndex >= 0 ? process.argv[targetIndex + 1] : undefined;
const contents = [];
const at = (rel) => join(ROOT, rel);

/** The first bytes of a file, to tell a Windows executable (`MZ`) from anything else. */
function head(file, length = 2) {
  const fd = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, 0);
    return buffer.toString('latin1');
  } finally {
    closeSync(fd);
  }
}

// Forge's plugin: every launch loads it (`FORGE_PLUGIN_DIR`), and the mode
// menu's Expert row is its output style.
const pluginManifest = at('resources/forge-plugin/.claude-plugin/plugin.json');
if (!existsSync(pluginManifest)) {
  contents.push('resources/forge-plugin/.claude-plugin/plugin.json is missing.');
} else {
  try {
    const plugin = JSON.parse(readFileSync(pluginManifest, 'utf8'));
    if (!plugin.name) contents.push('resources/forge-plugin/.claude-plugin/plugin.json has no "name".');
  } catch (error) {
    contents.push(`resources/forge-plugin/.claude-plugin/plugin.json does not parse: ${error.message}`);
  }
}
if (!existsSync(at('resources/forge-plugin/output-styles/expert.md'))) {
  contents.push('resources/forge-plugin/output-styles/expert.md is missing (the Expert output style).');
}

if (target) {
  if (target !== 'win32-x64') {
    contents.push(`Forge ships for win32-x64 only; --target ${target} is not a release target.`);
  } else {
    const binaryDir = at('resources/native-binary');
    const binary = join(binaryDir, 'claude.exe');
    if (!existsSync(binary)) {
      contents.push('resources/native-binary/claude.exe is missing — run the build with --target win32-x64 on Windows.');
    } else {
      if (head(binary) !== 'MZ') contents.push('resources/native-binary/claude.exe is not a Windows executable.');
      if (statSync(binary).size < 10 * 1024 * 1024) contents.push('resources/native-binary/claude.exe is under 10 MB; it is not the Claude Code binary.');
    }
    const extra = existsSync(binaryDir) ? readdirSync(binaryDir).filter((name) => name !== 'claude.exe') : [];
    if (extra.length) contents.push(`resources/native-binary/ holds more than claude.exe: ${extra.join(', ')}`);

    const rg = at('resources/ripgrep/x64-win32/rg.exe');
    if (!existsSync(rg)) contents.push('resources/ripgrep/x64-win32/rg.exe is missing (file search).');
    else if (head(rg) !== 'MZ') contents.push('resources/ripgrep/x64-win32/rg.exe is not a Windows executable.');
    if (!existsSync(at('resources/ripgrep/COPYING'))) contents.push("resources/ripgrep/COPYING is missing (ripgrep's licence).");
  }

  const manifest = JSON.parse(readFileSync(at('package.json'), 'utf8'));
  if (!manifest.repository?.url) contents.push('package.json has no repository.url, so vsce stops to ask.');
  if (!existsSync(at('CHANGELOG.md'))) contents.push('CHANGELOG.md is missing.');
  const ignore = existsSync(at('.vscodeignore')) ? readFileSync(at('.vscodeignore'), 'utf8').split(/\r?\n/) : [];
  if (!ignore.includes('resources/claude-code/**')) {
    contents.push('.vscodeignore does not exclude resources/claude-code/** (an unused CLI copy, 68 MB).');
  }
}

if (contents.length) {
  console.error(`check-dist: the package${target ? ` for ${target}` : ''} would be incomplete:`);
  for (const problem of contents) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  target
    ? `check-dist: ${target} contents are complete (claude.exe, ripgrep, forge-plugin, manifest).`
    : 'check-dist: forge-plugin is complete (pass --target win32-x64 to check a release package).',
);
