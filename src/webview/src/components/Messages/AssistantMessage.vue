<template>
  <!--
    The official assistant message (reference u85): a timeline row whose dot
    carries the turn status -- dotSuccess, dotFailure, or dotProgress while the
    message is still streaming. The ported chat stylesheet draws the dot and the
    rail; there is no avatar or gutter mark in the official transcript.
  -->
  <div
    data-testid="assistant-message"
    data-transcript-message=""
    class="fg-chat__message fg-chat__timelineMessage"
    :class="dotClass"
  >
    <template v-if="typeof message.message.content === 'string'">
      <ContentBlock :block="{ type: 'text', text: message.message.content }" :context="context" />
    </template>
    <template v-else>
      <ContentBlock
        v-for="wrapper in message.message.content"
        :key="wrapper.id"
        :block="wrapper.content"
        :wrapper="wrapper"
        :context="context"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Message } from '../../models/Message';
import type { ToolContext } from '../../types/tool';
import ContentBlock from './ContentBlock.vue';

interface Props {
  message: Message;
  context: ToolContext;
}

const props = defineProps<Props>();

/**
 * The status dot. A message that is still arriving is in progress; one whose
 * content includes a failed tool result is a failure; otherwise success.
 */
const dotClass = computed(() => {
  const content = props.message.message.content;
  if (Array.isArray(content) && content.some((w) => (w as { isPartial?: boolean }).isPartial)) {
    return 'fg-chat__dotProgress';
  }
  if (Array.isArray(content) && content.some((w) => (w.content as { is_error?: boolean }).is_error)) {
    return 'fg-chat__dotFailure';
  }
  return 'fg-chat__dotSuccess';
});
</script>

