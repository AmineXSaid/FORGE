<template>
  <!--
    The official subagent transcript (`uz0`, index.js @4794245): the agent's
    transcript read from disk (`getSubagentTranscript`), merged with the rows
    that arrived live in this window (`_z0`), drawn read-only by the transcript
    row renderer. Without the official's `IS_ANT` grouping every row stands
    alone (`Eo` -> one group per row), so no fold rows.
  -->
  <div v-if="rows === undefined" class="fg-agenttranscript__notice">Loading…</div>
  <div v-else class="fg-agenttranscript__transcript">
    <div v-if="readFailed" class="fg-agenttranscript__notice">The agent's earlier messages could not be read; showing what has arrived in this window.</div>
    <div class="fg-chat__messagesContainer fg-agenttranscript__rows">
      <div class="fg-chat__turn">
        <MessageRenderer v-for="(row, i) in rows" :key="row.uuid ?? `row-${i}`" :message="row" :context="context" :busy="running" />
        <div v-if="running" class="fg-chat__spinnerRow">
          <div><Spinner :size="16" :permission-mode="permissionMode" :messages="rows" /></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useSignal } from '@gn8/alien-signals-vue';
import MessageRenderer from '../../Messages/MessageRenderer.vue';
import Spinner from '../../Messages/WaitingIndicator.vue';
import { Message } from '../../../models/Message';
import { ContentBlockWrapper } from '../../../models/ContentBlockWrapper';
import { processAndAttachMessage } from '../../../utils/messageUtils';
import { agentRows, agentToolUseIds, mergeAgentTranscript, type AgentMapAgent } from '../../../core/agentMap';
import type { Session } from '../../../core/Session';
import type { ToolContext } from '../../../types/tool';

const props = defineProps<{ session: Session; agent: AgentMapAgent; context: ToolContext; running: boolean }>();

const messages = useSignal(props.session.messages);
const permissionMode = useSignal(props.session.permissionMode);

/** `X`: the stored transcript, undefined while loading. */
const stored = ref<unknown[] | undefined>(undefined);
/** `G`: the read failed; only the live rows are shown. */
const readFailed = ref(false);

watch(
  () => props.agent.taskId,
  (taskId, _old, onCleanup) => {
    let cancelled = false;
    onCleanup(() => (cancelled = true));
    stored.value = undefined;
    readFailed.value = false;
    props.session.getSubagentTranscript(taskId).then(
      (list) => {
        if (!cancelled) stored.value = list;
      },
      () => {
        if (cancelled) return;
        stored.value = [];
        readFailed.value = true;
      }
    );
  },
  { immediate: true }
);

/**
 * The official `Oz0`: the stored messages as rows, each re-parented to the top
 * level (`parent_tool_use_id:null`) because here the agent is the main thread.
 * A synthetic or meta user row stays marked synthetic.
 */
function buildRows(list: unknown[]): Message[] {
  const out: Message[] = [];
  for (const raw of list as Array<Record<string, unknown>>) {
    if (raw.type === 'user') {
      processAndAttachMessage(out, { ...raw, parent_tool_use_id: null, isSynthetic: raw.isSynthetic === true || raw.is_meta === true });
    } else if (raw.type === 'assistant') {
      processAndAttachMessage(out, { ...raw, parent_tool_use_id: null });
    }
  }
  return out;
}

/** `W = No(V, iC(J))`: the rows that arrived live. */
const live = computed(() => agentRows(messages.value, agentToolUseIds(props.agent)));
/** `K = _z0({built, live, prompt})`. */
const rows = computed(() => {
  if (stored.value === undefined) return undefined;
  const prompt = props.agent.prompt;
  return mergeAgentTranscript(
    buildRows(stored.value),
    live.value,
    prompt !== undefined && prompt !== ''
      ? () => new Message('user', { role: 'user', content: [new ContentBlockWrapper({ type: 'text', text: prompt })] }, Date.now())
      : undefined
  );
});
</script>
