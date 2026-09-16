#!/usr/bin/env node
/**
 * Forge brand guardrail.
 *
 * Every colour in Forge must resolve through a semantic --forge-* / --app-* token.
 * This script fails the build if a source file names a colour directly, so the
 * brand cannot drift one component at a time.
 *
 * It deliberately does NOT rely on stylelint alone: stylelint only parses <style>
 * blocks, and the two worst brand leaks in this codebase lived in Vue *templates*
 * (`fill="var(--app-claude-clay-button-orange)"`). This scans templates, TypeScript
 * and CSS alike, and needs no dependencies so it can run in a cold checkout.
 *
 * Usage:
 *   node scripts/check-brand.mjs            # fail on violations
 *   node scripts/check-brand.mjs --selftest # prove the guardrail actually bites
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['src'];
const SCAN_EXT = ['.vue', '.css', '.ts', '.tsx', '.html'];

/** Files permitted to name raw colours, and why. */
const ALLOW = {
  'src/webview/src/styles/forge-pajamas.css': {
    reason: 'generated Pajamas primitive palette -- the one place raw hex may live',
    rules: ['hex', 'rgb', 'named', 'pajamas'],
  },
  'src/webview/src/styles/forge-tokens.css': {
    reason: 'the semantic token layer -- maps primitives and host colours onto meaning',
    rules: ['rgb', 'pajamas', 'legacy-claude', 'charts', 'host-font'],
  },
  'src/webview/src/styles/forge-fonts.css': {
    reason: 'the font layer -- the one place a typeface may be named',
    rules: ['system-font', 'host-font'],
  },
};

/** Families that resolve to whatever the host machine has installed. */
const SYSTEM_FAMILIES = [
  'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Helvetica Neue',
  'Helvetica', 'Arial', 'Roboto', 'Oxygen', 'Cantarell', 'Noto Sans', 'sans-serif',
  'serif', 'monospace', 'cursive', 'fantasy', 'SF Mono', 'Monaco', 'Menlo',
  'Consolas', 'Courier New', 'Liberation Mono', 'DejaVu Sans Mono',
];

const RULES = [
  {
    id: 'hex',
    // A colour-shaped hex literal: 3/4/6/8 hex digits, in a value position.
    re: /(^|[\s:,(=])(#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4}))(?![0-9a-zA-Z_-])/g,
    pick: 2,
    msg: 'raw hex colour',
    fix: 'use a --forge-* token (add one to forge-tokens.css if none fits)',
  },
  {
    id: 'rgb',
    re: /\b(rgba?|hsla?)\s*\(/g,
    pick: 0,
    msg: 'raw colour function',
    fix: 'use a --forge-* token, or color-mix() over one',
  },
  {
    id: 'named',
    // Named CSS colours in a value position. `transparent`, `currentColor`,
    // `inherit` and `none` are structural, not brand, and stay allowed.
    re: /(?:^|[\s:,(])(?:white|black|red|green|blue|orange|purple|yellow|gray|grey|silver|maroon|olive|navy|teal|aqua|fuchsia|lime)(?=\s*[;,)}]|\s*$)/gim,
    pick: 0,
    msg: 'named CSS colour',
    fix: 'use a --forge-* token',
  },
  {
    id: 'legacy-claude',
    re: /--app-claude-[a-z-]+/g,
    pick: 0,
    msg: 'legacy Claude brand token',
    fix: 'use --forge-brand (these aliases exist only as a compatibility net)',
  },
  {
    id: 'charts',
    re: /--vscode-charts-[a-z]+/g,
    pick: 0,
    msg: 'VS Code chart colour',
    fix: 'use --app-chart-N, which is re-pointed onto the Forge palette',
  },
  {
    id: 'system-font',
    // Generic and platform families resolve to whatever the machine happens to
    // have, so the same build renders differently per environment.
    //
    // Expressed as a predicate rather than one large regex: it only looks at
    // actual font-family declarations (CSS or the SVG attribute), so a Vue prop
    // named `monospace` is not mistaken for a typeface.
    match: (line) => {
      const decl = /font-family\s*[:=]\s*([^;}]*)/gi;
      const hits = [];
      let d;
      while ((d = decl.exec(line)) !== null) {
        // A font-family value is a comma-separated list of family names, so
        // split it and compare whole names. Substring matching would flag
        // "Forge Mono" for containing "Mono".
        for (const raw of d[1].split(',')) {
          const family = raw.trim().replace(/^["']|["']$/g, '').toLowerCase();
          if (!family || family.startsWith('var(')) continue;
          const match = SYSTEM_FAMILIES.find((f) => f.toLowerCase() === family);
          if (match) hits.push(match);
        }
      }
      return hits;
    },
    msg: 'system or generic font family',
    fix: 'use var(--forge-font-sans) or var(--app-monospace-font-family); Forge bundles its own fonts so type never changes per machine',
  },
  {
    id: 'host-font',
    re: /--vscode-(?:editor-)?font-family|--vscode-chat-font-family/g,
    pick: 0,
    msg: 'host font family',
    fix: 'use var(--app-monospace-font-family) or var(--forge-font-sans); the host font is whatever that machine has installed',
  },
  {
    id: 'pajamas',
    re: /--pajamas-[a-z0-9-]+/g,
    pick: 0,
    msg: 'Pajamas primitive referenced outside the token layer',
    fix: 'primitives carry no meaning; use a semantic --forge-* token instead',
  },
];

/** Strip comments so documentation about the rules does not trip the rules. */
function stripComments(text, file) {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  if (!file.endsWith('.css')) {
    out = out.replace(/(^|[\s;{(])\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
    out = out.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  }
  return out;
}

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (SCAN_EXT.some((e) => entry.endsWith(e))) acc.push(full);
  }
  return acc;
}

function scan(files) {
  const violations = [];
  for (const file of files) {
    const rel = relative(ROOT, file).split(sep).join('/');
    const allowed = ALLOW[rel]?.rules ?? [];
    const source = stripComments(readFileSync(file, 'utf8'), file);
    const lines = source.split('\n');

    for (const rule of RULES) {
      if (allowed.includes(rule.id)) continue;

      if (rule.match) {
        lines.forEach((line, i) => {
          for (const token of rule.match(line)) {
            violations.push({ file: rel, line: i + 1, token, msg: rule.msg, fix: rule.fix });
          }
        });
        continue;
      }

      lines.forEach((line, i) => {
        rule.re.lastIndex = 0;
        let m;
        while ((m = rule.re.exec(line)) !== null) {
          violations.push({
            file: rel,
            line: i + 1,
            token: (m[rule.pick] ?? m[0]).trim(),
            msg: rule.msg,
            fix: rule.fix,
          });
          if (m[0] === '') rule.re.lastIndex++;
        }
      });
    }
  }
  return violations;
}

function report(violations) {
  if (!violations.length) return 0;
  console.error(`\nForge brand guardrail: ${violations.length} violation(s)\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.msg}: ${v.token}`);
    console.error(`    -> ${v.fix}\n`);
  }
  console.error('The brand is defined in one place: src/webview/src/styles/forge-tokens.css.');
  console.error('If you need a colour that does not exist yet, add a semantic token there.\n');
  return 1;
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));

if (process.argv.includes('--selftest')) {
  // Prove the guardrail bites: run the rules over deliberately off-brand source.
  const cases = [
    ['fake.vue', '.badge { color: #d97757; }', 'hex'],
    ['fake.vue', '.badge { color: var(--vscode-charts-orange); }', 'charts'],
    ['fake.vue', '<i fill="var(--app-claude-clay-button-orange)" />', 'legacy-claude'],
    ['fake.vue', '.badge { background: rgba(217, 119, 87, 0.2); }', 'rgb'],
    ['fake.vue', '.badge { color: orange; }', 'named'],
    ['fake.vue', '.badge { color: var(--pajamas-blue-500); }', 'pajamas'],
    ['fake.vue', '.code { font-family: monospace; }', 'system-font'],
    ['fake.vue', '.ui { font-family: system-ui, sans-serif; }', 'system-font'],
    ['fake.vue', '.code { font-family: var(--vscode-editor-font-family); }', 'host-font'],
  ];
  let failed = 0;
  for (const [name, src, expect] of cases) {
    const rule = RULES.find((r) => r.id === expect);
    const text = stripComments(src, name);
    let caught;
    if (rule.match) {
      caught = rule.match(text).length > 0;
    } else {
      rule.re.lastIndex = 0;
      caught = rule.re.test(text);
    }
    console.log(`  ${caught ? 'PASS' : 'FAIL'}  ${expect.padEnd(14)} ${src}`);
    if (!caught) failed++;
  }
  // And prove it does not cry wolf over legitimate on-brand source.
  const clean = [
    '.badge { color: var(--forge-tool-accent); }',
    '.badge { background: var(--forge-brand-subtle); border: 1px solid transparent; }',
    '<i fill="var(--forge-brand)" />',
    '.x { background: color-mix(in srgb, var(--forge-accent) 14%, transparent); }',
    '.code { font-family: var(--app-monospace-font-family); }',
    '.ui { font-family: var(--forge-font-sans); }',
  ];
  for (const src of clean) {
    const text = stripComments(src, 'fake.vue');
    const hits = RULES.filter((r) => {
      if (r.match) return r.match(text).length > 0;
      r.re.lastIndex = 0;
      return r.re.test(text);
    });
    const ok = hits.length === 0;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${'clean'.padEnd(14)} ${src}${ok ? '' : ' <- tripped ' + hits.map((h) => h.id)}`);
    if (!ok) failed++;
  }
  console.log(failed ? `\nselftest: ${failed} case(s) failed\n` : '\nselftest: guardrail catches every off-brand case and passes clean source\n');
  process.exit(failed ? 1 : 0);
}

const violations = scan(files);
const code = report(violations);
if (!code) console.log(`Forge brand guardrail: clean (${files.length} files scanned)`);
process.exit(code);
