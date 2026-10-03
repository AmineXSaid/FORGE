/**
 * Best-effort text out of a PDF, for endpoints that cannot take one.
 *
 * Anthropic reads an attached PDF natively; an OpenAI-shaped gateway has no
 * document block at all, and the translation used to drop the attachment
 * without a word. This pulls the text runs (`Tj`, `TJ`, `'`, `"`) out of the
 * page content streams -- inflated when they are Flate-compressed -- which is
 * enough for the PDFs most often attached (reports, exported docs). A PDF
 * whose text is drawn with custom-encoded fonts, or is scanned, yields little;
 * the caller then says so instead of passing on noise.
 *
 * No dependencies: `zlib` and a small tokenizer.
 */
import * as zlib from 'node:zlib';

/** Decode a PDF literal string's escapes: `\n`, `\(`, `\\`, octal `\ddd`. */
function decodeLiteral(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const n = raw[++i];
    if (n === undefined) break;
    if (n === 'n') out += '\n';
    else if (n === 'r') out += '\r';
    else if (n === 't') out += '\t';
    else if (n === 'b' || n === 'f') out += '';
    else if (n === '\r' || n === '\n') { /* line continuation */ }
    else if (/[0-7]/.test(n)) {
      let oct = n;
      while (oct.length < 3 && /[0-7]/.test(raw[i + 1] ?? '')) oct += raw[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else out += n;
  }
  return out;
}

/** Decode a `<hex>` string: UTF-16BE when it starts with a BOM, else bytes. */
function decodeHex(hex: string): string {
  const clean = hex.replace(/[^0-9a-f]/gi, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2).padEnd(2, '0'), 16));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let s = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
    return s;
  }
  return String.fromCharCode(...bytes);
}

/** Read the strings inside one `[...]` TJ array or a single operand run. */
function stringsIn(segment: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < segment.length) {
    const c = segment[i];
    if (c === '(') {
      let depth = 1;
      let j = i + 1;
      let raw = '';
      while (j < segment.length && depth > 0) {
        const d = segment[j]!;
        if (d === '\\') { raw += d + (segment[j + 1] ?? ''); j += 2; continue; }
        if (d === '(') depth++;
        else if (d === ')') { depth--; if (depth === 0) break; }
        raw += d;
        j++;
      }
      out.push(decodeLiteral(raw));
      i = j + 1;
    } else if (c === '<' && segment[i + 1] !== '<') {
      const end = segment.indexOf('>', i);
      if (end < 0) break;
      out.push(decodeHex(segment.slice(i + 1, end)));
      i = end + 1;
    } else {
      // A large negative kerning inside TJ is a word gap.
      const num = /^-?\d+(\.\d+)?/.exec(segment.slice(i));
      if (num && Number(num[0]) < -200) out.push(' ');
      i += num ? num[0].length : 1;
    }
  }
  return out;
}

/** Text runs of one content stream, with line breaks at `T*`, `Td`, `TD`, `'` and `ET`. */
export function textFromContentStream(stream: string): string {
  let text = '';
  const re = /(\[(?:[^\]\\]|\\.)*\]|\((?:[^()\\]|\\.|\((?:[^()\\]|\\.)*\))*\)|<[0-9A-Fa-f\s]*>)\s*(TJ|Tj|'|")|(T\*|Td|TD|ET)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stream)) !== null) {
    if (m[3]) {
      if (!text.endsWith('\n')) text += '\n';
      continue;
    }
    if (m[2] === "'" || m[2] === '"') text += '\n';
    text += stringsIn(m[1]!.startsWith('[') ? m[1]!.slice(1, -1) : m[1]!).join('');
  }
  return text;
}

/** Every stream's bytes, inflated when the dictionary says FlateDecode. */
function streams(pdf: Buffer): Buffer[] {
  const out: Buffer[] = [];
  const latin = pdf.toString('latin1');
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin)) !== null) {
    const start = m.index + m[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) break;
    const dict = latin.slice(Math.max(0, m.index - 400), m.index);
    const lastDict = dict.slice(dict.lastIndexOf('<<'));
    let data = pdf.subarray(start, end);
    if (/FlateDecode/.test(lastDict)) {
      try {
        data = zlib.inflateSync(data);
      } catch {
        try {
          data = zlib.inflateRawSync(data.subarray(2));
        } catch {
          re.lastIndex = end;
          continue;
        }
      }
    } else if (/\/Filter/.test(lastDict)) {
      // Images and other encodings carry no text.
      re.lastIndex = end;
      continue;
    }
    out.push(data);
    re.lastIndex = end;
  }
  return out;
}

/** The PDF's text, or '' when none could be read. Capped at `maxChars`. */
export function extractPdfText(pdf: Buffer, maxChars = 400_000): string {
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') return '';
  let text = '';
  for (const data of streams(pdf)) {
    const s = data.toString('latin1');
    if (!/\b(Tj|TJ)\b/.test(s)) continue;
    text += textFromContentStream(s) + '\n';
    if (text.length > maxChars) break;
  }
  return text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxChars);
}

/** Whether extracted text looks like words rather than glyph ids. */
export function looksReadable(text: string): boolean {
  if (text.length < 20) return false;
  const letters = (text.match(/[\p{L}\p{N}\s.,;:!?'"()-]/gu) ?? []).length;
  return letters / text.length > 0.85;
}
