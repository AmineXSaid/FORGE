<template>
  <!--
    "Open wider": the same diagram the transcript already drew, on a surface that
    can use the whole panel. Mounted once in App.vue, because the transcript
    renders markdown through v-html and a diagram there is plain DOM.
  -->
  <div
    v-if="viewer.isOpen.value"
    class="fg-mermaidviewer__backdrop"
    role="dialog"
    aria-modal="true"
    :aria-label="`${label} diagram`"
    @pointerdown.self="viewer.close()"
  >
    <div class="fg-mermaidviewer__panel">
      <div class="fg-mermaidviewer__toolbar">
        <span class="fg-mermaidviewer__kind">{{ label }}</span>
        <span class="fg-mermaidviewer__spacer"></span>
        <button type="button" class="fg-mermaid__button" title="Zoom out" aria-label="Zoom out" @click="zoom(-1)">
          <svg class="fg-mermaid__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M3.5 8h9" /></svg>
        </button>
        <span class="fg-mermaid__zoomValue">{{ Math.round(scale * 100) }}%</span>
        <button type="button" class="fg-mermaid__button" title="Zoom in" aria-label="Zoom in" @click="zoom(1)">
          <svg class="fg-mermaid__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
        </button>
        <button type="button" class="fg-mermaid__button" title="Fit to window" aria-label="Fit to window" @click="fit()">
          <svg class="fg-mermaid__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6V2.5H6" /><path d="M10 2.5h3.5V6" /><path d="M13.5 10v3.5H10" /><path d="M6 13.5H2.5V10" /></svg>
        </button>
        <button type="button" class="fg-mermaid__button" title="Close (Esc)" aria-label="Close" @click="viewer.close()">
          <svg class="fg-mermaid__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
        </button>
      </div>
      <div ref="canvasRef" class="fg-mermaidviewer__canvas" @wheel="onWheel">
        <div ref="stageRef" class="fg-mermaidviewer__stage" v-html="viewer.svg.value"></div>
      </div>
      <p class="fg-mermaidviewer__hint">Drag to pan · Ctrl and scroll to zoom · Esc to close</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { useMermaidViewer } from '../../composables/useMermaidViewer';
import { attachPan, fitScale, stepZoom } from '../../utils/mermaidBlocks';
import { diagramSize, normaliseDiagramSvg } from '../../utils/mermaid';

const viewer = useMermaidViewer();
const canvasRef = useTemplateRef<HTMLElement>('canvasRef');
const stageRef = useTemplateRef<HTMLElement>('stageRef');

const scale = ref(1);
const intrinsic = ref({ width: 1, height: 1 });
let panAttached = false;

const label = computed(() => viewer.kind.value || 'Diagram');

function apply(): void {
  if (!stageRef.value) return;
  stageRef.value.style.width = `${intrinsic.value.width * scale.value}px`;
  stageRef.value.style.height = `${intrinsic.value.height * scale.value}px`;
}

function zoom(direction: number): void {
  scale.value = stepZoom(scale.value, direction);
  apply();
}

function fit(): void {
  const canvas = canvasRef.value;
  if (!canvas) return;
  // Fit both axes, so a tall diagram is fully visible rather than just as wide.
  scale.value = Math.min(
    fitScale(canvas.clientWidth - 24, intrinsic.value.width),
    fitScale(canvas.clientHeight - 24, intrinsic.value.height)
  );
  canvas.scrollTo({ left: 0, top: 0 });
  apply();
}

function onWheel(event: WheelEvent): void {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  zoom(event.deltaY < 0 ? 1 : -1);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && viewer.isOpen.value) {
    event.preventDefault();
    viewer.close();
  }
}

watch(
  () => viewer.svg.value,
  async (svg) => {
    if (!svg) {
      panAttached = false;
      return;
    }
    await nextTick();
    const element = stageRef.value?.querySelector('svg');
    if (!element) return;
    normaliseDiagramSvg(element);
    intrinsic.value = diagramSize(element);
    fit();
    if (canvasRef.value && !panAttached) {
      attachPan(canvasRef.value);
      panAttached = true;
    }
  }
);

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>
