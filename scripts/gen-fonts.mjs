#!/usr/bin/env node
/**
 * Convert the Anthropic Sans OTF release into the woff2 faces Forge bundles.
 *
 * Forge ships its own typeface rather than inheriting the host's, so the same
 * build renders identically everywhere (see src/webview/src/styles/forge-fonts.css).
 * The upstream release is static OTF; woff2 is ~60% smaller and is what the
 * webview loads, so the OTFs are converted once and the results are committed.
 *
 * Only the faces the UI actually asks for are converted. The official Claude
 * Code webview uses font-weight 400/500/600/700 (plus one 510 and one 590,
 * which round into 500/600) and italic, so that is the set below -- adding the
 * Light/Extrabold cuts would be dead payload in the .vsix.
 *
 * Usage: node scripts/gen-fonts.mjs --src "<dir containing AnthropicSans-*.otf>"
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import woff2 from 'wawoff2';

const args = process.argv.slice(2);
const srcIdx = args.indexOf('--src');
const SRC = srcIdx === -1 ? null : args[srcIdx + 1];
const OUT = 'src/webview/src/assets/fonts';

// [upstream OTF, bundled woff2, css weight, css style]
const FACES = [
  ['AnthropicSans-Text-Regular-Static.otf',      'AnthropicSans-Regular.woff2',    400, 'normal'],
  ['AnthropicSans-Text-RegularItalic-Static.otf','AnthropicSans-Italic.woff2',     400, 'italic'],
  ['AnthropicSans-Text-Medium-Static.otf',       'AnthropicSans-Medium.woff2',     500, 'normal'],
  ['AnthropicSans-Text-MediumItalic-Static.otf', 'AnthropicSans-MediumItalic.woff2',500,'italic'],
  ['AnthropicSans-Text-Semibold-Static.otf',     'AnthropicSans-Semibold.woff2',   600, 'normal'],
  ['AnthropicSans-Text-Bold-Static.otf',         'AnthropicSans-Bold.woff2',       700, 'normal'],
  ['AnthropicSans-Text-BoldItalic-Static.otf',   'AnthropicSans-BoldItalic.woff2', 700, 'italic'],
];

if (!SRC || !existsSync(SRC)) {
  console.error('gen-fonts: pass --src <dir with the AnthropicSans OTFs>');
  process.exit(1);
}

let total = 0;
for (const [from, to] of FACES) {
  const otf = await readFile(join(SRC, from));
  const out = Buffer.from(await woff2.compress(otf));
  await writeFile(join(OUT, to), out);
  total += out.length;
  console.log(`${to.padEnd(34)} ${(otf.length / 1024).toFixed(1)}KB otf -> ${(out.length / 1024).toFixed(1)}KB woff2`);
}
console.log(`gen-fonts: ${FACES.length} faces, ${(total / 1024).toFixed(1)}KB total -> ${OUT}`);
