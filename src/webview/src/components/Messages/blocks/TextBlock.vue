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
  <span v-else class="fg-markdown__root" @click="onClick" v-html="html"></span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Marked, type Tokens } from 'marked';
import type { TextBlock as TextBlockType } from '../../../models/ContentBlock';
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

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const md = new Marked({ gfm: true, breaks: false });
md.use({
  renderer: {
    code(token: Tokens.Code) {
      const lang = (token.lang || '').match(/^\S*/)?.[0];
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
      // react-markdown does not render raw HTML; it shows it as text.
      return escapeHtml(token.text);
    },
  },
});

/** The official partial-text rule (`wL0`): drop the last paragraph while it is still streaming. */
function stablePart(text: string): string {
  const parts = text.split(/\n\n+/);
  if (parts.length <= 1) return text;
  parts.pop();
  return parts.join('\n\n');
}

const html = computed(() => md.parse(props.isPartialText ? stablePart(props.block.text) : props.block.text) as string);

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
