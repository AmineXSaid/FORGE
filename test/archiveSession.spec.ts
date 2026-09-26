/**
 * Step 21: `archive_session` / `unarchive_session`.
 *
 * Host: `archivedSessions.ts` (the official settings store's `hiddenSessionIds`
 * and `sessionUnarchivedAt`), the two handlers and the dispatcher cases, plus
 * `list_sessions` flagging each row. Webview: `BaseTransport`, and the
 * `SessionStore` optimistic flag with its rollback and active-session swap.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { signal } from 'alien-signals';
import {
  ARCHIVED_SESSION_IDS_KEY,
  ArchivedSessionStore,
  SESSION_UNARCHIVED_AT_KEY,
  UNARCHIVE_TIME_MAX_AGE_MS,
  pruneUnarchiveTimes,
  type ArchivedSessionsMemento,
} from '../src/services/claude/archivedSessions';
import {
  handleArchiveSession,
  handleListSessions,
  handleUnarchiveSession,
} from '../src/services/claude/handlers/handlers';
import { ClaudeAgentService } from '../src/services/claude/ClaudeAgentService';
import { SessionStore } from '../src/webview/src/core/SessionStore';
import { Session } from '../src/webview/src/core/Session';
import { BaseTransport } from '../src/webview/src/transport/BaseTransport';
import { EventEmitter } from '../src/webview/src/utils/events';

/**
 * Switching the open conversation runs SessionStore's active-session effect,
 * which rewrites the ?session query parameter. vitest runs in , so give
 * it the two globals that effect touches -- nothing else needs a DOM here.
 */
beforeAll(() => {
  (globalThis as any).window ??= {
    location: new URL('http://localhost/index.html'),
    history: { replaceState: () => {} },
  };
});

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const NOW = 1_800_000_000_000;

const sessionContext = {
  currentSelection: signal(undefined),
  commandRegistry: { registerAction: () => {} },
  fileOpener: {},
  renameTab: () => {},
} as any;

/** VS Code's `Memento`: a map that hands back the object it was given. */
function memento(initial: Record<string, unknown> = {}): ArchivedSessionsMemento & { data: Map<string, unknown> } {
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

const makeStore = (initial: Record<string, unknown> = {}) => {
  const m = memento(initial);
  return { m, store: new ArchivedSessionStore(m, () => NOW) };
};

// ---------------------------------------------------------------------------
// Host: the store
// ---------------------------------------------------------------------------

describe('host: the archived-session store', () => {
  it('reads the official key, ignoring anything that is not a string', () => {
    const { store } = makeStore({ [ARCHIVED_SESSION_IDS_KEY]: [A, 42, null, B, {}] });
    expect(store.getArchivedSessionIds()).toEqual([A, B]);
    expect([...store.getArchivedSessionIdSet()]).toEqual([A, B]);
  });

  it('an absent or non-array entry reads as empty', () => {
    expect(makeStore().store.getArchivedSessionIds()).toEqual([]);
    expect(makeStore({ [ARCHIVED_SESSION_IDS_KEY]: 'nope' }).store.getArchivedSessionIds()).toEqual([]);
    expect(makeStore({ [ARCHIVED_SESSION_IDS_KEY]: { a: 1 } }).store.getArchivedSessionIds()).toEqual([]);
  });

  it('archiveSession appends, and archiving twice does not write again', async () => {
    const { m, store } = makeStore();
    await store.archiveSession(A);
    expect(m.get(ARCHIVED_SESSION_IDS_KEY)).toEqual([A]);
    const written = m.data.get(ARCHIVED_SESSION_IDS_KEY);
    await store.archiveSession(A);
    // Same array object: `archiveSessions` returned before updating.
    expect(m.data.get(ARCHIVED_SESSION_IDS_KEY)).toBe(written);
    await store.archiveSession(B);
    expect(m.get(ARCHIVED_SESSION_IDS_KEY)).toEqual([A, B]);
  });

  it('archiveSessions dedupes within the batch and against what is stored', async () => {
    const { m, store } = makeStore({ [ARCHIVED_SESSION_IDS_KEY]: [A] });
    await store.archiveSessions([A, B, B]);
    expect(m.get(ARCHIVED_SESSION_IDS_KEY)).toEqual([A, B]);
  });

  it('unarchiveSession stamps the time and drops the id', async () => {
    const { m, store } = makeStore({ [ARCHIVED_SESSION_IDS_KEY]: [A, B] });
    await store.unarchiveSession(A);
    expect(m.get(ARCHIVED_SESSION_IDS_KEY)).toEqual([B]);
    expect(m.get(SESSION_UNARCHIVED_AT_KEY)).toEqual({ [A]: NOW });
  });

  it('unarchiving something that was never archived still stamps the time', async () => {
    const { m, store } = makeStore();
    await store.unarchiveSession(A);
    expect(m.get(SESSION_UNARCHIVED_AT_KEY)).toEqual({ [A]: NOW });
    expect(m.get(ARCHIVED_SESSION_IDS_KEY)).toBeUndefined();
  });

  it('Zf$: stamps older than 14 days, and junk, are pruned on the next write', async () => {
    const stale = NOW - UNARCHIVE_TIME_MAX_AGE_MS - 1;
    const fresh = NOW - UNARCHIVE_TIME_MAX_AGE_MS + 1000;
    const { m, store } = makeStore({
      [SESSION_UNARCHIVED_AT_KEY]: { old: stale, keep: fresh, junk: 'x', nan: NaN, inf: Infinity },
    });
    await store.unarchiveSession(A);
    expect(m.get(SESSION_UNARCHIVED_AT_KEY)).toEqual({ keep: fresh, [A]: NOW });
  });

  it('pruneUnarchiveTimes on its own', () => {
    const cutoff = NOW - UNARCHIVE_TIME_MAX_AGE_MS;
    expect(pruneUnarchiveTimes({ a: cutoff, b: cutoff + 1, c: 'x' as unknown as number }, NOW)).toEqual({ b: cutoff + 1 });
  });

  it('a junk sessionUnarchivedAt entry reads as empty', () => {
    expect(makeStore({ [SESSION_UNARCHIVED_AT_KEY]: [1, 2] }).store.getSessionUnarchiveTimes()).toEqual({});
    expect(makeStore({ [SESSION_UNARCHIVED_AT_KEY]: 'x' }).store.getSessionUnarchiveTimes()).toEqual({});
    expect(makeStore({ [SESSION_UNARCHIVED_AT_KEY]: { a: 1, b: 'x' } }).store.getSessionUnarchiveTimes()).toEqual({ a: 1 });
  });
});

// ---------------------------------------------------------------------------
// Host: the handlers and the dispatcher
// ---------------------------------------------------------------------------

function handlerContext(initial: Record<string, unknown> = {}, rows?: unknown[]) {
  const m = memento(initial);
  const store = new ArchivedSessionStore(m, () => NOW);
  const listedFor: Array<ReadonlySet<string> | undefined> = [];
  const context = {
    logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
    workspaceService: { getDefaultWorkspaceFolder: () => ({ uri: { fsPath: '/w' } }) },
    sessionService: {
      listSessions: async (_cwd: string, archivedIds?: ReadonlySet<string>) => {
        listedFor.push(archivedIds);
        return (rows ?? []) as any;
      },
    },
    webViewService: { postMessage: vi.fn() },
    sdkService: {
      getArchivedSessionStore: () => store,
      getSessionPermissionModeStore: () => ({ getSessionPermissionModes: () => ({}) }),
    },
    agentService: { getCachedClaudeSettings: () => undefined },
  } as any;
  return { context, m, store, listedFor };
}

describe('host: the archive handlers', () => {
  it('archives a valid id and answers the bare response', async () => {
    const { context, m } = handlerContext();
    expect(await handleArchiveSession({ type: 'archive_session', sessionId: A } as any, context)).toEqual({
      type: 'archive_session_response',
    });
    expect(m.get(ARCHIVED_SESSION_IDS_KEY)).toEqual([A]);
  });

  it('unarchives a valid id and answers the bare response', async () => {
    const { context, m } = handlerContext({ [ARCHIVED_SESSION_IDS_KEY]: [A] });
    expect(await handleUnarchiveSession({ type: 'unarchive_session', sessionId: A } as any, context)).toEqual({
      type: 'unarchive_session_response',
    });
    expect(m.get(ARCHIVED_SESSION_IDS_KEY)).toEqual([]);
  });

  it('y0: a bad id writes nothing, for both requests, and still answers', async () => {
    for (const bad of [undefined, null, 42, {}, '', 'not-an-id', '../../etc/passwd', `${A}/../x`, `${A}x`]) {
      const archive = handlerContext();
      expect(await handleArchiveSession({ type: 'archive_session', sessionId: bad } as any, archive.context)).toEqual({
        type: 'archive_session_response',
      });
      expect(archive.m.data.size).toBe(0);

      const unarchive = handlerContext();
      expect(
        await handleUnarchiveSession({ type: 'unarchive_session', sessionId: bad } as any, unarchive.context)
      ).toEqual({ type: 'unarchive_session_response' });
      expect(unarchive.m.data.size).toBe(0);
    }
  });

  it('a store that throws is logged, not surfaced as an error', async () => {
    const { context } = handlerContext();
    context.sdkService.getArchivedSessionStore = () => ({
      archiveSession: async () => { throw new Error('globalState is gone'); },
      unarchiveSession: async () => { throw new Error('globalState is gone'); },
      getArchivedSessionIdSet: () => new Set<string>(),
    });
    expect(await handleArchiveSession({ type: 'archive_session', sessionId: A } as any, context)).toEqual({
      type: 'archive_session_response',
    });
    expect(await handleUnarchiveSession({ type: 'unarchive_session', sessionId: A } as any, context)).toEqual({
      type: 'unarchive_session_response',
    });
    expect(context.logService.error).toHaveBeenCalledTimes(2);
  });

  it('list_sessions hands the archived set to the lister', async () => {
    const { context, listedFor } = handlerContext({ [ARCHIVED_SESSION_IDS_KEY]: [B] }, [
      { id: A, archived: false, lastModified: 2, summary: 'A', isCurrentWorkspace: true },
      { id: B, archived: true, lastModified: 1, summary: 'B', isCurrentWorkspace: true },
    ]);
    const listed = await handleListSessions({ type: 'list_sessions_request' } as any, context);
    expect([...(listedFor[0] ?? [])]).toEqual([B]);
    expect(listed.sessions.map((s) => [s.id, s.archived])).toEqual([[A, false], [B, true]]);
  });
});

describe('host: the dispatcher cases', () => {
  const svcWith = (context: any) => {
    const svc = new (ClaudeAgentService as any)(
      context.logService, {}, {}, {}, {}, {}, {}, context.sdkService, {}, {}
    );
    svc.handlerContext = context;
    return svc;
  };

  it('archive_session and unarchive_session reach their handlers', async () => {
    const { context, m } = handlerContext();
    const svc = svcWith(context);
    expect(
      await svc.processRequest({ type: 'request', requestId: 'r1', request: { type: 'archive_session', sessionId: A } } as any, undefined as any)
    ).toEqual({ type: 'archive_session_response' });
    expect(m.get(ARCHIVED_SESSION_IDS_KEY)).toEqual([A]);
    expect(
      await svc.processRequest({ type: 'request', requestId: 'r2', request: { type: 'unarchive_session', sessionId: A } } as any, undefined as any)
    ).toEqual({ type: 'unarchive_session_response' });
    expect(m.get(ARCHIVED_SESSION_IDS_KEY)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Webview: the transport
// ---------------------------------------------------------------------------

class TestTransport extends BaseTransport {
  sent: any[] = [];
  protected send(message: any): void { this.sent.push(message); }
}

describe('webview: the transport', () => {
  it('sends the official payloads, with no channel', () => {
    const t = new TestTransport(new EventEmitter(), new EventEmitter());
    void t.archiveSession(A);
    void t.unarchiveSession(B);
    expect(t.sent.map((m) => [m.channelId, m.request])).toEqual([
      [undefined, { type: 'archive_session', sessionId: A }],
      [undefined, { type: 'unarchive_session', sessionId: B }],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Webview: the store
// ---------------------------------------------------------------------------

function fakeStore(opts: { throws?: boolean } = {}) {
  const calls: Array<[string, string]> = [];
  const connection = {
    archiveSession: async (id: string) => {
      calls.push(['archive', id]);
      if (opts.throws) throw new Error('no');
      return { type: 'archive_session_response' };
    },
    unarchiveSession: async (id: string) => {
      calls.push(['unarchive', id]);
      if (opts.throws) throw new Error('no');
      return { type: 'unarchive_session_response' };
    },
    listSessions: async () => ({ type: 'list_sessions_response', sessions: [] }),
    // Going active preloads the connection, which launches the CLI.
    launchClaude: () => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) }),
    permissionRequested: { add: () => () => {} },
    getSession: async () => ({ type: 'get_session_response', messages: [] }),
    setPermissionMode: async () => true,
    persistSessionPermissionMode: async () => {},
    sessionRenamedEvents: new EventEmitter<{ sessionId: string; title: string }>(),
    config: () => ({}),
    claudeConfig: () => undefined,
  } as any;
  const store = new SessionStore({ state: () => 'connected', connection: () => undefined } as any, sessionContext);
  (store as any).getConnection = async () => connection;

  const make = (id: string, archived = false) => {
    const s = Session.fromServer(
      { id, lastModified: 1, summary: id, archived, isCurrentWorkspace: true },
      async () => connection,
      sessionContext
    );
    return s;
  };
  const a = make(A);
  const b = make(B);
  store.sessions([a, b]);
  return { store, a, b, calls, connection, make };
}

describe('webview: SessionStore archive / unarchive', () => {
  it('flips the flag at once and sends the request', async () => {
    const { store, a, calls } = fakeStore();
    await store.archiveSession(a);
    expect(a.archived()).toBe(true);
    expect(calls).toEqual([['archive', A]]);
    await store.unarchiveSession(a);
    expect(a.archived()).toBe(false);
    expect(calls).toEqual([['archive', A], ['unarchive', A]]);
  });

  it('puts the flag back when the request throws', async () => {
    const { store, a } = fakeStore({ throws: true });
    await store.archiveSession(a);
    expect(a.archived()).toBe(false);
  });

  it('a session with no id is dropped from the list instead of being written', async () => {
    const { store, calls } = fakeStore();
    const blank = new Session(async () => ({}) as any, sessionContext, {});
    store.sessions([...store.sessions(), blank]);
    await store.archiveSession(blank);
    expect(store.sessions()).not.toContain(blank);
    expect(calls).toEqual([]);
  });

  it('archiving the open conversation moves to the next live one', async () => {
    const { store, a, b } = fakeStore();
    store.setActiveSession(a);
    await store.archiveSession(a);
    expect(store.activeSession()).toBe(b);
  });

  it('archiving the last live conversation starts a new one', async () => {
    const { store, a, b } = fakeStore();
    b.archived(true);
    store.setActiveSession(a);
    await store.archiveSession(a);
    // `createSession` is async; the replacement is not `a` and not archived.
    expect(store.activeSession()).not.toBe(a);
    expect(store.activeSession()).not.toBe(b);
  });

  it('archiving a conversation that is not open leaves the open one alone', async () => {
    // Three rows, with the open one *last*: if the guard went, the swap would
    // pick the first live row instead and steal focus.
    const { store, a, b, make } = fakeStore();
    const c = make('cccccccc-0000-4000-8000-000000000003');
    store.sessions([a, b, c]);
    store.setActiveSession(c);
    await store.archiveSession(a);
    expect(store.activeSession()).toBe(c);
  });

  it('a list that arrives mid-write does not overwrite the local flag', async () => {
    const { store, a, connection } = fakeStore();
    let release: (() => void) | undefined;
    connection.archiveSession = () => new Promise((resolve) => { release = () => resolve({}); });
    const archiving = store.archiveSession(a);
    await new Promise((r) => setTimeout(r, 5));
    connection.listSessions = async () => ({
      type: 'list_sessions_response',
      sessions: [{ id: A, lastModified: 2, summary: A, archived: false, isCurrentWorkspace: true }],
    });
    await store.listSessions();
    expect(a.archived()).toBe(true);
    release?.();
    await archiving;
  });

  it('a later list follows the host flag', async () => {
    const { store, a, connection } = fakeStore();
    connection.listSessions = async () => ({
      type: 'list_sessions_response',
      sessions: [{ id: A, lastModified: 2, summary: A, archived: true, isCurrentWorkspace: true }],
    });
    await store.listSessions();
    expect(a.archived()).toBe(true);
  });
});
