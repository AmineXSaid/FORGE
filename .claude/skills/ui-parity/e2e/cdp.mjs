/**
 * A Chrome DevTools Protocol client for the end-to-end runs.
 *
 * Unlike `../scripts/cdp-driver.mjs` (one page, one session), a VS Code
 * window is a workbench page plus webviews in nested iframes, some of them
 * out of process. This client connects to the browser endpoint, auto-attaches
 * to every target with flattened sessions, and can evaluate in any frame of
 * any session, so a scenario can read and drive the Forge webview itself.
 *
 * Works the same against VS Code desktop (`Code.exe --remote-debugging-port`)
 * and against a headless Chromium showing code-server.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function connect(port, { timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let version;
  while (!version) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch {
      if (Date.now() > deadline) throw new Error(`no DevTools endpoint on port ${port}`);
      await sleep(300);
    }
  }
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  /** sessionId -> { targetId, type, url } */
  const sessions = new Map();
  /** sessionId -> Map(frameId -> executionContextId) for the default world */
  const contexts = new Map();

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id !== undefined) {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      if (!entry) return;
      if (msg.error) entry.reject(new Error(`${entry.method}: ${JSON.stringify(msg.error)}`));
      else entry.resolve(msg.result);
      return;
    }
    if (msg.method === 'Target.attachedToTarget') {
      const { sessionId, targetInfo } = msg.params;
      sessions.set(sessionId, { targetId: targetInfo.targetId, type: targetInfo.type, url: targetInfo.url });
      void setup(sessionId);
    } else if (msg.method === 'Target.detachedFromTarget') {
      sessions.delete(msg.params.sessionId);
      contexts.delete(msg.params.sessionId);
    } else if (msg.method === 'Runtime.executionContextCreated') {
      const ctx = msg.params.context;
      if (ctx.auxData?.isDefault && ctx.auxData?.frameId) {
        if (!contexts.has(msg.sessionId ?? '')) contexts.set(msg.sessionId ?? '', new Map());
        contexts.get(msg.sessionId ?? '').set(ctx.auxData.frameId, ctx.id);
      }
    } else if (msg.method === 'Runtime.executionContextDestroyed') {
      const map = contexts.get(msg.sessionId ?? '');
      if (map) for (const [frame, id] of map) if (id === msg.params.executionContextId) map.delete(frame);
    } else if (msg.method === 'Runtime.executionContextsCleared') {
      contexts.get(msg.sessionId ?? '')?.clear();
    }
    for (const listener of listeners) listener(msg);
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject, method });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
    });

  async function setup(sessionId) {
    try {
      await send('Runtime.enable', {}, sessionId);
      await send('Page.enable', {}, sessionId).catch(() => {});
      await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
      await send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
    } catch {
      /* the target went away */
    }
  }

  await send('Target.setDiscoverTargets', { discover: true });
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

  const api = {
    send,
    sessions,
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** The first page target's session, attached. */
    async page(match = () => true) {
      for (let i = 0; i < 100; i++) {
        for (const [sessionId, info] of sessions) if (info.type === 'page' && match(info)) return sessionId;
        const { targetInfos } = await send('Target.getTargets');
        const target = targetInfos.find((t) => t.type === 'page' && match(t));
        if (target && ![...sessions.values()].some((s) => s.targetId === target.targetId)) {
          await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
        }
        await sleep(200);
      }
      throw new Error('no page target');
    },
    /** Evaluate in a session (optionally a given execution context); returns the value. */
    async evaluate(sessionId, expression, contextId) {
      const result = await send(
        'Runtime.evaluate',
        {
          expression: `(async () => { ${expression} })()`,
          awaitPromise: true,
          returnByValue: true,
          ...(contextId !== undefined && { contextId }),
        },
        sessionId,
      );
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
      }
      return result.result.value;
    },
    /**
     * Every (session, context) whose document matches `test` (an expression
     * returning a boolean), across all attached targets and frames.
     */
    async findContexts(test) {
      const found = [];
      for (const [sessionId, map] of contexts) {
        for (const [frameId, contextId] of map) {
          try {
            if (await api.evaluate(sessionId || undefined, `return !!(${test})`, contextId)) found.push({ sessionId: sessionId || undefined, frameId, contextId });
          } catch {
            /* a frame mid-navigation */
          }
        }
      }
      return found;
    },
    /** Wait until `findContexts(test)` finds one. */
    async waitForContext(test, { timeoutMs = 30_000, label = test } = {}) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const [first] = await api.findContexts(test);
        if (first) return first;
        await sleep(400);
      }
      throw new Error(`timed out waiting for a frame where ${label}`);
    },
    /** Real input, dispatched to a session (coordinates are in that target's viewport). */
    /** A real click; `button: 'right'` opens a context menu, `modifiers` is CDP's bit field (2 Ctrl, 8 Shift). */
    async click(sessionId, x, y, { button = 'left', modifiers = 0 } = {}) {
      const buttons = button === 'right' ? 2 : 1;
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 }, sessionId);
      await sleep(40);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons, clickCount: 1, modifiers }, sessionId);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1, modifiers }, sessionId);
      await sleep(200);
    },
    async type(sessionId, text) {
      await send('Input.insertText', { text }, sessionId);
      await sleep(100);
    },
    async key(sessionId, key, { code = key, keyCode = 0, modifiers = 0 } = {}) {
      const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base }, sessionId);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, sessionId);
      await sleep(150);
    },
    close() {
      try {
        ws.close();
      } catch {
        /* closed */
      }
    },
  };
  return api;
}
