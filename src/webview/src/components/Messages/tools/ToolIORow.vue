<template>
  <!--
    One input or output row of a tool call on the terminal surface:

      div.fterm-section
        div.fterm-io            IN / OUT gutter, the lines, a copy button on hover
        div.fterm-footer        line count, expand / collapse, open in an editor tab
  -->
  <div class="fterm-section">
    <div class="fterm-io">
      <span v-if="row.label" class="fterm-io-label" aria-hidden="true">{{ row.label }}</span>
      <div class="fterm-io-body" :aria-label="row.label === 'IN' ? 'Tool input' : row.label === 'OUT' ? 'Tool output' : undefined">
        <NodeView v-if="row.node" :node="row.node" />
        <TerminalLines
          v-else
          :lines="collapse.visible.value"
          :key-offset="collapse.offset.value"
          :class="[collapse.stateClass.value, { 'fterm-error': row.error }]"
          empty-text="No output"
        />
      </div>
      <CopyButton v-if="!row.node && plain" :get-text="() => plain" />
    </div>
    <TerminalFooter
      v-if="!row.node && (collapse.canCollapse.value || openable)"
      :line-count="lines.length"
      :can-collapse="collapse.canCollapse.value"
      :expanded="collapse.expanded.value"
      :toggle-label="collapse.toggleLabel.value"
      :openable="openable"
      @toggle="collapse.toggle"
      @open="open"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, type PropType, type VNodeChild } from 'vue';
import TerminalLines from './TerminalLines.vue';
import TerminalFooter from './TerminalFooter.vue';
import { CopyButton, isLongText } from './toolParts';
import { formatLines, linesText, resolveFormat, type ToolIORowSpec } from './terminalText';
import { useLineCollapse } from './useLineCollapse';
import type { ToolRenderContext } from './toolRegistry';

const props = defineProps<{
  row: ToolIORowSpec;
  context: ToolRenderContext;
}>();

/** Draws a VNode handed over in the row spec. */
const NodeView = defineComponent({
  props: { node: { type: [Object, Array, String] as PropType<VNodeChild>, default: null } },
  setup: (p) => () => p.node,
});

/** Lines shown before "Show N more lines". */
const DEFAULT_LIMIT = 8;

const lines = computed(() => {
  const text = props.row.text ?? '';
  return formatLines(text, resolveFormat(text, props.row.format));
});

const plain = computed(() => linesText(lines.value));

const collapse = useLineCollapse(
  lines,
  computed(() => props.row.collapse ?? 'head'),
  computed(() => props.row.limit ?? DEFAULT_LIMIT)
);

const openable = computed(() => !!props.row.openTitle && isLongText(plain.value));

function open(): void {
  if (props.row.openTitle) void props.context.fileOpener.openContent(plain.value, props.row.openTitle, false);
}
</script>
