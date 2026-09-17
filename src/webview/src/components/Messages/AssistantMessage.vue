<template>
  <!--
    The official assistant message (`u85`): a timeline row whose dot carries the
    status of the message's tool call, with each content block drawn inside it.

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
    <ContentBlock
      v-for="(wrapper, index) in wrappers"
      :key="index"
      :block="wrapper.content"
      :wrapper="wrapper"
      :context="context"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, shallowRef, watch } from 'vue';
import { effect } from 'alien-signals';
import { ContentBlockWrapper } from '../../models/ContentBlockWrapper';
import type { ToolResultBlock } from '../../models/ContentBlock';
import type { Message } from '../../models/Message';
import type { ToolContext } from '../../types/tool';
import ContentBlock from './ContentBlock.vue';

interface Props {
  message: Message;
  context: ToolContext;
  /** Whether the session is still working; an unanswered tool call is in progress only then. */
  busy?: boolean;
  highlighted?: boolean;
}

const props = withDefaults(defineProps<Props>(), { busy: false, highlighted: false });

const wrappers = computed<ContentBlockWrapper[]>(() => {
  const content = props.message.message.content;
  return typeof content === 'string' ? [new ContentBlockWrapper({ type: 'text', text: content })] : content;
});

/** The message's first tool call: the official status looks at that one only. */
const firstTool = computed(() => wrappers.value.find((w) => w.content.type === 'tool_use'));

// Follow that call's result signal, so the dot turns when the result lands.
const firstToolResult = shallowRef<ToolResultBlock | undefined>(undefined);
let stopResult: (() => void) | undefined;
watch(
  firstTool,
  (wrapper) => {
    stopResult?.();
    stopResult = undefined;
    firstToolResult.value = undefined;
    if (wrapper) stopResult = effect(() => { firstToolResult.value = wrapper.toolResult(); });
  },
  { immediate: true }
);
onScopeDispose(() => stopResult?.());

/** Official `p85`. */
const status = computed<'success' | 'failure' | 'progress' | null>(() => {
  if (!firstTool.value) return null;
  const result = firstToolResult.value;
  if (!result) return props.busy ? 'progress' : 'failure';
  return result.is_error ? 'failure' : 'success';
});

const dotClass = computed(() =>
  status.value === 'success'
    ? 'fg-chat__dotSuccess'
    : status.value === 'failure'
      ? 'fg-chat__dotFailure'
      : status.value === 'progress'
        ? 'fg-chat__dotProgress'
        : ''
);
</script>
