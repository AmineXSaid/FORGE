<template>
  <span
    class="cursor-badge"
    :class="[sizeClass, variantClass]"
  >
    <slot />
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  variant?: 'default' | 'subtle' | 'primary' | 'success' | 'warning' | 'danger'
  size?: 'small' | 'medium' | 'large'
}>(), {
  variant: 'default',
  size: 'small'
})

const sizeClass = computed(() => `cursor-badge-${props.size}`)
const variantClass = computed(() => `cursor-badge-${props.variant}`)
</script>

<style>
/*
 * Badge styles are intentionally NOT scoped: consumed via class in several
 * components.
 *
 * A badge is weighted text, not a box (forge-style skill): 11px semibold, in
 * the muted tone or a status hue, no fill and no radius, so a row's label
 * stays the loudest thing in it and a status still reads at a glance.
 */
.cursor-badge {
  align-items: center;
  background: none;
  display: inline-flex;
  font-weight: 600;
  height: fit-content;
  letter-spacing: 0.01em;
  line-height: 1;
  padding: 0;
  user-select: none;
  white-space: nowrap;
}

.cursor-badge-small {
  font-size: 11px;
}

.cursor-badge-medium {
  font-size: 12px;
}

.cursor-badge-large {
  font-size: 13px;
}

.cursor-badge-default,
.cursor-badge-primary {
  color: var(--forge-text);
}

.cursor-badge-subtle {
  color: var(--forge-text-subtle);
}

.cursor-badge-success {
  color: var(--forge-success);
}

.cursor-badge-warning {
  color: var(--forge-warning);
}

.cursor-badge-danger {
  color: var(--forge-danger);
}
</style>
