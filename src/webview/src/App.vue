<template>
  <!-- The plan preview is a page of its own, in its own panel (step 17). -->
  <PlanPreviewPage v-if="currentPage === 'plan-preview'" />
  <div v-else class="app-wrapper" :class="{ 'forge-handoff': handingOff }">
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
import { ref, onMounted, provide } from 'vue';
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
 * reveals it, and the host waits that long before taking the panel away.
 */
const handingOff = ref(false);

function handleSwitchToChat(sessionId?: string) {
  if (sessionId) {
    console.log('Switching to chat with session:', sessionId);
  }
  if (isSessionsView) {
    // Rendering the chat here would put it inside the activity-bar container
    // -- on the left, where the history lives -- instead of in the side bar
    // the chat is configured for. The host knows where that is.
    //
    // Both in the same frame, deliberately: the request is what makes the chat
    // appear, so waiting for the exit before sending it would only add its
    // length to how long the click takes to do anything.
    handingOff.value = true;
    runHostAction('open the chat', () => transport.revealChat(!sessionId));
    return;
  }
  switchToPage('chat');
}
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
