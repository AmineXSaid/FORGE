<template>
  <!--
    Under the last reply, once the turn has ended: copy everything the model
    wrote in this conversation (core/copyResponses.ts). A quiet text button
    with the copy glyph the code blocks use; "Copied" with a check for a
    moment after. Forge-only: the official extension has no response copy.
  -->
  <div class="fg-copyresponses">
    <button
      type="button"
      class="fg-copyresponses__button"
      :title="copied ? 'Copied' : 'Copy everything Forge wrote in this conversation'"
      :aria-label="copied ? 'Copied all responses' : 'Copy all responses'"
      @click="copy"
    >
      <CheckIcon v-if="copied" class="fg-copyresponses__icon" />
      <CopyIcon v-else class="fg-copyresponses__icon" />
      <span>{{ copied ? 'Copied' : failed ? 'Could not copy' : 'Copy responses' }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import CopyIcon from './icons/CopyIcon.vue';
import CheckIcon from './icons/CheckIcon.vue';

const props = defineProps<{ text: () => string }>();

const copied = ref(false);
const failed = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

function copy(): void {
  const text = props.text();
  if (!text) return;
  navigator.clipboard.writeText(text).then(
    () => {
      failed.value = false;
      copied.value = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => (copied.value = false), 1500);
    },
    () => {
      failed.value = true;
    }
  );
}

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
});
</script>

<style scoped>
/* Aligned with the replies' text, which sits past the timeline's dot column. */
.fg-copyresponses {
  display: flex;
  margin: 2px 0 0 30px;
}
.fg-copyresponses__button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 8px 0 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--forge-text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: color 120ms ease-out, border-color 120ms ease-out;
}
.fg-copyresponses__button:hover {
  border-color: var(--forge-hairline);
  color: var(--forge-text);
}
.fg-copyresponses__button:focus-visible {
  outline: 1px solid var(--forge-focus-ring);
  outline-offset: 1px;
}
.fg-copyresponses__icon {
  width: 14px;
  height: 14px;
}
</style>
