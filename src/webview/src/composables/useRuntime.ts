import { onMounted, onUnmounted } from 'vue';
import { effect } from 'alien-signals';
import { ConnectionManager } from '../core/ConnectionManager';
import { AppContext } from '../core/AppContext';
import { SessionStore } from '../core/SessionStore';
import { EventEmitter } from '../utils/events';
import { transport, atMentionEvents, selectionEvents } from '../core/runtimeTransport';
import { slashCommandRows } from '../components/forge/slashCommands';
import { openPlanPreviewFor } from '../core/planPreview';

export interface RuntimeInstance {
  connectionManager: ConnectionManager;
  appContext: AppContext;
  sessionStore: SessionStore;
  atMentionEvents: EventEmitter<string>;
  selectionEvents: EventEmitter<any>;
}

export interface RuntimeOptions {
  /**
   * Start a draft conversation once the list has loaded. The chat page wants
   * one; the standalone sessions view does not -- a draft there was listed as
   * "New Conversation · now" on an empty history, and going active launched a
   * CLI process for a view that never sends a message.
   */
  createInitialSession?: boolean;
}

export function useRuntime(options: RuntimeOptions = {}): RuntimeInstance {
  const createInitialSession = options.createInitialSession ?? true;
  // 复用全局 Transport 实例，确保同一 Webview 宿主只存在一条通信通道
  const connectionManager = new ConnectionManager(() => transport);
  const appContext = new AppContext(connectionManager);

  // `AppContext.currentSelection` is itself an alien signal, so the sessions
  // read it directly. It used to be copied through a Vue `watch`, which cannot
  // see an alien signal change: the copy fired once, with nothing, and never
  // again, so no message ever carried the editor selection.

  const sessionStore = new SessionStore(connectionManager, {
    commandRegistry: appContext.commandRegistry,
    currentSelection: appContext.currentSelection,
    fileOpener: appContext.fileOpener,
    showNotification: appContext.showNotification?.bind(appContext),
    startNewConversationTab: appContext.startNewConversationTab?.bind(appContext),
    renameTab: appContext.renameTab?.bind(appContext),
    openURL: appContext.openURL.bind(appContext)
  });

  // The official hands `viewSession` to the context at construction, closing
  // over the store it assigns just afterwards
  // (`new gB1(z,Z,async(E,I)=>{await q.activateSessionFromServer(E,I)},…)`).
  // Vue builds the store after the context, so it is assigned here instead --
  // same closure, same moment in the lifecycle (step 25).
  appContext.viewSession = (sessionId, initialPrompt) =>
    sessionStore.activateSessionFromServer(sessionId, initialPrompt);

  selectionEvents.add((selection) => {
    appContext.currentSelection(selection);
  });

  // The official `q.onPermissionRequested(MW0)`: an ExitPlanMode prompt shows
  // the plan beside the chat (step 17).
  const stopPlanPreviews = sessionStore.onPermissionRequested(({ session, permissionRequest }) => {
    openPlanPreviewFor(permissionRequest, session);
  });

  // SessionStore 内部的 effect 会自动监听 connection 建立并拉取会话列表

  // 监听 claudeConfig 变化并注册 Slash Commands
  let slashCommandDisposers: Array<() => void> = [];

  const cleanupSlashCommands = effect(() => {
    const connection = connectionManager.connection();
    const claudeConfig = connection?.claudeConfig();

    // 清理旧的 Slash Commands
    slashCommandDisposers.forEach(dispose => dispose());
    slashCommandDisposers = [];

    // 注册新的 Slash Commands
    if (Array.isArray(claudeConfig?.commands)) {
      // Same rows as the command menu (official `qz0`): invocation, label and scope.
      slashCommandDisposers = slashCommandRows(claudeConfig.commands)
        .map((row) => {
          return appContext.commandRegistry.registerAction(
            {
              id: row.id,
              label: row.label,
              description: row.description || undefined
            },
            'Slash Commands',
            () => {
              const activeSession = sessionStore.activeSession();
              if (activeSession) {
                // A Slash Commands row is the user's too (official `W5`).
                void activeSession.send(row.label, [], false, { kind: 'human' });
              } else {
                console.warn('[Runtime] No active session to execute slash command');
              }
            }
          );
        });

      console.log('[Runtime] Registered', slashCommandDisposers.length, 'slash commands');
    }
  });

  onMounted(() => {
    let disposed = false;

    (async () => {
      const connection = await connectionManager.get();
      try { await connection.opened; } catch (e) { console.error('[runtime] open failed', e); return; }

      if (disposed) return;

      try {
        const selection = await connection.getCurrentSelection();
        if (!disposed) appContext.currentSelection(selection?.selection ?? undefined);
      } catch (e) { console.warn('[runtime] selection fetch failed', e); }

      try {
        const assets = await connection.getAssetUris();
        if (!disposed) appContext.assetUris(assets.assetUris);
      } catch (e) { console.warn('[runtime] assets fetch failed', e); }

      // A list that fails to load must not stop the chat from starting: the
      // conversation below does not depend on it, and the list offers its own
      // retry.
      try {
        await sessionStore.listSessions();
      } catch (e) { console.warn('[runtime] session list failed', e); }
      if (!disposed && createInitialSession && !sessionStore.activeSession()) {
        await sessionStore.createSession({ isExplicit: false });
      }
    })();

    onUnmounted(() => {
      disposed = true;

      // 清理命令注册
      slashCommandDisposers.forEach(dispose => dispose());
      stopPlanPreviews();
      cleanupSlashCommands();

      connectionManager.close();
    });
  });

  return { connectionManager, appContext, sessionStore, atMentionEvents, selectionEvents };
}

