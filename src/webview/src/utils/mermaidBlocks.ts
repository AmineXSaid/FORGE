/**
 * Turning the markdown renderer's mermaid placeholders into live diagrams.
 *
 * `TextBlock` renders markdown with `v-html`, so a diagram is not a component --
 * it is a `<div data-mermaid-source>` that this module finds afterwards, renders
 * into, and wires up. Keeping it here rather than in the component keeps the
 * DOM-walking testable and keeps `TextBlock` the shape the port left it.
 */
import { diagramSize, normaliseDiagramSvg, renderMermaid } from './mermaid';

/** Zoom bounds and step, shared by the inline block and the wide viewer. */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 8;
const ZOOM_STEP = 1.25;

export const clampZoom = (value: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));

/** One zoom notch in or out, clamped. `direction` is 1 for in, -1 for out. */
export const stepZoom = (value: number, direction: number): number =>
  clampZoom(direction > 0 ? value * ZOOM_STEP : value / ZOOM_STEP);

/** The scale that makes a diagram exactly fill the width available to it. */
export function fitScale(available: number, intrinsic: number): number {
  if (!(available > 0) || !(intrinsic > 0)) return 1;
  // Never blow a small diagram up to fill the column -- only shrink to fit.
  return clampZoom(Math.min(1, available / intrinsic));
}

const RENDERED = 'data-mermaid-rendered';

/**
 * Render every diagram inside `root` that has not been rendered yet.
 *
 * `onExpand` is handed the finished SVG markup so the wide viewer shows the very
 * same diagram rather than rendering it a second time.
 */
export async function renderMermaidBlocks(
  root: HTMLElement,
  onExpand: (svg: string, kind: string) => void
): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>('.fg-mermaid__block')].filter(
    (block) => block.getAttribute(RENDERED) !== 'true'
  );
  if (blocks.length === 0) return;

  for (const block of blocks) {
    const source = block.getAttribute('data-mermaid-source');
    if (!source) continue;
    block.setAttribute(RENDERED, 'true');
    const stage = block.querySelector<HTMLElement>('.fg-mermaid__stage');
    if (!stage) continue;

    try {
      const { svg, kind } = await renderMermaid(source);
      stage.innerHTML = svg;
      const element = stage.querySelector('svg');
      if (!element) continue;
      normaliseDiagramSvg(element);
      block.setAttribute('data-mermaid-kind', kind);
      const label = block.querySelector('.fg-mermaid__kind');
      if (label) label.textContent = kind;
      attachControls(block, stage, element, svg, kind, onExpand);
      block.classList.add('fg-mermaid__ready');
    } catch (error) {
      block.classList.add('fg-mermaid__failed');
      const message = error instanceof Error ? error.message : String(error);
      stage.textContent = '';
      const note = document.createElement('div');
      note.className = 'fg-mermaid__error';
      note.textContent = `Diagram could not be drawn: ${message.split('\n')[0]}`;
      stage.appendChild(note);
      const pre = document.createElement('pre');
      pre.className = 'fg-mermaid__errorSource';
      pre.textContent = source;
      stage.appendChild(pre);
    }
  }
}

/** Zoom buttons, wheel zoom, drag-to-pan and "open wider" for one diagram. */
function attachControls(
  block: HTMLElement,
  stage: HTMLElement,
  svg: SVGElement,
  svgMarkup: string,
  kind: string,
  onExpand: (svg: string, kind: string) => void
): void {
  const canvas = block.querySelector<HTMLElement>('.fg-mermaid__canvas');
  const zoomLabel = block.querySelector<HTMLElement>('.fg-mermaid__zoomValue');
  if (!canvas) return;

  const intrinsic = diagramSize(svg);
  let scale = fitScale(canvas.clientWidth, intrinsic.width);
  const base = scale;

  const apply = () => {
    stage.style.width = `${intrinsic.width * scale}px`;
    stage.style.height = `${intrinsic.height * scale}px`;
    if (zoomLabel) zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  };
  apply();

  block.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-mermaid-action]');
    if (!action) return;
    event.preventDefault();
    switch (action.getAttribute('data-mermaid-action')) {
      case 'zoom-in':
        scale = stepZoom(scale, 1);
        break;
      case 'zoom-out':
        scale = stepZoom(scale, -1);
        break;
      case 'reset':
        scale = base;
        canvas.scrollTo({ left: 0, top: 0 });
        break;
      case 'expand':
        onExpand(svgMarkup, kind);
        return;
      default:
        return;
    }
    apply();
  });

  // Ctrl/Cmd + wheel zooms, like an editor; a plain wheel still scrolls the page.
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      scale = stepZoom(scale, event.deltaY < 0 ? 1 : -1);
      apply();
    },
    { passive: false }
  );

  attachPan(canvas);
}

/** Drag anywhere on the diagram to pan it, once it is bigger than its frame. */
export function attachPan(canvas: HTMLElement): void {
  let panning = false;
  let startX = 0;
  let startY = 0;
  let scrollLeft = 0;
  let scrollTop = 0;

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('[data-mermaid-action]')) return;
    panning = true;
    startX = event.clientX;
    startY = event.clientY;
    scrollLeft = canvas.scrollLeft;
    scrollTop = canvas.scrollTop;
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('fg-mermaid__panning');
  });

  const end = (event: PointerEvent) => {
    if (!panning) return;
    panning = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.classList.remove('fg-mermaid__panning');
  };

  canvas.addEventListener('pointermove', (event) => {
    if (!panning) return;
    canvas.scrollLeft = scrollLeft - (event.clientX - startX);
    canvas.scrollTop = scrollTop - (event.clientY - startY);
  });
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}
