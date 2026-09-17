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
import { computed } from 'vue';
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
  busy?: boolean;
  highlighted?: boolean;
}

const props = withDefaults(defineProps<Props>(), { busy: false, highlighted: false });

/** Official `Kt`: an assistant message made only of hidden tool calls has no row. */
function onlyHiddenTools(message: Message): boolean {
  const content = message.message.content;
  return (
    Array.isArray(content) &&
    content.every((w) => w.content.type === 'tool_use' && getToolRenderer(w.content.name).hidden)
  );
}

const messageComponent = computed(() => {
  if (props.message.isEmpty) return null;
  switch (props.message.type) {
    case 'user':
      return UserMessage;
    case 'assistant':
      return onlyHiddenTools(props.message) ? null : AssistantMessage;
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
