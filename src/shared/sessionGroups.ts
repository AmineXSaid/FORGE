/**
 * Session groups, the sessions list's collapse state, and the session
 * manager's collapsed panel sections: the rules both sides share.
 *
 * Ported from the official host (`extension.js`) and webview (`index.js`),
 * which carry the same code twice (the host validates what the webview sends,
 * the webview normalises what the host answers). Forge keeps one copy here,
 * free of `vscode` and of Vue, so the host, the webview and the specs run the
 * same functions.
 *
 * Host, with its limits (`ps$=100, D7$=100, cs$=200, _g=1000`):
 *
 *   is$ = z.object({ id: bJ(),                                  // 1..200 chars
 *                    name: z.string().transform(s => F7$(s.trim())).pipe(z.string().min(1)),
 *                    collapsed: z.boolean().catch(false),
 *                    sessionIds: z.array(z.unknown()).default(() => []).catch(() => []) })
 *   function ns$(groups){ … at most D7$ groups, first id wins, each session id
 *                         a bJ() string, unique across all groups, at most _g }
 *   VG($) = as$().safeParse($).success ? data : []                 // not an array: []
 *   tY(groups, archived)  // drop archived ids; null when nothing changed
 *   M7$(patch)            // keep only the boolean ungroupedCollapsed / archivedCollapsed
 *   O7$(stored)           // the stored state, defaults vg = {ungroupedCollapsed:false, archivedCollapsed:true}
 *   hA0 = ["usage","sessions"]; ye($) / Lf$($) / Df$($,Q)  // panel sections
 *
 * Webview (`O_1=100, BP0=200, t01=1000, WP0=100`, the same schema as `KP0` /
 * `FP0`): `vC` (new group), `T_1` (delete), `L_1` (rename), `E_1` (collapse),
 * `DP0` (move into a group), `PP0` / `$T` (out of every group), `b_1`
 * (partition the rows), `k_1` (hide groups a filter emptied), `jP0` / `h_1`
 * (selection), `J51` (what a drag carries), `x_1` (dedupe), `e01` (truncate).
 */

/** `{id, name, collapsed, sessionIds}`, as stored and as sent. */
export interface SessionGroup {
    id: string;
    name: string;
    collapsed: boolean;
    sessionIds: string[];
}

/** The two built-in sections of the list, collapsed or not. */
export interface SessionSectionCollapseState {
    ungroupedCollapsed: boolean;
    archivedCollapsed: boolean;
}

/** `hA0`: the session manager's collapsible panel sections. */
export const PANEL_SECTIONS = ['usage', 'sessions'] as const;
export type PanelSection = (typeof PANEL_SECTIONS)[number];

/** `update_collapsed_panel_sections`'s `toggle`. */
export interface PanelSectionToggle {
    section: PanelSection;
    collapsed: boolean;
}

/** `D7$` / `O_1`: groups kept. */
export const MAX_SESSION_GROUPS = 100;
/** `ps$` / `WP0`: code points kept of a group's name. */
export const MAX_GROUP_NAME_LENGTH = 100;
/** `cs$` / `BP0`: the longest group id or session key. */
export const MAX_GROUP_KEY_LENGTH = 200;
/** `_g` / `t01`: session ids across all groups. */
export const MAX_GROUPED_SESSIONS = 1000;

/** `vg` / `zF`: Ungrouped open, Archived closed. */
export const DEFAULT_SECTION_COLLAPSE_STATE: SessionSectionCollapseState = Object.freeze({
    ungroupedCollapsed: false,
    archivedCollapsed: true,
});

/** `bJ()` / `__1()`: a string of 1..200 characters. */
export function isGroupKey(value: unknown): value is string {
    return typeof value === 'string' && value.length >= 1 && value.length <= MAX_GROUP_KEY_LENGTH;
}

/** `F7$` / `e01`: the first 100 code points (not UTF-16 units). */
export function truncateGroupName(name: string): string {
    return [...name].slice(0, MAX_GROUP_NAME_LENGTH).join('');
}

/** `x_1` / `R7$`: first occurrence wins. */
export function dedupe<T>(values: readonly T[]): T[] {
    const seen = new Set<T>();
    const out: T[] = [];
    for (const value of values) {
        if (!seen.has(value)) {
            seen.add(value);
            out.push(value);
        }
    }
    return out;
}

/**
 * `VG` / `R_1` (with `ns$` / `FP0`): whatever was sent or stored, as groups.
 * Not an array: none. A group that fails the schema is dropped; so is a
 * repeated id. Session ids are kept once, across all groups, up to the cap.
 */
export function normalizeSessionGroups(value: unknown): SessionGroup[] {
    if (!Array.isArray(value)) return [];
    const groups: SessionGroup[] = [];
    const ids = new Set<string>();
    const sessions = new Set<string>();
    for (const item of value) {
        if (groups.length >= MAX_SESSION_GROUPS) break;
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const raw = item as Record<string, unknown>;
        if (!isGroupKey(raw.id) || ids.has(raw.id)) continue;
        if (typeof raw.name !== 'string') continue;
        const name = truncateGroupName(raw.name.trim());
        if (name.length < 1) continue;
        // `z.boolean().catch(false)`; `z.array(z.unknown()).default([]).catch([])`.
        const collapsed = typeof raw.collapsed === 'boolean' ? raw.collapsed : false;
        const candidates = Array.isArray(raw.sessionIds) ? raw.sessionIds : [];
        const sessionIds: string[] = [];
        for (const id of candidates) {
            if (sessions.size >= MAX_GROUPED_SESSIONS) break;
            if (isGroupKey(id) && !sessions.has(id)) {
                sessions.add(id);
                sessionIds.push(id);
            }
        }
        ids.add(raw.id);
        groups.push({ id: raw.id, name, collapsed, sessionIds });
    }
    return groups;
}

/**
 * `tY` / `$T`: the groups without these session ids, or `null` when none of
 * them was in a group (so the caller writes nothing).
 */
export function withoutSessions(groups: readonly SessionGroup[], ids: Iterable<string>): SessionGroup[] | null {
    const drop = ids instanceof Set ? (ids as Set<string>) : new Set(ids);
    if (drop.size === 0) return null;
    let changed = false;
    const next = groups.map((group) => {
        const kept = group.sessionIds.filter((id) => !drop.has(id));
        if (kept.length === group.sessionIds.length) return group;
        changed = true;
        return { ...group, sessionIds: kept };
    });
    return changed ? next : null;
}

/** `O7$` / `w_1`: the stored state, each key defaulted on its own. */
export function readSectionCollapseState(value: unknown): SessionSectionCollapseState {
    if (!value || typeof value !== 'object') return { ...DEFAULT_SECTION_COLLAPSE_STATE };
    const { ungroupedCollapsed, archivedCollapsed } = value as Record<string, unknown>;
    return {
        ungroupedCollapsed: typeof ungroupedCollapsed === 'boolean' ? ungroupedCollapsed : DEFAULT_SECTION_COLLAPSE_STATE.ungroupedCollapsed,
        archivedCollapsed: typeof archivedCollapsed === 'boolean' ? archivedCollapsed : DEFAULT_SECTION_COLLAPSE_STATE.archivedCollapsed,
    };
}

/** `M7$` / `N_1`: only the boolean keys of a patch; anything else is dropped. */
export function sectionCollapsePatch(value: unknown): Partial<SessionSectionCollapseState> {
    if (!value || typeof value !== 'object') return {};
    const { ungroupedCollapsed, archivedCollapsed } = value as Record<string, unknown>;
    const patch: Partial<SessionSectionCollapseState> = {};
    if (typeof ungroupedCollapsed === 'boolean') patch.ungroupedCollapsed = ungroupedCollapsed;
    if (typeof archivedCollapsed === 'boolean') patch.archivedCollapsed = archivedCollapsed;
    return patch;
}

/** `o01`: the merged state, or `null` when the patch changes nothing. */
export function changedSectionCollapseState(
    state: SessionSectionCollapseState,
    patch: Partial<SessionSectionCollapseState>
): SessionSectionCollapseState | null {
    const next = { ...state, ...patch };
    return next.ungroupedCollapsed === state.ungroupedCollapsed && next.archivedCollapsed === state.archivedCollapsed ? null : next;
}

/** `Mf$` / `KA0`. */
export function isPanelSection(value: unknown): value is PanelSection {
    return (PANEL_SECTIONS as readonly unknown[]).includes(value);
}

/** `ye` / `F01`: the stored list, known sections only, once each. */
export function readCollapsedPanelSections(value: unknown): PanelSection[] {
    if (!Array.isArray(value)) return [];
    const out: PanelSection[] = [];
    for (const section of value) {
        if (isPanelSection(section) && !out.includes(section)) out.push(section);
    }
    return out;
}

/** `Lf$`: a valid toggle, or `null`. */
export function panelSectionToggle(value: unknown): PanelSectionToggle | null {
    if (!value || typeof value !== 'object') return null;
    const { section, collapsed } = value as Record<string, unknown>;
    if (!isPanelSection(section) || typeof collapsed !== 'boolean') return null;
    return { section, collapsed };
}

/** `Df$` / `SM1`. */
export function applyPanelSectionToggle(sections: readonly PanelSection[], toggle: PanelSectionToggle): PanelSection[] {
    if (toggle.collapsed) return sections.includes(toggle.section) ? [...sections] : [...sections, toggle.section];
    return sections.filter((section) => section !== toggle.section);
}

/* ------------------------------------------------------ the webview's edits */

/**
 * `vC`: a new group at the end, holding `sessionIds` (taken out of any other
 * group). Refused, with `groupId: ""`, at 100 groups or when it would go over
 * 1000 grouped sessions.
 */
export function createGroup(
    groups: readonly SessionGroup[],
    name: string,
    sessionIds: readonly string[] = [],
    newId: () => string = () => crypto.randomUUID()
): { groups: SessionGroup[]; groupId: string } {
    if (groups.length >= MAX_SESSION_GROUPS) return { groups: [...groups], groupId: '' };
    const ids = dedupe(sessionIds);
    const rest = withoutSessions(groups, sessionIds) ?? [...groups];
    if (rest.reduce((n, group) => n + group.sessionIds.length, 0) + ids.length > MAX_GROUPED_SESSIONS) {
        return { groups: [...groups], groupId: '' };
    }
    const id = newId();
    return {
        groups: [...rest, { id, name: truncateGroupName(name.trim()) || 'New group', collapsed: false, sessionIds: ids }],
        groupId: id,
    };
}

/** `T_1`. */
export function deleteGroup(groups: readonly SessionGroup[], groupId: string): SessionGroup[] {
    return groups.filter((group) => group.id !== groupId);
}

/** `L_1`: an empty or unchanged name changes nothing (the same array back). */
export function renameGroup(groups: SessionGroup[], groupId: string, name: string): SessionGroup[] {
    const next = truncateGroupName(name.trim());
    if (!next) return groups;
    const group = groups.find((g) => g.id === groupId);
    if (!group || group.name === next) return groups;
    return groups.map((g) => (g.id === groupId ? { ...g, name: next } : g));
}

/** `E_1`. */
export function setGroupCollapsed(groups: readonly SessionGroup[], groupId: string, collapsed: boolean): SessionGroup[] {
    return groups.map((group) => (group.id === groupId ? { ...group, collapsed } : group));
}

/**
 * `DP0`: move these sessions into the group (appended, in order), out of every
 * other. The same array back when nothing moves or it would go over the cap.
 */
export function moveToGroup(groups: SessionGroup[], groupId: string, sessionIds: readonly string[]): SessionGroup[] {
    if (!groups.some((group) => group.id === groupId)) return groups;
    const moving = new Set(sessionIds);
    let changed = false;
    const next = groups.map((group) => {
        if (group.id === groupId) {
            const added = dedupe(sessionIds).filter((id) => !group.sessionIds.includes(id));
            if (added.length === 0) return group;
            changed = true;
            return { ...group, sessionIds: [...group.sessionIds, ...added] };
        }
        const kept = group.sessionIds.filter((id) => !moving.has(id));
        if (kept.length === group.sessionIds.length) return group;
        changed = true;
        return { ...group, sessionIds: kept };
    });
    if (!changed) return groups;
    if (next.reduce((n, group) => n + group.sessionIds.length, 0) > MAX_GROUPED_SESSIONS) return groups;
    return next;
}

/** A drop target: a group, or the Ungrouped section. */
export type GroupTarget = { kind: 'group'; groupId: string } | { kind: 'ungrouped' };

/** `Z51` (`DP0` / `PP0`). */
export function moveSessions(groups: SessionGroup[], target: GroupTarget, sessionIds: readonly string[]): SessionGroup[] {
    return target.kind === 'group'
        ? moveToGroup(groups, target.groupId, sessionIds)
        : withoutSessions(groups, sessionIds) ?? groups;
}

/** `mF1`: the same drop target. */
export function sameTarget(a: GroupTarget, b: GroupTarget): boolean {
    return a.kind === 'group' && b.kind === 'group' ? a.groupId === b.groupId : a.kind === b.kind;
}

/**
 * `b_1`: rows into their groups (in group order), the ungrouped rest, and the
 * archived rows, which never sit in a group.
 */
export function partitionByGroup<T>(
    groups: readonly SessionGroup[],
    rows: readonly T[],
    keyOf: (row: T) => string | undefined,
    isArchived: (row: T) => boolean = () => false
): { grouped: Array<{ group: SessionGroup; items: T[] }>; ungrouped: T[]; archived: T[] } {
    const groupOf = new Map<string, string>();
    for (const group of groups) for (const id of group.sessionIds) groupOf.set(id, group.id);
    const items = new Map<string, T[]>(groups.map((group) => [group.id, []]));
    const ungrouped: T[] = [];
    const archived: T[] = [];
    for (const row of rows) {
        if (isArchived(row)) {
            archived.push(row);
            continue;
        }
        const key = keyOf(row);
        const groupId = key === undefined ? undefined : groupOf.get(key);
        if (groupId !== undefined) items.get(groupId)!.push(row);
        else ungrouped.push(row);
    }
    return { grouped: groups.map((group) => ({ group, items: items.get(group.id)! })), ungrouped, archived };
}

/**
 * `k_1`: while a status filter is on, drop the groups it emptied, but keep an
 * empty group none of whose sessions exist (a new group), and the one being
 * renamed.
 */
export function hideFilteredGroups<T>(
    partition: ReturnType<typeof partitionByGroup<T>>,
    allLiveRows: readonly T[],
    keyOf: (row: T) => string | undefined,
    renamingGroupId: string | null
): ReturnType<typeof partitionByGroup<T>> {
    const known = new Set<string>();
    for (const row of allLiveRows) {
        const key = keyOf(row);
        if (key !== undefined) known.add(key);
    }
    const grouped = partition.grouped.filter(
        ({ group, items }) => items.length > 0 || group.id === renamingGroupId || !group.sessionIds.some((id) => known.has(id))
    );
    return grouped.length === partition.grouped.length ? partition : { ...partition, grouped };
}

/**
 * `h_1` (with `jP0`): Ctrl/Cmd toggles a row, Shift selects the range from the
 * anchor, within one section (live or archived). A toggle that reaches across
 * sections starts a new selection.
 */
export function extendSelection(
    order: readonly string[],
    otherSection: ReadonlySet<string>,
    selected: ReadonlySet<string>,
    anchor: string | null,
    key: string,
    mode: 'toggle' | 'range'
): { selected: Set<string>; anchorKey: string } {
    if (mode === 'toggle') {
        for (const s of selected) if (otherSection.has(s)) return { selected: new Set([key]), anchorKey: key };
        const next = new Set(selected);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return { selected: next, anchorKey: key };
    }
    const at = order.indexOf(key);
    const from = anchor === null ? -1 : order.indexOf(anchor);
    if (at === -1 || from === -1) return { selected: new Set([key]), anchorKey: key };
    const lo = Math.min(from, at);
    const hi = Math.max(from, at);
    return { selected: new Set(order.slice(lo, hi + 1)), anchorKey: anchor! };
}

/** `J51`: a drag or a menu acts on the selection if the row is in it, else on the row. */
export function actedOn(selected: ReadonlySet<string>, order: readonly string[], key: string): string[] {
    if (!selected.has(key)) return [key];
    return order.filter((k) => selected.has(k));
}

/** `y_1`: which keys exist only live, and which only archived. */
export function splitLiveArchived<T>(
    rows: readonly T[],
    keyOf: (row: T) => string | undefined,
    isArchived: (row: T) => boolean
): { liveOnly: Set<string>; archivedOnly: Set<string> } {
    const live = new Set<string>();
    const archived = new Set<string>();
    for (const row of rows) {
        const key = keyOf(row);
        if (key !== undefined) (isArchived(row) ? archived : live).add(key);
    }
    for (const key of [...live].filter((k) => archived.has(k))) {
        live.delete(key);
        archived.delete(key);
    }
    return { liveOnly: live, archivedOnly: archived };
}
