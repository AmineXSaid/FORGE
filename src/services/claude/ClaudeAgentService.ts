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
import { readClaudeSettings, toAppliedSettings } from './claudeSettings';

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

    // Thinking Level 配置
    private thinkingLevel: string = 'default_on';

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
        // 保存 thinkingLevel
        if (thinkingLevel) {
            this.thinkingLevel = thinkingLevel;
        }

        // 计算 maxThinkingTokens
        const maxThinkingTokens = this.getMaxThinkingTokens(this.thinkingLevel);

        this.logService.info('');
        this.logService.info('╔════════════════════════════════════════╗');
        this.logService.info('║  启动 Claude 会话                       ║');
        this.logService.info('╚════════════════════════════════════════╝');
        this.logService.info(`  Channel ID: ${channelId}`);
        this.logService.info(`  Resume: ${resume || 'null'}`);
        this.logService.info(`  CWD: ${cwd}`);
        this.logService.info(`  Model: ${model || 'null'}`);
        this.logService.info(`  Permission: ${permissionMode}`);
        this.logService.info(`  Thinking Level: ${this.thinkingLevel}`);
        this.logService.info(`  Max Thinking Tokens: ${maxThinkingTokens}`);
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
                    return this.requestToolPermission(
                        channelId,
                        toolName,
                        input,
                        options.suggestions || []
                    );
                },
                model,
                cwd,
                permissionMode,
                maxThinkingTokens,
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
                query: query
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
     * @param maxThinkingTokens 最大思考 tokens
     * @returns SDK Query 对象
     */
    protected async spawnClaude(
        inputStream: AsyncStream<SDKUserMessage>,
        resume: string | null,
        canUseTool: CanUseTool,
        model: string | null,
        cwd: string,
        permissionMode: string,
        maxThinkingTokens: number,
        onStderrError?: SdkQueryParams['onStderrError']
    ): Promise<Query> {
        return this.sdkService.query({
            inputStream,
            resume,
            canUseTool,
            model,
            cwd,
            permissionMode,
            maxThinkingTokens,
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
                if (!channelId) {
                    throw new Error('channelId is required for set_permission_mode');
                }
                const permReq = request as any;
                await this.setPermissionMode(channelId, permReq.mode);
                return {
                    type: "set_permission_mode_response",
                    success: true
                };
            }

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
        suggestions: PermissionUpdate[]
    ): Promise<PermissionResult> {
        const request: ToolPermissionRequest = {
            type: "tool_permission_request",
            toolName,
            inputs,
            suggestions
        };

        const response = await this.sendRequest<ToolPermissionRequest, ToolPermissionResponse>(
            channelId,
            request
        );

        return response.result;
    }

    /**
     * 关闭服务
     */
    async shutdown(): Promise<void> {
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
     * 获取 maxThinkingTokens（根据 thinking level）
     */
    private getMaxThinkingTokens(level: string): number {
        return level === 'off' ? 0 : 31999;
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

    async setThinkingLevel(channelId: string, level: string): Promise<void> {
        this.thinkingLevel = level;

        // 更新正在运行的 channel
        const channel = this.channels.get(channelId);
        if (channel?.query) {
            const maxTokens = this.getMaxThinkingTokens(level);
            await channel.query.setMaxThinkingTokens(maxTokens);
            this.logService.info(`[setThinkingLevel] Updated channel ${channelId} to ${level} (${maxTokens} tokens)`);
        }
    }

    /**
     * 设置权限模式
     */
    async setPermissionMode(channelId: string, mode: PermissionMode): Promise<void> {
        const channel = this.channels.get(channelId);
        if (!channel) {
            this.logService.warn(`[setPermissionMode] Channel ${channelId} not found`);
            throw new Error(`Channel ${channelId} not found`);
        }

        await channel.query.setPermissionMode(mode);
        this.logService.info(`[setPermissionMode] Set channel ${channelId} to mode: ${mode}`);
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

    private async readApplied(channelId: string, query: Query): Promise<AppliedSettings | undefined> {
        try {
            const settings = await readClaudeSettings(query);
            const applied = toAppliedSettings((settings as { applied?: unknown } | undefined)?.applied);
            this.logService.info(`[appliedSettings] channel ${channelId}: ${JSON.stringify(applied ?? null)}`);
            return applied;
        } catch (error) {
            this.logService.warn(`[appliedSettings] Failed to read applied Claude settings: ${error}`);
            return undefined;
        }
    }
}
