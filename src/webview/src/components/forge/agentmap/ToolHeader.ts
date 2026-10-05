/**
 * A tool call's one-line header, as the Agent map draws it: the official
 * `BY(name, ctx).header(ctx, input)` -- the same renderer the transcript uses
 * for the call's summary row.
 */
import { defineComponent, h, type PropType } from 'vue';
import type { ContentBlockWrapper } from '../../../models/ContentBlockWrapper';
import type { ToolUseBlock } from '../../../models/ContentBlock';
import type { ToolContext } from '../../../types/tool';
import ContentBlock from '../../Messages/ContentBlock.vue';
import { getToolRenderer, type ToolRenderContext } from '../../Messages/tools/toolRegistry';

export default defineComponent({
  name: 'ToolHeader',
  props: {
    block: { type: Object as PropType<ContentBlockWrapper>, required: true },
    context: { type: Object as PropType<ToolContext>, required: true },
  },
  setup(props) {
    const ctx: ToolRenderContext = {
      fileOpener: {
        open: (filePath, location) => props.context.fileOpener.open(filePath, location),
        openContent: (content, fileName, editable) => props.context.fileOpener.openContent(content, fileName, editable),
      },
      renderContent: (block) => h(ContentBlock, { block, context: props.context }),
    };
    return () => {
      const use = props.block.content as ToolUseBlock;
      return getToolRenderer(use.name).header(ctx, (use.input ?? {}) as Record<string, unknown>);
    };
  },
});
