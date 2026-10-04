<template>
  <!--
    The official user message (reference g85), element for element:

      div.message.userMessageContainer.stickyHeader   (data-transcript-message)
        h3.visuallyHidden.screenReaderTurnHeading     (the prompt, for screen readers)
        div.userMessageContainer
          div.userMessage
            div.userMessageAttachments                (only with attachments)
            <collapsible plain text, maxHeight 60>

    The "Message actions" button (`HU0`) mounts as the **first child of the
    inner** `div.userMessageContainer`, before `div.userMessage`, exactly where
    the official puts it:

      R("div",{className:u0.userMessageContainer,children:[
        !V&&F(HU0,{session:J,message:Z,context:X,containerRef:H,promptText:K,
                   onCreateNewSession:U,onRewindError:q}),
        R("div",{className:u0.userMessage,children:[f,F(xq0,…)]})]})

    `containerRef` is the **outer** row's ref (`ref:H` on
    `div.message.userMessageContainer.stickyHeader`), which is what the hover
    listens on. `!V` is `!readOnly`; Forge renders the button only when it has a
    session to act on, which is the same condition in practice. Forge's old
    click-to-edit and its "Restore checkpoint" button (an unimplemented TODO)
    stay gone: neither exists in the official transcript.
  -->
  <div
    ref="rowEl"
    data-transcript-message=""
    class="fg-chat__message fg-chat__userMessageContainer"
    :class="{ 'fg-chat__stickyHeader': hasText, 'fg-chat__highlightedMessage': highlighted }"
  >
    <h3 v-if="hasText" class="fg-vh__visuallyHidden fg-chat__screenReaderTurnHeading">{{ headingText }}</h3>
    <div v-if="hasText" class="fg-chat__userMessageContainer">
      <MessageActions
        v-if="session && forkConversation"
        :session="session"
        :message="message"
        :container-ref="rowEl"
        :prompt-text="displayContent"
        :on-create-new-session="onCreateNewSession ?? noop"
        :on-rewind-error="onRewindError ?? noop"
        :fork-conversation="forkConversation"
      />
      <div class="fg-chat__userMessage">
        <div v-if="attachmentBlocks.length" class="fg-chat__userMessageAttachments">
          <ContentBlock v-for="(block, i) in attachmentBlocks" :key="i" :block="block" :context="context" />
        </div>
        <form v-if="editing" class="fg-resend__editor" @submit.prevent="sendEdited">
          <textarea
            ref="editorEl"
            v-model="draft"
            class="fg-resend__textarea"
            aria-label="Edit message"
            :rows="Math.min(10, Math.max(2, draft.split('\n').length))"
            @keydown.enter.exact.prevent="sendEdited"
            @keydown.escape.prevent="cancelEdit"
          />
          <div class="fg-resend__editorButtons">
            <span class="fg-resend__hint">Sends in a fork of this conversation</span>
            <button type="button" class="fg-resend__textButton" @click="cancelEdit">Cancel</button>
            <button type="submit" class="fg-resend__textButton fg-resend__primary" :disabled="!draft.trim()">Send</button>
          </div>
        </form>
        <ExpandableText v-else :max-height="60">{{ displayContent }}</ExpandableText>
      </div>
      <!-- Forge: Edit and Retry (2026-10-03). Both fork just before this
           message and send -- the edited text, or the same text again. -->
      <div v-if="canResend && !editing" class="fg-resend__actions">
        <button type="button" class="fg-resend__button" title="Edit and resend (in a fork of this conversation)" aria-label="Edit and resend" @click="startEdit">
          <span class="codicon codicon-edit" />
        </button>
        <button type="button" class="fg-resend__button" title="Retry this message (in a fork of this conversation)" aria-label="Retry this message" @click="retry">
          <span class="codicon codicon-refresh" />
        </button>
      </div>
    </div>
    <div v-else-if="attachmentBlocks.length" class="fg-chat__userMessageContainer">
      <div class="fg-chat__userMessage">
        <div class="fg-chat__userMessageAttachments">
          <ContentBlock v-for="(block, i) in attachmentBlocks" :key="i" :block="block" :context="context" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { clearAutoSend, markAutoSend, resumePointBefore } from '../../core/resend';
import type { Message } from '../../models/Message';
import type { Session } from '../../core/Session';
import type { ToolContext } from '../../types/tool';
import ContentBlock from './ContentBlock.vue';
import ExpandableText from '../forge/ExpandableText.vue';
import MessageActions from './MessageActions.vue';

interface Props {
  message: Message;
  context: ToolContext;
  highlighted?: boolean;
  /** Present once the transcript has a live conversation behind it (step 25). */
  session?: Session;
  onCreateNewSession?: (promptText: string) => void;
  onRewindError?: (message: string) => void;
  forkConversation?: (sessionId: string, promptText: string, resumeSessionAt?: string) => Promise<void>;
}

const props = withDefaults(defineProps<Props>(), { highlighted: false });

/** The official `containerRef`: the outer row, whose hover reveals the button. */
const rowEl = ref<HTMLElement | null>(null);

const noop = (): void => {};

// 显示内容（纯文本）
const displayContent = computed(() => {
  if (typeof props.message.message.content === 'string') {
    return props.message.message.content;
  }
  // 如果是 content blocks，提取文本
  if (Array.isArray(props.message.message.content)) {
    return props.message.message.content
      .map(wrapper => {
        const block = wrapper.content;
        if (block.type === 'text') {
          return block.text;
        }
        return '';
      })
      .join(' ');
  }
  return '';
});

const hasText = computed(() => displayContent.value.trim().length > 0);

/** The screen-reader heading the official derives from the prompt (first line, trimmed). */
const headingText = computed(() => {
  const first = displayContent.value.trim().split('\n')[0] ?? '';
  return first.length > 80 ? `${first.slice(0, 80)}\u2026` : first;
});


// ---- Edit and Retry --------------------------------------------------------

const editing = ref(false);
const draft = ref('');
const editorEl = ref<HTMLTextAreaElement | null>(null);

/** Only with a live conversation to fork, and a prompt to send. */
const canResend = computed(() => !!props.session && !!props.forkConversation && !!props.onCreateNewSession && hasText.value);

function startEdit(): void {
  draft.value = displayContent.value;
  editing.value = true;
  void nextTick(() => {
    const el = editorEl.value;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  });
}

function cancelEdit(): void {
  editing.value = false;
}

/** Fork just before this message and send `text` there. */
function resend(text: string): void {
  const session = props.session;
  if (!session || !text.trim()) return;
  const resumeAt = resumePointBefore(session.messages(), props.message);
  markAutoSend(text);
  if (resumeAt === undefined) {
    // The first message: nothing to fork from, so a fresh conversation.
    props.onCreateNewSession?.(text);
    return;
  }
  const sessionId = session.sessionId();
  if (!sessionId) {
    clearAutoSend();
    session.showNotification('Failed to resend: Unknown session id', 'error');
    return;
  }
  props.forkConversation?.(sessionId, text, resumeAt).catch((e: unknown) => {
    clearAutoSend();
    session.showNotification(`Failed to resend: ${e instanceof Error ? e.message : String(e)}`, 'error');
  });
}

function retry(): void {
  resend(displayContent.value);
}

function sendEdited(): void {
  const text = draft.value.trim();
  if (!text) return;
  editing.value = false;
  resend(text);
}

/** Image and document blocks, rendered by the content-block renderer as the official does (its jK). */
const attachmentBlocks = computed(() =>
  Array.isArray(props.message.message.content)
    ? props.message.message.content.map((w) => w.content).filter((b) => b.type === 'image' || b.type === 'document')
    : []
);
</script>

<style scoped>
/* Forge: Edit and Retry on a user message. Quiet until the row is hovered. */
.fg-resend__actions {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
  margin-top: 2px;
  opacity: 0;
  transition: opacity 0.12s ease;
}
.fg-chat__userMessageContainer:hover .fg-resend__actions,
.fg-resend__actions:focus-within {
  opacity: 1;
}
.fg-resend__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--app-secondary-foreground);
  cursor: pointer;
}
.fg-resend__button:hover {
  background: var(--app-list-hover-background, var(--forge-accent-subtle));
  color: var(--app-primary-foreground);
}
.fg-resend__button:focus-visible {
  outline: 1px solid var(--forge-accent);
  outline-offset: 1px;
}
.fg-resend__editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fg-resend__textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  font: inherit;
  line-height: 1.5;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid var(--forge-accent);
  background: var(--app-input-background);
  color: var(--app-input-foreground);
  outline: none;
}
.fg-resend__editorButtons {
  display: flex;
  align-items: center;
  gap: 6px;
}
.fg-resend__hint {
  flex: 1;
  font-size: 0.85em;
  color: var(--app-secondary-foreground);
}
.fg-resend__textButton {
  font: inherit;
  padding: 2px 10px;
  border-radius: 4px;
  border: 1px solid var(--app-widget-border);
  background: transparent;
  color: var(--app-primary-foreground);
  cursor: pointer;
}
.fg-resend__primary {
  background: var(--forge-accent);
  border-color: var(--forge-accent);
  color: var(--app-button-foreground, var(--app-primary-background));
}
.fg-resend__primary:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
