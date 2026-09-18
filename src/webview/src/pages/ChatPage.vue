<template>
  <!--
    The official Claude Code chat surface.

    Two things distinguish it from a plain stacked layout. The composer is
    absolutely positioned over the transcript rather than sitting below it, with
    a gradient fading the messages out behind it, so long output runs to the
    bottom of the panel instead of being squeezed. And messages are grouped into
    turns, each introduced by a visually hidden heading so a screen reader can
    navigate the conversation turn by turn.
  -->
  <div class="fg-shell__root">
    <div class="fg-shell__header">
      <div class="fg-shell__titleGroup" :class="{ 'fg-shell__editing': isEditingTitle }">
        <input
          v-if="isEditingTitle"
          ref="titleInputRef"
          v-model="titleDraft"
          class="fg-shell__titleInput"
          aria-label="Conversation title"
          @keydown.enter.prevent="commitTitle"
          @keydown.esc.prevent="cancelTitle"
          @blur="commitTitle"
        >
        <button
          v-else
          class="fg-shell__titleText"
          :title="title"
          @click="beginEditTitle"
        >
          <span class="fg-shell__titleTextInner">{{ title }}</span>
          <span class="codicon codicon-edit fg-shell__titleEditHint" aria-hidden="true" />
        </button>
      </div>

      <div class="fg-shell__headerSpacer" />

      <!-- The official header's icon buttons, in the official order: history, then
           new session (restored at the user's request, 2026-09-19). -->
      <button
        ref="historyButtonEl"
        type="button"
        class="fg-iconbutton__iconButton fg-iconbutton__iconButton20"
        aria-label="Session history"
        title="Session history"
        @click="sessionsOpen = !sessionsOpen"
      >
        <HistoryIcon />
      </button>
      <button
        type="button"
        class="fg-iconbutton__iconButton fg-iconbutton__iconButton20"
        aria-label="New session"
        title="New session"
        @click="createNew"
      >
        <NewSessionIcon />
      </button>
      <!-- The official opens past conversations as a dropdown under this button, not a page. -->
      <SessionsDropdown v-if="sessionsOpen" :anchor="historyButtonEl" @close="sessionsOpen = false" />
    </div>

    <div class="fg-shell__body">
      <div class="fg-chat__sessionLayout">
        <div class="fg-chat__chatContainer">
          <!--
            The empty state, matched to the real extension: it takes the place of
            the transcript rather than sitting inside it, with the wordmark pinned
            at the top and the mascot centred below with either the announcement
            card or an opening tip -- one or the other, never stacked -- and the
            terminal banner above the composer. The spacer keeps all of it clear of
            the floating composer: its height, exactly as the official measures it,
            with the container's gap and the banner's margin making up the rest.

            Starting a new conversation swaps transcript for empty state through a
            short choreography (see the fg-conversation styles): the old transcript
            lifts away, then the wordmark settles, the hammer lands with a tap, and
            the tip and cards rise in after it.
          -->
          <Transition name="fg-conversation" mode="out-in" appear :duration="{ enter: 720, leave: 190 }">
          <div v-if="messages.length === 0" :key="`empty-${conversationKey}`" class="fg-chat__emptyState">
            <div class="fg-emptystate__container">
              <div class="fg-emptystate__logo">
                <div><ForgeWordmark /></div>
              </div>
              <div class="fg-emptystate__main">
                <RandomTip :platform="platform" :show-message="!welcomeCard" />
                <WelcomeCard
                  v-if="welcomeCard"
                  :card="shownWelcomeCard!"
                  :platform="platform"
                  @action="handleWelcomeAction"
                  @dismiss="retireCard"
                />
              </div>
              <div class="fg-emptystate__terminalBannerContainer">
                <TerminalBanner />
              </div>
              <div :style="{ height: `${inputHeight}px` }" />
            </div>
          </div>
          <!--
            The transcript, as the official lays it out: one div.turn per turn, a
            new turn at each prompt the user typed, and each message's row placed
            straight inside it -- no wrapper, so the timeline rail's sibling rules
            (.timelineMessage + .timelineMessage) connect consecutive rows. While a
            permission prompt is up the other turns dim, leaving the turn whose
            tool call is asking highlighted. The spinner row is always present and
            fills only while the session works.
          -->
          <div
            v-else
            key="transcript"
            ref="containerEl"
            role="region"
            aria-label="Forge conversation"
            tabindex="0"
            :class="`fg-chat__messagesContainer fg-chat__stickyMode ${dimmed ? 'fg-chat__dimmed' : ''}`"
          >
            <div
              v-for="(turn, t) in turns"
              :key="`turn-${t}`"
              :class="`fg-chat__turn ${turn.some((row) => row.idx === highlightIndex) ? 'fg-chat__highlightedMessage' : ''}`"
            >
              <MessageRenderer
                v-for="row in turn"
                :key="row.idx"
                :message="row.msg"
                :context="toolContext"
                :busy="isBusy"
                :highlighted="row.idx === highlightIndex"
              />
            </div>
            <div class="fg-chat__spinnerRow">
              <div>
                <Spinner v-if="isBusy && permissionRequestsLen === 0" :size="16" :permission-mode="permissionMode" />
              </div>
            </div>
            <!-- As in the official build: the transcript ends with room for the
                 composer, so the last message is never hidden behind it. -->
            <div ref="endEl" :style="{ height: `${inputHeight}px`, minHeight: `${inputHeight}px` }" />
          </div>
          </Transition>

          <!-- Fades the transcript out behind the floating composer. -->
          <div class="fg-chat__messageGradient" aria-hidden="true" />

          <div ref="inputContainerEl" class="fg-chat__inputContainer">
            <div v-if="pendingPermission && toolContext" class="fg-chat__permissionsContainer">
              <PermissionRequestModal
                :key="pendingPermission.id"
                :request="pendingPermission"
                :context="toolContext"
                :on-permission-mode-change="handlePermissionModeChange"
                :plan-comments="session?.planComments.value ?? []"
                :on-remove-plan-comment="(id: string) => session?.removePlanComment(id)"
                data-permission-panel="1"
              />
            </div>
            <ChatInputBox
              ref="inputBoxRef"
              :show-progress="true"
              :progress-percentage="progressPercentage"
              :context-tooltip="contextTooltip"
              :conversation-working="isBusy"
              :attachments="attachments"
              :thinking-level="session?.thinkingLevel.value"
              :effort="session?.effortState.value"
              :supports-fast-mode="session?.currentModelSupportsFastMode.value"
              :permission-mode="session?.permissionMode.value"
              :selected-model="session?.modelSelection.value"
              :slash-commands="session?.claudeConfig.value?.commands"
              :models="session?.claudeConfig.value?.models"
              :unavailable-models="session?.claudeConfig.value?.unavailable_models"
              :last-served-model="session?.lastServedModel.value"
              :model-setting="session?.config.value?.modelSetting"
              @submit="handleSubmit"
              @stop="handleStop"
              @add-attachment="handleAddAttachment"
              @remove-attachment="handleRemoveAttachment"
              @thinking-toggle="handleToggleThinking"
              @effort-select="handleEffortSelect"
              @ultracode-select="handleEnableUltracode"
              @clear-conversation="createNew"
              @mode-select="handleModeSelect"
              @model-select="handleModelSelect"
              @open-permission-rules="permissionRulesOpen = true"
            />
          </div>
        </div>
      </div>
    </div>
    <!-- "/" → Permissions: the official renders `kU0` here, after the chat. -->
    <PermissionRulesDialog
      v-if="permissionRulesOpen && session"
      :session="session"
      :on-close="closePermissionRules"
    />
  </div>
</template>

<script setup lang="ts">
  import { ref, computed, inject, provide, onMounted, onUnmounted, nextTick, watch } from 'vue';
  import { RuntimeKey } from '../composables/runtimeContext';
  import { useSession } from '../composables/useSession';
  import type { Session } from '../core/Session';
  import type { PermissionRequest } from '../core/PermissionRequest';
  import type { ToolContext } from '../types/tool';
  import type { AttachmentItem } from '../types/attachment';
  import { convertFileToAttachment } from '../types/attachment';
  import ChatInputBox from '../components/ChatInputBox.vue';
  import PermissionRequestModal from '../components/PermissionRequestModal.vue';
  import PermissionRulesDialog from '../components/PermissionRulesDialog.vue';
  import SessionsDropdown from '../components/forge/SessionsDropdown.vue';
  import HistoryIcon from '../components/forge/icons/HistoryIcon.vue';
  import NewSessionIcon from '../components/forge/icons/NewSessionIcon.vue';
  import Spinner from '../components/Messages/WaitingIndicator.vue';
  import ForgeWordmark from '../components/ForgeWordmark.vue';
  import RandomTip from '../components/RandomTip.vue';
  import WelcomeCard from '../components/welcome/WelcomeCard.vue';
  import TerminalBanner from '../components/welcome/TerminalBanner.vue';
  import { nextWelcomeCard, retireWelcomeCard, type WelcomeCard as WelcomeCardDef } from '../utils/announcements';
  import { markFirstRunBypassed } from '../utils/firstRun';
  import MessageRenderer from '../components/Messages/MessageRenderer.vue';
  import { ThinkingExpandedKey, TranscriptBusyKey, createThinkingExpanded } from '../components/Messages/transcriptState';
  import { transport } from '../core/runtimeTransport';
  import { useKeybinding } from '../utils/useKeybinding';
  import { useSignal } from '@gn8/alien-signals-vue';
  import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
  import type { ModelRow } from '../components/forge/modelCatalog';

  const runtime = inject(RuntimeKey);
  // One expanded / collapsed state for every thinking block in the transcript.
  provide(ThinkingExpandedKey, createThinkingExpanded());
  const sessionsOpen = ref(false);
  const historyButtonEl = ref<HTMLElement | null>(null);
  if (!runtime) throw new Error('[ChatPage] runtime not provided');

  const toolContext = computed<ToolContext>(() => ({
    fileOpener: {
      open: (filePath: string, location?: any) => {
        void runtime.appContext.fileOpener.open(filePath, location);
      },
      openContent: (content: string, fileName: string, editable: boolean) => {
        return runtime.appContext.fileOpener.openContent(
          content,
          fileName,
          editable
        );
      },
    },
  }));

  // 订阅 activeSession（alien-signal → Vue ref）
  const activeSessionRaw = useSignal<Session | undefined>(
    runtime.sessionStore.activeSession
  );

  // 使用 useSession 将 alien-signals 转换为 Vue Refs
  const session = computed(() => {
    const raw = activeSessionRaw.value;
    return raw ? useSession(raw) : null;
  });

  // 现在所有访问都使用 Vue Ref（.value）
  const title = computed(() => session.value?.summary.value || 'New Conversation');
  const messages = computed<any[]>(() => session.value?.messages.value ?? []);
  const isBusy = computed(() => session.value?.busy.value ?? false);
  provide(TranscriptBusyKey, isBusy);
  const permissionMode = computed(
    () => session.value?.permissionMode.value ?? 'default'
  );
  const permissionRequests = computed(
    () => session.value?.permissionRequests.value ?? []
  );
  const permissionRequestsLen = computed(() => permissionRequests.value.length);
  const pendingPermission = computed(() => permissionRequests.value[0] as any);
  const platform = computed(() => runtime.appContext.platform);

  // ---- Turns -----------------------------------------------------------------
  // The official groups the transcript into turns (`Qv`): a turn starts at a user
  // message that carries typed text, not at one that only returns tool results.
  // Its screen-reader heading lives inside the user message row itself.

  interface TranscriptRow {
    idx: number;
    msg: any;
  }

  function startsTurn(m: any): boolean {
    if (m?.type !== 'user' || m.isEmpty) return false;
    const content = m.message?.content;
    if (typeof content === 'string') return content.length > 0;
    return Array.isArray(content) && content.some((w: any) => w.content?.type === 'text');
  }

  const turns = computed<TranscriptRow[][]>(() => {
    const out: TranscriptRow[][] = [];
    let current: TranscriptRow[] = [];
    messages.value.forEach((msg, idx) => {
      if (startsTurn(msg) && current.length > 0) {
        out.push(current);
        current = [];
      }
      current.push({ idx, msg });
    });
    if (current.length > 0) out.push(current);
    return out;
  });

  /**
   * Official `S85`: the message whose tool call is waiting on the permission
   * prompt -- the last assistant message calling that tool with no result yet.
   * It stays lit while the rest of the transcript dims.
   */
  const highlightIndex = computed<number | undefined>(() => {
    const request = permissionRequests.value[0] as { toolName?: string } | undefined;
    if (!request) return undefined;
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const m = messages.value[i];
      if (m?.type !== 'assistant' || !Array.isArray(m.message?.content)) continue;
      for (const w of m.message.content) {
        if (w.content?.type === 'tool_use' && w.content.name === request.toolName && !w.toolResult()) return i;
      }
    }
    return undefined;
  });

  /** Dim the transcript behind a permission prompt; a question to the user does not dim it. */
  const dimmed = computed(
    () => permissionRequestsLen.value > 0 && (permissionRequests.value[0] as { toolName?: string })?.toolName !== 'AskUserQuestion'
  );

  // ---- Inline title rename -------------------------------------------------
  // Clicking the header title edits it in place, the way the official extension
  // renames a session tab. Enter commits, Escape reverts, blur commits so the
  // edit is not silently lost by clicking away.

  const isEditingTitle = ref(false);
  const titleDraft = ref('');
  const titleInputRef = ref<HTMLInputElement | null>(null);

  function beginEditTitle(): void {
    titleDraft.value = title.value;
    isEditingTitle.value = true;
    void nextTick(() => {
      titleInputRef.value?.focus();
      titleInputRef.value?.select();
    });
  }

  function cancelTitle(): void {
    isEditingTitle.value = false;
  }

  function commitTitle(): void {
    if (!isEditingTitle.value) return;
    isEditingTitle.value = false;

    const next = titleDraft.value.trim();
    if (!next || next === title.value) return;

    // Update the session locally so the header reflects the change immediately,
    // then tell the host so the editor tab follows.
    activeSessionRaw.value?.summary(next);
    runtime?.appContext.renameTab?.(next);
  }


  // 注册命令：permissionMode.toggle（在下方定义函数后再注册）

  // 估算 Token 使用占比（基于 usageData）
  const usageComputed = computed(() => {
    const s = session.value;
    if (!s) return { percentage: 0, totalTokens: 0, contextWindow: 200000 };

    const usage = s.usageData.value;
    const total = usage.totalTokens;
    const windowSize = usage.contextWindow || 200000;
    const percentage = (typeof total === 'number' && total > 0)
      ? Math.max(0, Math.min(100, (total / windowSize) * 100))
      : 0;

    return { percentage, totalTokens: total, contextWindow: windowSize };
  });

  const progressPercentage = computed(() => usageComputed.value.percentage);

  const contextTooltip = computed(() => {
    const { totalTokens, contextWindow } = usageComputed.value;
    const fmt = (n: number) => {
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
      if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
      return `${n}`;
    };
    return `${fmt(totalTokens)} / ${fmt(contextWindow)} context used`;
  });

  // DOM refs
  const containerEl = ref<HTMLDivElement | null>(null);
  const endEl = ref<HTMLDivElement | null>(null);
  const inputContainerEl = ref<HTMLDivElement | null>(null);

  // The composer floats over the transcript, so both the transcript and the
  // empty state reserve its height at the bottom -- the official build does the
  // same with a measured spacer.
  const inputHeight = ref(0);
  const inputResize = new ResizeObserver(([entry]) => {
    inputHeight.value = entry.contentRect.height;
  });

  // 附件状态管理
  const attachments = ref<AttachmentItem[]>([]);

  // 记录上次消息数量，用于判断是否需要滚动
  let prevCount = 0;

  function stringify(m: any): string {
    try {
      return JSON.stringify(m ?? {}, null, 2);
    } catch {
      return String(m);
    }
  }

  function scrollToBottom(): void {
    const end = endEl.value;
    if (!end) return;
    requestAnimationFrame(() => {
      try {
        end.scrollIntoView({ block: 'end' });
      } catch {}
    });
  }

  /** Bumped per conversation, so the empty state replays its entrance on every new one. */
  const conversationKey = ref(0);

  /** The topic card under the mascot, if this empty state shows one rather than a tip. */
  const welcomeCard = ref<WelcomeCardDef | undefined>(nextWelcomeCard());
  watch(conversationKey, () => {
    welcomeCard.value = nextWelcomeCard();
  });

  /**
   * The Ultracode card's link does what the slider's last notch does, so it is
   * offered only where that notch is (B4): the model lists `xhigh` and
   * workflows are on. Elsewhere the card still explains, without a dead link.
   */
  const shownWelcomeCard = computed(() => {
    const card = welcomeCard.value;
    if (card?.id === 'ultracode' && !session.value?.ultracodeAvailable.value) return { ...card, action: undefined };
    return card;
  });

  function retireCard(id: string): void {
    retireWelcomeCard(id);
    welcomeCard.value = undefined;
  }

  /** Each card's link does the thing it describes, then retires the card. */
  function handleWelcomeAction(id: string): void {
    switch (id) {
      case 'ultracode':
        void handleEnableUltracode();
        break;
      case 'plan-mode':
        void handleModeSelect('plan');
        break;
      case 'edit-automatically':
        void handleModeSelect('acceptEdits');
        break;
      case 'mentions':
        inputBoxRef.value?.insertText('@');
        break;
      case 'actions-menu':
        inputBoxRef.value?.openActionsMenu();
        break;
      case 'history':
        sessionsOpen.value = true;
        break;
    }
    retireCard(id);
  }

  watch(session, async (_now, before) => {
    // 切换会话：复位并滚动底部
    // A new conversation, not the first session arriving at startup.
    if (before) conversationKey.value++;
    prevCount = 0;
    await nextTick();
    scrollToBottom();
  });

  // moved above

  watch(
    () => messages.value.length,
    async len => {
      const increased = len > prevCount;
      prevCount = len;
      if (increased) {
        await nextTick();
        scrollToBottom();
      }
    }
  );

  // The official chat view stays pinned while the transcript grows: before each
  // messages update it notes whether the view is within 50px of the bottom, and
  // after the render it scrolls back down if so. Streamed text grows in place
  // without adding a row, so the count watcher above does not see it.
  let pinnedToBottom = true;
  watch(
    messages,
    () => {
      const el = containerEl.value;
      if (el) pinnedToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    },
    { flush: 'pre' }
  );
  watch(
    messages,
    () => {
      const el = containerEl.value;
      if (el && pinnedToBottom) el.scrollTop = el.scrollHeight;
    },
    { flush: 'post' }
  );

  watch(permissionRequestsLen, async () => {
    // 有权限请求出现时也确保滚动到底部
    await nextTick();
    scrollToBottom();
  });

  // VS Code commands and keybindings (forge.focus, forge.newConversation, ...)
  // arrive as one-way ui_command notifications. The webview is the only place
  // that knows how to carry them out, so they are handled here rather than in
  // the extension host.
  const inputBoxRef = ref<InstanceType<typeof ChatInputBox> | null>(null);
  let unsubUiCommand: (() => void) | undefined;

  onMounted(async () => {
    if (inputContainerEl.value) inputResize.observe(inputContainerEl.value);
    prevCount = messages.value.length;
    await nextTick();
    scrollToBottom();

    unsubUiCommand = transport.uiCommand.add((command) => {
      switch (command) {
        case 'focus_input':
          inputBoxRef.value?.focus();
          break;
        case 'blur_input':
          inputBoxRef.value?.blur();
          break;
        case 'focus_last_message':
          scrollToBottom();
          // Move keyboard focus into the transcript so the message is reachable
          // by screen readers and arrow keys, not just visible.
          containerEl.value?.focus();
          break;
        case 'new_conversation':
          void createNew();
          break;
      }
    });
  });

  onUnmounted(() => {
    inputResize.disconnect();
    try { unregisterToggle?.(); } catch {}
    try { unsubUiCommand?.(); } catch {}
  });

  async function createNew(): Promise<void> {
    if (!runtime) return;

    // 1. 先尝试通过 appContext.startNewConversationTab 创建新标签（多标签模式）
    if (runtime.appContext.startNewConversationTab()) {
      return;
    }

    // 2. 如果不是多标签模式，检查当前会话是否为空
    const currentMessages = messages.value;
    if (currentMessages.length === 0) {
      // Already an empty conversation, so no new session is needed -- but the
      // click still starts afresh: replay the entrance and move to the next card or tip.
      conversationKey.value++;
      return;
    }

    // 3. 当前会话有内容，创建新会话
    await runtime.sessionStore.createSession({ isExplicit: true });
  }

  // ChatInput 事件处理
  async function handleSubmit(content: string) {
    const s = session.value;
    const trimmed = (content || '').trim();
    if (!s || (!trimmed && attachments.value.length === 0) || isBusy.value) return;

    markFirstRunBypassed();
    try {
      // 传递附件给 send 方法
      await s.send(trimmed || ' ', attachments.value);

      // 发送成功后清空附件
      attachments.value = [];
    } catch (e) {
      console.error('[ChatPage] send failed', e);
    }
  }

  /**
   * Effort is carried on the session's thinking level. The backend only tells
   * thinking on from off, so every level keeps thinking enabled; the level itself
   * is what the pill and menus display.
   */
  /**
   * Effort is its own setting: `apply_settings {effortLevel}` (step 11's
   * whitelist), persisted to user settings and pushed to the running CLI. It
   * never touches the thinking level -- that was the old defect, where picking
   * an effort rewrote `thinkingLevel` and could switch thinking off.
   */
  async function handleEffortSelect(level: string) {
    const s = session.value;
    if (!s) return;
    try {
      await s.setEffortLevel(level);
    } catch (error) {
      reportSettingsFailure('effort', error);
    }
  }

  /** The official `enableUltracode`: Extra high plus the session-scoped `ultracode` flag. */
  async function handleEnableUltracode() {
    const s = session.value;
    if (!s) return;
    try {
      await s.enableUltracode();
    } catch (error) {
      reportSettingsFailure('Ultracode', error);
    }
  }

  function reportSettingsFailure(what: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    void runtime?.appContext.showNotification?.(`Failed to set ${what}: ${message}`, 'error');
  }

  async function handleToggleThinking() {
    const s = session.value;
    if (!s) return;

    const currentLevel = s.thinkingLevel.value;
    const newLevel = currentLevel === 'off' ? 'default_on' : 'off';

    await s.setThinkingLevel(newLevel);
  }

  async function handleModeSelect(mode: PermissionMode) {
    const s = session.value;
    if (!s) return;

    await s.setPermissionMode(mode);
  }

  // permissionMode.toggle：按固定顺序轮转
  const togglePermissionMode = () => {
    const s = session.value;
    if (!s) return;
    const order: PermissionMode[] = ['default', 'acceptEdits', 'plan'];
    const cur = (s.permissionMode.value as PermissionMode) ?? 'default';
    const idx = Math.max(0, order.indexOf(cur));
    const next = order[(idx + 1) % order.length];
    void s.setPermissionMode(next);
  };

  // 现在注册命令（toggle 已定义）
  const unregisterToggle = runtime.appContext.commandRegistry.registerAction(
    {
      id: 'permissionMode.toggle',
      label: 'Toggle Permission Mode',
      description: 'Cycle permission mode in fixed order'
    },
    'App Shortcuts',
    () => {
      togglePermissionMode();
    }
  );

  // 注册快捷键：shift+tab → permissionMode.toggle（允许在输入区生效）
  useKeybinding({
    keys: 'shift+tab',
    handler: togglePermissionMode,
    allowInEditable: true,
    priority: 100,
  });

  /** The official sends the picked row itself, not just its value. */
  async function handleModelSelect(model: ModelRow) {
    const s = session.value;
    if (!s) return;

    await s.setModel(model);
  }

  function handleStop() {
    const s = session.value;
    if (s) {
      // 方法已经在 useSession 中绑定，可以直接调用
      void s.interrupt();
    }
  }

  async function handleAddAttachment(files: FileList) {
    if (!files || files.length === 0) return;

    try {
      // 将所有文件转换为 AttachmentItem
      const conversions = await Promise.all(
        Array.from(files).map(convertFileToAttachment)
      );

      // 添加到附件列表
      attachments.value = [...attachments.value, ...conversions];

      console.log('[ChatPage] Added attachments:', conversions.map(a => a.fileName));
    } catch (e) {
      console.error('[ChatPage] Failed to convert files:', e);
    }
  }

  function handleRemoveAttachment(id: string) {
    attachments.value = attachments.value.filter(a => a.id !== id);
  }

  /** "/" → Permissions (the official `I` state): the "Permission rules" dialog. */
  const permissionRulesOpen = ref(false);
  function closePermissionRules(): void {
    permissionRulesOpen.value = false;
    inputBoxRef.value?.focus();
  }

  /** The official prompt's `onPermissionModeChange`: `session.setPermissionMode(mode, push, false)`. */
  async function handlePermissionModeChange(mode: PermissionMode, push: boolean): Promise<void> {
    await session.value?.setPermissionMode(mode, push, false);
  }

</script>

<style scoped>
/*
  Layout, spacing and states come from the ported official stylesheets
  (styles/official/chat.css, shell.css, emptystate.css, tip.css, spinner.css,
  notice.css, banner.css, suggestions.css). What remains here is the new
  conversation choreography and a screen-reader-only utility.
*/

/*
  The banner sits just above the composer, where the transcript's fade-out
  gradient is drawn; lift it over the gradient so the fade never washes it out.
*/
.fg-emptystate__terminalBannerContainer {
  position: relative;
  z-index: 3;
}

/*
  New conversation. The outgoing transcript lifts away and softens; the empty
  state then assembles itself: the wordmark settles, the hammer drops in and
  lands with a tap, and the tip, chips and cards rise in behind it, each a beat
  later. Under three quarters of a second end to end.
*/
.fg-conversation-leave-active {
  transition: opacity 0.19s ease-in, transform 0.19s ease-in, filter 0.19s ease-in;
}

.fg-conversation-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.985);
  filter: blur(3px);
}

.fg-conversation-enter-active :deep(.fg-emptystate__logo) {
  animation: fg-conversation-settle 0.46s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.fg-conversation-enter-active :deep(.fg-hammer) {
  animation: fg-conversation-land 0.62s cubic-bezier(0.2, 0.8, 0.2, 1) 0.08s both;
}

.fg-conversation-enter-active :deep(.fg-tip__messageContainer) {
  animation: fg-conversation-rise 0.44s cubic-bezier(0.2, 0.8, 0.2, 1) 0.18s both;
}

.fg-conversation-enter-active :deep(.fg-notice__container),
.fg-conversation-enter-active :deep(.fg-banner__banner) {
  animation: fg-conversation-rise 0.44s cubic-bezier(0.2, 0.8, 0.2, 1) 0.26s both;
}

@keyframes fg-conversation-settle {
  from { opacity: 0; transform: scale(0.94); filter: blur(4px); }
  to { opacity: 1; transform: none; filter: none; }
}

@keyframes fg-conversation-land {
  0% { opacity: 0; transform: translateY(-14px) rotate(-22deg); }
  55% { opacity: 1; transform: translateY(1px) rotate(5deg); }
  78% { transform: translateY(0) rotate(-1.5deg); }
  100% { opacity: 1; transform: none; }
}

@keyframes fg-conversation-rise {
  from { opacity: 0; transform: translateY(10px); filter: blur(2px); }
  to { opacity: 1; transform: none; filter: none; }
}

@media (prefers-reduced-motion: reduce) {
  .fg-conversation-leave-active {
    transition: opacity 0.12s linear;
  }

  .fg-conversation-leave-to {
    transform: none;
    filter: none;
  }

  .fg-conversation-enter-active :deep(.fg-emptystate__logo),
  .fg-conversation-enter-active :deep(.fg-hammer),
  .fg-conversation-enter-active :deep(.fg-tip__messageContainer),
  .fg-conversation-enter-active :deep(.fg-notice__container),
  .fg-conversation-enter-active :deep(.fg-banner__banner) {
    animation: none;
  }
}

.fg-shell__titleEditHint {
  font-size: 14px;
}
</style>
