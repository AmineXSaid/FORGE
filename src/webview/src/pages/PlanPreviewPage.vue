<template>
  <!--
    The plan preview (the official host's `zd$` page, shown in its `yS` panel).
    Markup, ids, copy and behaviour are the official's: a "Ready for review"
    banner while comments are on, the rendered plan, an "Add Comment" button
    under a selection, and the comment box. The official page is the whole
    document and scrolls it; here the root is the scroll container (Forge's
    #app is a fixed-height box), and positions are taken relative to it.

    Colours are VS Code's theme variables, as in the official page. Fonts are
    Forge's own and the shadows are tokens, because Forge never falls back to
    host or system fonts (CLAUDE.md, brand gate).
  -->
  <div ref="rootEl" class="forge-plan-preview" @mouseup="handleMouseUp">
    <div id="comment-banner" :style="{ display: commentsEnabled ? 'block' : 'none' }">
      <strong>Ready for review</strong>
      <div class="banner-hint">Select text to add comments on the plan</div>
    </div>
    <div id="content" ref="contentEl"></div>

    <div
      id="comment-btn"
      ref="commentBtnEl"
      :style="{ display: buttonAt ? 'block' : 'none', left: `${buttonAt?.left ?? 0}px`, top: `${buttonAt?.top ?? 0}px` }"
      @click.prevent.stop="openCommentBox"
    >Add Comment</div>

    <div
      id="comment-input"
      ref="commentInputEl"
      :style="{ display: inputAt ? 'block' : 'none', left: `${inputAt?.left ?? 0}px`, top: `${inputAt?.top ?? 0}px` }"
    >
      <div id="selected-text-preview" class="selected-text-preview">{{ selectionPreview }}</div>
      <textarea
        id="comment-textarea"
        ref="textareaEl"
        v-model="commentText"
        placeholder="Add your feedback."
        @keydown="handleTextareaKeyDown"
      ></textarea>
      <div class="comment-actions">
        <button id="cancel-btn" class="cancel-btn" @click="hideCommentUI">Cancel</button>
        <button id="submit-btn" class="submit-btn" @click="submitComment">Add Comment</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { transport } from '../core/runtimeTransport';
import { sanitizePlanHtml } from '../core/planPreviewPage';

const rootEl = ref<HTMLElement | null>(null);
const contentEl = ref<HTMLElement | null>(null);
const commentBtnEl = ref<HTMLElement | null>(null);
const commentInputEl = ref<HTMLElement | null>(null);
const textareaEl = ref<HTMLTextAreaElement | null>(null);

const commentsEnabled = ref(false);
const buttonAt = ref<{ left: number; top: number } | null>(null);
const inputAt = ref<{ left: number; top: number } | null>(null);
const selectionPreview = ref('');
const commentText = ref('');

let currentRange: Range | null = null;
let currentSelectedText = '';
let commentCount = 0;

/** A point below a rectangle, in the root's scrolled coordinates (the official adds window.scrollX/Y). */
function below(rect: DOMRect, gap: number): { left: number; top: number } {
  const root = rootEl.value!;
  const origin = root.getBoundingClientRect();
  return {
    left: rect.left - origin.left + root.scrollLeft,
    top: rect.bottom - origin.top + root.scrollTop + gap,
  };
}

/** The official `findSectionHeading`: the nearest heading before the node, walking up. */
function findSectionHeading(node: Node | null): string {
  let current: Node | null = node;
  while (current) {
    let sibling: Node | null = (current as Element).previousElementSibling ?? current.previousSibling;
    while (sibling) {
      if ((sibling as Element).tagName && /^H[1-6]$/.test((sibling as Element).tagName)) {
        return sibling.textContent || '';
      }
      sibling = (sibling as Element).previousElementSibling ?? sibling.previousSibling;
    }
    current = current.parentElement;
  }
  return '';
}

function hideCommentUI(): void {
  buttonAt.value = null;
  inputAt.value = null;
  commentText.value = '';
  currentRange = null;
  currentSelectedText = '';
}

/** A finished selection offers "Add Comment" under it; a click elsewhere hides the comment UI. */
function handleMouseUp(e: MouseEvent): void {
  if (!commentsEnabled.value) return;
  const target = e.target as Node | null;
  if (commentInputEl.value?.contains(target) || commentBtnEl.value?.contains(target)) return;
  const selection = window.getSelection();
  if (selection && selection.toString().trim() && selection.rangeCount > 0) {
    currentSelectedText = selection.toString().trim();
    currentRange = selection.getRangeAt(0).cloneRange();
    buttonAt.value = below(selection.getRangeAt(0).getBoundingClientRect(), 6);
    inputAt.value = null;
  } else {
    // A short delay lets a click on the button register first.
    setTimeout(() => {
      if (!commentInputEl.value?.contains(document.activeElement)) hideCommentUI();
    }, 150);
  }
}

/** "Add Comment": show the box under the selection, with a preview of what was selected. */
async function openCommentBox(): Promise<void> {
  if (!currentRange || !currentSelectedText) return;
  const rect = currentRange.getBoundingClientRect();
  selectionPreview.value = currentSelectedText.length > 120 ? currentSelectedText.slice(0, 120) + '…' : currentSelectedText;
  const at = below(rect, 8);
  const width = rootEl.value?.clientWidth ?? window.innerWidth;
  inputAt.value = { left: Math.max(8, Math.min(at.left, width - 350)), top: at.top };
  buttonAt.value = null;
  await nextTick();
  textareaEl.value?.focus();
}

/** Mark the text, number the comment, and send it to the host. */
function submitComment(): void {
  const text = commentText.value.trim();
  if (!text || !currentRange) return;
  const heading = findSectionHeading(currentRange.startContainer);
  const commentId = 'comment-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  try {
    const mark = document.createElement('mark');
    mark.dataset.commentId = commentId;
    commentCount++;
    const indicator = document.createElement('span');
    indicator.className = 'comment-indicator';
    indicator.textContent = String(commentCount);
    indicator.title = text;
    currentRange.surroundContents(mark);
    mark.appendChild(indicator);
  } catch {
    // surroundContents fails when the selection crosses elements; skip the highlight.
  }
  transport.postRaw({
    type: 'comment',
    id: commentId,
    selectedText: currentSelectedText,
    sectionHeading: heading,
    comment: text,
  });
  hideCommentUI();
  window.getSelection()?.removeAllRanges();
}

/** Enter submits, Shift+Enter is a newline, Escape closes the box. */
function handleTextareaKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitComment();
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    hideCommentUI();
  }
}

/** The host's messages: new content, comments on or off, a comment removed from the prompt. */
function handleHostMessage(event: MessageEvent): void {
  const msg = event.data as { type?: string; html?: string; enabled?: boolean; commentId?: string } | null;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'updateContent' && msg.html) {
    if (contentEl.value) contentEl.value.innerHTML = sanitizePlanHtml(msg.html);
    commentCount = 0;
  } else if (msg.type === 'setCommentsEnabled') {
    commentsEnabled.value = !!msg.enabled;
    if (!commentsEnabled.value) hideCommentUI();
  } else if (msg.type === 'removeComment' && msg.commentId) {
    const mark = contentEl.value?.querySelector(`mark[data-comment-id="${CSS.escape(msg.commentId)}"]`);
    if (mark) {
      const parent = mark.parentNode!;
      while (mark.firstChild) {
        if ((mark.firstChild as Element).className === 'comment-indicator') mark.removeChild(mark.firstChild);
        else parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
    }
  }
}

onMounted(() => {
  window.addEventListener('message', handleHostMessage);
  // Tell the host the page can receive its content.
  transport.postRaw({ type: 'ready' });
});

onBeforeUnmount(() => {
  window.removeEventListener('message', handleHostMessage);
});
</script>

<style>
/*
  The official page's stylesheet (zd$), scoped to this page's root. Colours are
  VS Code theme variables, as in the official; fonts and shadows go through
  Forge's tokens.
*/
.forge-plan-preview {
  position: relative;
  box-sizing: border-box;
  height: 100vh;
  overflow: auto;
  font-family: var(--forge-font-sans);
  font-size: var(--vscode-markdown-font-size, 14px);
  line-height: 1.6;
  color: var(--vscode-editor-foreground);
  background: var(--vscode-editor-background);
  padding: 16px 24px;
  margin: 0;
}
.forge-plan-preview h1,
.forge-plan-preview h2,
.forge-plan-preview h3,
.forge-plan-preview h4,
.forge-plan-preview h5,
.forge-plan-preview h6 {
  color: var(--vscode-editor-foreground);
  margin-top: 24px;
  margin-bottom: 8px;
  font-weight: 600;
}
.forge-plan-preview h1 { font-size: 1.6em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 8px; }
.forge-plan-preview h2 { font-size: 1.3em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 6px; }
.forge-plan-preview h3 { font-size: 1.1em; }
.forge-plan-preview code {
  font-family: var(--app-monospace-font-family);
  font-size: var(--vscode-editor-font-size, 13px);
  background: var(--vscode-textCodeBlock-background);
  padding: 2px 4px;
  border-radius: 3px;
}
.forge-plan-preview pre {
  background: var(--vscode-textCodeBlock-background);
  padding: 12px;
  border-radius: 4px;
  overflow-x: auto;
}
.forge-plan-preview pre code { background: none; padding: 0; }
.forge-plan-preview blockquote {
  border-left: 3px solid var(--vscode-textBlockQuote-border);
  margin: 8px 0;
  padding: 4px 12px;
  color: var(--vscode-textBlockQuote-foreground);
}
.forge-plan-preview a { color: var(--vscode-textLink-foreground); }
.forge-plan-preview a:hover { color: var(--vscode-textLink-activeForeground); }
.forge-plan-preview ul,
.forge-plan-preview ol { padding-left: 32px; }
.forge-plan-preview li { margin: 4px 0; }
.forge-plan-preview table { border-collapse: collapse; width: 100%; }
.forge-plan-preview th,
.forge-plan-preview td { border: 1px solid var(--vscode-panel-border); padding: 6px 12px; text-align: left; }
.forge-plan-preview th { background: var(--vscode-textCodeBlock-background); }
.forge-plan-preview hr { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 16px 0; }
.forge-plan-preview mark {
  background: color-mix(in srgb, var(--vscode-editor-findMatchHighlightBackground) 60%, transparent);
  border-radius: 2px;
  padding: 1px 0;
  position: relative;
}
.forge-plan-preview mark .comment-indicator {
  display: inline-block;
  width: 14px;
  height: 14px;
  background: var(--vscode-textLink-foreground);
  color: var(--vscode-editor-background);
  border-radius: 50%;
  font-size: 10px;
  line-height: 14px;
  text-align: center;
  margin-left: 2px;
  cursor: pointer;
  vertical-align: middle;
}

.forge-plan-preview #comment-btn {
  position: absolute;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  z-index: 100;
  box-shadow: 0 2px 8px var(--forge-shadow-heavy);
}
.forge-plan-preview #comment-btn:hover { background: var(--vscode-button-hoverBackground); }

.forge-plan-preview #comment-input {
  position: absolute;
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
  border-radius: 6px;
  padding: 12px;
  z-index: 101;
  width: 320px;
  box-shadow: 0 4px 16px var(--forge-shadow-heavy);
}
.forge-plan-preview #comment-input .selected-text-preview {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  border-left: 2px solid var(--vscode-textBlockQuote-border);
  padding: 4px 8px;
  margin-bottom: 8px;
  max-height: 60px;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
}
.forge-plan-preview #comment-input textarea {
  width: 100%;
  min-height: 60px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: 3px;
  padding: 6px 8px;
  font-family: var(--forge-font-sans);
  font-size: 13px;
  resize: vertical;
  box-sizing: border-box;
}
.forge-plan-preview #comment-input textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
.forge-plan-preview .comment-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  justify-content: flex-end;
}
.forge-plan-preview .comment-actions button {
  padding: 4px 12px;
  border-radius: 3px;
  font-size: 12px;
  cursor: pointer;
  border: none;
}
.forge-plan-preview .comment-actions .submit-btn {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}
.forge-plan-preview .comment-actions .submit-btn:hover { background: var(--vscode-button-hoverBackground); }
.forge-plan-preview .comment-actions .cancel-btn {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}
.forge-plan-preview .comment-actions .cancel-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }

.forge-plan-preview #comment-banner {
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-editorWidget-border);
  border-radius: 4px;
  padding: 8px 12px;
  margin-bottom: 16px;
  font-size: var(--vscode-font-size);
  color: var(--vscode-editor-foreground);
}
.forge-plan-preview #comment-banner .banner-hint {
  opacity: 0.8;
  font-size: 0.85em;
}
</style>
