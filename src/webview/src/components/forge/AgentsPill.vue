<template>
  <!--
    The official agents pill (`z75`, index.js @5003571), shown in the composer
    footer while the agent map has any agent:

      R("button",{type:"button",className:`${X7.modelPill} ${xy.agentsPill}`,onClick:Z,title:X,
        "data-agents-dot":J,"aria-label":`${Y} · ${X}`,children:[
          F("span",{className:xy.icon,children:F(Qt,{})}),
          F(vG,{state:J,className:xy.dot}),
          F("span",{className:xy.label,children:Y})]})

    `X7.modelPill` is the model pill's own class (footer module), `xy` the
    EGyesg module (styles/official/agentspill.css). The icon only shows at the
    footer's narrow fit stages; at full width it is the dot and the label.
  -->
  <button
    type="button"
    class="fg-footer__modelPill fg-agentspill__agentsPill"
    :title="tooltip"
    :data-agents-dot="dot"
    :aria-label="`${label} · ${tooltip}`"
    @click="emit('open')"
  >
    <span class="fg-agentspill__icon"><AgentsIcon /></span>
    <StatusDot :state="dot" class="fg-agentspill__dot" />
    <span class="fg-agentspill__label">{{ label }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AgentsIcon from './icons/AgentsIcon.vue';
import StatusDot from './StatusDot.vue';
import { agentsPillLabel, agentsPillTooltip } from '../../core/agentMap';

const props = defineProps<{
  /** `agentMapAgents.size`. */
  count: number;
  /** The official `wR1`. */
  dot: 'running' | 'waiting' | 'idle';
}>();

const emit = defineEmits<{ (e: 'open'): void }>();

/** The official `zF1`. */
const label = computed(() => agentsPillLabel(props.count));
const tooltip = computed(() => agentsPillTooltip(props.dot));
</script>
