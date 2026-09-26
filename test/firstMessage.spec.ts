/**
 * A message sent before the first session exists is not lost (found by the
 * end-to-end run, 2026-09-24).
 *
 * The composer draws with the chat, but the runtime only creates the first
 * session once the connection, the selection, the asset URIs and the session
 * list have loaded. `handleSubmit` returned early without a session, after the
 * composer had already cleared: on a fresh install the first message vanished.
 * Now a submit and the runtime share one creation (`ensureActiveSession`).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { signal } from 'alien-signals';
import { SessionStore } from '../src/webview/src/core/SessionStore';

beforeAll(() => {
  (globalThis as any).window ??= { location: new URL('http://localhost/index.html'), history: { replaceState: () => {} } };
});

const context = { currentSelection: signal(undefined), commandRegistry: { registerAction: () => {} }, fileOpener: {}, renameTab: () => {} } as any;

function store(connectionDelayMs = 0) {
  const connection = {
    launchClaude: () => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) }),
    permissionRequested: { add: () => () => {} },
    config: () => ({}),
    claudeConfig: () => undefined,
  } as any;
  const s = new SessionStore({ state: () => 'connected', connection: () => undefined } as any, context);
  (s as any).getConnection = () => new Promise((resolve) => setTimeout(() => resolve(connection), connectionDelayMs));
  return s;
}

describe('ensureActiveSession', () => {
  it('returns the active session when there is one', async () => {
    const s = store();
    const created = await s.createSession();
    expect(await s.ensureActiveSession()).toBe(created);
    expect(s.sessions()).toHaveLength(1);
  });

  it('creates one when there is none, and concurrent callers share it', async () => {
    const s = store(20);
    const [fromSubmit, fromRuntime] = await Promise.all([s.ensureActiveSession(), s.ensureActiveSession()]);
    expect(fromSubmit).toBe(fromRuntime);
    expect(s.sessions()).toHaveLength(1);
    expect(s.activeSession()).toBe(fromSubmit);
  });
});

describe('the wiring', () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

  it('the chat waits for a session instead of dropping the message', () => {
    const chat = read('src/webview/src/pages/ChatPage.vue');
    const submit = chat.slice(chat.indexOf('async function handleSubmit'), chat.indexOf('async function handleSubmit') + 700);
    expect(submit).toContain('runtime?.sessionStore.ensureActiveSession()');
    expect(submit).not.toMatch(/if \(!s \|\| \(!trimmed/);
  });

  it('the runtime creates its first session through the same call', () => {
    expect(read('src/webview/src/composables/useRuntime.ts')).toContain('await sessionStore.ensureActiveSession()');
  });
});
