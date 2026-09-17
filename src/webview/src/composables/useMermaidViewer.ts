/**
 * The "open wider" surface for a mermaid diagram.
 *
 * The transcript renders markdown through `v-html`, so a diagram is plain DOM
 * rather than a component and cannot open a modal by itself. This is the shred
 * of shared state between the two: a block hands over the SVG it has already
 * rendered, and the single `MermaidViewer` mounted in `App.vue` shows it.
 */
import { computed, ref } from 'vue';

const svg = ref<string | null>(null);
const kind = ref('');

export function useMermaidViewer() {
  return {
    svg,
    kind,
    isOpen: computed(() => svg.value !== null),
    open(diagramSvg: string, diagramKind = ''): void {
      svg.value = diagramSvg;
      kind.value = diagramKind;
    },
    close(): void {
      svg.value = null;
      kind.value = '';
    },
  };
}
