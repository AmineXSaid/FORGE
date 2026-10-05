<template>
  <!--
    The official `IK1` (index.js @4856350): in focus view, the subagents still
    running, under the fold that holds their Agent call (or at the end of the
    transcript). Up to four rows; past that, three and a "+N more agents" row.

      R("div",{className:`${$H.focusFoldRow} ${u0.timelineMessage} ${u0.dotProgress} ${bK1.subagentRow}`,
        "data-testid":"focus-subagent-row",children:[
          F("label",{className:$H.runningLabel,children:Lz0($)}),
          F("span",{children:Iz0($,Date.now())})]})

    Both rows tick every second (`uq`).
  -->
  <template v-if="tasks && tasks.length > 0">
    <div
      v-for="task in split.visible"
      :key="task.taskId"
      class="fg-focusfold__focusFoldRow fg-chat__timelineMessage fg-chat__dotProgress fg-subagentrow__subagentRow"
      data-testid="focus-subagent-row"
    >
      <label class="fg-focusfold__runningLabel">{{ subagentRowLabel(task) }}</label>
      <span>{{ subagentRowMeta(task, now) }}</span>
    </div>
    <div
      v-if="split.overflow.length > 0"
      class="fg-focusfold__focusFoldRow fg-chat__timelineMessage fg-chat__dotProgress fg-subagentrow__subagentRow"
      data-testid="focus-subagent-overflow-row"
    >
      <label class="fg-focusfold__runningLabel">{{ overflowRowLabel(split.overflow.length) }}</label>
      <span>{{ overflowRowMeta(split.overflow, now) }}</span>
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import {
  overflowRowLabel,
  overflowRowMeta,
  splitSubagentRows,
  subagentRowLabel,
  subagentRowMeta,
  type SubagentTask,
} from '../../core/agentMap';

const props = defineProps<{ tasks: SubagentTask[] | undefined }>();

const split = computed(() => splitSubagentRows(props.tasks ?? []));
const now = ref(Date.now());
const tick = setInterval(() => (now.value = Date.now()), 1000);
onBeforeUnmount(() => clearInterval(tick));
</script>
