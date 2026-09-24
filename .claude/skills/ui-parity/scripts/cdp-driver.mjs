/**
 * Minimal Chrome DevTools Protocol driver for the ui-parity harness.
 *
 * Use this when the Browser-pane tool (`mcp__Claude_Browser__*`) is not
 * available in the session -- it disappears when the MCP server reloads, and a
 * harness pass is not optional (B7: a row is "works" only once it is clicked).
 *
 * No dependencies: Chrome is installed on this machine and Node 24 has a
 * built-in WebSocket. It gives the same three things the pane gave -- evaluate
 * in the page, dispatch REAL mouse and key input, and navigate at a fixed
 * viewport.
 *
 *   import { launch, ORACLE } from './cdp-driver.mjs';
 *   const page = await launch({ width: 800, height: 900 });
 *   await page.navigate('http://127.0.0.1:8741/index.html?mockSessions');
 *   const r = await page.eval(ORACLE('.fg-commandmenu__menuPopup'));
 *   await page.hover(x, y); await page.click(x, y);
 *   await page.close();
 *
 * Two traps worth knowing, both of which have produced wrong answers here:
 *
 * - **Check whose harness you are measuring.** Other worktrees leave harnesses
 *   listening on 8733-8736. Pick a free port and byte-compare the served
 *   `/main.js` against `dist/media/main.js` before trusting a number.
 * - **Use real input, not `element.click()`.** The official closes its popups
 *   on `mousedown`, which a synthetic click never fires, so a stale popup
 *   looks like a broken one.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The Chrome to drive: `FORGE_CHROME`, else the usual install on Windows, else
 * a Playwright Chromium (`PLAYWRIGHT_BROWSERS_PATH`, `/opt/pw-browsers`), else
 * `chromium` on PATH -- so the harness runs on the Windows dev box and on a
 * Linux CI runner alike.
 */
function findChrome() {
  if (process.env.FORGE_CHROME) return process.env.FORGE_CHROME;
  if (process.platform === 'win32') return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  for (const root of [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean)) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      const candidate = join(root, dir, 'chrome-linux', 'chrome');
      if (existsSync(candidate)) return candidate;
    }
  }
  return 'chromium';
}

const CHROME = findChrome();
const PORT = Number(process.env.FORGE_CDP_PORT) || 9333;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
  return res.json();
}

export async function launch({ width = 800, height = 900 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'forge-cdp-'));
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-gpu',
      // Needed as root in a container; harmless elsewhere for a throwaway profile.
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      'about:blank',
    ],
    { stdio: 'ignore', detached: false }
  );

  // Wait for the debugging endpoint.
  let targets;
  for (let i = 0; i < 60; i++) {
    try {
      targets = await fetchJson('/json/list');
      if (targets.some((t) => t.type === 'page')) break;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  if (!targets) throw new Error('Chrome did not expose a debugging endpoint');

  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const events = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id !== undefined) {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      if (!entry) return;
      if (msg.error) entry.reject(new Error(JSON.stringify(msg.error)));
      else entry.resolve(msg.result);
    } else {
      events.push(msg);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const api = {
    events,
    raw: send,
    async navigate(url, settleMs = 3500) {
      await send('Page.navigate', { url });
      await sleep(settleMs);
    },
    /** Evaluate an expression (top-level await allowed) and return its value. */
    async eval(expression) {
      const result = await send('Runtime.evaluate', {
        expression: `(async () => { ${expression} })()`,
        awaitPromise: true,
        returnByValue: true,
        allowUnsafeEvalBlocklistBypass: true,
      });
      if (result.exceptionDetails) {
        throw new Error(
          result.exceptionDetails.exception?.description ??
            JSON.stringify(result.exceptionDetails)
        );
      }
      return result.result.value;
    },
    /** A real pointer move, so :hover and mouseenter fire. */
    async hover(x, y) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
      await sleep(120);
    },
    /** A real click: move, press, release. */
    async click(x, y) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
      await sleep(60);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
      await sleep(250);
    },
    async type(text) {
      for (const ch of text) {
        await send('Input.dispatchKeyEvent', { type: 'char', text: ch });
      }
      await sleep(150);
    },
    /** `modifiers`: CDP's bit field (1 Alt, 2 Ctrl, 4 Meta, 8 Shift). */
    async key(key, code, keyCode, modifiers = 0) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers });
      await sleep(200);
    },
    async close() {
      try { ws.close(); } catch { /* ignore */ }
      try { child.kill(); } catch { /* ignore */ }
      await sleep(400);
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
  return api;
}

/** The oracle, run against a root selector. */
export const ORACLE = (root) => `
  window.__oracle = ${JSON.stringify({ root: null })};
  window.__oracle = { root: ${JSON.stringify(root)} };
  if (!document.querySelector(${JSON.stringify(root)})) return { missing: true, root: ${JSON.stringify(root)} };
  const src = await (await fetch('/probes/probe-oracle.js')).text();
  const r = await eval(src);
  return { root: ${JSON.stringify(root)}, checked: r.checked, clean: r.clean,
           diffs: r.structuralRows, structural: r.structural,
           colour: r.colourRows, unknownClasses: r.classesNotInOfficialCss };
`;
