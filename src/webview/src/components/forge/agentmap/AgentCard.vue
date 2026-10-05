<template>
  <!--
    The official agent card (`r55`, index.js @4805132) and its transcript view.
    Card: G1 (status line, "Spawned by …", time), then the live activity, the
    failure or result, "Prompt" and "Tool calls (n)" sections, and the actions
    "Open transcript" / "Stop agent". The transcript view is the same card at
    width 1000 with the subagent's transcript (`uz0`) inside.
  -->
  <AgentCardDialog
    v-if="view === 'transcript'"
    :on-back="() => (view = 'card')"
    :width="1000"
    focus-key="transcript"
    scroll-inside
  >
    <template #title>
      <span class="fg-task__transcriptHeader">
        <span class="fg-task__cardTitle"><StatusDot :state="statusDotOf(status)" /><span>{{ agent.description }}</span></span>
        <div class="fg-task__meta">{{ statusLine }}</div>
        <div class="fg-task__meta">Spawned by {{ parent ? parent.description : 'the main agent' }}</div>
        <div class="fg-task__meta">{{ agentRowMeta(agent, now) }}</div>
      </span>
    </template>
    <AgentTranscript :session="session" :agent="agent" :context="context" :running="running" />
  </AgentCardDialog>

  <AgentCardDialog v-else :on-back="onBack" focus-key="card">
    <template #title>
      <span class="fg-task__cardTitle"><StatusDot :state="statusDotOf(status)" /><span>{{ agent.description }}</span></span>
    </template>
    <div class="fg-task__meta">{{ statusLine }}</div>
    <div class="fg-task__meta">Spawned by {{ parent ? parent.description : 'the main agent' }}</div>
    <div class="fg-task__meta">{{ agentRowMeta(agent, now) }}</div>

    <div v-if="status === 'working' && pendingCall" class="fg-task__activity fg-task__toolCall">
      <span class="fg-task__activityLabel">Now</span><ToolHeader :block="pendingCall" :context="context" />
    </div>
    <div v-if="status === 'working' && !pendingCall && latestTool !== undefined" class="fg-task__activity">{{ latestTool }}</div>
    <div v-if="status === 'waiting'" class="fg-task__activity">Waiting for your permission{{ permission ? ` to run ${permission.toolName}` : '' }}. Answer it in the session's permission card.</div>
    <div v-if="failure !== undefined" class="fg-task__failure">{{ failure }}</div>
    <div v-if="result !== undefined" class="fg-task__result">{{ result }}</div>

    <div v-if="agent.prompt !== undefined" class="fg-task__section">
      <button type="button" class="fg-task__sectionHeader" :aria-expanded="promptOpen" @click="promptOpen = !promptOpen">
        <SectionToggleIcon />Prompt
      </button>
      <pre v-if="promptOpen" class="fg-task__prompt">{{ agent.prompt }}</pre>
    </div>
    <div class="fg-task__section">
      <button type="button" class="fg-task__sectionHeader" :aria-expanded="toolCallsOpen" @click="toolCallsOpen = !toolCallsOpen">
        <SectionToggleIcon />Tool calls ({{ toolCalls.length }})
      </button>
      <ul v-if="toolCallsOpen && toolCalls.length > 0" class="fg-task__toolCalls">
        <!-- `i55` -->
        <li v-for="(call, i) in toolCalls" :key="toolUseIdOf(call) ?? i" class="fg-task__toolCall">
          <StatusDot v-if="permission?.toolUseId !== undefined && permission.toolUseId === toolUseIdOf(call)" state="waiting" />
          <StatusDot v-else-if="running && call.toolResult() === undefined" state="running" />
          <span v-else class="fg-task__toolCallSpacer"></span>
          <ToolHeader :block="call" :context="context" />
        </li>
      </ul>
    </div>

    <div class="fg-task__actions">
      <button type="button" class="fg-mcpdialog__actionButton" @click="view = 'transcript'">Open transcript</button>
      <button
        v-if="running"
        type="button"
        class="fg-mcpdialog__actionButton fg-task__dangerButton"
        :disabled="stopping"
        @click="stop"
      >{{ stopping ? 'Stopping…' : 'Stop agent' }}</button>
    </div>
    <div v-if="stopFailed" class="fg-task__failure">The agent could not be stopped. It may have finished already.</div>
  </AgentCardDialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useSignal } from '@gn8/alien-signals-vue';
import AgentCardDialog from './AgentCardDialog.vue';
import AgentTranscript from './AgentTranscript.vue';
import ToolHeader from './ToolHeader';
import StatusDot from '../StatusDot.vue';
import SectionToggleIcon from '../icons/SectionToggleIcon.vue';
import {
  AGENT_STATUS_LABELS,
  agentModelLabel,
  agentReportOf,
  agentRowMeta,
  agentRows,
  agentToolCalls,
  agentToolUseIds,
  displayStatus,
  findToolUse,
  lastAgentText,
  notificationResultOf,
  spawningAgent,
  statusDotOf,
  toolResultText,
  type AgentMap,
  type AgentMapAgent,
} from '../../../core/agentMap';
import { formatModelId } from '../modelCatalog';
import type { Session } from '../../../core/Session';
import type { ToolContext } from '../../../types/tool';
import type { ContentBlockWrapper } from '../../../models/ContentBlockWrapper';

const props = defineProps<{
  session: Session;
  context: ToolContext;
  agents: AgentMap;
  agent: AgentMapAgent;
  waiting: ReadonlySet<string>;
  now: number;
  /** The official `RK1(session)`: the fallback when the Agent call names no model. */
  mainModelLabel: string | undefined;
  onBack: () => void;
}>();

const messages = useSignal(props.session.messages);
const subagentTasks = useSignal(props.session.subagentTasks);
const permissionRequests = useSignal(props.session.permissionRequests);

const view = ref<'card' | 'transcript'>('card');
const promptOpen = ref(props.agent.status === 'working');
const toolCallsOpen = ref(true);
const stopping = ref(false);
const stopFailed = ref(false);

/** `P = oC(Y, X)`. */
const status = computed(() => displayStatus(props.agent, props.waiting));
/** `y`: the agent is still going. */
const running = computed(() => status.value === 'working' || status.value === 'waiting');
/** `N = No(M, iC(Y))`: the agent's own rows. */
const rows = computed(() => agentRows(messages.value, agentToolUseIds(props.agent)));
/** `O = l55(N)`. */
const toolCalls = computed(() => agentToolCalls<ContentBlockWrapper>(rows.value));
/** `_ = a55(M, Y.toolUseId)`: the Agent call that spawned it. */
const spawnCall = computed(() => findToolUse(messages.value, props.agent.toolUseId));
/** `T`: what a finished agent reported. */
const result = computed(() =>
  status.value === 'finished'
    ? lastAgentText(rows.value) ??
      props.agent.result ??
      notificationResultOf(messages.value, props.agent.taskId) ??
      agentReportOf(toolResultText(spawnCall.value?.toolResult?.())) ??
      props.agent.summary
    : undefined
);
/** `E = LR1(Z, Y)`. */
const parent = computed(() => spawningAgent(props.agents, props.agent));
/** `f`: the Agent call's `model`, else the session's. */
const model = computed(() => {
  const input = spawnCall.value?.content.type === 'tool_use' ? spawnCall.value.content.input : undefined;
  const named = input !== null && typeof input === 'object' && 'model' in input ? (input as { model?: unknown }).model : undefined;
  return typeof named === 'string' ? agentModelLabel(named, formatModelId) : props.mainModelLabel;
});
/** `i`: the call it is waiting on. */
const pendingCall = computed(() => {
  if (!running.value) return undefined;
  const calls = toolCalls.value;
  for (let i = calls.length - 1; i >= 0; i--) if (calls[i].toolResult() === undefined) return calls[i];
  return undefined;
});

function toolUseIdOf(call: ContentBlockWrapper): string | undefined {
  return call.content.type === 'tool_use' ? call.content.id : undefined;
}
/** `S`: its latest tool, from `task_progress`. */
const latestTool = computed(() => subagentTasks.value.get(props.agent.taskId)?.recentTools?.at(-1));
/** `m`: its pending permission request. */
const permission = computed(() => permissionRequests.value.find((p) => p.agentId === props.agent.taskId));
/** `B1`. */
const failure = computed(() =>
  status.value === 'failed'
    ? props.agent.error ?? props.agent.summary
    : status.value === 'stopped' && props.agent.summary !== undefined && props.agent.summary !== props.agent.description
      ? props.agent.summary
      : undefined
);
/** The first line of `G1`. */
const statusLine = computed(() =>
  [
    AGENT_STATUS_LABELS[status.value],
    props.agent.subagentType,
    model.value,
    props.agent.isBackgrounded === undefined ? undefined : props.agent.isBackgrounded ? 'background' : 'foreground',
  ]
    .filter((part) => part !== undefined)
    .join(' · ')
);

function stop(): void {
  stopping.value = true;
  stopFailed.value = false;
  props.session.stopSubagent(props.agent.taskId).then(
    () => (stopping.value = false),
    () => {
      stopping.value = false;
      stopFailed.value = true;
    }
  );
}
</script>
