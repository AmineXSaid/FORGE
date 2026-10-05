<template>
  <!--
    The official Agent map (`cz0`, index.js @4800652):

      R(i7,{title:"Agent map",onClose:Y,maxWidth:1200,scrollInside:!0,children:[
        R("div",{className:G4.subtitle,children:[H," ",NY(H,"agent")," · click an agent for details"]}),
        F("div",{className:G4.tree,children:R("div",{className:G4.node,children:[
          F(g55,{session:$,onClick:()=>Q({kind:"main"})}),
          V.length>0&&F("div",{className:G4.children,children:V.map((B)=>F(lz0,{node:B,waiting:U,…}))})]})}),
        X?.kind==="main"&&F(c55,{…}),
        W&&F(r55,{…})]})

    `q = RR1(agentMapAgents, messages)` fills parents the start event did not
    know; `V = OR1(q)` is the tree; `U = nC(permissionRequests)`.
  -->
  <ForgeDialog title="Agent map" :on-close="onClose" :max-width="1200" scroll-inside>
    <div class="fg-task__subtitle">{{ agents.size }} {{ agents.size === 1 ? 'agent' : 'agents' }} · click an agent for details</div>
    <div class="fg-task__tree">
      <div class="fg-task__node">
        <!-- `g55`: the main thread's row. -->
        <button
          type="button"
          class="fg-mcpdialog__serverItem fg-task__row fg-task__rowMain"
          :title="sessionTitle"
          @click="selected = { kind: 'main' }"
        >
          <span class="fg-task__rowTitle"><StatusDot :state="busy ? 'running' : 'idle'" /><span>{{ sessionTitle }}</span></span>
          <span class="fg-task__rowMeta">{{ mainMeta }}</span>
        </button>
        <div v-if="tree.length > 0" class="fg-task__children">
          <AgentTreeNode
            v-for="node in tree"
            :key="node.agent.taskId"
            :node="node"
            :waiting="waiting"
            :now="now"
            @select="(key: string) => (selected = { kind: 'agent', key })"
          />
        </div>
      </div>
    </div>

    <!-- `c55`: the main thread's card. -->
    <AgentCardDialog v-if="selected?.kind === 'main'" :on-back="back">
      <template #title>
        <span class="fg-task__cardTitle"><StatusDot :state="busy ? 'running' : 'idle'" /><span>{{ sessionTitle }}</span></span>
      </template>
      <div class="fg-task__meta">{{ [busy ? 'Working' : 'Idle', modelLabel, contextTokens].filter((p) => p !== undefined).join(' · ') }}</div>
      <div class="fg-task__counts">{{ agents.size }} {{ agents.size === 1 ? 'agent' : 'agents' }}</div>
      <div v-for="line in countLines" :key="line" class="fg-task__meta">{{ line }}</div>
    </AgentCardDialog>

    <AgentCard
      v-if="selectedAgent"
      :session="session"
      :context="context"
      :agents="agents"
      :agent="selectedAgent"
      :waiting="waiting"
      :now="now"
      :main-model-label="modelLabel"
      :on-back="back"
    />
  </ForgeDialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useSignal } from '@gn8/alien-signals-vue';
import ForgeDialog from '../ForgeDialog.vue';
import StatusDot from '../StatusDot.vue';
import AgentTreeNode from './AgentTreeNode.vue';
import AgentCardDialog from './AgentCardDialog.vue';
import AgentCard from './AgentCard.vue';
import { agentKey } from './agentKey';
import {
  AGENT_STATUS_LABELS,
  agentsAwaitingPermission,
  buildAgentTree,
  fillParents,
  formatTokens,
  statusCounts,
  type AgentDisplayStatus,
} from '../../../core/agentMap';
import { findModelRow, rowPillLabel } from '../modelCatalog';
import type { Session } from '../../../core/Session';
import type { ToolContext } from '../../../types/tool';

const props = defineProps<{
  session: Session;
  context: ToolContext;
  onClose: () => void;
  /** Forge's tasks tray "Transcript": open on this agent's card. */
  initialAgentKey?: string;
}>();

const messages = useSignal(props.session.messages);
const agentMapAgents = useSignal(props.session.agentMapAgents);
const permissionRequests = useSignal(props.session.permissionRequests);
const busy = useSignal(props.session.busy);
const summary = useSignal(props.session.summary);
const usageData = useSignal(props.session.usageData);
const claudeConfig = useSignal(props.session.claudeConfig);
const modelSelection = useSignal(props.session.modelSelection);

const selected = ref<{ kind: 'main' } | { kind: 'agent'; key: string } | null>(
  props.initialAgentKey ? { kind: 'agent', key: props.initialAgentKey } : null
);
const back = () => (selected.value = null);

/** `uq`: the dialog re-renders every second, so running times count up. */
const now = ref(Date.now());
const tick = setInterval(() => (now.value = Date.now()), 1000);
onBeforeUnmount(() => clearInterval(tick));

/** `q = RR1(z, G)`. */
const agents = computed(() => fillParents(agentMapAgents.value, messages.value));
/** `U = nC(permissionRequests)`. */
const waiting = computed(() => agentsAwaitingPermission(permissionRequests.value));
/** `V = OR1(q)`. */
const tree = computed(() => buildAgentTree(agents.value));
const selectedAgent = computed(() => {
  const sel = selected.value;
  return sel?.kind === 'agent' ? [...agents.value.values()].find((a) => agentKey(a) === sel.key) : undefined;
});

const sessionTitle = computed(() => summary.value ?? 'This session');
/** The official `RK1`: the session model's name. */
const modelLabel = computed(() => {
  const models = claudeConfig.value?.models;
  const row = models ? findModelRow(models, modelSelection.value) : undefined;
  return row ? rowPillLabel(row, undefined) : undefined;
});
/** The official `rz0`. */
const contextTokens = computed(() => `${formatTokens(usageData.value.totalTokens)} tokens in context`);
const mainMeta = computed(() => [modelLabel.value, contextTokens.value].filter((p) => p !== undefined).join(' · '));

/** `c55`: "2 working", "1 finished" … for each non-zero count (`NR1`). */
const countLines = computed(() =>
  (Object.entries(statusCounts(agents.value, waiting.value)) as Array<[AgentDisplayStatus, number]>)
    .filter(([, n]) => n > 0)
    .map(([status, n]) => `${n} ${AGENT_STATUS_LABELS[status].toLowerCase()}`)
);
</script>
