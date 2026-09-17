/**
 * A tool call in the transcript (official `jn`, module ZUQaOA):
 *
 *   div.root
 *     summary.toolSummary > span > <the tool's header>
 *     <the tool's body>
 *
 * No icon, no status light, no expand toggle: the status lives on the message's
 * timeline dot, and each tool's body decides what to show.
 */
import { defineComponent, h, type PropType } from 'vue';
import { useSignal } from '@gn8/alien-signals-vue';
import type { ContentBlockWrapper } from '../../../models/ContentBlockWrapper';
import type { ToolUseBlock } from '../../../models/ContentBlock';
import type { ToolContext } from '../../../types/tool';
import ContentBlock from '../ContentBlock.vue';
import { TOOL } from './toolParts';
import { getToolRenderer, type ToolRenderContext } from './toolRegistry';

export default defineComponent({
  name: 'ToolUse',
  props: {
    wrapper: { type: Object as PropType<ContentBlockWrapper>, required: true },
    context: { type: Object as PropType<ToolContext>, required: true },
  },
  setup(props) {
    const toolResult = useSignal(props.wrapper.toolResult);
    // A streamed block is completed in place; the revision re-renders the call when it is.
    const revision = useSignal(props.wrapper.revision);

    const ctx: ToolRenderContext = {
      fileOpener: {
        open: (filePath, location) => props.context.fileOpener.open(filePath, location),
        openContent: (content, fileName, editable) => props.context.fileOpener.openContent(content, fileName, editable),
      },
      renderContent: (block) => h(ContentBlock, { block, context: props.context }),
    };

    return () => {
      void revision.value;
      const block = props.wrapper.content as ToolUseBlock;
      const renderer = getToolRenderer(block.name);
      if (renderer.hidden) return null;
      const input = block.input ?? {};
      return h('div', { class: TOOL.root }, [
        h('summary', { class: TOOL.toolSummary }, [h('span', [renderer.header(ctx, input)] as any)]),
        renderer.body(ctx, input, toolResult.value, []) as any,
      ]);
    };
  },
});
