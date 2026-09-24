<template>
  <!-- The plan preview is a page of its own, in its own panel (step 17). -->
  <PlanPreviewPage v-if="currentPage === 'plan-preview'" />
  <div
    v-else
    class="app-wrapper"
    :class="{ 'forge-handoff': handingOff, 'forge-arrive-pending': arriving === 'pending', 'forge-arrive': arriving === 'playing' }"
  >
    <main class="app-main">
      <div class="page-container">
        <Motion
          :animate="pageAnimation"
          :transition="{ duration: 0.3, ease: 'easeOut' }"
          class="motion-wrapper"
        >
          <SessionsPage
            v-if="currentPage === 'sessions'"
            key="sessions"
            :standalone="isSessionsView"
            @switch-to-chat="handleSwitchToChat"
            @new-conversation="handleNewConversation"
          />
          <ChatPage
            v-else-if="currentPage === 'chat'"
            key="chat"
            @switch-to-sessions="switchToPage('sessions')"
          />
          <SettingsPage
            v-else-if="currentPage === 'settings'"
            key="settings"
          />
          <!-- IconTestPage -->
          <!-- <IconTestPage
            v-else-if="currentPage === 'icontest'"
            key="icontest"
          /> -->
        </Motion>
      </div>
    </main>
    <!-- One viewer for the whole app: a diagram in the transcript is v-html, so
         it cannot open a modal itself. -->
    <MermaidViewer />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, provide, watch } from 'vue';
import { useSignal } from '@gn8/alien-signals-vue';
import { Motion } from 'motion-v';
import SessionsPage from './pages/SessionsPage.vue';
import ChatPage from './pages/ChatPage.vue';
import SettingsPage from './pages/SettingsPage.vue';
import PlanPreviewPage from './pages/PlanPreviewPage.vue';
import MermaidViewer from './components/forge/MermaidViewer.vue';
import './styles/forge-theme.css';
import { useRuntime } from './composables/useRuntime';
import { RuntimeKey } from './composables/runtimeContext';
import { transport, runHostAction } from './core/runtimeTransport';
// import IconTestPage from './pages/IconTestPage.vue';

type PageName = 'sessions' | 'chat' | 'settings' | 'plan-preview';

const bootstrap = window.FORGE_BOOTSTRAP;
const initialPage = (bootstrap?.page as PageName | undefined) ?? 'chat';
const currentPage = ref<PageName>(initialPage);
const pageAnimation = ref({ opacity: 1, x: 0 });

// 仅在需要的页面上初始化运行时（聊天 / 会话列表）
const needsRuntime = initialPage === 'chat' || initialPage === 'sessions';
const runtime = needsRuntime ? useRuntime({ createInitialSession: initialPage === 'chat' }) : null;

if (runtime) {
  provide(RuntimeKey, runtime);
}

onMounted(() => {
  if (runtime) {
    console.log('[App] runtime initialized', runtime);
  } else {
    console.log('[App] runtime not initialized for page', initialPage);
  }
});

function switchToPage(page: 'sessions' | 'chat') {
  pageAnimation.value = { opacity: 0, x: 0 };

  setTimeout(() => {
    currentPage.value = page;
    if (page === 'sessions') {
      pageAnimation.value = { opacity: 0.7, x: -3 };
      setTimeout(() => {
        pageAnimation.value = { opacity: 1, x: 0 };
      }, 50);
    } else {
      pageAnimation.value = { opacity: 0.7, x: 3 };
      setTimeout(() => {
        pageAnimation.value = { opacity: 1, x: 0 };
      }, 50);
    }
  }, 0);
}

/**
 * Whether this webview *is* the standalone sessions view.
 *
 * The sessions list exists twice: as a page inside the chat webview (the
 * header's history button swaps to it and back), and as its own view in its
 * own activity-bar container. Only the second one has a chat elsewhere to go
 * to.
 */
const isSessionsView = initialPage === 'sessions';

/**
 * The history is on its way out, having sent the chat somewhere else.
 *
 * VS Code gives an extension no say over how a side bar closes -- it is there
 * and then it is not. So the hand-off is played here, in the panel that is
 * leaving: it eases out towards the side the chat arrives on while the host
 * reveals it, and the host closes the panel when the exit has played.
 *
 * The view is retained while hidden, so whatever state it leaves in is the
 * state it comes back in. The fade is therefore undone as soon as the view is
 * shown again, and at once if the host could not open the chat. It used to be
 * set and never cleared, which brought the history back blank and dead.
 */
const handingOff = ref(false);

/** Opened from the activity bar, not as an editor tab: its side bar may close. */
const fromView = window.FORGE_BOOTSTRAP?.host === 'sidebar';

function handOff(options: { newConversation?: boolean; sessionId?: string; groupId?: string }) {
  // Both in the same frame, deliberately: the request is what makes the chat
  // appear, so waiting for the exit before sending it would only add its
  // length to how long the click takes to do anything.
  handingOff.value = fromView;
  runHostAction('open the chat', () =>
    transport.revealChat({ ...options, fromView }).then(
      () => {
        // The host closes this side bar only when the chat is in the other
        // one. When it stays open (the chat shares it, or an older VS Code),
        // the history is still on screen and must come back at once.
        setTimeout(() => {
          if (document.visibilityState === 'visible') handingOff.value = false;
        }, 400);
      },
      (error: unknown) => {
        handingOff.value = false;
        throw error;
      }
    )
  );
}

/** A row in the history: open that conversation. */
function handleSwitchToChat(sessionId?: string) {
  if (isSessionsView) {
    // Rendering the chat here would put it inside the activity-bar container
    // -- on the left, where the history lives -- instead of in the side bar
    // the chat is configured for. The host knows where that is.
    handOff(sessionId ? { sessionId } : { newConversation: true });
    return;
  }
  switchToPage('chat');
}

/**
 * "New session", or "Start new session in this group": a fresh conversation in
 * the chat, which joins the group once it has a session (the host keeps it).
 */
function handleNewConversation(groupId?: string) {
  if (isSessionsView) {
    handOff(groupId ? { newConversation: true, groupId } : { newConversation: true });
    return;
  }
  switchToPage('chat');
}

// Shown again: undo the exit. The host's `visibility_changed` is the signal the
// official uses; the page's own visibility is the fallback for a host that
// does not send it.
if (isSessionsView) {
  const visible = useSignal(transport.isVisible);
  watch(visible, (now) => {
    if (now) handingOff.value = false;
  });
}
/*
 * The chat's side of the hand-off: the host says `arrive` just before it
 * reveals this view. The entrance is held at its first frame until the view is
 * shown (the host's `visibility_changed`, or the page's own), then plays, so it
 * is seen rather than spent while hidden. A view that is already on screen
 * plays it at once.
 */
const arriving = ref<'pending' | 'playing' | false>(false);
let arriveTimer: ReturnType<typeof setTimeout> | undefined;
function playArrive(): void {
  if (arriving.value !== 'pending') return;
  arriving.value = 'playing';
  clearTimeout(arriveTimer);
  // The 90ms entrance, plus a frame of margin before the class goes.
  arriveTimer = setTimeout(() => { arriving.value = false; }, 120);
}
if (!isSessionsView) {
  const stopArrive = transport.uiCommand.add((command) => {
    if (command !== 'arrive') return;
    arriving.value = 'pending';
    clearTimeout(arriveTimer);
    // Shown already: play now. Hidden: wait for the reveal, but never hold the
    // chat dimmed if the show signal does not come.
    // Played on the next frame rather than after 30ms (2026-09-24, "very very
    // fast"): the first frame of the chat is already its readable one.
    arriveTimer = setTimeout(playArrive, document.visibilityState === 'visible' ? 0 : 500);
  });
  const shown = useSignal(transport.isVisible);
  watch(shown, (now) => { if (now) playArrive(); });
  onUnmounted(() => stopArrive());
}

const onPageVisibility = () => {
  if (document.visibilityState === 'visible') {
    handingOff.value = false;
    playArrive();
  }
};
onMounted(() => document.addEventListener('visibilitychange', onPageVisibility));
onUnmounted(() => document.removeEventListener('visibilitychange', onPageVisibility));
</script>

<style>
.app-wrapper {
  display: flex;
  flex-direction: column;
  /* Fill #app's width like the official root, rather than shrinking to content. */
  flex: 1;
  min-width: 0;
  height: 100vh;
  color: var(--vscode-editor-foreground);
}

.app-main {
  flex: 1;
  overflow: hidden;
}

.page-container {
  position: relative;
  height: 100%;
  width: 100%;
}

.motion-wrapper {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
}
</style>
