#!/usr/bin/env node
/**
 * Generates the packaged Forge marks from the one source of brand geometry.
 *
 * The mark is "F + cube": a voxel F on a six-module grid, stem and top bar only,
 * with the finished Forge cube seated in the crossbar niche. Geometry is read
 * straight out of src/webview/src/components/forge/marks.ts, which the webview's
 * ForgeMark and ForgeWordmark also draw from, so the packaged icons can never
 * drift from the UI.
 *
 * VS Code draws its surfaces two ways, so there are two SVG cuts:
 *   resources/forge-logo.svg        24px, currentColor, the cube's faces told
 *                                   apart by opacity. For `viewsContainers`:
 *                                   VS Code masks those to the theme colour, so
 *                                   a baked fill would be thrown away.
 *   resources/forge-logo-brand.svg  24px, colours baked in. For command icons,
 *                                   the editor tab, the terminal tab and <img>:
 *                                   those are drawn as images, where
 *                                   currentColor resolves to black and vanishes
 *                                   on a dark theme.
 *   resources/forge-logo.png        256x256 Marketplace / extension icon, colours
 *                                   baked in, transparent background.
 *
 * The F lands on whole pixels at every native size; the cube is antialiased.
 *
 * Usage: node scripts/gen-forge-marks.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src', 'webview', 'src', 'components', 'forge', 'marks.ts');
const RES = join(ROOT, 'resources');

// ---------------------------------------------------------------- colours ---
// The same Pajamas stops the webview's --forge-mark-* tokens name, read from the
// generated palette so recolouring the brand in one place moves every icon.
const palette = readFileSync(join(ROOT, 'src', 'webview', 'src', 'styles', 'forge-pajamas.css'), 'utf8');
const primitive = (name) => {
  const hex = palette.match(new RegExp(`--pajamas-${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  if (!hex) throw new Error(`--pajamas-${name} is missing from forge-pajamas.css`);
  return hex.toLowerCase();
};
const tokens = readFileSync(join(ROOT, 'src', 'webview', 'src', 'styles', 'forge-tokens.css'), 'utf8');
const tokenStop = (token) => {
  const name = tokens.match(new RegExp(`${token}:\\s*var\\(--pajamas-([a-z0-9-]+)\\)`))?.[1];
  if (!name) throw new Error(`${token} is missing from forge-tokens.css`);
  return primitive(name);
};
const COLOUR = {
  f: tokenStop('--forge-mark-f'),
  top: tokenStop('--forge-mark-cube-top'),
  lit: tokenStop('--forge-mark-cube-lit'),
  shade: tokenStop('--forge-mark-cube-shade'),
};
const INKS = ['top', 'lit', 'shade'];

// ---------------------------------------------------------------- geometry ---
const source = readFileSync(SRC, 'utf8');
const MODULES = Number(source.match(/export const F_MODULES\s*=\s*([\d.]+)/)?.[1]);
const solidBlock = source.match(/export const F_SOLID[^=]*=\s*\[([\s\S]*?)\];/)?.[1];
const cubeBlock = source.match(/export const F_CUBE\b[^=]*=\s*\{([\s\S]*?)\};/)?.[1];
const flatBlock = source.match(/export const F_CUBE_FLAT\b[^=]*=\s*\{([^}]*)\}/)?.[1];
if (!MODULES || !solidBlock || !cubeBlock || !flatBlock) throw new Error('Could not read the mark geometry from marks.ts');
const SOLID = [...solidBlock.matchAll(/\[\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\s*\]/g)].map((m) => m.slice(1, 5).map(Number));
const CUBE = Object.fromEntries(
  INKS.map((ink) => {
    const face = cubeBlock.match(new RegExp(`${ink}:\\s*\\[([^;]*?)\\]\\s*,?\\s*\\n`))?.[1] ?? '';
    return [ink, [...face.matchAll(/\[\s*([\d.]+),\s*([\d.]+)\s*\]/g)].map((m) => [Number(m[1]), Number(m[2])])];
  }),
);
const FLAT = Object.fromEntries(INKS.map((ink) => [ink, Number(flatBlock.match(new RegExp(`${ink}:\\s*([\\d.]+)`))?.[1])]));
if (SOLID.length === 0 || INKS.some((ink) => CUBE[ink].length !== 4 || !(FLAT[ink] > 0))) {
  throw new Error('marks.ts mark geometry is incomplete');
}

// --------------------------------------------------------------------- SVG ---
const SIZE = 24;
const UNIT = 3; // 6 modules x 3px = 18px, centred in 24
const OFFSET = (SIZE - MODULES * UNIT) / 2;
const num = (n) => Number(n.toFixed(3));
const svg = (paint) => {
  const rects = SOLID.map(([x, y, w, h]) =>
    `    <rect x="${OFFSET + x * UNIT}" y="${OFFSET + y * UNIT}" width="${w * UNIT}" height="${h * UNIT}"/>`,
  ).join('\n');
  const faces = INKS.map((ink) => {
    const d = 'M' + CUBE[ink].map(([x, y]) => `${num(OFFSET + x * UNIT)} ${num(OFFSET + y * UNIT)}`).join('L') + 'Z';
    return `  <path d="${d}" ${paint(ink)}/>`;
  }).join('\n');
  return (
    // No double hyphen inside the comment: SVG is XML and XML forbids one there,
    // which made every mark this script once wrote unparseable.
    `<!-- GENERATED by scripts/gen-forge-marks.mjs. Do not edit by hand. -->\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">\n` +
    `  <g ${paint('f')} shape-rendering="crispEdges">\n${rects}\n  </g>\n${faces}\n</svg>\n`
  );
};

writeFileSync(join(RES, 'forge-logo.svg'), svg((ink) => `fill="currentColor"` + (ink === 'f' ? '' : ` opacity="${FLAT[ink]}"`)));
writeFileSync(join(RES, 'forge-logo-brand.svg'), svg((ink) => `fill="${COLOUR[ink]}"`));

// --------------------------------------------------------------------- PNG ---
const PX = 256;
const PNG_UNIT = 36; // 6 modules x 36px = 216px, leaving 20px of transparent margin
const PNG_OFFSET = (PX - MODULES * PNG_UNIT) / 2;
const SS = 4; // 4x4 samples per pixel for the cube's antialiasing
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Point-in-convex-polygon, for the cube faces, in module units. */
const inside = (poly, x, y) => {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cross !== 0) {
      if (sign === 0) sign = Math.sign(cross);
      else if (Math.sign(cross) !== sign) return false;
    }
  }
  return true;
};
const inkAt = (x, y) => {
  for (const ink of [...INKS].reverse()) if (inside(CUBE[ink], x, y)) return ink;
  for (const [rx, ry, w, h] of SOLID) if (x >= rx && x < rx + w && y >= ry && y < ry + h) return 'f';
  return null;
};

const raw = Buffer.alloc(PX * (PX * 4 + 1));
for (let py = 0; py < PX; py++) {
  for (let px = 0; px < PX; px++) {
    // Premultiplied accumulation over the samples, so edges blend to transparent.
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const x = (px + (sx + 0.5) / SS - PNG_OFFSET) / PNG_UNIT;
        const y = (py + (sy + 0.5) / SS - PNG_OFFSET) / PNG_UNIT;
        const ink = inkAt(x, y);
        if (!ink) continue;
        const [cr, cg, cb] = rgb(COLOUR[ink]);
        r += cr; g += cg; b += cb; a += 1;
      }
    }
    const o = py * (PX * 4 + 1) + 1 + px * 4;
    if (a > 0) {
      raw[o] = Math.round(r / a);
      raw[o + 1] = Math.round(g / a);
      raw[o + 2] = Math.round(b / a);
      raw[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(PX, 0);
ihdr.writeUInt32BE(PX, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type: RGBA
writeFileSync(join(RES, 'forge-logo.png'), Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]));

console.log(
  `forge marks: F + cube -> forge-logo.svg (${SIZE}px, currentColor), ` +
  `forge-logo-brand.svg (${SIZE}px, ${COLOUR.f}), forge-logo.png (${PX}x${PX})`,
);
