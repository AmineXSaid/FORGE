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
 * `--universal` (what `pnpm run package` passes) also checks what the one VSIX
 * for Windows x64 and Linux x64 has to carry besides the two bundles, because
 * each of these has been missing or wrong in a VSIX before (production audit,
 * 2026-09-24):
 *   - each release target's Claude Code binary, of the right kind (MZ, ELF),
 *     in resources/native-binaries/<target>/ and nothing else there, and the
 *     dev build's resources/native-binary/ kept out of the package;
 *   - Forge's own plugin (the Expert output style);
 *   - the bundled ripgrep for each target, for file search;
 *   - the manifest fields and files vsce needs to run unattended.
 *
 * Usage: node scripts/check-dist.mjs [--universal] [--root <dir>]
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
const legacyTarget = targetIndex >= 0 ? process.argv[targetIndex + 1] : undefined;
const universal = process.argv.includes('--universal');
const target = universal ? 'universal' : legacyTarget;
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

/** Must match `RELEASE_TARGETS` in src/services/claude/cliLaunch.ts (a spec checks it). */
const RELEASE_TARGETS = ['win32-x64', 'linux-x64'];
const MIN_BINARY = 10 * 1024 * 1024;
const isWindowsExe = (file) => head(file) === 'MZ';
const isElf = (file) => head(file, 4) === '\x7fELF';

if (legacyTarget && !universal) {
  contents.push(`Forge ships one VSIX for ${RELEASE_TARGETS.join(' and ')}; pass --universal, not --target ${legacyTarget}.`);
}

if (universal) {
  // Each release target's binary, in the official universal layout, and
  // nothing else there.
  const root = at('resources/native-binaries');
  for (const releaseTarget of RELEASE_TARGETS) {
    const name = releaseTarget.startsWith('win32-') ? 'claude.exe' : 'claude';
    const rel = `resources/native-binaries/${releaseTarget}/${name}`;
    const binary = at(rel);
    if (!existsSync(binary)) {
      contents.push(`${rel} is missing — run \`node scripts/fetch-native-binaries.mjs\`, then the build with --universal.`);
      continue;
    }
    const windows = releaseTarget.startsWith('win32-');
    if (windows && !isWindowsExe(binary)) contents.push(`${rel} is not a Windows executable.`);
    if (!windows && !isElf(binary)) contents.push(`${rel} is not a Linux executable.`);
    if (statSync(binary).size < MIN_BINARY) contents.push(`${rel} is under 10 MB; it is not the Claude Code binary.`);
    const extra = readdirSync(join(root, releaseTarget)).filter((entry) => entry !== name);
    if (extra.length) contents.push(`resources/native-binaries/${releaseTarget}/ holds more than ${name}: ${extra.join(', ')}`);
  }
  const strays = existsSync(root) ? readdirSync(root).filter((entry) => !RELEASE_TARGETS.includes(entry)) : [];
  if (strays.length) contents.push(`resources/native-binaries/ holds a target that is not released: ${strays.join(', ')}`);

  // ripgrep for each target, and its licence.
  const rgWin = at('resources/ripgrep/x64-win32/rg.exe');
  if (!existsSync(rgWin)) contents.push('resources/ripgrep/x64-win32/rg.exe is missing (file search on Windows).');
  else if (!isWindowsExe(rgWin)) contents.push('resources/ripgrep/x64-win32/rg.exe is not a Windows executable.');
  const rgLinux = at('resources/ripgrep/x64-linux/rg');
  if (!existsSync(rgLinux)) contents.push('resources/ripgrep/x64-linux/rg is missing (file search on Linux).');
  else if (!isElf(rgLinux)) contents.push('resources/ripgrep/x64-linux/rg is not a Linux executable.');
  if (!existsSync(at('resources/ripgrep/COPYING'))) contents.push("resources/ripgrep/COPYING is missing (ripgrep's licence).");

  const manifest = JSON.parse(readFileSync(at('package.json'), 'utf8'));
  if (!manifest.repository?.url) contents.push('package.json has no repository.url, so vsce stops to ask.');
  if (!existsSync(at('CHANGELOG.md'))) contents.push('CHANGELOG.md is missing.');
  const ignore = existsSync(at('.vscodeignore')) ? readFileSync(at('.vscodeignore'), 'utf8').split(/\r?\n/) : [];
  if (!ignore.includes('resources/claude-code/**')) {
    contents.push('.vscodeignore does not exclude resources/claude-code/** (an unused CLI copy, 68 MB).');
  }
  if (!ignore.includes('resources/native-binary/**')) {
    contents.push(".vscodeignore does not exclude resources/native-binary/** (a dev build's binary would ship beside the release ones).");
  }
}

if (contents.length) {
  console.error(`check-dist: the package${target ? ` for ${target}` : ''} would be incomplete:`);
  for (const problem of contents) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  universal
    ? `check-dist: the universal VSIX contents are complete (${RELEASE_TARGETS.join(', ')}: claude, ripgrep; forge-plugin; manifest).`
    : 'check-dist: forge-plugin is complete (pass --universal to check a release package).',
);
