#!/usr/bin/env node
/**
 * Extract icon components from the real Claude Code webview bundle and emit them
 * as Vue SFCs.
 *
 * Icons in the official build are small components that return an inline <svg>.
 * The bundle is minified but the SVG attributes and path data survive intact, so
 * the geometry can be lifted exactly rather than approximated with a codicon that
 * merely looks similar.
 *
 * Usage:
 *   node extract-icons.mjs <path/to/webview/index.js> <out-dir> [name=fn ...]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [srcPath, outDir, ...pairs] = process.argv.slice(2);
if (!srcPath || !outDir || pairs.length === 0) {
  console.error('usage: extract-icons.mjs <index.js> <out-dir> Name=fnName ...');
  process.exit(1);
}

const src = readFileSync(srcPath, 'utf8');
mkdirSync(outDir, { recursive: true });

/**
 * Pull the balanced body of `function NAME(...)`.
 *
 * The opening brace has to be found *after* the parameter list closes: these
 * components destructure their props (`function cV0({className:$})`), so the
 * first `{` in the source belongs to the parameters, not the body.
 */
function functionBody(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) return null;

  // Walk the parameter list to its matching ')'.
  let i = src.indexOf('(', start);
  let parens = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') parens++;
    else if (src[i] === ')') {
      parens--;
      if (parens === 0) { i++; break; }
    }
  }

  const open = src.indexOf('{', i);
  if (open === -1) return null;

  let depth = 0;
  for (let j = open; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(open, j + 1);
    }
  }
  return null;
}

/**
 * Convert the minified element calls into SVG child markup.
 *
 * The bundle emits elements as F("tag",{props}) / R("tag",{props}), so each child
 * is recovered by reading the tag and its own attribute object. Only the drawing
 * primitives are kept; layout props like className are dropped because the Vue
 * wrapper supplies those.
 */
const DRAW_TAGS = ['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g'];
const KEEP = new Set([
  'd', 'fill', 'stroke', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin',
  'fillRule', 'clipRule', 'cx', 'cy', 'r', 'x', 'y', 'width', 'height',
  'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'points', 'opacity', 'transform',
]);
const KEBAB = {
  strokeWidth: 'stroke-width', strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin', fillRule: 'fill-rule', clipRule: 'clip-rule',
};

function toChildren(body) {
  const out = [];
  const call = /[FR]\("(\w+)",\{/g;
  let m;
  while ((m = call.exec(body)) !== null) {
    const tag = m[1];
    if (!DRAW_TAGS.includes(tag)) continue;
    // Read this element's own props object, balanced.
    let depth = 1;
    let i = call.lastIndex;
    for (; i < body.length && depth > 0; i++) {
      if (body[i] === '{') depth++;
      else if (body[i] === '}') depth--;
    }
    const props = body.slice(call.lastIndex, i - 1);

    const attrs = [];
    const attr = /(\w+):"([^"]*)"/g;
    let a;
    while ((a = attr.exec(props)) !== null) {
      if (!KEEP.has(a[1])) continue;
      attrs.push(`${KEBAB[a[1]] ?? a[1]}="${a[2]}"`);
    }
    if (attrs.length) out.push(`    <${tag} ${attrs.join(' ')} />`);
  }
  return out;
}

let written = 0;
for (const pair of pairs) {
  const [name, fn] = pair.split('=');
  const body = functionBody(fn);
  if (!body) {
    console.warn(`  ${name}: function ${fn} not found`);
    continue;
  }
  const viewBox = body.match(/viewBox:"([^"]+)"/)?.[1] ?? '0 0 20 20';
  const size = body.match(/width:"(\d+)"/)?.[1] ?? '20';
  const children = toChildren(body);
  if (!children.length) {
    console.warn(`  ${name}: no drawable children found in ${fn}`);
    continue;
  }

  writeFileSync(join(outDir, `${name}.vue`), `<template>
  <!--
    GENERATED from the real Claude Code webview (${fn}) by
    .claude/skills/ui-parity/scripts/extract-icons.mjs -- do not edit by hand.
    Lifted rather than approximated, so the glyph is the same shape as the one
    users know from the official extension.
  -->
  <svg
    width="${size}"
    height="${size}"
    viewBox="${viewBox}"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style="display: block"
    aria-hidden="true"
  >
${children.join('\n')}
  </svg>
</template>
`);
  console.log(`  ${name}.vue  <- ${fn}  (${children.length} shapes, viewBox ${viewBox})`);
  written++;
}
console.log(`extract-icons: wrote ${written} component(s) to ${outDir}`);
