<template>
  <!--
    One content block, as the official content renderer draws it (`jK` / `Nn0`,
    module uq5aLg), inside its error boundary (`zy`):

      tool_reference  div.toolReference > code
      text            markdown
      tool_use        div.toolUse > <tool call>   (nothing while still streaming in)
      tool_result     div.toolResult > pre | div > <blocks>
      thinking        the thinking block
      anything else   div.unknownContent "Unsupported content type: <code>"

    The attachment and IDE-context types (image, document, selection, ...) are
    Forge's parsed forms of what the official reads out of a user message, and
    keep their own components.
  -->
  <div v-if="renderError !== undefined" class="fg-content__contentError">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" data-slot="icon">
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
      />
    </svg>
    <h2 aria-level="6">Something went wrong</h2>
    <p>Re-launch the extension to continue.</p>
    <a style="color: inherit" href="https://code.claude.com/docs/en/vs-code#troubleshooting">Troubleshooting resources</a>
    <p><code>Error rendering content: {{ renderError || 'Unknown' }}</code></p>
  </div>
  <div v-else-if="isToolReference" class="fg-content__toolReference">
    <code>{{ (block as any).tool_name }}</code>
  </div>
  <TextBlock v-else-if="block.type === 'text'" :block="block" :context="context" />
  <template v-else-if="block.type === 'tool_use'">
    <div v-if="wrapper && context" class="fg-content__toolUse">
      <ToolUse :wrapper="wrapper" :context="context" />
    </div>
  </template>
  <div v-else-if="block.type === 'tool_result'" class="fg-content__toolResult">
    <pre v-if="typeof block.content === 'string'">{{ block.content || '0' }}</pre>
    <div v-else-if="Array.isArray(block.content)">
      <ContentBlock
        v-for="(child, i) in block.content.filter((c: any) => c.type !== 'tool_reference')"
        :key="i"
        :block="child"
        :context="context"
      />
    </div>
  </div>
  <ThinkingBlock v-else-if="block.type === 'thinking'" :block="block" :context="context" />
  <component :is="forgeBlock" v-else-if="forgeBlock" :block="block as any" :context="context" />
  <div v-else class="fg-content__unknownContent">
    Unsupported content type: <code>{{ block.type }}</code>
  </div>
</template>

<script setup lang="ts">
import { computed, onErrorCaptured, ref } from 'vue';
import type { ContentBlockType } from '../../models/ContentBlock';
import type { ContentBlockWrapper } from '../../models/ContentBlockWrapper';
import type { ToolContext } from '../../types/tool';

import TextBlock from './blocks/TextBlock.vue';
import ThinkingBlock from './blocks/ThinkingBlock.vue';
import ImageBlock from './blocks/ImageBlock.vue';
import DocumentBlock from './blocks/DocumentBlock.vue';
import InterruptBlock from './blocks/InterruptBlock.vue';
import LLMErrorBlock from './blocks/LLMErrorBlock.vue';
import SelectionBlock from './blocks/SelectionBlock.vue';
import OpenedFileBlock from './blocks/OpenedFileBlock.vue';
import DiagnosticsBlock from './blocks/DiagnosticsBlock.vue';
import ToolUse from './tools/ToolUse';

defineOptions({ name: 'ContentBlock' });

interface Props {
  block: ContentBlockType;
  context?: ToolContext;
  wrapper?: ContentBlockWrapper;
}

const props = defineProps<Props>();

/** `Hv` */
const isToolReference = computed(() => (props.block as { type: string }).type === 'tool_reference');

const forgeBlock = computed(() => {
  switch (props.block.type) {
    case 'image':
      return ImageBlock;
    case 'document':
      return DocumentBlock;
    case 'interrupt':
      return InterruptBlock;
    case 'llm_error':
      return LLMErrorBlock;
    case 'selection':
      return SelectionBlock;
    case 'opened_file':
      return OpenedFileBlock;
    case 'diagnostics':
      return DiagnosticsBlock;
    default:
      return null;
  }
});

/** The official error boundary (`zy` / `wn0`): a block that throws is replaced, not the transcript. */
const renderError = ref<string | undefined>(undefined);
onErrorCaptured((error) => {
  console.error('Error rendering content:', error);
  renderError.value = error instanceof Error ? error.message : String(error);
  return false;
});
</script>
