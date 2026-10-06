<template>
  <!--
    48b: a guard sent the model back. Markup copies LLMErrorBlock (one wrapper,
    an icon span, a message span) so the transcript oracle sees the same
    structure as the existing tip rows. Forge-only: divergence #59.
  -->
  <div class="forge-note-block" :data-kind="block.kind">
    <span class="forge-note-icon"><SearchIcon /></span>
    <span class="forge-note-message">{{ block.text }}</span>
  </div>
</template>

<script setup lang="ts">
import type { ForgeNoteBlock as ForgeNoteBlockType } from '../../../models/ContentBlock';
import SearchIcon from '../../forge/icons/SearchIcon.vue';

interface Props {
  block: ForgeNoteBlockType;
}

defineProps<Props>();
</script>

<style scoped>
/* The tip-row strip of InterruptBlock / LLMErrorBlock, in a muted tone. */
.forge-note-block {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background-color: transparent;
}

.forge-note-icon {
  display: inline-flex;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--forge-text-muted);
}

.forge-note-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.forge-note-message {
  color: var(--forge-text-muted);
  font-style: italic;
}
</style>
