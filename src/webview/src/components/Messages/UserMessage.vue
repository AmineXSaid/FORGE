<template>
  <!--
    The official user message (reference g85), element for element:

      div.message.userMessageContainer.stickyHeader   (data-transcript-message)
        h3.visuallyHidden.screenReaderTurnHeading     (the prompt, for screen readers)
        div.userMessageContainer
          div.userMessage
            div.userMessageAttachments                (only with attachments)
            <collapsible plain text, maxHeight 60>

    The official also mounts a "Message actions" button here whose options are
    Fork conversation from here / Rewind code to here / Fork conversation and
    rewind code. Forge has no fork or rewind backend, so the button is not
    rendered (a menu of actions that do nothing is worse than none). Forge's old
    click-to-edit and its "Restore checkpoint" button (an unimplemented TODO) are
    gone for the same reason: neither exists in the official transcript.
  -->
  <div
    data-transcript-message=""
    class="fg-chat__message fg-chat__userMessageContainer"
    :class="{ 'fg-chat__stickyHeader': hasText }"
  >
    <h3 v-if="hasText" class="fg-vh__visuallyHidden fg-chat__screenReaderTurnHeading">{{ headingText }}</h3>
    <div v-if="hasText" class="fg-chat__userMessageContainer">
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
import { computed } from 'vue';
import type { Message } from '../../models/Message';
import type { ToolContext } from '../../types/tool';
import ContentBlock from './ContentBlock.vue';
import ExpandableText from '../forge/ExpandableText.vue';

interface Props {
  message: Message;
  context: ToolContext;
}

const props = defineProps<Props>();

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

