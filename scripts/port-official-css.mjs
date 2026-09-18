#!/usr/bin/env node
/**
 * Port the official Claude Code webview styles into Forge.
 *
 * Forge's UI target is the real Claude Code VS Code UI, not a restyled Claudix.
 * The official webview ships minified with CSS-module-hashed class names
 * (`.messageInput_cKsPxg`), where the hash suffix identifies the source module.
 * That makes the stylesheet a usable spec: grouping by hash recovers the original
 * component boundaries, and the rules inside are the real layout, spacing and
 * states.
 *
 * This script extracts one file per module, de-hashes the class names into
 * `.fg-<module>__<local>`, and rewrites every colour onto Forge tokens. Structural
 * rules come across 1:1; only colour is re-pointed.
 *
 * It works because Workstream 1 rebuilt the full official `--app-*` token set on
 * top of Pajamas -- so the vast majority of the official rules already resolve
 * against the Forge brand with no edit at all.
 *
 * Usage: node scripts/port-official-css.mjs [path/to/official/index.css]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'src', 'webview', 'src', 'styles', 'official');
const DEFAULT_SRC = join(ROOT, '..', 'Real_Claude_Code_VSCODE_extension_files', 'webview', 'index.css');

/**
 * Module hash -> Forge component name. Hashes come from the official build; the
 * descriptions are what each module turned out to be once its class names were
 * read together.
 */
const MODULES = {
  chat: { hash: '07S1Yg', desc: 'Chat surface: turns, messages, sticky mode, empty and error states' },
  composer: { hash: 'cKsPxg', desc: 'Composer: input, mention chips + mirror, attachments, effort legend' },
  footer: { hash: 'gGYT1w', desc: 'Composer footer: model pill, effort badge, send/stop' },
  menu: { hash: '8RAulQ', desc: 'Flyout menus and the effort level selector' },
  sessions: { hash: 'OOQiHg', desc: 'Sessions sidebar: list, groups, rename, search, worktree pills' },
  shell: { hash: 'aqhumA', desc: 'App shell: header, editable title, worktree banner' },
  thinking: { hash: 'aHyQPQ', desc: 'Collapsible thinking block' },
  permission: { hash: 'qlaBag', desc: 'Tool permission request' },
  todo: { hash: 'xheXVQ', desc: 'Todo list' },
  task: { hash: 'iHnHpw', desc: 'Subagent transcript tree' },
  questions: { hash: 'hONcXw', desc: 'Interactive question blocks' },
  dialog: { hash: 'f3sAzg', desc: 'Modal dialog' },
  changes: { hash: 'n2luCQ', desc: 'File change summary' },
  onboarding: { hash: 'UxGN1Q', desc: 'Onboarding checklist' },
  expandable: { hash: 'xGDvVg', desc: 'Expand / collapse container' },
  iconbutton: { hash: 'YKLzCw', desc: 'Bare icon button (fold, close) in 16px and 20px sizes' },
  editable: { hash: 'q4zSJA', desc: 'Contenteditable single-field input with its own placeholder' },
  commandmenu: { hash: 'G_S7FQ', desc: 'Command palette popup: filter row, sections, command rows, version footer' },
  modelmenu: { hash: 'G8AMvA', desc: 'Model picker listbox rows and the effort section beneath them' },
  addmenu: { hash: 'Lu5mZA', desc: 'Composer + button and its Upload / Add context / Browse the web menu' },
  filter: { hash: '90gk3A', desc: 'Command menu filter input' },
  toggle: { hash: '0c4GDA', desc: 'On/off switch used as a command menu trailing control' },
  effortslider: { hash: 'P1HaRA', desc: 'Effort level slider: fill, notches and thumb' },
  termicon: { hash: '4yNfQQ', desc: 'Terminal glyph beside "Open Claude in Terminal"' },
  sessionsdropdown: { hash: 'Wc_2Bg', desc: 'Past conversations dropdown: overlay and positioned panel' },
  markdown: { hash: '-a7MRw', desc: 'Assistant markdown: root, code block wrapper, copy button, insight rules' },
  copybutton: { hash: 'CEmTFw', desc: 'Copy-to-clipboard button on code blocks' },
  vh: { hash: 'ZQjaqw', desc: 'Visually hidden (screen-reader only) utility' },
  emptystate: { hash: '5Dm21w', desc: 'Empty chat: wordmark above the opening tip' },
  tip: { hash: 'AV_aEg', desc: 'Opening tip: mascot, message and keyboard shortcut keys' },
  spinner: { hash: 'hc5dvw', desc: 'Working indicator: animated mark and verb' },
  notice: { hash: 'BrnsCQ', desc: 'Empty-state notice card: header, close, body, learn more, actions' },
  banner: { hash: 'Z3DrKA', desc: 'Empty-state terminal banner above the composer' },
  content: { hash: 'uq5aLg', desc: 'Content blocks: tool use and tool result wrappers, tool reference, render error' },
  tool: { hash: 'ZUQaOA', desc: 'Tool call: summary header, body box and its IN / OUT grid rows' },
  secondaryline: { hash: 'mLrg7g', desc: 'Tool secondary line: the one-line result under a tool header' },
  bashtool: { hash: 'F2hEIg', desc: 'Bash tool: IN row with its copy button, editable permission command' },
  editbody: { hash: 'R6H5ZA', desc: 'Edit tool body wrapper (hidden below 500px)' },
  writebody: { hash: 'fKyNXw', desc: 'Write tool body wrapper (hidden below 500px)' },
  diffview: { hash: 's6OFow', desc: 'Edit tool diff: container, truncation gradient, click-to-expand overlay' },
  diffmodal: { hash: 'oXZawA', desc: 'Full-size diff modal opened from an Edit tool diff' },
  checkbox: { hash: 'FvGYOg', desc: 'Checkbox used by the todo list' },
  innercall: { hash: '3H9AYw', desc: 'REPL tool: inner call list' },
  chrometool: { hash: 'DU_5JQ', desc: 'Claude in Chrome tool: tab link and screenshot' },
  thumbnail: { hash: 'vRjSkQ', desc: 'Image thumbnail with its full-size preview overlay' },
  permissionrules: { hash: '0Reg3g', desc: 'Permission rules dialog: rule list, add and remove panels' },
  dialogbutton: { hash: 'GujgUQ', desc: 'Plain button inside dialogs (default and primary)' },
};

/**
 * Black shadow literals. The official casts drop shadows in black at low alpha,
 * and they must stay black: the general map below re-points the same literals
 * onto foreground scrims (right for hairlines and fills), which in a dark theme
 * turns every drop shadow into a pale glow around menus and popups. Applied to
 * box-shadow declarations before the general map.
 */
const SHADOW_MAP = [
  [/#0000001a\b/gi, 'var(--forge-shadow-soft)'],
  [/#00000012\b/gi, 'var(--forge-shadow-faint)'],
  [/#00000026\b/gi, 'var(--forge-shadow-medium)'],
  [/#0003\b/gi, 'var(--forge-shadow-strong)'],
];

/**
 * Colour rewrites. The official palette is Claude's; Forge resolves the same
 * roles through its own semantic tokens so the ported UI is on-brand by
 * construction rather than by later cleanup.
 */
const COLOR_MAP = [
  // Claude brand -> Forge brand
  // The official build has two brand steps: the brand orange, and a deeper clay
  // for filled surfaces (send, primary buttons). Forge keeps the same split.
  [/var\(--app-claude-clay-button-orange\)/g, 'var(--forge-brand-strong)'],
  [/var\(--app-claude-orange\)/g, 'var(--forge-brand)'],
  [/var\(--app-claude-ivory\)/g, 'var(--forge-on-brand)'],
  [/var\(--app-claude-slate\)/g, 'var(--forge-brand-deep)'],
  // VS Code chart hues -> Forge semantics
  [/var\(--vscode-charts-red\)/g, 'var(--forge-danger)'],
  [/var\(--vscode-charts-green\)/g, 'var(--forge-success)'],
  [/var\(--vscode-charts-yellow\)/g, 'var(--forge-warning)'],
  [/var\(--vscode-charts-blue\)/g, 'var(--forge-info)'],
  [/var\(--vscode-charts-orange\)/g, 'var(--forge-tool-accent)'],
  [/var\(--vscode-charts-purple\)/g, 'var(--forge-tool-accent-alt)'],
  [/var\(--vscode-charts-foreground\)/g, 'var(--app-chart-8)'],
  [/var\(--vscode-errorForeground\)/g, 'var(--forge-danger)'],
  // Typography. Forge bundles its own faces so type is identical in every
  // environment; the official build inherits whatever the host has installed.
  [/var\(--vscode-chat-font-family\)/g, 'var(--forge-font-sans)'],
  [/var\(--vscode-chat-font-size,\s*13px\)/g, 'var(--forge-font-size)'],
  [/var\(--vscode-chat-font-size\)/g, 'var(--forge-font-size)'],
  // Generic families would fall back to whatever the machine has installed.
  [/font-family:\s*system-ui,[^;}]*/g, 'font-family:var(--forge-font-sans)'],
  [/font-family:\s*monospace(?=\s*[;}])/g, 'font-family:var(--app-monospace-font-family)'],
  // Claude brand orange, hardcoded with alpha in the official build. These are
  // the leaks that matter: left alone they would put Claude's orange straight
  // into Forge's onboarding and banners.
  [/#d97757cc\b/gi, 'color-mix(in srgb, var(--forge-brand) 80%, transparent)'],
  [/#d9775733\b/gi, 'color-mix(in srgb, var(--forge-brand) 20%, transparent)'],
  [/#d977571a\b/gi, 'var(--forge-brand-subtle)'],
  [/#eda38a1a\b/gi, 'var(--forge-brand-subtle)'],
  [/#d97757\b/gi, 'var(--forge-brand)'],
  [/#e1c08d\b/gi, 'var(--forge-warning)'],
  // Literal colours used by the official build
  [/#0000(?![0-9a-fA-F])/g, 'transparent'],
  [/#0003\b/gi, 'var(--forge-scrim-soft)'],
  [/#999(?![0-9a-fA-F])/gi, 'var(--app-secondary-foreground)'],
  [/#c74e3933\b/gi, 'var(--forge-danger-surface)'],
  [/#c74e39\b/gi, 'var(--forge-danger)'],
  [/#74c991\b/gi, 'var(--forge-success)'],
  [/#3b82f6\b/gi, 'var(--forge-info)'],
  [/#fdff00cc\b/gi, 'var(--forge-warning)'],
  [/#ffffff70\b/gi, 'color-mix(in srgb, var(--forge-on-brand) 44%, transparent)'],
  [/#ffffff1a\b/gi, 'var(--app-transparent-inner-border)'],
  [/#00000026\b/gi, 'var(--forge-scrim-soft)'],
  [/#0000001a\b/gi, 'var(--forge-scrim-soft)'],
  [/#00000012\b/gi, 'var(--forge-scrim-faint)'],
  [/#000000bf\b/gi, 'var(--app-modal-background)'],
  // Tool rows: the diff's hover wash and expand-button border, the image preview scrim.
  [/#0000000d\b/gi, 'var(--forge-shadow-faint)'],
  [/#ffffff4d\b/gi, 'color-mix(in srgb, var(--forge-on-brand) 30%, transparent)'],
  [/#000000d9\b/gi, 'var(--app-modal-background)'],
  [/#00000080\b/gi, 'var(--app-modal-background)'],
  [/#fff(?![0-9a-fA-F])/gi, 'var(--forge-on-brand)'],
  [/#000(?![0-9a-fA-F])/gi, 'var(--forge-shadow-color)'],
];

// ------------------------------------------------------------------ parsing ---

/**
 * Split CSS into top-level rules. At-rules that contain nested rules
 * (`@media`, `@supports`, `@container`) are recursed into so their inner rules
 * can be filtered by module too.
 */
function parseRules(css) {
  const rules = [];
  let i = 0;
  let selStart = 0;
  let depth = 0;
  let str = null;

  while (i < css.length) {
    const ch = css[i];

    if (str) {
      if (ch === str && css[i - 1] !== '\\') str = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") { str = ch; i++; continue; }
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }

    if (ch === '{') {
      if (depth === 0) {
        var bodyStart = i + 1;
        var selector = css.slice(selStart, i).trim();
      }
      depth++;
      i++;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        rules.push({ selector, body: css.slice(bodyStart, i) });
        selStart = i + 1;
      }
      i++;
      continue;
    }
    // A statement at-rule with no block (e.g. @charset, @import).
    if (ch === ';' && depth === 0) {
      selStart = i + 1;
      i++;
      continue;
    }
    i++;
  }
  return rules;
}

const NESTED_AT = /^@(media|supports|container|layer|scope)\b/;

function formatBody(body, indent = '  ') {
  return body
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => `${indent}${d};`)
    .join('\n');
}

function formatSelector(sel) {
  return sel.split(',').map((s) => s.trim()).filter(Boolean).join(',\n');
}

// -------------------------------------------------------------------- main ---

const srcPath = process.argv[2] ?? DEFAULT_SRC;
let css;
try {
  css = readFileSync(srcPath, 'utf8');
} catch {
  console.error(`port-official-css: cannot read the official stylesheet at\n  ${srcPath}\n` +
    'Pass its path as an argument. This is a build-time reference step; the ported ' +
    'files under src/webview/src/styles/official/ are committed, so a checkout ' +
    'without the reference extension still builds.');
  process.exit(1);
}

const rules = parseRules(css);
mkdirSync(OUT_DIR, { recursive: true });

const summary = [];
/** Animation names referenced by the kept rules, collected across all modules. */
const animationsUsed = new Set();
for (const [name, { hash, desc }] of Object.entries(MODULES)) {
  const tag = new RegExp(`_${hash}\\b`);
  // A local name may itself contain an underscore (`toolBodyRowContent_disableClipping`).
  const dehash = new RegExp(`\\.([A-Za-z][A-Za-z0-9_]*?)_${hash}\\b`, 'g');

  const out = [];
  let kept = 0;

  const emit = (rule, depthPrefix = '', indent = '  ') => {
    if (!tag.test(rule.selector) && !tag.test(rule.body)) return false;
    const selector = formatSelector(rule.selector.replace(dehash, `.fg-${name}__$1`));
    const body = formatBody(rule.body.replace(dehash, `.fg-${name}__$1`), indent);
    out.push(`${depthPrefix}${selector} {\n${body}\n${depthPrefix}}`);
    kept++;
    return true;
  };

  for (const rule of rules) {
    if (NESTED_AT.test(rule.selector)) {
      const inner = parseRules(rule.body).filter((r) => tag.test(r.selector));
      if (!inner.length) continue;
      const block = inner.map((r) => {
        const selector = formatSelector(r.selector.replace(dehash, `.fg-${name}__$1`))
          .split('\n').map((l) => '  ' + l).join('\n');
        return `${selector} {\n${formatBody(r.body, '    ')}\n  }`;
      }).join('\n');
      out.push(`${rule.selector} {\n${block}\n}`);
      kept += inner.length;
      continue;
    }
    if (rule.selector.startsWith('@keyframes')) continue; // collected below
    emit(rule);
  }

  // Note which @keyframes the kept rules animate; they are emitted once into a
  // shared keyframes.css rather than duplicated into every module.
  for (const chunk of out) {
    for (const m of chunk.matchAll(/animation(?:-name)?\s*:\s*([^;]+);/g)) {
      for (const word of m[1].split(/[\s,]+/)) {
        if (/^[A-Za-z][\w-]*$/.test(word) && !/^(ease|linear|infinite|both|none|forwards|backwards|alternate|normal|reverse|running|paused|in|out)$/.test(word)) {
          animationsUsed.add(word);
        }
      }
    }
  }

  let text = out.join('\n\n');
  text = text.replace(/box-shadow:[^;]*/g, (decl) => {
    for (const [re, to] of SHADOW_MAP) decl = decl.replace(re, to);
    return decl;
  });
  for (const [re, to] of COLOR_MAP) text = text.replace(re, to);

  const header = `/*!
 * fg-${name} -- ${desc}
 *
 * GENERATED by scripts/port-official-css.mjs -- do not edit by hand.
 * Ported from the official Claude Code VS Code webview (module ${hash}).
 *
 * Structural rules are 1:1 with the official UI. Only colour is re-pointed:
 * Claude brand -> --forge-*, chart hues -> Forge semantics, literals -> tokens.
 * Class names are de-hashed to .fg-${name}__<local>.
 */
`;
  writeFileSync(join(OUT_DIR, `${name}.css`), header + text + '\n');
  summary.push({ name, hash, rules: kept });
}

// ------------------------------------------------------------- keyframes ---
// Emitted once and shared, rather than duplicated into each module file.
const kfOut = [];
const kfDefined = new Set();
for (const rule of rules) {
  const m = /^@keyframes\s+([\w-]+)$/.exec(rule.selector.trim());
  if (!m || !animationsUsed.has(m[1]) || kfDefined.has(m[1])) continue;
  kfDefined.add(m[1]);
  const steps = parseRules(rule.body)
    .map((s) => `  ${s.selector.trim()} {\n${formatBody(s.body, '    ')}\n  }`)
    .join('\n');
  kfOut.push(`@keyframes ${m[1]} {\n${steps}\n}`);
}

// The official build animates `blink` but ships no @keyframes for it -- only a
// hashed blink_* belonging to a different module -- so its progress dot never
// actually blinks. Supply the missing definition, marked as ours.
const MISSING_UPSTREAM = {
  blink: [
    '@keyframes blink {',
    '  0%, 100% {',
    '    opacity: 1;',
    '  }',
    '  50% {',
    '    opacity: .25;',
    '  }',
    '}',
  ].join('\n'),
};
for (const [name, def] of Object.entries(MISSING_UPSTREAM)) {
  if (animationsUsed.has(name) && !kfDefined.has(name)) {
    kfOut.push(`/* Referenced by the official rules but undefined upstream. */\n${def}`);
    kfDefined.add(name);
  }
}

writeFileSync(join(OUT_DIR, 'keyframes.css'), `/*!
 * Keyframes used by the ported official styles.
 * GENERATED by scripts/port-official-css.mjs -- do not edit by hand.
 */
${kfOut.join('\n\n')}
`);

const missingKf = [...animationsUsed].filter((a) => !kfDefined.has(a));
if (missingKf.length) console.warn(`  note: no @keyframes found for ${missingKf.join(', ')}`);

// An index so components import one file, in the order the modules appear in
// the official stylesheet: rules of equal specificity resolve by source order,
// so any other order silently changes which declaration wins (the filter input's
// padding once overrode the session search's inset, putting the icon on the text).
const ORDERED = Object.entries(MODULES)
  .map(([n, { hash }]) => [n, css.search(new RegExp(`_${hash}\\b`))])
  .sort((a, b) => a[1] - b[1])
  .map(([n]) => n);
const index = `/*!
 * Official Claude Code UI, ported onto Forge tokens.
 * GENERATED by scripts/port-official-css.mjs -- do not edit by hand.
 */
@import "./keyframes.css";
${ORDERED.map((n) => `@import "./${n}.css";`).join('\n')}
`;
writeFileSync(join(OUT_DIR, 'index.css'), index);

const width = Math.max(...summary.map((s) => s.name.length));
for (const s of summary) {
  console.log(`  ${s.name.padEnd(width)}  ${s.hash}  ${String(s.rules).padStart(4)} rules`);
}
console.log(`  ${'keyframes'.padEnd(width)}          ${String(kfDefined.size).padStart(4)} defs`);
console.log(`port-official-css: ${summary.length} modules, ${summary.reduce((n, s) => n + s.rules, 0)} rules -> ${OUT_DIR}`);
