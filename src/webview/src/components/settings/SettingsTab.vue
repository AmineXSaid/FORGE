<template>
  <div class="cursor-settings-tab">
    <div class="cursor-settings-tab-header">
      <div class="cursor-settings-tab-title">{{ title }}</div>
    </div>
    <div class="cursor-settings-tab-content">
      <slot></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
}>()
</script>

<style scoped>
.cursor-settings-tab {
    display: flex;
    flex-direction: column;
    gap: 28px;
    padding: 44px 0 56px
}

.cursor-settings-tab-header {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0 8px
}

.cursor-settings-tab-title {
    color: var(--cursor-text-primary);
    font-size: 20px;
    font-style: normal;
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 26px
}

.cursor-settings-tab-description {
    color: var(--cursor-text-secondary);
    font-size: 12px;
    font-style: normal;
    font-weight: 400;
    line-height: 16px
}

.cursor-settings-tab-content {
    display: flex;
    flex-direction: column;
    gap: 30px;
    height: 100%
}
</style>
