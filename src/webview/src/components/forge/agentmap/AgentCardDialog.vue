<template>
  <!--
    The official `_K1` (index.js @4802300): a card stacked over the Agent map.

      F("div",{ref:G,onKeyDown:(q)=>q.stopPropagation(),children:F(i7,{title:$,onClose:J,onBack:J,
        showCloseButton:!1,width:Y,maxWidth:Y,scrollInside:Q,children:Z})})

    Escape and the back arrow both go back one level; the keydown stops here so
    the map underneath does not close as well. On mount (and when `focusKey`
    changes) the card takes focus unless it already holds it; on unmount focus
    returns to whatever had it before.
  -->
  <div ref="root" @keydown.stop>
    <ForgeDialog
      :on-close="onBack"
      :on-back="onBack"
      :show-close-button="false"
      :width="width"
      :max-width="width"
      :scroll-inside="scrollInside"
    >
      <template #back-icon><BackArrowIcon /></template>
      <template #title><slot name="title" /></template>
      <slot />
    </ForgeDialog>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ForgeDialog from '../ForgeDialog.vue';
import BackArrowIcon from '../icons/BackArrowIcon.vue';

const props = withDefaults(
  defineProps<{ onBack: () => void; width?: number; focusKey?: string; scrollInside?: boolean }>(),
  { width: 420, focusKey: undefined, scrollInside: false }
);

const root = ref<HTMLElement | null>(null);
const previouslyFocused = typeof document === 'undefined' ? null : document.activeElement;

function takeFocus(): void {
  const dialog = root.value?.querySelector<HTMLElement>('[role="dialog"]');
  if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
}

onMounted(() => void nextTick(takeFocus));
watch(() => props.focusKey, () => void nextTick(takeFocus));
onBeforeUnmount(() => {
  if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus();
});
</script>
