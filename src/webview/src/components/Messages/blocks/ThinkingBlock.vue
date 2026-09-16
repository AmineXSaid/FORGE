<template>
  <details
    class="fg-thinking__thinking fg-thinking__thinkingV2"
    :class="{ 'fg-thinking__thinkingStatic': !hasContent }"
    :open="open"
    @toggle="onToggle"
  >
    <summary class="fg-thinking__thinkingSummary">
      <!--
        The official chevron points right and rotates 90deg when open, driven by
        .thinkingToggleOpen. Using one glyph for both states keeps the rotation
        animating instead of swapping icons mid-transition.
      -->
      <svg
        class="fg-thinking__thinkingToggle"
        :class="{ 'fg-thinking__thinkingToggleOpen': open }"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M6 4l4 4-4 4"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span>{{ label }}</span>
      <span v-if="tokenLabel" class="fg-thinking__thinkingTokenCount">{{ tokenLabel }}</span>
    </summary>
    <div class="fg-thinking__thinkingContent">{{ block.thinking }}</div>
  </details>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ThinkingBlock as ThinkingBlockType } from '../../../models/ContentBlock';

interface Props {
  block: ThinkingBlockType;
  /** True while this block is still streaming in. */
  streaming?: boolean;
}

const props = defineProps<Props>();

const open = ref(false);

function onToggle(event: Event): void {
  open.value = (event.target as HTMLDetailsElement).open;
}

const hasContent = computed(() => Boolean(props.block.thinking?.trim()));
const label = computed(() => (props.streaming ? 'Thinking...' : 'Thought process'));

/**
 * Rough token count for the summary line. Thinking blocks do not carry usage of
 * their own, so this estimates from length using the usual ~4 characters per
 * token and is shown only once the block is worth measuring.
 */
const tokenLabel = computed(() => {
  const chars = props.block.thinking?.length ?? 0;
  if (chars < 400) return '';
  const tokens = Math.round(chars / 4);
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k tokens` : `${tokens} tokens`;
});
</script>
