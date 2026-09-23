<template>
  <!--
    A list of strings a setting holds: permission rules, directories, server
    names, sandbox commands, announcements. One input the full width of the row
    with its Add button beside it (Enter works too), then the entries as chips.
    Entries inherited from another scope sit after them, locked, so what applies
    is visible without being editable here.
  -->
  <div class="forge-list" :data-tone="tone">
    <form class="forge-list__add" @submit.prevent="submit">
      <TextInput
        ref="inputEl"
        v-model="draft"
        class="forge-list__input"
        :placeholder="placeholder"
        :monospace="monospace"
        :invalid="!!error"
        :aria-label="label"
        @keydown="onKeydown"
      />
      <Button type="button" variant="secondary" class="forge-list__button" @click="submit">
        <template #icon><span class="codicon codicon-add" aria-hidden="true" /></template>
        {{ addLabel }}
      </Button>
    </form>
    <p v-if="error" class="forge-list__error" role="alert">{{ error }}</p>

    <TransitionGroup
      v-if="items.length || inherited.length"
      tag="ul"
      name="forge-list"
      class="forge-list__chips"
      :aria-label="label"
    >
      <li v-for="(item, index) in items" :key="'own-' + item" class="forge-list__chip" :class="{ 'forge-list__chip--mono': monospace }">
        <span class="forge-list__chipText" :title="item">{{ item }}</span>
        <button
          type="button"
          class="forge-list__remove"
          :aria-label="`Remove ${item}`"
          :title="`Remove ${item}`"
          @click="$emit('remove', index)"
        >
          <span class="codicon codicon-close" aria-hidden="true" />
        </button>
      </li>
      <li
        v-for="item in inherited"
        :key="'inh-' + item"
        class="forge-list__chip forge-list__chip--inherited"
        :class="{ 'forge-list__chip--mono': monospace }"
        :title="inheritedHint"
      >
        <span class="codicon codicon-lock forge-list__lock" aria-hidden="true" />
        <span class="forge-list__chipText">{{ item }}</span>
      </li>
    </TransitionGroup>
    <p v-else-if="emptyText" class="forge-list__empty">{{ emptyText }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import TextInput from './TextInput.vue';
import Button from './Button.vue';

const props = withDefaults(defineProps<{
  /** Entries at the scope being edited. */
  items: string[];
  /** Entries that apply from another scope; shown, not editable. */
  inherited?: string[];
  placeholder?: string;
  /** What the list is, for screen readers and the input's label. */
  label: string;
  monospace?: boolean;
  addLabel?: string;
  /** Returns a message when a value cannot be added. */
  validate?: (value: string) => string | undefined;
  /** Colour cue for the chips: deny lists read red, allow lists green. */
  tone?: 'neutral' | 'danger' | 'warning' | 'success';
  inheritedHint?: string;
  emptyText?: string;
}>(), {
  inherited: () => [],
  placeholder: '',
  monospace: false,
  addLabel: 'Add',
  tone: 'neutral',
  inheritedHint: 'Inherited from another scope. Change it there.',
  emptyText: '',
});

const emit = defineEmits<{
  (e: 'add', value: string): void;
  (e: 'remove', index: number): void;
}>();

const draft = ref('');
const error = ref('');
const inputEl = ref<InstanceType<typeof TextInput> | null>(null);

function submit(): void {
  const value = draft.value.trim();
  if (!value) {
    error.value = '';
    inputEl.value?.focus();
    return;
  }
  if (props.items.includes(value) || props.inherited.includes(value)) {
    error.value = `"${value}" is already in the list.`;
    return;
  }
  const problem = props.validate?.(value);
  if (problem) {
    error.value = problem;
    return;
  }
  error.value = '';
  emit('add', value);
  draft.value = '';
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && draft.value) {
    event.preventDefault();
    draft.value = '';
    error.value = '';
  } else if (error.value && event.key !== 'Enter') {
    error.value = '';
  }
}
</script>

<style scoped>
.forge-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
  width: 100%;
}

.forge-list__add {
  display: flex;
  gap: 8px;
  margin: 0;
}

.forge-list__input {
  flex: 1 1 auto;
}

.forge-list__button {
  flex: none;
}

.forge-list__error {
  color: var(--forge-field-invalid);
  font-size: 11px;
  margin: -2px 0 0;
}

.forge-list__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.forge-list__chip {
  align-items: center;
  background: var(--forge-chip-bg);
  border: 1px solid var(--forge-chip-border);
  border-radius: var(--corner-radius-medium);
  color: var(--forge-chip-fg);
  display: inline-flex;
  font-size: 12px;
  gap: 4px;
  height: 24px;
  max-width: 100%;
  padding: 0 4px 0 9px;
}

.forge-list__chip--mono .forge-list__chipText {
  font-family: var(--app-monospace-font-family);
  font-size: 11.5px;
}

.forge-list__chipText {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The list's meaning, carried by its Pajamas status hue: deny red, ask orange, allow green. */
.forge-list[data-tone='danger'] .forge-list__chip {
  --forge-tone: var(--forge-danger);
}

.forge-list[data-tone='warning'] .forge-list__chip {
  --forge-tone: var(--forge-warning);
}

.forge-list[data-tone='success'] .forge-list__chip {
  --forge-tone: var(--forge-success);
}

.forge-list:not([data-tone='neutral']) .forge-list__chip:not(.forge-list__chip--inherited) {
  background: color-mix(in srgb, var(--forge-tone) 11%, transparent);
  border-color: color-mix(in srgb, var(--forge-tone) 32%, transparent);
  color: var(--forge-tone);
}

.forge-list:not([data-tone='neutral']) .forge-list__chip--inherited {
  border-color: color-mix(in srgb, var(--forge-tone) 32%, transparent);
  color: color-mix(in srgb, var(--forge-tone) 80%, var(--cursor-text-secondary));
}

.forge-list__chip--inherited {
  background: transparent;
  border-style: dashed;
  color: var(--cursor-text-secondary);
  padding-right: 9px;
}

.forge-list__lock {
  font-size: 11px;
  opacity: 0.7;
}

.forge-list__remove {
  align-items: center;
  background: transparent;
  border: none;
  border-radius: var(--corner-radius-small);
  color: var(--cursor-text-secondary);
  cursor: pointer;
  display: inline-flex;
  height: 18px;
  justify-content: center;
  padding: 0;
  transition: background-color 120ms cubic-bezier(0.22, 1, 0.36, 1), color 120ms cubic-bezier(0.22, 1, 0.36, 1);
  width: 18px;
}

.forge-list__remove .codicon {
  font-size: 12px;
}

.forge-list__remove:hover {
  background: color-mix(in srgb, var(--forge-danger) 16%, transparent);
  color: var(--forge-danger);
}

.forge-list__remove:focus-visible {
  outline: 2px solid var(--forge-focus-ring);
  outline-offset: 1px;
}

.forge-list__empty {
  color: var(--cursor-text-tertiary);
  font-size: 12px;
  margin: 0;
}

.forge-list-enter-active,
.forge-list-leave-active {
  transition: opacity 160ms cubic-bezier(0.22, 1, 0.36, 1), transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.forge-list-enter-from,
.forge-list-leave-to {
  opacity: 0;
  transform: scale(0.94);
}

@media (prefers-reduced-motion: reduce) {
  .forge-list__remove,
  .forge-list-enter-active,
  .forge-list-leave-active {
    transition: none;
  }
}
</style>
