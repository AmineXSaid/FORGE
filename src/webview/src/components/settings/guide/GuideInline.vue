<template>
  <!-- A run of Guide text: `backticks` become inline code. Text nodes only, never v-html. -->
  <template v-for="(part, i) in parts" :key="i">
    <code v-if="part.code" class="fg-guide-inline__code">{{ part.text }}</code>
    <template v-else>{{ part.text }}</template>
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { splitInlineCode } from './guideText';

const props = defineProps<{ text: string }>();
const parts = computed(() => splitInlineCode(props.text));
</script>

<style scoped>
.fg-guide-inline__code {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--forge-surface-deep);
  color: var(--forge-text);
  font-family: var(--app-monospace-font-family);
  font-size: 0.92em;
  white-space: nowrap;
}
</style>
