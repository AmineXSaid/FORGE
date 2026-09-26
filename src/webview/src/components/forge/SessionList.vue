<template>
  <!--
    The official sessions list (`At`, module OOQiHg), shared by its two mounts
    exactly as the official shares it:

    - the chat header's "Past conversations" dropdown (`QW0`): no groups, no
      status feeds, the search box always shown and focused;
    - the activity-bar session manager (`KW0`, `isSessionListOnly`): groups,
      the Ungrouped / Archived section state, the status dot and the unread
      feed, a search that folds away, the status filter, "New group", the
      right-click menus, multi-select and drag into a group.

    Left out, with the reason: the Local / Web switch (claude.ai accounts
    only), the remote list and its reconnect states (Forge has local sessions
    only), and the worktree pill (it opens a worktree in a new window, which
    Forge's host does not offer).
  -->
  <div
    ref="rootEl"
    class="fg-sessions__root"
    :tabindex="listOnly ? -1 : undefined"
    :role="listOnly ? 'group' : undefined"
    :aria-label="listOnly ? 'Sessions' : undefined"
    :aria-activedescendant="listOnly ? activeDescendant : undefined"
    @keydown="onKeyDown"
  >
    <div class="fg-sessions__searchRow">
      <div
        v-if="searchShown"
        ref="searchBoxEl"
        :class="['fg-sessions__searchBox', { 'fg-sessions__searchBoxCollapsible': listOnly }]"
        @focusout="onSearchBlur"
      >
        <SearchIcon class="fg-sessions__searchIcon" />
        <input
          ref="searchEl"
          v-model="query"
          type="text"
          placeholder="Search sessions…"
          :class="['fg-filter__filterInput', 'fg-sessions__searchInput', { 'fg-sessions__searchInputClearable': listOnly }]"
          :aria-controls="contentId"
          :aria-activedescendant="activeDescendant"
        />
        <button
          v-if="listOnly"
          type="button"
          class="fg-sessions__searchClearButton"
          title="Clear search"
          aria-label="Clear search"
          @mousedown.prevent
          @click="clearSearch"
          @keydown="onButtonKey($event, clearSearch)"
        >
          <SearchClearIcon class="fg-sessions__searchClearIcon" />
        </button>
      </div>
      <div class="fg-sessions__searchRowActions">
        <template v-if="listOnly && hasRows">
          <button
            ref="filterButtonEl"
            :class="['fg-sessions__newGroupButton', 'fg-sessions__statusFilterMenuButton', { 'fg-sessions__filterToggleOn': filterSelections > 0 }]"
            title="Filter by status"
            :aria-label="filterSelections > 0 ? `Filter by status, ${filterSelections} selected` : 'Filter by status'"
            aria-haspopup="menu"
            :aria-expanded="menu?.source === 'statusFilter'"
            @click="openStatusFilter"
            @keydown="onButtonKey($event, openStatusFilter)"
          >
            <StatusFilterIcon class="fg-sessions__newGroupIcon" />
            <FilterCaretIcon class="fg-sessions__statusFilterCaret" />
          </button>
          <button
            :class="['fg-sessions__newGroupButton', 'fg-sessions__activeFilterToggle', { 'fg-sessions__filterToggleOn': filter.activeOnly }]"
            title="Show only sessions that need input, are working, or are unread"
            :aria-pressed="filter.activeOnly"
            @click="toggleActiveOnly"
            @keydown="onButtonKey($event, toggleActiveOnly)"
          >
            <ActiveFilterIcon class="fg-sessions__newGroupIcon" />Active · {{ counts.active }}
          </button>
        </template>
      </div>
      <span class="fg-sessions__searchRowTail">
        <button
          v-if="listOnly && !searchShown"
          type="button"
          class="fg-sessions__newGroupButton fg-sessions__searchToggleButton"
          title="Search sessions"
          aria-label="Search sessions"
          @click="revealSearch()"
          @keydown="onButtonKey($event, () => revealSearch())"
        >
          <SearchIcon class="fg-sessions__newGroupIcon" />
        </button>
        <button
          v-if="groupsOn && hasRows"
          class="fg-sessions__newGroupButton"
          title="New group"
          aria-label="New group"
          @click="newGroup"
          @keydown="onButtonKey($event, newGroup)"
        >
          <NewGroupIcon class="fg-sessions__newGroupIcon" />New group
        </button>
      </span>
    </div>

    <div :id="contentId" :class="['fg-sessions__content', { 'fg-sessions__sessionListOnly': listOnly }]">
      <div v-if="!loaded" class="fg-sessions__disconnectedState">
        <SessionsSpinner />
        <div class="fg-sessions__disconnectedText">Loading sessions…</div>
      </div>
      <div v-else-if="rows.length === 0" class="fg-sessions__nullState">
        <div class="fg-sessions__nullStateText">No sessions yet</div>
      </div>
      <div v-else-if="emptyByFilter" class="fg-sessions__emptyState">No sessions found</div>
      <div v-else class="fg-sessions__sessionsList">
        <template v-for="{ group, items } in shown.grouped" :key="group.id">
          <SessionGroupHeader
            :name="group.name"
            :collapsed="group.collapsed"
            :count="items.length"
            :is-renaming="renamingGroupId === group.id"
            :is-drop-target="dropTarget?.kind === 'group' && dropTarget.groupId === group.id"
            @toggle="toggleGroup(group)"
            @contextmenu="openGroupMenu($event, group)"
            @finish-rename="finishGroupRename(group.id, $event)"
            @cancel-rename="renamingGroupId = null"
            @dragover="onDragOver($event, { kind: 'group', groupId: group.id })"
            @dragleave="onDragLeave($event, { kind: 'group', groupId: group.id })"
            @drop="onDrop($event, { kind: 'group', groupId: group.id })"
          />
          <template v-if="!group.collapsed">
            <SessionRow v-for="row in items" :key="keyOrIndex(row)" v-bind="rowProps(row)" v-on="rowHandlers(row)" />
          </template>
        </template>
        <SessionGroupHeader
          v-if="sectionsShown && shown.ungrouped.length > 0"
          name="Ungrouped"
          :collapsed="sectionState.ungroupedCollapsed"
          :count="shown.ungrouped.length"
          :is-drop-target="dropTarget?.kind === 'ungrouped'"
          @toggle="patchSections({ ungroupedCollapsed: !sectionState.ungroupedCollapsed })"
          @dragover="onDragOver($event, { kind: 'ungrouped' })"
          @dragleave="onDragLeave($event, { kind: 'ungrouped' })"
          @drop="onDrop($event, { kind: 'ungrouped' })"
        />
        <template v-if="!ungroupedHidden">
          <SessionRow v-for="row in shown.ungrouped" :key="keyOrIndex(row)" v-bind="rowProps(row)" v-on="rowHandlers(row)" />
        </template>
        <template v-if="shown.archived.length > 0">
          <SessionGroupHeader
            name="Archived sessions"
            :collapsed="archivedHidden"
            :count="shown.archived.length"
            :toggleable="!query"
            @toggle="patchSections({ archivedCollapsed: !sectionState.archivedCollapsed })"
          />
          <template v-if="!archivedHidden">
            <SessionRow v-for="row in shown.archived" :key="keyOrIndex(row)" v-bind="rowProps(row)" v-on="rowHandlers(row)" />
          </template>
        </template>
      </div>
    </div>

    <SessionContextMenu v-if="menu && menuItems" :items="menuItems" :x="menu.x" :y="menu.y" @close="menu = null" />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import SearchIcon from './icons/SearchIcon.vue';
import SearchClearIcon from './icons/SearchClearIcon.vue';
import StatusFilterIcon from './icons/StatusFilterIcon.vue';
import FilterCaretIcon from './icons/FilterCaretIcon.vue';
import ActiveFilterIcon from './icons/ActiveFilterIcon.vue';
import NewGroupIcon from './icons/NewGroupIcon.vue';
import SessionsSpinner from './SessionsSpinner.vue';
import SessionContextMenu from './SessionContextMenu.vue';
import SessionGroupHeader from './SessionGroupHeader.vue';
import SessionRow from './SessionRow.vue';
import { RuntimeKey } from '../../composables/runtimeContext';
import { useSessionStore } from '../../composables/useSessionStore';
import { useSession } from '../../composables/useSession';
import type { Session } from '../../core/Session';
import {
  feedHasSession,
  matchesSessionQuery,
  openStateFor,
  sessionKey,
  type SessionOpenState,
} from '../../core/sessionStates';
import {
  archivedRowMenuItems,
  emptyStatusFilter,
  filterCounts,
  filterIsOn,
  groupMenuItems,
  passesFilter,
  rowMenuItems,
  statusFilterItems,
  toggleStatus,
  toggleTabState,
  type MenuItem,
  type StatusFilter,
} from '../../core/sessionListMenus';
import {
  DEFAULT_SECTION_COLLAPSE_STATE,
  actedOn,
  changedSectionCollapseState,
  createGroup,
  deleteGroup,
  extendSelection,
  hideFilteredGroups,
  moveSessions,
  partitionByGroup,
  renameGroup,
  sameTarget,
  setGroupCollapsed,
  splitLiveArchived,
  type GroupTarget,
  type SessionGroup,
  type SessionSectionCollapseState,
} from '../../../../shared/sessionGroups';

const props = withDefaults(
  defineProps<{
    /** `isSessionListOnly`: the session manager's mount. */
    listOnly?: boolean;
    /** `sessionGroups` / `onUpdateSessionGroups` / `sectionCollapseState` are passed. */
    groups?: boolean;
    /** `openSessionIds` / `unreadSessionKeys` / `onSetSessionUnread` are passed. */
    feeds?: boolean;
    /** `onNewSessionInGroup` is passed: the group menu's first row. */
    newSessionInGroup?: boolean;
    autoFocusSearch?: boolean;
    /** The first listing has answered (`localSessionsLoaded`). */
    loaded?: boolean;
  }>(),
  { listOnly: false, groups: false, feeds: false, newSessionInGroup: false, autoFocusSearch: false, loaded: true }
);

const emit = defineEmits<{
  /** `onSessionClick(session, openState)`. */
  (e: 'open', session: Session, openState: SessionOpenState | undefined): void;
  /** `onNewSessionInGroup(groupId)`. */
  (e: 'newSessionInGroup', groupId: string): void;
}>();

const runtime = inject(RuntimeKey)!;
const store = useSessionStore(runtime.sessionStore);

/* ------------------------------------------------------------------ rows */

type Row = ReturnType<typeof useSession> & { raw: Session };
const wrappers = new WeakMap<Session, Row>();
function wrap(raw: Session): Row {
  let row = wrappers.get(raw);
  if (!row) {
    row = { ...useSession(raw), raw };
    wrappers.set(raw, row);
  }
  return row;
}

/** `B0`: every local session, newest first. */
const rows = computed<Row[]>(() => ((store.sessionsByLastModified.value || []).filter(Boolean) as Session[]).map(wrap));
const activeRaw = computed(() => store.activeSession.value);
const isActive = (row: Row) => row.raw === activeRaw.value;
/** `J0`: the row's key (`c$`). */
const keyOf = (row: Row) => sessionKey(row.sessionId.value);
/** `BZ`. */
const isArchived = (row: Row) => row.archived.value;
/** `kR`. */
const title = (row: Row) => row.summary.value || 'Untitled';
const keyOrIndex = (row: Row) => row.sessionId.value ?? `draft-${rows.value.indexOf(row)}`;

/* ------------------------------------------------------- the feeds (a6) */

const openIds = computed(() => (props.feeds && store.openSessionIds.value ? new Set(store.openSessionIds.value) : undefined));
const unreadKeys = computed(() => (props.feeds && store.unreadSessionKeys.value ? new Set(store.unreadSessionKeys.value) : undefined));
const inFeed = (row: Row, feed: ReadonlySet<string> | undefined) => feedHasSession(row.sessionId.value, false, undefined, feed);

/** `a6`: no dot at all until a feed has answered. */
function openStateOf(row: Row): SessionOpenState | undefined {
  if (!openIds.value && !unreadKeys.value) return undefined;
  return openStateFor(inFeed(row, openIds.value), row.busy.value, row.permissionRequests.value.length > 0, inFeed(row, unreadKeys.value));
}
/** `T3`: open in a tab; `undefined` without the open feed. */
const isOpenRow = (row: Row) => (openIds.value ? inFeed(row, openIds.value) : undefined);

/* ------------------------------------------------- search and filter */

const query = ref('');
/** `r1`: the session manager's search box, revealed. */
const searchRevealed = ref(false);
/** `$0`. */
const searchShown = computed(() => !props.listOnly || searchRevealed.value || query.value !== '');
const filter = ref<StatusFilter>(emptyStatusFilter());
/** `q0`. */
const filterOn = computed(() => filterIsOn(filter.value));
const filterSelections = computed(() => filter.value.statuses.size + filter.value.tabStates.size);

/** `KZ`: the title or the branch. */
const searched = computed(() => (query.value ? rows.value.filter((row) => matchesSessionQuery(title(row), row.gitBranch.value, query.value)) : rows.value));
/** `c`: the live rows, unsearched (the filter's counts). */
const liveRows = computed(() => rows.value.filter((row) => !isArchived(row)));
/** `a`. */
const filtered = computed(() => {
  if (!filterOn.value) return searched.value;
  return searched.value.filter((row) => {
    if (row.sessionId.value && row.sessionId.value === renamingId.value) return true;
    if (isArchived(row)) return false;
    return passesFilter(filter.value, openStateOf(row), isActive(row), isOpenRow(row) === true);
  });
});
/** `J1`: rows open in a tab first. */
const ordered = computed(() => {
  if (!openIds.value) return filtered.value;
  const open = filtered.value.filter((row) => isOpenRow(row) === true);
  if (open.length === 0 || open.length === filtered.value.length) return filtered.value;
  return [...open, ...filtered.value.filter((row) => isOpenRow(row) !== true)];
});
/** `QA1`. */
const counts = computed(() => filterCounts(liveRows.value.map((row) => ({ openState: openStateOf(row), isOpen: isOpenRow(row) === true }))));
const hasRows = computed(() => props.loaded && rows.value.length > 0);

/* --------------------------------------------------------------- groups */

/** `N`: the groups, once the host has answered. */
const groups = computed<SessionGroup[] | undefined>(() => (props.groups && store.sessionGroupsLoaded.value ? store.sessionGroups.value : undefined));
/** `W5`. */
const groupsOn = computed(() => groups.value !== undefined);
/** `s2`: groups are drawn only while not searching. */
const grouping = computed(() => groupsOn.value && !query.value);
const renamingGroupId = ref<string | null>(null);

const partition = computed(() => partitionByGroup(grouping.value ? groups.value! : [], ordered.value, keyOf, isArchived));
/** `K6`. */
const shown = computed(() =>
  grouping.value && filterOn.value ? hideFilteredGroups(partition.value, liveRows.value, keyOf, renamingGroupId.value) : partition.value
);
/** `LJ`. */
const emptyByFilter = computed(() => filtered.value.length === 0 && (query.value !== '' || filterOn.value));

/* ------------------------------------------- Ungrouped / Archived state */

/** `i5`, the component's own state when the host keeps none (the dropdown). */
const localSections = ref<SessionSectionCollapseState>({ ...DEFAULT_SECTION_COLLAPSE_STATE });
/** `z4`: changes made before the stored state arrived. */
const pendingSections = ref<Partial<SessionSectionCollapseState>>({});
/** `_`: the stored state, once groups have loaded. */
const storedSections = computed(() => (props.groups && store.sessionGroupsLoaded.value ? store.sessionSectionCollapseState.value : undefined));
/** `k1`. */
const sectionState = computed<SessionSectionCollapseState>(() =>
  storedSections.value ? changedSectionCollapseState(storedSections.value, pendingSections.value) ?? storedSections.value : localSections.value
);

/** `D0`. */
function patchSections(patch: Partial<SessionSectionCollapseState>): void {
  if (storedSections.value && props.groups) {
    void store.updateSessionSectionCollapseState(patch);
    return;
  }
  if (props.groups) pendingSections.value = { ...pendingSections.value, ...patch };
  localSections.value = { ...localSections.value, ...patch };
}
// The official effect: once the stored state lands, write what was changed before it.
watch(storedSections, (stored) => {
  if (!stored) return;
  if (changedSectionCollapseState(stored, pendingSections.value)) void store.updateSessionSectionCollapseState(pendingSections.value);
  if (Object.keys(pendingSections.value).length > 0) pendingSections.value = {};
});

/** `q1`: the section headers exist when there is a group or an archived row. */
const sectionsShown = computed(() => grouping.value && (partition.value.grouped.length > 0 || rows.value.some(isArchived)));
/** `t`. */
const ungroupedHidden = computed(() => sectionsShown.value && sectionState.value.ungroupedCollapsed);
/** `n`: a search always opens Archived. */
const archivedHidden = computed(() => !query.value && sectionState.value.archivedCollapsed);

/** `H1`: the rows the keyboard walks, in render order. */
const visible = computed<Row[]>(() => [
  ...shown.value.grouped.flatMap(({ group, items }) => (group.collapsed ? [] : items)),
  ...(ungroupedHidden.value ? [] : shown.value.ungrouped),
  ...(archivedHidden.value ? [] : shown.value.archived),
]);
const keysOf = (list: Row[]) => list.map(keyOf).filter((k): k is string => k !== undefined);
/** `w0` / `T5`. */
const liveKeys = computed(() => keysOf(visible.value.filter((row) => !isArchived(row))));
const archivedKeys = computed(() => keysOf(visible.value.filter(isArchived)));
/** `G5` / `w2`. */
const liveArchivedSplit = computed(() => splitLiveArchived(rows.value, keyOf, isArchived));

/* ------------------------------------------------------ focus, selection */

const uid = Math.random().toString(36).slice(2, 8);
const contentId = `forge-sessions-${uid}`;
const rowId = (row: Row, index: number) => `${contentId}-row-${row.sessionId.value ?? index}`;
const focusedIndex = ref(0);
const selected = ref(new Set<string>());
const selectionAnchor = ref<string | null>(null);
const renamingId = ref<string | null>(null);
const rowEls = new Map<number, HTMLElement>();
/** `Y1` (`vF1`): the row focus follows when the list reorders. */
let focusedKey: Row | undefined;

const activeDescendant = computed(() => {
  if (!props.loaded) return undefined;
  const row = visible.value[focusedIndex.value];
  return row ? rowId(row, focusedIndex.value) : undefined;
});

function clearSelection(): void {
  selected.value = new Set();
  selectionAnchor.value = null;
}

// `Y1.remap(H1,B1)` / `Y1.record(H1,B1)`.
watch(visible, (list) => {
  if (focusedKey) {
    const at = list.indexOf(focusedKey);
    if (at >= 0 && at !== focusedIndex.value) focusedIndex.value = at;
  }
  focusedKey = list[focusedIndex.value];
});
watch(focusedIndex, (i) => {
  focusedKey = visible.value[i];
});
// A new search or filter starts the selection and the focus over (the
// official effect on `[S, V1, d]`); an open menu stays, so the filter's
// checkboxes can be ticked one after another.
watch([query, filter], () => {
  clearSelection();
  if (renamingGroupId.value === null) {
    focusedKey = undefined;
    focusedIndex.value = 0;
  }
});

/** `nF1`: move the focused row, clamped; a focused row button moves focus with it. */
function moveFocus(step: number): void {
  const next = Math.min(Math.max(focusedIndex.value + step, 0), visible.value.length - 1);
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.closest(`button[id^="${contentId}-row-"]`)) rowEls.get(next)?.focus({ preventScroll: true });
  focusedIndex.value = next;
  void nextTick(() => rowEls.get(next)?.scrollIntoView({ block: 'nearest' }));
}

/** `Nt`: a click, with Ctrl/Cmd or Shift selecting instead of opening. */
function clickRow(event: MouseEvent | KeyboardEvent, row: Row): void {
  const key = keyOf(row);
  if (groupsOn.value && key && (event.metaKey || event.ctrlKey || event.shiftKey)) {
    event.preventDefault();
    const archived = isArchived(row);
    const next = extendSelection(
      archived ? archivedKeys.value : liveKeys.value,
      archived ? liveArchivedSplit.value.liveOnly : liveArchivedSplit.value.archivedOnly,
      selected.value,
      selectionAnchor.value,
      key,
      event.metaKey || event.ctrlKey ? 'toggle' : 'range'
    );
    selected.value = next.selected;
    selectionAnchor.value = next.anchorKey;
    return;
  }
  if (selected.value.size > 0) selected.value = new Set();
  selectionAnchor.value = key ?? null;
  emit('open', row.raw, openStateOf(row));
}

/* ------------------------------------------------------------ rename */

function startRename(row: Row): void {
  const id = row.sessionId.value;
  if (id) renamingId.value = id;
}
function finishRename(row: Row, text: string): void {
  renamingId.value = null;
  const next = text.trim();
  if (!next || next === title(row)) return;
  const id = row.sessionId.value;
  if (id) void store.renameSession(id, next).catch(() => {});
}

/* ------------------------------------------------- archive / unarchive */

/** `VA1` / `HA1`: the selection goes first. */
function archive(row: Row): void {
  clearSelection();
  void store.archiveSession(row.raw);
}
function unarchive(row: Row): void {
  clearSelection();
  void store.unarchiveSession(row.raw);
}

/* ------------------------------------------------------------ groups */

function writeGroups(next: SessionGroup[]): void {
  void store.updateSessionGroups(next);
}

/** Collapse the revealed, empty search box (`YA1`), returning how far the list moved. */
function foldSearch(anchorEl: HTMLElement): number {
  if (!props.listOnly || !searchRevealed.value || query.value !== '') return 0;
  const before = anchorEl.getBoundingClientRect().top;
  searchRevealed.value = false;
  // Vue patches on the next tick; the official flushes synchronously. The
  // difference is measured after the patch.
  return anchorEl.getBoundingClientRect().top - before;
}

function afterGroupCreated(groupId: string): void {
  query.value = '';
  searchRevealed.value = false;
  filter.value = emptyStatusFilter();
  renamingGroupId.value = groupId;
}

/** `UA1`: "New group". */
function newGroup(): void {
  if (!groups.value) return;
  const created = createGroup(groups.value, 'New group');
  if (!created.groupId) return;
  writeGroups(created.groups);
  afterGroupCreated(created.groupId);
}

/** `bW0`. */
function toggleGroup(group: SessionGroup): void {
  if (!groups.value) return;
  writeGroups(setGroupCollapsed(groups.value, group.id, !group.collapsed));
}

/** `IW0`. */
function finishGroupRename(groupId: string, text: string): void {
  renamingGroupId.value = null;
  if (!groups.value) return;
  const name = text.trim();
  const group = groups.value.find((g) => g.id === groupId);
  if (!name || name === group?.name) return;
  const next = renameGroup(groups.value, groupId, text);
  if (next !== groups.value) writeGroups(next);
}

/** `Mt`. */
function moveTo(target: GroupTarget, keys: string[]): void {
  if (!groups.value) return;
  const next = moveSessions(groups.value, target, keys);
  if (next !== groups.value) writeGroups(next);
  clearSelection();
}

/* --------------------------------------------------------- menus */

type MenuState = { x: number; y: number; items?: MenuItem[]; source?: 'statusFilter' };
const menu = ref<MenuState | null>(null);
const filterButtonEl = ref<HTMLElement | null>(null);

/** `qA1`: the status filter's rows are rebuilt as the filter changes (they stay open). */
const menuItems = computed<MenuItem[] | undefined>(() => {
  if (!menu.value) return undefined;
  if (menu.value.source !== 'statusFilter') return menu.value.items;
  return statusFilterItems(
    counts.value,
    filter.value,
    (status) => (filter.value = toggleStatus(filter.value, status)),
    openIds.value ? (state) => (filter.value = toggleTabState(filter.value, state)) : undefined
  );
});

/** `Ot`: at the pointer; a keyboard-opened menu (at 0,0) sits under the element. */
function menuPoint(event: MouseEvent): { x: number; y: number } {
  const target = event.currentTarget as HTMLElement;
  const shift = foldSearch(target);
  if (event.clientX <= 1 && event.clientY <= 1) {
    const rect = target.getBoundingClientRect();
    return { x: rect.left + 8, y: rect.bottom };
  }
  return { x: event.clientX, y: event.clientY + shift };
}

/** `zA1`. */
function openStatusFilter(): void {
  const button = filterButtonEl.value;
  if (!button) return;
  foldSearch(button);
  const rect = button.getBoundingClientRect();
  menu.value = { source: 'statusFilter', x: rect.left, y: rect.bottom + 2 };
}

/** `GA1`. */
function toggleActiveOnly(): void {
  filter.value = { ...filter.value, activeOnly: !filter.value.activeOnly };
}

/** `OW0`: a row's menu, for the selection it belongs to. */
function openRowMenu(event: MouseEvent, row: Row): void {
  if (!groups.value) return;
  const key = keyOf(row);
  if (!key) return;
  event.preventDefault();
  event.stopPropagation();
  const isOpen = isOpenRow(row) === true;
  const resume = () => {
    selected.value = new Set();
    selectionAnchor.value = key;
    emit('open', row.raw, openStateOf(row));
  };
  if (isArchived(row)) {
    const archivedSet = new Set(archivedKeys.value);
    const keys = selected.value.has(key) ? [...selected.value].filter((k) => archivedSet.has(k)) : [key];
    if (!selected.value.has(key)) {
      selected.value = new Set([key]);
      selectionAnchor.value = key;
    }
    const acting = visible.value.filter((r) => isArchived(r) && keys.includes(keyOf(r) ?? ''));
    const items = archivedRowMenuItems(keys, { resumeSession: resume, unarchiveSelection: () => acting.forEach(unarchive) }, { sessionIsOpen: isOpen });
    if (items.length > 0) menu.value = { ...menuPoint(event), items };
    return;
  }
  const keys = actedOn(selected.value, liveKeys.value, key);
  if (!selected.value.has(key)) {
    selected.value = new Set([key]);
    selectionAnchor.value = key;
  }
  const acting = visible.value.filter((r) => keys.includes(keyOf(r) ?? ''));
  const actingKeys = keysOf(acting);
  const current = groups.value;
  const items = rowMenuItems(
    keys,
    current,
    {
      resumeSession: resume,
      createGroupFromSelection: () => {
        const created = createGroup(store.sessionGroups.value, 'New group', keys);
        if (!created.groupId) return;
        writeGroups(created.groups);
        afterGroupCreated(created.groupId);
        clearSelection();
      },
      moveSelectionToGroup: (groupId) => moveTo({ kind: 'group', groupId }, keys),
      removeSelectionFromGroups: () => moveTo({ kind: 'ungrouped' }, keys),
      setSelectionUnread: props.feeds
        ? (unread) => {
            for (const k of actingKeys) void store.setSessionUnread(k, unread);
            clearSelection();
          }
        : undefined,
      archiveSelection: () => {
        for (const r of acting) if (!isArchived(r)) archive(r);
      },
    },
    {
      sessionIsOpen: isOpen,
      selectionIsUnread: unreadKeys.value && acting.length > 0 ? acting.every((r) => inFeed(r, unreadKeys.value)) : undefined,
    }
  );
  menu.value = { ...menuPoint(event), items };
}

/** `_W0`: a group header's menu. */
function openGroupMenu(event: MouseEvent, group: SessionGroup): void {
  if (!groups.value) return;
  event.preventDefault();
  event.stopPropagation();
  const items = groupMenuItems({
    startSessionInGroup: props.newSessionInGroup ? () => emit('newSessionInGroup', group.id) : undefined,
    newGroup: () => {
      const created = createGroup(store.sessionGroups.value, 'New group');
      if (!created.groupId) return;
      writeGroups(created.groups);
      filter.value = emptyStatusFilter();
      renamingGroupId.value = created.groupId;
    },
    renameGroup: () => (renamingGroupId.value = group.id),
    deleteGroup: () => {
      const current = store.sessionGroups.value;
      const next = deleteGroup(current, group.id);
      if (next.length !== current.length) writeGroups(next);
    },
  });
  menu.value = { ...menuPoint(event), items };
}

/* ------------------------------------------------------ drag and drop */

/** `gF1`. */
const DRAG_MIME = 'application/x-claude-code-session-rows';
let drag: { nonce: string; keys: string[]; sourceKey: string } | null = null;
const dropTarget = ref<GroupTarget | null>(null);

function endDrag(): void {
  drag = null;
  dropTarget.value = null;
}
// A drag whose source row went away is over.
watch(liveKeys, (keys) => {
  if (drag && !keys.includes(drag.sourceKey)) endDrag();
});

/** `wW0`. */
function onDragStart(event: DragEvent, row: Row): void {
  const key = keyOf(row);
  if (!grouping.value || !key || isArchived(row) || !event.dataTransfer) {
    event.preventDefault();
    return;
  }
  const keys = actedOn(selected.value, liveKeys.value, key);
  if (!selected.value.has(key)) {
    selected.value = new Set([key]);
    selectionAnchor.value = key;
  }
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  event.dataTransfer.setData(DRAG_MIME, nonce);
  event.dataTransfer.effectAllowed = 'move';
  // `B95`: a floating label, "<title>" or "N sessions".
  const image = document.createElement('div');
  image.className = 'fg-sessions__dragImage';
  image.textContent = keys.length === 1 ? title(row) : `${keys.length} sessions`;
  document.body.appendChild(image);
  event.dataTransfer.setDragImage(image, -12, -12);
  setTimeout(() => image.remove(), 0);
  drag = { nonce, keys, sourceKey: key };
}

/** `eF1`: what this drag would move here, or null when it would change nothing. */
function droppable(event: DragEvent, target: GroupTarget): string[] | null {
  if (!drag || !event.dataTransfer?.types.includes(DRAG_MIME)) return null;
  const current = store.sessionGroups.value;
  return moveSessions(current, target, drag.keys) === current ? null : drag.keys;
}

/** `$A1`. */
function onDragOver(event: DragEvent, target: GroupTarget): void {
  if (!droppable(event, target)) {
    if (dropTarget.value && sameTarget(dropTarget.value, target)) dropTarget.value = null;
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  if (!dropTarget.value || !sameTarget(dropTarget.value, target)) dropTarget.value = target;
}

/** `JA1`: leaving for a child of the header is not leaving. */
function onDragLeave(event: DragEvent, target: GroupTarget): void {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  if (event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom) return;
  if (dropTarget.value && sameTarget(dropTarget.value, target)) dropTarget.value = null;
}

/** `ZA1`. */
function onDrop(event: DragEvent, target: GroupTarget): void {
  const state = drag;
  const keys = droppable(event, target);
  if (!state || !keys || event.dataTransfer?.getData(DRAG_MIME) !== state.nonce) {
    endDrag();
    return;
  }
  event.preventDefault();
  endDrag();
  moveTo(target, keys);
}

/* ------------------------------------------------------------ rows' props */

function rowProps(row: Row) {
  const index = visible.value.indexOf(row);
  const key = keyOf(row);
  const renaming = renamingId.value !== null && renamingId.value === row.sessionId.value;
  return {
    id: rowId(row, index),
    rowRef: (el: HTMLElement | null) => {
      if (el) rowEls.set(index, el);
      else rowEls.delete(index);
    },
    title: title(row),
    time: row.lastModifiedTime.value,
    isActive: isActive(row),
    isFocused: index === focusedIndex.value,
    isSelected: key !== undefined && selected.value.has(key),
    isRenaming: renaming,
    searchQuery: query.value,
    draggable: grouping.value && key !== undefined && !renaming && !isArchived(row),
    // `S`: a brand-new active conversation with nothing in it has no actions.
    blank: isActive(row) && !row.summary.value && !row.messages.value.length,
    canRename: !!row.sessionId.value,
    canArchive: !isArchived(row),
    canUnarchive: isArchived(row),
    openState: openStateOf(row),
  };
}

function rowHandlers(row: Row) {
  return {
    click: (event: MouseEvent) => clickRow(event, row),
    contextmenu: groupsOn.value && keyOf(row) ? (event: MouseEvent) => openRowMenu(event, row) : undefined,
    focus: () => (focusedIndex.value = visible.value.indexOf(row)),
    mousemove: () => (focusedIndex.value = visible.value.indexOf(row)),
    modifiedEnter: (event: KeyboardEvent) => clickRow(event, row),
    dragstart: (event: DragEvent) => onDragStart(event, row),
    dragend: endDrag,
    startRename: () => startRename(row),
    finishRename: (text: string) => finishRename(row, text),
    cancelRename: () => (renamingId.value = null),
    archive: () => archive(row),
    unarchive: () => unarchive(row),
  };
}

/* -------------------------------------------------- the search box */

const rootEl = ref<HTMLElement | null>(null);
const searchEl = ref<HTMLInputElement | null>(null);
const searchBoxEl = ref<HTMLElement | null>(null);

/** `N0`: reveal the box, optionally typing the key that revealed it. */
function revealSearch(typed?: string): void {
  if (typed) query.value += typed;
  searchRevealed.value = true;
  void nextTick(() => {
    const input = searchEl.value;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

/** `y6`: clear and fold it; focus goes back to the list if it was inside. */
function clearSearch(): void {
  const inside = searchBoxEl.value?.contains(document.activeElement) === true;
  query.value = '';
  searchRevealed.value = false;
  if (inside) rootEl.value?.focus({ preventScroll: true });
}

/**
 * The box folds away when it loses focus empty, but not mid-click: the
 * official waits for the pointer to come up (a click on a row would otherwise
 * move the row out from under the pointer).
 */
let pointerDown = false;
let foldAfterPointerUp = false;
function foldIfIdle(): void {
  if (searchEl.value && searchEl.value.value === '' && searchBoxEl.value?.contains(document.activeElement) !== true) searchRevealed.value = false;
}
function onSearchBlur(event: FocusEvent): void {
  if (!props.listOnly || query.value !== '') return;
  const next = event.relatedTarget;
  if (next instanceof Node && (event.currentTarget as HTMLElement).contains(next)) return;
  if (pointerDown) foldAfterPointerUp = true;
  else searchRevealed.value = false;
}
const onPointerDown = () => {
  pointerDown = true;
};
const onPointerUp = () => {
  pointerDown = false;
  if (foldAfterPointerUp) {
    foldAfterPointerUp = false;
    setTimeout(foldIfIdle, 0);
  }
};

/** `W95`. */
function onButtonKey(event: KeyboardEvent, run: () => void): void {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  event.stopPropagation();
  run();
}

/** `YW0`: not while typing in a field. */
function outsideField(event: KeyboardEvent): boolean {
  const target = event.target;
  return !(target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable));
}

/** `H95`: a printable key typed on the list starts a search. */
function typedChar(event: KeyboardEvent): string | null {
  if (!event.getModifierState('AltGraph') && (event.ctrlKey || event.altKey || event.metaKey)) return null;
  if ([...event.key].length !== 1 || event.key === ' ') return null;
  return outsideField(event) ? event.key : null;
}

/** `kW0`. */
function onKeyDown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) {
    if (props.listOnly && outsideField(event)) revealSearch();
    return;
  }
  if (renamingId.value || renamingGroupId.value) return;
  if (menu.value) return;
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      moveFocus(1);
      break;
    case 'ArrowUp':
      event.preventDefault();
      moveFocus(-1);
      break;
    case 'Enter': {
      if (event.target !== event.currentTarget && event.target !== searchEl.value) break;
      event.preventDefault();
      const row = visible.value[focusedIndex.value];
      if (row && !event.repeat) clickRow(event, row);
      break;
    }
    case 'Escape':
      if (props.listOnly && searchShown.value) {
        event.preventDefault();
        event.stopPropagation();
        clearSearch();
      } else if (query.value) {
        event.preventDefault();
        event.stopPropagation();
        query.value = '';
      } else if (selected.value.size > 0) {
        event.preventDefault();
        event.stopPropagation();
        clearSelection();
      }
      break;
    default: {
      const typed = props.listOnly ? typedChar(event) : null;
      if (typed !== null) {
        event.preventDefault();
        revealSearch(typed);
      }
    }
  }
}

/** `SG`: focus the search box, or the list when the box is folded away. */
function focusList(): void {
  (searchEl.value ?? rootEl.value)?.focus({ preventScroll: true });
}
const onWindowFocus = () =>
  setTimeout(() => {
    if (!document.activeElement || document.activeElement === document.body) focusList();
  }, 0);

// Scroll to, and focus, the open conversation's row when it appears.
watch(
  [activeRaw, () => props.loaded],
  () => {
    const at = visible.value.findIndex((row) => row.raw === activeRaw.value);
    if (at < 0 || !activeRaw.value) return;
    focusedIndex.value = at;
    setTimeout(() => rowEls.get(at)?.scrollIntoView({ block: 'nearest', behavior: 'instant' as ScrollBehavior }), 0);
  },
  { immediate: true }
);

onMounted(() => {
  if (props.autoFocusSearch) setTimeout(focusList, 0);
  if (props.listOnly) {
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);
    if (props.autoFocusSearch) window.addEventListener('focus', onWindowFocus);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown, true);
  document.removeEventListener('pointerup', onPointerUp, true);
  document.removeEventListener('pointercancel', onPointerUp, true);
  window.removeEventListener('focus', onWindowFocus);
});

defineExpose({ focusList });
</script>
