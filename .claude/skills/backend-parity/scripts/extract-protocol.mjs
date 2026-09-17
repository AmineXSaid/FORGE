#!/usr/bin/env node
/**
 * Print the real protocol for a webview→host request, or the real SDK typing
 * for a symbol, so wiring is copied from source instead of recalled.
 *
 * Usage:
 *   node extract-protocol.mjs <request_type> [--ref <dir>] [--ctx 600]
 *   node extract-protocol.mjs --sdk <symbol> [--sdk-dir <dir>]
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i === -1 ? fallback : args[i + 1];
};

// Walk up from the skill to find a directory that has `name` next to it. This
// works from the main checkout and from .claude/worktrees/<name>.
function findUp(name) {
  let dir = resolve(HERE, '..', '..', '..', '..');
  for (let i = 0; i < 6; i++) {
    for (const base of [dir, dirname(dir)]) {
      const candidate = join(base, name);
      if (existsSync(candidate)) return candidate;
    }
    dir = dirname(dir);
  }
  return null;
}

function excerpts(text, needle, ctx, label) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at === -1) break;
    const start = Math.max(0, at - Math.floor(ctx / 3));
    const end = Math.min(text.length, at + ctx);
    out.push(`--- ${label} @${at} ---\n${text.slice(start, end)}\n`);
    from = at + needle.length;
  }
  return out;
}

if (args.includes('--sdk')) {
  const symbol = argOf('--sdk');
  const sdkDir = argOf('--sdk-dir', findUp(join('node_modules', '@anthropic-ai', 'claude-agent-sdk')));
  if (!symbol || !sdkDir) {
    console.error('usage: --sdk <symbol> [--sdk-dir <dir>] (SDK not found)');
    process.exit(2);
  }
  const pkg = JSON.parse(readFileSync(join(sdkDir, 'package.json'), 'utf8'));
  console.log(`SDK ${pkg.name}@${pkg.version} at ${sdkDir}\n`);
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) { if (f !== 'vendor' && f !== 'node_modules') walk(p); }
      else if (p.endsWith('.d.ts')) files.push(p);
    }
  };
  walk(sdkDir);
  let hits = 0;
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.includes(symbol)) {
        hits++;
        const ctx = lines.slice(Math.max(0, i - 3), i + 6).map((l, k) => `${Math.max(0, i - 3) + k + 1}: ${l}`).join('\n');
        console.log(`--- ${file.slice(sdkDir.length + 1)}:${i + 1} ---\n${ctx}\n`);
      }
    });
  }
  if (!hits) console.log(`NOT FOUND: "${symbol}" does not exist in this SDK's typings. Do not use it.`);
  process.exit(0);
}

const type = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--ref' && args[args.indexOf(a) - 1] !== '--ctx');
if (!type) {
  console.error('usage: extract-protocol.mjs <request_type> [--ref <dir>] [--ctx 600]');
  process.exit(2);
}
const ref = argOf('--ref', findUp('Real_Claude_Code_VSCODE_extension_files'));
const ctx = Number(argOf('--ctx', 600));
if (!ref) {
  console.error('reference extension not found; pass --ref <dir>');
  process.exit(2);
}

const webview = readFileSync(join(ref, 'webview', 'index.js'), 'utf8');
const host = readFileSync(join(ref, 'extension.js'), 'utf8');

const senders = excerpts(webview, `type:"${type}"`, ctx, 'SENDER webview/index.js');
const handlers = excerpts(host, `case"${type}"`, ctx, 'HANDLER extension.js');

console.log(`request "${type}" -- ${senders.length} sender site(s), ${handlers.length} handler(s)\n`);
senders.forEach((s) => console.log(s));
handlers.forEach((h) => console.log(h));
if (!senders.length && !handlers.length) {
  console.log(`NOT FOUND: "${type}" is not an official request type. Do not invent it.`);
}
