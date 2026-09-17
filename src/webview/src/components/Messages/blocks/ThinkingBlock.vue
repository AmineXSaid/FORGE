<template>
  <!--
    The official thinking block (`rf1`, module aHyQPQ), element for element.

    With no thinking text it is a static line:
      div.thinking.thinkingV2 > div.thinkingSummary.thinkingStatic > span

    Otherwise a disclosure whose open state is shared by the whole transcript:
      details.thinking.thinkingV2
        summary.thinkingSummary > span, <token count>, svg.thinkingToggle
        div.thinkingContent > markdown
  -->
  <div v-if="!hasContent" class="fg-thinking__thinking fg-thinking__thinkingV2">
    <div class="fg-thinking__thinkingSummary fg-thinking__thinkingStatic">
      <span>{{ label }}</span>
    </div>
  </div>
  <details v-else class="fg-thinking__thinking fg-thinking__thinkingV2" :open="expanded" @toggle="onToggle">
    <summary class="fg-thinking__thinkingSummary">
      <span>{{ label }}</span>
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        class="fg-thinking__thinkingToggle"
        :class="{ 'fg-thinking__thinkingToggleOpen': expanded }"
        aria-hidden="true"
      >
        <path
          d="M7.12771 5.16489C7.28926 4.98544 7.55225 4.95072 7.75273 5.0682L7.83477 5.12778L12.835 9.62788C12.9402 9.72264 12.9999 9.85833 13 9.99995C13 10.1063 12.9667 10.2093 12.9053 10.2939L12.835 10.372L7.83477 14.8721C7.62952 15.0567 7.31242 15.0402 7.12771 14.835C6.94336 14.6298 6.95983 14.3126 7.16482 14.128L11.7519 9.99995L7.16482 5.87193L7.09744 5.79674C6.95939 5.60969 6.96617 5.34444 7.12771 5.16489Z"
          fill="currentColor"
        />
      </svg>
    </summary>
    <div class="fg-thinking__thinkingContent">
      <TextBlock :block="{ type: 'text', text: block.thinking }" :context="context" />
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import type { ThinkingBlock as ThinkingBlockType } from '../../../models/ContentBlock';
import type { ToolContext } from '../../../types/tool';
import { ThinkingExpandedKey } from '../transcriptState';
import TextBlock from './TextBlock.vue';

interface Props {
  block: ThinkingBlockType;
  context?: ToolContext;
  /** True while this block is still streaming in (the official `isPartial`). */
  isCurrentlyThinking?: boolean;
  /** How long the model thought, once known (the official `durationMillis`). */
  durationMillis?: number | null;
}

const props = withDefaults(defineProps<Props>(), {
  context: undefined,
  isCurrentlyThinking: false,
  durationMillis: null,
});

/** Shared with every other thinking block in the transcript; local if nothing provides it. */
const expanded = inject(ThinkingExpandedKey, ref(false));

function onToggle(event: Event): void {
  expanded.value = (event.target as HTMLDetailsElement).open;
}

const hasContent = computed(() => Boolean(props.block.thinking && props.block.thinking.trim()));

const label = computed(() => {
  if (props.isCurrentlyThinking) return 'Thinking...';
  if (props.durationMillis !== null) return `Thought for ${Math.round(props.durationMillis / 1000)}s`;
  return 'Thinking';
});
</script>
