/**
 * Coverage probe. Paste into the Browser pane against the running harness.
 *
 * Lists which official classes the app renders and which it never does. A class
 * the real UI has and Forge does not is a missing piece of interface -- this is
 * the "button to button" check.
 *
 * Drive the app into the state you care about first: an empty transcript has no
 * message rows and a closed menu has no popup, and those absences are expected.
 */
(() => {
  const sheets = [...document.styleSheets].map((s) => {
    try { return s.cssRules.length; } catch { return 'ERR'; }
  });
  if (sheets.some((n) => n === 0)) {
    return { error: 'A stylesheet reported 0 rules -- it had not parsed yet. Wait and re-run.', sheets };
  }

  const declared = new Map();
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) {
      if (!r.selectorText || !r.style) continue;
      for (const sel of r.selectorText.split(',')) {
        const m = sel.trim().match(/^\.(fg-[a-z]+__[A-Za-z]+)$/);
        if (!m) continue;
        const decls = declared.get(m[1]) ?? {};
        for (const p of r.style) decls[p] = r.style.getPropertyValue(p);
        declared.set(m[1], decls);
      }
    }
  }

  const present = [];
  const missing = [];
  for (const cls of declared.keys()) {
    (document.querySelector('.' + cls) ? present : missing).push(cls);
  }

  const byModule = {};
  for (const cls of missing) {
    const mod = cls.split('__')[0];
    (byModule[mod] ??= []).push(cls.split('__')[1]);
  }

  return {
    sheets,
    total: declared.size,
    present: present.length,
    missing: missing.length,
    missingByModule: byModule,
  };
})();
