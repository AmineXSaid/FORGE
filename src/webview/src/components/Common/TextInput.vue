<template>
  <input
    ref="inputRef"
    :type="type"
    :value="modelValue"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    @change="$emit('change', ($event.target as HTMLInputElement).value)"
    @keydown="$emit('keydown', $event)"
    class="forge-field common-text-input"
    :class="{
      'common-text-input-small': size === 'small',
      'common-text-input-mono': monospace,
      'forge-field--invalid': invalid
    }"
    :placeholder="placeholder"
    :disabled="disabled"
    :spellcheck="spellcheck"
    :aria-invalid="invalid || undefined"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue'

withDefaults(defineProps<{
  modelValue: string
  type?: 'text' | 'password' | 'email' | 'url'
  placeholder?: string
  disabled?: boolean
  spellcheck?: boolean
  /**
   * The value is code (a rule, a path, a variable). Only what is typed goes
   * monospace; the placeholder stays in the text face, so an empty field reads
   * as a prompt in the page's own voice rather than as a block of code.
   */
  monospace?: boolean
  size?: 'small' | 'medium'
  /** Paint the field as needing attention (with a message beside it). */
  invalid?: boolean
}>(), {
  type: 'text',
  spellcheck: false,
  monospace: false,
  size: 'medium',
  invalid: false
})

defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'change', value: string): void
  (e: 'keydown', event: KeyboardEvent): void
}>()

const inputRef = ref<HTMLInputElement>()

defineExpose({ inputRef, focus: () => inputRef.value?.focus() })
</script>

<style>
/*
 * Every box a user types into, in Settings and the dialogs. Global rather than
 * scoped so a raw <input> can opt in with the class and look the same.
 * Colours are the Pajamas field tokens in forge-tokens.css.
 */
.forge-field {
  background: var(--forge-field-bg);
  border: 1px solid var(--forge-field-border);
  border-radius: var(--corner-radius-medium);
  box-sizing: border-box;
  color: var(--forge-field-fg);
  font-family: inherit;
  font-size: 12px;
  height: 28px;
  line-height: 16px;
  min-width: 0;
  outline: none;
  padding: 0 10px;
  transition:
    border-color 120ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 120ms cubic-bezier(0.22, 1, 0.36, 1),
    background-color 120ms cubic-bezier(0.22, 1, 0.36, 1);
}

.forge-field::placeholder {
  color: var(--forge-field-placeholder);
  opacity: 1;
}

.forge-field:hover:not(:disabled):not(:focus) {
  border-color: var(--forge-field-border-hover);
}

.forge-field:focus,
.forge-field:focus-visible {
  border-color: var(--forge-field-focus);
  box-shadow: 0 0 0 3px var(--forge-field-ring);
}

.forge-field--invalid,
.forge-field--invalid:hover:not(:disabled):not(:focus) {
  border-color: var(--forge-field-invalid);
}

.forge-field--invalid:focus {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--forge-field-invalid) 22%, transparent);
}

.forge-field:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.common-text-input-small {
  font-size: 12px;
  height: 24px;
  padding: 0 8px;
}

/* Code values in the code face, once there is a value to show. */
.common-text-input-mono:not(:placeholder-shown) {
  font-family: var(--app-monospace-font-family);
  font-size: 11.5px;
}

@media (prefers-reduced-motion: reduce) {
  .forge-field {
    transition: none;
  }
}
</style>
