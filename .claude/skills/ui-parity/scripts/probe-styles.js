/**
 * Geometry and typography probe. Paste into the Browser pane against the running
 * harness, optionally editing SELECTORS for the surface under test.
 *
 * Reports the computed values that actually decide whether two UIs look the
 * same. Reading these beats judging a screenshot: a 2px padding difference or a
 * substituted font is invisible at a glance and obvious in the numbers.
 */
(() => {
  const SELECTORS = [
    '.fg-composer__inputWrapper',
    '.fg-composer__inputContainer',
    '.fg-composer__sparkLegend',
    '.fg-composer__messageInputContainer',
    '.fg-composer__messageInput',
    '.fg-composer__mentionMirror',
    '.fg-footer__inputFooter',
    '.fg-footer__footerButton',
    '.fg-footer__menuButton',
    '.fg-footer__modelPill',
    '.fg-footer__modelPillEffort',
    '.fg-footer__sendButton',
    '.fg-footer__sendIcon',
    '.fg-footer__divider',
    '.fg-menu__menuPopup',
    '.fg-menu__menuItemV2',
    '.fg-menu__menuItemLabel',
    '.fg-menu__menuItemDescription',
    '.fg-menu__effortRow',
    '.fg-chat__messagesContainer',
    '.fg-chat__message',
    '.fg-chat__userMessage',
    '.fg-shell__header',
    '.fg-shell__titleText',
  ];

  const PROPS = [
    'display', 'position', 'font-family', 'font-size', 'font-weight',
    'line-height', 'letter-spacing', 'color', 'background-color',
    'border-width', 'border-style', 'border-color', 'border-radius',
    'padding', 'margin', 'gap', 'width', 'height', 'min-height', 'max-height',
    'align-items', 'justify-content', 'flex-direction', 'opacity',
  ];

  const out = {};
  for (const sel of SELECTORS) {
    const el = document.querySelector(sel);
    if (!el) { out[sel] = 'NOT RENDERED'; continue; }
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const row = { _box: `${Math.round(box.width)}x${Math.round(box.height)}` };
    for (const p of PROPS) {
      const v = cs.getPropertyValue(p);
      // Only report what is set to something meaningful, to keep the diff small.
      if (v && v !== 'normal' && v !== 'auto' && v !== 'none' && v !== '0px') row[p] = v;
    }
    out[sel] = row;
  }

  // Fonts are the most common silent regression: Forge bundles its own and must
  // never fall back to whatever the machine has installed.
  const badFonts = Object.entries(out)
    .filter(([, v]) => typeof v === 'object' && v['font-family'] && !/Forge (Sans|Mono)/.test(v['font-family']))
    .map(([k, v]) => `${k}: ${v['font-family']}`);

  return { elements: out, fontViolations: badFonts };
})();
