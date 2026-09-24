/**
 * Driving a real VS Code workbench (desktop or code-server) over CDP: the
 * command palette, notifications, the Forge webview's frame, and real input
 * inside it.
 *
 * The Forge webview is two frames deep: the workbench's `iframe.webview`
 * (VS Code's `pre/index.html?id=<uuid>`) holds `#active-frame`
 * (`fake.html?id=<uuid>`), which holds Forge's `#app`. Clicks are real mouse
 * events on the page target at page coordinates, which Chromium routes into
 * the right frame, in process or not. The frame's offset is the outer
 * iframe's box: `#active-frame` fills its parent at 0,0.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEYS = {
  F1: { code: 'F1', keyCode: 112 },
  Enter: { code: 'Enter', keyCode: 13 },
  Escape: { code: 'Escape', keyCode: 27 },
  Tab: { code: 'Tab', keyCode: 9 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  Delete: { code: 'Delete', keyCode: 46 },
};
export const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

/** The expression that is true only in a Forge webview document. */
export const IS_FORGE = `!!document.querySelector('#app') && typeof acquireVsCodeApi === 'function'`;

export function workbench(cdp, page) {
  const wb = {
    cdp,
    page,
    evaluate: (expr) => cdp.evaluate(page, expr),

    async key(name, modifiers = 0) {
      const k = KEYS[name] ?? { code: name.length === 1 ? `Key${name.toUpperCase()}` : name, keyCode: name.length === 1 ? name.toUpperCase().charCodeAt(0) : 0 };
      const text = name.length === 1 && !(modifiers & (MOD.ctrl | MOD.meta | MOD.alt)) ? name : undefined;
      const base = { key: name, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode, modifiers };
      await cdp.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text && { text }) }, page);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, page);
      await sleep(120);
    },

    type: (text) => cdp.type(page, text),

    /** The workbench page still answers (a hung renderer answers nothing). */
    async responsive(timeoutMs = 10_000) {
      const answer = await Promise.race([
        cdp.send('Runtime.evaluate', { expression: '1+1', returnByValue: true }, page).then((r) => r.result?.value === 2, () => false),
        new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
      ]);
      return answer;
    },
    click: (x, y) => cdp.click(page, x, y),

    async screenshot(file) {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, page);
      const fs = await import('node:fs');
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      return file;
    },

    /** Poll a page expression until it is truthy; returns its value. */
    async waitFor(expr, { timeoutMs = 20_000, label = expr } = {}) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          const value = await wb.evaluate(`return (${expr})`);
          if (value) return value;
        } catch {
          /* mid-navigation */
        }
        await sleep(250);
      }
      throw new Error(`timed out waiting for ${label}`);
    },

    /** The workbench has finished restoring (the status bar is drawn). */
    /**
     * The workbench has restored: the activity bar and status bar are drawn
     * and have items. (Not the git branch: a machine may have no git.)
     */
    async ready() {
      await wb.waitFor(
        `document.querySelectorAll('.monaco-workbench .activitybar .action-item').length >= 3 && [...document.querySelectorAll('.monaco-workbench .statusbar-item')].filter(e => e.textContent.trim()).length >= 2`,
        { timeoutMs: 90_000, label: 'the workbench' },
      );
      await sleep(1500);
    },

    /** Run a command by its palette title ("Forge: Open in New Tab"). */
    async runCommand(title) {
      await wb.key('Escape');
      await wb.key('F1');
      await wb.waitFor(`(() => { const w = document.querySelector('.quick-input-widget'); return w && w.style.display !== 'none' && document.activeElement?.closest('.quick-input-widget') })()`, { label: 'the command palette' });
      await wb.type(title);
      await wb.waitFor(
        `[...document.querySelectorAll('.quick-input-list .monaco-list-row')].some(r => r.getAttribute('aria-label')?.startsWith(${JSON.stringify(title)}))`,
        { label: `the palette row "${title}"` },
      );
      // The palette ranks fuzzily ("Close All Editor Groups" can lead "Close
      // Editor"): move the selection to the exact row before Enter.
      const exact = (label) => label === title || label?.startsWith(`${title},`) || label?.startsWith(`${title} `);
      for (let i = 0; i < 30; i++) {
        const focused = await wb.evaluate(`return document.querySelector('.quick-input-list .monaco-list-row.focused')?.getAttribute('aria-label')`);
        if (exact(focused)) break;
        if (i === 29) throw new Error(`the palette never focused "${title}" (at "${focused}")`);
        await wb.key('ArrowDown');
      }
      await wb.key('Enter');
      await sleep(400);
    },

    /** Visible notification toasts: [{ message, source, buttons }]. */
    notifications: () =>
      wb.evaluate(`return [...document.querySelectorAll('.notification-toast-container .notification-list-item')].map(n => ({
        message: n.querySelector('.notification-list-item-message')?.textContent ?? '',
        source: n.querySelector('.notification-list-item-source')?.textContent ?? '',
        buttons: [...n.querySelectorAll('.notification-list-item-buttons-container .monaco-button')].map(b => b.textContent),
      }))`),

    async clearNotifications() {
      await wb.evaluate(`document.querySelectorAll('.notification-toast-container .codicon-notifications-clear, .notification-toast-container .codicon-close').forEach(b => b.click()); return true`);
    },

    /** The window title VS Code shows (code-server mirrors it on document.title). */
    title: () => wb.evaluate('return document.title'),

    /**
     * Every Forge webview frame: [{ sessionId, contextId, id, visible }].
     * `id` is the webview's uuid, which names its outer iframe in the page.
     */
    async forgeFrames() {
      const found = await cdp.findContexts(IS_FORGE);
      const frames = [];
      for (const f of found) {
        try {
          const info = await cdp.evaluate(f.sessionId, `return { id: new URLSearchParams(location.search).get('id'), w: innerWidth, h: innerHeight, root: document.querySelector('#app')?.firstElementChild?.className ?? '' }`, f.contextId);
          frames.push({ ...f, ...info });
        } catch {
          /* gone */
        }
      }
      return frames;
    },

    /** Wait for a Forge frame whose document matches `test` (default: any). */
    async forge({ test = 'true', timeoutMs = 30_000, label = 'a Forge webview' } = {}) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        for (const f of await wb.forgeFrames()) {
          try {
            if ((f.w > 0) && (await cdp.evaluate(f.sessionId, `return !!(${test})`, f.contextId))) return frame(wb, f);
          } catch {
            /* mid-load */
          }
        }
        await sleep(400);
      }
      throw new Error(`timed out waiting for ${label}`);
    },
  };
  return wb;
}

/** A handle on one Forge webview frame. */
function frame(wb, f) {
  const { cdp } = wb;
  const handle = {
    ...f,
    evaluate: (expr) => cdp.evaluate(f.sessionId, expr, f.contextId),

    async waitFor(expr, { timeoutMs = 20_000, label = expr } = {}) {
      const deadline = Date.now() + timeoutMs;
      let last;
      while (Date.now() < deadline) {
        try {
          last = await handle.evaluate(`return (${expr})`);
          if (last) return last;
        } catch (error) {
          last = error.message;
        }
        await sleep(250);
      }
      throw new Error(`timed out waiting for ${label} (last: ${JSON.stringify(last)?.slice(0, 200)})`);
    },

    /** The frame's top-left in page coordinates. */
    async offset() {
      const box = await wb.evaluate(`
        const outer = [...document.querySelectorAll('iframe')].find(i => (i.src || '').includes(${JSON.stringify(`id=${f.id}`)}));
        if (!outer) return null;
        const r = outer.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };`);
      if (!box) throw new Error(`no outer iframe for webview ${f.id}`);
      return box;
    },

    /** Centre of the first element matching `selector` (optionally whose text includes `text`), in page coordinates. */
    async centre(selector, { text, index = 0 } = {}) {
      const read = () =>
        handle.evaluate(`
        const all = [...document.querySelectorAll(${JSON.stringify(selector)})]
          .filter(e => ${text === undefined ? 'true' : `e.textContent.includes(${JSON.stringify(text)})`});
        const el = all[${index}];
        if (!el) return null;
        el.scrollIntoView({ block: 'nearest' });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };`);
      // Panels slide in (the permission prompt, menus): wait until the box
      // stops moving, or the click lands where it was a frame ago.
      let rect = await read();
      for (let i = 0; rect && i < 20; i++) {
        await sleep(120);
        const again = await read();
        if (again && Math.abs(again.x - rect.x) < 0.5 && Math.abs(again.y - rect.y) < 0.5) break;
        rect = again;
      }
      if (!rect) throw new Error(`no element ${selector}${text ? ` with "${text}"` : ''} in the Forge webview`);
      const o = await handle.offset();
      return { x: o.x + rect.x, y: o.y + rect.y };
    },

    async click(selector, options) {
      const { x, y } = await handle.centre(selector, options);
      await wb.click(x, y);
    },

    async hover(selector, options) {
      const { x, y } = await handle.centre(selector, options);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 }, wb.page);
      await sleep(250);
    },

    /**
     * Focus the composer and type into it (real text input). The composer can
     * move after it first draws (a banner above it appears late), so the
     * focus is checked, and the text is checked once typed.
     */
    async compose(text) {
      const COMPOSER = '.fg-composer__messageInput';
      for (let attempt = 0; attempt < 5; attempt++) {
        await handle.click(COMPOSER);
        if (await handle.evaluate(`return document.hasFocus() && document.activeElement?.matches(${JSON.stringify(COMPOSER)})`)) break;
        await sleep(400);
      }
      await wb.type(text);
      await handle.waitFor(`document.querySelector(${JSON.stringify(COMPOSER)})?.textContent.includes(${JSON.stringify(text.slice(0, 40))})`, {
        timeoutMs: 5_000,
        label: 'the typed text in the composer',
      });
    },

    /** Type into the composer and press Enter; waits until the composer has let go of the text. */
    async send(text) {
      await handle.compose(text);
      await wb.key('Enter');
      await handle.waitFor(`!document.querySelector('.fg-composer__messageInput')?.textContent.includes(${JSON.stringify(text.slice(0, 40))})`, {
        timeoutMs: 10_000,
        label: 'the composer to send',
      });
    },

    /** The transcript as text rows: [{ role, text }]. */
    transcript: () =>
      handle.evaluate(`return [...document.querySelectorAll('.fg-chat__messagesContainer .fg-chat__message')]
        .map(e => ({ role: e.classList.contains('fg-chat__userMessageContainer') ? 'user' : 'assistant', text: e.textContent.trim().slice(0, 400) }))`),
  };
  return handle;
}
