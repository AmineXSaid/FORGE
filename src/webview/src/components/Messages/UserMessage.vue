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
        <ExpandableText :max-height="60">{{ displayContent }}</ExpandableText>
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
import { computed, ref } from 'vue';
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


/** Image and document blocks, rendered by the content-block renderer as the official does (its jK). */
const attachmentBlocks = computed(() =>
  Array.isArray(props.message.message.content)
    ? props.message.message.content.map((w) => w.content).filter((b) => b.type === 'image' || b.type === 'document')
    : []
);
</script>

