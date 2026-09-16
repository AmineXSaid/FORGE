<template>
  <!--
    The official collapsible user text (reference `xq0`, module xGDvVg). Content
    taller than maxHeight is clipped with a gradient and a "Show more" button that
    appears on hover or keyboard focus; expanded, a "Show less" button follows.
    The official passes `mq.contentWrapper`, which is not in its own class map,
    so that wrapper renders without a class -- reproduced here.
  -->
  <div class="fg-expandable__expandableContainer">
    <div @mouseenter="hovered = true" @mouseleave="hovered = false">
      <div
        ref="contentEl"
        class="fg-expandable__content"
        :class="{ 'fg-expandable__collapsed': !expanded && overflowing }"
        :style="!expanded && overflowing ? { maxHeight: `${maxHeight}px` } : undefined"
      >
        <slot />
        <div v-if="!expanded && overflowing" class="fg-expandable__truncationGradient"></div>
      </div>
      <div
        v-if="!expanded && overflowing"
        :class="hovered || focusVisible ? 'fg-expandable__buttonContainer' : 'fg-vh__visuallyHidden'"
      >
        <button
          type="button"
          class="fg-expandable__expandButton"
          @click="expanded = true; focusVisible = false"
          @focus="focusVisible = ($event.currentTarget as HTMLElement).matches(':focus-visible')"
          @blur="focusVisible = false"
        >
          Show more
        </button>
      </div>
    </div>
    <div v-if="expanded && overflowing" class="fg-expandable__buttonContainer">
      <button type="button" class="fg-expandable__collapseButton" @click="expanded = false">Show less</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUpdated } from 'vue';

const props = withDefaults(defineProps<{ maxHeight?: number }>(), { maxHeight: 250 });

const contentEl = ref<HTMLElement | null>(null);
const expanded = ref(false);
const overflowing = ref(false);
const hovered = ref(false);
const focusVisible = ref(false);

function measure(): void {
  if (contentEl.value) overflowing.value = contentEl.value.scrollHeight > props.maxHeight;
}
onMounted(measure);
onUpdated(measure);
</script>
