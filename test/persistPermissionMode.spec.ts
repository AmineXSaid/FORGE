/**
 * Step 18: `persist_session_permission_mode`, each conversation's mode kept
 * across reloads.
 *
 * Host: `sessionPermissionModes.ts` (the official `C1$` store and the request
 * handler), the dispatcher case on `ClaudeAgentService`, `list_sessions`
 * attaching each stored mode, and `init` reporting the initial mode. Webview:
 * `core/modePersist.ts` (the official `SL1`), and the `Session` /
 * `SessionStore` wiring that sends it and restores from it.
 */
import { describe, expect, it, vi } from 'vitest';
import { signal } from 'alien-signals';
import {
  MAX_STORED_SESSION_MODES,
  SESSION_MODE_MAX_AGE_MS,
  SessionPermissionModeStore,
  attachSessionPermissionModes,
  bypassPersistGateOpen,
  initialPermissionModeFrom,
  isSessionModeEntry,
  persistSessionPermissionMode,
  sessionModeKey,
  validSessionId,
  type SessionModeMemento,
} from '../src/services/claude/sessionPermissionModes';
import { toClaudeSettingsSnapshot } from '../src/services/claude/claudeSettings';
import { ClaudeAgentService } from '../src/services/claude/ClaudeAgentService';
import { handleInit, handleListSessions } from '../src/services/claude/handlers/handlers';
import {
  ModePersist,
  bypassGateDecidablyOpen,
  restorableSessionMode,
  type ModePersistConnection,
} from '../src/webview/src/core/modePersist';
import { Session } from '../src/webview/src/core/Session';
import { SessionStore } from '../src/webview/src/core/SessionStore';
import { BaseTransport } from '../src/webview/src/transport/BaseTransport';
import { EventEmitter } from '../src/webview/src/utils/events';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const NOW = 1_800_000_000_000;

/** VS Code's `Memento`: a map that hands back the very object it was given. */
function memento(initial: Record<string, unknown> = {}): SessionModeMemento & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    data,
    get: (key) => data.get(key),
    update: async (key, value) => {
      if (value === undefined) data.delete(key);
      else data.set(key, value);
    },
    keys: () => [...data.keys()],
  };
}

function makeStore(initial: Record<string, unknown> = {}, allowBypass = false) {
  const m = memento(initial);
  const store = new SessionPermissionModeStore(m, () => allowBypass, () => NOW);
  return { m, store };
}

const entry = (mode: string, age = 0) => ({ mode, updatedAt: NOW - age });

// ---------------------------------------------------------------------------
// Host: validation
// ---------------------------------------------------------------------------

describe('host: ids and entries are checked before they become keys', () => {
  it('y0: only a CLI session id', () => {
    expect(validSessionId(A)).toBe(A);
    expect(validSessionId(A.toUpperCase())).toBe(A.toUpperCase());
    for (const bad of [undefined, null, 42, {}, '', 'not-an-id', `${A}x`, `x${A}`, '../../etc/passwd', `${A}/../x`, 'aaaaaaaa-0000-4000-8000-00000000000g']) {
      expect(validSessionId(bad)).toBeNull();
    }
  });

  it('Cl$: a finite timestamp at most a day ahead, and a kept mode', () => {
    expect(isSessionModeEntry(entry('acceptEdits'), NOW)).toBe(true);
    expect(isSessionModeEntry({ mode: 'default', updatedAt: NOW + 86_400_000 }, NOW)).toBe(true);
    expect(isSessionModeEntry({ mode: 'default', updatedAt: NOW + 86_400_001 }, NOW)).toBe(false);
    for (const bad of [null, 'default', {}, { mode: 'default' }, { mode: 'default', updatedAt: NaN }, { mode: 'default', updatedAt: Infinity }, { mode: 'default', updatedAt: '1' }]) {
      expect(isSessionModeEntry(bad, NOW)).toBe(false);
    }
    // Plan and "don't ask" are never kept; Forge also keeps Auto out.
    for (const mode of ['plan', 'dontAsk', 'auto', 'yolo']) expect(isSessionModeEntry(entry(mode), NOW)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Host: the store
// ---------------------------------------------------------------------------

describe('host: the session-mode store (C1$)', () => {
  it('stores under the official key, as {mode, updatedAt}', async () => {
    const { m, store } = makeStore();
    await store.setSessionPermissionMode(A, 'acceptEdits');
    expect(sessionModeKey(A)).toBe(`sessionPermissionMode:${A}`);
    expect(m.data.get(`sessionPermissionMode:${A}`)).toEqual({ mode: 'acceptEdits', updatedAt: NOW });
    expect(store.getSessionPermissionModes()).toEqual({ [A]: 'acceptEdits' });
  });

  it('reads back only live entries: not stale, not junk, bypass only while allowed', () => {
    const initial = {
      [sessionModeKey(A)]: entry('bypassPermissions'),
      [sessionModeKey(B)]: entry('acceptEdits', SESSION_MODE_MAX_AGE_MS + 1),
      'sessionPermissionMode:cccccccc-0000-4000-8000-000000000003': { mode: 'plan', updatedAt: NOW },
      'sessionPermissionMode:dddddddd-0000-4000-8000-000000000004': entry('default', SESSION_MODE_MAX_AGE_MS),
      unrelated: entry('default'),
    };
    expect(makeStore(initial, false).store.getSessionPermissionModes()).toEqual({
      'dddddddd-0000-4000-8000-000000000004': 'default',
    });
    expect(makeStore(initial, true).store.getSessionPermissionModes()).toEqual({
      [A]: 'bypassPermissions',
      'dddddddd-0000-4000-8000-000000000004': 'default',
    });
  });

  it('prunes junk, stale entries, then all but the newest 200 -- never the one just written', async () => {
    const initial: Record<string, unknown> = {
      'sessionPermissionMode:junk': { mode: 'nope', updatedAt: NOW },
      'sessionPermissionMode:stale': entry('default', SESSION_MODE_MAX_AGE_MS + 5),
      thinkingLevel: 'off',
    };
    for (let i = 0; i < MAX_STORED_SESSION_MODES + 5; i++) initial[`sessionPermissionMode:s${i}`] = entry('default', 1000 + i);
    const { m, store } = makeStore(initial);
    // The oldest entry is also the one being written: it survives.
    m.data.set(sessionModeKey(A), entry('default', 10_000_000));
    await store.pruneSessionPermissionModes(A);
    const keys = m.keys().filter((k) => k.startsWith('sessionPermissionMode:'));
    expect(keys).toHaveLength(MAX_STORED_SESSION_MODES + 1);
    expect(keys).toContain(sessionModeKey(A));
    expect(keys).not.toContain('sessionPermissionMode:junk');
    expect(keys).not.toContain('sessionPermissionMode:stale');
    expect(keys).not.toContain(`sessionPermissionMode:s${MAX_STORED_SESSION_MODES + 4}`);
    expect(m.get('thinkingLevel')).toBe('off');
  });

  it('moves an entry to a new id and drops the old key', async () => {
    const { m, store } = makeStore({ [sessionModeKey(A)]: entry('acceptEdits', 50) });
    await store.moveSessionPermissionMode(A, B, { bypassBarredByHost: false });
    expect(m.get(sessionModeKey(A))).toBeUndefined();
    expect(m.get(sessionModeKey(B))).toEqual({ mode: 'acceptEdits', updatedAt: NOW });
  });

  it('a move with nothing (or nothing live) to move leaves no entry', async () => {
    const empty = makeStore();
    await empty.store.moveSessionPermissionMode(A, B, { bypassBarredByHost: false });
    expect(empty.m.data.size).toBe(0);
    const barred = makeStore({ [sessionModeKey(A)]: entry('bypassPermissions') }, true);
    await barred.store.moveSessionPermissionMode(A, B, { bypassBarredByHost: true });
    expect(barred.m.data.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Host: the request
// ---------------------------------------------------------------------------

describe('host: persistSessionPermissionMode', () => {
  const persist = (store: SessionPermissionModeStore, request: Record<string, unknown>, gate = false) =>
    persistSessionPermissionMode(store, request as any, () => gate);

  it('stores a kept mode', async () => {
    const { m, store } = makeStore();
    await expect(persist(store, { sessionId: A, mode: 'acceptEdits' })).resolves.toBe('stored');
    expect(m.get(sessionModeKey(A))).toEqual({ mode: 'acceptEdits', updatedAt: NOW });
  });

  it('plan, dontAsk and auto clear the entry (the official keeps none of them; Forge also leaves Auto out)', async () => {
    for (const mode of ['plan', 'dontAsk', 'auto']) {
      const { m, store } = makeStore({ [sessionModeKey(A)]: entry('acceptEdits') });
      await expect(persist(store, { sessionId: A, mode })).resolves.toBe('cleared');
      expect(m.get(sessionModeKey(A))).toBeUndefined();
    }
  });

  it('rejects a bad id: nothing is written, nothing is cleared', async () => {
    for (const sessionId of [undefined, 42, '', 'abc', '../../x', `${A} `, { toString: () => A }]) {
      const { m, store } = makeStore({ [sessionModeKey(A)]: entry('acceptEdits') });
      await expect(persist(store, { sessionId, mode: 'default' })).resolves.toBe('ignored');
      expect([...m.data.keys()]).toEqual([sessionModeKey(A)]);
    }
  });

  it('rejects a bad mode (stricter than the official, which would clear)', async () => {
    for (const mode of ['yolo', '', 42, null, undefined, 'toString', '__proto__']) {
      const { m, store } = makeStore({ [sessionModeKey(A)]: entry('acceptEdits') });
      await expect(persist(store, { sessionId: A, mode })).resolves.toBe('ignored');
      expect(m.get(sessionModeKey(A))).toEqual(entry('acceptEdits'));
    }
  });

  it('bypass is stored only while the gate is open', async () => {
    const closed = makeStore({ [sessionModeKey(A)]: entry('default') });
    await expect(persist(closed.store, { sessionId: A, mode: 'bypassPermissions' }, false)).resolves.toBe('ignored');
    expect(closed.m.get(sessionModeKey(A))).toEqual(entry('default'));
    const open = makeStore({}, true);
    await expect(persist(open.store, { sessionId: A, mode: 'bypassPermissions' }, true)).resolves.toBe('stored');
    expect(open.m.get(sessionModeKey(A))).toMatchObject({ mode: 'bypassPermissions' });
  });

  it('a replaced id without carry-over: the old entry is cleared, the new one set', async () => {
    const { m, store } = makeStore({ [sessionModeKey(A)]: entry('default') });
    await expect(persist(store, { sessionId: B, mode: 'acceptEdits', previousSessionId: A })).resolves.toBe('stored');
    expect(m.get(sessionModeKey(A))).toBeUndefined();
    expect(m.get(sessionModeKey(B))).toMatchObject({ mode: 'acceptEdits' });
  });

  it('carry-over moves the stored mode to the new id (the request mode is not what is stored)', async () => {
    const { m, store } = makeStore({ [sessionModeKey(A)]: entry('acceptEdits', 99) });
    await expect(persist(store, { sessionId: B, mode: 'default', previousSessionId: A, carriedFromStore: true })).resolves.toBe('moved');
    expect(m.get(sessionModeKey(A))).toBeUndefined();
    expect(m.get(sessionModeKey(B))).toEqual({ mode: 'acceptEdits', updatedAt: NOW });
  });

  it('carry-over must be exactly true; a bad previous id is not a move', async () => {
    const truthy = makeStore({ [sessionModeKey(A)]: entry('acceptEdits') });
    await expect(persist(truthy.store, { sessionId: B, mode: 'default', previousSessionId: A, carriedFromStore: 'yes' })).resolves.toBe('stored');
    expect(truthy.m.get(sessionModeKey(A))).toBeUndefined();
    expect(truthy.m.get(sessionModeKey(B))).toMatchObject({ mode: 'default' });

    const badPrevious = makeStore({ [sessionModeKey(A)]: entry('acceptEdits') });
    await expect(persist(badPrevious.store, { sessionId: B, mode: 'default', previousSessionId: '../x', carriedFromStore: true })).resolves.toBe('stored');
    expect(badPrevious.m.get(sessionModeKey(A))).toEqual(entry('acceptEdits'));
  });

  it('a carried bypass is dropped, not moved, while the host bars it', async () => {
    const { m, store } = makeStore({ [sessionModeKey(A)]: entry('bypassPermissions') }, true);
    await expect(persist(store, { sessionId: B, mode: 'bypassPermissions', previousSessionId: A, carriedFromStore: true }, false)).resolves.toBe('moved');
    expect(m.data.size).toBe(0);
  });

  it('a refused bypass on a replaced id still clears the old entry', async () => {
    const { m, store } = makeStore({ [sessionModeKey(A)]: entry('default') });
    await expect(persist(store, { sessionId: B, mode: 'bypassPermissions', previousSessionId: A }, false)).resolves.toBe('cleared');
    expect(m.data.size).toBe(0);
  });

  it('bypassPersistGateOpen: allowed, settings read, not disabled', () => {
    const read = { effective: {} };
    const disabled = { effective: { permissions: { disableBypassPermissionsMode: 'disable' } } };
    expect(bypassPersistGateOpen(false, read)).toBe(false);
    expect(bypassPersistGateOpen(true, undefined)).toBe(false);
    expect(bypassPersistGateOpen(true, disabled)).toBe(false);
    expect(bypassPersistGateOpen(true, read)).toBe(true);
  });

  it('the settings snapshot carries disableBypassPermissionsMode only when set to "disable"', () => {
    expect(toClaudeSettingsSnapshot({ effective: { permissions: { disableBypassPermissionsMode: 'disable' } } })?.effective.permissions)
      .toEqual({ disableBypassPermissionsMode: 'disable' });
    expect(toClaudeSettingsSnapshot({ effective: { permissions: { disableBypassPermissionsMode: 'nope', allow: ['x'] } } })?.effective.permissions)
      .toBeUndefined();
  });
});

describe('host: the dispatcher, list_sessions and init', () => {
  function makeService(allowBypass = false) {
    const m = memento();
    const store = new SessionPermissionModeStore(m, () => allowBypass, () => NOW);
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const sdkService = {
      getAllowDangerouslySkipPermissions: () => allowBypass,
      getSessionPermissionModeStore: () => store,
      getThinkingLevel: () => 'default_on',
    };
    const svc = new (ClaudeAgentService as any)(log, {}, {}, {}, {}, {}, {}, sdkService, {}, {});
    const dispatch = (request: any) =>
      svc.processRequest({ type: 'request', requestId: 'r1', channelId: undefined, request }, new AbortController().signal);
    return { svc, m, dispatch, sdkService };
  }

  it('persist_session_permission_mode needs no channel and answers the bare response', async () => {
    const { m, dispatch } = makeService();
    await expect(dispatch({ type: 'persist_session_permission_mode', sessionId: A, mode: 'acceptEdits' })).resolves.toEqual({
      type: 'persist_session_permission_mode_response',
    });
    expect(m.get(sessionModeKey(A))).toMatchObject({ mode: 'acceptEdits' });
    await expect(dispatch({ type: 'persist_session_permission_mode', sessionId: 'nope', mode: 'default' })).resolves.toEqual({
      type: 'persist_session_permission_mode_response',
    });
    expect(m.data.size).toBe(1);
  });

  it('the bypass gate reads the cached CLI settings', async () => {
    const { svc, m, dispatch } = makeService(true);
    await dispatch({ type: 'persist_session_permission_mode', sessionId: A, mode: 'bypassPermissions' });
    expect(m.data.size).toBe(0); // no settings read yet: closed, as the official
    svc.noteClaudeSettings({ effective: {} });
    await dispatch({ type: 'persist_session_permission_mode', sessionId: A, mode: 'bypassPermissions' });
    expect(m.get(sessionModeKey(A))).toMatchObject({ mode: 'bypassPermissions' });
    svc.noteClaudeSettings({ effective: { permissions: { disableBypassPermissionsMode: 'disable' } } });
    await dispatch({ type: 'persist_session_permission_mode', sessionId: B, mode: 'bypassPermissions' });
    expect(m.get(sessionModeKey(B))).toBeUndefined();
  });

  function handlerContext(opts: { modes?: Record<string, unknown>; allowBypass?: boolean; settings?: any; defaultPermissionMode?: unknown } = {}) {
    const m = memento(opts.modes);
    const store = new SessionPermissionModeStore(m, () => opts.allowBypass ?? false, () => NOW);
    return {
      logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      workspaceService: { getDefaultWorkspaceFolder: () => ({ uri: { fsPath: '/w' } }) },
      configService: {
        getSetting: async () => 'default',
        getExtensionConfig: async () => ({ defaultPermissionMode: opts.defaultPermissionMode ?? 'default' }),
      },
      sessionService: {
        listSessions: async () => [
          { id: A, lastModified: 2, messageCount: 1, summary: 'A', isCurrentWorkspace: true },
          { id: B, lastModified: 1, messageCount: 1, summary: 'B', isCurrentWorkspace: true },
        ],
      },
      sdkService: {
        getSessionPermissionModeStore: () => store,
        // step 21: the list flags archived rows from this store.
        getArchivedSessionStore: () => ({ getArchivedSessionIdSet: () => new Set<string>() }),
        getAllowDangerouslySkipPermissions: () => opts.allowBypass ?? false,
        getThinkingLevel: () => 'default_on',
      },
      agentService: { getCachedClaudeSettings: () => opts.settings },
    } as any;
  }

  it('list_sessions attaches each stored mode, and drops bypass the settings disable', async () => {
    const modes = { [sessionModeKey(A)]: entry('acceptEdits'), [sessionModeKey(B)]: entry('bypassPermissions') };
    const listed = await handleListSessions({ type: 'list_sessions_request' } as any, handlerContext({ modes, allowBypass: true, settings: { effective: {} } }));
    expect(listed.sessions.map((s) => [s.id, s.permissionMode])).toEqual([[A, 'acceptEdits'], [B, 'bypassPermissions']]);
    const barred = await handleListSessions(
      { type: 'list_sessions_request' } as any,
      handlerContext({ modes, allowBypass: true, settings: { effective: { permissions: { disableBypassPermissionsMode: 'disable' } } } })
    );
    expect(barred.sessions.map((s) => s.permissionMode)).toEqual(['acceptEdits', undefined]);
    const notAllowed = await handleListSessions({ type: 'list_sessions_request' } as any, handlerContext({ modes }));
    expect(notAllowed.sessions.map((s) => s.permissionMode)).toEqual(['acceptEdits', undefined]);
  });

  it('attachSessionPermissionModes leaves sessions without an entry untouched', () => {
    const rows = [{ id: A }, { id: B }, { id: 'toString' }];
    expect(attachSessionPermissionModes(rows, { [A]: 'default' }, false)).toEqual([{ id: A, permissionMode: 'default' }, { id: B }, { id: 'toString' }]);
  });

  it('init reports the initial mode from "Default Permission Mode", gated', async () => {
    const state = async (opts: Parameters<typeof handlerContext>[0]) => (await handleInit({ type: 'init' } as any, handlerContext(opts))).state;
    await expect(state({})).resolves.toMatchObject({ initialPermissionMode: 'default', allowDangerouslySkipPermissions: false });
    await expect(state({ defaultPermissionMode: 'plan' })).resolves.toMatchObject({ initialPermissionMode: 'plan' });
    await expect(state({ defaultPermissionMode: 'bypassPermissions' })).resolves.toMatchObject({ initialPermissionMode: 'default' });
    await expect(state({ defaultPermissionMode: 'bypassPermissions', allowBypass: true })).resolves.toMatchObject({
      initialPermissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    });
    expect(await state({ defaultPermissionMode: 'rm -rf' })).not.toHaveProperty('initialPermissionMode');
  });

  it('initialPermissionModeFrom: manual is default, Auto stays out', () => {
    expect(initialPermissionModeFrom('manual', false)).toBe('default');
    expect(initialPermissionModeFrom('dontAsk', false)).toBe('dontAsk');
    expect(initialPermissionModeFrom('acceptEdits', false)).toBe('acceptEdits');
    expect(initialPermissionModeFrom('auto', true)).toBeUndefined();
    expect(initialPermissionModeFrom(undefined, true)).toBeUndefined();
    expect(initialPermissionModeFrom(7, true)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Webview: SL1
// ---------------------------------------------------------------------------

function persistConnection() {
  const calls: unknown[][] = [];
  let settle: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
  const connection: ModePersistConnection & { calls: unknown[][] } = {
    calls,
    persistSessionPermissionMode: (...args: unknown[]) => {
      calls.push(args);
      return new Promise<void>((resolve, reject) => settle.push({ resolve, reject }));
    },
  };
  const resolveAll = async () => {
    const pending = settle;
    settle = [];
    for (const p of pending) p.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  const rejectAll = async () => {
    const pending = settle;
    settle = [];
    for (const p of pending) p.reject(new Error('host down'));
    await Promise.resolve();
    await Promise.resolve();
  };
  return { connection, calls, resolveAll, rejectAll };
}

describe('webview: modePersist (SL1)', () => {
  it('a pick pushed to a live CLI commits only once the CLI accepts it', async () => {
    const p = new ModePersist(() => {});
    const { connection, calls, resolveAll } = persistConnection();
    const token = p.deliberateCycle('acceptEdits', { exitingMode: 'default', pushDeliverable: true });
    expect(p.tryCommit(connection, A)).toBe(false);
    expect(p.hasPendingDeliberateChoice()).toBe(true);
    p.pushResolved(token, true);
    expect(p.tryCommit(connection, A)).toBe(true);
    expect(calls).toEqual([[A, 'acceptEdits', undefined]]);
    expect(p.mirror).toBe('acceptEdits');
    await resolveAll();
    expect(p.hasPendingDeliberateChoice()).toBe(false);
    expect(p.tryCommit(connection, A)).toBe(false);
  });

  it('a refused pick is not kept', () => {
    const p = new ModePersist(() => {});
    const { connection, calls } = persistConnection();
    const token = p.deliberateCycle('acceptEdits', { exitingMode: 'default', pushDeliverable: true });
    p.pushResolved(token, false);
    expect(p.tryCommit(connection, A)).toBe(false);
    expect(calls).toEqual([]);
    expect(p.hasPendingDeliberateChoice()).toBe(false);
  });

  it('with no live CLI the launch applies it, so it commits at once', () => {
    const p = new ModePersist(() => {});
    const { connection, calls } = persistConnection();
    p.deliberateCycle('acceptEdits', { pushDeliverable: false });
    expect(p.tryCommit(connection, A)).toBe(true);
    expect(calls).toEqual([[A, 'acceptEdits', undefined]]);
  });

  it('lowering privilege commits before the CLI answers: leaving bypass, or a mode that is not kept', () => {
    const leaving = new ModePersist(() => {});
    const one = persistConnection();
    leaving.deliberateCycle('default', { exitingMode: 'bypassPermissions', pushDeliverable: true });
    expect(leaving.tryCommit(one.connection, A)).toBe(true);
    expect(one.calls).toEqual([[A, 'default', undefined]]);

    const plan = new ModePersist(() => {});
    const two = persistConnection();
    plan.seedMirror('acceptEdits');
    plan.deliberateCycle('plan', { exitingMode: 'acceptEdits', pushDeliverable: true });
    expect(plan.tryCommit(two.connection, A)).toBe(true);
    expect(two.calls).toEqual([[A, 'plan', undefined]]);
    expect(plan.mirror).toBeUndefined();
  });

  it('a flush during a commit is re-offered when the commit settles', async () => {
    const owed = vi.fn();
    const p = new ModePersist(owed);
    const { connection, calls, resolveAll } = persistConnection();
    p.deliberateCycle('acceptEdits', { pushDeliverable: false });
    p.tryCommit(connection, A);
    p.deliberateCycle('default', { pushDeliverable: false });
    expect(p.tryCommit(connection, A)).toBe(false);
    await resolveAll();
    expect(owed).toHaveBeenCalledTimes(1);
    expect(p.tryCommit(connection, A)).toBe(true);
    expect(calls.map((c) => c[1])).toEqual(['acceptEdits', 'default']);
  });

  it('a failed commit restores the mirror and owes clearing the id it tried', async () => {
    const p = new ModePersist(() => {});
    const { connection, calls, rejectAll } = persistConnection();
    p.seedMirror('default');
    p.deliberateCycle('acceptEdits', { pushDeliverable: false });
    p.tryCommit(connection, A);
    await rejectAll();
    expect(p.mirror).toBe('default');
    expect(p.hasStaleEntryDebt()).toBe(true);
    // Retried under a new id: the old one is cleared in the same request.
    expect(p.tryCommit(connection, B)).toBe(true);
    expect(calls[1]).toEqual([B, 'acceptEdits', A]);
  });

  it('a replaced id: a pending pick clears the old entry; a kept one moves', () => {
    const p = new ModePersist(() => {});
    const { connection, calls } = persistConnection();
    p.deliberateCycle('acceptEdits', { exitingMode: 'default', pushDeliverable: true });
    p.noteSessionIdChange(A);
    const token = p.currentToken;
    p.pushResolved(token, true);
    p.tryCommit(connection, B);
    expect(calls[0]).toEqual([B, 'acceptEdits', A]);

    const kept = new ModePersist(() => {});
    const two = persistConnection();
    kept.seedMirror('acceptEdits');
    kept.moveCommittedEntry(two.connection, B, A);
    expect(two.calls).toEqual([[B, 'acceptEdits', A, true]]);
    const nothing = new ModePersist(() => {});
    nothing.moveCommittedEntry(two.connection, B, A);
    expect(two.calls).toHaveLength(1);
  });

  it('restorableSessionMode: bypass only when allowed and not disabled', () => {
    const allowed = { allowDangerouslySkipPermissions: true };
    const read = { effective: {} };
    const disabled = { effective: { permissions: { disableBypassPermissionsMode: 'disable' } } };
    expect(restorableSessionMode({ permissionMode: 'acceptEdits' }, undefined, undefined)).toBe('acceptEdits');
    expect(restorableSessionMode({}, allowed, read)).toBeUndefined();
    expect(restorableSessionMode({ permissionMode: 'bypassPermissions' }, {}, read)).toBeUndefined();
    expect(restorableSessionMode({ permissionMode: 'bypassPermissions' }, allowed, disabled)).toBeUndefined();
    expect(restorableSessionMode({ permissionMode: 'bypassPermissions' }, allowed, read)).toBe('bypassPermissions');
    expect(bypassGateDecidablyOpen(allowed, read)).toBe(true);
    expect(bypassGateDecidablyOpen(undefined, read)).toBe(false);
    expect(bypassGateDecidablyOpen(allowed, disabled)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Webview: Session and SessionStore
// ---------------------------------------------------------------------------

function fakeConnection(opts: { initial?: string; allowBypass?: boolean; sessions?: any[]; accept?: boolean } = {}) {
  const persisted: unknown[][] = [];
  const launched: any[] = [];
  const pushes: unknown[][] = [];
  const connection = {
    state: signal('connected'),
    config: signal<any>({
      defaultCwd: '/w',
      modelSetting: 'default',
      initialPermissionMode: opts.initial ?? 'default',
      allowDangerouslySkipPermissions: opts.allowBypass ?? false,
    }),
    claudeConfig: signal<any>({ claudeSettings: { effective: {} } }),
    permissionRequested: { add: () => () => {} },
    launchClaude: (...args: any[]) => {
      launched.push(args);
      return { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
    },
    setPermissionMode: async (...args: unknown[]) => {
      pushes.push(args);
      return opts.accept ?? true;
    },
    persistSessionPermissionMode: async (...args: unknown[]) => {
      persisted.push(args);
    },
    listSessions: async () => ({ sessions: opts.sessions ?? [] }),
  };
  return { connection, persisted, launched, pushes };
}

const context = { currentSelection: signal(undefined), commandRegistry: { registerAction: () => {} }, fileOpener: {} } as any;
const flush = () => new Promise((r) => setTimeout(r, 0));

function listedSession(conn: ReturnType<typeof fakeConnection>, id = A) {
  return Session.fromServer({ id, lastModified: 1, summary: 'x', messageCount: 1, isCurrentWorkspace: true }, async () => conn.connection as never, context);
}

describe('webview: Session sends it from the official trigger points', () => {
  it('a mode picked in a live conversation is kept once the CLI accepts it', async () => {
    const conn = fakeConnection();
    const session = listedSession(conn);
    await session.launchClaude();
    await session.setPermissionMode('acceptEdits');
    await flush();
    expect(conn.pushes).toEqual([[expect.any(String), 'acceptEdits', true]]);
    expect(conn.persisted).toEqual([[A, 'acceptEdits', undefined]]);
  });

  it('a pick before launch is kept at once (the launch applies it), and reaches the launch', async () => {
    const conn = fakeConnection();
    const session = listedSession(conn);
    await session.getConnection();
    await session.setPermissionMode('acceptEdits');
    await flush();
    expect(conn.persisted).toEqual([[A, 'acceptEdits', undefined]]);
    await session.launchClaude();
    expect(conn.launched[0][4]).toBe('acceptEdits');
  });

  it('plan is sent too (the host clears the entry); a refused pick and a prompt answer are not sent', async () => {
    const conn = fakeConnection();
    const session = listedSession(conn);
    await session.launchClaude();
    await session.setPermissionMode('plan');
    await flush();
    expect(conn.persisted).toEqual([[A, 'plan', undefined]]);

    const refused = fakeConnection({ accept: false });
    const s2 = listedSession(refused);
    await s2.launchClaude();
    await s2.setPermissionMode('acceptEdits');
    await flush();
    expect(refused.persisted).toEqual([]);
    expect(s2.permissionMode()).toBe('default');

    const prompt = fakeConnection();
    const s3 = listedSession(prompt);
    await s3.launchClaude();
    await s3.setPermissionMode('acceptEdits', true, false);
    await flush();
    expect(prompt.persisted).toEqual([]);
  });

  it('a new conversation keeps its pick once the CLI names it', async () => {
    const conn = fakeConnection();
    const session = new Session(async () => conn.connection as never, context);
    await session.launchClaude();
    await session.setPermissionMode('acceptEdits');
    await flush();
    expect(conn.persisted).toEqual([]);
    (session as any).processIncomingMessage({ type: 'system', subtype: 'init', session_id: B, permissionMode: 'acceptEdits' });
    await flush();
    expect(conn.persisted).toEqual([[B, 'acceptEdits', undefined]]);
  });

  it('restores into the mode control and the launch; the CLI init overrules a restore it did not take', async () => {
    const conn = fakeConnection();
    const session = listedSession(conn);
    session.adoptPersistedSessionMode('acceptEdits');
    expect(session.permissionMode()).toBe('acceptEdits');
    await session.launchClaude();
    expect(conn.launched[0][4]).toBe('acceptEdits');
    (session as any).processIncomingMessage({ type: 'system', subtype: 'init', session_id: A, permissionMode: 'default' });
    expect(session.permissionMode()).toBe('default');
    expect(conn.persisted).toEqual([]);
  });

  it('when the CLI replaces the id, the kept mode moves with it', async () => {
    const conn = fakeConnection();
    const session = listedSession(conn);
    session.adoptPersistedSessionMode('acceptEdits');
    await session.launchClaude();
    (session as any).processIncomingMessage({ type: 'system', subtype: 'init', session_id: A, permissionMode: 'acceptEdits' });
    (session as any).processIncomingMessage({ type: 'system', subtype: 'init', session_id: B, permissionMode: 'acceptEdits' });
    await flush();
    expect(conn.persisted).toEqual([[B, 'acceptEdits', A, true]]);
  });
});

describe('webview: the transport', () => {
  class TestTransport extends BaseTransport {
    sent: any[] = [];
    protected send(message: any): void {
      this.sent.push(message);
    }
    feed(message: any) {
      this.fromHost.enqueue(message);
    }
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('sends the official payload, with no channel', () => {
    const t = new TestTransport(new EventEmitter(), new EventEmitter());
    void t.persistSessionPermissionMode(B, 'acceptEdits', A, true);
    void t.persistSessionPermissionMode(A, 'plan');
    expect(t.sent.map((m) => [m.channelId, m.request])).toEqual([
      [undefined, { type: 'persist_session_permission_mode', sessionId: B, mode: 'acceptEdits', previousSessionId: A, carriedFromStore: true }],
      [undefined, { type: 'persist_session_permission_mode', sessionId: A, mode: 'plan', previousSessionId: undefined, carriedFromStore: undefined }],
    ]);
  });

  it('keeps initialPermissionMode and allowDangerouslySkipPermissions from init, and re-asks when the setting changes', async () => {
    const t = new TestTransport(new EventEmitter(), new EventEmitter());
    const init = t.initialize();
    const answer = (initialPermissionMode?: string) => {
      const request = t.sent.at(-1);
      t.feed({
        type: 'response',
        requestId: request.requestId,
        response: {
          type: 'init_response',
          state: { defaultCwd: '/w', openNewInTab: false, modelSetting: 'default', platform: 'win32', initialPermissionMode, allowDangerouslySkipPermissions: true },
        },
      });
    };
    answer('acceptEdits');
    await tick();
    t.feed({ type: 'response', requestId: t.sent.at(-1).requestId, response: { type: 'get_claude_state_response', config: {} } });
    await init;
    expect(t.config()).toMatchObject({ initialPermissionMode: 'acceptEdits', allowDangerouslySkipPermissions: true });

    t.feed({ type: 'request', requestId: 'x', request: { type: 'extension_config_changed', key: 'defaultPermissionMode', value: 'plan' } });
    await tick();
    expect(t.sent.at(-1).request).toEqual({ type: 'init' });
    answer('plan');
    await tick();
    expect(t.config()?.initialPermissionMode).toBe('plan');

    // Other keys don't re-ask.
    const count = t.sent.length;
    t.feed({ type: 'request', requestId: 'y', request: { type: 'extension_config_changed', key: 'completionSound', value: false } });
    await tick();
    expect(t.sent).toHaveLength(count);
  });
});

describe('webview: SessionStore restores on open', () => {
  function store(conn: ReturnType<typeof fakeConnection>) {
    const manager = { connection: () => undefined, state: () => 'connected', get: async () => conn.connection };
    return new SessionStore(manager as any, context);
  }

  it('each listed session opens in its kept mode, else the initial mode; bypass only when allowed', async () => {
    const conn = fakeConnection({
      initial: 'plan',
      sessions: [
        { id: A, lastModified: 3, summary: 'A', messageCount: 1, isCurrentWorkspace: true, permissionMode: 'acceptEdits' },
        { id: B, lastModified: 2, summary: 'B', messageCount: 1, isCurrentWorkspace: true },
        { id: 'cccccccc-0000-4000-8000-000000000003', lastModified: 1, summary: 'C', messageCount: 1, isCurrentWorkspace: true, permissionMode: 'bypassPermissions' },
      ],
    });
    const s = store(conn);
    await s.listSessions();
    expect(s.sessions().map((x) => [x.sessionId(), x.permissionMode()])).toEqual([
      [A, 'acceptEdits'],
      [B, 'plan'],
      ['cccccccc-0000-4000-8000-000000000003', 'plan'],
    ]);
  });

  it('a new conversation starts in the initial mode, before it launches', async () => {
    const conn = fakeConnection({ initial: 'acceptEdits' });
    const s = store(conn);
    const originalWindow = (globalThis as any).window;
    (globalThis as any).window = { location: 'http://x/', history: { replaceState: () => {} } };
    try {
      const session = await s.createSession({ isExplicit: false });
      expect(session.permissionMode()).toBe('acceptEdits');
      await flush();
      expect(conn.launched[0][4]).toBe('acceptEdits');
    } finally {
      (globalThis as any).window = originalWindow;
    }
  });

  it('a refreshed list moves an unlaunched restore along, and leaves a fresh pick alone', async () => {
    const sessions = [{ id: A, lastModified: 3, summary: 'A', messageCount: 1, isCurrentWorkspace: true, permissionMode: 'acceptEdits' }];
    const conn = fakeConnection({ sessions });
    const s = store(conn);
    await s.listSessions();
    const a = s.sessions()[0];
    sessions[0].permissionMode = 'default';
    await s.listSessions();
    expect(a.permissionMode()).toBe('default');
  });
});
