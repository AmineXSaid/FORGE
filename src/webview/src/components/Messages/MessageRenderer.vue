<template>
  <!-- One transcript row (official `Kt`): the row component itself, with no wrapper element. -->
  <component
    v-if="messageComponent"
    :is="messageComponent"
    :message="message"
    :context="context"
    v-bind="rowProps"
  />
</template>

<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import { effect } from 'alien-signals';
import type { Message } from '../../models/Message';
import type { ToolContext } from '../../types/tool';
import UserMessage from './UserMessage.vue';
import AssistantMessage from './AssistantMessage.vue';
import SystemMessage from './SystemMessage.vue';
import TipMessage from './TipMessage.vue';
import SlashCommandResultMessage from './SlashCommandResultMessage.vue';
import { getToolRenderer } from './tools/toolRegistry';

interface Props {
  message: Message;
  context: ToolContext;
  /** The session's busy flag, for the assistant status dot (official `p85`). */
  busy?: boolean;
  highlighted?: boolean;
}

const props = withDefaults(defineProps<Props>(), { busy: false, highlighted: false });

/** Official `Kt`: an assistant message made only of hidden tool calls has no row. */
function onlyHiddenTools(message: Message): boolean {
  const content = message.message.content;
  return (
    message.type === 'assistant' &&
    Array.isArray(content) &&
    content.length > 0 &&
    content.every((w) => w.content.type === 'tool_use' && getToolRenderer(w.content.name).hidden)
  );
}

// A streaming row changes emptiness in place (its text arrives, its tool_use
// completes), so re-evaluate `isEmpty` whenever one of its blocks updates.
const hasNoRow = ref(props.message.isEmpty || onlyHiddenTools(props.message));
watchEffect((onCleanup) => {
  const message = props.message;
  onCleanup(
    effect(() => {
      const content = message.message.content;
      if (Array.isArray(content)) {
        for (const wrapper of content) wrapper.revision();
      }
      hasNoRow.value = message.isEmpty || onlyHiddenTools(message);
    })
  );
});

const messageComponent = computed(() => {
  if (hasNoRow.value) return null;
  switch (props.message.type) {
    case 'user':
      return UserMessage;
    case 'assistant':
      return AssistantMessage;
    case 'tip':
      return TipMessage;
    case 'slash_command_result':
      return SlashCommandResultMessage;
    case 'system':
      return SystemMessage;
    default:
      return null;
  }
});

const rowProps = computed(() => {
  if (props.message.type === 'assistant') return { busy: props.busy, highlighted: props.highlighted };
  if (props.message.type === 'user') return { highlighted: props.highlighted };
  return {};
});
</script>
