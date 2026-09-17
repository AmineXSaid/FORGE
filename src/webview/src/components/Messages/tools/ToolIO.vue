<template>
  <!--
    A tool call's input and output on Forge's terminal surface.

    The box is the official tool body (.toolBody) so it keeps the official
    geometry; inside, each row is drawn by ToolIORow instead of the official
    IN / OUT grid.
  -->
  <div :class="['fg-tool__toolBody', 'fterm', extraClass]">
    <ToolIORow v-for="(row, i) in rows" :key="i" :row="row" :context="context" />
  </div>
</template>

<script setup lang="ts">
import ToolIORow from './ToolIORow.vue';
import type { ToolIORowSpec } from './terminalText';
import type { ToolRenderContext } from './toolRegistry';

withDefaults(
  defineProps<{
    rows: ToolIORowSpec[];
    context: ToolRenderContext;
    /** An official wrapper class to keep (the Write body hides below 500px). */
    extraClass?: string;
  }>(),
  { extraClass: '' }
);
</script>
