/**
 * Step 20: `rename_session`.
 *
 * Host: `sessionIdentity.ts` (the official `GX` / `sY` / `bg` / `ds$`),
 * `sessionList.ts` (the official `buildSessionList` mapping over the SDK's
 * `SDKSessionInfo`), `handleRenameSession` and the dispatcher case. Webview:
 * `BaseTransport.renameSession` + the `session_renamed` push, and the
 * `SessionStore` optimistic rename with its rollback.
 */
import { describe, expect, it, vi } from 'vitest';
import { signal } from 'alien-signals';
import {
  SESSION_TITLE_MAX_CODE_POINTS,
  capSessionTitle,
  isFilesystemSafeSessionId,
  isPathSafeSegment,
  plannedRename,
  renameableSessionId,
  sessionTitleForDisk,
} from '../src/services/claude/sessionIdentity';
import {
  isCurrentWorkspace,
  sessionListOptions,
  toSessionList,
  toSessionListRow,
  worktreeOf,
} from '../src/services/claude/sessionList';
import { handleListSessions, handleRenameSession } from '../src/services/claude/handlers/handlers';
import { ClaudeAgentService } from '../src/services/claude/ClaudeAgentService';
import { SessionStore } from '../src/webview/src/core/SessionStore';
import { Session } from '../src/webview/src/core/Session';
import { BaseTransport } from '../src/webview/src/transport/BaseTransport';
import { EventEmitter } from '../src/webview/src/utils/events';

/** The SessionContext the webview core needs (step 18's fake). */
const sessionContext = { currentSelection: signal(undefined), commandRegistry: { registerAction: () => {} }, fileOpener: {} } as any;

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';

// ---------------------------------------------------------------------------
// Host: ids and titles
// ---------------------------------------------------------------------------

describe('host: the id never reaches the filesystem unchecked (B3)', () => {
  it('bg: no separator, no parent hop, no NUL', () => {
    expect(isPathSafeSegment(A)).toBe(true);
    for (const bad of [undefined, null, 42, {}, 'a/b', 'a\\b', '../x', 'a..b', 'a\u0000b']) {
      expect(isPathSafeSegment(bad)).toBe(false);
    }
  });

  it('sY: also rejects the Windows charset, device names and a trailing dot or space', () => {
    expect(isFilesystemSafeSessionId(A)).toBe(true);
    // A bare name is filesystem-safe on its own -- that is all `sY` claims.
    expect(isFilesystemSafeSessionId('hello')).toBe(true);
    for (const bad of ['a:b', 'a<b', 'a>b', 'a"b', 'a|b', 'a?b', 'a*b', 'a\u0001b', 'CON', 'con.', 'NUL ', 'COM1', 'LPT9', 'name.', 'name ']) {
      expect(isFilesystemSafeSessionId(bad)).toBe(false);
    }
  });

  it('renameableSessionId: filesystem-safe AND a session id (the SDK Qe)', () => {
    expect(renameableSessionId(A)).toBe(A);
    expect(renameableSessionId(A.toUpperCase())).toBe(A.toUpperCase());
    for (const bad of [
      undefined, null, 42, {}, '', 'hello', 'CON',
      '../../etc/passwd', `${A}/../x`, `..\\${A}`,
      `${A}x`, `x${A}`, 'aaaaaaaa-0000-4000-8000-00000000000g', `${A} `, `${A}.`,
    ]) {
      expect(renameableSessionId(bad)).toBeNull();
    }
  });

  it('GX: caps at 200 code points without splitting an astral character', () => {
    expect(capSessionTitle('abc')).toBe('abc');
    expect([...capSessionTitle('x'.repeat(500))]).toHaveLength(SESSION_TITLE_MAX_CODE_POINTS);
    // 300 astral code points are 600 UTF-16 units: a naive slice(0,200) would
    // cut a surrogate pair in half.
    const emoji = capSessionTitle('\u{1F600}'.repeat(300));
    expect([...emoji]).toHaveLength(200);
    expect(emoji.endsWith('\u{1F600}')).toBe(true);
  });

  it('GX does not trim and does not strip newlines -- the SDK trims when it writes', () => {
    // The step file says "trimmed, length-capped, newlines stripped"; the
    // bundle's GX is only Ix($,200). Recorded in the results file.
    expect(capSessionTitle('  padded  ')).toBe('  padded  ');
    expect(capSessionTitle('two\nlines')).toBe('two\nlines');
    expect(sessionTitleForDisk('  padded  ')).toBe('padded');
    expect(sessionTitleForDisk('two\nlines')).toBe('two\nlines');
  });

  it('plannedRename: the whole gate, and every way it is skipped', () => {
    expect(plannedRename(A, ' Renamed ')).toEqual({ sessionId: A, title: 'Renamed' });
    expect(plannedRename(A, 'x'.repeat(500))?.title).toHaveLength(SESSION_TITLE_MAX_CODE_POINTS);
    // A title that is only spaces caps to spaces, then trims to nothing.
    for (const bad of ['', '   ', '\n\t ']) expect(plannedRename(A, bad)).toBeNull();
    for (const bad of [undefined, null, 42, {}, [], true]) {
      expect(plannedRename(A, bad)).toBeNull();
      expect(plannedRename(bad, 'Title')).toBeNull();
    }
    expect(plannedRename('../x', 'Title')).toBeNull();
    expect(plannedRename('not-an-id', 'Title')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Host: the list row (buildSessionList over SDKSessionInfo)
// ---------------------------------------------------------------------------

describe('host: the list row is the official mapping over SDKSessionInfo', () => {
  it('l$$: a .claude/worktrees/<name> checkout, else nothing', () => {
    expect(worktreeOf('/repo/.claude/worktrees/feature-x')).toEqual({
      name: 'feature-x',
      path: '/repo/.claude/worktrees/feature-x',
    });
    expect(worktreeOf('C:\\repo\\.claude\\worktrees\\feat')).toEqual({
      name: 'feat',
      path: 'C:\\repo\\.claude\\worktrees\\feat',
    });
    expect(worktreeOf('/repo')).toBeUndefined();
    expect(worktreeOf('/repo/.claude/worktrees/feat/src')).toBeUndefined();
    expect(worktreeOf(undefined)).toBeUndefined();
  });

  it('BI0: a host outside a worktree owns every session; inside one, only its own', () => {
    expect(isCurrentWorkspace('/anything', '/repo')).toBe(true);
    expect(isCurrentWorkspace(undefined, '/repo/.claude/worktrees/a')).toBe(true);
    expect(isCurrentWorkspace('/repo/.claude/worktrees/a', '/repo/.claude/worktrees/a')).toBe(true);
    expect(isCurrentWorkspace('/repo/.claude/worktrees/b', '/repo/.claude/worktrees/a')).toBe(false);
    expect(isCurrentWorkspace('/repo', '/repo/.claude/worktrees/a')).toBe(false);
  });

  it('the SDK options the official passes', () => {
    expect(sessionListOptions('/repo')).toEqual({
      dir: '/repo',
      includeWorktrees: false,
      includeProgrammatic: true,
    });
  });

  it('carries every SDKSessionInfo field through, plus archived and the worktree', () => {
    const row = toSessionListRow(
      {
        sessionId: A,
        summary: 'Custom title',
        lastModified: 5,
        fileSize: 99,
        customTitle: 'Custom title',
        firstPrompt: 'do the thing',
        gitBranch: 'feature/x',
        cwd: '/repo/.claude/worktrees/feat',
        tag: 'release',
        createdAt: 1,
      },
      '/repo',
      new Set([A])
    );
    expect(row).toEqual({
      id: A,
      archived: true,
      lastModified: 5,
      fileSize: 99,
      summary: 'Custom title',
      customTitle: 'Custom title',
      firstPrompt: 'do the thing',
      gitBranch: 'feature/x',
      cwd: '/repo/.claude/worktrees/feat',
      tag: 'release',
      createdAt: 1,
      worktree: { name: 'feat', path: '/repo/.claude/worktrees/feat' },
      isCurrentWorkspace: true,
    });
  });

  it('keeps the SDK order and marks only the archived ids', () => {
    const list = toSessionList(
      [
        { sessionId: A, summary: 'A', lastModified: 2 },
        { sessionId: B, summary: 'B', lastModified: 1 },
      ],
      '/repo',
      new Set([B])
    );
    expect(list.map((r) => [r.id, r.archived])).toEqual([[A, false], [B, true]]);
  });
});

// ---------------------------------------------------------------------------
// Host: the handler and the dispatcher
// ---------------------------------------------------------------------------

function handlerContext(opts: { rename?: (id: string, title: string, cwd: string) => Promise<boolean> } = {}) {
  const pushed: any[] = [];
  const renamed: Array<[string, string, string]> = [];
  const context = {
    logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    workspaceService: { getDefaultWorkspaceFolder: () => ({ uri: { fsPath: '/w' } }) },
    sessionService: {
      listSessions: async () => [],
      renameSession: async (id: string, title: string, cwd: string) => {
        renamed.push([id, title, cwd]);
        return opts.rename ? opts.rename(id, title, cwd) : false;
      },
    },
    webViewService: { postMessage: (m: any) => pushed.push(m) },
    sdkService: {
      getSessionPermissionModeStore: () => ({ getSessionPermissionModes: () => ({}) }),
      getArchivedSessionStore: () => ({ getArchivedSessionIdSet: () => new Set<string>() }),
    },
    agentService: { getCachedClaudeSettings: () => undefined },
  } as any;
  return { context, pushed, renamed };
}

const rename = (sessionId: unknown, title: unknown) =>
  ({ type: 'rename_session', sessionId, title }) as any;

describe('host: handleRenameSession', () => {
  it('validates, caps, writes, and pushes session_renamed', async () => {
    const { context, pushed, renamed } = handlerContext();
    const response = await handleRenameSession(rename(A, '  Renamed  '), context);
    expect(response).toEqual({ type: 'rename_session_response', skipped: false });
    expect(renamed).toEqual([[A, 'Renamed', '/w']]);
    expect(pushed).toHaveLength(1);
    expect(pushed[0].request).toEqual({ type: 'session_renamed', sessionId: A, title: 'Renamed' });
  });

  it('a bad id, a bad type or an empty title is skipped, and nothing is written or pushed', async () => {
    for (const [id, title] of [
      ['../x', 'Title'],
      ['not-an-id', 'Title'],
      [A, ''],
      [A, '   '],
      [A, 42],
      [42, 'Title'],
      [`${A}/../${B}`, 'Title'],
    ] as Array<[unknown, unknown]>) {
      const { context, pushed, renamed } = handlerContext();
      expect(await handleRenameSession(rename(id, title), context)).toEqual({
        type: 'rename_session_response',
        skipped: true,
      });
      expect(renamed).toEqual([]);
      expect(pushed).toEqual([]);
    }
  });

  it('a store that skips (no transcript) answers skipped and pushes nothing', async () => {
    const { context, pushed } = handlerContext({ rename: async () => true });
    expect(await handleRenameSession(rename(A, 'Title'), context)).toEqual({
      type: 'rename_session_response',
      skipped: true,
    });
    expect(pushed).toEqual([]);
  });

  it('a thrown write is reported as skipped, not as an error', async () => {
    const { context, pushed } = handlerContext({
      rename: async () => {
        throw new Error('transcript moved');
      },
    });
    expect(await handleRenameSession(rename(A, 'Title'), context)).toEqual({
      type: 'rename_session_response',
      skipped: true,
    });
    expect(pushed).toEqual([]);
  });

  it('list_sessions passes the SDK-derived fields straight through', async () => {
    const { context } = handlerContext();
    context.sessionService.listSessions = async () => [
      { id: A, archived: false, lastModified: 2, summary: 'Custom', customTitle: 'Custom', gitBranch: 'main', isCurrentWorkspace: true },
    ];
    const listed = await handleListSessions({ type: 'list_sessions_request' } as any, context);
    expect(listed.sessions[0]).toMatchObject({ customTitle: 'Custom', gitBranch: 'main', archived: false });
  });
});

describe('host: the dispatcher case', () => {
  it('rename_session reaches the handler', async () => {
    const { context } = handlerContext();
    const svc = new (ClaudeAgentService as any)(
      context.logService, {}, {}, {}, {}, {}, {}, context.sdkService, {}, {}
    );
    svc.handlerContext = context;
    const response = await svc.processRequest({ type: 'request', requestId: 'r1', request: rename(A, 'From the dispatcher') } as any, undefined as any);
    expect(response).toEqual({ type: 'rename_session_response', skipped: false });
    expect(context.sessionService).toBeTruthy();
  });

  it('the dispatcher passes a rejected id through unchanged', async () => {
    const { context, pushed } = handlerContext();
    const svc = new (ClaudeAgentService as any)(
      context.logService, {}, {}, {}, {}, {}, {}, context.sdkService, {}, {}
    );
    svc.handlerContext = context;
    expect(await svc.processRequest({ type: 'request', requestId: 'r2', request: rename('../x', 'Title') } as any, undefined as any)).toEqual({
      type: 'rename_session_response',
      skipped: true,
    });
    expect(pushed).toEqual([]);
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
    void t.renameSession(A, 'New title');
    expect(t.sent.map((m) => [m.channelId, m.request])).toEqual([
      [undefined, { type: 'rename_session', sessionId: A, title: 'New title' }],
    ]);
  });

  it('turns the session_renamed push into sessionRenamedEvents, and answers nothing', async () => {
    const t = new TestTransport(new EventEmitter(), new EventEmitter());
    const seen: Array<{ sessionId: string; title: string }> = [];
    t.sessionRenamedEvents.add((e) => seen.push(e));
    t.feed({ type: 'request', requestId: 'p1', request: { type: 'session_renamed', sessionId: A, title: 'Pushed' } });
    await tick();
    expect(seen).toEqual([{ sessionId: A, title: 'Pushed' }]);
    expect(t.sent).toEqual([]);
  });

  it('ignores a push with a non-string id or title', async () => {
    const t = new TestTransport(new EventEmitter(), new EventEmitter());
    const seen: unknown[] = [];
    t.sessionRenamedEvents.add((e) => seen.push(e));
    t.feed({ type: 'request', requestId: 'p1', request: { type: 'session_renamed', sessionId: 42, title: 'x' } });
    t.feed({ type: 'request', requestId: 'p2', request: { type: 'session_renamed', sessionId: A } });
    await tick();
    expect(seen).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Webview: the store
// ---------------------------------------------------------------------------

function fakeStore(opts: { skipped?: boolean; throws?: boolean } = {}) {
  const calls: Array<[string, string]> = [];
  const connection = {
    renameSession: async (sessionId: string, title: string) => {
      calls.push([sessionId, title]);
      if (opts.throws) throw new Error('no');
      return { type: 'rename_session_response', skipped: opts.skipped === true };
    },
    listSessions: async () => ({ type: 'list_sessions_response', sessions: [] }),
    sessionRenamedEvents: new EventEmitter<{ sessionId: string; title: string }>(),
    config: () => ({}),
    claudeConfig: () => undefined,
  } as any;
  const connectionManager = { state: () => 'connected', connection: () => undefined } as any;
  const store = new SessionStore(connectionManager, sessionContext);
  (store as any).getConnection = async () => connection;

  const session = Session.fromServer(
    { id: A, lastModified: 1, summary: 'Old title', isCurrentWorkspace: true },
    async () => connection,
    sessionContext
  );
  store.sessions([session]);
  return { store, session, calls, connection };
}

describe('webview: SessionStore.renameSession', () => {
  it('shows the new title at once and sends the request', async () => {
    const { store, session, calls } = fakeStore();
    await store.renameSession(A, 'New title');
    expect(calls).toEqual([[A, 'New title']]);
    expect(session.summary()).toBe('New title');
    expect(session.hasPersistedTitle()).toBe(true);
  });

  it('puts the old title back when the host says it skipped', async () => {
    const { store, session } = fakeStore({ skipped: true });
    await store.renameSession(A, 'New title');
    expect(session.summary()).toBe('Old title');
    expect(session.hasPersistedTitle()).toBe(false);
  });

  it('puts the old title back when the request throws, and rethrows', async () => {
    const { store, session } = fakeStore({ throws: true });
    await expect(store.renameSession(A, 'New title')).rejects.toThrow('no');
    expect(session.summary()).toBe('Old title');
    expect(session.hasPersistedTitle()).toBe(false);
  });

  it('adoptPersistedTitle takes a pushed title without sending anything', () => {
    const { store, session, calls } = fakeStore();
    store.adoptPersistedTitle(A, 'Pushed');
    expect(session.summary()).toBe('Pushed');
    expect(session.hasPersistedTitle()).toBe(true);
    expect(calls).toEqual([]);
    // An unknown id, or a title already shown, changes nothing.
    store.adoptPersistedTitle(B, 'Other');
    store.adoptPersistedTitle(A, 'Pushed');
    expect(session.summary()).toBe('Pushed');
  });

  it('a list that arrives mid-rename does not overwrite the local title', async () => {
    const { store, session, connection } = fakeStore();
    let release: (() => void) | undefined;
    connection.renameSession = () =>
      new Promise((resolve) => {
        release = () => resolve({ type: 'rename_session_response', skipped: false });
      });
    const renaming = store.renameSession(A, 'New title');
    // Let the clock move past lastLocalRenameAt, so only renamesInFlight can
    // still protect the local title.
    await new Promise((r) => setTimeout(r, 5));
    connection.listSessions = async () => ({
      type: 'list_sessions_response',
      sessions: [{ id: A, lastModified: 2, summary: 'Old title', customTitle: 'Old title', isCurrentWorkspace: true }],
    });
    await store.listSessions();
    expect(session.summary()).toBe('New title');
    release?.();
    await renaming;
  });

  it('a later list adopts a customTitle the host wrote, and leaves a row without one alone', async () => {
    const { store, session, connection } = fakeStore();
    connection.listSessions = async () => ({
      type: 'list_sessions_response',
      sessions: [{ id: A, lastModified: 2, summary: 'From disk', customTitle: 'From disk', isCurrentWorkspace: true }],
    });
    await store.listSessions();
    expect(session.summary()).toBe('From disk');
    expect(session.hasPersistedTitle()).toBe(true);

    connection.listSessions = async () => ({
      type: 'list_sessions_response',
      sessions: [{ id: A, lastModified: 3, summary: 'auto summary', isCurrentWorkspace: true }],
    });
    await store.listSessions();
    expect(session.summary()).toBe('From disk');
  });

  it('Session.fromServer carries the SDK fields the list now sends', () => {
    const session = Session.fromServer(
      {
        id: A,
        lastModified: 7,
        summary: 'Titled',
        customTitle: 'Titled',
        gitBranch: 'feature/x',
        fileSize: 12,
        tag: 'release',
        firstPrompt: 'first',
        createdAt: 3,
        archived: true,
        worktree: { name: 'feat', path: '/repo/.claude/worktrees/feat' },
        isCurrentWorkspace: true,
      },
      async () => ({}) as any,
      sessionContext
    );
    expect(session.hasPersistedTitle()).toBe(true);
    expect(session.gitBranch()).toBe('feature/x');
    expect(session.fileSize()).toBe(12);
    expect(session.tag()).toBe('release');
    expect(session.firstPrompt()).toBe('first');
    expect(session.createdAt()).toBe(3);
    expect(session.archived()).toBe(true);
    expect(session.cwd()).toBe('/repo/.claude/worktrees/feat');
  });
});
