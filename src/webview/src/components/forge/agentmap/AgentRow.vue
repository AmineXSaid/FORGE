<template>
  <!--
    The official `u55` (index.js @4802491):

      R("button",{type:"button",className:`${d1.serverItem} ${G4.row}`,onClick:Z,title:$.description,
        "data-agent-status":Y,children:[
          R("span",{className:G4.rowTitle,children:[F(vG,{state:R51(Y)}),F("span",{children:$.description})]}),
          F("span",{className:G4.rowMeta,children:F(az0,{agent:$})})]})

    `d1` is the MCP servers dialog module (IHCQeQ), `G4` the task module (iHnHpw).
    `az0` re-renders every second while the agent works (`uq`); `now` is that tick.
  -->
  <button
    type="button"
    class="fg-mcpdialog__serverItem fg-task__row"
    :title="agent.description"
    :data-agent-status="status"
    @click="emit('select')"
  >
    <span class="fg-task__rowTitle"><StatusDot :state="statusDotOf(status)" /><span>{{ agent.description }}</span></span>
    <span class="fg-task__rowMeta">{{ agentRowMeta(agent, now) }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import StatusDot from '../StatusDot.vue';
import { agentRowMeta, displayStatus, statusDotOf, type AgentMapAgent } from '../../../core/agentMap';

const props = defineProps<{ agent: AgentMapAgent; waiting: ReadonlySet<string>; now: number }>();
const emit = defineEmits<{ (e: 'select'): void }>();

/** The official `oC`. */
const status = computed(() => displayStatus(props.agent, props.waiting));
</script>
