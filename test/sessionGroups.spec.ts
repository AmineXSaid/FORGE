/**
 * Production audit, Phase 6, item 3: session groups, the list's section
 * collapse state, and the session manager's collapsed panel sections.
 *
 * Shared: `src/shared/sessionGroups.ts` (the official `VG`/`ns$`, `tY`, `M7$`,
 * `O7$`, `ye`/`Lf$`/`Df$`, and the webview's `vC`, `T_1`, `L_1`, `E_1`, `DP0`,
 * `b_1`, `k_1`, `h_1`/`jP0`, `J51`).
 * Host: `sessionGroupStore.ts`, the five handlers, the unarchive prune, the
 * dispatcher cases.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SECTION_COLLAPSE_STATE,
  MAX_GROUPED_SESSIONS,
  MAX_SESSION_GROUPS,
  actedOn,
  applyPanelSectionToggle,
  changedSectionCollapseState,
  createGroup,
  deleteGroup,
  extendSelection,
  hideFilteredGroups,
  moveSessions,
  moveToGroup,
  normalizeSessionGroups,
  panelSectionToggle,
  partitionByGroup,
  readCollapsedPanelSections,
  readSectionCollapseState,
  renameGroup,
  sameTarget,
  sectionCollapsePatch,
  setGroupCollapsed,
  splitLiveArchived,
  truncateGroupName,
  withoutSessions,
  type SessionGroup,
} from '../src/shared/sessionGroups';
import {
  COLLAPSED_PANEL_SECTIONS_KEY,
  SessionGroupStore,
  sessionGroupsKey,
  sessionSectionCollapseStateKey,
} from '../src/services/claude/sessionGroupStore';
import { ArchivedSessionStore } from '../src/services/claude/archivedSessions';
import {
  handleGetCollapsedPanelSections,
  handleGetSessionGroups,
  handleUnarchiveSession,
  handleUpdateCollapsedPanelSections,
  handleUpdateSessionGroups,
  handleUpdateSessionSectionCollapseState,
} from '../src/services/claude/handlers/handlers';
import { ClaudeAgentService } from '../src/services/claude/ClaudeAgentService';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const C = 'cccccccc-0000-4000-8000-000000000003';
const ROOT = 'C:/w';

const group = (id: string, sessionIds: string[] = [], extra: Partial<SessionGroup> = {}): SessionGroup => ({
  id,
  name: id.toUpperCase(),
  collapsed: false,
  sessionIds,
  ...extra,
});

// ---------------------------------------------------------------------------
// Shared: the schema (`VG` / `ns$`)
// ---------------------------------------------------------------------------

describe('normalizeSessionGroups (VG / ns$)', () => {
  it('keeps a valid list as it is', () => {
    const groups = [group('g1', [A]), group('g2', [B], { collapsed: true })];
    expect(normalizeSessionGroups(groups)).toEqual(groups);
  });

  it('anything but an array is no groups', () => {
    for (const value of [undefined, null, 'x', 42, { id: 'g' }, true]) {
      expect(normalizeSessionGroups(value)).toEqual([]);
    }
  });

  it('drops groups that fail the schema, and repeated ids (first wins)', () => {
    expect(
      normalizeSessionGroups([
        null,
        'g',
        [],
        { name: 'no id' },
        { id: '', name: 'empty id' },
        { id: 'x'.repeat(201), name: 'long id' },
        { id: 'g1', name: '   ' },
        { id: 'g1', name: 42 },
        { id: 'g1', name: 'First' },
        { id: 'g1', name: 'Second' },
      ])
    ).toEqual([{ id: 'g1', name: 'First', collapsed: false, sessionIds: [] }]);
  });

  it('trims names to 100 code points, defaults collapsed and sessionIds, strips extra keys', () => {
    const emoji = '😀'.repeat(150);
    const [g] = normalizeSessionGroups([{ id: 'g', name: `  ${emoji}  `, collapsed: 'yes', sessionIds: 'nope', evil: '<script>' }]);
    expect(g).toEqual({ id: 'g', name: '😀'.repeat(100), collapsed: false, sessionIds: [] });
    expect(truncateGroupName('😀'.repeat(101))).toBe('😀'.repeat(100));
  });

  it('keeps each session id once, across groups, valid ones only, up to 1000', () => {
    expect(
      normalizeSessionGroups([
        { id: 'g1', name: 'a', sessionIds: [A, A, '', 42, 'x'.repeat(201), B] },
        { id: 'g2', name: 'b', sessionIds: [B, C] },
      ])
    ).toEqual([
      { id: 'g1', name: 'a', collapsed: false, sessionIds: [A, B] },
      { id: 'g2', name: 'b', collapsed: false, sessionIds: [C] },
    ]);
    const many = Array.from({ length: 1200 }, (_, i) => `s${i}`);
    const out = normalizeSessionGroups([{ id: 'g', name: 'g', sessionIds: many }]);
    expect(out[0].sessionIds).toHaveLength(MAX_GROUPED_SESSIONS);
  });

  it('keeps at most 100 groups', () => {
    const many = Array.from({ length: 130 }, (_, i) => ({ id: `g${i}`, name: `G${i}` }));
    expect(normalizeSessionGroups(many)).toHaveLength(MAX_SESSION_GROUPS);
  });
});

describe('withoutSessions (tY / $T)', () => {
  it('drops the ids, or answers null when none was grouped', () => {
    const groups = [group('g1', [A, B]), group('g2', [C])];
    expect(withoutSessions(groups, [B])).toEqual([group('g1', [A]), group('g2', [C])]);
    expect(withoutSessions(groups, new Set(['zzz']))).toBeNull();
    expect(withoutSessions(groups, [])).toBeNull();
  });
});

describe('the section collapse state (O7$, M7$, o01)', () => {
  it('defaults each key on its own: Ungrouped open, Archived closed', () => {
    expect(readSectionCollapseState(undefined)).toEqual({ ungroupedCollapsed: false, archivedCollapsed: true });
    expect(readSectionCollapseState({ ungroupedCollapsed: true, archivedCollapsed: 'x' })).toEqual({
      ungroupedCollapsed: true,
      archivedCollapsed: true,
    });
    expect(DEFAULT_SECTION_COLLAPSE_STATE).toEqual({ ungroupedCollapsed: false, archivedCollapsed: true });
  });

  it('a patch keeps only the boolean keys', () => {
    expect(sectionCollapsePatch({ ungroupedCollapsed: true, archivedCollapsed: 0, other: true })).toEqual({ ungroupedCollapsed: true });
    expect(sectionCollapsePatch(null)).toEqual({});
    expect(sectionCollapsePatch('x')).toEqual({});
  });

  it('o01: null when the patch changes nothing', () => {
    const state = { ungroupedCollapsed: false, archivedCollapsed: true };
    expect(changedSectionCollapseState(state, { archivedCollapsed: true })).toBeNull();
    expect(changedSectionCollapseState(state, { archivedCollapsed: false })).toEqual({ ungroupedCollapsed: false, archivedCollapsed: false });
  });
});

describe('the panel sections (hA0, ye, Lf$, Df$)', () => {
  it('reads known sections once each', () => {
    expect(readCollapsedPanelSections(['sessions', 'usage', 'sessions', 'nope', 3])).toEqual(['sessions', 'usage']);
    expect(readCollapsedPanelSections('sessions')).toEqual([]);
  });

  it('a toggle must name usage or sessions, with a boolean', () => {
    expect(panelSectionToggle({ section: 'sessions', collapsed: true })).toEqual({ section: 'sessions', collapsed: true });
    for (const bad of [null, {}, { section: 'history', collapsed: true }, { section: 'sessions', collapsed: 'yes' }, 'sessions']) {
      expect(panelSectionToggle(bad)).toBeNull();
    }
  });

  it('applies a toggle without duplicating', () => {
    expect(applyPanelSectionToggle([], { section: 'sessions', collapsed: true })).toEqual(['sessions']);
    expect(applyPanelSectionToggle(['sessions'], { section: 'sessions', collapsed: true })).toEqual(['sessions']);
    expect(applyPanelSectionToggle(['usage', 'sessions'], { section: 'sessions', collapsed: false })).toEqual(['usage']);
  });
});

// ---------------------------------------------------------------------------
// Shared: the webview's edits
// ---------------------------------------------------------------------------

describe('group edits (vC, T_1, L_1, E_1, DP0, Z51)', () => {
  it('vC: a new group at the end, taking its sessions out of the others', () => {
    const groups = [group('g1', [A, B])];
    const { groups: next, groupId } = createGroup(groups, '  Mine  ', [B, B], () => 'new');
    expect(groupId).toBe('new');
    expect(next).toEqual([group('g1', [A]), { id: 'new', name: 'Mine', collapsed: false, sessionIds: [B] }]);
    expect(createGroup([], '   ', [], () => 'n').groups[0].name).toBe('New group');
  });

  it('vC refuses at 100 groups and over 1000 grouped sessions', () => {
    const full = Array.from({ length: 100 }, (_, i) => group(`g${i}`));
    expect(createGroup(full, 'x', [], () => 'n')).toEqual({ groups: full, groupId: '' });
    const heavy = [group('g', Array.from({ length: 1000 }, (_, i) => `s${i}`))];
    expect(createGroup(heavy, 'x', [A], () => 'n').groupId).toBe('');
  });

  it('T_1 / L_1 / E_1', () => {
    const groups = [group('g1'), group('g2')];
    expect(deleteGroup(groups, 'g1')).toEqual([group('g2')]);
    expect(renameGroup(groups, 'g1', '  New name ')[0].name).toBe('New name');
    expect(renameGroup(groups, 'g1', '   ')).toBe(groups);
    expect(renameGroup(groups, 'g1', 'G1')).toBe(groups);
    expect(renameGroup(groups, 'nope', 'x')).toBe(groups);
    expect(setGroupCollapsed(groups, 'g2', true)[1].collapsed).toBe(true);
  });

  it('DP0: into one group, out of the others; unchanged returns the same array', () => {
    const groups = [group('g1', [A]), group('g2', [B])];
    expect(moveToGroup(groups, 'g2', [A, C])).toEqual([group('g1', []), group('g2', [B, A, C])]);
    expect(moveToGroup(groups, 'g2', [B])).toBe(groups);
    expect(moveToGroup(groups, 'nope', [A])).toBe(groups);
    expect(moveSessions(groups, { kind: 'ungrouped' }, [A])).toEqual([group('g1', []), group('g2', [B])]);
    expect(moveSessions(groups, { kind: 'ungrouped' }, [C])).toBe(groups);
    expect(sameTarget({ kind: 'group', groupId: 'g1' }, { kind: 'group', groupId: 'g1' })).toBe(true);
    expect(sameTarget({ kind: 'group', groupId: 'g1' }, { kind: 'ungrouped' })).toBe(false);
  });
});

describe('partition, filter, selection (b_1, k_1, h_1, J51, y_1)', () => {
  type Row = { id: string; archived?: boolean };
  const key = (r: Row) => r.id;
  const archived = (r: Row) => !!r.archived;

  it('b_1: rows into their groups in group order, the rest ungrouped, archived apart', () => {
    const rows: Row[] = [{ id: A }, { id: B }, { id: C, archived: true }];
    const out = partitionByGroup([group('g1', [B, C])], rows, key, archived);
    expect(out.grouped).toEqual([{ group: group('g1', [B, C]), items: [{ id: B }] }]);
    expect(out.ungrouped).toEqual([{ id: A }]);
    expect(out.archived).toEqual([{ id: C, archived: true }]);
  });

  it('k_1: a filter hides the groups it emptied, not a new empty group or the one being renamed', () => {
    const groups = [group('full', [A]), group('fresh', []), group('renaming', [B])];
    const partition = partitionByGroup(groups, [], key);
    const all: Row[] = [{ id: A }, { id: B }];
    expect(hideFilteredGroups(partition, all, key, 'renaming').grouped.map((g) => g.group.id)).toEqual(['fresh', 'renaming']);
  });

  it('h_1: toggle and range selection within one section', () => {
    const order = [A, B, C];
    expect(extendSelection(order, new Set(), new Set([A]), A, C, 'range')).toEqual({ selected: new Set([A, B, C]), anchorKey: A });
    expect(extendSelection(order, new Set(), new Set([A]), A, B, 'toggle')).toEqual({ selected: new Set([A, B]), anchorKey: B });
    expect(extendSelection(order, new Set(), new Set([A, B]), A, B, 'toggle')).toEqual({ selected: new Set([A]), anchorKey: B });
    // A toggle while the selection holds a row of the other section starts over.
    expect(extendSelection(order, new Set(['arch']), new Set(['arch']), 'arch', A, 'toggle')).toEqual({ selected: new Set([A]), anchorKey: A });
    expect(extendSelection(order, new Set(), new Set(), null, B, 'range')).toEqual({ selected: new Set([B]), anchorKey: B });
  });

  it('J51: the selection if the row is in it, else the row', () => {
    expect(actedOn(new Set([A, C]), [A, B, C], C)).toEqual([A, C]);
    expect(actedOn(new Set([A, C]), [A, B, C], B)).toEqual([B]);
  });

  it('y_1: keys present both live and archived belong to neither', () => {
    const rows: Row[] = [{ id: A }, { id: B, archived: true }, { id: C }, { id: C, archived: true }];
    expect(splitLiveArchived(rows, key, archived)).toEqual({ liveOnly: new Set([A]), archivedOnly: new Set([B]) });
  });
});

// ---------------------------------------------------------------------------
// Host: the store
// ---------------------------------------------------------------------------

function memento(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    data,
    get: <T,>(k: string) => data.get(k) as T | undefined,
    update: async (k: string, value: unknown) => {
      data.set(k, value);
    },
  };
}

describe('SessionGroupStore', () => {
  it('uses the official keys: per scope root for groups and sections, global for panels', () => {
    expect(sessionGroupsKey('C:/repo/.claude/worktrees/feature')).toBe('sessionGroups:C:/repo');
    expect(sessionSectionCollapseStateKey(ROOT)).toBe(`sessionSectionCollapseState:${ROOT}`);
    expect(COLLAPSED_PANEL_SECTIONS_KEY).toBe('collapsedPanelSections');
  });

  it('reads through the normalisers and writes what it is given', async () => {
    const m = memento({ [sessionGroupsKey(ROOT)]: [{ id: 'g', name: ' G ', sessionIds: [A, A] }, 'junk'] });
    const store = new SessionGroupStore(m, () => ROOT);
    expect(store.getSessionGroups()).toEqual([{ id: 'g', name: 'G', collapsed: false, sessionIds: [A] }]);
    expect(store.getSessionSectionCollapseState()).toEqual(DEFAULT_SECTION_COLLAPSE_STATE);
    await store.setCollapsedPanelSections(['sessions', 'sessions', 'bogus' as any]);
    expect(m.data.get(COLLAPSED_PANEL_SECTIONS_KEY)).toEqual(['sessions']);
    expect(store.getCollapsedPanelSections()).toEqual(['sessions']);
  });
});

// ---------------------------------------------------------------------------
// Host: the handlers
// ---------------------------------------------------------------------------

function handlerContext(initial: Record<string, unknown> = {}) {
  const m = memento(initial);
  const groups = new SessionGroupStore(m, () => ROOT);
  const archived = new ArchivedSessionStore(m, () => 1_000_000);
  const context = {
    logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
    sdkService: { getSessionGroupStore: () => groups, getArchivedSessionStore: () => archived },
  } as any;
  return { context, m };
}

const GROUPS_KEY = sessionGroupsKey(ROOT);
const SECTIONS_KEY = sessionSectionCollapseStateKey(ROOT);

describe('handleGetSessionGroups / handleUpdateSessionGroups', () => {
  it('answers the groups (archived ids left out) and the section state', async () => {
    const { context } = handlerContext({
      [GROUPS_KEY]: [group('g1', [A, B])],
      hiddenSessionIds: [B],
      [SECTIONS_KEY]: { ungroupedCollapsed: true },
    });
    expect(await handleGetSessionGroups({ type: 'get_session_groups' }, context)).toEqual({
      type: 'get_session_groups_response',
      groups: [group('g1', [A])],
      sectionCollapseState: { ungroupedCollapsed: true, archivedCollapsed: true },
    });
  });

  it('stores the normalised list, without archived ids', async () => {
    const { context, m } = handlerContext({ hiddenSessionIds: [C] });
    expect(
      await handleUpdateSessionGroups(
        { type: 'update_session_groups', groups: [{ id: 'g', name: ' G ', sessionIds: [A, C, A], extra: 1 }, { id: 'g', name: 'dup' }] as any },
        context
      )
    ).toEqual({ type: 'update_session_groups_response' });
    expect(m.data.get(GROUPS_KEY)).toEqual([{ id: 'g', name: 'G', collapsed: false, sessionIds: [A] }]);
  });

  it('rejections: a non-array, junk rows, or a missing field store no groups', async () => {
    for (const groups of [undefined, null, 'g', { id: 'g', name: 'G' }, [{ id: 42, name: 'x' }], [{ id: '../x' }]]) {
      const { context, m } = handlerContext({ [GROUPS_KEY]: [group('keep', [A])] });
      await handleUpdateSessionGroups({ type: 'update_session_groups', groups } as any, context);
      expect(m.data.get(GROUPS_KEY)).toEqual([]);
    }
  });
});

describe('handleUpdateSessionSectionCollapseState', () => {
  it('merges a boolean patch into the stored state', async () => {
    const { context, m } = handlerContext({ [SECTIONS_KEY]: { ungroupedCollapsed: true, archivedCollapsed: true } });
    await handleUpdateSessionSectionCollapseState({ type: 'update_session_section_collapse_state', patch: { archivedCollapsed: false } }, context);
    expect(m.data.get(SECTIONS_KEY)).toEqual({ ungroupedCollapsed: true, archivedCollapsed: false });
  });

  it('rejections: no boolean key writes nothing', async () => {
    for (const patch of [undefined, null, 'x', {}, { archivedCollapsed: 'no' }, { other: true }]) {
      const { context, m } = handlerContext();
      expect(
        await handleUpdateSessionSectionCollapseState({ type: 'update_session_section_collapse_state', patch } as any, context)
      ).toEqual({ type: 'update_session_section_collapse_state_response' });
      expect(m.data.has(SECTIONS_KEY)).toBe(false);
    }
  });
});

describe('the collapsed panel sections', () => {
  it('reads and toggles "sessions"', async () => {
    const { context, m } = handlerContext();
    expect(await handleGetCollapsedPanelSections({ type: 'get_collapsed_panel_sections' }, context)).toEqual({
      type: 'get_collapsed_panel_sections_response',
      sections: [],
    });
    await handleUpdateCollapsedPanelSections({ type: 'update_collapsed_panel_sections', toggle: { section: 'sessions', collapsed: true } }, context);
    expect(m.data.get(COLLAPSED_PANEL_SECTIONS_KEY)).toEqual(['sessions']);
    await handleUpdateCollapsedPanelSections({ type: 'update_collapsed_panel_sections', toggle: { section: 'sessions', collapsed: false } }, context);
    expect(m.data.get(COLLAPSED_PANEL_SECTIONS_KEY)).toEqual([]);
  });

  it('rejections: an unknown section or a non-boolean writes nothing', async () => {
    for (const toggle of [undefined, null, {}, { section: 'history', collapsed: true }, { section: '__proto__', collapsed: true }, { section: 'sessions', collapsed: 1 }]) {
      const { context, m } = handlerContext();
      expect(
        await handleUpdateCollapsedPanelSections({ type: 'update_collapsed_panel_sections', toggle } as any, context)
      ).toEqual({ type: 'update_collapsed_panel_sections_response' });
      expect(m.data.has(COLLAPSED_PANEL_SECTIONS_KEY)).toBe(false);
    }
  });
});

describe('handleUnarchiveSession prunes the id out of the groups', () => {
  it('as the official does after `unarchiveSession`', async () => {
    const { context, m } = handlerContext({ hiddenSessionIds: [A], [GROUPS_KEY]: [group('g1', [A, B])] });
    await handleUnarchiveSession({ type: 'unarchive_session', sessionId: A }, context);
    expect(m.data.get('hiddenSessionIds')).toEqual([]);
    expect(m.data.get(GROUPS_KEY)).toEqual([group('g1', [B])]);
  });

  it('a bad id touches nothing', async () => {
    const { context, m } = handlerContext({ [GROUPS_KEY]: [group('g1', [A])] });
    await handleUnarchiveSession({ type: 'unarchive_session', sessionId: '../../etc' }, context);
    expect(m.data.get(GROUPS_KEY)).toEqual([group('g1', [A])]);
  });
});

describe('the dispatcher cases', () => {
  const svc = (context: any) => {
    const s = new (ClaudeAgentService as any)(context.logService, {}, {}, {}, {}, {}, {}, context.sdkService, {}, {});
    s.handlerContext = context;
    return s;
  };
  const ask = (s: any, request: unknown) =>
    s.processRequest({ type: 'request', requestId: 'r', request }, undefined as any);

  it('routes all five requests', async () => {
    const { context, m } = handlerContext();
    const s = svc(context);
    expect((await ask(s, { type: 'get_session_groups' })).type).toBe('get_session_groups_response');
    expect((await ask(s, { type: 'update_session_groups', groups: [group('g')] })).type).toBe('update_session_groups_response');
    expect(m.data.get(GROUPS_KEY)).toEqual([group('g')]);
    expect((await ask(s, { type: 'update_session_section_collapse_state', patch: { ungroupedCollapsed: true } })).type).toBe(
      'update_session_section_collapse_state_response'
    );
    expect((await ask(s, { type: 'get_collapsed_panel_sections' })).type).toBe('get_collapsed_panel_sections_response');
    expect((await ask(s, { type: 'update_collapsed_panel_sections', toggle: { section: 'sessions', collapsed: true } })).type).toBe(
      'update_collapsed_panel_sections_response'
    );
    expect(m.data.get(COLLAPSED_PANEL_SECTIONS_KEY)).toEqual(['sessions']);
  });
});

// ---------------------------------------------------------------------------
// Host: "Start new session in this group" (assignPendingGroup)
// ---------------------------------------------------------------------------

describe('the pending group: a new conversation joins the group it was started in', () => {
  function service(initial: Record<string, unknown> = {}) {
    const { context, m } = handlerContext(initial);
    const s = new (ClaudeAgentService as any)(context.logService, {}, {}, {}, {}, {}, {}, context.sdkService, {}, {});
    s.handlerContext = context;
    const pushed: any[] = [];
    s.notifyClient = (r: any) => pushed.push(r);
    s.sendSessionStates = () => {};
    return { s, m, pushed };
  }
  const init = (id: string) => ({ type: 'system', subtype: 'init', session_id: id });

  it('the first fresh session to be named joins, then the host says so', async () => {
    const { s, m, pushed } = service({ [GROUPS_KEY]: [group('g1', [B])] });
    s.channels = new Map([['c1', {}]]);
    s.setPendingGroup('g1');
    s.noteChannelSessionId('c1', init(A));
    await new Promise((r) => setTimeout(r, 0));
    expect(m.data.get(GROUPS_KEY)).toEqual([group('g1', [B, A])]);
    expect(pushed).toEqual([{ type: 'session_groups_changed' }]);
    // Once only.
    s.channels.set('c2', {});
    s.noteChannelSessionId('c2', init(C));
    await new Promise((r) => setTimeout(r, 0));
    expect(m.data.get(GROUPS_KEY)).toEqual([group('g1', [B, A])]);
  });

  it('a resumed channel (its id known at launch) does not take the group', async () => {
    const { s, m, pushed } = service({ [GROUPS_KEY]: [group('g1')] });
    s.channels = new Map([['c1', { sessionId: A }]]);
    s.setPendingGroup('g1');
    s.noteChannelSessionId('c1', init(B)); // a fork names a new id
    await new Promise((r) => setTimeout(r, 0));
    expect(m.data.get(GROUPS_KEY)).toEqual([group('g1')]);
    expect(pushed).toEqual([]);
  });

  it('a cleared or deleted group assigns nothing', async () => {
    const { s, m, pushed } = service({ [GROUPS_KEY]: [group('g1')] });
    s.channels = new Map([['c1', {}], ['c2', {}]]);
    s.setPendingGroup('g1');
    s.setPendingGroup(undefined);
    s.noteChannelSessionId('c1', init(A));
    s.setPendingGroup('gone');
    s.noteChannelSessionId('c2', init(B));
    await new Promise((r) => setTimeout(r, 0));
    expect(m.data.get(GROUPS_KEY)).toEqual([group('g1')]);
    expect(pushed).toEqual([]);
  });
});

describe('reveal_chat with a groupId', () => {
  it('sets the pending group only for a new conversation into a stored group; a bad id is refused', async () => {
    const { handleRevealChat } = await import('../src/services/claude/handlers/handlers');
    const vscode = await import('vscode');
    (vscode.commands as any).executeCommand = vi.fn(async () => undefined);
    const { context } = handlerContext({ [GROUPS_KEY]: [group('g1')] });
    const pending: Array<string | undefined> = [];
    context.agentService = { notifyClient: vi.fn(), setPendingGroup: (g: string | undefined) => pending.push(g) };
    await handleRevealChat({ type: 'reveal_chat', newConversation: true, groupId: 'g1' }, context);
    await handleRevealChat({ type: 'reveal_chat', newConversation: true, groupId: 'nope' }, context);
    await handleRevealChat({ type: 'reveal_chat', newConversation: false, groupId: 'g1' }, context);
    await handleRevealChat({ type: 'reveal_chat', newConversation: true }, context);
    expect(pending).toEqual(['g1', undefined, undefined, undefined]);
    for (const groupId of ['', 'x'.repeat(201), 42]) {
      await expect(handleRevealChat({ type: 'reveal_chat', newConversation: true, groupId } as any, context)).rejects.toThrow(/groupId/);
    }
  });
});

// ---------------------------------------------------------------------------
// Webview: the transport, the store, the menus
// ---------------------------------------------------------------------------

import { BaseTransport } from '../src/webview/src/transport/BaseTransport';
import { EventEmitter } from '../src/webview/src/utils/events';
import { SessionStore } from '../src/webview/src/core/SessionStore';
import { signal } from 'alien-signals';
import {
  archivedRowMenuItems,
  emptyStatusFilter,
  filterCounts,
  filterIsOn,
  groupMenuItems,
  menuLeft,
  passesFilter,
  rowMenuItems,
  sectionsOf,
  statusFilterItems,
  submenuLeft,
  toggleStatus,
  toggleTabState,
} from '../src/webview/src/core/sessionListMenus';

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
  it('sends the official payloads', () => {
    const t = new TestTransport(new EventEmitter(), new EventEmitter());
    void t.getSessionGroups();
    void t.updateSessionGroups([group('g', [A])]);
    void t.updateSessionSectionCollapseState({ archivedCollapsed: false });
    void t.getCollapsedPanelSections();
    void t.updateCollapsedPanelSections({ section: 'sessions', collapsed: true });
    void t.revealChat({ newConversation: true, groupId: 'g' });
    expect(t.sent.map((m) => m.request)).toEqual([
      { type: 'get_session_groups' },
      { type: 'update_session_groups', groups: [group('g', [A])] },
      { type: 'update_session_section_collapse_state', patch: { archivedCollapsed: false } },
      { type: 'get_collapsed_panel_sections' },
      { type: 'update_collapsed_panel_sections', toggle: { section: 'sessions', collapsed: true } },
      { type: 'reveal_chat', newConversation: true, groupId: 'g' },
    ]);
  });

  it('session_groups_changed bumps sessionGroupsVersion, and answers nothing', async () => {
    const t = new TestTransport(new EventEmitter(), new EventEmitter());
    expect(t.sessionGroupsVersion()).toBe(0);
    t.feed({ type: 'request', requestId: 'p', request: { type: 'session_groups_changed' } });
    await tick();
    expect(t.sessionGroupsVersion()).toBe(1);
    expect(t.sent).toEqual([]);
  });
});

function storeWith(connection: any) {
  const context = { currentSelection: signal(undefined), commandRegistry: { registerAction: () => {} }, fileOpener: {}, renameTab: () => {} } as any;
  const store = new SessionStore({ state: () => 'connected', connection: () => undefined } as any, context);
  (store as any).getConnection = async () => connection;
  return store;
}

describe('webview: SessionStore groups', () => {
  it('listSessionGroups adopts the groups and the section state', async () => {
    const store = storeWith({
      getSessionGroups: async () => ({ groups: [group('g', [A]), { junk: 1 }], sectionCollapseState: { ungroupedCollapsed: true } }),
    });
    expect(store.sessionGroupsLoaded()).toBe(false);
    await store.listSessionGroups();
    expect(store.sessionGroups()).toEqual([group('g', [A])]);
    expect(store.sessionGroupsLoaded()).toBe(true);
    expect(store.sessionSectionCollapseState()).toEqual({ ungroupedCollapsed: true, archivedCollapsed: true });
  });

  it('a read that started before a local write does not put the old groups back (unless forced)', async () => {
    let answer!: (v: any) => void;
    const store = storeWith({
      getSessionGroups: () => new Promise((r) => (answer = r)),
      updateSessionGroups: async () => ({}),
    });
    const reading = store.listSessionGroups();
    await tick();
    await store.updateSessionGroups([group('mine')]);
    answer({ groups: [group('stale')], sectionCollapseState: {} });
    await reading;
    expect(store.sessionGroups()).toEqual([group('mine')]);
    store.sessionGroups([]);
    const forced = store.listSessionGroups({ forceAdopt: true });
    await tick();
    answer({ groups: [group('host')], sectionCollapseState: {} });
    await forced;
    expect(store.sessionGroups()).toEqual([group('host')]);
  });

  it('updateSessionGroups normalises, shows at once, and re-reads when the write fails', async () => {
    const reads = vi.fn(async () => ({ groups: [group('host')], sectionCollapseState: {} }));
    const store = storeWith({ updateSessionGroups: async () => { throw new Error('no'); }, getSessionGroups: reads });
    const writing = store.updateSessionGroups([{ id: 'g', name: ' G ', sessionIds: [A, A] } as any]);
    expect(store.sessionGroups()).toEqual([{ id: 'g', name: 'G', collapsed: false, sessionIds: [A] }]);
    await writing;
    await tick();
    expect(reads).toHaveBeenCalled();
  });

  it('the section state and the panel sections write through, dropping bad keys', async () => {
    const sent: any[] = [];
    const store = storeWith({
      updateSessionSectionCollapseState: async (p: any) => sent.push(['sections', p]),
      updateCollapsedPanelSections: async (t: any) => sent.push(['panels', t]),
    });
    await store.updateSessionSectionCollapseState({ archivedCollapsed: false, bogus: 1 } as any);
    await store.updateSessionSectionCollapseState({} as any);
    await store.setPanelSectionCollapsed('sessions', true);
    expect(store.sessionSectionCollapseState()).toEqual({ ungroupedCollapsed: false, archivedCollapsed: false });
    expect(store.collapsedPanelSections()).toEqual(['sessions']);
    expect(sent).toEqual([
      ['sections', { archivedCollapsed: false }],
      ['panels', { section: 'sessions', collapsed: true }],
    ]);
  });

  it('the page seed shows the stored panels before any read', () => {
    const store = storeWith({});
    store.seedCollapsedPanelSections(['sessions', 'nope']);
    expect(store.collapsedPanelSections()).toEqual(['sessions']);
    store.seedCollapsedPanelSections(undefined);
    expect(store.collapsedPanelSections()).toEqual(['sessions']);
  });
});

describe('webview: the menus (mH0, cH0, _W0, eH0, n85)', () => {
  const noop = () => {};
  const actions = { resumeSession: noop, createGroupFromSelection: noop, moveSelectionToGroup: noop, removeSelectionFromGroups: noop };

  it('mH0: one ungrouped row', () => {
    const items = rowMenuItems([A], [group('g1')], { ...actions, setSelectionUnread: noop, archiveSelection: noop }, { selectionIsUnread: false });
    expect(items.map((i) => [i.label, !!i.separatorBefore, i.submenu?.map((s) => s.label)])).toEqual([
      ['Resume session', false, undefined],
      ['New group from session', true, undefined],
      ['Add to group', false, ['G1']],
      ['Mark as unread', true, undefined],
      ['Archive session', true, undefined],
    ]);
  });

  it('mH0: several grouped rows, open and unread', () => {
    const items = rowMenuItems([A, B], [group('g1', [A, B]), group('g2')], { ...actions, setSelectionUnread: noop, archiveSelection: noop }, { sessionIsOpen: true, selectionIsUnread: true });
    expect(items.map((i) => i.label)).toEqual([
      'New group from 2 sessions',
      'Add to group',
      'Remove from group',
      'Mark as read',
      'Archive 2 sessions',
    ]);
    expect(items[1].submenu!.map((s) => s.label)).toEqual(['G2']);
    expect(rowMenuItems([A], [], actions, { sessionIsOpen: true })[0].label).toBe('Switch to session');
  });

  it('cH0 and the group menu', () => {
    expect(archivedRowMenuItems([A], { resumeSession: noop, unarchiveSelection: noop }).map((i) => i.label)).toEqual(['Resume session', 'Unarchive session']);
    expect(archivedRowMenuItems([A, B], { resumeSession: noop, unarchiveSelection: noop }).map((i) => i.label)).toEqual(['Unarchive 2 sessions']);
    expect(groupMenuItems({ startSessionInGroup: noop, newGroup: noop, renameGroup: noop, deleteGroup: noop }).map((i) => [i.label, !!i.separatorBefore])).toEqual([
      ['Start new session in this group', false],
      ['New group', true],
      ['Rename group', false],
      ['Delete group', true],
    ]);
    expect(groupMenuItems({ newGroup: noop, renameGroup: noop, deleteGroup: noop })[0]).toMatchObject({ label: 'New group', separatorBefore: false });
  });

  it('the status filter: counts, rows, headings only with Tabs, and the row test', () => {
    const counts = filterCounts([
      { openState: 'running', isOpen: true },
      { openState: 'waiting', isOpen: false },
      { openState: 'idle', isOpen: false },
      { openState: 'unread', isOpen: false },
      { openState: undefined, isOpen: false },
    ]);
    expect(counts).toEqual({ active: 3, byStatus: { needs_input: 1, working: 1, completed: 3 }, byTabState: { open: 1, closed: 4 } });
    const filter = toggleStatus(emptyStatusFilter(), 'working');
    const plain = statusFilterItems(counts, filter, noop);
    expect(plain.map((i) => [i.label, i.selected, i.keepOpen, i.heading])).toEqual([
      ['Needs input · 1', false, true, undefined],
      ['Working · 1', true, true, undefined],
      ['Completed · 3', false, true, undefined],
    ]);
    const withTabs = statusFilterItems(counts, filter, noop, noop);
    expect(withTabs.map((i) => i.heading)).toEqual(['Status', undefined, undefined, 'Tabs', undefined]);
    expect(sectionsOf(withTabs).map((s) => [s.heading, s.entries.length])).toEqual([['Status', 3], ['Tabs', 2]]);
    expect(filterIsOn(emptyStatusFilter())).toBe(false);
    expect(passesFilter(filter, 'running', false, false)).toBe(true);
    expect(passesFilter(filter, 'idle', false, false)).toBe(false);
    const active = { ...emptyStatusFilter(), activeOnly: true };
    expect(passesFilter(active, 'idle', false, false)).toBe(false);
    expect(passesFilter(active, 'idle', true, false)).toBe(true); // the open conversation always shows
    expect(passesFilter(toggleTabState(emptyStatusFilter(), 'open'), 'idle', false, false)).toBe(false);
  });

  it('t85 / o85: the menu stays 8px inside and leaves room for a submenu', () => {
    expect(menuLeft(990, 200, 1000, false)).toBe(792);
    expect(menuLeft(-5, 200, 1000, false)).toBe(8);
    expect(submenuLeft({ left: 100, right: 300 }, 150, 1000)).toBe(298);
    expect(submenuLeft({ left: 700, right: 900 }, 150, 1000)).toBe(552);
  });
});
