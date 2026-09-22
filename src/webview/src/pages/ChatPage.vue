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
          <!--
            First run with no endpoint: the full welcome, on the official login
            page's markup. It is not a gate -- "Stay on Anthropic" steps past it
            for good -- but until you answer it is the whole surface, because
            "where does this send my work" is the question to answer before the
            first message rather than after it.
          -->
          <EndpointWelcome
            v-if="messages.length === 0 && (showEndpointWelcome || welcomeRequested)"
            key="endpoint-welcome"
            :state="welcomeState ?? 'no-profiles'"
            :health="endpointHealth"
            @add="handleEndpointWelcome('add')"
            @check="handleEndpointWelcome('check')"
            @skip="handleEndpointWelcome('skip')"
            @terminal="handleEndpointWelcome('terminal')"
          />
          <div v-else-if="messages.length === 0" :key="`empty-${conversationKey}`" class="fg-chat__emptyState">
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
            <!--
              Focus view (step 30). The official swaps the whole turn list for
              the folded one (`x8 ? e6.map(…) : y1.map(…)`), so this is a second
              render path, not a filter laid over the first: with focus view off
              nothing below changes at all.
            -->
            <template v-if="focusTurns !== null">
              <div
                v-for="(turn, t) in focusTurns"
                :key="`focus-turn-${t}`"
                :class="`fg-chat__turn ${turnHasHighlight(turn) ? 'fg-chat__highlightedMessage' : ''}`"
              >
                <template v-for="row in turn" :key="focusRowKey(row)">
                  <!--
                    `cq0`: the last TodoWrite call is lifted out of its fold and
                    drawn as a timeline row of its own, so the todo list stays
                    visible while everything around it is folded away.
                  -->
                  <div
                    v-if="row.kind === 'todo'"
                    :class="`fg-chat__message fg-chat__timelineMessage ${todoDotClass(row.content)}`"
                    data-testid="focus-todo-item"
                  >
                    <ContentBlock :block="row.content.content" :wrapper="row.content" :context="toolContext" />
                  </div>
                  <MessageRenderer
                    v-else-if="row.kind === 'message'"
                    :message="row.msg"
                    :context="toolContext"
                    :busy="isBusy"
                    :highlighted="row.idx === highlightIndex"
                    :session="activeSessionRaw"
                    :on-create-new-session="createNewSessionWithPrompt"
                    :on-rewind-error="reportRewindError"
                    :fork-conversation="forkConversation"
                  />
                  <template v-else>
                    <FocusFoldRow
                      :fold="row.fold"
                      :is-expanded="isFoldExpanded(row.fold)"
                      :permission-pending="foldHasPermission(row.fold)"
                      :on-toggle="() => toggleFold(row.fold)"
                    />
                    <template v-if="isFoldExpanded(row.fold)">
                      <MessageRenderer
                        v-for="inner in row.fold.messages"
                        :key="`fold-msg-${inner.idx}`"
                        :message="inner.msg"
                        :context="toolContext"
                        :busy="isBusy"
                        :highlighted="inner.idx === highlightIndex"
                        :session="activeSessionRaw"
                        :on-create-new-session="createNewSessionWithPrompt"
                        :on-rewind-error="reportRewindError"
                        :fork-conversation="forkConversation"
                      />
                      <FocusFoldRow
                        v-if="row.fold.toolCallCount + row.fold.hiddenRenderableCount > 0"
                        :fold="row.fold"
                        variant="end"
                        :permission-pending="foldHasPermission(row.fold)"
                        :on-toggle="() => toggleFold(row.fold)"
                      />
                    </template>
                  </template>
                </template>
              </div>
            </template>
            <div
              v-for="(turn, t) in turns"
              v-else
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
                :claims="row.idx === claimCheckedIndex ? claimSummary : undefined"
                :session="activeSessionRaw"
                :on-create-new-session="createNewSessionWithPrompt"
                :on-rewind-error="reportRewindError"
                :fork-conversation="forkConversation"
              />
            </div>
            <div class="fg-chat__spinnerRow">
              <div>
                <Spinner v-if="isBusy && permissionRequestsLen === 0" :size="16" :permission-mode="permissionMode" :retry="apiRetry" />
              </div>
            </div>
            <!-- As in the official build: the transcript ends with room for the
                 composer, so the last message is never hidden behind it. -->
            <div ref="endEl" :style="{ height: `${inputHeight}px`, minHeight: `${inputHeight}px` }" />
          </div>
          </Transition>

          <!-- Fades the transcript out behind the floating composer. -->
          <div v-if="!welcomeUp" class="fg-chat__messageGradient" aria-hidden="true" />

          <!--
            Hidden behind the welcome gate: there is nowhere to send a message
            until an endpoint exists, and a composer you can type into but not
            send from is worse than no composer.
          -->
          <div v-show="!welcomeUp" ref="inputContainerEl" class="fg-chat__inputContainer">
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
              :browser-integration-supported="session?.browserIntegrationSupported.value"
              :permission-mode="session?.permissionMode.value"
              :selected-model="session?.modelSelection.value"
              :slash-commands="session?.claudeConfig.value?.commands"
              :models="session?.claudeConfig.value?.models"
              :unavailable-models="session?.claudeConfig.value?.unavailable_models"
              :last-served-model="session?.lastServedModel.value"
              :model-setting="session?.config.value?.modelSetting"
              :focus-view-enabled="focusViewEnabled"
              :output-style-picker-open="outputStylePickerOpen"
              :output-styles="session?.outputStyleList.value"
              :current-output-style="session?.outputStyle.value"
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
              @open-rewind="rewindPickerOpen = true"
              @open-sessions="sessionsOpen = true"
              @open-output-styles="openOutputStyles"
              @close-output-styles="outputStylePickerOpen = false"
              @output-style-selected="handleOutputStyleSelected"
              @build-output-style="outputStyleWizardOpen = true"
              @focus-view-toggle="handleFocusViewToggle"
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
    <!--
      "/" → Rewind: the official mounts `yH0` beside the command menu
      (`d&&F(yH0,{session:$,context:J,onCreateNewSession:Z,onRewindError:D,
      onClose:()=>{z0(!1),z.current?.focus()}})`). Picking a message opens the
      confirm dialog with `willForkAfter: true`, because this row's flow rewinds
      **and** forks.
    -->
    <!--
      "/" → Output styles → "Build a custom style" (step 29). The official
      mounts `jU0` beside the picker, with the list it already has so a name
      that is taken is caught before the host is asked.
    -->
    <OutputStyleWizard
      v-if="outputStyleWizardOpen && activeSessionRaw"
      :session="activeSessionRaw"
      :existing-styles="session?.outputStyleList.value"
      :on-close="() => (outputStyleWizardOpen = false)"
      :on-saved="() => (outputStyleWizardOpen = false)"
    />
    <RewindPicker
      v-if="rewindPickerOpen && activeSessionRaw"
      :session="activeSessionRaw"
      :on-close="closeRewindPicker"
      :on-create-new-session="createNewSessionWithPrompt"
      :on-rewind-error="reportRewindError"
      :on-fork="forkFromRewindTarget"
    />
  </div>
</template>

<script setup lang="ts">
  import { ref, computed, inject, provide, onMounted, onUnmounted, nextTick, watch } from 'vue';
  import { RuntimeKey } from '../composables/runtimeContext';
  import {
    endpointWelcomeState,
    readSkippedWelcome,
    skipStillApplies,
    writeSkippedWelcome,
    type EndpointWelcomeState,
  } from '../utils/endpointWelcome';
  import { useSession } from '../composables/useSession';
  import type { Session } from '../core/Session';
  import type { PermissionRequest } from '../core/PermissionRequest';
  import type { ToolContext } from '../types/tool';
  import type { AttachmentItem } from '../types/attachment';
  import { convertFileToAttachment, isSupportedAttachment } from '../types/attachment';
  import ChatInputBox from '../components/ChatInputBox.vue';
  import PermissionRequestModal from '../components/PermissionRequestModal.vue';
  import PermissionRulesDialog from '../components/PermissionRulesDialog.vue';
  import RewindPicker from '../components/forge/RewindPicker.vue';
  import OutputStyleWizard from '../components/forge/OutputStyleWizard.vue';
  import FocusFoldRow from '../components/forge/FocusFoldRow.vue';
  import ContentBlock from '../components/Messages/ContentBlock.vue';
  import type { ContentBlockWrapper } from '../models/ContentBlockWrapper';
  import {
    autoExpandedFolds,
    focusViewRows,
    pruneSettled,
    reconcileExpanded,
    type FocusFold,
    type FocusRow,
  } from '../core/focusView';
  import { getToolRenderer } from '../components/Messages/tools/toolRegistry';
  import SessionsDropdown from '../components/forge/SessionsDropdown.vue';
  import HistoryIcon from '../components/forge/icons/HistoryIcon.vue';
  import NewSessionIcon from '../components/forge/icons/NewSessionIcon.vue';
  import Spinner from '../components/Messages/WaitingIndicator.vue';
  import ForgeWordmark from '../components/ForgeWordmark.vue';
  import RandomTip from '../components/RandomTip.vue';
  import WelcomeCard from '../components/welcome/WelcomeCard.vue';
  import EndpointWelcome from '../components/welcome/EndpointWelcome.vue';
  import TerminalBanner from '../components/welcome/TerminalBanner.vue';
  import {
    ENDPOINT_SETUP_CARD,
    nextWelcomeCard,
    retireWelcomeCard,
    type WelcomeCard as WelcomeCardDef,
  } from '../utils/announcements';
  import { markFirstRunBypassed } from '../utils/firstRun';
  import MessageRenderer from '../components/Messages/MessageRenderer.vue';
  import { summariseClaims, toolCallsFrom, type ToolCallRecord } from '../core/claimCheck';
  import { ThinkingExpandedKey, TranscriptBusyKey, createThinkingExpanded } from '../components/Messages/transcriptState';
  import { transport, runHostAction } from '../core/runtimeTransport';
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
  /** Feeds the spinner's retry notice; `undefined` whenever the endpoint is answering. */
  const apiRetry = computed(() => session.value?.apiRetry.value);
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

  // ---- Focus view (step 30) --------------------------------------------------
  // The official builds a second row list when `focusViewEnabled` and renders
  // that instead of the turns above (`x8 ? e6.map(…) : y1.map(…)`). `null` here
  // means focus view is off and the transcript takes its normal path.

  const focusViewEnabled = computed(() => session.value?.focusViewEnabled.value ?? false);

  const focusRows = computed<FocusRow[] | null>(() =>
    focusViewEnabled.value
      ? focusViewRows(messages.value, {
          busy: isBusy.value,
          isToolHidden: (name: string) => getToolRenderer(name).hidden,
        })
      : null
  );

  /** `e6`: the folded rows regrouped into turns, the same way `y1` groups messages. */
  const focusTurns = computed<FocusRow[][] | null>(() => {
    const rows = focusRows.value;
    if (rows === null) return null;
    const out: FocusRow[][] = [];
    let current: FocusRow[] = [];
    for (const row of rows) {
      if (row.kind === 'message' && startsTurn(row.msg) && current.length > 0) {
        out.push(current);
        current = [];
      }
      current.push(row);
    }
    if (current.length > 0) out.push(current);
    return out;
  });

  /** The official `a`: folds whose run has settled, so they stop auto-opening. */
  const settledFolds = new Set<string>();
  /** The official `t5` / `Y0`: what the user has opened. */
  const expandedFolds = ref<Set<string>>(new Set());
  const autoExpanded = computed(() => autoExpandedFolds(focusRows.value, settledFolds));

  // `e(()=>{…Y0((n)=>jL1(n,q1,t)),wL1(a.current,x8)},[a6,J1,x8])`: toggling
  // focus view forgets what was open, a fold that stopped auto-opening closes,
  // and keys for folds no longer in the transcript are dropped.
  let lastFocusViewEnabled = focusViewEnabled.value;
  let lastAutoExpanded = autoExpanded.value;
  watch([focusViewEnabled, autoExpanded, focusRows], () => {
    const toggled = lastFocusViewEnabled !== focusViewEnabled.value;
    lastFocusViewEnabled = focusViewEnabled.value;
    const noLongerAuto = [...lastAutoExpanded].filter((key) => !autoExpanded.value.has(key));
    lastAutoExpanded = autoExpanded.value;
    expandedFolds.value = reconcileExpanded(expandedFolds.value, toggled, noLongerAuto);
    pruneSettled(settledFolds, focusRows.value);
  });

  /** `w2 = t5.has(key) || G5`, plus the auto-expansion a live fold gets. */
  function isFoldExpanded(fold: FocusFold): boolean {
    return expandedFolds.value.has(fold.key) || autoExpanded.value.has(fold.key) || foldHasPermission(fold);
  }

  /** `s2(q1,t)`: clicking a fold row opens or closes it. */
  function toggleFold(fold: FocusFold): void {
    const next = new Set(expandedFolds.value);
    if (isFoldExpanded(fold)) {
      next.delete(fold.key);
      // An auto-opened fold has to be remembered as settled, or the next render
      // would open it again.
      settledFolds.add(fold.key);
    } else {
      next.add(fold.key);
    }
    expandedFolds.value = next;
  }

  /**
   * `G5`: a permission prompt is waiting on a tool inside this fold, so it is
   * forced open -- you cannot be asked to allow something you cannot see.
   */
  function foldHasPermission(fold: FocusFold): boolean {
    const request = permissionRequests.value[0] as { toolName?: string } | undefined;
    if (!request || request.toolName === 'AskUserQuestion' || highlightIndex.value === undefined) return false;
    return fold.messages.some((entry) => entry.idx === highlightIndex.value);
  }

  function turnHasHighlight(turn: FocusRow[]): boolean {
    return turn.some((row) =>
      row.kind === 'fold'
        ? row.fold.messages.some((entry) => entry.idx === highlightIndex.value)
        : row.idx === highlightIndex.value
    );
  }

  /** The official `H1` key per row kind. */
  function focusRowKey(row: FocusRow): string {
    if (row.kind === 'todo') return `focus-todo-${row.idx}`;
    if (row.kind === 'message') return `focus-msg-${row.idx}`;
    return row.fold.key;
  }

  /** `vq0`: the lifted todo's dot follows its own tool result. */
  function todoDotClass(wrapper: ContentBlockWrapper): string {
    const result = wrapper.toolResult();
    if (result !== undefined) return result.is_error ? 'fg-chat__dotFailure' : 'fg-chat__dotSuccess';
    return isBusy.value ? 'fg-chat__dotProgress' : 'fg-chat__dotFailure';
  }

  /**
   * A4: the claim checker.
   *
   * Only the *final* assistant message of a finished turn is checked. A summary
   * mid-turn would flag work that has not happened yet, and checking every
   * message would put a badge on rows that were never claiming anything.
   *
   * Forge-only: the official host has no equivalent. See docs/forge-design.md.
   */
  const claimCheckedIndex = computed<number | undefined>(() => {
    // While busy, the model may still be about to do what it just described.
    if (isBusy.value) return undefined;
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const m = messages.value[i];
      if (m?.type !== 'assistant' || m.isEmpty) continue;
      // The closing summary is a text message; a row that is only tool calls
      // is the work itself, not a report about it.
      const content = m.message?.content;
      const hasText = typeof content === 'string'
        ? content.length > 0
        : Array.isArray(content) && content.some((w: any) => w.content?.type === 'text');
      return hasText ? i : undefined;
    }
    return undefined;
  });

  const claimSummary = computed(() => {
    const idx = claimCheckedIndex.value;
    if (idx === undefined) return undefined;

    const report = assistantText(messages.value[idx]);
    if (!report.trim()) return undefined;

    // Every tool call the session made, which is the evidence.
    const history: ToolCallRecord[] = [];
    for (const m of messages.value) {
      const content = m?.message?.content;
      if (!Array.isArray(content)) continue;
      history.push(...toolCallsFrom(content.map((w: any) => w.content)));
    }
    return summariseClaims(report, history);
  });

  /** The visible text of an assistant row, which is what the model claimed. */
  function assistantText(message: any): string {
    const content = message?.message?.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
      .filter((w: any) => w.content?.type === 'text')
      .map((w: any) => w.content.text ?? '')
      .join('\n');
  }

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

  /**
   * Whether the host reported any endpoint profile, from `init`.
   *
   * Read off the session's bridged `config` rather than the AppContext getter:
   * the underlying value is an alien-signal, and a Vue `computed` reading one
   * through a plain class getter never re-evaluates. `undefined` until the
   * handshake answers, which keeps the setup card from flashing at someone who
   * already has an endpoint.
   */
  const hasEndpoints = computed<boolean | undefined>(() => {
    const count = session.value?.config.value?.endpointProfileCount;
    return count === undefined ? undefined : count > 0;
  });

  /**
   * Whether the full welcome holds the surface.
   *
   * Keyed on the model list, not on whether an endpoint is configured. The
   * question the page answers is "where should Forge send your work", and the
   * moment that matters is when there is nothing to send it to: no endpoint, an
   * endpoint that serves nothing, or one that cannot be reached. A profile that
   * exists but offers no model is exactly as unusable as no profile at all.
   *
   * `undefined` is "not known yet" -- `get_claude_state` has not answered --
   * and is deliberately not zero, so the page does not flash on every launch.
   */
  const modelCount = computed<number | undefined>(
    () => session.value?.claudeConfig.value?.models?.length,
  );

  /**
   * The health verdicts, from the host's push (and the read that seeds it).
   *
   * `undefined` until the host has spoken, on the same discipline as
   * `hasEndpoints` above: a zero read before the handshake would hold the whole
   * surface for one frame on every launch.
   */
  const endpointHealth = useSignal(transport.endpointHealth);

  /** How many models answered a real request, anywhere. */
  const healthyModelCount = computed<number | undefined>(() => {
    const pushed = endpointHealth.value;
    if (pushed) return pushed.reduce((n, row) => n + row.models.filter((m) => m.servable).length, 0);
    return session.value?.config.value?.endpointHealthyModelCount;
  });

  /** How many profiles have a completed sweep behind them. */
  const checkedProfileCount = computed<number | undefined>(() => {
    const pushed = endpointHealth.value;
    if (pushed) return pushed.filter((row) => row.lastSyncedAt !== undefined).length;
    return session.value?.config.value?.endpointHealthCheckedProfileCount;
  });

  /**
   * Which welcome the page is holding up, if any. The rule itself lives in
   * `utils/endpointWelcome.ts`, where it has a spec.
   */
  const welcomeState = computed<EndpointWelcomeState | undefined>(() =>
    endpointWelcomeState({
      hasEndpoints: hasEndpoints.value,
      modelCount: modelCount.value,
      healthyModelCount: healthyModelCount.value,
      checkedProfileCount: checkedProfileCount.value,
    }),
  );

  const showEndpointWelcome = computed(
    () => welcomeState.value !== undefined && !skippedWelcome.value,
  );

  /**
   * "Skip to chat", remembered for this workspace.
   *
   * Cleared the moment a later sweep finds something healthy, or the profiles
   * go away -- so it silences a verdict the user has already overruled without
   * silencing a real one that arrives later. The palette's `show_welcome`
   * brings the page back deliberately at any time.
   */
  const skippedWelcome = ref(readSkippedWelcome());
  watch(
    () => [healthyModelCount.value, hasEndpoints.value] as const,
    ([healthy, profiles]) => {
      if (!skippedWelcome.value) return;
      if (skipStillApplies({ hasEndpoints: profiles, healthyModelCount: healthy })) return;
      skippedWelcome.value = false;
      writeSkippedWelcome(false);
    },
  );

  /** Opened deliberately from the palette, regardless of the model list. */
  const welcomeRequested = ref(false);

  /**
   * Fill in the per-endpoint rows, but only once the page is actually up.
   *
   * The handshake already carries the two counts the gate decides on, so this
   * costs nothing on the common path where the welcome never appears. It is a
   * pure read host-side -- no probe, no network -- and the host's push keeps it
   * current afterwards.
   */
  watch(
    () => welcomeState.value !== undefined || welcomeRequested.value,
    (up) => {
      if (!up || endpointHealth.value !== undefined) return;
      runHostAction('read the endpoint health', async () => {
        const response = await transport.getEndpointHealth();
        transport.endpointHealth(response.health);
      });
    },
    { immediate: true },
  );

  /** Either reason the page is up; what the composer and gradient hide behind. */
  const welcomeUp = computed(
    () => messages.value.length === 0 && (showEndpointWelcome.value || welcomeRequested.value),
  );

  /**
   * The welcome's actions.
   *
   * Three of them do not dismiss it: it is a gate, and it goes when there is
   * somewhere to send work, which the next handshake or the next sweep reports.
   * `skip` is the one exception, and it exists because a stored verdict can be
   * wrong -- the gateway was down for the minute the sweep ran -- and holding
   * the surface on a wrong verdict is worse than the behaviour this replaced.
   * The composer stays live afterwards on purpose: a model the sweep marked
   * dead may well answer, and one that does not says so through the same error
   * path every other send failure uses.
   */
  function handleEndpointWelcome(choice: 'add' | 'terminal' | 'check' | 'skip'): void {
    // Acting on it puts a manually-opened page away. One opened because there
    // is nothing to send to stays until there is, which is the point of it
    // being a gate rather than a notice.
    welcomeRequested.value = false;
    switch (choice) {
      case 'add':
        runHostAction('add an endpoint', () => transport.runEndpointAction('add'));
        return;
      case 'check':
        // Every model, one small request each. The host pushes progress, so the
        // page fills in while it runs rather than freezing on the click.
        runHostAction('check the endpoints', async () => {
          const response = await transport.syncEndpointHealth();
          transport.endpointHealth(response.health);
        });
        return;
      case 'skip':
        skippedWelcome.value = true;
        writeSkippedWelcome(true);
        return;
      default:
        runHostAction('open Forge in the terminal', () => transport.openClaudeInTerminal(undefined, undefined, 'bottom'));
    }
  }

  /** The topic card under the mascot, if this empty state shows one rather than a tip. */
  const welcomeCard = ref<WelcomeCardDef | undefined>(
    nextWelcomeCard({ hasEndpoints: hasEndpoints.value }),
  );
  watch(conversationKey, () => {
    welcomeCard.value = nextWelcomeCard({ hasEndpoints: hasEndpoints.value });
  });
  // `init` usually answers after the first empty state has already drawn, so
  // the choice is made again once the answer lands -- but only while a card is
  // not already on screen, so this never replaces one the user is reading.
  watch(hasEndpoints, (now) => {
    if (now === false && !welcomeCard.value) {
      welcomeCard.value = nextWelcomeCard({ hasEndpoints: now });
    }
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
      case 'endpoint-setup':
        // The same typed request the Settings ▸ Endpoints tab sends (step 32);
        // the host owns the action -> command mapping.
        runHostAction('add an endpoint', () => transport.runEndpointAction('add'));
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
        case 'show_welcome':
          welcomeRequested.value = true;
          break;
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

    // The official `$v`: split the drop into what can be attached and what
    // cannot, *before* anything becomes a chip.
    //
    // This used to convert every file and let `buildUserMessage` discard the
    // unusable ones at send time with nothing but a `console.error`. A `.zip`
    // therefore showed up as an attachment, sat in the composer looking
    // attached, and then silently never reached the model.
    const picked = Array.from(files);
    const supported = picked.filter(isSupportedAttachment);
    const rejected = picked.filter((file) => !isSupportedAttachment(file));

    if (rejected.length > 0) {
      const names = rejected.map((file) => file.name).join(', ');
      void runtime?.appContext.showNotification?.(
        rejected.length === 1
          ? `${names} can't be attached. Forge takes images, PDFs and text files.`
          : `${rejected.length} files can't be attached (${names}). Forge takes images, PDFs and text files.`,
        'warning',
      );
    }

    if (supported.length === 0) return;

    try {
      const conversions = await Promise.all(supported.map(convertFileToAttachment));
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

  // ---- Output styles (step 29) -----------------------------------------------

  /** The official `G1` / `Y1`: the picker, and `K`: the wizard behind its last row. */
  const outputStylePickerOpen = ref(false);
  const outputStyleWizardOpen = ref(false);

  /**
   * The "/" row's action, verbatim: `()=>{Y1(!0),J.refreshOutputStyleForPicker()}`.
   * The picker opens first and lists "Loading output styles…" until the CLI
   * answers, rather than waiting with nothing on screen.
   */
  function openOutputStyles(): void {
    outputStylePickerOpen.value = true;
    void activeSessionRaw.value?.refreshOutputStyleForPicker();
  }

  /** `onStyleSelected:(n)=>{J.setOutputStyle(n)}` -- the picker closes itself. */
  function handleOutputStyleSelected(style: string): void {
    void activeSessionRaw.value?.setOutputStyle(style);
  }

  /** The official row's action: `J.setFocusView(!q1)`. The menu stays open. */
  function handleFocusViewToggle(): void {
    void activeSessionRaw.value?.setFocusView(!focusViewEnabled.value);
  }

  /** The official prompt's `onPermissionModeChange`: `session.setPermissionMode(mode, push, false)`. */
  async function handlePermissionModeChange(mode: PermissionMode, push: boolean): Promise<void> {
    await session.value?.setPermissionMode(mode, push, false);
  }

  // ---- Rewind and fork (steps 24-25) -----------------------------------------

  /** "/" → Rewind (the official `d` state, toggled by `z0`): the `yH0` picker. */
  const rewindPickerOpen = ref(false);
  function closeRewindPicker(): void {
    rewindPickerOpen.value = false;
    inputBoxRef.value?.focus();
  }

  /**
   * The official `onCreateNewSession`: forking the **first** message has no
   * earlier point to resume from, so it starts a fresh conversation seeded with
   * that prompt instead.
   */
  async function createNewSessionWithPrompt(promptText: string): Promise<void> {
    if (!runtime) return;
    const created = await runtime.sessionStore.createSession({ isExplicit: true });
    created.initialPrompt(promptText);
  }

  /** The official `setInputError` / `onRewindError`. See the step-24 results for why this is a notification. */
  function reportRewindError(message: string): void {
    void runtime?.appContext.showNotification(message, 'error');
  }

  /** `context.forkConversation($,J,Z)`. */
  async function forkConversation(sessionId: string, promptText: string, resumeSessionAt?: string): Promise<void> {
    if (!runtime) return;
    await runtime.appContext.forkConversation(sessionId, promptText, resumeSessionAt);
  }

  /** The picker's `D(j)` fork leg, once its own `resumeAtMessageId` check has passed. */
  function forkFromRewindTarget(target: { promptText: string; resumeAtMessageId: string | undefined }): void {
    const id = activeSessionRaw.value?.sessionId();
    if (!id) return;
    void forkConversation(id, target.promptText, target.resumeAtMessageId).catch((e: unknown) => {
      activeSessionRaw.value?.showNotification(
        `Failed to fork conversation: ${e instanceof Error ? e.message : String(e)}`,
        'error'
      );
    });
  }

  /**
   * The official consumes `initialPrompt` when it opens a conversation: the
   * fork arrives with the prompt you forked at waiting in the composer, ready
   * to edit and re-send. Consumed once, then cleared.
   */
  watch(
    () => activeSessionRaw.value?.initialPrompt(),
    (prompt) => {
      if (!prompt) return;
      activeSessionRaw.value?.initialPrompt(undefined);
      inputBoxRef.value?.setContent(prompt);
      inputBoxRef.value?.focus();
    }
  );

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
