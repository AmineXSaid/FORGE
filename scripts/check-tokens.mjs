#!/usr/bin/env node
/**
 * Verify every design token a stylesheet consumes is actually defined.
 *
 * An undefined custom property does not error -- the declaration is simply
 * dropped, so a missing token shows up as a component that is subtly wrong
 * (no background, no min-height) rather than as a build failure. Porting the
 * official UI pulls in its token vocabulary wholesale, which makes this easy to
 * get wrong and hard to notice.
 *
 * `--vscode-*` is excluded: those come from the host at runtime, and using one
 * without a fallback is a separate (deliberate) choice.
 *
 * Usage: node scripts/check-tokens.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src', 'webview', 'src');
const EXT = ['.css', '.vue'];

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (EXT.some((e) => entry.endsWith(e))) acc.push(full);
  }
  return acc;
}

const files = walk(SRC);
const defined = new Set();
const used = new Map(); // token -> first "file:line" that uses it

for (const file of files) {
  const rel = relative(ROOT, file).split(sep).join('/');
  const text = readFileSync(file, 'utf8');

  // Definitions: `--token:` at the start of a declaration.
  for (const m of text.matchAll(/(?:^|[;{\s])(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(m[1]);

  // Uses: var(--token ...). A use with a fallback still counts as a use, but a
  // fallback means a missing definition degrades rather than breaks, so those
  // are tolerated.
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*(,)?/g)) {
      const [, token, hasFallback] = m;
      if (token.startsWith('--vscode-')) continue;
      // reka-ui measures its trigger and injects these on the popper at runtime.
      if (token.startsWith('--reka-')) continue;
      if (hasFallback) continue;
      if (!used.has(token)) used.set(token, `${rel}:${i + 1}`);
    }
  });
}

const missing = [...used].filter(([token]) => !defined.has(token));

if (missing.length) {
  console.error(`\nForge token check: ${missing.length} undefined token(s)\n`);
  for (const [token, where] of missing) {
    console.error(`  ${token}`);
    console.error(`    first used at ${where}`);
  }
  console.error('\nAn undefined custom property is dropped silently, so the rule using it');
  console.error('just does nothing. Define it in src/webview/src/styles/forge-tokens.css.\n');
  process.exit(1);
}

console.log(`Forge token check: clean (${used.size} tokens used, ${defined.size} defined)`);
