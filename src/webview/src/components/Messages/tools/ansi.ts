/**
 * Terminal output with its colours kept.
 *
 * The official webview strips every escape sequence from shell output (`FS`).
 * Forge keeps the SGR ones -- colour, bold, dim, italic, underline -- and maps
 * each colour onto the nearest of the sixteen terminal colours, which Forge
 * draws from the Pajamas palette (see --forge-terminal-* in forge-tokens.css).
 * Every other escape sequence is still removed, and carriage-return overwrites
 * (progress bars) collapse to what a terminal would finally show.
 */

export const ANSI_COLOURS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'bright-black', 'bright-red', 'bright-green', 'bright-yellow', 'bright-blue', 'bright-magenta', 'bright-cyan', 'bright-white',
] as const;

export type AnsiColour = (typeof ANSI_COLOURS)[number];

export interface AnsiStyle {
  fg?: AnsiColour;
  bg?: AnsiColour;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

export interface AnsiSegment extends AnsiStyle {
  text: string;
}

/** xterm's default sixteen, used only to find the nearest colour for 256-colour and true-colour codes. */
const REFERENCE_RGB: [number, number, number][] = [
  [0, 0, 0], [205, 49, 49], [13, 188, 121], [229, 229, 16], [36, 114, 200], [188, 63, 188], [17, 168, 205], [229, 229, 229],
  [102, 102, 102], [241, 76, 76], [35, 209, 139], [245, 245, 67], [59, 142, 234], [214, 112, 214], [41, 184, 219], [255, 255, 255],
];

function nearest(r: number, g: number, b: number): AnsiColour {
  let best = 0;
  let bestDistance = Infinity;
  REFERENCE_RGB.forEach(([rr, gg, bb], index) => {
    const distance = (r - rr) ** 2 + (g - gg) ** 2 + (b - bb) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return ANSI_COLOURS[best];
}

/** A 256-colour index as the nearest of the sixteen. */
function fromPalette256(n: number): AnsiColour {
  if (n < 16) return ANSI_COLOURS[n];
  if (n >= 232) {
    const level = 8 + (n - 232) * 10;
    return nearest(level, level, level);
  }
  const cube = n - 16;
  const step = (v: number) => (v === 0 ? 0 : 55 + v * 40);
  return nearest(step(Math.floor(cube / 36)), step(Math.floor(cube / 6) % 6), step(cube % 6));
}

/** Any escape sequence other than SGR (`ESC [ ... m`): cursor moves, OSC titles, charset switches. */
const NON_SGR = new RegExp(
  // eslint-disable-next-line no-control-regex -- terminal escape sequences are control characters
  '(?:\\u001B\\[|\\u009B)[0-9:;<=>?]*[ -/]*[@-ln-~]|\\u001B\\][^\\u0007\\u001B]*(?:\\u0007|\\u001B\\\\)|\\u001B[()*+][0-~]|\\u001B[@-Z\\\\^_0-9=>c]',
  'g'
);
// eslint-disable-next-line no-control-regex -- ESC [ ... m, the colour sequence
const SGR = /(?:\[|)([0-9;:]*)m/g;

function applySgr(style: AnsiStyle, params: string): AnsiStyle {
  const codes = params === '' ? [0] : params.split(/[;:]/).map((p) => (p === '' ? 0 : Number(p)));
  const next: AnsiStyle = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code === 0) {
      for (const key of Object.keys(next) as (keyof AnsiStyle)[]) delete next[key];
    } else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 7) next.inverse = true;
    else if (code === 22) {
      delete next.bold;
      delete next.dim;
    } else if (code === 23) delete next.italic;
    else if (code === 24) delete next.underline;
    else if (code === 27) delete next.inverse;
    else if (code >= 30 && code <= 37) next.fg = ANSI_COLOURS[code - 30];
    else if (code >= 90 && code <= 97) next.fg = ANSI_COLOURS[code - 90 + 8];
    else if (code === 39) delete next.fg;
    else if (code >= 40 && code <= 47) next.bg = ANSI_COLOURS[code - 40];
    else if (code >= 100 && code <= 107) next.bg = ANSI_COLOURS[code - 100 + 8];
    else if (code === 49) delete next.bg;
    else if (code === 38 || code === 48) {
      const target = code === 38 ? 'fg' : 'bg';
      if (codes[i + 1] === 5 && codes[i + 2] !== undefined) {
        next[target] = fromPalette256(codes[i + 2]);
        i += 2;
      } else if (codes[i + 1] === 2 && codes[i + 4] !== undefined) {
        next[target] = nearest(codes[i + 2], codes[i + 3], codes[i + 4]);
        i += 4;
      }
    }
  }
  return next;
}

/** What a terminal finally shows on a line that was overwritten with carriage returns. */
function resolveCarriageReturns(line: string): string {
  const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
  const at = trimmed.lastIndexOf('\r');
  return at === -1 ? trimmed : trimmed.slice(at + 1);
}

/** Output split into lines of styled segments. */
export function parseAnsi(text: string): AnsiSegment[][] {
  const lines: AnsiSegment[][] = [];
  let style: AnsiStyle = {};

  for (const rawLine of text.replace(NON_SGR, '').split('\n')) {
    const line = resolveCarriageReturns(rawLine);
    const segments: AnsiSegment[] = [];
    let last = 0;
    for (const match of line.matchAll(SGR)) {
      const index = match.index ?? 0;
      if (index > last) segments.push({ ...style, text: line.slice(last, index) });
      style = applySgr(style, match[1]);
      last = index + match[0].length;
    }
    if (last < line.length) segments.push({ ...style, text: line.slice(last) });
    lines.push(segments);
  }
  return lines;
}

/** The plain text of parsed output, for copying and opening in an editor. */
export function ansiPlainText(text: string): string {
  return parseAnsi(text)
    .map((line) => line.map((s) => s.text).join(''))
    .join('\n');
}
