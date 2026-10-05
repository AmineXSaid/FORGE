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

/** The toolbar's line icons, drawn in the text colour. */
export const diagramIcon = (body: string) =>
  `<svg class="fg-mermaid__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const MINUS_ICON = diagramIcon('<path d="M3.5 8h9"/>');
const PLUS_ICON = diagramIcon('<path d="M8 3.5v9M3.5 8h9"/>');
const RESET_ICON = diagramIcon('<path d="M2.5 8a5.5 5.5 0 1 1 1.7 3.96"/><path d="M2.2 12.2V8.6h3.6"/>');
const EXPAND_ICON = diagramIcon('<path d="M9.5 2.5h4v4"/><path d="M6.5 13.5h-4v-4"/><path d="M13.5 2.5 9 7"/><path d="M2.5 13.5 7 9"/>');

const escapeAttribute = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The placeholder a diagram renders into: the source in an attribute, the
 * toolbar (kind, zoom, reset, open wider) and an empty stage. The transcript's
 * mermaid fences and the Settings Guide both emit it, so a diagram looks and
 * works the same wherever it appears; `renderMermaidBlocks` fills it in.
 */
export function mermaidBlockHtml(source: string): string {
  return (
    `<div class="fg-mermaid__block" data-mermaid-source="${escapeAttribute(source)}">` +
    '<div class="fg-mermaid__toolbar">' +
    '<span class="fg-mermaid__kind">diagram</span>' +
    '<span class="fg-mermaid__spacer"></span>' +
    `<button type="button" class="fg-mermaid__button" data-mermaid-action="zoom-out" title="Zoom out" aria-label="Zoom out">${MINUS_ICON}</button>` +
    '<span class="fg-mermaid__zoomValue">100%</span>' +
    `<button type="button" class="fg-mermaid__button" data-mermaid-action="zoom-in" title="Zoom in" aria-label="Zoom in">${PLUS_ICON}</button>` +
    `<button type="button" class="fg-mermaid__button" data-mermaid-action="reset" title="Reset zoom" aria-label="Reset zoom">${RESET_ICON}</button>` +
    `<button type="button" class="fg-mermaid__button" data-mermaid-action="expand" title="Open wider" aria-label="Open diagram wider">${EXPAND_ICON}</button>` +
    '</div>' +
    '<div class="fg-mermaid__canvas"><div class="fg-mermaid__stage"></div></div>' +
    '</div>'
  );
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

/** The keywords a mermaid diagram opens with. */
const MERMAID_HEADERS = [
  'graph', 'flowchart', 'flowchart-elk', 'sequenceDiagram', 'classDiagram', 'classDiagram-v2',
  'stateDiagram', 'stateDiagram-v2', 'erDiagram', 'journey', 'gantt', 'pie', 'quadrantChart',
  'requirementDiagram', 'gitGraph', 'C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment',
  'mindmap', 'timeline', 'zenuml', 'sankey', 'sankey-beta', 'xychart', 'xychart-beta', 'block', 'block-beta',
  'packet', 'packet-beta', 'architecture', 'architecture-beta', 'kanban', 'radar-beta', 'treemap', 'treemap-beta',
  'venn-beta', 'ishikawa', 'treeView-beta', 'wardley-beta', 'swimlane-beta', 'usecase-beta', 'cynefin-beta',
  'eventmodeling', 'railroad-beta', 'railroad-abnf-beta', 'railroad-ebnf-beta', 'railroad-peg-beta', 'agentflow-beta',
];
const HEADER_SET = new Set(MERMAID_HEADERS.map((h) => h.toLowerCase()));

/**
 * Whether a fenced block is a mermaid diagram. ```mermaid always is; models
 * also label the fence with the diagram kind (```flowchart, ```sequenceDiagram)
 * or leave it bare, and those drew as code (reported 2026-10-03). A bare or
 * kind-labelled fence counts only when its first line opens a diagram.
 */
export function isMermaidFence(lang: string | undefined, source: string): boolean {
  const label = (lang ?? '').trim().toLowerCase();
  if (label === 'mermaid' || label === 'mmd') return true;
  if (label && !HEADER_SET.has(label)) return false;
  // Skip what may precede the header: `%%` comments and `%%{init}%%`
  // directives, and a `---` frontmatter block (`title:`, `config:`).
  const body = source
    .replace(/^\s*---[ \t]*\n[\s\S]*?\n---[ \t]*(\n|$)/, '')
    .replace(/^\s*(%%[^\n]*\n\s*)*/, '');
  const [first = '', ...rest] = body.split('\n');
  const header = first.trim();
  const keyword = /^[A-Za-z0-9-]+/.exec(header)?.[0]?.toLowerCase();
  if (!keyword || !HEADER_SET.has(keyword)) return false;
  // `graph`/`flowchart` are also English words: a diagram names a direction,
  // or (mermaid defaults to TB) stands alone with edges on the lines below.
  if (keyword === 'graph' || keyword === 'flowchart') {
    if (/^(graph|flowchart)\s+(TB|TD|BT|RL|LR)\b/i.test(header)) return true;
    return /^(graph|flowchart)$/i.test(header) && rest.some((line) => /(-->|---|-\.->|==>|--[ox]|<-->)/.test(line));
  }
  return true;
}

/** The source to hand mermaid: a kind-labelled fence lacks its header line. */
export function mermaidSource(lang: string | undefined, source: string): string {
  const label = (lang ?? '').trim();
  if (!label || /^(mermaid|mmd)$/i.test(label)) return source;
  const first = source.trim().split('\n', 1)[0]!.trim().toLowerCase();
  return first.startsWith(label.toLowerCase()) ? source : `${label}\n${source}`;
}
