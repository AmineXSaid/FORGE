#!/usr/bin/env node
/**
 * Build the parity reference from the real Claude Code webview stylesheet.
 *
 * Groups the official CSS-module classes by their hash suffix (which identifies
 * the source component) and records each class's declarations, so a measurement
 * taken from Forge can be checked against what the official rule actually says
 * rather than against a memory of it.
 *
 * Usage: node extract-reference.mjs [--ref <path/to/webview/index.css>] [--out reference.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i === -1 ? fallback : args[i + 1];
};

const REF = argOf('--ref', join(HERE, '..', '..', '..', '..', '..',
  'Real_Claude_Code_VSCODE_extension_files', 'webview', 'index.css'));
const OUT = argOf('--out', join(HERE, '..', 'reference.json'));

let css;
try {
  css = readFileSync(REF, 'utf8');
} catch {
  console.error(`extract-reference: cannot read the reference stylesheet at\n  ${REF}\nPass --ref <path>.`);
  process.exit(1);
}

/** Split into top-level rules, skipping strings and comments. */
function parseRules(text) {
  const rules = [];
  let i = 0, depth = 0, selStart = 0, str = null, bodyStart = 0, selector = '';
  while (i < text.length) {
    const ch = text[i];
    if (str) { if (ch === str && text[i - 1] !== '\\') str = null; i++; continue; }
    if (ch === '"' || ch === "'") { str = ch; i++; continue; }
    if (ch === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e === -1 ? text.length : e + 2; continue; }
    if (ch === '{') { if (depth === 0) { bodyStart = i + 1; selector = text.slice(selStart, i).trim(); } depth++; i++; continue; }
    if (ch === '}') { depth--; if (depth === 0) { rules.push({ selector, body: text.slice(bodyStart, i) }); selStart = i + 1; } i++; continue; }
    if (ch === ';' && depth === 0) { selStart = i + 1; i++; continue; }
    i++;
  }
  return rules;
}

const modules = {};   // hash -> { class -> declarations }
const owners = {};    // bare class name -> Set of module hashes that define it

for (const rule of parseRules(css)) {
  const decls = {};
  for (const part of rule.body.split(';')) {
    const at = part.indexOf(':');
    if (at === -1) continue;
    const prop = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (prop && value) decls[prop] = value;
  }
  if (!Object.keys(decls).length) continue;

  for (const sel of rule.selector.split(',')) {
    const m = sel.trim().match(/^\.([A-Za-z][A-Za-z0-9]*)_([A-Za-z0-9_]{6})$/);
    if (!m) continue;
    const [, name, hash] = m;
    (modules[hash] ??= {})[name] = { ...(modules[hash][name] ?? {}), ...decls };
    (owners[name] ??= new Set()).add(hash);
  }
}

const moduleSizes = Object.fromEntries(
  Object.entries(modules).map(([h, m]) => [h, Object.keys(m).length])
);

// A flat class map is only safe for names that exactly one module defines.
// Several modules reuse names like `menuItemLabel` or `actions` with different
// rules, and merging those invents declarations that no real element has -- a
// false mismatch that costs more time than it saves.
const classes = {};
const ambiguous = {};
for (const [name, hashes] of Object.entries(owners)) {
  const list = [...hashes];
  if (list.length === 1) classes[name] = modules[list[0]][name];
  else ambiguous[name] = list;
}

writeFileSync(OUT, JSON.stringify({ source: REF, modules, classes, ambiguous, moduleSizes }, null, 1));
console.log(`extract-reference: ${Object.keys(modules).length} modules, ` +
  `${Object.keys(classes).length} unambiguous classes, ` +
  `${Object.keys(ambiguous).length} defined by more than one module -> ${OUT}`);
console.log('For an ambiguous name, look it up under `modules[<hash>]`, not `classes`.');
