<template>
  <div class="cursor-settings-sub-section">
    <div class="cursor-settings-sub-section-list">
      <slot></slot>
    </div>
    <div class="cursor-settings-sub-section-trailing-caption">{{ caption }}</div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  caption?: string
}>()
</script>

<style scoped>
.cursor-settings-sub-section {
    align-items: flex-start;
    align-self: stretch;
    display: flex;
    flex-direction: column;
    gap: 8px
}

/* A card: one tonal step above the canvas, a hairline, no shadow. */
.cursor-settings-sub-section-list {
    align-self: stretch;
    background-color: var(--forge-surface);
    border: 1px solid var(--forge-hairline);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    gap: 0
}

.cursor-settings-sub-section-trailing-caption {
    color: var(--cursor-text-tertiary);
    font-size: 11.5px;
    line-height: 17px;
    max-width: 72ch;
    padding: 0 8px;
    user-select: none
}

.cursor-settings-sub-section-trailing-caption:empty {
    display: none
}
</style>
