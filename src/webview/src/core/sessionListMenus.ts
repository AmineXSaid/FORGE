/**
 * The session list's status filter and right-click menus, as data
 * (production audit, Phase 6).
 *
 * Ported from the official webview (`index.js`), where `At` builds these item
 * lists and hands them to the context menu `gH0`:
 *
 *   cy  = {activeOnly:false, statuses:new Set, tabStates:new Set}      // no filter
 *   iH0 = the filter is on;   oH0 = a row passes it;   tH0 = the counts
 *   eH0 = the "Filter by status" items: "Status" (Needs input / Working /
 *         Completed) and, when the open feed exists, "Tabs" (Open / Closed)
 *   sH0 / nH0 = toggle one status / one tab state
 *   mH0 = a live row's menu;   cH0 = an archived row's menu
 *   _W0 (inline in At) = a group header's menu
 *   n85 = items grouped under their headings, for the menu's render
 *
 * Free of Vue so the specs can read the menus without mounting the list.
 */
import type { SessionGroup } from '../../../shared/sessionGroups';
import type { SessionOpenState } from './sessionStates';

/** A context menu row (the official item shape). */
export interface MenuItem {
  label: string;
  onSelect?: () => void;
  separatorBefore?: boolean;
  /** Starts a section with this heading (`q3.sectionHeader`). */
  heading?: string;
  /** A check column: `true` checked, `false` unchecked, absent no column. */
  selected?: boolean;
  /** The menu stays open after this row (the filter's checkboxes). */
  keepOpen?: boolean;
  submenu?: Array<{ label: string; onSelect: () => void; separatorBefore?: boolean }>;
}

/* ------------------------------------------------------------ status filter */

export type SessionStatus = 'needs_input' | 'working' | 'completed';
export type TabState = 'open' | 'closed';

/** `e85` / `$95`. */
export const SESSION_STATUSES: readonly SessionStatus[] = ['needs_input', 'working', 'completed'];
export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  needs_input: 'Needs input',
  working: 'Working',
  completed: 'Completed',
};
/** `Z95` / `Y95`. */
export const TAB_STATES: readonly TabState[] = ['open', 'closed'];
export const TAB_STATE_LABELS: Record<TabState, string> = { open: 'Open', closed: 'Closed' };
/** `Q95` / `G95`. */
export const STATUS_HEADING = 'Status';
export const TABS_HEADING = 'Tabs';

export interface StatusFilter {
  activeOnly: boolean;
  statuses: Set<SessionStatus>;
  tabStates: Set<TabState>;
}

/** `cy`. */
export function emptyStatusFilter(): StatusFilter {
  return { activeOnly: false, statuses: new Set(), tabStates: new Set() };
}

/** `iH0`. */
export function filterIsOn(filter: StatusFilter): boolean {
  return filter.activeOnly || filter.statuses.size > 0 || filter.tabStates.size > 0;
}

/** `pF1`: a row's status. Forge has no remote status, so only the open state speaks. */
export function statusOf(openState: SessionOpenState | undefined): SessionStatus {
  if (openState === 'waiting') return 'needs_input';
  if (openState === 'running') return 'working';
  return 'completed';
}

/** `aH0`: needs attention -- unread, or not yet completed. */
export function isActiveState(openState: SessionOpenState | undefined): boolean {
  return openState === 'unread' || statusOf(openState) !== 'completed';
}

/** `rH0`. */
export function tabStateOf(isOpen: boolean): TabState {
  return isOpen ? 'open' : 'closed';
}

/**
 * `oH0($,J,Z,Y,X)`: does a row pass? The active row always passes the
 * "Active" toggle (`Y` is `X1===z`, the open conversation).
 */
export function passesFilter(
  filter: StatusFilter,
  openState: SessionOpenState | undefined,
  isActiveRow: boolean,
  isOpen: boolean
): boolean {
  if (filter.activeOnly && !isActiveRow && !isActiveState(openState)) return false;
  if (filter.statuses.size > 0 && !filter.statuses.has(statusOf(openState))) return false;
  return filter.tabStates.size === 0 || filter.tabStates.has(tabStateOf(isOpen));
}

export interface FilterCounts {
  active: number;
  byStatus: Record<SessionStatus, number>;
  byTabState: Record<TabState, number>;
}

/** `tH0`: counted over the live (not archived) rows. */
export function filterCounts(rows: Array<{ openState: SessionOpenState | undefined; isOpen: boolean }>): FilterCounts {
  const counts: FilterCounts = {
    active: 0,
    byStatus: { needs_input: 0, working: 0, completed: 0 },
    byTabState: { open: 0, closed: 0 },
  };
  for (const { openState, isOpen } of rows) {
    counts.byStatus[statusOf(openState)]++;
    counts.byTabState[tabStateOf(isOpen)]++;
    if (isActiveState(openState)) counts.active++;
  }
  return counts;
}

/** `sH0`. */
export function toggleStatus(filter: StatusFilter, status: SessionStatus): StatusFilter {
  const statuses = new Set(filter.statuses);
  if (!statuses.delete(status)) statuses.add(status);
  return { ...filter, statuses };
}

/** `nH0`. */
export function toggleTabState(filter: StatusFilter, state: TabState): StatusFilter {
  const tabStates = new Set(filter.tabStates);
  if (!tabStates.delete(state)) tabStates.add(state);
  return { ...filter, tabStates };
}

/**
 * `eH0($,J,Z,Y)`: the status filter's rows, each a check that keeps the menu
 * open. The "Status" heading appears only when the "Tabs" section does.
 */
export function statusFilterItems(
  counts: FilterCounts,
  filter: StatusFilter,
  onStatus: (status: SessionStatus) => void,
  onTabState?: (state: TabState) => void
): MenuItem[] {
  const withTabs = onTabState !== undefined;
  const statusItems: MenuItem[] = SESSION_STATUSES.map((status, i) => ({
    ...(withTabs && i === 0 ? { heading: STATUS_HEADING } : {}),
    label: `${SESSION_STATUS_LABELS[status]} · ${counts.byStatus[status]}`,
    selected: filter.statuses.has(status),
    keepOpen: true,
    onSelect: () => onStatus(status),
  }));
  if (!onTabState) return statusItems;
  const tabItems: MenuItem[] = TAB_STATES.map((state, i) => ({
    ...(i === 0 ? { separatorBefore: true, heading: TABS_HEADING } : {}),
    label: `${TAB_STATE_LABELS[state]} · ${counts.byTabState[state]}`,
    selected: filter.tabStates.has(state),
    keepOpen: true,
    onSelect: () => onTabState(state),
  }));
  return [...statusItems, ...tabItems];
}

/* ------------------------------------------------------------ row menus */

export interface RowMenuActions {
  resumeSession: () => void;
  createGroupFromSelection: () => void;
  moveSelectionToGroup: (groupId: string) => void;
  removeSelectionFromGroups: () => void;
  setSelectionUnread?: (unread: boolean) => void;
  archiveSelection?: () => void;
}

/**
 * `mH0($,J,Z,Y)`: a live row's menu, for the selection it acts on (`$`).
 *
 *   one row:  Resume session / Switch to session (when it is open)
 *   New group from session / New group from N sessions
 *   Add to group ▸ (groups not already holding all of them)
 *   Remove from group (when any of them is grouped)
 *   Mark as unread / Mark as read (with the unread feed)
 *   Archive session / Archive N sessions
 */
export function rowMenuItems(
  keys: readonly string[],
  groups: readonly SessionGroup[],
  actions: RowMenuActions,
  state: { sessionIsOpen?: boolean; selectionIsUnread?: boolean } = {}
): MenuItem[] {
  const items: MenuItem[] = [];
  if (keys.length === 1) {
    items.push({ label: state.sessionIsOpen ? 'Switch to session' : 'Resume session', onSelect: actions.resumeSession });
  }
  items.push({
    label: keys.length > 1 ? `New group from ${keys.length} sessions` : 'New group from session',
    separatorBefore: items.length > 0,
    onSelect: actions.createGroupFromSelection,
  });
  const targets = groups.filter((group) => !keys.every((key) => group.sessionIds.includes(key)));
  if (targets.length > 0) {
    items.push({
      label: 'Add to group',
      submenu: targets.map((group) => ({ label: group.name, onSelect: () => actions.moveSelectionToGroup(group.id) })),
    });
  }
  if (keys.some((key) => groups.some((group) => group.sessionIds.includes(key)))) {
    items.push({ label: 'Remove from group', separatorBefore: true, onSelect: actions.removeSelectionFromGroups });
  }
  if (actions.setSelectionUnread && state.selectionIsUnread !== undefined) {
    const markUnread = !state.selectionIsUnread;
    const set = actions.setSelectionUnread;
    items.push({ label: markUnread ? 'Mark as unread' : 'Mark as read', separatorBefore: true, onSelect: () => set(markUnread) });
  }
  if (actions.archiveSelection) {
    items.push({
      label: keys.length > 1 ? `Archive ${keys.length} sessions` : 'Archive session',
      separatorBefore: true,
      onSelect: actions.archiveSelection,
    });
  }
  return items;
}

/** `cH0($,J,Z)`: an archived row's menu. */
export function archivedRowMenuItems(
  keys: readonly string[],
  actions: { resumeSession: () => void; unarchiveSelection?: () => void },
  state: { sessionIsOpen?: boolean } = {}
): MenuItem[] {
  const items: MenuItem[] = [];
  if (keys.length === 1) {
    items.push({ label: state.sessionIsOpen ? 'Switch to session' : 'Resume session', onSelect: actions.resumeSession });
  }
  if (actions.unarchiveSelection) {
    items.push({
      label: keys.length > 1 ? `Unarchive ${keys.length} sessions` : 'Unarchive session',
      separatorBefore: items.length > 0,
      onSelect: actions.unarchiveSelection,
    });
  }
  return items;
}

/**
 * `_W0`: a group header's menu.
 *
 *   ...(i ? [{label:"Start new session in this group", onSelect:()=>i(A0.id)}] : []),
 *   {label:"New group", separatorBefore:i!==void 0, …},
 *   {label:"Rename group", …},
 *   {label:"Delete group", separatorBefore:!0, …}
 */
export function groupMenuItems(actions: {
  startSessionInGroup?: () => void;
  newGroup: () => void;
  renameGroup: () => void;
  deleteGroup: () => void;
}): MenuItem[] {
  return [
    ...(actions.startSessionInGroup ? [{ label: 'Start new session in this group', onSelect: actions.startSessionInGroup }] : []),
    { label: 'New group', separatorBefore: actions.startSessionInGroup !== undefined, onSelect: actions.newGroup },
    { label: 'Rename group', onSelect: actions.renameGroup },
    { label: 'Delete group', separatorBefore: true, onSelect: actions.deleteGroup },
  ];
}

/** `n85`: consecutive items under the heading that opened their section. */
export function sectionsOf(items: readonly MenuItem[]): Array<{ heading?: string; entries: Array<{ item: MenuItem; index: number }> }> {
  const sections: Array<{ heading?: string; entries: Array<{ item: MenuItem; index: number }> }> = [];
  items.forEach((item, index) => {
    const last = sections.at(-1);
    if (item.heading !== undefined || last === undefined) sections.push({ heading: item.heading, entries: [{ item, index }] });
    else last.entries.push({ item, index });
  });
  return sections;
}

/** `WZ`: the menu keeps 8px from the window's edges. */
export const MENU_MARGIN = 8;

/** `t85`: the menu's left edge, leaving room for a submenu to its right. */
export function menuLeft(x: number, width: number, viewport: number, hasSubmenu: boolean): number {
  const left = Math.max(MENU_MARGIN, Math.min(x, viewport - width - MENU_MARGIN));
  if (!hasSubmenu) return left;
  const fitsRight = left + width - 2 + width <= viewport - MENU_MARGIN;
  const fitsLeft = left - width + 2 >= MENU_MARGIN;
  if (fitsRight || fitsLeft) return left;
  return Math.max(MENU_MARGIN, viewport - MENU_MARGIN - width + 2 - width);
}

/** `o85`: a submenu beside its row, flipped left when it would overflow. */
export function submenuLeft(row: { left: number; right: number }, width: number, viewport: number): number {
  const right = row.right - 2;
  if (right + width <= viewport - MENU_MARGIN) return right;
  const left = row.left - width + 2;
  if (left >= MENU_MARGIN) return left;
  const clamp = Math.max(MENU_MARGIN, viewport - width - MENU_MARGIN);
  const overlap = row.right - clamp;
  return MENU_MARGIN + width - row.left < overlap ? MENU_MARGIN : clamp;
}
