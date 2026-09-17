<template>
  <!-- Lines of classed segments on the terminal surface (styles/forge-terminal.css). -->
  <div class="fterm-lines">
    <div v-if="lines.length === 0 && emptyText" class="fterm-line fterm-empty">{{ emptyText }}</div>
    <div v-for="(line, i) in lines" :key="keyOffset + i" class="fterm-line"><span v-for="(seg, j) in line" :key="j" :class="seg.cls">{{ seg.text }}</span><template v-if="line.length === 0">&#8203;</template></div>
  </div>
</template>

<script setup lang="ts">
import type { TermLine } from './terminalText';

withDefaults(
  defineProps<{
    lines: TermLine[];
    /** Index of the first line, so keys stay stable when a collapsed tail expands. */
    keyOffset?: number;
    emptyText?: string;
  }>(),
  { keyOffset: 0, emptyText: '' }
);
</script>
