<template>
  <!-- 根据 block.type 选择性传递 wrapper -->
  <!-- 只有 tool_use 需要 wrapper 来访问 toolResult Signal -->
  <!-- The official `Nn0`: a tool_use still streaming renders nothing until it has a result. -->
  <template v-if="block.type === 'tool_use'">
    <component
      v-if="!isPartial || toolResult"
      :is="blockComponent"
      :block="view"
      :wrapper="wrapper"
      :context="context"
    />
  </template>
  <!-- 其他类型不需要 wrapper，避免渲染到 DOM -->
  <component
    v-else
    :is="blockComponent"
    :block="view"
    :context="context"
    v-bind="partialProps"
  />
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watchEffect } from 'vue';
import { effect } from 'alien-signals';
import type { ContentBlockType, ToolResultBlock } from '../../models/ContentBlock';
import type { ContentBlockWrapper } from '../../models/ContentBlockWrapper';
import type { ToolContext } from '../../types/tool';

// 导入所有内容块组件
import TextBlock from './blocks/TextBlock.vue';
import ThinkingBlock from './blocks/ThinkingBlock.vue';
import ImageBlock from './blocks/ImageBlock.vue';
import DocumentBlock from './blocks/DocumentBlock.vue';
import InterruptBlock from './blocks/InterruptBlock.vue';
import LLMErrorBlock from './blocks/LLMErrorBlock.vue';
import SelectionBlock from './blocks/SelectionBlock.vue';
import OpenedFileBlock from './blocks/OpenedFileBlock.vue';
import DiagnosticsBlock from './blocks/DiagnosticsBlock.vue';
import ToolBlock from './blocks/ToolBlock.vue';
import ToolResultBlockView from './blocks/ToolResultBlock.vue';
import UnknownBlock from './blocks/UnknownBlock.vue';

interface Props {
  block: ContentBlockType;
  context?: ToolContext;
  wrapper?: ContentBlockWrapper;
}

const props = defineProps<Props>();

// The wrapper's streaming state as Vue refs, following the wrapper if it changes.
const isPartial = ref(false);
const revision = ref(0);
const toolResult = shallowRef<ToolResultBlock | undefined>(undefined);
watchEffect((onCleanup) => {
  const wrapper = props.wrapper;
  if (!wrapper) {
    isPartial.value = false;
    revision.value = 0;
    toolResult.value = undefined;
    return;
  }
  onCleanup(
    effect(() => {
      isPartial.value = wrapper.partial();
      revision.value = wrapper.revision();
      toolResult.value = wrapper.toolResult();
    })
  );
});

// A streamed delta mutates the block in place, so hand children a fresh object
// after each one; blocks that never streamed keep their original object.
const view = computed(() => (revision.value > 0 ? ({ ...props.block } as ContentBlockType) : props.block));

// The official `Nn0` passes the wrapper's partial flag: `isPartialText` to the
// markdown text (`r$`, rule `wL0`) and `isCurrentlyThinking` to the thinking block.
const partialProps = computed(() => {
  switch (props.block.type) {
    case 'text':
      return { isPartialText: isPartial.value };
    case 'thinking':
      return { streaming: isPartial.value };
    default:
      return {};
  }
});

// 根据 block.type 选择对应的组件
const blockComponent = computed(() => {
  switch (props.block.type) {
    case 'text':
      return TextBlock;
    case 'thinking':
      return ThinkingBlock;
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
    case 'tool_use':
      return ToolBlock;
    case 'tool_result':
      return ToolResultBlockView;
    default:
      return UnknownBlock;
  }
});
</script>
