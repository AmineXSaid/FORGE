<template>
  <!--
    The official `lz0` (index.js @4801569), one agent and its children:

      F("div",{className:G4.child,children:R("div",{className:G4.node,children:[
        F(u55,{agent,waiting,onClick:()=>Z(mz0(agent))}),
        $.children.length>0&&F("div",{className:G4.children,children:…lz0…})]})})
  -->
  <div class="fg-task__child">
    <div class="fg-task__node">
      <AgentRow :agent="node.agent" :waiting="waiting" :now="now" @select="emit('select', agentKey(node.agent))" />
      <div v-if="node.children.length > 0" class="fg-task__children">
        <AgentTreeNode
          v-for="child in node.children"
          :key="child.agent.taskId"
          :node="child"
          :waiting="waiting"
          :now="now"
          @select="(key: string) => emit('select', key)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AgentRow from './AgentRow.vue';
import { agentKey } from './agentKey';
import type { AgentTreeNode as TreeNode } from '../../../core/agentMap';

defineOptions({ name: 'AgentTreeNode' });
defineProps<{ node: TreeNode; waiting: ReadonlySet<string>; now: number }>();
const emit = defineEmits<{ (e: 'select', key: string): void }>();
</script>
