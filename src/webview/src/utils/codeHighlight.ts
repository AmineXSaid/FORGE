/**
 * Syntax highlighting for markdown code blocks.
 *
 * A Forge divergence: the official webview ships no highlighter at all. Its
 * whole code-block module is four CSS rules and none of them colours anything,
 * so a fenced block renders as flat monospace. That is faithful to Claude Code
 * and it is also the thing people notice first in a tool whose main output is
 * code.
 *
 * Two constraints shape what this does:
 *
 *   - **Curated languages, not the kitchen sink.** `highlight.js` ships ~190
 *     grammars; importing the barrel would pull all of them into the webview
 *     bundle. Registering a chosen set keeps the cost to the languages an
 *     agentic coding assistant actually emits.
 *   - **Colour goes through the token layer.** `lint:brand` forbids a raw hex
 *     outside `forge-tokens.css`, so this module emits only `hljs-*` class
 *     names and `forge-design.css` maps them onto `--forge-code-*`. The
 *     highlighter decides *what* a token is; Pajamas decides what colour it is.
 */
import hljs from 'highlight.js/lib/core';

import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import less from 'highlight.js/lib/languages/less';
import lua from 'highlight.js/lib/languages/lua';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

/** The languages Forge registers, and the aliases the model actually writes. */
const LANGUAGES: [string, Parameters<typeof hljs.registerLanguage>[1]][] = [
  ['bash', bash], ['c', c], ['cpp', cpp], ['csharp', csharp], ['css', css],
  ['diff', diff], ['go', go], ['ini', ini], ['java', java],
  ['javascript', javascript], ['json', json], ['kotlin', kotlin], ['less', less],
  ['lua', lua], ['markdown', markdown], ['php', php], ['plaintext', plaintext],
  ['python', python], ['ruby', ruby], ['rust', rust], ['scss', scss],
  ['shell', shell], ['sql', sql], ['swift', swift], ['typescript', typescript],
  ['xml', xml], ['yaml', yaml],
];

for (const [name, lang] of LANGUAGES) hljs.registerLanguage(name, lang);

/**
 * Fence labels the model writes that are not the grammar's own name.
 *
 * `vue` and `svelte` are deliberately mapped to `xml` rather than left
 * unhighlighted: their template half is markup, and markup highlighting on a
 * whole-file block is far better than none.
 */
const ALIASES: Record<string, string> = {
  sh: 'bash', zsh: 'bash', shellscript: 'bash', console: 'shell', ps1: 'bash', powershell: 'bash',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  py: 'python', python3: 'python',
  rs: 'rust', golang: 'go', 'c++': 'cpp', cc: 'cpp', h: 'c', hpp: 'cpp',
  cs: 'csharp', kt: 'kotlin', rb: 'ruby',
  yml: 'yaml', toml: 'ini', conf: 'ini', cfg: 'ini', dotenv: 'ini', env: 'ini',
  html: 'xml', htm: 'xml', svg: 'xml', vue: 'xml', svelte: 'xml',
  md: 'markdown', patch: 'diff', text: 'plaintext', txt: 'plaintext',
  jsonc: 'json', json5: 'json',
};

/** Resolve a fence label to a registered grammar, or undefined. */
export function resolveLanguage(label: string | undefined): string | undefined {
  if (!label) return undefined;
  const key = label.trim().toLowerCase();
  const name = ALIASES[key] ?? key;
  return hljs.getLanguage(name) ? name : undefined;
}

/** Every language this build can highlight, for tests and diagnostics. */
export function registeredLanguages(): string[] {
  return hljs.listLanguages().sort();
}

export interface HighlightedCode {
  /** HTML with `hljs-*` spans. Already escaped -- safe to inject. */
  html: string;
  /** The grammar actually used, or undefined when the block was left plain. */
  language?: string;
}

/**
 * Highlight one fenced block.
 *
 * Returns escaped HTML either way, so the caller never has to decide whether
 * the result needs escaping -- a fenced block is untrusted model output and
 * treating the highlighted and unhighlighted paths differently is how an
 * injection gets through.
 *
 * An unknown language is **not** auto-detected. `highlightAuto` guesses, and a
 * wrong guess colours a shell script as Perl, which reads as a bug rather than
 * as the absence of a feature. Plain is the honest answer.
 */
export function highlightCode(code: string, label?: string): HighlightedCode {
  const language = resolveLanguage(label);
  if (!language) return { html: escapeHtml(code) };
  try {
    return { html: hljs.highlight(code, { language, ignoreIllegals: true }).value, language };
  } catch {
    // A grammar that throws on pathological input must not take the message
    // down with it; the block simply renders plain.
    return { html: escapeHtml(code) };
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
