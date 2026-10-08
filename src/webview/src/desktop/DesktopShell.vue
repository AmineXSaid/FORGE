<template>
  <!--
    Forge Desktop's window: title bar on top; below it the sessions sidebar,
    the chat (or Settings), and the Changes pane. The sidebar and the pane are
    resizable, can be closed (Ctrl+B, Ctrl+Shift+D), and keep their widths.
  -->
  <div class="fd-shell">
    <TitleBar
      :info="info"
      :branch="status?.branch ?? null"
      :additions="totals.additions"
      :deletions="totals.deletions"
      :sidebar-open="layout.sidebar"
      :changes-open="layout.changes"
      @toggle-sidebar="layout.sidebar = !layout.sidebar"
      @toggle-changes="layout.changes = !layout.changes"
    />
    <div class="fd-shell__body">
      <template v-if="layout.sidebar">
        <div class="fd-shell__sidebar" :style="{ width: `${layout.sidebarWidth}px` }">
          <SessionSidebar
            :settings-open="settingsOpen"
            @new-session="newSession"
            @opened="settingsOpen = false"
            @toggle-settings="settingsOpen = !settingsOpen"
          />
        </div>
        <div class="fd-shell__sash" role="separator" aria-orientation="vertical" @pointerdown="startResize($event, 'sidebarWidth', 1)" />
      </template>

      <main class="fd-shell__main">
        <SettingsPage v-if="settingsOpen" class="fd-shell__settings" />
        <ChatPage v-show="!settingsOpen" desktop />
      </main>

      <!-- Settings is a page of its own: it takes the width while open. -->
      <template v-if="layout.changes && !settingsOpen">
        <div class="fd-shell__sash" role="separator" aria-orientation="vertical" @pointerdown="startResize($event, 'changesWidth', -1)" />
        <div class="fd-shell__changes" :style="{ width: `${layout.changesWidth}px` }">
          <ChangesPane :status="status" @refresh="refreshStatus" @close="layout.changes = false" />
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import ChatPage from '../pages/ChatPage.vue';
import SettingsPage from '../pages/SettingsPage.vue';
import TitleBar from './TitleBar.vue';
import SessionSidebar from './SessionSidebar.vue';
import ChangesPane from './ChangesPane.vue';
import { RuntimeKey } from '../composables/runtimeContext';
import { changeTotals, desktopHost, type DesktopInfo, type GitStatus } from './desktopHost';

const runtime = inject(RuntimeKey);
if (!runtime) throw new Error('[DesktopShell] runtime not provided');

/* ------------------------------------------------------------- layout */

const LAYOUT_KEY = 'forge.desktop.layout';
const DEFAULT_LAYOUT = { sidebar: true, changes: false, sidebarWidth: 264, changesWidth: 460 };

function readLayout(): typeof DEFAULT_LAYOUT {
  try {
    return { ...DEFAULT_LAYOUT, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}
const layout = reactive(readLayout());
watch(layout, (value) => {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(value));
  } catch {
    /* storage unavailable: the layout is kept for this run only */
  }
});

const LIMITS = { sidebarWidth: [180, 480], changesWidth: [300, 900] } as const;

/** Drag a sash. `direction` is +1 when dragging right widens the panel. */
function startResize(event: PointerEvent, key: 'sidebarWidth' | 'changesWidth', direction: 1 | -1): void {
  const startX = event.clientX;
  const startWidth = layout[key];
  const [min, max] = LIMITS[key];
  const sash = event.currentTarget as HTMLElement;
  sash.setPointerCapture(event.pointerId);
  const move = (e: PointerEvent) => {
    layout[key] = Math.round(Math.min(max, Math.max(min, startWidth + direction * (e.clientX - startX))));
  };
  const up = () => {
    sash.removeEventListener('pointermove', move);
    sash.removeEventListener('pointerup', up);
  };
  sash.addEventListener('pointermove', move);
  sash.addEventListener('pointerup', up);
}

/* ------------------------------------------------------------ project */

const info = ref<DesktopInfo>();
const settingsOpen = ref(false);

async function newSession(): Promise<void> {
  settingsOpen.value = false;
  await runtime!.sessionStore.createSession({ isExplicit: true });
}

/* ------------------------------------------------------------ changes */

const status = ref<GitStatus>();
const totals = computed(() => changeTotals(status.value?.files ?? []));
let inFlight = false;

async function refreshStatus(): Promise<void> {
  const host = desktopHost();
  if (!host || inFlight) return;
  inFlight = true;
  try {
    const next = await host.gitStatus();
    // Same answer: keep the old object, so the pane does not re-read its diff.
    if (JSON.stringify(next) !== JSON.stringify(status.value)) status.value = next;
  } catch (error) {
    console.warn('[DesktopShell] git status failed', error);
  } finally {
    inFlight = false;
  }
}

// The agent edits files while it works: poll, faster while the pane is open.
let timer: ReturnType<typeof setInterval> | undefined;
function schedule(): void {
  clearInterval(timer);
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') void refreshStatus();
  }, layout.changes ? 2000 : 5000);
}
watch(() => layout.changes, (open) => {
  schedule();
  if (open) void refreshStatus();
});

function onKey(event: KeyboardEvent): void {
  const mod = event.ctrlKey || event.metaKey;
  if (!mod || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === 'b' && !event.shiftKey) {
    layout.sidebar = !layout.sidebar;
  } else if (key === 'd' && event.shiftKey) {
    layout.changes = !layout.changes;
  } else if (key === ',' && !event.shiftKey) {
    settingsOpen.value = !settingsOpen.value;
  } else {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
}

onMounted(async () => {
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('focus', refreshStatus);
  schedule();
  void refreshStatus();
  info.value = await desktopHost()?.info();
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('focus', refreshStatus);
  clearInterval(timer);
});
</script>

<style scoped>
.fd-shell {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  height: 100vh;
  color: var(--vscode-editor-foreground);
  background: var(--app-root-background);
}

.fd-shell__body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.fd-shell__sidebar,
.fd-shell__changes {
  flex: none;
  min-width: 0;
}

.fd-shell__main {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 360px;
}

.fd-shell__settings {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.fd-shell__sash {
  flex: none;
  width: 1px;
  position: relative;
  background: var(--app-widget-border);
  cursor: col-resize;
}

/* A wider, invisible grip around the 1px line. */
.fd-shell__sash::after {
  content: '';
  position: absolute;
  inset: 0 -3px;
}

.fd-shell__sash:hover {
  background: var(--app-splitter-hover-background);
}
</style>
