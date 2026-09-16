<template>
  <!--
    The official webview's single-line-ish text field (its `ContentEditableInput`).
    It is deliberately NOT an <input> or <textarea>: it is a contenteditable div
    with a sibling placeholder, which is how the real one grows to fit wrapped
    text up to `max-height: 120px` while keeping the caret and paste behaviour of
    plain text. Structure and class names are the official ones (module q4zSJA),
    so the ported stylesheet applies with no bridging CSS.
  -->
  <div :class="['fg-editable__wrapper', wrapperClass]">
    <div v-if="isEmpty" class="fg-editable__placeholder" aria-hidden="true">{{ placeholder }}</div>
    <div
      ref="inputEl"
      class="fg-editable__input"
      contenteditable="plaintext-only"
      role="textbox"
      aria-multiline="true"
      :aria-label="placeholder"
      spellcheck="false"
      @input="onInput"
      @keydown="onKeyDown"
      @paste="onPaste"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';

interface Props {
  modelValue: string;
  placeholder?: string;
  /** Extra class on the wrapper -- the official passes `rejectMessageInput` here. */
  wrapperClass?: string;
  autoFocus?: boolean;
}

const props = withDefaults(defineProps<Props>(), { placeholder: '', autoFocus: false });
const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'keydown', event: KeyboardEvent): void;
}>();

const inputEl = ref<HTMLDivElement | null>(null);
const isEmpty = computed(() => !props.modelValue);

/**
 * Mirror the model into the DOM only when they actually differ. Writing on every
 * change would reset the caret to the start of the field on each keystroke.
 */
watch(
  () => props.modelValue,
  (value) => {
    const el = inputEl.value;
    if (el && (el.textContent ?? '') !== value) el.textContent = value;
  },
  { immediate: true }
);

onMounted(() => {
  if (props.modelValue && inputEl.value) inputEl.value.textContent = props.modelValue;
  if (props.autoFocus) inputEl.value?.focus();
});

function onInput(): void {
  emit('update:modelValue', inputEl.value?.textContent ?? '');
}

/** Insert text at the caret, the way the official field handles paste and Shift+Enter. */
function insertText(text: string): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  onInput();
}

function onKeyDown(event: KeyboardEvent): void {
  // Shift+Enter inserts a newline itself, because contenteditable would
  // otherwise insert a <div> or <br> and break the plain-text contract.
  if (event.key === 'Enter' && event.shiftKey && !event.isComposing) {
    event.preventDefault();
    event.stopPropagation();
    insertText('\n');
    return;
  }
  emit('keydown', event);
}

function onPaste(event: ClipboardEvent): void {
  const text = event.clipboardData?.getData('text/plain');
  if (!text) return;
  event.preventDefault();
  insertText(text);
}

defineExpose({ focus: () => inputEl.value?.focus(), el: inputEl });
</script>
