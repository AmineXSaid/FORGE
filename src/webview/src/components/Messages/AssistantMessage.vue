<template>
  <!--
    The official assistant message (`u85`): a timeline row whose dot carries the
    status of its first tool use (`p85`) -- dotSuccess, dotFailure, or dotProgress
    while the session is still busy. A message without a tool use gets no status
    class and keeps the base grey dot.

      div.message.timelineMessage.<dot>.[highlightedMessage]  (data-transcript-message)
        <content block>...

    The official also mounts a thumbs up / down rating row under text replies,
    behind an experiment gate and a rating endpoint Forge does not have, so it is
    not rendered here.
  -->
  <div
    data-testid="assistant-message"
    data-transcript-message=""
    :class="`fg-chat__message fg-chat__timelineMessage ${dotClass} ${highlighted ? 'fg-chat__highlightedMessage' : ''}`"
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
  /** The row whose tool call is waiting on the permission prompt (official `S85`). */
  highlighted?: boolean;
}

const props = withDefaults(defineProps<Props>(), { busy: false, highlighted: false });

// The tool results are signals, so re-run p85 whenever one lands (and when busy changes).
const status = ref<MessageStatus>(null);
watchEffect((onCleanup) => {
  const message = props.message;
  const busy = props.busy;
  onCleanup(
    effect(() => {
      status.value = messageStatus(message, busy);
    })
  );
});

const dotClass = computed(() => statusDotClass(status.value));
</script>
