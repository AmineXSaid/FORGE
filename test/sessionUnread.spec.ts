/**
 * Step 22: `set_session_unread` and the status dot.
 *
 * Host: `unreadSessions.ts` (the official settings store's
 * `sessionUnread:<scope root>`), `handleSetSessionUnread`, the dispatcher case,
 * and `ClaudeAgentService.sendSessionStates` / `getOpenSessionIds`.
 * Webview: `core/sessionStates.ts` (`c$`, `SF1`, `lH0`, `dH0`), the transport's
 * request and its `session_states_update` receiver, and `SessionStore`'s
 * `reportActiveSessionUnread` with the visibility effect that drives it.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { signal } from 'alien-signals';
import {
  MAX_SESSION_KEY_LENGTH,
  MAX_UNREAD_SESSION_KEYS,
  UnreadSessionStore,
  isSessionKey,
  sessionListScopeRoot,
  unreadSessionKeysKey,
  type UnreadSessionsMemento,
} from '../src/services/claude/unreadSessions';
import { handleSetSessionUnread } from '../src/services/claude/handlers/handlers';
import { ClaudeAgentService } from '../src/services/claude/ClaudeAgentService';
import {
  REMOTE_KEY_PREFIX,
  feedHasSession,
  openStateFor,
  openStateTitle,
  sessionKey,
} from '../src/webview/src/core/sessionStates';
import { SessionStore } from '../src/webview/src/core/SessionStore';
import { Session } from '../src/webview/src/core/Session';
import { BaseTransport } from '../src/webview/src/transport/BaseTransport';
import { EventEmitter } from '../src/webview/src/utils/events';

beforeAll(() => {
  (globalThis as any).window ??= {
    location: new URL('http://localhost/index.html'),
    history: { replaceState: () => {} },
  };
});

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';

const sessionContext = {
  currentSelection: signal(undefined),
  commandRegistry: { registerAction: () => {} },
  fileOpener: {},
  renameTab: () => {},
} as any;

function memento(initial: Record<string, unknown> = {}): UnreadSessionsMemento & {
  data: Map<string, unknown>;
} {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    data,
    get: <T,>(key: string) => data.get(key) as T | undefined,
    update: async (key: string, value: unknown) => {
      if (value === undefined) data.delete(key);
      else data.set(key, value);
    },
  };
}

const ROOT = 'C:/w';
const KEY = `sessionUnread:${ROOT}`;
const makeStore = (initial: Record<string, unknown> = {}) => {
  const m = memento(initial);
  return { m, store: new UnreadSessionStore(m, () => ROOT) };
};

// ---------------------------------------------------------------------------
// Host: the unread store
// ---------------------------------------------------------------------------

describe('host: the scope root and the key', () => {
  it('A7$: a worktree checkout shares the main checkout`s list', () => {
    expect(sessionListScopeRoot('C:/w/.claude/worktrees/feature-x')).toBe('C:/w');
    expect(sessionListScopeRoot('C:\\w\\.claude\\worktrees\\feature-x')).toBe('C:\\w');
    // Only a trailing worktree segment is stripped, and only one.
    expect(sessionListScopeRoot('C:/w/.claude/worktrees/a/b')).toBe('C:/w/.claude/worktrees/a/b');
    expect(sessionListScopeRoot('C:/w')).toBe('C:/w');
  });

  it('the key is the official one', () => {
    expect(unreadSessionKeysKey('C:/w')).toBe('sessionUnread:C:/w');
    expect(unreadSessionKeysKey('C:/w/.claude/worktrees/x')).toBe('sessionUnread:C:/w');
  });

  it('bJ(): a key is 1..200 characters, and nothing else', () => {
    expect(isSessionKey('a')).toBe(true);
    expect(isSessionKey('x'.repeat(MAX_SESSION_KEY_LENGTH))).toBe(true);
    expect(isSessionKey('x'.repeat(MAX_SESSION_KEY_LENGTH + 1))).toBe(false);
    expect(isSessionKey('')).toBe(false);
    for (const bad of [undefined, null, 42, {}, [], true]) expect(isSessionKey(bad)).toBe(false);
  });

  it('a remote key is a key: the store never assumes a UUID', () => {
    expect(isSessionKey(`${REMOTE_KEY_PREFIX}${A}`)).toBe(true);
  });
});

describe('host: the unread store', () => {
  it('reads the official key, ignoring junk and duplicates', () => {
    const { store } = makeStore({ [KEY]: [A, 42, null, B, A, '', {}] });
    expect(store.getUnreadSessionKeys()).toEqual([A, B]);
  });

  it('an absent or non-array entry reads as empty', () => {
    expect(makeStore().store.getUnreadSessionKeys()).toEqual([]);
    expect(makeStore({ [KEY]: 'nope' }).store.getUnreadSessionKeys()).toEqual([]);
    expect(makeStore({ [KEY]: { a: 1 } }).store.getUnreadSessionKeys()).toEqual([]);
  });

  it('marks unread, and marking twice does not write again', async () => {
    const { m, store } = makeStore();
    expect(await store.setSessionUnread(A, true)).toBe(true);
    expect(m.get(KEY)).toEqual([A]);
    const written = m.data.get(KEY);
    expect(await store.setSessionUnread(A, true)).toBe(false);
    expect(m.data.get(KEY)).toBe(written);
  });

  it('marks read, and clearing something already read does not write', async () => {
    const { m, store } = makeStore({ [KEY]: [A, B] });
    expect(await store.setSessionUnread(A, false)).toBe(true);
    expect(m.get(KEY)).toEqual([B]);
    expect(await store.setSessionUnread(A, false)).toBe(false);
  });

  it('a bad key or a non-boolean is refused, and writes nothing', async () => {
    for (const badKey of [undefined, null, 42, {}, '', 'x'.repeat(MAX_SESSION_KEY_LENGTH + 1)]) {
      const { m, store } = makeStore();
      expect(await store.setSessionUnread(badKey, true)).toBe(false);
      expect(m.data.size).toBe(0);
    }
    for (const badFlag of [undefined, null, 0, 1, 'true', {}]) {
      const { m, store } = makeStore();
      expect(await store.setSessionUnread(A, badFlag)).toBe(false);
      expect(m.data.size).toBe(0);
    }
  });

  it('TS: the oldest keys go first once 500 are stored', async () => {
    const full = Array.from({ length: MAX_UNREAD_SESSION_KEYS }, (_, i) => `k${i}`);
    const { m, store } = makeStore({ [KEY]: full });
    expect(await store.setSessionUnread('new', true)).toBe(true);
    const stored = m.get<string[]>(KEY)!;
    expect(stored.length).toBe(MAX_UNREAD_SESSION_KEYS);
    expect(stored[0]).toBe('k1');
    expect(stored.at(-1)).toBe('new');
    expect(stored).not.toContain('k0');
  });

  it('a remote key round-trips unchanged', async () => {
    const remote = `${REMOTE_KEY_PREFIX}${A}`;
    const { m, store } = makeStore();
    expect(await store.setSessionUnread(remote, true)).toBe(true);
    expect(m.get(KEY)).toEqual([remote]);
    expect(store.getUnreadSessionKeys()).toEqual([remote]);
  });
});

// ---------------------------------------------------------------------------
// Host: the handler and the dispatcher
// ---------------------------------------------------------------------------

function handlerContext(initial: Record<string, unknown> = {}) {
  const m = memento(initial);
  const store = new UnreadSessionStore(m, () => ROOT);
  const broadcasts: number[] = [];
  const context = {
    logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    sdkService: { getUnreadSessionStore: () => store },
    agentService: { sendSessionStates: () => broadcasts.push(1) },
  } as any;
  return { context, m, store, broadcasts };
}

describe('host: handleSetSessionUnread', () => {
  it('writes the key and rebroadcasts the feed', async () => {
    const { context, m, broadcasts } = handlerContext();
    expect(
      await handleSetSessionUnread({ type: 'set_session_unread', sessionKey: A, unread: true } as any, context)
    ).toEqual({ type: 'set_session_unread_response' });
    expect(m.get(KEY)).toEqual([A]);
    expect(broadcasts.length).toBe(1);
  });

  it('a no-op write does not rebroadcast (`return this.broadcastSessionStates(), !0` only when changed)', async () => {
    const { context, broadcasts } = handlerContext({ [KEY]: [A] });
    await handleSetSessionUnread({ type: 'set_session_unread', sessionKey: A, unread: true } as any, context);
    expect(broadcasts.length).toBe(0);
  });

  it('a bad key or flag writes nothing, broadcasts nothing, and still answers', async () => {
    for (const request of [
      { sessionKey: undefined, unread: true },
      { sessionKey: '', unread: true },
      { sessionKey: 42, unread: true },
      { sessionKey: 'x'.repeat(MAX_SESSION_KEY_LENGTH + 1), unread: true },
      { sessionKey: A, unread: 'yes' },
      { sessionKey: A, unread: undefined },
      { sessionKey: A, unread: 1 },
    ]) {
      const { context, m, broadcasts } = handlerContext();
      expect(
        await handleSetSessionUnread({ type: 'set_session_unread', ...request } as any, context)
      ).toEqual({ type: 'set_session_unread_response' });
      expect(m.data.size).toBe(0);
      expect(broadcasts.length).toBe(0);
    }
  });

  it('a store that throws is logged, not surfaced', async () => {
    const { context } = handlerContext();
    context.sdkService.getUnreadSessionStore = () => ({
      setSessionUnread: async () => {
        throw new Error('globalState is gone');
      },
    });
    expect(
      await handleSetSessionUnread({ type: 'set_session_unread', sessionKey: A, unread: true } as any, context)
    ).toEqual({ type: 'set_session_unread_response' });
    expect(context.logService.error).toHaveBeenCalledTimes(1);
  });
});

describe('host: the dispatcher case and the states push', () => {
  const svc = (context: any) => {
    const s = new (ClaudeAgentService as any)(
      context.logService, {}, {}, {}, {}, {}, {}, context.sdkService, {}, {}
    );
    s.handlerContext = context;
    return s;
  };

  it('set_session_unread routes to the handler', async () => {
    const { context, m } = handlerContext();
    const s = svc(context);
    context.agentService = { sendSessionStates: () => {} };
    expect(
      await s.processRequest(
        { type: 'request', requestId: 'r1', request: { type: 'set_session_unread', sessionKey: A, unread: true } },
        undefined as any
      )
    ).toEqual({ type: 'set_session_unread_response' });
    expect(m.get(KEY)).toEqual([A]);
  });

  it('getOpenSessionIds reports each channel`s session once', () => {
    const { context } = handlerContext();
    const s = svc(context);
    s.channels = new Map<string, any>([
      ['c1', { sessionId: A }],
      ['c2', { sessionId: B }],
      ['c3', { sessionId: A }],
      ['c4', {}],
    ]);
    expect(s.getOpenSessionIds().sort()).toEqual([A, B].sort());
  });

  it('sendSessionStates pushes the official shape', () => {
    const { context } = handlerContext({ [KEY]: [B] });
    const s = svc(context);
    s.channels = new Map<string, any>([['c1', { sessionId: A }]]);
    const pushed: any[] = [];
    s.notifyClient = (r: any) => pushed.push(r);
    s.sendSessionStates();
    expect(pushed).toEqual([
      { type: 'session_states_update', sessions: [], openSessionIds: [A], unreadSessionKeys: [B] },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Webview: the ported pure functions
// ---------------------------------------------------------------------------

describe('webview: c$ / SF1 / lH0 / dH0', () => {
  it('c$: the id for a local session, prefixed for a remote one', () => {
    expect(sessionKey(A)).toBe(A);
    expect(sessionKey(A, true)).toBe(`${REMOTE_KEY_PREFIX}${A}`);
    expect(sessionKey(undefined)).toBeUndefined();
    expect(sessionKey('')).toBeUndefined();
  });

  it('SF1: an undefined feed matches nothing', () => {
    expect(feedHasSession(A, false, undefined, undefined)).toBe(false);
  });

  it('SF1: matches its own key, or the remote key it was teleported from', () => {
    expect(feedHasSession(A, false, undefined, new Set([A]))).toBe(true);
    expect(feedHasSession(A, false, undefined, new Set([B]))).toBe(false);
    // The origin is always addressed as remote.
    expect(feedHasSession(A, false, B, new Set([`${REMOTE_KEY_PREFIX}${B}`]))).toBe(true);
    expect(feedHasSession(A, false, B, new Set([B]))).toBe(false);
    expect(feedHasSession(undefined, false, undefined, new Set([A]))).toBe(false);
  });

  it('lH0: a session this host is not running shows unread, or no dot at all', () => {
    expect(openStateFor(false, false, false, false)).toBeUndefined();
    expect(openStateFor(false, false, false, true)).toBe('unread');
    // busy and pendingInput belong to a live channel: ignored when closed.
    expect(openStateFor(false, true, true, false)).toBeUndefined();
  });

  it('lH0: an open session reports waiting over running, then unread, then idle', () => {
    expect(openStateFor(true, true, true, true)).toBe('waiting');
    expect(openStateFor(true, false, true, false)).toBe('waiting');
    expect(openStateFor(true, true, false, true)).toBe('running');
    expect(openStateFor(true, false, false, true)).toBe('unread');
    expect(openStateFor(true, false, false, false)).toBe('idle');
  });

  it('lH0: a closed session live elsewhere reports that activity', () => {
    expect(openStateFor(false, false, false, false, 'waiting')).toBe('waiting');
    expect(openStateFor(false, false, false, false, 'running')).toBe('running');
    // Live elsewhere but idle there: unread still wins over idle.
    expect(openStateFor(false, false, false, true, undefined as any)).toBe('unread');
  });

  it('dH0: the tooltip', () => {
    expect(openStateTitle('unread')).toBe('Unread');
    expect(openStateTitle('idle')).toBe('Open in a tab');
    expect(openStateTitle('waiting')).toBe('Open in a tab — awaiting input');
    expect(openStateTitle('running')).toBe('Open in a tab — running');
    expect(openStateTitle('running', 'terminal')).toBe('Open in a terminal — running');
    expect(openStateTitle('idle', 'vscode')).toBe('Open in another VS Code window');
  });
});

// ---------------------------------------------------------------------------
// Webview: the transport
// ---------------------------------------------------------------------------

class TestTransport extends BaseTransport {
  sent: any[] = [];
  protected send(message: any): void {
    this.sent.push(message);
  }
  feed(message: any) {
    (this as any).fromHost.enqueue(message);
  }
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('webview: the transport', () => {
  it('sends the official payload, with no channel', () => {
    const t = new TestTransport(new EventEmitter(), new EventEmitter());
    void t.setSessionUnread(A, true);
    expect(t.sent.map((m) => [m.channelId, m.request])).toEqual([
      [undefined, { type: 'set_session_unread', sessionKey: A, unread: true }],
    ]);
  });

  it('both feeds start undefined: the list draws no dot before the host answers', () => {
    const t = new TestTransport(new EventEmitter(), new EventEmitter());
    expect(t.openSessionIds()).toBeUndefined();
    expect(t.unreadSessionKeys()).toBeUndefined();
  });

  it('session_states_update fills the feeds, and answers nothing', async () => {
    const t = new TestTransport(new EventEmitter(), new EventEmitter());
    t.feed({
      type: 'request',
      requestId: 'p1',
      request: { type: 'session_states_update', sessions: [], openSessionIds: [A], unreadSessionKeys: [B] },
    });
    await tick();
    expect(t.openSessionIds()).toEqual([A]);
    expect(t.unreadSessionKeys()).toEqual([B]);
    expect(t.sent).toEqual([]);
  });

  it('a field the push omits is left alone, never cleared', async () => {
    const t = new TestTransport(new EventEmitter(), new EventEmitter());
    t.feed({
      type: 'request',
      requestId: 'p1',
      request: { type: 'session_states_update', sessions: [], openSessionIds: [A], unreadSessionKeys: [B] },
    });
    await tick();
    t.feed({ type: 'request', requestId: 'p2', request: { type: 'session_states_update', sessions: [] } });
    await tick();
    expect(t.openSessionIds()).toEqual([A]);
    expect(t.unreadSessionKeys()).toEqual([B]);
  });

  it('an empty list is a real answer: the feed becomes ready', async () => {
    const t = new TestTransport(new EventEmitter(), new EventEmitter());
    t.feed({
      type: 'request',
      requestId: 'p1',
      request: { type: 'session_states_update', sessions: [], openSessionIds: [], unreadSessionKeys: [] },
    });
    await tick();
    expect(t.unreadSessionKeys()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Webview: SessionStore
// ---------------------------------------------------------------------------

function storeHarness(opts: { unreadFeed?: string[]; visible?: boolean } = {}) {
  const calls: Array<[string, boolean]> = [];
  const isVisible = signal(opts.visible ?? true);
  const unreadSessionKeys = signal<string[] | undefined>(opts.unreadFeed);
  const openSessionIds = signal<string[] | undefined>([]);
  const connection = {
    setSessionUnread: async (key: string, unread: boolean) => {
      calls.push([key, unread]);
      return { type: 'set_session_unread_response' };
    },
    listSessions: async () => ({ type: 'list_sessions_response', sessions: [] }),
    sessionRenamedEvents: new EventEmitter<{ sessionId: string; title: string }>(),
    // Making a session active runs the store's own effect, which preloads a
    // channel. Nothing here reads the stream; it only has to exist.
    launchClaude: () => ({ [Symbol.asyncIterator]: async function* () {} }),
    getSession: async () => ({ type: 'get_session_response', messages: [] }),
    isVisible,
    unreadSessionKeys,
    openSessionIds,
    config: () => ({}),
    claudeConfig: () => undefined,
  } as any;
  const connectionManager = {
    state: () => 'connected',
    connection: () => connection,
    get: async () => connection,
  } as any;
  const store = new SessionStore(connectionManager, sessionContext);
  (store as any).getConnection = async () => connection;

  const session = Session.fromServer(
    { id: A, lastModified: 1, summary: 'A', isCurrentWorkspace: true },
    async () => connection,
    sessionContext
  );
  store.sessions([session]);
  return { store, session, calls, connection, isVisible, unreadSessionKeys };
}

describe('webview: reportActiveSessionUnread', () => {
  it('not_applicable until the CLI has named the session', () => {
    const { store, session, connection, calls } = storeHarness({ unreadFeed: [] });
    expect(store.reportActiveSessionUnread(session, connection, true)).toBe('not_applicable');
    expect(calls).toEqual([]);
  });

  it('not_applicable with no session, or no connection', () => {
    const { store, session, connection } = storeHarness({ unreadFeed: [] });
    session.sessionIdFromCli(true);
    expect(store.reportActiveSessionUnread(undefined, connection, true)).toBe('not_applicable');
    expect(store.reportActiveSessionUnread(session, undefined, true)).toBe('not_applicable');
  });

  it('not_applicable when the session has no id to key on', () => {
    const { store, session, connection } = storeHarness({ unreadFeed: [] });
    session.sessionIdFromCli(true);
    session.sessionId(undefined);
    expect(store.reportActiveSessionUnread(session, connection, true)).toBe('not_applicable');
  });

  it('feed_not_ready while the host has not answered, and nothing is sent', () => {
    const { store, session, connection, calls } = storeHarness();
    session.sessionIdFromCli(true);
    expect(store.reportActiveSessionUnread(session, connection, true)).toBe('feed_not_ready');
    expect(calls).toEqual([]);
  });

  it('sent once the feed is ready', async () => {
    const { store, session, connection, calls } = storeHarness({ unreadFeed: [] });
    session.sessionIdFromCli(true);
    expect(store.reportActiveSessionUnread(session, connection, true)).toBe('sent');
    await tick();
    expect(calls).toEqual([[A, true]]);
  });
});

describe('webview: the visibility effect', () => {
  it('a turn finishing while hidden marks the open conversation unread', async () => {
    const { store, session, calls, isVisible } = storeHarness({ unreadFeed: [] });
    session.sessionIdFromCli(true);
    store.activeSession(session);
    isVisible(false);
    session.busy(true);
    await tick();
    session.busy(false);
    await tick();
    expect(calls).toEqual([[A, true]]);
  });

  it('a turn finishing while visible marks nothing', async () => {
    const { store, session, calls } = storeHarness({ unreadFeed: [] });
    session.sessionIdFromCli(true);
    store.activeSession(session);
    session.busy(true);
    await tick();
    session.busy(false);
    await tick();
    expect(calls).toEqual([]);
  });

  it('becoming visible again marks it read', async () => {
    const { store, session, calls, isVisible } = storeHarness({ unreadFeed: [] });
    session.sessionIdFromCli(true);
    store.activeSession(session);
    isVisible(false);
    session.busy(true);
    await tick();
    session.busy(false);
    await tick();
    isVisible(true);
    await tick();
    expect(calls).toEqual([[A, true], [A, false]]);
  });

  it('a mark that arrived before the feed is retried once it lands', async () => {
    const { store, session, calls, isVisible, unreadSessionKeys } = storeHarness();
    session.sessionIdFromCli(true);
    store.activeSession(session);
    isVisible(false);
    session.busy(true);
    await tick();
    session.busy(false);
    await tick();
    // The feed was undefined, so nothing was sent yet.
    expect(calls).toEqual([]);
    unreadSessionKeys([]);
    await tick();
    expect(calls).toEqual([[A, true]]);
  });
});

describe('webview: SessionStore.setSessionUnread', () => {
  it('sends the key straight through, with no local flip', async () => {
    const { store, calls } = storeHarness({ unreadFeed: [] });
    await store.setSessionUnread(A, true);
    expect(calls).toEqual([[A, true]]);
  });

  it('a failed write is logged, not thrown', async () => {
    const { store, connection } = storeHarness({ unreadFeed: [] });
    connection.setSessionUnread = async () => {
      throw new Error('no');
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(store.setSessionUnread(A, true)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
