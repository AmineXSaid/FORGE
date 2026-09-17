<template>
  <!-- Official `tf1` (module vRjSkQ): a thumbnail that opens a full-size preview. -->
  <div
    ref="thumbEl"
    class="fg-thumbnail__thumbnailAttachment"
    role="button"
    tabindex="0"
    style="cursor: pointer"
    :title="label"
    @click="open = true"
    @keydown="onKey"
  >
    <img :src="dataUrl" :alt="label" class="fg-thumbnail__thumbnail">
  </div>
  <Teleport v-if="open" to="body">
    <div class="fg-thumbnail__previewOverlay" @click.self="close">
      <div class="fg-thumbnail__previewContainer" role="dialog" :aria-label="label" tabindex="-1">
        <img :src="dataUrl" :alt="label" class="fg-thumbnail__previewImage">
        <button
          ref="closeEl"
          type="button"
          class="fg-thumbnail__previewCloseButton"
          title="Close preview (Esc)"
          @click="close"
        >
          <CloseIcon class="fg-thumbnail__previewCloseIcon" />
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import CloseIcon from '../../forge/icons/CloseIcon.vue';

defineProps<{ label: string; dataUrl: string }>();

const open = ref(false);
const thumbEl = ref<HTMLElement | null>(null);
const closeEl = ref<HTMLButtonElement | null>(null);

function onKey(event: KeyboardEvent): void {
  if (event.target !== event.currentTarget) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (!event.repeat) open.value = true;
  }
}

function close(): void {
  open.value = false;
}

function onEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  close();
}

watch(open, async (isOpen) => {
  if (isOpen) {
    document.addEventListener('keydown', onEscape, true);
    await nextTick();
    closeEl.value?.focus();
  } else {
    document.removeEventListener('keydown', onEscape, true);
    thumbEl.value?.focus({ preventScroll: true });
  }
});

onBeforeUnmount(() => document.removeEventListener('keydown', onEscape, true));
</script>
