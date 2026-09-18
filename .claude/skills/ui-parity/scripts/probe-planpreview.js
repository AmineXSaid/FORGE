/**
 * probe-planpreview.js -- measure Forge's plan preview page against the official one.
 *
 * The official plan preview is not built from index.css (so probe-oracle.js
 * cannot see it): the host fills its panel from an inline template (`zd$` in
 * extension.js). The harness serves that template at /oracle/plan-preview.html.
 * This probe renders it in an offscreen iframe the size of Forge's page, with
 * the same VS Code theme variables and the same content, then compares the
 * computed styles of each element pair.
 *
 * Run on `?page=plan-preview`, after the page received its content:
 *   const r = await eval(await (await fetch('/probes/probe-planpreview.js')).text())
 *
 * `font-family` is reported apart: Forge uses its own fonts by design.
 * Options: window.__planProbe = { showCommentUi: true } also measures the
 * floating comment button and box (both shown for the measurement).
 */
(async () => {
  const opts = window.__planProbe || {};
  const root = document.querySelector('.forge-plan-preview');
  if (!root) return { error: 'no .forge-plan-preview on this page' };
  const template = await (await fetch('/oracle/plan-preview.html')).text();
  const parsed = new DOMParser().parseFromString(template, 'text/html');
  const officialCss = [...parsed.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  parsed.querySelectorAll('script').forEach((s) => s.remove());
  const officialBody = parsed.body.innerHTML;

  // The theme variables the harness page defines, and VS Code's host sheet.
  const themeCss = [...document.querySelectorAll('head style')].map((s) => s.textContent).join('\n');
  // Forge's font faces, so the official side can be drawn in the same fonts:
  // Forge never uses the host's fonts (by design), and comparing across fonts
  // would move every width and height that follows text.
  const fontFaces = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) if (rule instanceof CSSFontFaceRule) fontFaces.push(rule.cssText);
  }
  const sans = getComputedStyle(root).fontFamily;
  const mono = getComputedStyle(root.querySelector('#content code') || root).fontFamily;
  const sameFonts =
    `body, #comment-btn, #comment-input textarea, .comment-actions button { font-family: ${sans} !important; }` +
    ` code { font-family: ${mono} !important; }`;
  const rect = root.getBoundingClientRect();
  const iframe = document.createElement('iframe');
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${rect.width}px;height:${rect.height}px;border:0;`;
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(
    `<!DOCTYPE html><html class="${document.documentElement.className}"><head>` +
      `<link rel="stylesheet" href="${location.origin}/vscode-default.css">` +
      `<style>${fontFaces.join('\n')}</style>` +
      `<style>${themeCss}</style><style>${officialCss}</style><style>${sameFonts}</style></head><body>${officialBody}</body></html>`
  );
  doc.close();
  await new Promise((r) => setTimeout(r, 300));
  await doc.fonts?.ready;
  // Same content width on both sides, whichever of them shows a scrollbar
  // (and to the sub-pixel: the pane's width is fractional, clientWidth is not).
  let frameWidth = rect.width + (root.clientWidth - doc.documentElement.clientWidth);
  iframe.style.width = `${frameWidth}px`;
  await new Promise((r) => setTimeout(r, 50));
  frameWidth +=
    root.querySelector('#content').getBoundingClientRect().width - doc.getElementById('content').getBoundingClientRect().width;
  iframe.style.width = `${frameWidth}px`;
  await new Promise((r) => setTimeout(r, 50));

  // Same state on both sides: the same content, the banner as Forge shows it.
  doc.getElementById('content').innerHTML = root.querySelector('#content').innerHTML;
  const forgeBanner = root.querySelector('#comment-banner');
  doc.getElementById('comment-banner').style.display = getComputedStyle(forgeBanner).display;
  const restore = [];
  if (opts.showCommentUi) {
    for (const id of ['comment-btn', 'comment-input']) {
      const f = root.querySelector('#' + id);
      restore.push([f, f.style.display]);
      f.style.display = 'block';
      doc.getElementById(id).style.display = 'block';
    }
  }
  await new Promise((r) => setTimeout(r, 100));

  const PROPS = [
    'display', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align',
    'white-space', 'color', 'background-color', 'opacity',
    'border-top-width', 'border-top-style', 'border-top-color', 'border-right-width', 'border-bottom-width',
    'border-bottom-style', 'border-bottom-color', 'border-left-width', 'border-left-style', 'border-left-color',
    'border-top-left-radius', 'border-bottom-right-radius',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'width', 'height', 'min-height', 'max-height', 'box-shadow', 'z-index', 'vertical-align', 'cursor',
  ];
  // The root is Forge's scroll container where the official scrolls the body.
  const ROOT_SKIP = new Set(['height', 'min-height', 'max-height', 'width']);

  const pairs = [
    ['.forge-plan-preview', 'body'],
    ['#comment-banner', '#comment-banner'],
    ['#comment-banner strong', '#comment-banner strong'],
    ['#comment-banner .banner-hint', '#comment-banner .banner-hint'],
    ['#content', '#content'],
  ];
  // Every element of the content, in document order.
  const fContent = [...root.querySelectorAll('#content *')];
  const oContent = [...doc.querySelectorAll('#content *')];
  fContent.forEach((el, i) => pairs.push([el, oContent[i]]));
  if (opts.showCommentUi) {
    for (const s of ['#comment-btn', '#comment-input', '#selected-text-preview', '#comment-textarea', '.comment-actions', '#cancel-btn', '#submit-btn']) {
      pairs.push([s, s]);
    }
  }

  // Colour is listed apart, as probe-oracle.js does: Forge's page gets its
  // host defaults (code, blockquote) and buttons through its own tokens.
  const COLOUR = new Set([
    'color', 'background-color', 'border-top-color', 'border-bottom-color', 'border-left-color', 'box-shadow',
  ]);
  const colourRows = [];
  const rows = [];
  const fonts = [];
  let clean = 0;
  for (const [fs, os] of pairs) {
    const f = typeof fs === 'string' ? root.matches(fs) ? root : root.querySelector(fs) : fs;
    const o = typeof os === 'string' ? (os === 'body' ? doc.body : doc.querySelector(os)) : os;
    const label = typeof fs === 'string' ? fs : `#content ${f.tagName.toLowerCase()}${f.className ? '.' + f.className : ''}`;
    if (!f || !o) {
      rows.push({ el: label, missing: !f ? 'forge' : 'official' });
      continue;
    }
    const fc = getComputedStyle(f);
    const oc = doc.defaultView.getComputedStyle(o);
    const diffs = {};
    const colours = {};
    for (const p of PROPS) {
      if (f === root && ROOT_SKIP.has(p)) continue;
      const a = fc.getPropertyValue(p);
      const b = oc.getPropertyValue(p);
      if (a !== b) (COLOUR.has(p) ? colours : diffs)[p] = `forge ${a} | official ${b}`;
    }
    if (fc.fontFamily !== oc.fontFamily) fonts.push({ el: label, forge: fc.fontFamily, official: oc.fontFamily });
    if (Object.keys(colours).length) colourRows.push({ el: label, diffs: colours });
    if (Object.keys(diffs).length) rows.push({ el: label, diffs });
    else clean++;
  }
  for (const [el, display] of restore) el.style.display = display;
  iframe.remove();
  return { checked: pairs.length, clean, structural: rows, colour: colourRows, fontFamily: fonts };
})();
