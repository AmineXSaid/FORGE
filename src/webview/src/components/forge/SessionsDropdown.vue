<template>
  <!--
    The official "Past conversations" dropdown (reference `QW0` wrapping the
    sessions list `At`; modules Wc_2Bg + OOQiHg + 90gk3A).

    Copied from the bundle, with one intentional omission: the Local / Web
    segmented control. The official itself renders it only for claude.ai
    accounts (`s = authMethod === "claudeai"`); Forge has local sessions only.

    Configuration matches how QW0 mounts the list: not `isSessionListOnly`, so the
    search box is always shown and there is no clear button, status filter or
    "New group" button; the search input is focused on open.
  -->
  <Teleport to="body">
    <div class="fg-sessionsdropdown__overlay" @mousedown.prevent="emit('close')"></div>
    <div
      ref="dropdownEl"
      class="fg-sessionsdropdown__dropdown"
      :style="position"
      role="dialog"
      aria-label="Past conversations"
      tabindex="-1"
      @keydown="onDropdownKeyDown"
    >
      <div class="fg-sessions__root" @keydown="onListKeyDown">
        <div class="fg-sessions__searchRow">
          <div class="fg-sessions__searchBox">
            <SearchIcon class="fg-sessions__searchIcon" />
            <input
              ref="searchEl"
              v-model="query"
              type="text"
              placeholder="Search sessions…"
              class="fg-filter__filterInput fg-sessions__searchInput"
              :aria-controls="contentId"
              :aria-activedescendant="focusedId"
            />
          </div>
          <div class="fg-sessions__searchRowActions"></div>
          <span class="fg-sessions__searchRowTail"></span>
        </div>
        <div :id="contentId" class="fg-sessions__content">
          <div v-if="!loaded" class="fg-sessions__disconnectedState">
            <div class="fg-sessions__disconnectedText">Loading sessions…</div>
          </div>
          <div v-else-if="!sessions.length" class="fg-sessions__nullState">
            <div class="fg-sessions__nullStateText">No sessions yet</div>
          </div>
          <div v-else-if="!filtered.length" class="fg-sessions__emptyState">No sessions found</div>
          <div v-else class="fg-sessions__sessionsList">
            <!--
              The official list body: the ungrouped rows, then an "Archived
              sessions" group header (`uF1`) with the archived rows under it.
              Groups themselves are out of Forge's scope, so there is no group
              loop and no "Ungrouped" header -- which is what the official also
              renders when no group exists (`q1` is false).
            -->
            <template v-for="item in items" :key="item.key">
              <button
                v-if="item.kind === 'header'"
                class="fg-sessions__groupHeader"
                :title="query ? 'Archived sessions' : archivedCollapsed ? 'Expand Archived sessions' : 'Collapse Archived sessions'"
                @click="query ? undefined : (archivedCollapsed = !archivedCollapsed)"
                @keydown="onHeaderKeyDown"
              >
                <!--
                  `<uF1 collapsed={n} …>` with `n = !V1 && k1.archivedCollapsed`:
                  a search expands the section, so the chevron follows `n`, not
                  the stored flag.
                -->
                <GroupChevronIcon
                  class="fg-sessions__groupChevron"
                  :class="{ 'fg-sessions__groupChevronExpanded': !archivedHidden }"
                />
                <span class="fg-sessions__groupName">Archived sessions</span>
                <span class="fg-sessions__groupCount">{{ archivedRows.length }}</span>
              </button>
              <button
                v-else
                :id="rowId(item.index)"
                :ref="(el) => { if (el) rowEls[item.index] = el as HTMLElement }"
                class="fg-sessions__sessionItem"
                :class="{
                  'fg-sessions__active': isActive(item.session!),
                  'fg-sessions__focused': item.index === focusedIndex,
                }"
                @click="isRenaming(item.session!) ? undefined : open(item.session!)"
                @focus="focusedIndex = item.index"
                @mousemove="focusedIndex = item.index"
              >
                <!--
                  `T&&F(vG,{state:T,ring:E!==void 0&&T!=="unread",title:dH0(T,E)})`
                  -- the first child of the row button, before the name, and
                  absent entirely when `openState` is undefined. Forge never has
                  an "elsewhere" session, so the ring is never drawn.
                -->
                <StatusDot
                  v-if="openState(item.session!)"
                  :state="openState(item.session!)!"
                  :title="openStateTitle(openState(item.session!)!)"
                />
                <span
                  v-if="isRenaming(item.session!)"
                  :key="'edit'"
                  ref="editorEl"
                  class="fg-sessions__sessionName fg-sessions__sessionNameEditing"
                  contenteditable="true"
                  @keydown="onEditorKeyDown($event, item.session!)"
                  @blur="finishRename(item.session!, ($event.target as HTMLElement).textContent || '')"
                  @click.stop
                >{{ title(item.session!) }}</span>
                <span v-else :key="'view'" class="fg-sessions__sessionName">
                  <template v-for="(part, pi) in highlight(title(item.session!), query)" :key="pi">
                    <mark v-if="part.match" class="fg-sessions__highlight">{{ part.text }}</mark>
                    <template v-else>{{ part.text }}</template>
                  </template>
                </span>
                <span class="fg-sessions__sessionMeta">
                  <span class="fg-sessions__sessionTime">{{ relativeTime(item.session!.lastModifiedTime.value) }}</span>
                  <span
                    v-if="!isRenaming(item.session!) && !isBlankActive(item.session!)"
                    class="fg-sessions__sessionActions"
                  >
                    <span
                      v-if="item.session!.sessionId.value"
                      role="button"
                      tabindex="0"
                      class="fg-sessions__actionButton"
                      title="Rename session"
                      @click.stop="startRename(item.session!)"
                      @keydown="onActionKeyDown($event, () => startRename(item.session!))"
                    >
                      <RenameIcon class="fg-sessions__actionIcon" />
                    </span>
                    <!--
                      The official's `mH0` row, as a row action: its label is
                      `G?"Mark as unread":"Mark as read"` with
                      `G = !selectionIsUnread`. Only shown once the feed is
                      ready and the row has an id to key on.
                    -->
                    <span
                      v-if="item.session!.sessionId.value && unreadSessionKeys !== undefined"
                      role="button"
                      tabindex="0"
                      class="fg-sessions__actionButton"
                      :title="isUnread(item.session!) ? 'Mark as read' : 'Mark as unread'"
                      @click.stop="toggleUnread(item.session!)"
                      @keydown="onActionKeyDown($event, () => toggleUnread(item.session!))"
                    >
                      <UnreadIcon class="fg-sessions__actionIcon" />
                    </span>
                    <span
                      v-if="!item.session!.archived.value"
                      role="button"
                      tabindex="0"
                      class="fg-sessions__actionButton"
                      title="Archive session"
                      @click.stop="archive(item.session!)"
                      @keydown="onActionKeyDown($event, () => archive(item.session!))"
                    >
                      <ArchiveIcon class="fg-sessions__actionIcon" />
                    </span>
                    <span
                      v-else
                      role="button"
                      tabindex="0"
                      class="fg-sessions__actionButton"
                      title="Unarchive session"
                      @click.stop="unarchive(item.session!)"
                      @keydown="onActionKeyDown($event, () => unarchive(item.session!))"
                    >
                      <UnarchiveIcon class="fg-sessions__actionIcon" />
                    </span>
                  </span>
                </span>
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, inject, onMounted, nextTick, watch } from 'vue';
import SearchIcon from './icons/SearchIcon.vue';
import RenameIcon from './icons/RenameIcon.vue';
import ArchiveIcon from './icons/ArchiveIcon.vue';
import UnarchiveIcon from './icons/UnarchiveIcon.vue';
import GroupChevronIcon from './icons/GroupChevronIcon.vue';
import UnreadIcon from './icons/UnreadIcon.vue';
import StatusDot from './StatusDot.vue';
import {
  feedHasSession,
  openStateFor,
  openStateTitle,
  sessionKey,
} from '../../core/sessionStates';
import { RuntimeKey } from '../../composables/runtimeContext';
import { useSessionStore } from '../../composables/useSessionStore';
import { useSession } from '../../composables/useSession';
import type { Session } from '../../core/Session';

const props = defineProps<{ anchor: HTMLElement | null }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const runtime = inject(RuntimeKey)!;
const store = useSessionStore(runtime.sessionStore);

const loaded = ref(false);
const query = ref('');
const focusedIndex = ref(0);
const searchEl = ref<HTMLInputElement | null>(null);
const dropdownEl = ref<HTMLElement | null>(null);
const rowEls: HTMLElement[] = [];
const uid = Math.random().toString(36).slice(2, 8);
const contentId = `forge-sessions-${uid}`;
const rowId = (i: number) => `${contentId}-row-${i}`;
const focusedId = computed(() => (visibleRows.value.length ? rowId(focusedIndex.value) : undefined));

const sessions = computed(() =>
  ((store.sessionsByLastModified.value || []).filter(Boolean) as Session[]).map((raw) => ({
    ...useSession(raw),
    raw,
  }))
);

/**
 * The open conversation, compared by identity. Comparing ids marked every row
 * active whenever the open conversation had no id yet: undefined === undefined.
 */
const activeRaw = computed(() => store.activeSession.value);
const isActive = (session: { raw: Session }) => session.raw === activeRaw.value;

/** The official title: the summary, or "Untitled" (its `kR`). */
const title = (s: ReturnType<typeof useSession>) => s.summary.value || 'Untitled';

/** The official search: case-insensitive substring of the title (its `KZ`). */
const filtered = computed(() => {
  const q = query.value.toLowerCase();
  return q ? sessions.value.filter((s) => title(s).toLowerCase().includes(q)) : sessions.value;
});
watch(query, () => { focusedIndex.value = 0; });

/* -------------------------------------------------- archived (`b_1` / `uF1`) */

/**
 * The official split: archived rows are pulled out of the list first
 * (`b_1($,J,Z,BZ)` puts anything matching `BZ($)=$.archived.value` into
 * `archived`), and rendered under their own header.
 */
const liveRows = computed(() => filtered.value.filter((s) => !s.archived.value));
const archivedRows = computed(() => filtered.value.filter((s) => s.archived.value));

/**
 * `zF = {ungroupedCollapsed:!1, archivedCollapsed:!0}` -- the section starts
 * collapsed. The official keeps it in `update_session_section_collapse_state`
 * when the host offers that request and in component state otherwise
 * (`D0`: `if(_&&T) T(X1); else s5(...)`). Forge takes the second path, which is
 * the official's own fallback.
 */
const archivedCollapsed = ref(true);

/** `n = !V1 && k1.archivedCollapsed`: a search always expands the section. */
const archivedHidden = computed(() => !query.value && archivedCollapsed.value);

type Row = ReturnType<typeof useSession> & { raw: Session };
interface ListItem { kind: 'row' | 'header'; key: string; index: number; session?: Row }

/** `H1`, plus the header, in render order. `index` is the keyboard index. */
const items = computed<ListItem[]>(() => {
  const out: ListItem[] = [];
  liveRows.value.forEach((session, i) =>
    out.push({ kind: 'row', key: `row-${session.sessionId.value ?? i}`, index: i, session })
  );
  if (archivedRows.value.length > 0) {
    out.push({ kind: 'header', key: 'archived-header', index: -1 });
    if (!archivedHidden.value) {
      archivedRows.value.forEach((session, i) =>
        out.push({
          kind: 'row',
          key: `archived-${session.sessionId.value ?? i}`,
          index: liveRows.value.length + i,
          session,
        })
      );
    }
  }
  return out;
});

/** `H1`: the rows the keyboard walks, in the order they are rendered. */
const visibleRows = computed(() =>
  items.value.filter((item) => item.kind === 'row').map((item) => item.session!)
);
watch(archivedHidden, () => { focusedIndex.value = 0; });

/* ------------------------------------------------- status dot (step 22) */

/**
 * The official `e0` / `c5`: each feed as a Set, or undefined while the host has
 * not answered. `Z5` (live elsewhere) has no Forge equivalent.
 */
const openIds = computed(() =>
  store.openSessionIds.value ? new Set(store.openSessionIds.value) : undefined
);
const unreadKeys = computed(() =>
  store.unreadSessionKeys.value ? new Set(store.unreadSessionKeys.value) : undefined
);
/** Read in the template to decide whether the toggle is shown at all. */
const unreadSessionKeys = computed(() => store.unreadSessionKeys.value);

/** The official `A4`: is this row in that feed? */
const inFeed = (session: Row, feed: ReadonlySet<string> | undefined) =>
  feedHasSession(session.sessionId.value, false, undefined, feed);

const isUnread = (session: Row) => inFeed(session, unreadKeys.value);

/**
 * The official `a6`:
 *
 *   if(!e0&&!c5&&!Z5) return;
 *   return lH0(A4(X1,e0),X1.busy.value,X1.pendingInput.value,A4(X1,c5),X9(X1)?.activity)
 *
 * Forge has no `pendingInput` signal; the official's own state reporter uses
 * `permissionRequests.value.length>0` for "awaiting input", so that is what
 * stands in for it here.
 */
function openState(session: Row) {
  if (!openIds.value && !unreadKeys.value) return undefined;
  return openStateFor(
    inFeed(session, openIds.value),
    session.busy.value,
    session.permissionRequests.value.length > 0,
    isUnread(session)
  );
}

/** The official `mH0` unread row: flip the key's membership. */
function toggleUnread(session: Row): void {
  const key = sessionKey(session.sessionId.value);
  if (!key) return;
  void store.setSessionUnread(key, !isUnread(session));
}

/** The official `VA1` / `HA1`: hand the session to the store, which writes it. */
function archive(session: Row): void {
  void store.archiveSession(session.raw);
}
function unarchive(session: Row): void {
  void store.unarchiveSession(session.raw);
}

/** The official `W95`: Enter and Space activate the group header. */
function onHeaderKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (query.value) return;
  event.preventDefault();
  event.stopPropagation();
  archivedCollapsed.value = !archivedCollapsed.value;
}

/** Every match wrapped in <mark>, recursively, like the official `XW0`. */
function highlight(text: string, q: string): Array<{ text: string; match: boolean }> {
  if (!q) return [{ text, match: false }];
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at === -1) return [{ text, match: false }];
  return [
    { text: text.slice(0, at), match: false },
    { text: text.slice(at, at + q.length), match: true },
    ...highlight(text.slice(at + q.length), q),
  ];
}

/** The official relative time (its `K95`): y, mo, d, h, m, or "now". */
function relativeTime(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);
  if (years > 0) return `${years}y`;
  if (months > 0) return `${months}mo`;
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return 'now';
}

/** Anchored 4px under the button, clamped 16px from the edge, as QW0 computes it. */
const position = computed(() => {
  const box = props.anchor?.getBoundingClientRect();
  if (!box) return {};
  const width = document.documentElement.clientWidth;
  return box.left + box.right < width
    ? { top: `${box.bottom + 4}px`, left: `${Math.max(16, box.left)}px` }
    : { top: `${box.bottom + 4}px`, right: `${Math.max(16, width - box.right)}px` };
});

function open(session: ReturnType<typeof useSession>): void {
  store.setActiveSession(session.__session);
  emit('close');
}

/* ------------------------------------------------------------------ rename */

/**
 * The official inline editor (`V95` inside `At`): the row under `l0` swaps its
 * name span for a contenteditable one, focused with its contents selected.
 *
 *   N6 = (s) => { let id = s.sessionId.value; if (id) setRenaming(id) }
 *   B6 = (s, text) => { setRenaming(null); let t = text.trim();
 *                       if (!t || t === kR(s)) return;
 *                       let id = s.sessionId.value; if (id && onRename) onRename(id, t) }
 *   a1 = () => setRenaming(null)
 *
 * so blur commits, an unchanged or empty title sends nothing, and Escape puts
 * the old text back before cancelling.
 */
const renamingId = ref<string | null>(null);
const editorEl = ref<HTMLElement | HTMLElement[] | null>(null);

const isRenaming = (session: Row) =>
  renamingId.value !== null && renamingId.value === session.sessionId.value;

/**
 * The official `S`: a brand-new active conversation with nothing in it yet has
 * no row actions (`Y&&!J.summary.value&&!J.messages.value.length&&...`).
 */
const isBlankActive = (session: Row) =>
  isActive(session) && !session.summary.value && !session.messages.value.length;

function startRename(session: Row): void {
  const id = session.sessionId.value;
  if (id) renamingId.value = id;
}

function finishRename(session: Row, text: string): void {
  if (!isRenaming(session)) return;
  renamingId.value = null;
  const next = text.trim();
  if (!next || next === title(session)) return;
  const id = session.sessionId.value;
  if (id) void store.renameSession(id, next).catch(() => {});
}

function onEditorKeyDown(event: KeyboardEvent, session: Row): void {
  if (event.isComposing) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    (event.target as HTMLElement).blur();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    (event.target as HTMLElement).textContent = title(session);
    renamingId.value = null;
  }
}

/** The official `W95`: Enter and Space activate a `role="button"` span. */
function onActionKeyDown(event: KeyboardEvent, run: () => void): void {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  event.stopPropagation();
  run();
}

// Focus the editor and select its contents, as the official's effect does.
watch(renamingId, async (id) => {
  if (id === null) return;
  await nextTick();
  const el = Array.isArray(editorEl.value) ? editorEl.value[0] : editorEl.value;
  if (!el) return;
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
});

function onListKeyDown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  const rows = visibleRows.value;
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      if (rows.length) focusedIndex.value = (focusedIndex.value + 1) % rows.length;
      void nextTick(() => rowEls[focusedIndex.value]?.scrollIntoView({ block: 'nearest' }));
      break;
    case 'ArrowUp':
      event.preventDefault();
      if (rows.length) focusedIndex.value = (focusedIndex.value - 1 + rows.length) % rows.length;
      void nextTick(() => rowEls[focusedIndex.value]?.scrollIntoView({ block: 'nearest' }));
      break;
    case 'Enter': {
      const row = rows[focusedIndex.value];
      if (row && !event.repeat) { event.preventDefault(); open(row); }
      break;
    }
    case 'Escape':
      // First Escape clears the search; the next one closes the dropdown.
      if (query.value) { event.preventDefault(); event.stopPropagation(); query.value = ''; }
      break;
  }
}

function onDropdownKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.preventDefault(); emit('close'); }
}

onMounted(async () => {
  searchEl.value?.focus();
  try {
    await store.listSessions();
  } finally {
    loaded.value = true;
  }
});
</script>
