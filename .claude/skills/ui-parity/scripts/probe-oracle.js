/**
 * Oracle probe: let the official stylesheet decide what "correct" is.
 *
 * Run in the Browser pane against the harness, with the app already driven into
 * the state under test:
 *
 *   eval(await (await fetch('/probes/probe-oracle.js')).text())
 *
 * How it works. The live DOM is cloned into an offscreen iframe of the same
 * size. In the clone every `fg-<module>__<local>` class is translated back to
 * the official `<local>_<hash>`, and the iframe loads only what the real
 * extension renders with: VS Code's host stylesheet, the host theme variables,
 * and the official `index.css`. Nothing from Forge's stylesheet is loaded --
 * not the port, not Tailwind, not a scoped style. Then every element in a
 * ported subtree is compared, property by property, against its twin.
 *
 * What a difference means. The markup is identical on both sides by
 * construction, so any structural difference comes from Forge's CSS: a lossy
 * port, a scoped or global override (Tailwind preflight is the usual one), or a
 * token whose value drifted. It does NOT check markup -- a <span> where the
 * official has a <button> looks "correct" here because both sides get the same
 * wrong element. Markup comes from reading index.js.
 *
 * Deliberately equalised, so they do not drown the report:
 *  - the typeface: the oracle maps the host font variables to Forge's bundled
 *    faces, because the family is an intended difference but its metrics are
 *    not allowed to hide a line-height or size difference;
 *  - scaffolding above the ported tree (Forge's app wrappers, which have no
 *    official twin) is frozen to its live layout so heights resolve the same.
 *
 * Colour is reported separately: Forge is purple where Claude Code is orange by
 * design, so colour differences are listed but not counted as failures.
 *
 * Options (set before eval): window.__oracle = { root: '.fg-composer__inputWrapper',
 *   colours: true, maxRows: 200 }
 */
(async () => {
  const opts = Object.assign({ root: null, colours: false, maxRows: 150 }, window.__oracle || {});

  const sheets = [...document.styleSheets].map((s) => {
    try { return s.cssRules.length; } catch { return 'ERR'; }
  });
  if (sheets.some((n) => n === 0)) {
    return { error: 'A stylesheet reported 0 rules -- it had not parsed yet. Wait and re-run.', sheets };
  }

  const [officialCss, modules, reference] = await Promise.all([
    fetch('/oracle/official.css').then((r) => { if (!r.ok) throw new Error('no /oracle/official.css'); return r.text(); }),
    fetch('/oracle/modules.json').then((r) => r.json()),
    fetch('/oracle/reference.json').then((r) => r.json()).catch(() => null),
  ]);

  const FG = /^fg-([a-z]+)__([A-Za-z0-9]+)$/;
  const hasFg = (el) => [...(el.classList || [])].some((c) => FG.test(c));

  // ---- 1. Tag the live DOM so each clone can find its twin. -----------------
  const live = [document.body, ...document.body.querySelectorAll('*')];
  live.forEach((el, i) => el.setAttribute('data-oracle-id', String(i)));
  const cloneBody = document.body.cloneNode(true);
  live.forEach((el) => el.removeAttribute('data-oracle-id'));

  // Nothing from the clone may execute or bring its own styles.
  cloneBody.querySelectorAll('script, style, link, iframe').forEach((n) => n.remove());

  // ---- 2. Freeze scaffolding above the ported tree. --------------------------
  const insideFg = (el) => { for (let p = el.parentElement; p; p = p.parentElement) if (hasFg(p)) return true; return false; };
  const LAYOUT = ['display', 'position', 'box-sizing', 'flex-direction', 'flex-grow', 'flex-shrink', 'flex-basis',
    'align-items', 'justify-content', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'overflow-x', 'overflow-y', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left'];
  const cloneById = new Map();
  for (const el of [cloneBody, ...cloneBody.querySelectorAll('[data-oracle-id]')]) {
    cloneById.set(el.getAttribute('data-oracle-id'), el);
  }
  const scaffold = live.filter((el) => !hasFg(el) && !insideFg(el) && el.querySelector('[class*="fg-"]'));
  for (const el of scaffold) {
    const cs = getComputedStyle(el);
    const twin = cloneById.get(String(live.indexOf(el)));
    if (twin) twin.setAttribute('style', LAYOUT.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
  }

  // ---- 3. Translate Forge class names back to the official hashed ones. -----
  const notInOfficial = new Set();
  const unmappedModules = new Set();
  for (const el of [cloneBody, ...cloneBody.querySelectorAll('*')]) {
    if (!el.classList || !el.classList.length) continue;
    const next = [];
    for (const c of el.classList) {
      const m = c.match(FG);
      if (!m) { next.push(c); continue; }
      const hash = modules[m[1]];
      if (!hash) { unmappedModules.add(m[1]); next.push(c); continue; }
      const official = `${m[2]}_${hash}`;
      if (!officialCss.includes(official)) notInOfficial.add(c);
      next.push(official);
    }
    el.setAttribute('class', next.join(' '));
  }

  // ---- 4. Build the oracle document. ----------------------------------------
  const inlineHostCss = [...document.querySelectorAll('head style')].map((s) => s.textContent).join('\n');
  const vscodeDefault = await fetch('/vscode-default.css').then((r) => (r.ok ? r.text() : ''));
  const fontFaces = [];
  for (const sh of document.styleSheets) {
    let rules; try { rules = sh.cssRules; } catch { continue; }
    const base = sh.href || location.href;
    for (const r of rules) {
      if (r instanceof CSSFontFaceRule) {
        fontFaces.push(r.cssText.replace(/url\("?([^")]+)"?\)/g, (_, u) => `url("${new URL(u, base).href}")`));
      }
    }
  }
  const htmlAttrs = [...document.documentElement.attributes].map((a) => `${a.name}="${a.value.replace(/"/g, '&quot;')}"`).join(' ');
  const bodyAttrs = [...cloneBody.attributes].map((a) => `${a.name}="${a.value.replace(/"/g, '&quot;')}"`).join(' ');

  const srcdoc = `<!doctype html><html ${htmlAttrs}><head>
<style id="_defaultStyles">${vscodeDefault}</style>
<style>${inlineHostCss}</style>
<style>${fontFaces.join('\n')}</style>
<style>:root{--vscode-chat-font-family:"Forge Sans", ui-sans-serif;--vscode-font-family:"Forge Sans", ui-sans-serif;--vscode-editor-font-family:"Forge Mono", ui-monospace;--monaco-monospace-font:"Forge Mono", ui-monospace}</style>
<link rel="stylesheet" href="${new URL('/oracle/official.css', location.href).href}">
</head><body ${bodyAttrs}>${cloneBody.innerHTML}</body></html>`;

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${innerWidth}px;height:${innerHeight}px;border:0;visibility:hidden`;
  const loaded = new Promise((res) => frame.addEventListener('load', res, { once: true }));
  frame.srcdoc = srcdoc;
  document.body.appendChild(frame);
  await loaded;
  const odoc = frame.contentDocument;
  await odoc.fonts.ready;
  const officialSheet = [...odoc.styleSheets].find((s) => s.href && s.href.includes('/oracle/official.css'));
  const officialRules = officialSheet ? officialSheet.cssRules.length : 0;
  // Let entrance animations (the official popups fade in over 150ms) settle on both sides.
  await new Promise((r) => setTimeout(r, 400));

  // ---- 5. Compare. -----------------------------------------------------------
  const STRUCT = ['display', 'position', 'box-sizing', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-bottom-style',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
    'row-gap', 'column-gap', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
    'text-align', 'text-transform', 'text-decoration-line', 'white-space', 'text-overflow', 'overflow-x', 'overflow-y',
    'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'align-items', 'align-self',
    'justify-content', 'order', 'opacity', 'z-index', 'vertical-align', 'visibility', 'cursor', 'transform',
    'top', 'right', 'bottom', 'left'];
  const COLOUR = ['color', 'background-color', 'border-top-color', 'border-bottom-color', 'outline-color', 'fill', 'stroke', 'box-shadow', 'caret-color'];
  const LOOSE = new Set(['width', 'height', 'top', 'right', 'bottom', 'left']);

  const near = (a, b, prop) => {
    if (a === b) return true;
    const na = parseFloat(a), nb = parseFloat(b);
    if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
    if (a.replace(/[-\d.]/g, '') !== b.replace(/[-\d.]/g, '')) return false;
    return Math.abs(na - nb) <= (LOOSE.has(prop) ? 0.51 : 0.02);
  };

  const label = (el) => {
    const fg = [...(el.classList || [])].find((c) => FG.test(c));
    if (fg) return `${el.tagName.toLowerCase()}.${fg}`;
    let p = el.parentElement, hops = 0;
    while (p && !hasFg(p)) { p = p.parentElement; hops++; }
    const anc = p ? [...p.classList].find((c) => FG.test(c)) : '?';
    return `${anc} ${'> '.repeat(Math.min(hops, 3))}${el.tagName.toLowerCase()}`;
  };

  const scope = opts.root ? document.querySelector(opts.root) : document.body;
  if (!scope) { frame.remove(); return { error: `root ${opts.root} not rendered` }; }
  const subjects = [scope, ...scope.querySelectorAll('*')].filter((el) => el !== frame && (hasFg(el) || insideFg(el)));

  const structural = new Map();   // label -> { prop -> {forge, official, n} }
  const colour = new Map();
  let clean = 0, missingTwin = 0;
  for (const el of subjects) {
    const twin = odoc.querySelector(`[data-oracle-id="${live.indexOf(el)}"]`);
    if (!twin) { missingTwin++; continue; }
    const a = getComputedStyle(el), b = odoc.defaultView.getComputedStyle(twin);
    let dirty = false;
    const key = label(el);
    for (const [props, bucket] of [[STRUCT, structural], [COLOUR, colour]]) {
      for (const p of props) {
        if ((p === 'top' || p === 'right' || p === 'bottom' || p === 'left') && a.position === 'static' && b.position === 'static') continue;
        const fv = a.getPropertyValue(p), ov = b.getPropertyValue(p);
        if (near(fv, ov, p)) continue;
        if (bucket === structural) dirty = true;
        const row = bucket.get(key) ?? {};
        const cell = row[p] ?? { forge: fv, official: ov, n: 0 };
        cell.n++;
        row[p] = cell;
        bucket.set(key, row);
      }
    }
    if (!dirty) clean++;
  }
  frame.remove();

  const flatten = (m) => [...m.entries()].map(([el, props]) => ({
    el,
    diffs: Object.fromEntries(Object.entries(props).map(([p, c]) => [p, `forge ${c.forge} | official ${c.official}${c.n > 1 ? ` (x${c.n})` : ''}`])),
  }));
  const rows = flatten(structural);
  return {
    sheets,
    officialRules,
    checked: subjects.length,
    clean,
    withStructuralDiffs: subjects.length - clean - missingTwin,
    structuralRows: rows.length,
    structural: rows.slice(0, opts.maxRows),
    truncated: rows.length > opts.maxRows,
    colourRows: colour.size,
    colour: opts.colours ? flatten(colour).slice(0, opts.maxRows) : '(set window.__oracle={colours:true} to list)',
    classesNotInOfficialCss: [...notInOfficial],
    modulesWithoutHash: [...unmappedModules],
    missingTwin,
  };
})();
