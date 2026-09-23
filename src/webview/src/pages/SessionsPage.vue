<template>
  <!--
    The official Claude Code sessions list.

    Compact 28px rows rather than cards, grouped by recency under collapsible
    headers with count badges. Each row's trailing cell is a single grid area
    holding both the timestamp and the row actions: the time hides on hover and
    the actions take its place, so the row never reflows as the pointer moves
    across it.
  -->
  <div class="fg-sessions__root">
    <!--
      The chat header's own icon buttons and glyphs, so the two headers are one
      family: the official search and new-session marks rather than codicons.
    -->
    <div class="fg-shell__header">
      <button
        type="button"
        class="fg-iconbutton__iconButton fg-iconbutton__iconButton20"
        title="Back to chat"
        aria-label="Back to chat"
        @click="$emit('switchToChat')"
      >
        <span class="codicon codicon-arrow-left" aria-hidden="true" />
      </button>
      <div class="fg-shell__titleGroup">
        <span class="fg-shell__titleText"><span class="fg-shell__titleTextInner">Past conversations</span></span>
      </div>
      <div class="fg-shell__headerSpacer" />
      <button
        type="button"
        class="fg-iconbutton__iconButton fg-iconbutton__iconButton20"
        :class="{ 'fg-sessions__filterToggleOn': showSearch }"
        title="Search"
        aria-label="Search conversations"
        :aria-pressed="showSearch"
        @click="toggleSearch"
      >
        <SearchIcon />
      </button>
      <button
        type="button"
        class="fg-iconbutton__iconButton fg-iconbutton__iconButton20"
        title="New conversation"
        aria-label="New conversation"
        @click="createNewSession"
      >
        <NewSessionIcon />
      </button>
    </div>

    <div class="fg-sessions__content custom-scroll-container">
      <div v-if="showSearch" class="fg-sessions__searchRow">
        <div class="fg-sessions__searchBox">
          <span class="codicon codicon-search fg-sessions__searchIcon" aria-hidden="true" />
          <input
            ref="searchInput"
            v-model="searchQuery"
            type="text"
            placeholder="Search conversations"
            class="fg-sessions__searchInput"
            :class="{ 'fg-sessions__searchInputClearable': searchQuery }"
            aria-label="Search conversations"
            @keydown.escape="hideSearch"
          >
          <button
            v-if="searchQuery"
            class="fg-sessions__searchClearButton"
            aria-label="Clear search"
            @click="searchQuery = ''"
          >
            <span class="codicon codicon-close fg-sessions__searchClearIcon" />
          </button>
        </div>
      </div>

      <!--
        Three states before there is a list, and each one ends: the host always
        answers (an empty store is an empty list), and a request that goes
        unanswered anyway times out into the error state rather than spinning.
        A list already on screen is not replaced by "Loading" while it refreshes.
      -->
      <div v-if="loading && sessionList.length === 0" class="fg-sessions__nullState" role="status">
        <span class="fg-sessions__nullStateText">Loading conversations…</span>
      </div>

      <div v-else-if="error && sessionList.length === 0" class="fg-sessions__nullState forge-sessions__state" role="alert">
        <span class="fg-sessions__nullStateText">Couldn’t load conversations.</span>
        <span class="forge-sessions__stateDetail">{{ error }}</span>
        <button type="button" class="forge-sessions__stateButton" @click="refreshSessions">
          Retry
        </button>
      </div>

      <div v-else-if="filteredSessions.length === 0 && searchQuery" class="fg-sessions__nullState">
        <span class="fg-sessions__nullStateText">No conversations match that search.</span>
      </div>

      <div v-else-if="filteredSessions.length === 0" class="fg-sessions__nullState forge-sessions__state">
        <span class="fg-sessions__nullStateText">No conversations yet</span>
        <button type="button" class="forge-sessions__stateButton forge-sessions__stateButton--primary" @click="startNewChat">
          Start a conversation
        </button>
      </div>

      <template v-else>
        <template v-for="group in sessionGroups" :key="group.id">
          <button
            v-if="group.sessions.length"
            class="fg-sessions__groupHeader"
            :aria-expanded="!collapsedGroups.has(group.id)"
            @click="toggleGroup(group.id)"
          >
            <svg
              class="fg-sessions__groupChevron"
              :class="{ 'fg-sessions__groupChevronExpanded': !collapsedGroups.has(group.id) }"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span class="fg-sessions__groupName">{{ group.label }}</span>
            <span class="fg-sessions__groupCount">{{ group.sessions.length }}</span>
          </button>

          <div v-if="!collapsedGroups.has(group.id)" class="fg-sessions__sessionsList">
            <button
              v-for="(session, index) in group.sessions"
              :key="session.sessionId.value || `${group.id}-${index}`"
              class="fg-sessions__sessionItem"
              @click="openSession(session)"
            >
              <!--
                The official dot (`vG`), the row's first child. It replaces
                Forge's own `.fg-sessions__unreadDot`, which was not an official
                element and carried a scoped rule of its own (step 22).
              -->
              <StatusDot
                v-if="openState(session)"
                :state="openState(session)!"
                :title="openStateTitle(openState(session)!)"
              />
              <span class="fg-sessions__sessionName">
                {{ session.summary.value || 'New Conversation' }}
              </span>
              <span class="fg-sessions__sessionMeta">
                <span class="fg-sessions__sessionTime">
                  {{ formatRelativeTime(session.lastModifiedTime.value) }}
                </span>
                <span class="fg-sessions__sessionActions">
                  <span
                    v-if="session.sessionId.value && unreadSessionKeys !== undefined"
                    class="fg-sessions__actionButton"
                    role="button"
                    tabindex="0"
                    :title="isUnread(session) ? 'Mark as read' : 'Mark as unread'"
                    @click.stop="toggleUnread(session)"
                    @keydown.enter.stop="toggleUnread(session)"
                  >
                    <UnreadIcon class="fg-sessions__actionIcon" />
                  </span>
                </span>
              </span>
            </button>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, inject, watch } from 'vue';
import { useSignal } from '@gn8/alien-signals-vue';
import { transport } from '../core/runtimeTransport';
import { Motion } from 'motion-v';
import Icon from '../components/Icon.vue';
import { RuntimeKey } from '../composables/runtimeContext';
import { useSessionStore } from '../composables/useSessionStore';
import { useSession } from '../composables/useSession';
import type { Session } from '../core/Session';
import StatusDot from '../components/forge/StatusDot.vue';
import UnreadIcon from '../components/forge/icons/UnreadIcon.vue';
import SearchIcon from '../components/forge/icons/SearchIcon.vue';
import NewSessionIcon from '../components/forge/icons/NewSessionIcon.vue';
import { formatRelativeTime } from '../utils/relativeTime';
import {
  feedHasSession,
  openStateFor,
  openStateTitle,
  sessionKey,
} from '../core/sessionStates';

// 注入运行时
const runtime = inject(RuntimeKey);
if (!runtime) {
  throw new Error('[SessionsPage] runtime not provided');
}

// 🔥 使用 useSessionStore 包装为 Vue-friendly API
const store = useSessionStore(runtime.sessionStore);

// 🔥 视图模型：将 alien-signals Session 转换为 Vue-friendly 包装
// Past conversations only: a draft with no id and nothing in it is not one yet,
// so an empty history reads "No conversations yet" rather than listing it.
const sessionList = computed(() => {
  const rawSessions = (store.sessionsByLastModified.value || []).filter(
    (s): s is Session => !!s && (!!s.sessionId() || s.messages().length > 0)
  );
  return rawSessions.map(raw => useSession(raw));
});

const props = defineProps<{
  /**
   * This is the sessions view in its own side bar, not the page inside a chat.
   * It has no conversation of its own: starting one hands off to the chat.
   */
  standalone?: boolean;
}>();

// 定义事件
const emit = defineEmits<{
  switchToChat: [sessionId?: string];
}>();

// 组件状态
const loading = ref(true);
const error = ref('');
const searchQuery = ref('');
const showSearch = ref(false);
const searchInput = ref<HTMLInputElement | null>(null);


// 计算属性：过滤和排序会话列表
const filteredSessions = computed(() => {
  let sessions = [...sessionList.value];

  // 搜索过滤
  const query = searchQuery.value.trim().toLowerCase();
  if (query) {
    sessions = sessions.filter(session => {
      const summary = (session.summary.value || '').toLowerCase();
      const sessionId = (session.sessionId.value || '').toLowerCase();
      return summary.includes(query) || sessionId.includes(query);
    });
  }

  // 已经通过 sessionsByLastModified 按时间倒序排序，无需再排序
  return sessions;
});

// 方法
const refreshSessions = async () => {
  loading.value = true;
  error.value = '';

  try {
    // Bounded inside the store, so this always settles: a list, or an error.
    await store.listSessions();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
};


const openSession = (wrappedSession: ReturnType<typeof useSession> | undefined) => {
  if (!wrappedSession) return;
  // 🔥 从包装对象中获取原始 Session 实例
  const rawSession = wrappedSession.__session;
  // Opening a conversation clears its unread mark, the way opening a message
  // does. The official clears through the same request, so the host's feed is
  // what updates the dot -- nothing is flipped locally first.
  const key = sessionKey(wrappedSession.sessionId.value);
  if (key && isUnread(wrappedSession)) void store.setSessionUnread(key, false);
  store.setActiveSession(rawSession);
  emit('switchToChat', wrappedSession.sessionId.value);
};


const createNewSession = async () => {
  // The standalone view asks the chat for a new conversation instead of
  // starting one here, where nothing would ever send it.
  if (props.standalone) {
    emit('switchToChat');
    return;
  }
  // 🔥 使用包装后的方法（返回原始 Session）
  const rawSession = await store.createSession({ isExplicit: true });
  store.setActiveSession(rawSession);
  // 🔥 访问 alien-signals 需要函数调用
  emit('switchToChat', rawSession.sessionId());
};

const startNewChat = () => {
  emit('switchToChat');
};

// 搜索功能
const toggleSearch = async () => {
  showSearch.value = !showSearch.value;
  if (showSearch.value) {
    await nextTick();
    searchInput.value?.focus();
  } else {
    searchQuery.value = '';
  }
};

const hideSearch = () => {
  showSearch.value = false;
  searchQuery.value = '';
};

// 生命周期
onMounted(() => {
  refreshSessions();
});

// Shown again after being hidden: read the list again, since whatever changed
// meanwhile may have been pushed while this view was not listening.
const visible = useSignal(transport.isVisible);
watch(visible, (now, before) => {
  if (now && before === false) void refreshSessions();
});

// ---- Recency grouping ------------------------------------------------------
// The official list groups conversations by how recently they were touched and
// lets each group collapse, so a long history stays navigable. Boundaries are
// computed against local midnight rather than fixed 24h windows, so "Yesterday"
// means the calendar day, which is what a reader expects.

interface SessionGroup {
  id: string;
  label: string;
  sessions: Array<ReturnType<typeof useSession>>;
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const sessionGroups = computed<SessionGroup[]>(() => {
  const today = startOfToday();
  const day = 24 * 60 * 60 * 1000;

  const buckets: SessionGroup[] = [
    { id: 'today', label: 'Today', sessions: [] },
    { id: 'yesterday', label: 'Yesterday', sessions: [] },
    { id: 'week', label: 'Previous 7 days', sessions: [] },
    { id: 'month', label: 'Previous 30 days', sessions: [] },
    { id: 'older', label: 'Older', sessions: [] },
  ];

  for (const session of filteredSessions.value) {
    const ts = Number(session.lastModifiedTime.value) || 0;
    if (ts >= today) buckets[0].sessions.push(session);
    else if (ts >= today - day) buckets[1].sessions.push(session);
    else if (ts >= today - 7 * day) buckets[2].sessions.push(session);
    else if (ts >= today - 30 * day) buckets[3].sessions.push(session);
    else buckets[4].sessions.push(session);
  }

  return buckets.filter((b) => b.sessions.length > 0);
});

const collapsedGroups = ref(new Set<string>());

function toggleGroup(id: string): void {
  const next = new Set(collapsedGroups.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsedGroups.value = next;
}

// ---- Unread marking (step 22) ----------------------------------------------
// Unread used to live in ~/.forge.json under `unreadSessionIds`, written from
// here. It now lives on the host, in `globalState` under
// `sessionUnread:<scope root>`, exactly where the official keeps it, and
// arrives as the `session_states_update` feed. This page only reads the feed
// and sends `set_session_unread`; the list on the dropdown reads the same one,
// so the two surfaces can no longer disagree.

/** The official `e0` / `c5`, as Sets; undefined until the host answers. */
const openIds = computed(() =>
  store.openSessionIds.value ? new Set(store.openSessionIds.value) : undefined
);
const unreadKeys = computed(() =>
  store.unreadSessionKeys.value ? new Set(store.unreadSessionKeys.value) : undefined
);
const unreadSessionKeys = computed(() => store.unreadSessionKeys.value);

type Row = ReturnType<typeof useSession>;

const inFeed = (session: Row, feed: ReadonlySet<string> | undefined) =>
  feedHasSession(session.sessionId.value, false, undefined, feed);

function isUnread(session: Row): boolean {
  return inFeed(session, unreadKeys.value);
}

/** The official `a6`; see SessionsDropdown.vue for the ported source. */
function openState(session: Row) {
  if (!openIds.value && !unreadKeys.value) return undefined;
  return openStateFor(
    inFeed(session, openIds.value),
    session.busy.value,
    session.permissionRequests.value.length > 0,
    isUnread(session)
  );
}

function toggleUnread(session: Row): void {
  const key = sessionKey(session.sessionId.value);
  if (!key) return;
  void store.setSessionUnread(key, !isUnread(session));
}
</script>

<style scoped>
/*
  Layout and states come from the ported official stylesheet
  (styles/official/sessions.css). What remains here is the hover/active
  behaviour the official build expresses through runtime classes.
*/
.fg-sessions__content {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  padding: 4px 6px 12px;
}

.fg-sessions__sessionItem:hover,
.fg-sessions__groupHeader:hover {
  background: var(--app-list-hover-background);
}

.fg-sessions__sessionItem:focus-visible,
.fg-sessions__groupHeader:focus-visible {
  outline: 1px solid var(--focus-ring-color);
  outline-offset: -1px;
}

/*
  Time and actions occupy the same grid cell, so swapping them on hover cannot
  change the row's width and make the list twitch under the pointer.
*/
.fg-sessions__sessionMeta > * {
  grid-area: 1 / 1;
}

.fg-sessions__sessionActions {
  display: flex;
  align-items: center;
  gap: 2px;
  visibility: hidden;
}

.fg-sessions__sessionItem:hover .fg-sessions__sessionActions,
.fg-sessions__sessionItem:focus-within .fg-sessions__sessionActions {
  visibility: visible;
}

.fg-sessions__actionButton {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--corner-radius-small);
  color: var(--app-secondary-foreground);
  cursor: pointer;
}

.fg-sessions__actionButton:hover {
  background: var(--app-ghost-button-hover-background);
  color: var(--app-primary-foreground);
}

.fg-sessions__actionIcon {
  font-size: 13px;
}

/*
  The unread dot and its bold row name used to be defined here, over official
  elements. Both are gone: the dot is the official `vG` component with the
  official module's own rules (styles/official/statusdot.css), and the official
  does not bold an unread row's name. Step 22.
*/

.fg-sessions__searchBox {
  align-items: center;
}

.fg-sessions__searchIcon {
  position: absolute;
  left: 6px;
  font-size: 13px;
  color: var(--app-secondary-foreground);
  pointer-events: none;
}

.fg-sessions__searchInput {
  flex: 1;
  min-width: 0;
  padding: 4px 6px 4px 24px;
  border: 1px solid var(--app-input-border);
  border-radius: var(--corner-radius-small);
  background: var(--app-input-background);
  color: var(--app-input-foreground);
  font: inherit;
  outline: none;
}

.fg-sessions__searchInput:focus {
  border-color: var(--focus-ring-color);
}

.fg-sessions__searchInputClearable {
  padding-right: 24px;
}

.fg-sessions__searchClearButton {
  position: absolute;
  right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--app-secondary-foreground);
  cursor: pointer;
}

.fg-sessions__searchClearIcon {
  font-size: 12px;
}

.fg-sessions__nullState {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 32px 16px;
  color: var(--app-secondary-foreground);
  text-align: center;
}

.fg-sessions__nullStateLink {
  border: none;
  background: transparent;
  color: var(--app-link-color);
  cursor: pointer;
  font: inherit;
}

.fg-sessions__nullStateLink:hover {
  text-decoration: underline;
}

/*
 * The empty and error states' own pieces. Forge-only classes, so no ported
 * `fg-sessions__*` rule is overridden: the text keeps the official null-state
 * styling, and these add the detail line and the one action each state offers.
 */
.forge-sessions__state {
  gap: 10px;
}

.forge-sessions__stateDetail {
  max-width: 32em;
  font-size: 0.9em;
  opacity: 0.8;
  overflow-wrap: anywhere;
}

.forge-sessions__stateButton {
  border: 1px solid var(--app-transparent-inner-border);
  border-radius: 4px;
  background: transparent;
  color: var(--app-primary-foreground);
  cursor: pointer;
  font: inherit;
  font-weight: 500;
  padding: 5px 12px;
  transition: background-color 120ms ease-out, border-color 120ms ease-out;
}

.forge-sessions__stateButton:hover {
  background: var(--app-ghost-button-hover-background);
}

.forge-sessions__stateButton--primary {
  background: var(--forge-brand-strong);
  border-color: transparent;
  color: var(--forge-on-brand);
}

.forge-sessions__stateButton--primary:hover {
  background: color-mix(in srgb, var(--forge-brand-strong) 88%, var(--forge-on-brand));
}

.forge-sessions__stateButton:focus-visible {
  outline: 1px solid var(--forge-focus-ring);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .forge-sessions__stateButton {
    transition: none;
  }
}

.fg-sessions__groupName {
  flex: 1;
  overflow: hidden;
  color: var(--app-secondary-foreground);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  font-size: 0.9em;
}

.fg-sessions__groupChevron {
  transition: transform 0.15s;
}

.fg-sessions__groupChevronExpanded {
  transform: rotate(90deg);
}
</style>
