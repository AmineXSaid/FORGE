<template>
  <!--
    The Edit tool's diff (official `tY0`, module s6OFow), element for element:

      div.diffEditorWrapper                 (hover tracks "Click to expand")
        div.diffEditorContainer             (height: min(200, lines * 19 + pad))
        div.truncationGradient              (only when the diff is cut off)
        div.clickOverlay role=button        (opens the full diff in a modal)
          div.expandButton "Click to expand" (while hovered or keyboard-focused)

    The official fills the container with a read-only Monaco diff editor: side by
    side above 700px, inline below, 12px text, no line numbers, +/- indicators.
    Forge does not bundle Monaco, so the same two layouts are drawn as plain line
    rows at the same metrics. The sizing, overlay, gradient and modal are the
    official's.
  -->
  <div
    class="fg-diffview__diffEditorWrapper"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <div ref="containerEl" class="fg-diffview__diffEditorContainer" :style="{ height: `${height}px` }">
      <DiffLines :rows="rows" :side-by-side="sideBySide" />
    </div>
    <div v-if="truncated" class="fg-diffview__truncationGradient" />
    <div
      class="fg-diffview__clickOverlay"
      role="button"
      aria-label="Click to expand"
      tabindex="0"
      style="cursor: pointer"
      @click="openModal"
      @keydown="onOverlayKey"
      @focus="focusVisible = ($event.currentTarget as HTMLElement).matches(':focus-visible')"
      @blur="focusVisible = false"
    >
      <div v-if="hovered || focusVisible" class="fg-diffview__expandButton">Click to expand</div>
    </div>
  </div>

  <!-- Official `kX0` (module oXZawA): the full diff, portalled to the body. -->
  <Teleport v-if="modalOpen" to="body">
    <div class="fg-diffmodal__modalBackdrop" @click.self="closeModal">
      <div class="fg-diffmodal__modalContent" role="dialog" :aria-labelledby="titleId">
        <div class="fg-diffmodal__modalHeader">
          <div :id="titleId" class="fg-diffmodal__modalTitle">{{ filePath ? `${filePath}` : 'Diff View' }}</div>
          <button
            ref="closeEl"
            type="button"
            class="fg-iconbutton__iconButton fg-iconbutton__iconButton20"
            aria-label="Close"
            title="Close"
            @click="closeModal"
          >
            <CloseIcon />
          </button>
        </div>
        <div ref="modalContainerEl" class="fg-diffmodal__diffEditorContainer">
          <DiffLines :rows="rows" :side-by-side="modalSideBySide" scrollable />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import CloseIcon from '../../forge/icons/CloseIcon.vue';
import DiffLines from './DiffLines.vue';
import { diffLines } from './lineDiff';

const props = defineProps<{
  original: string;
  modified: string;
  filePath?: string;
}>();

const containerEl = ref<HTMLElement | null>(null);
const hovered = ref(false);
const focusVisible = ref(false);

/** The official starts side by side and switches to inline at or below 700px. */
const sideBySide = ref(true);
let observer: ResizeObserver | undefined;

onMounted(() => {
  if (!containerEl.value) return;
  observer = new ResizeObserver((entries) => {
    for (const entry of entries) sideBySide.value = entry.contentRect.width > 700;
  });
  observer.observe(containerEl.value);
});

const rows = computed(() => diffLines(props.original, props.modified));

/** Official `j()`: 19px a line, plus 20px (side by side) or 60px (inline) of chrome, capped at 200. */
const natural = computed(() => {
  const originalLines = props.original.split('\n').length;
  const modifiedLines = props.modified.split('\n').length;
  const inline = !sideBySide.value;
  const lines = inline ? originalLines + modifiedLines : Math.max(originalLines, modifiedLines);
  return lines * 19 + (inline ? 60 : 20);
});
const truncated = computed(() => natural.value > 200);
const height = computed(() => Math.min(200, Math.max(0, natural.value)));

/** Official `w()`: keep a scrolled-to-bottom transcript pinned as the diff grows. */
watch(height, () => {
  let parent = containerEl.value?.parentElement ?? null;
  while (parent) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === 'auto' || overflowY === 'scroll') break;
    parent = parent.parentElement;
  }
  if (parent && parent.scrollHeight - parent.scrollTop - parent.clientHeight < 50) {
    const scroller = parent;
    requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight;
    });
  }
});

function onOverlayKey(event: KeyboardEvent): void {
  if (event.target !== event.currentTarget) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (!event.repeat) openModal();
  }
}

// ---- Modal ----------------------------------------------------------------

const modalOpen = ref(false);
const closeEl = ref<HTMLButtonElement | null>(null);
const modalContainerEl = ref<HTMLElement | null>(null);
const modalSideBySide = ref(true);
const titleId = `fg-diff-${Math.random().toString(36).slice(2)}`;
let returnFocus: HTMLElement | null = null;

function onModalKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    closeModal();
    event.preventDefault();
  }
}

async function openModal(): Promise<void> {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  modalOpen.value = true;
  document.addEventListener('keydown', onModalKey, true);
  document.body.style.overflow = 'hidden';
  await nextTick();
  closeEl.value?.focus();
  const width = modalContainerEl.value?.getBoundingClientRect().width ?? 0;
  modalSideBySide.value = width > 700;
}

function closeModal(): void {
  modalOpen.value = false;
  document.removeEventListener('keydown', onModalKey, true);
  document.body.style.overflow = '';
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  returnFocus = null;
}

onBeforeUnmount(() => {
  observer?.disconnect();
  if (modalOpen.value) closeModal();
});
</script>
