/**
 * Forge's two deliberate additions to the assistant markdown renderer.
 *
 * Both diverge from the official webview on purpose, so the point of these
 * tests is that the divergence stays exactly as wide as intended:
 * - raw HTML renders for a short inline allowlist and for nothing else. The
 *   official passes `remarkPlugins:[remark-gfm]` with no `rehypePlugins`, so it
 *   shows every tag as text; Forge renders `<kbd>` and friends, and still shows
 *   the rest as text. Attributes never survive -- this is model output.
 * - a ```mermaid fence becomes a diagram placeholder instead of a code block.
 */
import { describe, expect, it } from 'vitest';
import { Marked, type Tokens } from 'marked';
import { clampZoom, fitScale, stepZoom, ZOOM_MAX, ZOOM_MIN } from '../src/webview/src/utils/mermaidBlocks';
import { diagramKindLabel } from '../src/webview/src/utils/mermaid';

/*
 * The renderer overrides under test, kept in step with TextBlock.vue. Only the
 * `html` and `code` hooks matter here; the rest of the component is Vue.
 */
const INLINE_HTML_TAGS = new Set([
  'kbd', 'sub', 'sup', 'abbr', 'mark', 'u', 's', 'ins', 'del', 'samp', 'var', 'small', 'br', 'wbr',
]);
const BARE_TAG_RE = /^<(\/?)([a-z][a-z0-9]*)\s*\/?>$/i;

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderHtmlToken(raw: string): string {
  const match = BARE_TAG_RE.exec(raw.trim());
  const tag = match?.[2]?.toLowerCase();
  if (tag && INLINE_HTML_TAGS.has(tag)) return `<${match![1] ? '/' : ''}${tag}>`;
  return escapeHtml(raw);
}

/** The same pipeline TextBlock builds, reduced to the two hooks under test. */
function makeRenderer() {
  const md = new Marked({ gfm: true, breaks: false });
  md.use({
    renderer: {
      code(token: Tokens.Code) {
        const lang = (token.lang || '').match(/^\S*/)?.[0];
        if (lang?.toLowerCase() === 'mermaid') {
          return `<div class="fg-mermaid__block" data-mermaid-source="${escapeHtml(token.text)}"></div>`;
        }
        return `<pre><code>${escapeHtml(token.text)}\n</code></pre>`;
      },
      html(token: Tokens.HTML | Tokens.Tag) {
        return renderHtmlToken(token.text);
      },
    },
  });
  return md;
}

describe('inline HTML: the allowlist renders, everything else stays text', () => {
  it('renders <kbd>, so the --app-kbd-* tokens can reach something', () => {
    const html = makeRenderer().parse('Press <kbd>Ctrl</kbd>+<kbd>C</kbd>.') as string;
    expect(html).toContain('<kbd>Ctrl</kbd>');
    expect(html).toContain('<kbd>C</kbd>');
    expect(html).not.toContain('&lt;kbd&gt;');
  });

  it('renders the rest of the inline allowlist', () => {
    for (const tag of INLINE_HTML_TAGS) {
      if (tag === 'br' || tag === 'wbr') continue;
      const html = makeRenderer().parse(`a <${tag}>b</${tag}> c`) as string;
      expect(html, tag).toContain(`<${tag}>b</${tag}>`);
    }
  });

  it('normalises case and a self-closing slash', () => {
    expect(renderHtmlToken('<KBD>')).toBe('<kbd>');
    expect(renderHtmlToken('</KBD>')).toBe('</kbd>');
    expect(renderHtmlToken('<br/>')).toBe('<br>');
    expect(renderHtmlToken('<br />')).toBe('<br>');
  });

  it('never lets an attribute through, on an allowed tag or any other', () => {
    for (const raw of [
      '<kbd onclick="alert(1)">',
      '<kbd class="x">',
      '<kbd style="color:red">',
      '<img src=x onerror=alert(1)>',
      '<a href="javascript:alert(1)">',
      '<iframe src="https://evil.example">',
      '<svg onload=alert(1)>',
    ]) {
      const out = renderHtmlToken(raw);
      expect(out, raw).not.toContain('<');
      expect(out, raw).toContain('&lt;');
    }
  });

  it('keeps the official behaviour for tags that are not on the list', () => {
    expect(renderHtmlToken('<script>')).toBe('&lt;script&gt;');
    expect(renderHtmlToken('<div>')).toBe('&lt;div&gt;');
    expect(renderHtmlToken('<style>')).toBe('&lt;style&gt;');
  });

  it('does not treat a comment or a doctype as a tag', () => {
    expect(renderHtmlToken('<!-- hi -->')).toContain('&lt;');
    expect(renderHtmlToken('<!DOCTYPE html>')).toContain('&lt;');
  });

  it('escapes a script block in the document, not just as a token', () => {
    const html = makeRenderer().parse('before <script>alert(1)</script> after') as string;
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('mermaid fences', () => {
  it('becomes a diagram placeholder carrying its source', () => {
    const html = makeRenderer().parse('```mermaid\ngraph TD;\nA-->B;\n```') as string;
    expect(html).toContain('class="fg-mermaid__block"');
    expect(html).toContain('data-mermaid-source="graph TD;');
    expect(html).not.toContain('<pre>');
  });

  it('matches the fence case-insensitively, and ignores trailing metadata', () => {
    expect(makeRenderer().parse('```Mermaid\ngraph TD;\n```') as string).toContain('fg-mermaid__block');
    expect(makeRenderer().parse('```mermaid title=x\ngraph TD;\n```') as string).toContain('fg-mermaid__block');
  });

  it('escapes the source it stores, so a quote cannot break out of the attribute', () => {
    const html = makeRenderer().parse('```mermaid\ngraph TD; A["x"]-->B;\n```') as string;
    expect(html).toContain('&quot;');
    expect(html).not.toMatch(/data-mermaid-source="[^"]*"[^>]*"/);
  });

  it('leaves every other language as a code block', () => {
    for (const lang of ['ts', 'bash', 'mermaidjs', '']) {
      const html = makeRenderer().parse('```' + lang + '\nx\n```') as string;
      expect(html, lang).toContain('<pre>');
      expect(html, lang).not.toContain('fg-mermaid__block');
    }
  });
});

describe('diagram kind labels', () => {
  it('turns mermaid internal ids into something readable', () => {
    expect(diagramKindLabel('flowchart-v2')).toBe('Flowchart');
    expect(diagramKindLabel('er')).toBe('Entity relationship');
    expect(diagramKindLabel('gitGraph')).toBe('Git graph');
    expect(diagramKindLabel('quadrantChart')).toBe('Quadrant');
    expect(diagramKindLabel('classDiagram')).toBe('Class');
  });

  it('falls back for a kind a later mermaid release adds', () => {
    expect(diagramKindLabel('someNewChart')).toBe('Some new chart');
    expect(diagramKindLabel('kanban')).toBe('Kanban');
  });

  it('names an unrecognised diagram rather than showing nothing', () => {
    expect(diagramKindLabel('')).toBe('Diagram');
  });
});

describe('diagram zoom maths', () => {
  it('clamps to the documented bounds', () => {
    expect(clampZoom(0)).toBe(ZOOM_MIN);
    expect(clampZoom(1000)).toBe(ZOOM_MAX);
    expect(clampZoom(1)).toBe(1);
  });

  it('steps in and out, and stops at the bounds', () => {
    expect(stepZoom(1, 1)).toBeGreaterThan(1);
    expect(stepZoom(1, -1)).toBeLessThan(1);
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
  });

  it('a step out then in returns to where it started', () => {
    expect(stepZoom(stepZoom(2, 1), -1)).toBeCloseTo(2, 10);
  });

  it('fits a wide diagram to the column but never enlarges a small one', () => {
    expect(fitScale(400, 800)).toBeCloseTo(0.5, 10);
    expect(fitScale(800, 400)).toBe(1);
    expect(fitScale(800, 800)).toBe(1);
  });

  it('survives a zero-size container, which happens before first layout', () => {
    expect(fitScale(0, 800)).toBe(1);
    expect(fitScale(400, 0)).toBe(1);
  });
});
