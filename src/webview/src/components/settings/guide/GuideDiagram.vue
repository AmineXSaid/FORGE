<template>
  <!--
    A Guide diagram: the transcript's own mermaid block (toolbar, zoom, open
    wider), rendered when the answer holding it is first opened. The source is
    the Guide's, not the model's, but it still goes through the same strict
    renderer. `v-html` only ever receives `mermaidBlockHtml`'s fixed markup,
    with the source escaped into an attribute.
  -->
  <div ref="rootRef" class="fg-guide-diagram" v-html="html"></div>
</template>

<script setup lang="ts">
import { computed, onMounted, useTemplateRef } from 'vue';
import { mermaidBlockHtml, renderMermaidBlocks } from '../../../utils/mermaidBlocks';
import { useMermaidViewer } from '../../../composables/useMermaidViewer';

const props = defineProps<{ source: string }>();
const html = computed(() => mermaidBlockHtml(props.source));
const rootRef = useTemplateRef<HTMLElement>('rootRef');
const viewer = useMermaidViewer();

onMounted(() => {
  if (rootRef.value) void renderMermaidBlocks(rootRef.value, viewer.open);
});
</script>

<style scoped>
/*
  The transcript caps a diagram at 520px tall so it cannot take over the chat.
  In the Guide a diagram is the answer, so it is shown whole: still scaled to
  the column's width, never cut off at the bottom.
*/
.fg-guide-diagram :deep(.fg-mermaid__canvas) {
  max-height: none;
}
</style>
