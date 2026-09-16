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
    <div class="fg-shell__header">
      <button class="fg-footer__footerButton" title="Back to chat" @click="$emit('switchToChat')">
        <span class="codicon codicon-arrow-left" />
      </button>
      <div class="fg-shell__titleGroup">
        <span class="fg-shell__titleText"><span class="fg-shell__titleTextInner">Past conversations</span></span>
      </div>
      <div class="fg-shell__headerSpacer" />
      <button
        class="fg-footer__footerButton"
        :class="{ 'fg-sessions__filterToggleOn': showSearch }"
        title="Search"
        @click="toggleSearch"
      >
        <span class="codicon codicon-search" />
      </button>
      <button class="fg-footer__footerButton" title="New conversation" @click="createNewSession">
        <span class="codicon codicon-add" />
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

      <div v-if="loading" class="fg-sessions__nullState">
        <span class="fg-sessions__nullStateText">Loading conversations…</span>
      </div>

      <div v-else-if="error" class="fg-sessions__nullState">
        <span class="fg-sessions__nullStateText">{{ error }}</span>
        <button class="fg-sessions__nullStateLink" @click="refreshSessions">Try again</button>
      </div>

      <div v-else-if="filteredSessions.length === 0" class="fg-sessions__nullState">
        <span class="fg-sessions__nullStateText">
          {{ searchQuery ? 'No conversations match that search.' : 'No conversations yet.' }}
        </span>
        <button v-if="!searchQuery" class="fg-sessions__nullStateLink" @click="startNewChat">
          Start a new one
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
              :class="{ 'fg-sessions__unread': isUnread(session) }"
              @click="openSession(session)"
            >
              <span
                v-if="isUnread(session)"
                class="fg-sessions__unreadDot"
                aria-label="Unread"
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
                    class="fg-sessions__actionButton"
                    role="button"
                    tabindex="0"
                    :title="isUnread(session) ? 'Mark as read' : 'Mark as unread'"
                    @click.stop="toggleUnread(session)"
                    @keydown.enter.stop="toggleUnread(session)"
                  >
                    <span
                      class="codicon fg-sessions__actionIcon"
                      :class="isUnread(session) ? 'codicon-mail-read' : 'codicon-mail'"
                    />
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
import { ref, computed, onMounted, nextTick, inject } from 'vue';
import { transport } from '../core/runtimeTransport';
import { Motion } from 'motion-v';
import Icon from '../components/Icon.vue';
import { RuntimeKey } from '../composables/runtimeContext';
import { useSessionStore } from '../composables/useSessionStore';
import { useSession } from '../composables/useSession';
import type { Session } from '../core/Session';

// 注入运行时
const runtime = inject(RuntimeKey);
if (!runtime) {
  throw new Error('[SessionsPage] runtime not provided');
}

// 🔥 使用 useSessionStore 包装为 Vue-friendly API
const store = useSessionStore(runtime.sessionStore);

// 🔥 视图模型：将 alien-signals Session 转换为 Vue-friendly 包装
const sessionList = computed(() => {
  const rawSessions = (store.sessionsByLastModified.value || []).filter(Boolean) as Session[];
  return rawSessions.map(raw => useSession(raw));
});

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
    // 🔥 使用包装后的方法
    await store.listSessions();
  } catch (err) {
    error.value = `加载会话失败: ${err}`;
  } finally {
    loading.value = false;
  }
};


const openSession = (wrappedSession: ReturnType<typeof useSession> | undefined) => {
  if (!wrappedSession) return;
  // 🔥 从包装对象中获取原始 Session 实例
  const rawSession = wrappedSession.__session;
  // Opening a conversation clears its unread mark, the way opening a message does.
  clearUnread(wrappedSession.sessionId.value);
  store.setActiveSession(rawSession);
  emit('switchToChat', wrappedSession.sessionId.value);
};


const createNewSession = async () => {
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

// 格式化相对时间
function formatRelativeTime(input?: number | string | Date): string {
  if (input === undefined || input === null) return '刚刚';
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '刚刚';

  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))}分钟前`;
  if (diff < 86_400_000) return `${Math.max(1, Math.round(diff / 3_600_000))}小时前`;
  const days = Math.max(1, Math.round(diff / 86_400_000));
  if (days < 7) return `${days}天前`;
  return date.toLocaleDateString('zh-CN');
}

// 生命周期
onMounted(() => {
  refreshSessions();
  void loadUnread();
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

// ---- Unread marking --------------------------------------------------------
// Persisted through the extension config (~/.forge.json) rather than kept in
// component state, so a conversation you deliberately left unread is still
// unread after a reload -- which is the entire point of marking it.

const UNREAD_KEY = 'unreadSessionIds';
const unreadIds = ref(new Set<string>());

function isUnread(session: ReturnType<typeof useSession>): boolean {
  const id = session.sessionId.value;
  return Boolean(id && unreadIds.value.has(id));
}

async function toggleUnread(session: ReturnType<typeof useSession>): Promise<void> {
  const id = session.sessionId.value;
  if (!id) return;

  const next = new Set(unreadIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  unreadIds.value = next;

  try {
    await transport.updateExtensionConfig(UNREAD_KEY, [...next]);
  } catch (e) {
    // Marking is a convenience; a failed write should not break the list.
    console.warn('[SessionsPage] could not persist unread state', e);
  }
}

async function loadUnread(): Promise<void> {
  try {
    const config = await transport.getExtensionConfig();
    const ids = config?.config?.[UNREAD_KEY] ?? config?.[UNREAD_KEY];
    if (Array.isArray(ids)) unreadIds.value = new Set(ids.filter((v) => typeof v === 'string'));
  } catch (e) {
    console.warn('[SessionsPage] could not read unread state', e);
  }
}

// Opening a conversation clears its unread mark, the way opening a message does.
function clearUnread(id: string | undefined): void {
  if (!id || !unreadIds.value.has(id)) return;
  const next = new Set(unreadIds.value);
  next.delete(id);
  unreadIds.value = next;
  void transport.updateExtensionConfig(UNREAD_KEY, [...next]).catch(() => {});
}
</script>

<style scoped>
/*
  Layout and states come from the ported official stylesheet
  (styles/official/sessions.css). What remains here is the hover/active
  behaviour the official build expresses through runtime classes, plus the
  unread affordance.
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

/* Unread uses the brand, the way the official build uses its own. */
.fg-sessions__unreadDot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--app-status-unread);
}

.fg-sessions__unread .fg-sessions__sessionName {
  font-weight: 600;
}

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
