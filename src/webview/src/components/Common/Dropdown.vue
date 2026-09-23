<template>
  <SelectRoot v-bind="forwarded">
    <SelectTrigger class="solid-dropdown-toggle">
      <div class="solid-dropdown-toggle-label">
        <slot name="trigger" :selected="selectedOption">
          <SelectValue :placeholder="placeholder">
            {{ selectedOption?.label }}
          </SelectValue>
        </slot>
      </div>
      <span class="codicon codicon-chevron-up-down solid-dropdown-chevron" aria-hidden="true"></span>
    </SelectTrigger>

    <SelectPortal>
      <SelectContent class="solid-dropdown-menu" :position="'popper'" :align="menuAlign === 'right' ? 'end' : 'start'" :side-offset="4">
        <SelectViewport>
          <SelectItem
            v-for="option in options"
            :key="option.value"
            :value="option.value"
            class="solid-dropdown-item"
          >
            <slot name="option" :option="option">
              <div class="solid-dropdown-item-body">
                <div class="solid-dropdown-item-label">{{ option.label }}</div>
                <div v-if="option.description" class="solid-dropdown-item-description">{{ option.description }}</div>
              </div>
            </slot>
            <span v-if="option.value === modelValue" class="codicon codicon-check solid-dropdown-item-check" aria-hidden="true"></span>
          </SelectItem>

          <div v-if="$slots.footer" class="solid-dropdown-item footer-item">
            <slot name="footer"></slot>
          </div>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  SelectRoot,
  SelectTrigger,
  SelectPortal,
  SelectContent,
  SelectViewport,
  SelectItem,
  SelectValue,
  useForwardPropsEmits
} from 'reka-ui';

interface Option {
  label: string
  value: any
  description?: string
}

const props = defineProps<{
  modelValue?: any
  options: Option[]
  placeholder?: string
  menuAlign?: 'left' | 'right'
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: any): void
}>()

const forwarded = useForwardPropsEmits(computed(() => ({
  modelValue: props.modelValue,
})), emit)

const selectedOption = computed(() => {
  return props.options.find(o => o.value === props.modelValue)
})
</script>

<style scoped>
/*
 * The select, on the same field tokens as every text box: same height, border,
 * corner and focus ring, so a row of mixed controls lines up. The menu is an
 * overlay one tonal step above the page with a hairline, no shadow
 * (forge-style), a tonal highlighted row and a check on the current value.
 */
.solid-dropdown-toggle {
    align-items: center;
    background-color: var(--forge-field-bg);
    border: 1px solid var(--forge-field-border);
    border-radius: var(--corner-radius-medium);
    box-sizing: border-box;
    color: var(--forge-field-fg);
    cursor: pointer;
    display: inline-flex;
    font-family: inherit;
    font-size: 12px;
    gap: 8px;
    height: 28px;
    justify-content: space-between;
    min-width: 96px;
    outline: none;
    padding: 0 6px 0 10px;
    transition: border-color 120ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 120ms cubic-bezier(0.22, 1, 0.36, 1);
    user-select: none;
}

.solid-dropdown-toggle:hover {
    border-color: var(--forge-field-border-hover);
}

.solid-dropdown-toggle:focus-visible,
.solid-dropdown-toggle[data-state='open'] {
    border-color: var(--forge-field-focus);
    box-shadow: 0 0 0 3px var(--forge-field-ring);
}

.solid-dropdown-toggle-label {
    align-items: center;
    display: flex;
    min-width: 0;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* reka-ui's own placeholder slot, shown when nothing is chosen. */
.solid-dropdown-toggle-label :deep([data-placeholder]),
.solid-dropdown-toggle[data-placeholder] .solid-dropdown-toggle-label {
    color: var(--forge-field-placeholder);
}

.solid-dropdown-chevron {
    color: var(--forge-field-placeholder);
    font-size: 14px;
}

:global(.solid-dropdown-menu) {
    animation: forge-dropdown-in 140ms cubic-bezier(0.22, 1, 0.36, 1);
    background-color: var(--forge-overlay);
    border: 1px solid var(--forge-outline);
    border-radius: var(--corner-radius-large);
    display: flex;
    flex-direction: column;
    list-style: none;
    max-height: 320px;
    max-width: 320px;
    min-width: max(180px, var(--reka-select-trigger-width, 0px));
    padding: 4px;
    z-index: 1000;
}

:global(.solid-dropdown-item) {
    align-items: center;
    border-radius: var(--corner-radius-small);
    color: var(--forge-text);
    cursor: pointer;
    display: flex;
    font-size: 12px;
    gap: 8px;
    justify-content: space-between;
    outline: none;
    padding: 6px 8px;
    user-select: none;
    white-space: normal;
    word-break: break-word;
}

:global(.solid-dropdown-item[data-highlighted]) {
    background-color: var(--forge-surface-hover);
    outline: none;
}

:global(.solid-dropdown-item-label) {
    font-size: 12px;
}

:global(.solid-dropdown-item-description) {
    color: var(--forge-text-muted);
    font-size: 11px;
    margin-top: 1px;
}

:global(.solid-dropdown-item-check) {
    color: var(--forge-text);
    flex: none;
    font-size: 13px;
}

:global(.footer-item) {
    cursor: default;
}

@keyframes forge-dropdown-in {
    from { opacity: 0; transform: translateY(-3px) scale(0.985); }
    to { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
    :global(.solid-dropdown-menu) {
        animation: none;
    }

    .solid-dropdown-toggle {
        transition: none;
    }
}
</style>
