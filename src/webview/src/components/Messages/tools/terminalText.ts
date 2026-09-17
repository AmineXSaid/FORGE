/**
 * Text for Forge's terminal surface: a tool's input or output turned into lines
 * of classed segments (see styles/forge-terminal.css). Pure functions, so the
 * rules are tested without a DOM (test/terminalRendering.spec.ts).
 */
import type { VNodeChild } from 'vue';
import type { ToolResultBlock } from '../../../models/ContentBlock';
import { parseAnsi, type AnsiSegment } from './ansi';
import { tokenizeShell, type ShellKind } from './shellHighlight';

export interface TermSegment {
  text: string;
  cls?: string;
}

export type TermLine = TermSegment[];

export type TermFormat = 'json' | 'ansi' | 'plain';

/** The fterm- classes for one ANSI-styled segment. */
export function ansiClass(seg: AnsiSegment): string | undefined {
  const fg = seg.inverse ? seg.bg ?? 'inverse-fg' : seg.fg;
  const bg = seg.inverse ? seg.fg ?? 'inverse-bg' : seg.bg;
  const out: string[] = [];
  if (fg) out.push(`fterm-fg-${fg}`);
  if (bg) out.push(`fterm-bg-${bg}`);
  if (seg.bold) out.push('fterm-bold');
  if (seg.dim) out.push('fterm-dim');
  if (seg.italic) out.push('fterm-italic');
  if (seg.underline) out.push('fterm-underline');
  return out.length ? out.join(' ') : undefined;
}

/** Terminal output: ANSI colours kept, other escapes removed. */
export function ansiLines(text: string): TermLine[] {
  return parseAnsi(text).map((line) => line.map((seg) => ({ text: seg.text, cls: ansiClass(seg) })));
}

export function plainLines(text: string): TermLine[] {
  return text.split('\n').map((line) => (line ? [{ text: line }] : []));
}

/** A shell command, one token class per word. */
export function shellLines(source: string, shell: ShellKind): TermLine[] {
  const lines: TermLine[] = [[]];
  for (const token of tokenizeShell(source, shell)) {
    const cls = token.kind === 'text' ? undefined : `fterm-tok-${token.kind}`;
    token.text.split('\n').forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, cls });
    });
  }
  return lines;
}

const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],:]/g;

/** JSON: keys, strings, numbers, literals and punctuation each get their colour. */
export function jsonLines(text: string): TermLine[] {
  return text.split('\n').map((line) => {
    const out: TermLine = [];
    let last = 0;
    for (const m of line.matchAll(JSON_TOKEN)) {
      const index = m.index ?? 0;
      if (index > last) out.push({ text: line.slice(last, index) });
      if (m[1] !== undefined) {
        out.push({ text: m[1], cls: m[2] !== undefined ? 'fterm-tok-key' : 'fterm-tok-string' });
        if (m[2] !== undefined) out.push({ text: m[2], cls: 'fterm-tok-punct' });
      } else if (m[3] !== undefined) {
        out.push({ text: m[0], cls: 'fterm-tok-keyword' });
      } else if (/^[{}[\],:]$/.test(m[0])) {
        out.push({ text: m[0], cls: 'fterm-tok-punct' });
      } else {
        out.push({ text: m[0], cls: 'fterm-tok-number' });
      }
      last = index + m[0].length;
    }
    if (last < line.length) out.push({ text: line.slice(last) });
    return out;
  });
}

/** Text that is a JSON object or array, re-indented; undefined when it is not JSON. */
export function prettyJson(text: string): string | undefined {
  const trimmed = text.trim();
  if (!/^[{[]/.test(trimmed) || trimmed.length > 200_000) return undefined;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return undefined;
  }
}

/** Blank lines at either edge carry nothing on a terminal surface. */
export function trimBlankEdges(text: string): string {
  return text.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/(?:\r?\n[ \t]*)+$/, '');
}

/** The CLI wraps a tool's own error message in <tool_use_error>; the tags are not shown. */
export function stripToolUseError(text: string): string {
  return text.replace(/<\/?tool_use_error>/g, '');
}

export interface ResultText {
  text: string;
  /** Content the terminal cannot show as text (an image, a document). */
  hasNonText: boolean;
}

/** A tool result's text: string content, or the text blocks of array content. */
export function resultText(result: ToolResultBlock | undefined): ResultText {
  const content = result?.content;
  if (typeof content === 'string') return { text: content, hasNonText: false };
  if (!Array.isArray(content)) return { text: '', hasNonText: false };
  const texts: string[] = [];
  let hasNonText = false;
  for (const item of content) {
    if (typeof item === 'string') texts.push(item);
    else if (item?.type === 'text') texts.push(item.text);
    else if (item?.type !== 'tool_reference') hasNonText = true;
  }
  return { text: texts.join('\n'), hasNonText };
}

/**
 * One input or output row on the terminal surface. `auto` shows JSON coloured
 * and re-indented when the text parses as a JSON object or array, and as ANSI
 * terminal text otherwise. `node` replaces the text for content the terminal
 * cannot draw as lines (an image) or a one-line note.
 */
export interface ToolIORowSpec {
  label?: 'IN' | 'OUT';
  text?: string;
  format?: TermFormat | 'auto';
  error?: boolean;
  collapse?: 'head' | 'tail';
  limit?: number;
  /** Editor tab title for "open in an editor tab"; omitted, the row has no such button. */
  openTitle?: string;
  node?: VNodeChild;
}

export function resolveFormat(text: string, format: ToolIORowSpec['format']): TermFormat {
  if (format && format !== 'auto') return format;
  return prettyJson(text) !== undefined ? 'json' : 'ansi';
}

/** Lines for text in a given format. JSON is re-indented when it parses and coloured either way. */
export function formatLines(text: string, format: TermFormat): TermLine[] {
  if (text === '') return [];
  if (format === 'json') return jsonLines(prettyJson(text) ?? text);
  if (format === 'plain') return plainLines(text);
  return ansiLines(text);
}

/** The plain text of lines, for copying and opening in an editor. */
export function linesText(lines: TermLine[]): string {
  return lines.map((line) => line.map((s) => s.text).join('')).join('\n');
}
