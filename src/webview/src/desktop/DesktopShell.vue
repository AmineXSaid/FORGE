<template>
  <!--
    Forge Desktop's window, in its design (forge-desktop docs/DESIGN.md):
    the title bar with the nav pill; below it the sessions sidebar, the chat
    (or Settings) on the reading canvas, and the Changes pane. A session that
    waits for you elsewhere shows as Monad's black announcement bar.

    Keys: Ctrl+N new session · Ctrl+Tab / Ctrl+Shift+Tab next / previous
    session · Ctrl+O open a folder · Ctrl+B sidebar · Ctrl+Shift+D Changes ·
    Ctrl+, Settings · Ctrl+F find.
  -->
  <div class="fd-shell">
    <TitleBar
      ref="titleBar"
      :info="info"
      :branch="status?.branch ?? null"
      :additions="totals.additions"
      :deletions="totals.deletions"
      :sidebar-open="layout.sidebar"
      :changes-open="layout.changes && !settingsOpen"
      :view="settingsOpen ? 'settings' : 'chat'"
      @toggle-sidebar="layout.sidebar = !layout.sidebar"
      @toggle-changes="toggleChanges"
      @toggle-settings="settingsOpen = !settingsOpen"
      @show-chat="settingsOpen = false"
      @new-session="newSession"
    />

    <div v-if="waiting.length" class="fd-shell__notice" role="alert">
      <span class="fd-label fd-shell__noticeTag">Waiting</span>
      <span class="fd-shell__noticeText">
        <strong>{{ waiting[0].tool }}</strong> in “{{ titleOf(waiting[0].session) }}” needs your approval<template v-if="waiting.length > 1"> · {{ waiting.length - 1 }} more</template>
      </span>
      <button type="button" class="fd-pill fd-shell__noticeButton" @click="openWaiting">Open <span class="fd-chevron" aria-hidden="true">›</span></button>
    </div>

    <div class="fd-shell__body">
      <template v-if="layout.sidebar">
        <div class="fd-shell__sidebar" :style="{ width: `${layout.sidebarWidth}px` }">
          <SessionSidebar @new-session="newSession" @opened="settingsOpen = false" />
        </div>
        <div class="fd-shell__sash" role="separator" aria-orientation="vertical" @pointerdown="startResize($event, 'sidebarWidth', 1)" />
      </template>

      <main class="fd-shell__main">
        <FindBar v-if="findOpen" ref="findBar" @close="findOpen = false" />
        <SettingsPage v-if="settingsOpen" class="fd-shell__settings" />
        <ChatPage v-show="!settingsOpen" desktop />
      </main>

      <!-- Settings is a page of its own: it takes the width while open. -->
      <template v-if="layout.changes && !settingsOpen">
        <div class="fd-shell__sash" role="separator" aria-orientation="vertical" @pointerdown="startResize($event, 'changesWidth', -1)" />
        <div class="fd-shell__changes" :style="{ width: `${layout.changesWidth}px` }">
          <ChangesPane :status="status" @refresh="refreshStatus" @close="layout.changes = false" @send-review="sendReview" />
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import ChatPage from '../pages/ChatPage.vue';
import SettingsPage from '../pages/SettingsPage.vue';
import TitleBar from './TitleBar.vue';
import SessionSidebar from './SessionSidebar.vue';
import ChangesPane from './ChangesPane.vue';
import FindBar from './FindBar.vue';
import { RuntimeKey } from '../composables/runtimeContext';
import { changeTotals, desktopHost, type DesktopInfo, type GitStatus } from './desktopHost';
import { sessionTitle, watchAttention } from './attention';
import type { Session } from '../core/Session';
import '../styles/forge-desktop-theme.css';

const runtime = inject(RuntimeKey);
if (!runtime) throw new Error('[DesktopShell] runtime not provided');
const sessions = runtime.sessionStore;

// The design system is scoped to this class (forge-desktop-theme.css). The
// page's HTML sets it already; this keeps it right if it did not.
document.body.classList.add('forge-desktop');

/* ------------------------------------------------------------- layout */

const LAYOUT_KEY = 'forge.desktop.layout';
const DEFAULT_LAYOUT = { sidebar: true, changes: false, sidebarWidth: 264, changesWidth: 480 };

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

const LIMITS = { sidebarWidth: [180, 480], changesWidth: [320, 960] } as const;

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

function toggleChanges(): void {
  if (settingsOpen.value) {
    settingsOpen.value = false;
    layout.changes = true;
    return;
  }
  layout.changes = !layout.changes;
}

/* ------------------------------------------------------ project, views */

const info = ref<DesktopInfo>();
const settingsOpen = ref(false);
const titleBar = ref<InstanceType<typeof TitleBar>>();

async function newSession(): Promise<void> {
  settingsOpen.value = false;
  await sessions.createSession({ isExplicit: true });
}

/** Ctrl+Tab: the next session, newest first, wrapping. */
function cycleSession(step: 1 | -1): void {
  const list = sessions.sessionsByLastModified();
  if (list.length < 2) return;
  const at = list.indexOf(sessions.activeSession() as Session);
  const next = list[(at + step + list.length) % list.length];
  sessions.setActiveSession(next);
  settingsOpen.value = false;
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

/** The Changes pane's review, sent to the session on screen as one message. */
async function sendReview(text: string): Promise<void> {
  settingsOpen.value = false;
  const session = await sessions.ensureActiveSession();
  await session.send(text, [], false, { kind: 'human' });
}

/* ---------------------------------------------------------- attention */

const attention = watchAttention(sessions);
const waiting = attention.waiting;
const titleOf = (session: Session) => sessionTitle(session);

function openWaiting(): void {
  const first = waiting.value[0];
  if (!first) return;
  sessions.setActiveSession(first.session);
  settingsOpen.value = false;
}

/* ---------------------------------------------------------------- find */

const findOpen = ref(false);
const findBar = ref<InstanceType<typeof FindBar>>();

async function openFind(): Promise<void> {
  if (findOpen.value) {
    findBar.value?.focus();
    return;
  }
  findOpen.value = true;
  await nextTick();
}

/* ---------------------------------------------------------------- keys */

function onKey(event: KeyboardEvent): void {
  const mod = event.ctrlKey || event.metaKey;
  if (!mod || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === 'tab') {
    cycleSession(event.shiftKey ? -1 : 1);
  } else if (key === 'b' && !event.shiftKey) {
    layout.sidebar = !layout.sidebar;
  } else if (key === 'd' && event.shiftKey) {
    toggleChanges();
  } else if (key === ',' && !event.shiftKey) {
    settingsOpen.value = !settingsOpen.value;
  } else if (key === 'n' && !event.shiftKey) {
    void newSession();
  } else if (key === 'o' && !event.shiftKey) {
    void desktopHost()?.openProject();
  } else if (key === 'f' && !event.shiftKey) {
    void openFind();
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
  attention.dispose();
});

defineExpose({ titleBar });
</script>

<style scoped>
.fd-shell {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  height: 100vh;
  color: var(--fd-ink);
  background: var(--fd-canvas);
}

/* Monad's announcement bar: black, mono, one white outline pill. */
.fd-shell__notice {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 36px;
  flex: none;
  padding: 0 8px 0 14px;
  background: var(--fd-black);
  color: var(--fd-chrome);
  font-family: var(--fd-mono);
  font-size: 12px;
  letter-spacing: -0.02em;
}

.fd-shell__noticeTag {
  padding: 2px 8px;
  border: 1px solid var(--fd-chrome);
  border-radius: var(--fd-pill);
}

.fd-shell__noticeText {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fd-shell__noticeText strong {
  font-weight: 500;
}

.fd-shell__noticeButton {
  height: 24px;
  border-color: var(--fd-chrome);
  background: var(--fd-white);
  color: var(--fd-black);
}

.fd-shell__body {
  display: flex;
  flex: 1;
  min-height: 0;
}

/* The panes keep their widths until the window is too narrow for all
   three; then they give way, so nothing runs past the window's edge. */
.fd-shell__sidebar {
  flex: 0 1 auto;
  min-width: 180px;
}

.fd-shell__changes {
  flex: 0 1 auto;
  min-width: 300px;
}

.fd-shell__main {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 380px;
  min-width: 320px;
  background: var(--fd-canvas);
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
  background: var(--fd-edge-chrome);
  cursor: col-resize;
}

/* A wider, invisible grip around the 1px line. */
.fd-shell__sash::after {
  content: '';
  position: absolute;
  inset: 0 -3px;
}

.fd-shell__sash:hover {
  background: var(--fd-signal);
}
</style>
