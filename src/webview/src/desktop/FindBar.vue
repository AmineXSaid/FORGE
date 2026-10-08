<template>
  <!--
    Find in the window (Ctrl+F): a small frosted pill under the chat's
    header. Enter finds the next match, Shift+Enter the previous, Esc closes.
    WebView2 and WebKit both implement window.find.
  -->
  <div class="fd-find" role="search">
    <span class="codicon codicon-search fd-find__icon" aria-hidden="true" />
    <input
      ref="input"
      v-model="query"
      class="fd-find__input"
      placeholder="Find"
      aria-label="Find in the window"
      @keydown.enter.exact.prevent="find(false)"
      @keydown.shift.enter.prevent="find(true)"
      @keydown.esc.prevent="emit('close')"
    >
    <span v-if="query && missed" class="fd-caption">No match</span>
    <button type="button" class="fd-find__button" aria-label="Previous match" @click="find(true)">
      <span class="codicon codicon-arrow-up" aria-hidden="true" />
    </button>
    <button type="button" class="fd-find__button" aria-label="Next match" @click="find(false)">
      <span class="codicon codicon-arrow-down" aria-hidden="true" />
    </button>
    <button type="button" class="fd-find__button" aria-label="Close" @click="emit('close')">
      <span class="codicon codicon-close" aria-hidden="true" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';

const emit = defineEmits<{ close: [] }>();
const input = ref<HTMLInputElement>();
const query = ref('');
const missed = ref(false);

type FindFn = (text: string, caseSensitive: boolean, backwards: boolean, wrap: boolean) => boolean;

function find(backwards: boolean): void {
  const text = query.value;
  if (!text) return;
  const finder = (window as unknown as { find?: FindFn }).find;
  missed.value = !(finder?.call(window, text, false, backwards, true) ?? false);
  // window.find selects the match, which takes focus from the box: give it
  // back, with the caret where it was, so typing goes on in the box.
  const box = input.value;
  if (box) {
    box.focus({ preventScroll: true });
    box.setSelectionRange(box.value.length, box.value.length);
  }
}

// A new query searches from the top again, on the next Enter.
watch(query, () => {
  missed.value = false;
});

onMounted(() => input.value?.focus());
defineExpose({ focus: () => input.value?.select() });
</script>

<style scoped>
.fd-find {
  position: absolute;
  top: 52px;
  right: 14px;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 34px;
  padding: 0 4px 0 12px;
  border: 1px solid var(--fd-edge-paper);
  border-radius: var(--fd-pill);
  background: var(--fd-glass);
  backdrop-filter: var(--fd-blur);
  box-shadow: var(--fd-shadow-nav);
}

.fd-find__icon {
  color: var(--fd-muted);
}

.fd-find__input {
  box-sizing: border-box;
  width: 180px;
  height: 24px;
  padding: 0;
  border: 0;
  box-shadow: none;
  outline: none;
  background: transparent;
  color: var(--fd-ink);
  font: inherit;
}

.fd-find__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: var(--fd-pill);
  background: transparent;
  color: var(--fd-muted);
  cursor: pointer;
}

.fd-find__button:hover {
  background: var(--fd-hover);
  color: var(--fd-ink);
}
</style>

<style>
/* The theme's focus ring is for controls; the find box is its own frame. */
body.forge-desktop .fd-find__input:focus-visible {
  outline: none;
}
</style>
