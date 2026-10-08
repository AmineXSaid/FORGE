<template>
  <!--
    The desktop sidebar: "New session" and the project's sessions, in the
    session manager's list (SessionList, list-only: groups, status dots,
    unread, search, filters, the right-click menus). A row opens its
    conversation in the chat beside it.
  -->
  <nav class="fd-sidebar" aria-label="Sessions">
    <div class="fd-sidebar__top">
      <button type="button" class="fd-sidebar__new" title="New session" @click="emit('newSession')">
        <span class="codicon codicon-add" aria-hidden="true" />
        New session
      </button>
    </div>
    <div class="fd-sidebar__list">
      <SessionList
        list-only
        groups
        feeds
        new-session-in-group
        :loaded="loaded"
        @open="openSession"
        @new-session-in-group="emit('newSession')"
      />
    </div>
    <div class="fd-sidebar__bottom">
      <button
        type="button"
        class="fd-sidebar__item"
        :class="{ 'fd-sidebar__itemOn': settingsOpen }"
        @click="emit('toggleSettings')"
      >
        <span class="codicon codicon-settings-gear" aria-hidden="true" />
        Settings
      </button>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { inject, onMounted, ref, watch } from 'vue';
import { useSignal } from '@gn8/alien-signals-vue';
import SessionList from '../components/forge/SessionList.vue';
import { RuntimeKey } from '../composables/runtimeContext';
import { useSessionStore } from '../composables/useSessionStore';
import { transport } from '../core/runtimeTransport';
import { sessionKey } from '../core/sessionStates';
import type { Session } from '../core/Session';

defineProps<{ settingsOpen: boolean }>();
const emit = defineEmits<{ newSession: []; opened: []; toggleSettings: [] }>();

const runtime = inject(RuntimeKey);
if (!runtime) throw new Error('[SessionSidebar] runtime not provided');
const store = useSessionStore(runtime.sessionStore);

const loaded = ref(false);
async function refresh(): Promise<void> {
  try {
    await store.listSessions();
  } catch (error) {
    console.warn('[SessionSidebar] listing sessions failed', error);
  } finally {
    loaded.value = true;
  }
}

/** As the session manager does: open it here, and clear its unread mark. */
function openSession(session: Session): void {
  const key = sessionKey(session.sessionId());
  if (key && store.unreadSessionKeys.value?.includes(key)) void store.setSessionUnread(key, false);
  store.setActiveSession(session);
  emit('opened');
}

onMounted(() => {
  void refresh();
  void store.listSessionGroups();
  void store.listCollapsedPanelSections();
});

// The host changed the groups, or the list on disk changed.
const groupsVersion = useSignal(transport.sessionGroupsVersion);
watch(groupsVersion, (version) => {
  if (version > 0) void store.listSessionGroups({ forceAdopt: true });
});
</script>

<style scoped>
.fd-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--vscode-activityBar-background, var(--app-root-background));
}

.fd-sidebar__top {
  flex: none;
  padding: 10px 10px 6px;
}

.fd-sidebar__new {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 30px;
  border: 1px solid var(--app-input-border);
  border-radius: var(--corner-radius-medium);
  background: var(--app-input-background);
  color: var(--app-primary-foreground);
  font: inherit;
  cursor: pointer;
}

.fd-sidebar__new:hover {
  background: var(--app-list-hover-background);
}

.fd-sidebar__list {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.fd-sidebar__bottom {
  flex: none;
  padding: 6px;
  border-top: 1px solid var(--app-widget-border);
}

.fd-sidebar__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--corner-radius-small);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.fd-sidebar__item:hover {
  background: var(--app-list-hover-background);
}

.fd-sidebar__itemOn {
  background: var(--app-list-active-background);
}
</style>
