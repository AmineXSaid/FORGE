<template>
  <!--
    The official assistant message (reference u85): a timeline row whose dot
    carries the status of its first tool use (p85) -- dotSuccess, dotFailure, or
    dotProgress while the session is still busy. A message without a tool use gets
    no status class and keeps the base grey dot. The ported chat stylesheet draws
    the dot and the rail; there is no avatar or gutter mark in the official transcript.
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
import { computed, ref, watchEffect } from 'vue';
import { effect } from 'alien-signals';
import type { Message } from '../../models/Message';
import type { ToolContext } from '../../types/tool';
import { messageStatus, statusDotClass, type MessageStatus } from '../../utils/messageStatus';
import ContentBlock from './ContentBlock.vue';

interface Props {
  message: Message;
  context: ToolContext;
  /** The session's busy flag: a tool use without a result is in progress only while busy. */
  busy?: boolean;
}

const props = defineProps<Props>();

// The tool results are signals, so re-run p85 whenever one lands (and when busy changes).
const status = ref<MessageStatus>(null);
watchEffect((onCleanup) => {
  const message = props.message;
  const busy = props.busy ?? false;
  onCleanup(
    effect(() => {
      status.value = messageStatus(message, busy);
    })
  );
});

const dotClass = computed(() => statusDotClass(status.value));
</script>
