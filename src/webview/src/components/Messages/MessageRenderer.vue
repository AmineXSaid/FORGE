<template>
  <component
    v-if="!isEmpty"
    :is="messageComponent"
    :message="message"
    :context="context"
    v-bind="message.type === 'assistant' ? { busy } : {}"
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

interface Props {
  message: Message;
  context: ToolContext;
  /** The session's busy flag, for the assistant status dot (official `p85`). */
  busy?: boolean;
}

const props = defineProps<Props>();

// A streaming row changes emptiness in place (its text arrives, its tool_use
// completes), so re-evaluate `isEmpty` whenever one of its blocks updates.
const isEmpty = ref(props.message.isEmpty);
watchEffect((onCleanup) => {
  const message = props.message;
  onCleanup(
    effect(() => {
      const content = message.message.content;
      if (Array.isArray(content)) {
        for (const wrapper of content) wrapper.revision();
      }
      isEmpty.value = message.isEmpty;
    })
  );
});

// 根据消息类型选择渲染组件
const messageComponent = computed(() => {
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
</script>

<style scoped>
  .message {
    margin-bottom: 4px;
  }
</style>
