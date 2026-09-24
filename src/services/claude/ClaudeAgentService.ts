/**
 * ClaudeAgentService - Claude Agent 核心编排服务
 *
 * 职责：
 * 1. 管理多个 Claude 会话（channels）
 * 2. 接收和分发来自 Transport 的消息
 * 3. 启动和控制 Claude 会话（launchClaude, interruptClaude）
 * 4. 路由请求到对应的 handlers
 * 5. RPC 请求-响应管理
 *
 * 依赖：
 * - IClaudeSdkService: SDK 调用
 * - IClaudeSessionService: 会话历史
 * - ILogService: 日志
 * - 其他基础服务
 */

import { moveToGroup, withoutSessions } from '../../shared/sessionGroups';
import { createDecorator } from '../../di/instantiation';
import { ILogService } from '../logService';
import { IConfigurationService } from '../configurationService';
import { IWorkspaceService } from '../workspaceService';
import { IFileSystemService } from '../fileSystemService';
import { INotificationService } from '../notificationService';
import { ITerminalService } from '../terminalService';
import { ITabsAndEditorsService } from '../tabsAndEditorsService';
import { EXPERT_OUTPUT_STYLE, IClaudeSdkService, type SdkQueryParams } from './ClaudeSdkService';
import { IClaudeSessionService } from './ClaudeSessionService';
import { AsyncStream, ITransport } from './transport';
import { HandlerContext } from './handlers/types';
import { IWebViewService } from '../webViewService';
import * as vscode from 'vscode';
import { createSessionStoreWatcher, type SessionStoreWatcher } from './sessionStoreWatcher';
import { getProjectHistoryDir } from './ClaudeSessionService';
import { IEndpointService } from '../endpoints/endpointService';
import { IEndpointHealthService } from '../endpoints/health';
import { SessionWatchdog, describeStall, type StallReport } from './sessionWatchdog';
import { RiskLevel, assess, gate, type GateOutcome } from './commandRisk';
import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fsPromises } from 'node:fs';
import { mergeSettings, validateSettingsWrite } from './settingsWhitelist';
import { readJsonObjectForWrite, writeJsonAtomic } from '../settingsFile';
import { describeLaunchError, isAbortError } from './cliLaunch';
import { modelSettingsPatch, parseSetModelRequest } from './setModel';
import { selectEndpointProfile } from '../endpoints/selection';
import { readClaudeSettings, toAppliedSettings, toClaudeSettingsSnapshot } from './claudeSettings';
import { applyThinkingConfig, parseThinkingLevel, thinkingConfigFor } from './thinkingLevel';
import {
    addShowsUp,
    filterAnsweredPermissions,
    isValidAddRequest,
    isValidRemoveRequest,
    listPermissionRulesUntil,
    readPermissionRules,
    removeShowsUp,
    runPermissionRuleEdit,
    type EditableRuleDestination,
} from './permissionRules';
import { isPermissionMode } from './permissionMode';
import { bypassPersistGateOpen, persistSessionPermissionMode } from './sessionPermissionModes';
import { planRewindCode, rewindResponseFields } from './rewindCode';
import {
    BROWSER_DISCONNECTED_NOTICE,
    CHROME_EXTENSION_INSTALL_URL,
    CHROME_MCP_SERVER_NAME,
    browserProfileRoots,
    browserTabEntries,
    chromeMcpServerConfig,
    findChromeExtension,
} from './chromeMcp';
import { ChromeMcpClient, type BrowserTab } from './chromeMcpClient';
import {
    OUTPUT_STYLE_FOLDER_CHANGED,
    OutputStyleFolderChangedError,
    PROJECT_OUTPUT_STYLES_DIR,
    assertProjectFolderSafe,
    availableOutputStyles,
    createExclusive,
    effectiveOutputStyle,
    isOutputStyleLevel,
    outputStyleDescriptionProblem,
    outputStyleFileContent,
    outputStyleFileName,
    outputStyleNameProblem,
    probeOutputStyleFolder,
    replaceViaTemp,
    tildify,
    userOutputStylesDirFrom,
    type DirIdentity,
    type OutputStyleDraft,
} from './outputStyles';
import { randomUUID } from 'node:crypto';
import {
    DEFAULT_PLAN_TITLE,
    PLAN_PREVIEW_VIEW_TYPE,
    PlanPreviewPanel,
    type PlanComment,
} from './planPreview';

// 消息类型导入
import type {
    WebViewToExtensionMessage,
    RequestMessage,
    ResponseMessage,
    ExtensionRequest,
    ToolPermissionRequest,
    ToolPermissionResponse,
    ApplySettingsRequest,
    SetModelRequest,
    AppliedSettings,
    AddPermissionRulesRequest,
    AddPermissionRulesResponse,
    ListPermissionRulesResponse,
    RemovePermissionRuleRequest,
    RemovePermissionRuleResponse,
    SetPermissionModeRequest,
    SetExpertModeRequest,
    SetPermissionModeResponse,
    OpenMarkdownPreviewRequest,
    OpenMarkdownPreviewResponse,
    GetPlanCommentsRequest,
    GetPlanCommentsResponse,
    RemovePlanCommentRequest,
    RemovePlanCommentResponse,
    ClosePlanPreviewRequest,
    ClosePlanPreviewResponse,
    ClaudeSettingsSnapshot,
    PersistSessionPermissionModeRequest,
    PersistSessionPermissionModeResponse,
    RewindCodeResponse,
    EnsureChromeMcpEnabledResponse,
    DisableChromeMcpResponse,
    CreateNewBrowserTabResponse,
    GetOutputStyleResponse,
    GetOutputStyleLocationsResponse,
    CreateOutputStyleResponse,
    CreateOutputStyleRequest,
    SetFocusViewRequest,
    SetFocusViewResponse,
    OpenForgeSettingsRequest,
    OpenConfigRequest,
    OpenHelpRequest,
    GetEndpointHealthRequest,
    SyncEndpointHealthRequest,
} from '../../shared/messages';

/**
 * How long health pushes are coalesced for.
 *
 * A sweep fires a change per probe; this is the window that turns sixty of
 * them into a handful of repaints without the progress counter looking stuck.
 */
export const ENDPOINT_HEALTH_PUSH_MS = 400;

/** How long a burst of endpoint setting writes is coalesced into one `update_state`. */
export const STATE_UPDATE_PUSH_MS = 150;

/** The settings whose change alters the init state's endpoint fields or the model list. */
/**
 * Settings a running CLI cannot pick up: a change relaunches every channel that
 * is not mid-turn (and the rest when their turn ends), resuming the same
 * conversation. The endpoint ones change the relay and the model; bypass
 * permissions is a launch option (`allowDangerouslySkipPermissions`,
 * sdk.d.ts:1894) that a live session cannot gain.
 */
const ENDPOINT_SETTINGS = [
    'forge.endpoints',
    'forge.endpointProfile',
    'forge.endpointProfilesDir',
    'forge.allowDangerouslySkipPermissions',
];

// SDK 类型导入
import type {
    SDKMessage,
    SDKUserMessage,
    Query,
    PermissionResult,
    PermissionUpdate,
    CanUseTool,
    PermissionMode,
    ThinkingConfig,
    McpServerConfig,
    McpServerStatus,
} from '@anthropic-ai/claude-agent-sdk';

// Handlers 导入
import { noteInputSent, noteOutput } from './pendingInputs';
import {
    handleInit,
    handleRunForgeAction,
    handleListForgeItems,
    handleListPlugins,
    handleEnableBypassPermissions,
    handleListMarketplaces,
    handleInstallPlugin,
    handleUninstallPlugin,
    handleUpdatePlugin,
    handleSetPluginEnabled,
    handleAddMarketplace,
    handleRemoveMarketplace,
    handleRefreshMarketplace,
    buildStateUpdate,
    buildStateOnlyUpdate,
    claimConfigResolver,
    releaseConfigResolver,
    settleConfigFromLaunch,
    handleGetClaudeState,
    handleGetMcpServers,
    handleGetAssetUris,
    handleOpenFile,
    handleGetCurrentSelection,
    handleShowNotification,
    handleNewConversationTab,
    handleOpenOutputPanel,
    handleSetExpertMode,
    handleRenameTab,
    handleOpenDiff,
    handleListSessions,
    handleRenameSession,
    handleArchiveSession,
    handleUnarchiveSession,
    handleSetSessionUnread,
    handleGetSessionGroups,
    handleUpdateSessionGroups,
    handleUpdateSessionSectionCollapseState,
    handleGetCollapsedPanelSections,
    handleUpdateCollapsedPanelSections,
    handleForkConversation,
    handleGetSession,
    handleListFiles,
    handleStatPath,
    handleOpenContent,
    handleOpenURL,
    handleOpenConfigFile,
    handleOpenForgeSettings,
    handleOpenConfig,
    handleOpenHelp,
    handleRunEndpointAction,
    handleGetEndpointHealth,
    handleSyncEndpointHealth,
    handleRevealChat,
    handleOpenClaudeInTerminal,
    // handleGetAuthStatus,
    // handleLogin,
    // handleSubmitOAuthCode,
    handleGetSettings,
    handleUpdateSetting,
    handleResetSetting,
    handleSwitchProfile,
    handleCreateProfile,
    handleDeleteProfile,
    handleGetExtensionConfig,
    handleUpdateExtensionConfig,
    handleSdkProbe,
} from './handlers/handlers';

export const IClaudeAgentService = createDecorator<IClaudeAgentService>('claudeAgentService');

// ============================================================================
// 类型定义
// ============================================================================

/**
 * Channel 对象：管理单个 Claude 会话
 */
export interface Channel {
    in: AsyncStream<SDKUserMessage>;  // 输入流：向 SDK 发送用户消息
    query: Query;                      // Query 对象：从 SDK 接收响应
    /**
     * A user message has gone into it. A channel that never carried one is a
     * pre-launched idle process -- the chat launches one as soon as it mounts --
     * and is the one kind that can be replaced without losing anything.
     */
    used?: boolean;
    /**
     * A turn is running, or a message sent during one is still queued in the
     * CLI (`pendingInputs.ts`). An endpoint switch never cuts either off: such
     * a channel is retired once its last queued message has had its turn.
     */
    turnOpen?: boolean;
    /** Uuids of messages sent to the CLI that no turn has consumed yet. */
    pendingInputs?: Set<string>;
    /** The `endpointGeneration` this channel was launched under. */
    generation?: number;
    /** The session's working directory (the official channel's `cwd`): where rule edits run. */
    cwd?: string;
    /**
     * The session this channel is running, so the host can report
     * `openSessionIds` the way the official reports `sessionPanels` (step 22).
     * Seeded from `launch_claude`'s `resume`, then replaced by the id the CLI
     * names in its `system/init`.
     */
    sessionId?: string;
    /**
     * The official channel's `mcpServers`: the dynamic servers this session has
     * been given, so `setMcpServers` can add or remove one without dropping the
     * rest (`{...Q.mcpServers,"claude-in-chrome":J}`). Step 28.
     */
    mcpServers?: Record<string, McpServerConfig>;
    /**
     * The official channel's `chromeMcpState`. Forge keeps it because the two
     * responses report a transition (`wasDisabled` / `wasEnabled`) and the
     * disconnect notice is only enqueued when it really was connected. The
     * official also pushes it to the webview via `update_state`; Forge has no
     * such push and no UI reads it, so it stays host-side (step 28).
     */
    chromeMcpState?: ChromeMcpState;
    /**
     * The official channel's `outputStyles`: the list the CLI reported after the
     * last `reloadOutputStyles()`. `get_output_style` prefers it over the
     * session's initial `available_output_styles` (step 29).
     */
    outputStyles?: string[];
}

/** One `@browser:` row of the mention dropdown (the official `filterBrowserTabs`). */
export interface BrowserTabEntry {
    path: string;
    name: string;
    type: 'browser';
}

/** The official `chromeMcpState` union, as its init state declares it. */
export type ChromeMcpState =
    | { status: 'disconnected' }
    | { status: 'connecting' }
    | { status: 'connected' }
    | { status: 'error'; error: string };

/**
 * 请求处理器
 */
interface RequestHandler {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    /** The channel the request was sent on, so its webview going away can settle it. */
    channelId?: string;
}

/** A request whose webview went away before it answered (`settleRequestsOf`). */
export class WebviewGoneError extends Error {
    constructor() {
        super('The Forge panel that was asked closed before it answered.');
        this.name = 'WebviewGoneError';
    }
}

/**
 * Claude Agent 服务接口
 */
export interface IClaudeAgentService {
    readonly _serviceBrand: undefined;

    /**
     * 设置 Transport
     */
    setTransport(transport: ITransport): void;

    /**
     * 启动消息循环
     */
    start(): void;

    /**
     * 接收来自客户端的消息
     */
    fromClient(message: WebViewToExtensionMessage): Promise<void>;

    /**
     * 向 WebView 发送单向通知（不等待响应）
     */
    notifyClient(request: ExtensionRequest): void;

    /**
     * "Start new session in this group" (`reveal_chat` with `groupId`): the
     * next fresh conversation to name its session joins the group. `undefined`
     * forgets a group still waiting.
     */
    setPendingGroup(groupId: string | undefined): void;

    /**
     * 启动 Claude 会话
     */
    launchClaude(
        channelId: string,
        resume: string | null,
        cwd: string,
        model: string | null,
        permissionMode: string,
        thinkingLevel: string | null
    ): Promise<void>;

    /**
     * 中断 Claude 会话
     */
    interruptClaude(channelId: string): Promise<void>;

    /**
     * 关闭会话
     */
    closeChannel(channelId: string, sendNotification: boolean, error?: string): void;

    /**
     * 关闭所有会话
     */
    closeAllChannels(): Promise<void>;

    /**
     * 凭证变更时关闭所有通道
     */
    closeAllChannelsWithCredentialChange(): Promise<void>;

    /**
     * 处理请求
     */
    processRequest(request: RequestMessage, signal: AbortSignal): Promise<unknown>;

    /**
     * 设置权限模式
     */
    setPermissionMode(channelId: string, mode: PermissionMode): Promise<void>;

    /** Forge-only: the Expert output style on (or off) for one running session. */
    setExpertMode(channelId: string, enabled: boolean): Promise<void>;

    /**
     * 设置 Thinking Level
     */
    setThinkingLevel(channelId: string, level: string): Promise<void>;

    /**
     * The official `case"rewind_code"`: restore the files tracked since a user
     * message, or preview what that would do (`dryRun`).
     */
    rewindCode(channelId: string | undefined, request: unknown): Promise<RewindCodeResponse>;

    /**
     * 应用设置（官方 apply_settings 白名单）
     */
    applySettings(
        channelId: string | undefined,
        settings: Record<string, unknown>,
        flagsOnly?: boolean,
        scope?: string
    ): Promise<void>;

    /**
     * 设置模型（官方 setModel：写入用户设置，再推送到运行中的会话）
     * Returns what the CLI then reports it applied, when it can say.
     */
    setModel(channelId: string, model: string): Promise<AppliedSettings | undefined>;

    /**
     * 官方 get_applied_settings：CLI 实际生效的 model / effort / ultracode
     */
    getAppliedSettings(channelId: string): Promise<AppliedSettings | undefined>;

    /**
     * `get_mcp_servers`: the channel CLI's `mcpServerStatus()` (`sdk.d.ts`
     * `Query`), behind the official `withChannel` check: throws at once for a
     * channel that does not exist, and hands back the call for one that does.
     */
    mcpServerStatusFor(channelId: string): () => Promise<McpServerStatus[]>;

    /**
     * The official `cachedClaudeSettings`: the CLI's last `get_settings` read (the
     * config probe, or a settings write), kept so the host can tell whether a
     * settings layer disables bypass (step 18).
     */
    noteClaudeSettings(snapshot: ClaudeSettingsSnapshot | undefined): void;
    getCachedClaudeSettings(): ClaudeSettingsSnapshot | undefined;

    /**
     * The official `pushStateUpdate()`, coalesced: the init state and the
     * config to every page. The shared config calls it when it settles, so a
     * handshake that answered before the "/" list arrived still gets it.
     */
    schedulePushStateUpdate(): void;

    /**
     * The official `sendSessionStates`: push the sessions feed the status dot
     * reads (step 22). Also the thing that makes the feed "ready" -- until it
     * arrives, the list shows no dot at all.
     */
    sendSessionStates(): void;

    /** The sessions the host is running a channel for (the official `sessionPanels`). */
    getOpenSessionIds(): string[];

    /**
     * The official `getMatchingBrowserTabs`: the `@browser:` rows for the
     * composer's mention dropdown (step 28). `useCache` answers from the last
     * list and refreshes in the background, as the general `@` list does.
     */
    getMatchingBrowserTabs(query: string | undefined, useCache?: boolean): Promise<BrowserTabEntry[]>;

    /**
     * 关闭
     */
    shutdown(): Promise<void>;
}

// ============================================================================
// ClaudeAgentService 实现
// ============================================================================

/**
 * Claude Agent 服务实现
 */
export class ClaudeAgentService implements IClaudeAgentService {
    readonly _serviceBrand: undefined;

    // Transport 适配器
    private transport?: ITransport;

    // 会话管理
    private channels = new Map<string, Channel>();

    // 接收来自客户端的消息流
    private fromClientStream = new AsyncStream<WebViewToExtensionMessage>();

    // 等待响应的请求
    private outstandingRequests = new Map<string, RequestHandler>();

    // 取消控制器
    private abortControllers = new Map<string, AbortController>();

    /**
     * Liveness for running channels.
     *
     * Advisory only: it reports a stall and offers to stop the turn, and never
     * terminates anything itself. A turn legitimately goes quiet while the CLI
     * runs a long build inside a Bash call, and killing on silence would abort
     * real work precisely on the tasks most expensive to lose.
     */
    private readonly watchdog = new SessionWatchdog({
        // Threshold follows the active endpoint, because a cold-starting
        // self-hosted model is quiet for far longer than api.anthropic.com.
        requestTimeoutMs: () =>
            this.endpointService.getStatus().profile?.timeoutMs ?? 120_000,
        onStall: (report) => {
            this.onChannelStalled(report).catch((error) => {
                // A reload or shutdown cancels the open notification; that is
                // not a failure.
                if (String(error).includes('Canceled')) this.logService.trace(`[Watchdog] stall notice dismissed: ${error}`);
                else this.logService.error(`[Watchdog] stall notice failed: ${error}`);
            });
        },
    });

    // Handler 上下文（缓存）
    private handlerContext: HandlerContext;

    constructor(
        @ILogService private readonly logService: ILogService,
        @IConfigurationService private readonly configService: IConfigurationService,
        @IWorkspaceService private readonly workspaceService: IWorkspaceService,
        @IFileSystemService private readonly fileSystemService: IFileSystemService,
        @INotificationService private readonly notificationService: INotificationService,
        @ITerminalService private readonly terminalService: ITerminalService,
        @ITabsAndEditorsService private readonly tabsAndEditorsService: ITabsAndEditorsService,
        @IClaudeSdkService private readonly sdkService: IClaudeSdkService,
        @IClaudeSessionService private readonly sessionService: IClaudeSessionService,
        @IWebViewService private readonly webViewService: IWebViewService,
        @IEndpointService private readonly endpointService: IEndpointService,
        @IEndpointHealthService private readonly endpointHealthService: IEndpointHealthService
    ) {
        // 构建 Handler 上下文
        this.handlerContext = {
            endpointService: this.endpointService,
            endpointHealthService: this.endpointHealthService,
            logService: this.logService,
            configService: this.configService,
            workspaceService: this.workspaceService,
            fileSystemService: this.fileSystemService,
            notificationService: this.notificationService,
            terminalService: this.terminalService,
            tabsAndEditorsService: this.tabsAndEditorsService,
            sessionService: this.sessionService,
            sdkService: this.sdkService,
            agentService: this,  // 自身引用
            webViewService: this.webViewService,
        };
    }

    /**
     * 设置 Transport
     */
    setTransport(transport: ITransport): void {
        this.transport = transport;

        // 监听来自客户端的消息，推入队列
        transport.onMessage(async (message) => {
            await this.fromClient(message);
        });

        this.logService.info('[ClaudeAgentService] Transport connected');
    }

    /**
     * 启动消息循环
     */
    start(): void {
        // 启动消息循环
        this.readFromClient().catch((error) =>
            this.logService.error(`[ClaudeAgentService] the webview message loop stopped: ${error}`));

        // A panel that closes with a permission prompt up can never answer it,
        // and its conversations have no one left to talk to.
        const disposed = this.webViewService.onDidDisposeWebview?.((webviewId) => this.onWebviewDisposed(webviewId));
        if (disposed) this.disposables.push(disposed);

        // Health changes reach every open webview, so a sweep begun in Settings
        // updates the welcome page behind it.
        // The model picker's rows carry each pair's last check ("answered in
        // 1.2s", "did not answer: ..."), so they are re-sent too. Coalesced:
        // a sweep fires this once per probe.
        this.endpointHealthService.onDidChangeHealth(() => {
            this.sendEndpointHealth();
            this.schedulePushStateUpdate();
        });

        // An endpoint saved, removed or selected changes what the welcome gate
        // and the model picker read, so every page is told at once rather than
        // on its next reload (the official `pushStateUpdate()`).
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (ENDPOINT_SETTINGS.some((key) => event.affectsConfiguration(key))) {
                    this.endpointGeneration++;
                    this.recycleIdleChannels();
                    this.schedulePushStateUpdate();
                }
            })
        );

        // A conversation created or deleted on disk: the lists re-read.
        this.sessionStoreWatcher = createSessionStoreWatcher(
            getProjectHistoryDir(this.getCwd()),
            () => this.sendSessionStoreChanged()
        );
        this.disposables.push({ dispose: () => this.sessionStoreWatcher?.dispose() });

        this.logService.info('[ClaudeAgentService] Message loop started');
    }

    /**
     * Close every channel that has not carried a message yet.
     *
     * The chat launches its CLI process when it mounts, so on a fresh install
     * that process starts before any endpoint exists -- with no relay and no
     * credentials. Setting an endpoint up afterwards did not reach it, and the
     * first message after setup came back "Not logged in". Closing the idle
     * process ends its stream; the webview then clears the channel, and the
     * next send launches a new one on the endpoint just chosen. A channel that
     * has been used is left alone: closing it would end a conversation.
     */
    /**
     * Bumped on every endpoint settings change. A launch records the value it
     * started under; one that finishes after a change was made on stale
     * settings. The add flow writes twice a few seconds apart (the profile,
     * then "Use it now" selects it), and the chat pre-launches again the moment
     * its idle channel is closed, so the second write routinely lands while
     * that relaunch is still spawning -- where `recycleIdleChannels` cannot see
     * it yet.
     */
    private endpointGeneration = 0;

    /**
     * The endpoint (or the pair picked in the chat) changed: every channel that
     * is not in the middle of a turn is closed, so its next message relaunches
     * it on the new endpoint. The webview resumes the same conversation
     * (`launch_claude` with its session id), so a switch mid-conversation takes
     * effect from the next message and keeps the history -- the behaviour the
     * user chose. A channel mid-turn finishes the turn first (see
     * `retireIfStale`).
     */
    recycleIdleChannels(): void {
        for (const [channelId, channel] of [...this.channels]) {
            if (channel.turnOpen) continue;
            this.logService.info(
                `[ClaudeAgentService] endpoint settings changed; relaunching ${channel.used ? 'conversation' : 'idle'} channel ${channelId} on next send`
            );
            this.closeChannel(channelId, true);
        }
    }

    /** After a turn: a channel launched on an endpoint that has since changed is retired. */
    private retireIfStale(channelId: string): void {
        const channel = this.channels.get(channelId);
        if (!channel || channel.generation === undefined || channel.generation === this.endpointGeneration) return;
        this.logService.info(`[ClaudeAgentService] channel ${channelId} finished its turn on the previous endpoint; relaunching on next send`);
        this.closeChannel(channelId, true);
    }

    private readonly disposables: { dispose(): unknown }[] = [];
    private sessionStoreWatcher?: SessionStoreWatcher;
    private stateUpdatePush?: ReturnType<typeof setTimeout>;

    /**
     * The official `pushStateUpdate()`: the whole init state and the model
     * config, to every page. Coalesced, because saving one profile from the
     * add flow writes `forge.endpoints` and then `forge.endpointProfile`.
     */
    schedulePushStateUpdate(): void {
        if (this.stateUpdatePush) return;
        this.stateUpdatePush = setTimeout(() => {
            this.stateUpdatePush = undefined;
            void this.pushStateUpdate();
        }, STATE_UPDATE_PUSH_MS);
    }

    async pushStateUpdate(): Promise<void> {
        try {
            // The gate's answer first, the model list when it is ready.
            this.notifyClient(await buildStateOnlyUpdate(this.handlerContext));
            this.notifyClient(await buildStateUpdate(this.handlerContext));
        } catch (error) {
            this.logService.warn(`[ClaudeAgentService] update_state push failed: ${error}`);
        }
    }

    /** The official `sendSessionStoreChanged()`. No payload: re-read the list. */
    sendSessionStoreChanged(): void {
        this.notifyClient({ type: "session_store_changed" });
    }

    /**
     * 接收来自客户端的消息
     */
    async fromClient(message: WebViewToExtensionMessage): Promise<void> {
        this.fromClientStream.enqueue(message);
    }

    /**
     * 从客户端读取并分发消息
     *
     * One message can never stop the loop, and one channel can never hold up
     * another channel or a request that has none.
     *
     * Both used to happen. `launch_claude` was awaited inline, so every message
     * behind it -- from every webview -- waited for the CLI to spawn; and the
     * whole loop sat in one try/catch, so the first launch that threw ended it
     * for good. A launch throws on a machine with no binary for its platform
     * (a Linux dev container given the win32 build), and `io_message` throws
     * for a channel whose launch failed. After either, nothing any webview sent
     * was ever answered: "Set up an endpoint" did nothing, the sessions list
     * loaded forever, and a reopened panel never got its `init`, so the welcome
     * gate read "not known" and showed the chat page instead.
     *
     * Messages for one channel still run in the order they arrived -- input must
     * not reach a channel before its launch has registered it -- but on that
     * channel's own queue (`onChannel`), not on the loop.
     */
    private async readFromClient(): Promise<void> {
        for await (const message of this.fromClientStream) {
            try {
                this.dispatchFromClient(message);
            } catch (error) {
                this.logService.error(
                    `[ClaudeAgentService] ${(message as { type?: string })?.type ?? 'message'} failed: ${error}`
                );
            }
        }
    }

    /** Route one webview message. Never awaits: long work goes on a channel queue. */
    private dispatchFromClient(message: WebViewToExtensionMessage): void {
        switch (message.type) {
            case "launch_claude": {
                // Replies for this channel go back to the webview that opened it.
                if (message.webviewId) this.channelOwners.set(message.channelId, message.webviewId);
                this.onChannel(message.channelId, () =>
                    this.launchClaude(
                        message.channelId,
                        message.resume || null,
                        message.cwd || this.getCwd(),
                        message.model || null,
                        message.permissionMode || "default",
                        message.thinkingLevel || null
                    )
                );
                return;
            }

            case "close_channel":
                this.onChannel(message.channelId, () => this.closeChannel(message.channelId, false));
                return;

            case "interrupt_claude":
                this.onChannel(message.channelId, () => this.interruptClaude(message.channelId));
                return;

            case "io_message":
                this.onChannel(message.channelId, () =>
                    this.transportMessage(message.channelId, message.message, message.done)
                );
                return;

            case "request": {
                // A request naming a channel with work still queued waits for that
                // work to *start* after it, exactly as the old serial loop ordered
                // it; it is not awaited there, so a slow one (a diff waiting on the
                // user) never holds up the channel's input. Every other request --
                // `init`, `list_sessions_request`, `run_endpoint_action` -- is
                // answered at once.
                const channelId = message.channelId;
                if (channelId && this.channelWork.has(channelId)) {
                    this.onChannel(channelId, () => {
                        void this.handleRequest(message);
                    });
                } else {
                    void this.handleRequest(message);
                }
                return;
            }

            case "response":
                this.handleResponse(message);
                return;

            case "cancel_request":
                this.handleCancellation(message.targetRequestId);
                return;

            default:
                this.logService.error(`Unknown message type: ${(message as { type: string }).type}`);
        }
    }

    /**
     * Each channel's own queue: launch, input, interrupt and close for one
     * channel run in arrival order, and a failure is logged and ends only that
     * step. `launchClaude` has already told the webview (a `close_channel`
     * carrying the error) by the time its failure lands here.
     */
    private readonly channelWork = new Map<string, Promise<void>>();

    private onChannel(channelId: string, work: () => unknown): void {
        const previous = this.channelWork.get(channelId) ?? Promise.resolve();
        const next = previous
            .then(() => work())
            .then(
                () => undefined,
                (error) => {
                    this.logService.error(`[ClaudeAgentService] channel ${channelId}: ${error}`);
                }
            );
        this.channelWork.set(channelId, next);
        void next.then(() => {
            if (this.channelWork.get(channelId) === next) this.channelWork.delete(channelId);
        });
    }

    /**
     * Which webview opened each channel, from the `webviewId` the webview
     * service stamps on every incoming message.
     *
     * The webview service delivers an untargeted message to the side-bar chat
     * only, so a conversation opened in an editor tab never received its own
     * stream, permission prompts or close. Stamping the owner on every
     * channel-scoped send (`sendToClient`) routes it back to the tab it
     * belongs to.
     */
    private readonly channelOwners = new Map<string, string>();

    /** Send to the webview, routed to the channel's owner when there is one. */
    private sendToClient(message: any): void {
        if (!this.transport) return;
        const channelId = typeof message?.channelId === "string" ? message.channelId : "";
        const owner = channelId ? this.channelOwners.get(channelId) : undefined;
        this.transport.send(owner && !message.webviewId ? { ...message, webviewId: owner } : message);
    }

    /**
     * 启动 Claude 会话
     */
    async launchClaude(
        channelId: string,
        resume: string | null,
        cwd: string,
        model: string | null,
        permissionMode: string,
        thinkingLevel: string | null
    ): Promise<void> {
        // The official launch: the webview's level, else the persisted one, turned
        // into `Options.thinking` by `m$$` -- never derived from effort.
        const launchGeneration = this.endpointGeneration;

        // The official `launchClaude`: a launch the host cannot honour is
        // downgraded to `default`, and the webview told so with a status
        // message, instead of reaching a CLI that refuses bypass without the
        // allow option:
        //   let K=this.settings.getAllowDangerouslySkipPermissions(),G;
        //   if(J!==void 0&&!ou$(J))G=`permissionMode is not a recognized mode (${typeof J})`;
        //   else if(J==="bypassPermissions"&&!K)G="allowDangerouslySkipPermissions is off";
        //   if(G!==void 0){this.logger.warn(`Downgrading launch to default mode on channel ${$}: ${G}`),J="default";
        //     this.send({type:"io_message",channelId:$,message:{type:"system",subtype:"status",permissionMode:"default"},done:!1})}
        let downgrade: string | undefined;
        if (!isPermissionMode(permissionMode)) {
            downgrade = `permissionMode is not a recognized mode (${typeof permissionMode})`;
        } else if (permissionMode === 'bypassPermissions' && !this.sdkService.getAllowDangerouslySkipPermissions()) {
            downgrade = 'allowDangerouslySkipPermissions is off';
        }
        if (downgrade !== undefined) {
            this.logService.warn(`Downgrading launch to default mode on channel ${channelId}: ${downgrade}`);
            permissionMode = 'default';
            this.sendToClient({
                type: "io_message",
                channelId,
                message: { type: "system", subtype: "status", permissionMode: "default" } as unknown as SDKMessage,
                done: false
            });
        }

        const level = thinkingLevel || this.sdkService.getThinkingLevel();
        const thinking = thinkingConfigFor(level, await this.getShowThinkingSummaries());

        this.logService.info('');
        this.logService.info('╔════════════════════════════════════════╗');
        this.logService.info('║  Launching a Claude session            ║');
        this.logService.info('╚════════════════════════════════════════╝');
        this.logService.info(`  Channel ID: ${channelId}`);
        this.logService.info(`  Resume: ${resume || 'null'}`);
        this.logService.info(`  CWD: ${cwd}`);
        this.logService.info(`  Model: ${model || 'null'}`);
        this.logService.info(`  Permission: ${permissionMode}`);
        this.logService.info(`  Thinking Level: ${level}`);
        this.logService.info(`  Thinking: ${JSON.stringify(thinking)}`);
        this.logService.info('');

        // 检查是否已存在
        if (this.channels.has(channelId)) {
            this.logService.error(`❌ Channel already exists: ${channelId}`);
            throw new Error(`Channel already exists: ${channelId}`);
        }

        // The official `let H=this.claimConfigResolver()`: this launch settles
        // a config the webview is waiting on, from its own initialize response,
        // and the standalone probe never starts.
        let configResolver = claimConfigResolver(this.handlerContext);

        try {
            // 1. 创建输入流
            this.logService.info('📝 Step 1: create the input stream');
            const inputStream = new AsyncStream<SDKUserMessage>();
            this.logService.info('  ✓ Input stream created');

            // 2. 调用 spawnClaude
            this.logService.info('');
            this.logService.info('📝 Step 2: spawnClaude()');

            // stderr 致命错误去重（同一 channel 3s 内不重复推送）
            let lastStderrErrorTime = 0;
            const STDERR_ERROR_DEBOUNCE_MS = 3000;

            const query = await this.spawnClaude(
                inputStream,
                resume,
                async (toolName, input, options) => {
                    // 工具权限回调：通过 RPC 请求 WebView 确认
                    this.logService.info(`🔧 Tool permission request: ${toolName}`);

                    // Risk assessment runs before the permission RPC, so the
                    // dialog can say *why* a command is dangerous and
                    // pre-select the safe answer. It is advisory: an explicit
                    // allow rule still wins, except for the catastrophic cases.
                    const risk = this.assessToolRisk(toolName, input, cwd, permissionMode);
                    if (risk?.decision === 'deny') {
                        this.logService.warn(
                            `[CommandRisk] refused ${toolName}: ${risk.reason?.replace(/\n/g, ' ')}`,
                        );
                        return {
                            behavior: 'deny' as const,
                            message: risk.reason ?? 'This command was refused as unsafe.',
                        };
                    }

                    // The official `canUseTool`: these four options go to the prompt.
                    return this.requestToolPermission(
                        channelId,
                        toolName,
                        input,
                        options.suggestions || [],
                        {
                            // A risky command pre-selects the safe answer,
                            // without overriding a "no" the CLI already chose.
                            defaultToNo: options.defaultToNo || risk?.suggestedDefault === 'deny',
                            suppressAlwaysAllowRule: options.suppressAlwaysAllowRule,
                            toolUseId: options.toolUseID,
                            agentId: options.agentID,
                            riskReason: risk?.reason,
                        }
                    );
                },
                model,
                cwd,
                permissionMode,
                thinking,
                // onStderrError: 将 SDK stderr 致命错误实时推给前端
                (error) => {
                    const now = Date.now();
                    if (now - lastStderrErrorTime < STDERR_ERROR_DEBOUNCE_MS) return;
                    lastStderrErrorTime = now;

                    this.logService.warn(`[ClaudeAgentService] Forwarding a model request error to the chat: ${error.type} - ${error.message}`);
                    this.sendToClient({
                        type: "sdk_error",
                        channelId,
                        error: error.message,
                        statusCode: error.statusCode,
                        errorType: error.type,
                    });
                }
            );
            this.logService.info('  ✓ spawnClaude() done; query created');

            // 3. 存储到 channels Map
            this.logService.info('');
            this.logService.info('📝 Step 3: register the channel');
            this.channels.set(channelId, {
                in: inputStream,
                query: query,
                cwd,
                sessionId: resume ?? undefined,
                generation: launchGeneration
            });
            this.watchdog.open(channelId);
            this.watchdog.start();
            this.sendSessionStates();
            this.logService.info(`  ✓ Channel registered; ${this.channels.size} active session(s)`);

            // Launched on settings that changed while it spawned: replace it
            // before anything is sent into it (see `endpointGeneration`).
            if (launchGeneration !== this.endpointGeneration) {
                this.logService.info(`[ClaudeAgentService] channel ${channelId} launched on stale endpoint settings; relaunching on next send`);
                // The official "Channel canceled mid-launch": the config goes
                // back to the fallback probe.
                if (configResolver) releaseConfigResolver(this.handlerContext, configResolver);
                configResolver = undefined;
                this.closeChannel(channelId, true);
                return;
            }

            // The config from this channel's initialize response.
            void settleConfigFromLaunch(this.handlerContext, configResolver, query);
            configResolver = undefined;

            // 4. 启动监听任务：将 SDK 输出转发给客户端
            this.logService.info('');
            this.logService.info('📝 Step 4: start forwarding output');
            (async () => {
                try {
                    this.logService.info(`  → Reading query output...`);
                    let messageCount = 0;

                    for await (const message of query) {
                        messageCount++;
                        this.logService.trace(`  ← message #${messageCount}: ${message.type}`);

                        // Output means alive, which clears any stall notice;
                        // a result ends the turn, after which silence is normal.
                        this.watchdog.beat(channelId);
                        if (message.type === 'result') this.watchdog.idle(channelId);

                        // The official follows the id the CLI reports, so a
                        // resumed or forked session is reported under its real id.
                        this.noteChannelSessionId(channelId, message);

                        this.sendToClient({
                            type: "io_message",
                            channelId,
                            message,
                            done: false
                        });

                        // A finished turn has written its transcript, so the
                        // lists re-read: a new conversation appears, and one
                        // just continued moves to the top.
                        // What the CLI consumed: a message sent mid-turn
                        // keeps the channel open past this turn's `result`.
                        const current = this.channels.get(channelId);
                        const idle = current ? noteOutput(current, message) : false;
                        if (message.type === "result") {
                            this.sendSessionStoreChanged();
                            if (idle) {
                                this.retireIfStale(channelId);
                            } else if (current?.pendingInputs?.size) {
                                this.logService.info(`[ClaudeAgentService] channel ${channelId}: ${current.pendingInputs.size} message(s) sent mid-turn still queued`);
                            }
                        }
                    }

                    // 正常结束
                    this.logService.info(`  ✓ Query output finished: ${messageCount} message(s)`);
                    this.closeChannel(channelId, true);
                } catch (error) {
                    // 出错
                    this.logService.error(`  ❌ Query output failed: ${error}`);
                    if (error instanceof Error) {
                        this.logService.error(`     Stack: ${error.stack}`);
                    }
                    // The chat's error banner is for a CLI that failed, not one
                    // Forge stopped itself (a new conversation, an endpoint
                    // switch): closing the query can end the loop with an abort.
                    const stoppedByForge = this.channels.get(channelId)?.query !== query || isAbortError(error);
                    this.closeChannel(channelId, true, stoppedByForge ? undefined : describeLaunchError(error));
                }
            })().catch((error) => {
                // Only a failure inside the handlers above can land here (a
                // close that threw); it must not become an unhandled rejection.
                this.logService.error(`[ClaudeAgentService] channel ${channelId}: output loop failed: ${error}`);
            });

            this.logService.info('');
            this.logService.info('✓ Claude session launched');
            this.logService.info('════════════════════════════════════════');
            this.logService.info('');
        } catch (error) {
            this.logService.error('');
            this.logService.error('❌ Claude session launch failed');
            this.logService.error(`Channel: ${channelId}`);
            this.logService.error(`Error: ${error}`);
            if (error instanceof Error) {
                this.logService.error(`Stack: ${error.stack}`);
            }
            this.logService.error('════════════════════════════════════════');
            this.logService.error('');

            if (configResolver) releaseConfigResolver(this.handlerContext, configResolver);
            this.closeChannel(channelId, true, describeLaunchError(error));
            throw error;
        }
    }

    /**
     * 中断 Claude 会话
     */
    /**
     * Assess a shell command a tool is about to run.
     *
     * Only Bash-shaped tools carry a command, so everything else returns
     * undefined and costs nothing. In `bypassPermissions` the assessment is
     * still computed and logged -- the user turned prompts off deliberately,
     * but a record of what ran is still worth having.
     */
    private assessToolRisk(
        toolName: string,
        input: unknown,
        cwd: string,
        permissionMode: string,
    ): GateOutcome | undefined {
        const command = (input as { command?: unknown })?.command;
        if (typeof command !== 'string' || !command.trim()) return undefined;
        if (!/^(bash|shell|run_command|execute)/i.test(toolName)) return undefined;

        const assessment = assess(command, {
            workingDirectory: cwd,
            homeDirectory: os.homedir(),
        });
        if (assessment.level === RiskLevel.Safe) return undefined;

        const outcome = gate({
            assessment,
            bypassPermissions: permissionMode === 'bypassPermissions',
        });

        if (outcome.decision === 'allow' && outcome.reason) {
            this.logService.warn(
                `[CommandRisk] allowed under ${permissionMode}: ${outcome.reason.replace(/\n/g, ' ')}`,
            );
        }
        return outcome;
    }

    /**
     * A channel has gone quiet for longer than the threshold.
     *
     * Reports and offers; never decides. The user is the only one who knows
     * whether the silence is a ten-minute build or a dead endpoint, so the
     * choice is theirs and doing nothing is a valid answer.
     */
    private async onChannelStalled(report: StallReport): Promise<void> {
        const description = describeStall(report);
        this.logService.warn(`[Watchdog] ${report.channelId}: ${description}`);

        const STOP = 'Stop this turn';
        const LOGS = 'Show logs';
        const choice = await this.notificationService.showWarning(description, STOP, LOGS);

        if (choice === STOP) {
            this.logService.info(`[Watchdog] user stopped stalled channel ${report.channelId}`);
            await this.interruptClaude(report.channelId);
        } else if (choice === LOGS) {
            this.logService.show();
        }
    }

    /**
     * The Expert row: the plugin's `forge:Expert` output style through the
     * session-scoped flag layer (`applyFlagSettings`, `sdk.d.ts` L2749), so it
     * applies to this conversation only and writes no settings file. `null`
     * takes the flag off, and the style falls back to the settings files'.
     */
    async setExpertMode(channelId: string, enabled: boolean): Promise<void> {
        const channel = this.requireChannel(channelId);
        await channel.query.applyFlagSettings({ outputStyle: enabled ? EXPERT_OUTPUT_STYLE : null });
        this.logService.info(`[setExpertMode] channel ${channelId}: ${enabled ? 'on' : 'off'}`);
    }

    async interruptClaude(channelId: string): Promise<void> {
        const channel = this.channels.get(channelId);
        if (!channel) {
            this.logService.warn(`[ClaudeAgentService] No such channel: ${channelId}`);
            return;
        }

        try {
            await this.sdkService.interrupt(channel.query);
            this.logService.info(`[ClaudeAgentService] Channel interrupted: ${channelId}`);
        } catch (error) {
            this.logService.error(`[ClaudeAgentService] Interrupt failed:`, error);
        }
    }

    /**
     * 关闭会话
     */
    closeChannel(channelId: string, sendNotification: boolean, error?: string): void {
        this.logService.info(`[ClaudeAgentService] Closing channel: ${channelId}`);

        // A channel that ends with an error is recorded as crashed rather than
        // silently discarded, so the failure is still visible afterwards.
        if (error) this.watchdog.crashed(channelId, error);
        this.watchdog.close(channelId);
        if (this.channels.size <= 1) this.watchdog.stop();

        // 1. 发送关闭通知
        if (sendNotification && this.transport) {
            this.sendToClient({
                type: "close_channel",
                channelId,
                error
            });
        }
        this.channelOwners.delete(channelId);

        // 2. 清理 channel
        const channel = this.channels.get(channelId);
        if (channel) {
            channel.in.done();
            try {
                channel.query.return?.();
            } catch (e) {
                this.logService.warn(`Error cleaning up channel: ${e}`);
            }
            this.channels.delete(channelId);
            this.sendSessionStates();
        }

        this.logService.info(`  ✓ Channel closed; ${this.channels.size} active session(s) left`);
    }

    /**
     * 启动 Claude SDK
     *
     * @param inputStream 输入流，用于发送用户消息
     * @param resume 恢复会话 ID
     * @param canUseTool 工具权限回调
     * @param model 模型名称
     * @param cwd 工作目录
     * @param permissionMode 权限模式
     * @param thinking 官方 `m$$` 的 thinking 配置
     * @returns SDK Query 对象
     */
    protected async spawnClaude(
        inputStream: AsyncStream<SDKUserMessage>,
        resume: string | null,
        canUseTool: CanUseTool,
        model: string | null,
        cwd: string,
        permissionMode: string,
        thinking: ThinkingConfig,
        onStderrError?: SdkQueryParams['onStderrError']
    ): Promise<Query> {
        return this.sdkService.query({
            inputStream,
            resume,
            canUseTool,
            model,
            cwd,
            permissionMode,
            thinking,
            onStderrError
        });
    }

    /**
     * 关闭所有会话
     */
    async closeAllChannels(): Promise<void> {
        const promises = Array.from(this.channels.keys()).map(channelId =>
            this.closeChannel(channelId, false)
        );
        await Promise.all(promises);
        this.channels.clear();
    }

    /**
     * 凭证变更时关闭所有通道
     */
    async closeAllChannelsWithCredentialChange(): Promise<void> {
        const promises = Array.from(this.channels.keys()).map(channelId =>
            this.closeChannel(channelId, true)
        );
        await Promise.all(promises);
        this.channels.clear();
    }

    /**
     * 传输消息到 Channel
     */
    private transportMessage(
        channelId: string,
        message: SDKMessage | SDKUserMessage,
        done: boolean
    ): void {
        const channel = this.channels.get(channelId);
        if (!channel) {
            throw new Error(`Channel not found: ${channelId}`);
        }

        // 用户消息加入输入流
        if (message.type === "user") {
            channel.used = true;
            noteInputSent(channel, message as SDKUserMessage);
            channel.in.enqueue(message as SDKUserMessage);
            this.watchdog.turnStarted(channelId);
        }

        // 如果标记为结束，关闭输入流
        if (done) {
            channel.in.done();
        }
    }

    /**
     * 处理来自客户端的请求
     */
    private async handleRequest(message: RequestMessage): Promise<void> {
        const abortController = new AbortController();
        this.abortControllers.set(message.requestId, abortController);

        try {
            const response = await this.processRequest(message, abortController.signal);
            this.transport?.send({
                type: "response",
                requestId: message.requestId,
                response,
                webviewId: message.webviewId
            });
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.transport?.send({
                type: "response",
                requestId: message.requestId,
                response: {
                    type: "error",
                    error: errorMsg
                },
                webviewId: message.webviewId
            });
        } finally {
            this.abortControllers.delete(message.requestId);
        }
    }

    /**
     * 处理请求
     */
    async processRequest(message: RequestMessage, signal: AbortSignal): Promise<unknown> {
        const request = message.request;
        const channelId = message.channelId;

        if (!request || typeof request !== 'object' || !('type' in request)) {
            throw new Error('Invalid request format');
        }

        this.logService.trace(`[ClaudeAgentService] request: ${request.type}`);

        // 路由表：将请求类型映射到 handler
        switch (request.type) {
            // 初始化和状态
            case "init":
                return handleInit(request, this.handlerContext, message.webviewId);

            case "get_claude_state":
                return handleGetClaudeState(request, this.handlerContext);

            case "sdk_probe":
                return handleSdkProbe(request as any, this.handlerContext);

            case "get_mcp_servers":
                return handleGetMcpServers(request, this.handlerContext, channelId);

            case "get_asset_uris":
                return handleGetAssetUris(request, this.handlerContext);

            // 编辑器操作
            case "open_file":
                return handleOpenFile(request, this.handlerContext);

            case "get_current_selection":
                return handleGetCurrentSelection(this.handlerContext);

            case "open_diff":
                return handleOpenDiff(request, this.handlerContext, signal);

            case "open_content":
                return handleOpenContent(request, this.handlerContext, signal);

            // UI 操作
            case "show_notification":
                return handleShowNotification(request, this.handlerContext);

            case "new_conversation_tab":
                return handleNewConversationTab(request, this.handlerContext);

            case "rename_tab":
                return handleRenameTab(request, this.handlerContext, message.webviewId);

            case "open_url":
                return handleOpenURL(request, this.handlerContext);

            // 设置
            case "set_permission_mode": {
                const permReq = request as SetPermissionModeRequest;
                return this.setPermissionModeRequest(channelId, permReq.mode, permReq.userInitiated);
            }

            // Forge-only: the mode menu's Expert row (production audit, Phase 6).
            case "set_expert_mode":
                return handleSetExpertMode(request as SetExpertModeRequest, this.handlerContext);

            // Step 18: no channel -- the session id travels in the body.
            case "persist_session_permission_mode":
                return this.persistSessionPermissionMode(request as PersistSessionPermissionModeRequest);

            // The plan preview (step 17). The channel travels in the request
            // body, as the official sends it.
            case "open_markdown_preview": {
                const previewReq = request as OpenMarkdownPreviewRequest;
                return this.openMarkdownPreview(
                    previewReq.channelId,
                    previewReq.content,
                    previewReq.title,
                    previewReq.enableComments,
                    message.webviewId
                );
            }

            case "get_plan_comments":
                return this.getPlanComments((request as GetPlanCommentsRequest).channelId);

            case "remove_plan_comment": {
                const removeReq = request as RemovePlanCommentRequest;
                return this.removePlanComment(removeReq.channelId, removeReq.commentId);
            }

            case "close_plan_preview":
                return this.closePlanPreview((request as ClosePlanPreviewRequest).channelId);

            case "set_model": {
                // The official check, before anything else happens.
                const targetModel = parseSetModelRequest((request as SetModelRequest).model);

                // A picker row is an endpoint and its model, named by its
                // profile. Choosing one selects that profile; it does not write
                // a model into ~/.claude/settings.json, where a gateway id
                // leaked into every other CLI session. The switch reaches this
                // conversation from its next message (`recycleIdleChannels`),
                // so no channel is needed for it.
                const { profiles } = this.endpointService.listProfiles();
                const pair = profiles.find((p) => p.name === targetModel);
                if (!pair) {
                    // B3: only a pair the host already knows. There are no
                    // Anthropic defaults to fall back to.
                    throw new Error(
                        profiles.length
                            ? `Unknown endpoint: ${targetModel}`
                            : 'Set up an endpoint first: there is no model to switch to.'
                    );
                }
                await selectEndpointProfile(pair.name);
                this.logService.info(`[setModel] endpoint pair "${pair.name}" (${pair.model}) selected`);
                return { type: "set_model_response" };
            }

            case "get_applied_settings": {
                if (!channelId) {
                    throw new Error('channelId is required for get_applied_settings');
                }
                const applied = await this.getAppliedSettings(channelId);
                return {
                    type: "get_applied_settings_response",
                    ...(applied !== undefined && { applied })
                };
            }

            case "set_thinking_level": {
                if (!channelId) {
                    throw new Error('channelId is required for set_thinking_level');
                }
                const thinkReq = request as any;
                await this.setThinkingLevel(channelId, thinkReq.thinkingLevel);
                return {
                    type: "set_thinking_level_response"
                };
            }

            case "apply_settings": {
                const applyReq = request as ApplySettingsRequest;
                await this.applySettings(
                    channelId,
                    applyReq.settings,
                    applyReq.flagsOnly,
                    applyReq.scope
                );
                return {
                    type: "apply_settings_response"
                };
            }

            // The official permission-rule requests: every answer is in-band.
            case "list_permission_rules":
                return this.listPermissionRules(channelId);

            case "add_permission_rules": {
                const addReq = request as AddPermissionRulesRequest;
                return this.addPermissionRules(channelId, addReq.rules, addReq.behavior, addReq.destination);
            }

            case "remove_permission_rule": {
                const removeReq = request as RemovePermissionRuleRequest;
                return this.removePermissionRule(channelId, removeReq.rule, removeReq.behavior, removeReq.source);
            }

            case "open_config_file":
                return handleOpenConfigFile(request, this.handlerContext);

            // Step 31: the typed replacement for
            // `open_config_file {configType:"command:forge.openSettings"}`.
            case "open_forge_settings":
                return handleOpenForgeSettings(request as OpenForgeSettingsRequest, this.handlerContext);

            // Step 32: the typed replacements for the `command:` allow-list.
            case "open_config":
                return handleOpenConfig(request as OpenConfigRequest, this.handlerContext);

            case "open_help":
                return handleOpenHelp(request as OpenHelpRequest, this.handlerContext);

            case "open_output_panel":
                return handleOpenOutputPanel(request, this.handlerContext);

            case "run_endpoint_action":
                return handleRunEndpointAction(request, this.handlerContext);

            // The Settings page's Skills, Agents and MCP Servers buttons.
            case "run_forge_action":
                return handleRunForgeAction(request, this.handlerContext);

            case "list_forge_items":
                return handleListForgeItems(request, this.handlerContext);

            // The official plugin manager's requests (Settings > Plugins).
            // `reload_plugins` is not here: it reloads a live session's
            // plugins, and the Settings page has no session to reload.
            case "enable_bypass_permissions":
                return handleEnableBypassPermissions(request, this.handlerContext);

            case "list_plugins":
                return handleListPlugins(request, this.handlerContext);
            case "list_marketplaces":
                return handleListMarketplaces(request, this.handlerContext);
            case "install_plugin":
                return handleInstallPlugin(request, this.handlerContext);
            case "uninstall_plugin":
                return handleUninstallPlugin(request, this.handlerContext);
            case "update_plugin":
                return handleUpdatePlugin(request, this.handlerContext);
            case "set_plugin_enabled":
                return handleSetPluginEnabled(request, this.handlerContext);
            case "add_marketplace":
                return handleAddMarketplace(request, this.handlerContext);
            case "remove_marketplace":
                return handleRemoveMarketplace(request, this.handlerContext);
            case "refresh_marketplace":
                return handleRefreshMarketplace(request, this.handlerContext);

            // Endpoint health: what the gateway's models did when asked to
            // serve. Forge-only -- the official host has no endpoint concept.
            case "get_endpoint_health":
                return handleGetEndpointHealth(request as GetEndpointHealthRequest, this.handlerContext);

            case "sync_endpoint_health":
                return handleSyncEndpointHealth(request as SyncEndpointHealthRequest, this.handlerContext);

            case "reveal_chat":
                return handleRevealChat(request, this.handlerContext);

            // 设置持久化
            case "get_settings":
                return handleGetSettings(request, this.handlerContext);

            case "update_setting":
                return handleUpdateSetting(request, this.handlerContext);

            case "reset_setting":
                return handleResetSetting(request, this.handlerContext);

            // Profile 管理
            case "switch_profile":
                return handleSwitchProfile(request, this.handlerContext);

            case "create_profile":
                return handleCreateProfile(request, this.handlerContext);

            case "delete_profile":
                return handleDeleteProfile(request, this.handlerContext);

            // 扩展配置 (~/.forge.json)
            case "get_extension_config":
                return handleGetExtensionConfig(request, this.handlerContext);

            case "update_extension_config":
                return handleUpdateExtensionConfig(request, this.handlerContext);

            // 会话管理
            case "list_sessions_request":
                return handleListSessions(request, this.handlerContext);

            // The official `case"rename_session"`: append a custom-title line (step 20).
            case "rename_session":
                return handleRenameSession(request, this.handlerContext);

            // The official `case"archive_session"` / `case"unarchive_session"` (step 21).
            case "archive_session":
                return handleArchiveSession(request, this.handlerContext);

            case "unarchive_session":
                return handleUnarchiveSession(request, this.handlerContext);

            // The official `case"set_session_unread"`: the base dispatcher answers
            // a bare response and the subclass does the work (step 22).
            case "set_session_unread":
                return handleSetSessionUnread(request, this.handlerContext);

            // The official session groups and collapse state (production audit,
            // Phase 6): `case"get_session_groups"`, `case"update_session_groups"`,
            // `case"update_session_section_collapse_state"`,
            // `case"get_collapsed_panel_sections"`, `case"update_collapsed_panel_sections"`.
            case "get_session_groups":
                return handleGetSessionGroups(request, this.handlerContext);

            case "update_session_groups":
                return handleUpdateSessionGroups(request, this.handlerContext);

            case "update_session_section_collapse_state":
                return handleUpdateSessionSectionCollapseState(request, this.handlerContext);

            case "get_collapsed_panel_sections":
                return handleGetCollapsedPanelSections(request, this.handlerContext);

            case "update_collapsed_panel_sections":
                return handleUpdateCollapsedPanelSections(request, this.handlerContext);

            // The official `case"rewind_code"`: channel-scoped, so it resolves
            // against a live channel's query rather than going to handlers.ts.
            case "rewind_code":
                return this.rewindCode(channelId, request);

            // The official `case"fork_conversation"`: not channel-scoped --
            // forking copies a transcript on disk (step 25).
            case "fork_conversation":
                return handleForkConversation(request, this.handlerContext);

            // Step 28. The official's two chrome cases throw
            // `channelId is required for <type>` before anything else; the tab
            // case is `return await this.createNewBrowserTab()`, unscoped.
            case "ensure_chrome_mcp_enabled":
                if (!channelId) {
                    throw new Error('channelId is required for ensure_chrome_mcp_enabled');
                }
                return this.ensureChromeMcpEnabled(channelId);

            case "disable_chrome_mcp":
                if (!channelId) {
                    throw new Error('channelId is required for disable_chrome_mcp');
                }
                return this.disableChromeMcp(channelId);

            case "create_new_browser_tab":
                return this.createNewBrowserTab();

            // Step 29. All three are channel-scoped (the official `withChannel`).
            case "get_output_style":
                return this.getOutputStyle(channelId);

            case "get_output_style_locations":
                return this.getOutputStyleLocations(channelId);

            case "create_output_style": {
                const styleReq = request as CreateOutputStyleRequest;
                return this.createOutputStyle(channelId, styleReq.draft, styleReq.level, styleReq.replace);
            }

            // Step 30. Window-wide, not channel-scoped: the official's
            // `case"set_focus_view":return this.setFocusView($.request.enabled)`.
            case "set_focus_view":
                return this.setFocusView((request as SetFocusViewRequest).enabled);

            case "get_session_request":
                return handleGetSession(request, this.handlerContext);

        // 文件操作
        case "list_files_request":
            return handleListFiles(request, this.handlerContext);

        case "stat_path_request":
            return handleStatPath(request as any, this.handlerContext);

            // 进程操作

            case "open_claude_in_terminal":
                return handleOpenClaudeInTerminal(request, this.handlerContext);

            // 认证
            // case "get_auth_status":
            //     return handleGetAuthStatus(request, this.handlerContext);

            // case "login":
            //     return handleLogin(request, this.handlerContext);

            // case "submit_oauth_code":
            //     return handleSubmitOAuthCode(request, this.handlerContext);

            default:
                throw new Error(`Unknown request type: ${request.type}`);
        }
    }

    /**
     * 处理响应
     */
    /**
     * Settle every request sent on a channel the disposed webview owned: it
     * can no longer answer (`WebviewGoneError`).
     */
    /**
     * A webview went away. The official shuts that webview's host down
     * (`onDidDispose(()=>{K.shutdown(), …})`), and `shutdown()` runs
     * `closeAllChannels()`: its CLI processes end with it. Forge has one host
     * for every webview, so it closes the channels that webview opened
     * (`channelOwners`). Without this, every closed Forge tab left its CLI
     * running (found by the end-to-end soak, 2026-09-24: 6 tabs opened and
     * closed, 6 CLI processes left).
     */
    private onWebviewDisposed(webviewId: string): void {
        this.settleRequestsOf(webviewId);
        for (const [channelId, owner] of [...this.channelOwners]) {
            if (owner === webviewId) this.closeChannel(channelId, false);
        }
    }

    private settleRequestsOf(webviewId: string): void {
        for (const [requestId, handler] of [...this.outstandingRequests]) {
            if (!handler.channelId || this.channelOwners.get(handler.channelId) !== webviewId) continue;
            this.outstandingRequests.delete(requestId);
            handler.reject(new WebviewGoneError());
        }
    }

    private handleResponse(message: ResponseMessage): void {
        const handler = this.outstandingRequests.get(message.requestId);
        if (handler) {
            const response = message.response;
            if (typeof response === 'object' && response !== null && 'type' in response && response.type === "error") {
                handler.reject(new Error((response as { error: string }).error));
            } else {
                handler.resolve(response);
            }
            this.outstandingRequests.delete(message.requestId);
        } else {
            this.logService.warn(`[ClaudeAgentService] No pending request ${message.requestId}; the answer was dropped`);
        }
    }

    /**
     * 处理取消
     */
    private handleCancellation(requestId: string): void {
        const abortController = this.abortControllers.get(requestId);
        if (abortController) {
            abortController.abort();
            this.abortControllers.delete(requestId);
        }
    }

    /**
     * 向 WebView 发送单向通知。
     *
     * 与 sendRequest() 不同：这些消息（insert_at_mention、ui_command 等）
     * WebView 不会回复，所以这里不注册 outstandingRequests，
     * 否则会留下永远无法 resolve 的 Promise。
     */
    notifyClient(request: ExtensionRequest): void {
        if (!this.transport) {
            this.logService.warn('[ClaudeAgentService] notifyClient: the transport is not ready');
            return;
        }
        this.transport.send({
            type: "request",
            channelId: "",
            requestId: this.generateId(),
            request
        } as RequestMessage);
    }

    /**
     * 发送请求到客户端
     */
    protected sendRequest<TRequest extends ExtensionRequest, TResponse>(
        channelId: string,
        request: TRequest
    ): Promise<TResponse> {
        const requestId = this.generateId();

        return new Promise<TResponse>((resolve, reject) => {
            // 注册 Promise handlers
            this.outstandingRequests.set(requestId, { resolve, reject, channelId });

            // 发送请求
            this.sendToClient({
                type: "request",
                channelId,
                requestId,
                request
            } as RequestMessage);
        }).finally(() => {
            // 清理
            this.outstandingRequests.delete(requestId);
        });
    }

    /**
     * 请求工具权限
     */
    protected async requestToolPermission(
        channelId: string,
        toolName: string,
        inputs: Record<string, unknown>,
        suggestions: PermissionUpdate[],
        extra: Pick<
            ToolPermissionRequest,
            'defaultToNo' | 'suppressAlwaysAllowRule' | 'toolUseId' | 'agentId' | 'riskReason'
        > = {}
    ): Promise<PermissionResult> {
        const request: ToolPermissionRequest = {
            type: "tool_permission_request",
            toolName,
            inputs,
            suggestions,
            ...extra
        };

        let response: ToolPermissionResponse;
        try {
            response = await this.sendRequest<ToolPermissionRequest, ToolPermissionResponse>(
                channelId,
                request
            );
        } catch (error) {
            // The panel closed with the prompt up: nobody can answer it, and a
            // CLI waiting on an answer that never comes hangs its turn. A denial
            // is the answer that changes nothing (production audit, 2026-09-24).
            if (error instanceof WebviewGoneError) {
                this.logService.warn(`[ClaudeAgentService] ${toolName} on channel ${channelId}: denied, the panel closed before answering`);
                return { behavior: 'deny', message: error.message };
            }
            throw error;
        }

        // The official `requestToolPermission`: an allow may only carry the
        // updates the prompt offered (re-targeted or not), and a switch to
        // bypassPermissions only when it is allowed at all.
        const { result, dropped } = filterAnsweredPermissions(
            response.result,
            suggestions,
            this.sdkService.getAllowDangerouslySkipPermissions()
        );
        if (dropped === -1) {
            this.logService.warn(`Dropping malformed permission updates in a tool-permission answer on channel ${channelId}`);
        } else if (dropped > 0) {
            this.logService.warn(
                `Dropping ${dropped} permission update(s) the prompt did not offer (or a bypassPermissions switch while allowDangerouslySkipPermissions is off) on channel ${channelId}`
            );
        }
        return result;
    }

    /**
     * 关闭服务
     */
    async shutdown(): Promise<void> {
        if (this.stateUpdatePush) clearTimeout(this.stateUpdatePush);
        // The official `this.claimConfigResolver()?.reject(Error("Host shutting down"))`.
        claimConfigResolver(this.handlerContext)?.reject(new Error("Host shutting down"));
        for (const disposable of this.disposables.splice(0)) disposable.dispose();
        this.detachPlanPreviews();
        this.watchdog.dispose();
        await this.closeAllChannels();
        this.fromClientStream.done();
    }

    // ========================================================================
    // 工具方法
    // ========================================================================

    /**
     * 生成唯一 ID
     */
    private generateId(): string {
        return Math.random().toString(36).substring(2, 15);
    }

    /**
     * 获取当前工作目录
     */
    private getCwd(): string {
        return this.workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();
    }

    /**
     * The official `getShowThinkingSummariesSetting`: the merged
     * `showThinkingSummaries` setting when it is a boolean, else undefined.
     * Forge's configuration service merges the same settings files the CLI
     * reads (user, project, local, forge.json, managed).
     */
    private async getShowThinkingSummaries(): Promise<boolean | undefined> {
        try {
            const value = await this.configService.getSetting<unknown>('showThinkingSummaries');
            return typeof value === 'boolean' ? value : undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * 设置 thinking level
     */
    /**
     * 应用设置（官方 applySettings + writeUserSettingsAndPush）
     *
     * The official order matters and is kept: validate the whole patch first, so
     * a rejected key writes nothing; then persist to the layer's file; then push
     * the same patch to the running session with `applyFlagSettings`, which is
     * session-scoped (`sdk.d.ts` L2749).
     *
     * That pairing is also the answer to B6. Flag settings outrank user settings,
     * and Forge launches with `--settings ~/.claude/forge.json`. Writing the
     * user's choice to `~/.claude/settings.json` alone would be beaten by that
     * file; pushing it through `applyFlagSettings` makes it win for the live
     * session, and `stripFlagReservedKeys` keeps profile sync from ever pinning
     * it in forge.json, so it still wins on the next launch.
     */
    async applySettings(
        channelId: string | undefined,
        settings: Record<string, unknown>,
        flagsOnly?: boolean,
        scope?: string
    ): Promise<void> {
        // Throws on the first bad key, before anything is written.
        const target = validateSettingsWrite(settings, flagsOnly, scope);

        const channel = channelId ? this.channels.get(channelId) : undefined;

        if (target === 'localSettings') {
            // The CLI owns this file (canonical root, gitignore upkeep): `sdk.d.ts` L2762.
            if (!channel?.query) throw new Error('apply_settings: no running session for a localSettings write');
            await channel.query.updateSettings('localSettings', settings);
            return;
        }

        if (target === 'flags' && !channel?.query) {
            // Session-scoped (ultracode): with no session there is nothing to
            // write it to. The official `withChannel` refuses the same way.
            throw new Error(`Channel not found: ${channelId}`);
        }

        if (target === 'userSettings') {
            await this.writeUserSettings(settings);
        }

        // Live-apply, for both the userSettings and the flags targets. Without a
        // running session there is nothing to push to, and the file write above
        // is what the next launch will read.
        if (channel?.query) {
            await channel.query.applyFlagSettings(settings as Parameters<Query['applyFlagSettings']>[0]);
        }
    }

    /**
     * Merge a patch into `~/.claude/settings.json`, keeping every other key.
     * The official writes with two-space JSON and a trailing newline.
     *
     * Unlike the official, a file that exists but does not parse is refused,
     * not replaced: starting from `{}` there wrote the patch back alone and the
     * user's settings were gone (production audit, 2026-09-24). The write is
     * atomic (`writeJsonAtomic`).
     */
    private async writeUserSettings(settings: Record<string, unknown>): Promise<void> {
        const file = path.join(os.homedir(), '.claude', 'settings.json');
        const current = await readJsonObjectForWrite(file);
        const merged = mergeSettings(current, settings);
        await writeJsonAtomic(file, merged);
        this.logService.info(`[applySettings] wrote ${Object.keys(settings).join(', ')} to ${file}`);
    }

    /**
     * The official `setThinkingLevel`: the `m$$` config for the level, applied to
     * the running session with `setMaxThinkingTokens(budget, display ?? null)` or
     * `setMaxThinkingTokens(0)`, then persisted to globalState -- in that order,
     * and only for a channel that exists (`withChannel`).
     */
    async setThinkingLevel(channelId: string, level: string): Promise<void> {
        const thinkingLevel = parseThinkingLevel(level);
        const channel = this.channels.get(channelId);
        if (!channel) {
            throw new Error(`Channel not found: ${channelId}`);
        }
        const config = thinkingConfigFor(thinkingLevel, await this.getShowThinkingSummaries());
        await applyThinkingConfig(channel.query, config);
        await this.sdkService.setThinkingLevel(thinkingLevel);
        this.logService.info(`[setThinkingLevel] channel ${channelId}: ${thinkingLevel} -> ${JSON.stringify(config)}`);
    }

    /**
     * 设置权限模式
     */
    async setPermissionMode(channelId: string, mode: PermissionMode): Promise<void> {
        const response = await this.setPermissionModeRequest(channelId, mode, false);
        if (!response.success) {
            throw new Error(`set_permission_mode: the session refused ${mode}`);
        }
    }

    /**
     * The official `setPermissionMode(channel, mode, userInitiated)`: an unknown
     * mode, or bypassPermissions while it isn't allowed, is refused in-band
     * (`success: false`); a missing channel throws (`withChannel`); a CLI failure
     * is `success: false`. The official `userInitiated` branch also remembers the
     * mode as the default for new sessions (`persistDefaultPermissionMode`); Forge
     * does not port it, because its "Default Permission Mode" setting is always
     * set and the official never reads the remembered default while the setting
     * is set (see `initialPermissionModeFrom`).
     */
    async setPermissionModeRequest(
        channelId: string | undefined,
        mode: unknown,
        userInitiated?: unknown
    ): Promise<SetPermissionModeResponse> {
        if (!isPermissionMode(mode)) {
            this.logService.warn(`Refusing set_permission_mode on channel ${channelId}: mode is not a recognized mode (${typeof mode})`);
            return { type: "set_permission_mode_response", success: false };
        }
        const channel = this.requireChannel(channelId);
        if (mode === 'bypassPermissions' && !this.sdkService.getAllowDangerouslySkipPermissions()) {
            this.logService.warn(`Refusing set_permission_mode on channel ${channelId}: allowDangerouslySkipPermissions is off`);
            return { type: "set_permission_mode_response", success: false };
        }
        try {
            await channel.query.setPermissionMode(mode);
            this.logService.info(`[setPermissionMode] channel ${channelId}: ${mode}${userInitiated === true ? ' (user)' : ''}`);
            return { type: "set_permission_mode_response", success: true };
        } catch (error) {
            this.logService.error(`Failed to set permission mode: ${error}`);
            return { type: "set_permission_mode_response", success: false };
        }
    }

    // ------------------------------------------------------------------------
    // The plan preview (the official `openMarkdownPreview` and friends)
    // ------------------------------------------------------------------------

    private readonly planCommentsByChannel = new Map<string, PlanComment[]>();
    private readonly planPreviewPanelByChannel = new Map<string, PlanPreviewPanel>();
    /** Set on shutdown: panels stay open but stop taking comments, and no new ones open. */
    private planPreviewsDetached = false;

    /**
     * Show the plan beside the chat. A second call for the same channel
     * reuses its panel: new title and content, comments reset.
     */
    async openMarkdownPreview(
        channelId: unknown,
        content: unknown,
        title: unknown,
        enableComments: unknown,
        webviewId?: string
    ): Promise<OpenMarkdownPreviewResponse> {
        if (typeof channelId !== 'string' || typeof content !== 'string' || (title !== undefined && typeof title !== 'string')) {
            throw new Error('open_markdown_preview: malformed request');
        }
        if (this.planPreviewsDetached) return { type: "open_markdown_preview_response" };
        const existing = this.planPreviewPanelByChannel.get(channelId);
        if (existing) {
            if (title) existing.setTitle(title);
            existing.updateContent(content);
            existing.setCommentsEnabled(!!enableComments);
            this.planCommentsByChannel.set(channelId, []);
            return { type: "open_markdown_preview_response" };
        }
        this.planCommentsByChannel.set(channelId, []);
        const panel = this.webViewService.createPagePanel(
            PLAN_PREVIEW_VIEW_TYPE,
            title || DEFAULT_PLAN_TITLE,
            'plan-preview',
            this.webViewService.planPreviewColumn(webviewId)
        );
        const preview = PlanPreviewPanel.create(panel, content, enableComments === true, (comment) => {
            const comments = this.planCommentsByChannel.get(channelId) ?? [];
            comments.push(comment);
            this.planCommentsByChannel.set(channelId, comments);
            this.sendToClient({ type: "plan_comment", channelId, comment });
        });
        this.planPreviewPanelByChannel.set(channelId, preview);
        preview.onDidDispose(() => {
            this.planPreviewPanelByChannel.delete(channelId);
        });
        return { type: "open_markdown_preview_response" };
    }

    async getPlanComments(channelId: unknown): Promise<GetPlanCommentsResponse> {
        return {
            type: "get_plan_comments_response",
            comments: typeof channelId === 'string' ? this.planCommentsByChannel.get(channelId) ?? [] : []
        };
    }

    async removePlanComment(channelId: unknown, commentId: unknown): Promise<RemovePlanCommentResponse> {
        if (typeof channelId === 'string' && typeof commentId === 'string') {
            const comments = this.planCommentsByChannel.get(channelId) ?? [];
            this.planCommentsByChannel.set(channelId, comments.filter((c) => c.id !== commentId));
            this.planPreviewPanelByChannel.get(channelId)?.removeComment(commentId);
        }
        return { type: "remove_plan_comment_response" };
    }

    async closePlanPreview(channelId: unknown): Promise<ClosePlanPreviewResponse> {
        if (typeof channelId === 'string') {
            const panel = this.planPreviewPanelByChannel.get(channelId);
            if (panel) {
                panel.dispose();
                this.planPreviewPanelByChannel.delete(channelId);
            }
        }
        return { type: "close_plan_preview_response" };
    }

    /** The official `shutdown`: detach every preview and forget the comments. */
    private detachPlanPreviews(): void {
        this.planPreviewsDetached = true;
        for (const panel of this.planPreviewPanelByChannel.values()) panel.detach();
        this.planPreviewPanelByChannel.clear();
        this.planCommentsByChannel.clear();
    }

    /**
     * 设置模型
     *
     * The official `setModel` is `writeUserSettingsAndPush(channel, {model})`, in
     * this order: the channel must exist (`withChannel`), the patch is merged into
     * `~/.claude/settings.json`, then `applyFlagSettings` switches the running
     * session. Default clears the key instead of writing "default".
     *
     * B6: forge.json is the flag layer and outranks user settings, but that does
     * not bite here. `applyFlagSettings` overrides it for the live session, and
     * the next launch passes the model explicitly (`Options.model`), which beats
     * every settings layer. A profile that sets `model` still decides what
     * `modelSetting` reads back on reload -- that is what a profile is for.
     */
    async setModel(channelId: string, model: string): Promise<AppliedSettings | undefined> {
        const channel = this.channels.get(channelId);
        if (!channel) {
            this.logService.warn(`[setModel] Channel ${channelId} not found`);
            throw new Error(`Channel not found: ${channelId}`);
        }

        const patch = modelSettingsPatch(model);
        await this.writeUserSettings(patch);
        await channel.query.applyFlagSettings(patch as Parameters<Query['applyFlagSettings']>[0]);

        this.logService.info(`[setModel] Set channel ${channelId} to model: ${model}`);
        return this.readApplied(channelId, channel.query);
    }

    /**
     * The official `get_applied_settings`: `getSettings().applied` on the
     * channel's own CLI. A CLI that cannot answer gives no `applied`, and the
     * webview keeps what it shows.
     */
    mcpServerStatusFor(channelId: string): () => Promise<McpServerStatus[]> {
        const channel = this.channels.get(channelId);
        if (!channel) {
            throw new Error(`Channel not found: ${channelId}`);
        }
        return () => channel.query.mcpServerStatus();
    }

    async getAppliedSettings(channelId: string): Promise<AppliedSettings | undefined> {
        const channel = this.channels.get(channelId);
        if (!channel) {
            throw new Error(`Channel not found: ${channelId}`);
        }
        return this.readApplied(channelId, channel.query);
    }

    /**
     * The official `case"rewind_code"` (step 24):
     *
     *   let{userMessageId:X,dryRun:J}=$.request;
     *   return this.withChannel($.channelId,async(Y)=>{
     *     let z=await Y.query.rewindFiles(X,{dryRun:J});
     *     if(z.error)throw Error(z.error);
     *     return{type:"rewind_code_response",canRewind:z.canRewind,…})
     *
     * Three things carried over exactly:
     * - `withChannel` → `requireChannel`, so a request for a channel that is not
     *   open throws rather than answering a shaped failure;
     * - `z.error` **throws**. Forge's `handleRequest` turns a thrown handler
     *   error into `{type:"error",error}` and `BaseTransport`'s `case "response"`
     *   rejects the promise with it, which is what the official webview sees;
     * - the five forwarded fields, no more (`error` is thrown, not forwarded).
     *
     * `rewindFiles` needs `enableFileCheckpointing` on the query that launched
     * the session; Forge sets it in `ClaudeSdkService.query()`'s `Options`
     * (the SDK-native option, sdk.d.ts:1605), so it is on for every session.
     */
    async rewindCode(channelId: string | undefined, request: unknown): Promise<RewindCodeResponse> {
        const plan = planRewindCode(request);
        if (!plan) {
            this.logService.warn(
                `Refusing rewind_code on channel ${channelId}: userMessageId is not a message uuid, or dryRun is not a boolean`
            );
            return { type: "rewind_code_response", canRewind: false };
        }
        const channel = this.requireChannel(channelId);
        const result = await channel.query.rewindFiles(plan.userMessageId, { dryRun: plan.dryRun });
        if (result.error) throw new Error(result.error);
        this.logService.info(
            `[rewindCode] channel ${channelId}: ${plan.dryRun ? 'dry run' : 'rewind'} to ${plan.userMessageId} -> canRewind=${result.canRewind}`
        );
        return { type: "rewind_code_response", ...rewindResponseFields(result) };
    }

    // ------------------------------------------------------------------------
    // Step 28: @browser tabs
    // ------------------------------------------------------------------------

    /** The official subclass's lazily-built `chromeMcpClient` (`AF`). */
    private chromeMcpClient?: ChromeMcpClient;

    /** A channel's chrome state, with the official's `{status:"disconnected"}` default. */
    private chromeMcpStateOf(channel: Channel): ChromeMcpState {
        return channel.chromeMcpState ?? { status: 'disconnected' };
    }

    /**
     * The official `ensureChromeMcpEnabled($)`, in its order (extension.js
     * @3055530), plus the subclass's install prompt that wraps it (@3308953):
     *
     *   if(process.platform==="darwin"||"win32"||"linux"){
     *     if(!globalState.get("chromeExtensionNotificationDismissed"))
     *       if(!await Eb$()){ …showInformationMessage("Claude in Chrome: …",
     *         "Install Extension","Don't Show Again") } }
     *   return super.ensureChromeMcpEnabled($)
     *
     *   withChannel: X = state.status==="disconnected"      // wasDisabled
     *     state={status:"connecting"}
     *     Y = {...channel.mcpServers, "claude-in-chrome": getChromeMcpServerConfig()}
     *     z = await query.setMcpServers(Y)
     *     if(z.errors && keys>0) throw Error(joined)
     *     channel.mcpServers = Y; state={status:"connected"}
     *     return {type:"ensure_chrome_mcp_enabled_response", wasDisabled:X}
     *   catch: state={status:"error",error}; rethrow
     *
     * B3: the server key, command and arguments all come from the host
     * (`chromeMcpServerConfig`). The request carries no payload at all, so there
     * is nothing from the webview to validate beyond the channel.
     */
    async ensureChromeMcpEnabled(channelId: string | undefined): Promise<EnsureChromeMcpEnabledResponse> {
        const channel = this.requireChannel(channelId);
        // The official awaits the install prompt here, so a message with an
        // @browser mention waits on a notification that folds into the
        // notification centre after a few seconds -- in the end-to-end run it
        // sat for two minutes with nothing in the chat. Forge offers the same
        // prompt without waiting on it: the attach goes on, and if it fails the
        // chat says why (production audit, Phase 6, item 4).
        void this.promptForChromeExtensionIfMissing();
        const wasDisabled = this.chromeMcpStateOf(channel).status === 'disconnected';
        channel.chromeMcpState = { status: 'connecting' };
        try {
            const config = chromeMcpServerConfig(await this.sdkService.getClaudeBinary());
            const servers: Record<string, McpServerConfig> = {
                ...(channel.mcpServers ?? {}),
                [CHROME_MCP_SERVER_NAME]: config
            };
            const result = await channel.query.setMcpServers(servers);
            if (result.errors && Object.keys(result.errors).length > 0) {
                throw new Error(
                    Object.entries(result.errors)
                        .map(([name, message]) => `${name}: ${message}`)
                        .join(', ')
                );
            }
            channel.mcpServers = servers;
            channel.chromeMcpState = { status: 'connected' };
            this.logService.info(`[chromeMcp] channel ${channelId}: connected (wasDisabled=${wasDisabled})`);
            return { type: "ensure_chrome_mcp_enabled_response", wasDisabled };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            channel.chromeMcpState = { status: 'error', error: message };
            this.logService.error(`[chromeMcp] channel ${channelId}: ${message}`);
            throw error;
        }
    }

    /**
     * The official `disableChromeMcp($)`: drop the one server, and if it really
     * had been connected, enqueue the synthetic user message so the model stops
     * offering browser tools. The official closes its own MCP client first
     * (`if(this.chromeMcpClient)await this.chromeMcpClient.disconnect()`).
     */
    async disableChromeMcp(channelId: string | undefined): Promise<DisableChromeMcpResponse> {
        const channel = this.requireChannel(channelId);
        await this.chromeMcpClient?.disconnect();
        const wasEnabled = this.chromeMcpStateOf(channel).status === 'connected';
        const { [CHROME_MCP_SERVER_NAME]: _removed, ...rest } = channel.mcpServers ?? {};
        await channel.query.setMcpServers(rest);
        channel.mcpServers = rest;
        channel.chromeMcpState = { status: 'disconnected' };
        if (wasEnabled) {
            channel.in.enqueue({
                type: "user",
                session_id: "",
                parent_tool_use_id: null,
                isSynthetic: true,
                message: { role: "user", content: BROWSER_DISCONNECTED_NOTICE }
            } as unknown as SDKUserMessage);
            if (channelId) this.watchdog.turnStarted(channelId);
        }
        this.logService.info(`[chromeMcp] channel ${channelId}: disconnected (wasEnabled=${wasEnabled})`);
        return { type: "disable_chrome_mcp_response", wasEnabled };
    }

    /**
     * The official `createNewBrowserTab()` on the VS Code subclass: its own MCP
     * client, not the session's query, because the webview needs the ids before
     * the turn is sent. Not channel-scoped, exactly as the official's dispatcher
     * has it (`return await this.createNewBrowserTab()`).
     */
    async createNewBrowserTab(): Promise<CreateNewBrowserTabResponse> {
        this.chromeMcpClient ??= new ChromeMcpClient(this.logService, () => this.sdkService.getClaudeBinary());
        const { tabGroupId, tabId } = await this.chromeMcpClient.createNewBrowserTab();
        this.logService.info(`[chromeMcp] new tab ${tabGroupId}/${tabId}`);
        return { type: "create_new_browser_tab_response", tabGroupId, tabId };
    }

    /** The official `browserTabsCache`. */
    private browserTabsCache?: { tabs: BrowserTab[]; timestamp: number };

    private ensureChromeMcpClient(): ChromeMcpClient {
        this.chromeMcpClient ??= new ChromeMcpClient(this.logService, () => this.sdkService.getClaudeBinary());
        return this.chromeMcpClient;
    }

    /** The official `refreshBrowserTabsCache()`: fire and forget. */
    private refreshBrowserTabsCache(): void {
        this.ensureChromeMcpClient()
            .getBrowserTabs()
            .then(
                (tabs) => {
                    this.browserTabsCache = { tabs, timestamp: Date.now() };
                },
                (error) => this.logService.warn(`Failed to refresh browser tabs cache: ${error}`)
            );
    }

    /**
     * The official `getMatchingBrowserTabs($,Q=!1)`: `Q` is "answer from the
     * cache and refresh in the background", which is what the general `@` list
     * uses so a keystroke never waits on Chrome. A `browser:` query fetches live.
     * A failure falls back to whatever the cache has, never throws.
     *
     * Forge adds one guard the official does not need: with no Claude binary
     * there is no `--claude-in-chrome-mcp` server to talk to, so the lookup is
     * skipped rather than spawning something that cannot exist (B4).
     */
    async getMatchingBrowserTabs(query: string | undefined, useCache = false): Promise<BrowserTabEntry[]> {
        if (!this.sdkService.isBrowserIntegrationSupported()) return [];
        try {
            if (useCache) {
                const cached = this.browserTabsCache?.tabs ?? [];
                this.refreshBrowserTabsCache();
                return browserTabEntries(cached, query);
            }
            const tabs = await this.ensureChromeMcpClient().getBrowserTabs();
            this.browserTabsCache = { tabs, timestamp: Date.now() };
            return browserTabEntries(tabs, query);
        } catch (error) {
            this.logService.warn(`Failed to get browser tabs: ${error}`);
            return browserTabEntries(this.browserTabsCache?.tabs ?? [], query);
        }
    }

    /**
     * The official subclass's pre-flight: on a desktop platform, and unless the
     * user said "Don't Show Again", check whether the Claude in Chrome extension
     * is installed and offer the install page if it is not. A failure here is
     * only warned about -- the official never lets it stop the connection.
     */
    private async promptForChromeExtensionIfMissing(): Promise<void> {
        if (process.platform !== 'darwin' && process.platform !== 'win32' && process.platform !== 'linux') return;
        if (this.sdkService.isChromeExtensionPromptDismissed()) return;
        try {
            const roots = browserProfileRoots(process.platform, os.homedir());
            const { isInstalled } = await findChromeExtension(roots, {
                listDirectories: async (dir) =>
                    (await fsPromises.readdir(dir, { withFileTypes: true }))
                        .filter((entry) => entry.isDirectory())
                        .map((entry) => entry.name),
                exists: async (dir) => {
                    try {
                        await fsPromises.readdir(dir);
                        return true;
                    } catch {
                        return false;
                    }
                }
            });
            if (isInstalled) return;
            this.logService.info('Chrome extension not detected, showing installation prompt');
            const choice = await this.notificationService.showInformation(
                'Claude in Chrome: Install the browser extension to control Chrome from Claude Code',
                'Install Extension',
                "Don't Show Again"
            );
            if (choice === 'Install Extension') {
                await handleOpenURL({ type: "open_url", url: CHROME_EXTENSION_INSTALL_URL }, this.handlerContext);
            } else if (choice === "Don't Show Again") {
                await this.sdkService.dismissChromeExtensionPrompt();
            }
        } catch (error) {
            this.logService.warn(`Failed to check Chrome extension installation: ${error}`);
        }
    }

    // ------------------------------------------------------------------------
    // Step 29: output styles
    // ------------------------------------------------------------------------

    /**
     * The official `case"get_output_style"` (extension.js @3069195):
     *
     *   withChannel: let[Y,z]=await Promise.all([query.getSettings(),query.initializationResult()]),
     *     W=Y.effective.outputStyle;
     *   return{type:"get_output_style_response",...typeof W==="string"&&{outputStyle:W},
     *     availableStyles:channel.outputStyles??z.available_output_styles}
     *
     * Two details carried over exactly: `outputStyle` is **omitted** unless the
     * CLI reports a string, and `availableStyles` prefers the list a
     * `create_output_style` reload produced over the session's initial one.
     */
    async getOutputStyle(channelId: string | undefined): Promise<GetOutputStyleResponse> {
        const channel = this.requireChannel(channelId);
        const [settings, initResult] = await Promise.all([
            readClaudeSettings(channel.query),
            channel.query.initializationResult()
        ]);
        const outputStyle = effectiveOutputStyle(settings);
        const availableStyles = channel.outputStyles ?? availableOutputStyles(initResult);
        return {
            type: "get_output_style_response",
            ...(outputStyle !== undefined && { outputStyle }),
            ...(availableStyles !== undefined && { availableStyles })
        };
    }

    /**
     * The official `case"get_output_style_locations"`: the project path is
     * **relative** (`A1.join(".claude","output-styles")`) and the user path is
     * tildified. Both are shown to the user in the wizard's "Save to" step.
     */
    async getOutputStyleLocations(channelId: string | undefined): Promise<GetOutputStyleLocationsResponse> {
        const channel = this.requireChannel(channelId);
        return {
            type: "get_output_style_locations_response",
            project: PROJECT_OUTPUT_STYLES_DIR,
            user: tildify(await this.userOutputStylesDir(channel))
        };
    }

    /**
     * The official `userOutputStylesDir($)`: trust the CLI's
     * `user_output_styles_dir` only when it is absolute, already normalised and
     * named `output-styles`; otherwise this host's own folder. The official also
     * races the initialize response against a 10s timeout and warns on the way
     * out; Forge does the same with a plain `catch`, because a folder is about
     * to be written into and a guess is not acceptable.
     */
    private async userOutputStylesDir(channel: Channel): Promise<string> {
        const initResult = await channel.query.initializationResult().catch((error) => {
            this.logService.warn(
                `Using this host's output styles folder: the CLI's initialize response is unavailable: ${error}`
            );
            return undefined;
        });
        return userOutputStylesDirFrom(initResult);
    }

    /**
     * The official `createOutputStyle($,Q,X,J)` (extension.js @3092442), in its
     * order. Every check below is the official's, and they all run **before**
     * anything is written:
     *
     *   if(If$(draft.name,void 0)!==null)throw Error("Invalid output style name");
     *   if(Ef$(draft.description)!==null)throw Error("Invalid output style description");
     *   if(level!=="project"&&level!=="user")throw Error("Invalid output style level");
     *
     * Then the folder work: probe `.claude` and the styles dir for symlinks,
     * `mkdir -p`, and for a project-level write also prove the real styles path
     * sits inside the real cwd and that the folder identity did not change.
     * `replace` decides the writer: `Bf$` (temp + rename, overwrites) or `mv`
     * (`O_EXCL`, so an existing file answers `{kind:"exists"}` rather than being
     * overwritten). Finally `reloadOutputStyles()` so the new style is usable in
     * this session, and its list is remembered on the channel.
     *
     * B3: the *only* thing the webview controls here is the style's name, which
     * becomes `<name>.md` inside one of two host-chosen directories. It may hold
     * no separator, no `..` (a name starting with `.` is refused outright), no
     * control character and no Windows device name.
     */
    async createOutputStyle(
        channelId: string | undefined,
        draft: unknown,
        level: unknown,
        replace: unknown
    ): Promise<CreateOutputStyleResponse> {
        const channel = this.requireChannel(channelId);
        if (
            typeof draft !== 'object' ||
            draft === null ||
            typeof (draft as OutputStyleDraft).name !== 'string' ||
            typeof (draft as OutputStyleDraft).description !== 'string' ||
            typeof (draft as OutputStyleDraft).instructions !== 'string'
        ) {
            throw new Error('Invalid output style name');
        }
        const style = draft as OutputStyleDraft;
        if (outputStyleNameProblem(style.name, undefined) !== null) throw new Error('Invalid output style name');
        if (outputStyleDescriptionProblem(style.description) !== null) {
            throw new Error('Invalid output style description');
        }
        if (!isOutputStyleLevel(level)) throw new Error('Invalid output style level');

        const cwd = channel.cwd ?? this.getCwd();
        const dir =
            level === 'user' ? await this.userOutputStylesDir(channel) : path.join(cwd, PROJECT_OUTPUT_STYLES_DIR);
        const fileName = outputStyleFileName(style.name);
        const filePath = path.join(dir, fileName);
        const content = outputStyleFileContent(style);

        const before = level === 'project' ? await probeOutputStyleFolder(cwd, dir) : undefined;
        await fsPromises.mkdir(dir, { recursive: true });
        let guard: DirIdentity | undefined;
        if (level === 'project') guard = await assertProjectFolderSafe(cwd, dir, before);

        try {
            if (replace === true) {
                await replaceViaTemp(dir, fileName, `.${randomUUID()}.tmp`, content, guard);
            } else {
                await createExclusive(dir, fileName, content, guard);
            }
        } catch (error) {
            if (replace !== true && (error as { code?: string } | null)?.code === 'EEXIST') {
                return { type: "create_output_style_response", result: { kind: "exists" } };
            }
            if (error instanceof OutputStyleFolderChangedError) throw new Error(OUTPUT_STYLE_FOLDER_CHANGED);
            throw error;
        }

        let availableStyles: string[] | undefined;
        try {
            const reloaded = await channel.query.reloadOutputStyles();
            availableStyles = availableOutputStyles(reloaded);
            if (availableStyles !== undefined) channel.outputStyles = availableStyles;
            else {
                this.logService.warn(`Output style saved at ${filePath} but the CLI did not reload its style list`);
            }
        } catch (error) {
            this.logService.warn(
                `Output style saved at ${filePath} but the CLI could not reload its style list: ${error}`
            );
        }
        this.logService.info(`[outputStyles] saved ${filePath} (${level})`);
        return {
            type: "create_output_style_response",
            result: { kind: "saved", filePath, ...(availableStyles !== undefined && { availableStyles }) }
        };
    }

    // ------------------------------------------------------------------------
    // Step 30: focus view
    // ------------------------------------------------------------------------

    /**
     * The official `lastAppliedFocusView`: the value already pushed to the
     * running channels, so a repeated toggle is not re-sent.
     */
    private lastAppliedFocusView: boolean | undefined;

    /**
     * The official `setFocusView($)` (extension.js @3115148):
     *
     *   return await this.settings.setFocusView($),this.syncFocusViewToChannels($),
     *     this.pushStateUpdate(),{type:"set_focus_view_response"}
     *
     * Three things, in that order: persist, push the `viewMode` flag to every
     * running session, and tell the webview the config changed. The official
     * persists to the VS Code setting `claudeCode.focusView`; Forge's own
     * preferences live in its extension config file, so that is where this goes.
     *
     * B3: the webview sends one boolean and nothing else is read off the
     * request, so a non-boolean is refused before anything is written.
     */
    async setFocusView(enabled: unknown): Promise<SetFocusViewResponse> {
        if (typeof enabled !== 'boolean') throw new Error('set_focus_view: enabled must be a boolean');
        await this.configService.updateExtensionConfig('focusView', enabled);
        this.syncFocusViewToChannels(enabled);
        // The official `pushStateUpdate()`. Forge's equivalent broadcast is the
        // `extension_config_changed` push the webview already handles.
        this.webViewService.postMessage({
            type: 'request',
            channelId: '',
            requestId: `focus-view-${Date.now()}`,
            request: { type: 'extension_config_changed', key: 'focusView', value: enabled },
        });
        this.logService.info(`[focusView] ${enabled ? 'on' : 'off'}`);
        return { type: "set_focus_view_response" };
    }

    /**
     * The official `syncFocusViewToChannels($)`, verbatim:
     *
     *   if(this.lastAppliedFocusView===$)return;this.lastAppliedFocusView=$;
     *   for(let[Q,X]of this.channels)X.query.applyFlagSettings({viewMode:$?"focus":null})
     *     .catch((J)=>this.logger.error(`Failed to push focus view to channel ${Q}: ${J}`))
     *
     * `viewMode` is a real CLI setting (`'default' | 'verbose' | 'focus'`,
     * sdk.d.ts L8167), so the transcript the CLI itself reports follows the
     * toggle too -- this is not only a webview filter.
     */
    private syncFocusViewToChannels(enabled: boolean): void {
        if (this.lastAppliedFocusView === enabled) return;
        this.lastAppliedFocusView = enabled;
        for (const [channelId, channel] of this.channels) {
            channel.query
                ?.applyFlagSettings({ viewMode: enabled ? 'focus' : null } as Parameters<
                    Query['applyFlagSettings']
                >[0])
                .catch((error: unknown) =>
                    this.logService.error(`Failed to push focus view to channel ${channelId}: ${error}`)
                );
        }
    }

    /** The official `withChannel` for a channel that is already open. */
    private requireChannel(channelId: string | undefined): Channel {
        const channel = channelId ? this.channels.get(channelId) : undefined;
        if (!channel) {
            throw new Error(`Channel not found: ${channelId}`);
        }
        return channel;
    }

    /** The official `permissionRulesConfigManager.edit`: `claude edit-permission-rules --json` in the session's cwd. */
    protected async editPermissionRules(
        edit: Parameters<typeof runPermissionRuleEdit>[1],
        cwd: string
    ): Promise<{ warnings: string[]; stored: string[] }> {
        const binary = await this.sdkService.getClaudeBinary();
        try {
            return await runPermissionRuleEdit(binary, edit, cwd);
        } catch (error) {
            this.logService.error(`claude edit-permission-rules failed: ${error}`);
            throw error;
        }
    }

    /** How long the re-read waits between reads; a spec can make it instant. */
    protected permissionRulesSleep: (ms: number) => Promise<void> = (ms) =>
        new Promise((resolve) => setTimeout(resolve, ms));

    private rereadPermissionRules(
        channel: Channel,
        before: Parameters<typeof listPermissionRulesUntil>[1],
        done: Parameters<typeof listPermissionRulesUntil>[2]
    ) {
        return listPermissionRulesUntil(channel.query, before, done, this.permissionRulesSleep, (error) =>
            this.logService.error(`Failed to re-read permission rules after the write: ${error}`)
        );
    }

    /**
     * The official `listPermissionRules`: the session's live rules, or the
     * reason they could not be read -- in-band, never thrown.
     */
    async listPermissionRules(channelId: string | undefined): Promise<ListPermissionRulesResponse> {
        try {
            const channel = this.requireChannel(channelId);
            return { type: "list_permission_rules_response", state: await readPermissionRules(channel.query) };
        } catch (error) {
            this.logService.error(`Failed to list permission rules: ${error}`);
            return {
                type: "list_permission_rules_response",
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * The official `addPermissionRules`, in its order: check the shape (a bad
     * one is refused in-band, before anything runs); read the rules as they are;
     * have the CLI write the rules to the destination's settings file; re-read
     * until the session lists them. `pending` means written but not yet re-read;
     * `warnings` are the CLI's own notes on what it stored.
     */
    async addPermissionRules(
        channelId: string | undefined,
        rules: unknown,
        behavior: unknown,
        destination: unknown
    ): Promise<AddPermissionRulesResponse> {
        if (!isValidAddRequest(rules, behavior, destination)) {
            this.logService.warn(`Refusing add_permission_rules on channel ${channelId}: invalid request shape`);
            return { type: "add_permission_rules_response", error: "invalid request" };
        }
        const ruleList = rules as string[];
        const ruleBehavior = behavior as AddPermissionRulesRequest['behavior'];
        const target = destination as EditableRuleDestination;
        try {
            const channel = this.requireChannel(channelId);
            const before = await readPermissionRules(channel.query);
            const { warnings, stored } = await this.editPermissionRules(
                { op: 'add', rules: ruleList, behavior: ruleBehavior, destination: target },
                channel.cwd ?? this.getCwd()
            );
            const { state, changed } = await this.rereadPermissionRules(
                channel,
                before,
                addShowsUp(ruleBehavior, target, stored, before)
            );
            this.logService.info(`[permissionRules] add ${ruleBehavior} ${JSON.stringify(stored)} -> ${target}${changed ? '' : ' (pending)'}`);
            return {
                type: "add_permission_rules_response",
                state,
                ...(!changed && { pending: true as const }),
                ...(warnings.length > 0 && { warnings })
            };
        } catch (error) {
            this.logService.error(`Failed to add permission rules: ${error}`);
            return {
                type: "add_permission_rules_response",
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * The official `removePermissionRule`: the same order as add, removing one
     * rule (verbatim, as the listing reports it) from its settings file.
     */
    async removePermissionRule(
        channelId: string | undefined,
        rule: unknown,
        behavior: unknown,
        source: unknown
    ): Promise<RemovePermissionRuleResponse> {
        if (!isValidRemoveRequest(rule, behavior, source)) {
            this.logService.warn(`Refusing remove_permission_rule on channel ${channelId}: invalid request shape`);
            return { type: "remove_permission_rule_response", error: "invalid request" };
        }
        const ruleText = rule as string;
        const ruleBehavior = behavior as RemovePermissionRuleRequest['behavior'];
        const from = source as EditableRuleDestination;
        try {
            const channel = this.requireChannel(channelId);
            const before = await readPermissionRules(channel.query);
            await this.editPermissionRules(
                { op: 'remove', rule: ruleText, behavior: ruleBehavior, source: from },
                channel.cwd ?? this.getCwd()
            );
            const { state, changed } = await this.rereadPermissionRules(
                channel,
                before,
                removeShowsUp(ruleText, ruleBehavior, from)
            );
            this.logService.info(`[permissionRules] remove ${ruleBehavior} ${JSON.stringify(ruleText)} from ${from}${changed ? '' : ' (pending)'}`);
            return {
                type: "remove_permission_rule_response",
                state,
                ...(!changed && { pending: true as const })
            };
        } catch (error) {
            this.logService.error(`Failed to remove permission rule: ${error}`);
            return {
                type: "remove_permission_rule_response",
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    // ------------------------------------------------------------------------
    // Session permission modes (step 18, the official `persistSessionPermissionMode`)
    // ------------------------------------------------------------------------

    private cachedClaudeSettings?: ClaudeSettingsSnapshot;

    /**
     * The official `sendSessionStates($,Q,X,J,Y)`:
     *
     *   sendSessionStates($,Q,X,J,Y){ this.send({type:"request",channelId:"",
     *     requestId:l8(), request:{type:"session_states_update", sessions:$,
     *     activeSessionId:Q, openSessionIds:X, unreadSessionKeys:J,
     *     liveElsewhereSessions:Y}}) }
     *
     * Forge fills `openSessionIds` from the channels it is running (the
     * single-window equivalent of the official's `sessionPanels`) and
     * `unreadSessionKeys` from the host store. `sessions` and
     * `liveElsewhereSessions` are multi-surface features Forge has no second
     * surface for. Step 22.
     */
    sendSessionStates(): void {
        this.notifyClient({
            type: "session_states_update",
            sessions: [],
            openSessionIds: this.getOpenSessionIds(),
            unreadSessionKeys: this.unreadSessionKeys()
        });
    }

    /**
     * Push the endpoint health verdicts, on the `session_states_update` model.
     *
     * The settings table and the welcome page both render from this, so a sweep
     * started in one of them fills in the other without either polling. Coalesced
     * because `onDidChangeHealth` fires once per probe result, and sixty pushes
     * in a minute would be sixty re-renders to say "one more model answered".
     */
    sendEndpointHealth(): void {
        if (this.endpointHealthPush) return;
        this.endpointHealthPush = setTimeout(() => {
            this.endpointHealthPush = undefined;
            try {
                this.notifyClient({
                    type: "endpoint_health_update",
                    health: this.endpointHealthService.getAllHealth()
                });
            } catch (e) {
                this.logService.warn(`[health] could not push the verdicts: ${e instanceof Error ? e.message : String(e)}`);
            }
        }, ENDPOINT_HEALTH_PUSH_MS);
    }

    private endpointHealthPush?: ReturnType<typeof setTimeout>;

    /** The distinct sessions the host is running a channel for. */
    getOpenSessionIds(): string[] {
        const ids = new Set<string>();
        for (const channel of this.channels.values()) {
            if (channel.sessionId) ids.add(channel.sessionId);
        }
        return [...ids];
    }

    private unreadSessionKeys(): string[] {
        try {
            return this.handlerContext.sdkService.getUnreadSessionStore().getUnreadSessionKeys();
        } catch (error) {
            this.logService.warn(`[ClaudeAgentService] unread keys unavailable: ${error}`);
            return [];
        }
    }

    /**
     * Follow the id the CLI names in `system/init`, as the official's
     * `confirmCliSessionId` does on the webview side, and re-broadcast when it
     * changes so a resumed session is reported under its real id.
     */
    private noteChannelSessionId(channelId: string, message: unknown): void {
        const event = message as { type?: string; subtype?: string; session_id?: unknown };
        if (event?.type !== 'system' || event.subtype !== 'init') return;
        if (typeof event.session_id !== 'string' || !event.session_id) return;
        const channel = this.channels.get(channelId);
        if (!channel || channel.sessionId === event.session_id) return;
        const fresh = channel.sessionId === undefined;
        channel.sessionId = event.session_id;
        this.sendSessionStates();
        if (fresh) this.assignPendingGroup(event.session_id);
        // A first conversation is what creates the project's transcript
        // directory, so this is the moment a fresh install can start watching it.
        this.sessionStoreWatcher?.refresh();
    }

    /** The group "Start new session in this group" is waiting to fill. */
    private pendingGroupId: string | undefined;

    setPendingGroup(groupId: string | undefined): void {
        this.pendingGroupId = groupId;
    }

    /**
     * The official `assignPendingGroup($,Q)` and `persistGroupsFromHost($)`:
     *
     *   let J=this.settings.getSessionGroups(), Y=Cx(J,X,[Q]); if(Y===J) return;
     *   let Q=VG($), X=new Set(this.settings.getArchivedSessionIds());
     *   this.settings.setSessionGroups(tY(Q,X)??Q).then(()=>{ for(let J of this.allComms)
     *     J.sendSessionGroupsChanged() })
     *
     * The official keys the pending group by the editor tab it opened; Forge's
     * new conversation opens in the one chat, so the first fresh session (not a
     * resume) to be named after the request is the one that joins.
     */
    private assignPendingGroup(sessionId: string): void {
        const groupId = this.pendingGroupId;
        if (!groupId) return;
        this.pendingGroupId = undefined;
        const store = this.handlerContext.sdkService.getSessionGroupStore();
        const groups = store.getSessionGroups();
        const next = moveToGroup(groups, groupId, [sessionId]);
        if (next === groups) return;
        const archived = this.handlerContext.sdkService.getArchivedSessionStore().getArchivedSessionIdSet();
        store.setSessionGroups(withoutSessions(next, archived) ?? next).then(
            () => this.notifyClient({ type: 'session_groups_changed' }),
            (error: unknown) => this.logService.error(`Failed to persist session groups: ${error}`)
        );
    }

    noteClaudeSettings(snapshot: ClaudeSettingsSnapshot | undefined): void {
        if (snapshot) this.cachedClaudeSettings = snapshot;
    }

    getCachedClaudeSettings(): ClaudeSettingsSnapshot | undefined {
        return this.cachedClaudeSettings;
    }

    /** The official `bypassPersistGateOpen()`. */
    private bypassPersistGateOpen(): boolean {
        return bypassPersistGateOpen(this.sdkService.getAllowDangerouslySkipPermissions(), this.cachedClaudeSettings);
    }

    /**
     * Keep (or clear) a conversation's mode so it reopens in it. Ids that are not
     * session ids, and anything that is not a mode, change nothing; the answer
     * is the same bare response either way, as the official's.
     */
    async persistSessionPermissionMode(
        request: PersistSessionPermissionModeRequest
    ): Promise<PersistSessionPermissionModeResponse> {
        const outcome = await persistSessionPermissionMode(
            this.sdkService.getSessionPermissionModeStore(),
            request,
            () => this.bypassPersistGateOpen()
        );
        this.logService.info(
            `[persistSessionPermissionMode] ${outcome}: ${JSON.stringify({
                sessionId: request.sessionId,
                mode: request.mode,
                previousSessionId: request.previousSessionId,
                carriedFromStore: request.carriedFromStore,
            })}`
        );
        return { type: "persist_session_permission_mode_response" };
    }

    private async readApplied(channelId: string, query: Query): Promise<AppliedSettings | undefined> {
        try {
            const settings = await readClaudeSettings(query);
            this.noteClaudeSettings(toClaudeSettingsSnapshot(settings));
            const applied = toAppliedSettings((settings as { applied?: unknown } | undefined)?.applied);
            this.logService.info(`[appliedSettings] channel ${channelId}: ${JSON.stringify(applied ?? null)}`);
            return applied;
        } catch (error) {
            this.logService.warn(`[appliedSettings] Failed to read applied Claude settings: ${error}`);
            return undefined;
        }
    }
}
