/**
 * Mermaid diagrams in assistant markdown.
 *
 * **A Forge extension, not a port.** The official Claude Code webview has no
 * mermaid at all (`grep -i mermaid webview/index.js` finds nothing), so there a
 * ```mermaid fence renders as an ordinary code block. Forge draws it instead.
 *
 * Two things follow from that:
 * - the theme is ours, so every colour is read out of the Pajamas token layer at
 *   render time rather than named here. That keeps `lint:brand` honest and makes
 *   the diagram follow a VS Code light/dark flip like the rest of the UI;
 * - mermaid is large (~3 MB), so it is pulled in with a dynamic `import()` on
 *   first use and never lands in the main chunk.
 *
 * Diagram source comes from the model, so it is untrusted: mermaid runs at its
 * `strict` security level, which sanitises labels and refuses `click` handlers.
 */

/** Mermaid's own module type, without forcing the bundle to load it eagerly. */
type MermaidApi = typeof import('mermaid')['default'];

let mermaidPromise: Promise<MermaidApi> | null = null;
let themeKey = '';
let counter = 0;

/**
 * Resolve design tokens to concrete values by letting the browser do it: a
 * hidden probe inherits the document's cascade, so `var(--app-chart-1)` comes
 * back as a real colour even though it is three token hops from a hex.
 */
function resolveTokens(colourTokens: readonly string[], fontToken: string): { colours: string[]; font: string } {
  const probe = document.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  try {
    const colours = colourTokens.map((token) => {
      probe.style.color = '';
      probe.style.color = `var(${token})`;
      return getComputedStyle(probe).color;
    });
    probe.style.fontFamily = `var(${fontToken})`;
    const font = getComputedStyle(probe).fontFamily;
    return { colours, font };
  } finally {
    probe.remove();
  }
}

/**
 * Mermaid's `base` theme derives most of a diagram from a handful of variables,
 * so these are the ones worth pinning: the surface, the text, the lines, and the
 * eight categorical slots that pie / journey / class colours cycle through.
 */
function buildTheme(): { variables: Record<string, string>; key: string } {
  const CHART_TOKENS = [
    '--app-chart-1',
    '--app-chart-2',
    '--app-chart-3',
    '--app-chart-4',
    '--app-chart-5',
    '--app-chart-6',
    '--app-chart-7',
    '--app-chart-8',
  ] as const;
  const SURFACE_TOKENS = [
    '--app-primary-background',
    '--app-primary-foreground',
    '--app-secondary-foreground',
    '--app-widget-border',
    '--app-code-background',
    '--app-secondary-background',
  ] as const;

  const { colours, font } = resolveTokens([...CHART_TOKENS, ...SURFACE_TOKENS], '--app-font-family');
  const chart = colours.slice(0, CHART_TOKENS.length);
  const [background, foreground, muted, border, codeBackground, secondaryBackground] = colours.slice(
    CHART_TOKENS.length
  );

  const variables: Record<string, string> = {
    darkMode: 'false',
    background,
    fontFamily: font,
    fontSize: '13px',

    // Nodes.
    primaryColor: secondaryBackground,
    primaryTextColor: foreground,
    primaryBorderColor: chart[0],
    secondaryColor: codeBackground,
    secondaryTextColor: foreground,
    secondaryBorderColor: border,
    tertiaryColor: background,
    tertiaryTextColor: foreground,
    tertiaryBorderColor: border,
    mainBkg: secondaryBackground,
    nodeBorder: chart[0],
    nodeTextColor: foreground,

    // Edges, clusters, titles.
    lineColor: muted,
    textColor: foreground,
    titleColor: foreground,
    edgeLabelBackground: background,
    clusterBkg: codeBackground,
    clusterBorder: border,

    // Sequence diagrams.
    actorBkg: secondaryBackground,
    actorBorder: chart[0],
    actorTextColor: foreground,
    actorLineColor: muted,
    signalColor: foreground,
    signalTextColor: foreground,
    labelBoxBkgColor: secondaryBackground,
    labelBoxBorderColor: chart[0],
    labelTextColor: foreground,
    loopTextColor: foreground,
    activationBkgColor: codeBackground,
    activationBorderColor: chart[0],
    sequenceNumberColor: background,
    noteBkgColor: codeBackground,
    noteBorderColor: border,
    noteTextColor: foreground,

    // State / class / ER.
    labelColor: foreground,
    altBackground: codeBackground,
    attributeBackgroundColorOdd: background,
    attributeBackgroundColorEven: codeBackground,

    // Gantt.
    sectionBkgColor: codeBackground,
    sectionBkgColor2: background,
    altSectionBkgColor: background,
    taskBkgColor: chart[0],
    taskTextColor: background,
    taskTextOutsideColor: foreground,
    taskTextLightColor: background,
    taskBorderColor: chart[0],
    gridColor: border,
    doneTaskBkgColor: muted,
    doneTaskBorderColor: muted,
    critBkgColor: chart[5],
    critBorderColor: chart[5],
    todayLineColor: chart[3],
  };

  // Categorical slots: pie, journey, class and quadrant all cycle these.
  chart.forEach((colour, index) => {
    variables[`cScale${index}`] = colour;
    variables[`cScaleLabel${index}`] = background;
    variables[`pie${index + 1}`] = colour;
    variables[`surface${index}`] = colour;
  });
  variables.pieTitleTextColor = foreground;
  variables.pieSectionTextColor = background;
  variables.pieLegendTextColor = foreground;
  variables.pieStrokeColor = background;
  variables.pieOuterStrokeColor = border;

  return { variables, key: JSON.stringify(variables) };
}

/** Load mermaid once, and re-initialise it whenever the resolved theme changes. */
async function getMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((module) => module.default);
  }
  const mermaid = await mermaidPromise;
  const { variables, key } = buildTheme();
  if (key !== themeKey) {
    themeKey = key;
    mermaid.initialize({
      startOnLoad: false,
      // Diagram source is model output: sanitise labels, refuse click handlers.
      securityLevel: 'strict',
      // Without this, a diagram that does not parse -- routine while a message is
      // still streaming -- makes mermaid append its own "Syntax error in text"
      // graphic to document.body, outside the app entirely.
      suppressErrorRendering: true,
      theme: 'base',
      themeVariables: variables,
      flowchart: { htmlLabels: false, curve: 'basis', useMaxWidth: false },
      sequence: { useMaxWidth: false },
      gantt: { useMaxWidth: false },
      er: { useMaxWidth: false },
      journey: { useMaxWidth: false },
      class: { useMaxWidth: false },
      state: { useMaxWidth: false },
      pie: { useMaxWidth: false },
    });
  }
  return mermaid;
}

/** Forget the cached theme, so the next render re-reads the tokens. */
export function invalidateMermaidTheme(): void {
  themeKey = '';
}

export interface MermaidRenderResult {
  svg: string;
  /** A readable name for the diagram kind, for the block's label. */
  kind: string;
}

/**
 * Mermaid's internal diagram ids are not labels -- `flowchart-v2`, `er`,
 * `classDiagram`. Map the ones it ships to something a reader recognises, and
 * fall back to splitting camelCase for anything added in a later release.
 */
const KIND_LABELS: Readonly<Record<string, string>> = {
  flowchart: 'Flowchart',
  'flowchart-v2': 'Flowchart',
  graph: 'Flowchart',
  sequence: 'Sequence',
  classDiagram: 'Class',
  class: 'Class',
  stateDiagram: 'State',
  state: 'State',
  er: 'Entity relationship',
  gantt: 'Gantt',
  pie: 'Pie',
  journey: 'User journey',
  gitGraph: 'Git graph',
  mindmap: 'Mindmap',
  timeline: 'Timeline',
  quadrantChart: 'Quadrant',
  requirement: 'Requirement',
  c4: 'C4',
  sankey: 'Sankey',
  xychart: 'XY chart',
  block: 'Block',
  packet: 'Packet',
  architecture: 'Architecture',
  kanban: 'Kanban',
  radar: 'Radar',
  treemap: 'Treemap',
  usecase: 'Use case',
};

export function diagramKindLabel(kind: string): string {
  if (!kind) return 'Diagram';
  const known = KIND_LABELS[kind];
  if (known) return known;
  const spaced = kind.replace(/[-_]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Render one diagram. Errors are returned to the caller rather than thrown into
 * the transcript: a half-typed diagram is normal while a message is streaming.
 */
export async function renderMermaid(source: string): Promise<MermaidRenderResult> {
  const mermaid = await getMermaid();
  const id = `fg-mermaid-${Date.now().toString(36)}-${counter++}`;
  let kind = '';
  try {
    kind = mermaid.detectType(source);
  } catch {
    kind = '';
  }
  try {
    const { svg } = await mermaid.render(id, source);
    return { svg, kind: diagramKindLabel(kind) };
  } finally {
    // mermaid measures in a scratch element it does not always clean up.
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
  }
}

/**
 * Mermaid writes its own `max-width` and a fixed `font-family` onto the root
 * `<svg>`. Strip both: the block sizes the diagram, and the font has to stay on
 * the bundled faces rather than whatever mermaid decided.
 */
export function normaliseDiagramSvg(svg: SVGElement): void {
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.style.maxWidth = 'none';
  svg.style.width = '100%';
  svg.style.height = '100%';
  if (!svg.getAttribute('preserveAspectRatio')) {
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  }
}

/** The intrinsic size mermaid gave the diagram, for fit-to-width maths. */
export function diagramSize(svg: SVGElement): { width: number; height: number } {
  const viewBox = svg.getAttribute('viewBox');
  if (viewBox) {
    const [, , width, height] = viewBox.split(/[\s,]+/).map(Number);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height };
    }
  }
  const box = svg.getBoundingClientRect();
  return { width: box.width || 1, height: box.height || 1 };
}
