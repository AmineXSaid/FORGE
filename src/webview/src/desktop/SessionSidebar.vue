<template>
  <!--
    The desktop sidebar (forge-desktop docs/DESIGN.md §4): parchment, a mono
    uppercase section label, and the session manager's list (SessionList,
    list-only: groups, status dots, unread, search, filters, the right-click
    menus). A row opens its conversation in the chat beside it. "New session"
    and Settings live in the title bar's nav pill.
  -->
  <nav class="fd-sidebar" aria-label="Sessions">
    <div class="fd-sidebar__head">
      <span class="fd-label fd-sidebar__label">Sessions</span>
      <span class="fd-sidebar__spacer" />
      <button type="button" class="fd-sidebar__icon" title="New session (Ctrl+N)" aria-label="New session" @click="emit('newSession')">
        <span class="codicon codicon-add" aria-hidden="true" />
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

const emit = defineEmits<{ newSession: []; opened: [] }>();

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
  background: var(--fd-chrome);
  /* The list reads these: parchment rows, periwinkle selection. */
  --vscode-sideBar-background: var(--fd-chrome);
  --app-primary-background: var(--fd-chrome);
}

.fd-sidebar__head {
  display: flex;
  align-items: center;
  height: 40px;
  flex: none;
  padding: 0 8px 0 16px;
}

.fd-sidebar__label {
  color: var(--fd-muted);
}

.fd-sidebar__spacer {
  flex: 1;
}

.fd-sidebar__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: var(--fd-pill);
  background: transparent;
  color: var(--fd-muted);
  cursor: pointer;
}

.fd-sidebar__icon:hover {
  background: var(--fd-hover);
  color: var(--fd-ink);
}

.fd-sidebar__list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 4px;
}
</style>
