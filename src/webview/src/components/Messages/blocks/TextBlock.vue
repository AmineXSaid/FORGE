<template>
  <!--
    The official assistant markdown (reference `r$`, modules -a7MRw + CEmTFw):
      <span class="root"> ...GFM markdown... </span>
    with the official component overrides: a code block is
    <div class="codeBlockWrapper"><button class="copyButton">copy</button><pre/></div>,
    headings carry aria-level (h1 4, h2 5, h3+ 6), links open externally, inline
    code that is an "Insight" banner or its rule gets the insight classes, and
    non-data images are replaced by "[Image]".

    No <style> block: the ported official stylesheet owns every rule. Soft line
    breaks are NOT turned into <br> -- react-markdown does not do that.
  -->
  <span v-if="block.isSlashCommand" class="fg-chat__userMessage fg-chat__slashCommandMessage">{{ block.text }}</span>
  <span v-else ref="rootRef" class="fg-markdown__root" @click="onClick" v-html="html"></span>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue';
import { Marked, type Tokens } from 'marked';
import { renderMermaidBlocks } from '../../../utils/mermaidBlocks';
import { invalidateMermaidTheme } from '../../../utils/mermaid';
import { useMermaidViewer } from '../../../composables/useMermaidViewer';
import type { TextBlock as TextBlockType } from '../../../models/ContentBlock';
import { stablePartialText } from '../../../models/StreamAssembler';
import type { ToolContext } from '../../../types/tool';

interface Props {
  block: TextBlockType;
  context?: ToolContext;
  /** While streaming, the official hides the last (still growing) paragraph. */
  isPartialText?: boolean;
}
const props = defineProps<Props>();

const COPY_ICON = '<svg class="fg-copybutton__copyIcon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" data-slot="icon"><path fill-rule="evenodd" clip-rule="evenodd" d="M15.988 3.012A2.25 2.25 0 0 1 18 5.25v6.5A2.25 2.25 0 0 1 15.75 14H13.5v-3.379a3 3 0 0 0-.879-2.121l-3.12-3.121a3 3 0 0 0-1.402-.791 2.252 2.252 0 0 1 1.913-1.576A2.25 2.25 0 0 1 12.25 1h1.5a2.25 2.25 0 0 1 2.238 2.012ZM11.5 3.25a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75v.25h-3v-.25Z"/><path d="M3.5 6A1.5 1.5 0 0 0 2 7.5v9A1.5 1.5 0 0 0 3.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-5.879a1.5 1.5 0 0 0-.44-1.06L8.44 6.439A1.5 1.5 0 0 0 7.378 6H3.5Z"/></svg>';
const CHECK_ICON = '<svg class="fg-copybutton__copyIcon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" data-slot="icon"><path fill-rule="evenodd" clip-rule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"/></svg>';

const icon = (body: string) =>
  `<svg class="fg-mermaid__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const MINUS_ICON = icon('<path d="M3.5 8h9"/>');
const PLUS_ICON = icon('<path d="M8 3.5v9M3.5 8h9"/>');
const RESET_ICON = icon('<path d="M2.5 8a5.5 5.5 0 1 1 1.7 3.96"/><path d="M2.2 12.2V8.6h3.6"/>');
const EXPAND_ICON = icon('<path d="M9.5 2.5h4v4"/><path d="M6.5 13.5h-4v-4"/><path d="M13.5 2.5 9 7"/><path d="M2.5 13.5 7 9"/>');

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Raw HTML the markdown renderer will emit instead of escaping.
 *
 * A Forge extension: the official passes `remarkPlugins:[remark-gfm]` with no
 * `rehypePlugins`, so react-markdown shows `<kbd>Ctrl</kbd>` as literal text --
 * measured in `index.js`, not assumed. Forge renders a small inline subset,
 * because the host-default stylesheet already styles `<kbd>` off the
 * `--app-kbd-*` tokens and nothing could reach them.
 *
 * Tags only, and never attributes: this text is model output, so an attribute
 * allowlist would be an XSS surface (`<img onerror=…>`, `href="javascript:…"`).
 * A tag is re-emitted in canonical form, so nothing else can ride along;
 * anything not on the list is escaped exactly as it was before.
 */
const INLINE_HTML_TAGS = new Set([
  'kbd', 'sub', 'sup', 'abbr', 'mark', 'u', 's', 'ins', 'del', 'samp', 'var', 'small', 'br', 'wbr',
]);
const BARE_TAG_RE = /^<(\/?)([a-z][a-z0-9]*)\s*\/?>$/i;

const md = new Marked({ gfm: true, breaks: false });
md.use({
  renderer: {
    code(token: Tokens.Code) {
      const lang = (token.lang || '').match(/^\S*/)?.[0];
      // A Forge extension: the official has no mermaid, so it draws this fence
      // as a code block. `renderMermaidBlocks` fills the placeholder in later.
      if (lang?.toLowerCase() === 'mermaid') {
        return (
          `<div class="fg-mermaid__block" data-mermaid-source="${escapeHtml(token.text)}">` +
          '<div class="fg-mermaid__toolbar">' +
          '<span class="fg-mermaid__kind">diagram</span>' +
          '<span class="fg-mermaid__spacer"></span>' +
          `<button type="button" class="fg-mermaid__button" data-mermaid-action="zoom-out" title="Zoom out" aria-label="Zoom out">${MINUS_ICON}</button>` +
          '<span class="fg-mermaid__zoomValue">100%</span>' +
          `<button type="button" class="fg-mermaid__button" data-mermaid-action="zoom-in" title="Zoom in" aria-label="Zoom in">${PLUS_ICON}</button>` +
          `<button type="button" class="fg-mermaid__button" data-mermaid-action="reset" title="Reset zoom" aria-label="Reset zoom">${RESET_ICON}</button>` +
          `<button type="button" class="fg-mermaid__button" data-mermaid-action="expand" title="Open wider" aria-label="Open diagram wider">${EXPAND_ICON}</button>` +
          '</div>' +
          '<div class="fg-mermaid__canvas"><div class="fg-mermaid__stage"></div></div>' +
          '</div>'
        );
      }
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      return (
        '<div class="fg-markdown__codeBlockWrapper">' +
        `<button class="fg-copybutton__copyButton fg-markdown__copyButton" title="Copy code" aria-label="Copy code to clipboard">${COPY_ICON}</button>` +
        `<pre><code${cls}>${escapeHtml(token.text)}\n</code></pre></div>`
      );
    },
    heading(token: Tokens.Heading) {
      const level = Math.min(Math.max(token.depth, 1), 6);
      const aria = level === 1 ? 4 : level === 2 ? 5 : 6;
      return `<h${level} aria-level="${aria}">${this.parser.parseInline(token.tokens)}</h${level}>\n`;
    },
    link(token: Tokens.Link) {
      const href = escapeHtml(token.href || '');
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${this.parser.parseInline(token.tokens)}</a>`;
    },
    codespan(token: Tokens.Codespan) {
      const raw = token.text;
      if (raw.includes('\u2605') && raw.includes('Insight')) return `<code class="fg-markdown__insightHeader">${raw}</code>`;
      if (/^\u2500{20,}$/.test(raw.trim())) return `<code class="fg-markdown__insightFooter">${raw}</code>`;
      return `<code>${raw}</code>`;
    },
    image(token: Tokens.Image) {
      if (token.href?.startsWith('data:')) return `<img src="${escapeHtml(token.href)}" alt="${escapeHtml(token.text || '')}">`;
      return `<span title="Image blocked: ${escapeHtml(token.href || 'unknown')}">[Image]</span>`;
    },
    html(token: Tokens.HTML | Tokens.Tag) {
      const match = BARE_TAG_RE.exec(token.text.trim());
      const tag = match?.[2]?.toLowerCase();
      if (tag && INLINE_HTML_TAGS.has(tag)) return `<${match![1] ? '/' : ''}${tag}>`;
      // Everything else keeps the official behaviour: shown as text.
      return escapeHtml(token.text);
    },
  },
});

const html = computed(() => md.parse(props.isPartialText ? stablePartialText(props.block.text) : props.block.text) as string);

/*
 * Mermaid diagrams live inside the `v-html` output, so they are drawn after Vue
 * has patched it rather than by a child component. Re-running on every change is
 * safe: a block that has already been drawn is skipped by its own marker.
 */
const rootRef = useTemplateRef<HTMLElement>('rootRef');
const viewer = useMermaidViewer();

async function drawDiagrams(): Promise<void> {
  await nextTick();
  if (rootRef.value) await renderMermaidBlocks(rootRef.value, viewer.open);
}

watch(html, () => void drawDiagrams());
onMounted(() => void drawDiagrams());

/*
 * A VS Code theme change swaps every token underneath the diagram, and mermaid
 * has already baked the old colours into its SVG. Drop the cached theme and draw
 * the diagrams again.
 */
const themeObserver = new MutationObserver(() => {
  invalidateMermaidTheme();
  rootRef.value?.querySelectorAll('.fg-mermaid__block').forEach((block) => {
    block.removeAttribute('data-mermaid-rendered');
    block.classList.remove('fg-mermaid__ready', 'fg-mermaid__failed');
  });
  void drawDiagrams();
});
onMounted(() => {
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-vscode-theme-kind'] });
});
onBeforeUnmount(() => themeObserver.disconnect());

function onClick(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  const button = target.closest('.fg-markdown__copyButton') as HTMLButtonElement | null;
  if (button) {
    const pre = button.parentElement?.querySelector('pre');
    void navigator.clipboard.writeText(pre?.textContent ?? '').then(() => {
      button.innerHTML = CHECK_ICON;
      setTimeout(() => { button.innerHTML = COPY_ICON; }, 2000);
    });
    return;
  }
  const link = target.closest('a') as HTMLAnchorElement | null;
  const href = link?.getAttribute('href');
  if (link && href && !/^[a-z]+:/i.test(href) && props.context?.fileOpener) {
    // A relative link is a file reference: open it in the editor, as the official does.
    event.preventDefault();
    const [path, line] = href.split('#L');
    props.context.fileOpener.open(decodeURIComponent(path), line ? { startLine: Number(line) } : undefined);
  }
}
</script>
