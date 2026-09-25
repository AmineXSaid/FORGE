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
import type { Session } from '../../core/Session';
import type { ToolContext } from '../../types/tool';
import type { ClaimSummary } from '../../core/claimCheck';
import UserMessage from './UserMessage.vue';
import AssistantMessage from './AssistantMessage.vue';
import SystemMessage from './SystemMessage.vue';
import TipMessage from './TipMessage.vue';
import SlashCommandResultMessage from './SlashCommandResultMessage.vue';
import MetaMessage from './MetaMessage.vue';
import { getToolRenderer } from './tools/toolRegistry';

interface Props {
  message: Message;
  context: ToolContext;
  /** The session's busy flag, for the assistant status dot (official `p85`). */
  busy?: boolean;
  highlighted?: boolean;
  /**
   * A4's claim summary, set only on the final assistant message of a finished
   * turn and only when something it claimed has no matching tool call.
   * Forge-only; the official host has no equivalent.
   */
  claims?: ClaimSummary;
  /**
   * The conversation this row belongs to, and the three callbacks the official
   * `Kt` hands `g85` (`setInputError`, `onCreateNewSession`) plus the context's
   * `forkConversation`. Only the user row uses them, for its "Message actions"
   * button (step 25); without a session the button is not rendered, which is
   * also how the official's `readOnly` transcript behaves.
   */
  session?: Session;
  onCreateNewSession?: (promptText: string) => void;
  onRewindError?: (message: string) => void;
  forkConversation?: (sessionId: string, promptText: string, resumeSessionAt?: string) => Promise<void>;
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
  // The official `Kt`: `if(J.parentToolUseId&&(!V||!J.content.some(…"text")))return null`.
  // A user message inside a subagent -- the prompt the model wrote for it, or
  // its tool results -- is not the user's, so it draws no row. `V` (readOnly)
  // is the official's subagent transcript viewer, which Forge does not have.
  // Only user-born messages carry `parentToolUseId` from `fromRaw`, including
  // the ones `getSpecialMessageType` retyped.
  if (props.message.parentToolUseId && props.message.type !== 'assistant') return null;
  switch (props.message.type) {
    case 'user':
      return UserMessage;
    case 'assistant':
      return AssistantMessage;
    case 'tip':
      return TipMessage;
    case 'slash_command_result':
      return SlashCommandResultMessage;
    // Official `Kt`: `if(J.type==="meta")return F(m85,{message:J},Z)`.
    case 'meta':
      return MetaMessage;
    case 'system':
      return SystemMessage;
    default:
      return null;
  }
});

const rowProps = computed(() => {
  if (props.message.type === 'assistant') {
    return { busy: props.busy, highlighted: props.highlighted, claims: props.claims };
  }
  if (props.message.type === 'user') {
    return {
      highlighted: props.highlighted,
      session: props.session,
      onCreateNewSession: props.onCreateNewSession,
      onRewindError: props.onRewindError,
      forkConversation: props.forkConversation,
    };
  }
  return {};
});
</script>
