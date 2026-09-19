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

import { createDecorator } from '../../di/instantiation';
import { ILogService } from '../logService';
import { IConfigurationService } from '../configurationService';
import { IWorkspaceService } from '../workspaceService';
import { IFileSystemService } from '../fileSystemService';
import { INotificationService } from '../notificationService';
import { ITerminalService } from '../terminalService';
import { ITabsAndEditorsService } from '../tabsAndEditorsService';
import { IClaudeSdkService, type SdkQueryParams } from './ClaudeSdkService';
import { IClaudeSessionService } from './ClaudeSessionService';
import { AsyncStream, ITransport } from './transport';
import { HandlerContext } from './handlers/types';
import { IWebViewService } from '../webViewService';
import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fsPromises } from 'node:fs';
import { mergeSettings, validateSettingsWrite } from './settingsWhitelist';
import { modelSettingsPatch, parseSetModelRequest } from './setModel';
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
import {
    DEFAULT_PLAN_TITLE,
    PLAN_PREVIEW_VIEW_TYPE,
    PlanPreviewPanel,
    type PlanComment,
} from './planPreview';

// 消息类型导入
import type {
    WebViewToExtensionMessage,
    ExtensionToWebViewMessage,
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
} from '../../shared/messages';

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
} from '@anthropic-ai/claude-agent-sdk';

// Handlers 导入
import {
    handleInit,
    handleGetClaudeState,
    handleGetMcpServers,
    handleGetAssetUris,
    handleOpenFile,
    handleGetCurrentSelection,
    handleShowNotification,
    handleNewConversationTab,
    handleRenameTab,
    handleOpenDiff,
    handleListSessions,
    handleRenameSession,
    handleGetSession,
    handleExec,
    handleListFiles,
    handleStatPath,
    handleOpenContent,
    handleOpenURL,
    handleOpenConfigFile,
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
    /** The session's working directory (the official channel's `cwd`): where rule edits run. */
    cwd?: string;
}

/**
 * 请求处理器
 */
interface RequestHandler {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
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

    /**
     * 设置 Thinking Level
     */
    setThinkingLevel(channelId: string, level: string): Promise<void>;

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
     * The official `cachedClaudeSettings`: the CLI's last `get_settings` read (the
     * config probe, or a settings write), kept so the host can tell whether a
     * settings layer disables bypass (step 18).
     */
    noteClaudeSettings(snapshot: ClaudeSettingsSnapshot | undefined): void;
    getCachedClaudeSettings(): ClaudeSettingsSnapshot | undefined;

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
        @IWebViewService private readonly webViewService: IWebViewService
    ) {
        // 构建 Handler 上下文
        this.handlerContext = {
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

        this.logService.info('[ClaudeAgentService] Transport 已连接');
    }

    /**
     * 启动消息循环
     */
    start(): void {
        // 启动消息循环
        this.readFromClient();

        this.logService.info('[ClaudeAgentService] 消息循环已启动');
    }

    /**
     * 接收来自客户端的消息
     */
    async fromClient(message: WebViewToExtensionMessage): Promise<void> {
        this.fromClientStream.enqueue(message);
    }

    /**
     * 从客户端读取并分发消息
     */
    private async readFromClient(): Promise<void> {
        try {
            for await (const message of this.fromClientStream) {
                switch (message.type) {
                    case "launch_claude":
                        await this.launchClaude(
                            message.channelId,
                            message.resume || null,
                            message.cwd || this.getCwd(),
                            message.model || null,
                            message.permissionMode || "default",
                            message.thinkingLevel || null
                        );
                        break;

                    case "close_channel":
                        this.closeChannel(message.channelId, false);
                        break;

                    case "interrupt_claude":
                        await this.interruptClaude(message.channelId);
                        break;

                    case "io_message":
                        this.transportMessage(
                            message.channelId,
                            message.message,
                            message.done
                        );
                        break;

                    case "request":
                        this.handleRequest(message);
                        break;

                    case "response":
                        this.handleResponse(message);
                        break;

                    case "cancel_request":
                        this.handleCancellation(message.targetRequestId);
                        break;

                    default:
                        this.logService.error(`Unknown message type: ${(message as { type: string }).type}`);
                }
            }
        } catch (error) {
            this.logService.error(`[ClaudeAgentService] Error in readFromClient: ${error}`);
        }
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
        const level = thinkingLevel || this.sdkService.getThinkingLevel();
        const thinking = thinkingConfigFor(level, await this.getShowThinkingSummaries());

        this.logService.info('');
        this.logService.info('╔════════════════════════════════════════╗');
        this.logService.info('║  启动 Claude 会话                       ║');
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
            this.logService.error(`❌ Channel 已存在: ${channelId}`);
            throw new Error(`Channel already exists: ${channelId}`);
        }

        try {
            // 1. 创建输入流
            this.logService.info('📝 步骤 1: 创建输入流');
            const inputStream = new AsyncStream<SDKUserMessage>();
            this.logService.info('  ✓ 输入流创建完成');

            // 2. 调用 spawnClaude
            this.logService.info('');
            this.logService.info('📝 步骤 2: 调用 spawnClaude()');

            // stderr 致命错误去重（同一 channel 3s 内不重复推送）
            let lastStderrErrorTime = 0;
            const STDERR_ERROR_DEBOUNCE_MS = 3000;

            const query = await this.spawnClaude(
                inputStream,
                resume,
                async (toolName, input, options) => {
                    // 工具权限回调：通过 RPC 请求 WebView 确认
                    this.logService.info(`🔧 工具权限请求: ${toolName}`);
                    // The official `canUseTool`: these four options go to the prompt.
                    return this.requestToolPermission(
                        channelId,
                        toolName,
                        input,
                        options.suggestions || [],
                        {
                            defaultToNo: options.defaultToNo,
                            suppressAlwaysAllowRule: options.suppressAlwaysAllowRule,
                            toolUseId: options.toolUseID,
                            agentId: options.agentID,
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

                    this.logService.warn(`[ClaudeAgentService] 转发 LLM 请求错误到前端: ${error.type} - ${error.message}`);
                    this.transport?.send({
                        type: "sdk_error",
                        channelId,
                        error: error.message,
                        statusCode: error.statusCode,
                        errorType: error.type,
                    });
                }
            );
            this.logService.info('  ✓ spawnClaude() 完成，Query 对象已创建');

            // 3. 存储到 channels Map
            this.logService.info('');
            this.logService.info('📝 步骤 3: 注册 Channel');
            this.channels.set(channelId, {
                in: inputStream,
                query: query,
                cwd
            });
            this.logService.info(`  ✓ Channel 已注册，当前 ${this.channels.size} 个活跃会话`);

            // 4. 启动监听任务：将 SDK 输出转发给客户端
            this.logService.info('');
            this.logService.info('📝 步骤 4: 启动消息转发循环');
            (async () => {
                try {
                    this.logService.info(`  → 开始监听 Query 输出...`);
                    let messageCount = 0;

                    for await (const message of query) {
                        messageCount++;
                        this.logService.info(`  ← 收到消息 #${messageCount}: ${message.type}`);

                        this.transport!.send({
                            type: "io_message",
                            channelId,
                            message,
                            done: false
                        });
                    }

                    // 正常结束
                    this.logService.info(`  ✓ Query 输出完成，共 ${messageCount} 条消息`);
                    this.closeChannel(channelId, true);
                } catch (error) {
                    // 出错
                    this.logService.error(`  ❌ Query 输出错误: ${error}`);
                    if (error instanceof Error) {
                        this.logService.error(`     Stack: ${error.stack}`);
                    }
                    this.closeChannel(channelId, true, String(error));
                }
            })();

            this.logService.info('');
            this.logService.info('✓ Claude 会话启动成功');
            this.logService.info('════════════════════════════════════════');
            this.logService.info('');
        } catch (error) {
            this.logService.error('');
            this.logService.error('❌❌❌ Claude 会话启动失败 ❌❌❌');
            this.logService.error(`Channel: ${channelId}`);
            this.logService.error(`Error: ${error}`);
            if (error instanceof Error) {
                this.logService.error(`Stack: ${error.stack}`);
            }
            this.logService.error('════════════════════════════════════════');
            this.logService.error('');

            this.closeChannel(channelId, true, String(error));
            throw error;
        }
    }

    /**
     * 中断 Claude 会话
     */
    async interruptClaude(channelId: string): Promise<void> {
        const channel = this.channels.get(channelId);
        if (!channel) {
            this.logService.warn(`[ClaudeAgentService] Channel 不存在: ${channelId}`);
            return;
        }

        try {
            await this.sdkService.interrupt(channel.query);
            this.logService.info(`[ClaudeAgentService] 已中断 Channel: ${channelId}`);
        } catch (error) {
            this.logService.error(`[ClaudeAgentService] 中断失败:`, error);
        }
    }

    /**
     * 关闭会话
     */
    closeChannel(channelId: string, sendNotification: boolean, error?: string): void {
        this.logService.info(`[ClaudeAgentService] 关闭 Channel: ${channelId}`);

        // 1. 发送关闭通知
        if (sendNotification && this.transport) {
            this.transport.send({
                type: "close_channel",
                channelId,
                error
            });
        }

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
        }

        this.logService.info(`  ✓ Channel 已关闭，剩余 ${this.channels.size} 个活跃会话`);
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
            channel.in.enqueue(message as SDKUserMessage);
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
            this.transport!.send({
                type: "response",
                requestId: message.requestId,
                response,
                webviewId: message.webviewId
            });
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.transport!.send({
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

        this.logService.info(`[ClaudeAgentService] 处理请求: ${request.type}`);

        // 路由表：将请求类型映射到 handler
        switch (request.type) {
            // 初始化和状态
            case "init":
                return handleInit(request, this.handlerContext);

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
                return handleRenameTab(request, this.handlerContext);

            case "open_url":
                return handleOpenURL(request, this.handlerContext);

            // 设置
            case "set_permission_mode": {
                const permReq = request as SetPermissionModeRequest;
                return this.setPermissionModeRequest(channelId, permReq.mode, permReq.userInitiated);
            }

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
                if (!channelId) {
                    throw new Error('channelId is required for set_model');
                }
                const applied = await this.setModel(channelId, targetModel);
                return {
                    type: "set_model_response",
                    ...(applied !== undefined && { applied })
                };
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

            case "get_session_request":
                return handleGetSession(request, this.handlerContext);

        // 文件操作
        case "list_files_request":
            return handleListFiles(request, this.handlerContext);

        case "stat_path_request":
            return handleStatPath(request as any, this.handlerContext);

            // 进程操作
            case "exec":
                return handleExec(request, this.handlerContext);

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
            this.logService.warn(`[ClaudeAgentService] 没有找到请求处理器: ${message.requestId}`);
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
            this.logService.warn('[ClaudeAgentService] notifyClient: transport 尚未就绪');
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
            this.outstandingRequests.set(requestId, { resolve, reject });

            // 发送请求
            this.transport!.send({
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
        extra: Pick<ToolPermissionRequest, 'defaultToNo' | 'suppressAlwaysAllowRule' | 'toolUseId' | 'agentId'> = {}
    ): Promise<PermissionResult> {
        const request: ToolPermissionRequest = {
            type: "tool_permission_request",
            toolName,
            inputs,
            suggestions,
            ...extra
        };

        const response = await this.sendRequest<ToolPermissionRequest, ToolPermissionResponse>(
            channelId,
            request
        );

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
        this.detachPlanPreviews();
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
     */
    private async writeUserSettings(settings: Record<string, unknown>): Promise<void> {
        const file = path.join(os.homedir(), '.claude', 'settings.json');
        let current: Record<string, unknown> = {};
        try {
            current = JSON.parse(await fsPromises.readFile(file, 'utf8')) as Record<string, unknown>;
            if (typeof current !== 'object' || current === null || Array.isArray(current)) current = {};
        } catch {
            // A missing or unparseable file starts from empty, as the official does.
            current = {};
        }
        const merged = mergeSettings(current, settings);
        await fsPromises.mkdir(path.dirname(file), { recursive: true });
        await fsPromises.writeFile(file, JSON.stringify(merged, null, 2) + '\n');
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
            this.transport?.send({ type: "plan_comment", channelId, comment });
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
    async getAppliedSettings(channelId: string): Promise<AppliedSettings | undefined> {
        const channel = this.channels.get(channelId);
        if (!channel) {
            throw new Error(`Channel not found: ${channelId}`);
        }
        return this.readApplied(channelId, channel.query);
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
