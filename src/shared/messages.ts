/**
 * 共享消息类型定义
 *
 * 双端通信协议：Extension ↔ WebView
 */

// 导入 SDK 类型
import type {
    SDKMessage,
    SDKUserMessage,
    PermissionResult,
    PermissionUpdate,
    PermissionMode,
    SlashCommand,
    ModelInfo,
    AccountInfo,
    EffortLevel,
    Settings,
    PermissionBehavior,
    SDKControlPermissionRulesState
} from '@anthropic-ai/claude-agent-sdk';

// ============================================================================
// 基础消息类型
// ============================================================================

/**
 * 消息基类
 */
export interface BaseMessage {
    type: string;
    // 可选 WebView 实例标识，用于定向路由响应
    webviewId?: string;
}

// ============================================================================
// WebView → Extension 消息
// ============================================================================

/**
 * 启动 Claude 会话
 */
export interface LaunchClaudeMessage extends BaseMessage {
    type: "launch_claude";
    channelId: string;
    resume?: string | null;        // 恢复会话 ID
    cwd?: string;                  // 工作目录
    model?: string | null;         // 模型名称
    permissionMode?: PermissionMode; // 权限模式
    thinkingLevel?: string | null; // Thinking 等级（off | default_on）
}

/**
 * 输入输出消息（双向）
 */
export interface IOMessage extends BaseMessage {
    type: "io_message";
    channelId: string;
    message: SDKMessage | SDKUserMessage;  // SDK 消息类型
    done: boolean;                         // 是否为流的最后一条
}

/**
 * 中断 Claude
 */
export interface InterruptClaudeMessage extends BaseMessage {
    type: "interrupt_claude";
    channelId: string;
}

/**
 * 关闭会话（双向）
 */
export interface CloseChannelMessage extends BaseMessage {
    type: "close_channel";
    channelId: string;
    error?: string;
}

/**
 * SDK 错误通知（Extension → WebView）
 *
 * 当 SDK stderr 检测到致命错误（如流式请求回退失败）时，
 * 实时推送到前端以便立即展示，不等迭代器超时。
 */
export interface LLMRequestErrorMessage extends BaseMessage {
    type: "sdk_error";
    channelId: string;
    /** 人类可读的错误描述（来自上游） */
    error: string;
    /** HTTP 状态码 (e.g. "401", "503") */
    statusCode: string;
    /** 上游错误类型 (e.g. "authentication_error", "new_api_error") */
    errorType: string;
}

// ============================================================================
// 请求-响应消息（双向）
// ============================================================================

/**
 * 请求消息
 */
export interface RequestMessage<T = any> extends BaseMessage {
    type: "request";
    channelId?: string;
    requestId: string;
    request: T;
}

/**
 * 响应消息
 */
export interface ResponseMessage<T = any> extends BaseMessage {
    type: "response";
    requestId: string;
    response: T | ErrorResponse;
}

/**
 * 错误响应
 */
export interface ErrorResponse {
    type: "error";
    error: string;
}

/**
 * 取消请求
 */
export interface CancelRequestMessage extends BaseMessage {
    type: "cancel_request";
    targetRequestId: string;
}

// ============================================================================
// WebView → Extension 请求类型
// ============================================================================

/**
 * 初始化请求
 */
export interface InitRequest {
    type: "init";
}

export interface InitResponse {
    type: "init_response";
    state: {
        defaultCwd: string;
        openNewInTab: boolean;
        // authStatus: null | { authenticated: boolean };
        modelSetting: string;
        platform: string;
        /** The persisted thinking level (official `getThinkingLevel`): "off" | "default_on". */
        thinkingLevel?: string;
        /**
         * The official `initialPermissionMode` (`getInitialPermissionMode()`): the
         * mode new sessions start in, and restored ones without a stored mode.
         * Unset leaves it to the CLI.
         */
        initialPermissionMode?: PermissionMode;
        /** The official `allowDangerouslySkipPermissions`: whether bypass may be restored. */
        allowDangerouslySkipPermissions?: boolean;
    };
}

/**
 * 打开文件请求
 */
export interface OpenFileRequest {
    type: "open_file";
    filePath: string;
    location?: {
        startLine?: number;
        endLine?: number;
        startColumn?: number;
        endColumn?: number;
    };
}

export interface OpenFileResponse {
    type: "open_file_response";
}

/**
 * 打开 Diff 请求
 */
export interface OpenDiffRequest {
    type: "open_diff";
    originalFilePath: string;
    newFilePath: string;
    edits: Array<{
        oldString: string;
        newString: string;
        replaceAll?: boolean;
    }>;
    supportMultiEdits: boolean;
}

export interface OpenDiffResponse {
    type: "open_diff_response";
    newEdits: Array<{
        oldString: string;
        newString: string;
        replaceAll?: boolean;
    }>;
}

/**
 * 设置权限模式
 */
export interface SetPermissionModeRequest {
    type: "set_permission_mode";
    mode: PermissionMode;
    /**
     * The official `userInitiated`: the user picked the mode (not a prompt
     * answer). The official host then also keeps it as the default for new
     * sessions, a layer Forge's always-set "Default Permission Mode" never
     * reaches (see `initialPermissionModeFrom`).
     */
    userInitiated?: boolean;
}

export interface SetPermissionModeResponse {
    type: "set_permission_mode_response";
    success: boolean;
}

/**
 * The official `persist_session_permission_mode` (`index.js`:
 * `persistSessionPermissionMode($,J,Z,Y)`): keep `mode` for `sessionId`, or clear
 * it for a mode that is not kept (plan, don't ask). `previousSessionId` is the
 * id the CLI replaced; with `carriedFromStore` its stored mode moves to the new
 * id, without it the old entry is cleared. Ids must be session ids; anything
 * else is ignored. The answer carries nothing.
 */
export interface PersistSessionPermissionModeRequest {
    type: "persist_session_permission_mode";
    sessionId: string;
    mode: PermissionMode;
    previousSessionId?: string;
    carriedFromStore?: boolean;
}

export interface PersistSessionPermissionModeResponse {
    type: "persist_session_permission_mode_response";
}

/**
 * One row of the CLI's model list, as its initialize response carries it.
 *
 * `ModelInfo` is `sdk.d.ts` L1313 (value, resolvedModel, displayName,
 * description, supportsEffort, supportedEffortLevels, supportsAdaptiveThinking,
 * supportsFastMode, supportsAutoMode). The CLI's schema has two more fields that
 * the published typings leave out because the CLI marks them `@internal`; the CLI
 * still sends them and the official picker renders them:
 * - `disabled`: visible but not selectable; the reason is folded into `description`.
 * - `promoListPrice`: a launch promo's list price, struck through before the
 *   first `$X/$Y per Mtok` in `description`.
 */
export type CliModelInfo = ModelInfo & {
    disabled?: boolean;
    promoListPrice?: string;
};

/**
 * What `set_model` carries: the official sends the picked row itself, so every
 * field but `value` is optional (a Forge custom model has only a value and name).
 */
export type ModelOption = Pick<CliModelInfo, 'value'> & Partial<Omit<CliModelInfo, 'value'>>;

/**
 * 设置模型
 *
 * The official payload (`index.js`: `setModel($,J)` sends `{model: J}`). The host
 * refuses anything whose `model.value` is not a string, as the official does.
 */
export interface SetModelRequest {
    type: "set_model";
    model: ModelOption;
}

/**
 * The official response carries no `success`: a failure is an error response.
 * `applied` is what the CLI reports after the switch (`getSettings().applied`),
 * so the webview can show the effort the new model actually runs at.
 */
export interface SetModelResponse {
    type: "set_model_response";
    applied?: AppliedSettings;
}

/**
 * What the CLI says it will actually send on the next request -- the `applied`
 * block of its `get_settings` control response (CLI 2.1.274:
 * `applied:{model, effort, advisor, ultracode}`). `effort` is after env
 * overrides, session state, org caps (`maxEffortLevel`) and model downgrades;
 * `null` when no effort parameter will be sent. `Query.getSettings()` exists in
 * the SDK runtime (`sdk.mjs`) but not in its published typings, so the shape is
 * typed here from the CLI.
 */
export interface AppliedSettings {
    model?: string;
    effort?: EffortLevel | null;
    advisor?: string | null;
    ultracode?: boolean;
}

/**
 * The part of the CLI's `get_settings` response the webview reads -- the
 * official `config.claudeSettings`. Forge sends only these fields: `applied`
 * seeds the effort control, `effective.disableWorkflows` gates Ultracode,
 * `effective.ultracode` says whether a settings layer already turned it on, and
 * `effective.permissions.disableBypassPermissionsMode` keeps a stored bypass
 * from being restored (step 18).
 */
export interface ClaudeSettingsSnapshot {
    effective: Pick<Settings, 'disableWorkflows' | 'ultracode' | 'effortLevel'> & {
        permissions?: Pick<NonNullable<Settings['permissions']>, 'disableBypassPermissionsMode'>;
    };
    applied?: AppliedSettings;
}

/**
 * The official `get_applied_settings`: re-read what the CLI applied, on the
 * channel's own session. No `applied` when the CLI could not answer.
 */
export interface GetAppliedSettingsRequest {
    type: "get_applied_settings";
}

export interface GetAppliedSettingsResponse {
    type: "get_applied_settings_response";
    applied?: AppliedSettings;
}

/**
 * 设置 Thinking Level
 */
/**
 * The official payload (`index.js`: `setThinkingLevel($,J)` sends
 * `{type:"set_thinking_level", thinkingLevel:J}`; the channel is on the envelope).
 * The webview only ever sends "off" or "default_on", and the host refuses
 * anything else.
 */
export interface SetThinkingLevelRequest {
    type: "set_thinking_level";
    thinkingLevel: string;
}

export interface SetThinkingLevelResponse {
    type: "set_thinking_level_response";
}

/**
 * 获取 Claude 状态
 */
export interface GetClaudeStateRequest {
    type: "get_claude_state";
}

/** What `get_claude_state` returns; field names follow the CLI's initialize response. */
export interface ClaudeConfig {
    commands: SlashCommand[];
    /** Selectable models, in the CLI's order (`SDKControlInitializeResponse.models`, `sdk.d.ts` L4288). */
    models: CliModelInfo[];
    /**
     * Models the account can see but not select, each `disabled: true` with the
     * reason in its description. The CLI only sends these to a host whose
     * `CLAUDE_CODE_ENTRYPOINT` is `claude-vscode`, and omits the key when empty.
     */
    unavailable_models?: CliModelInfo[];
    accountInfo: AccountInfo | null;
    /** The official `config.claudeSettings`, as far as the webview reads it. */
    claudeSettings?: ClaudeSettingsSnapshot;
}

export interface GetClaudeStateResponse {
    type: "get_claude_state_response";
    config: ClaudeConfig;
}

/**
 * 一次性 SDK 探测
 */
export type SdkProbeCapability =
    | "supportedCommands"
    | "supportedModels"
    | "mcpServerStatus"
    | "accountInfo"
    | (string & {});

export interface SdkProbeRequest {
    type: "sdk_probe";
    capabilities: SdkProbeCapability[];
    timeoutMs?: number;
}

export interface SdkProbeResponse {
    type: "sdk_probe_response";
    data: Record<string, any>;
    errors?: Record<string, string>;
}

/**
 * 获取 MCP 服务器
 */
export interface GetMcpServersRequest {
    type: "get_mcp_servers";
}

export interface GetMcpServersResponse {
    type: "get_mcp_servers_response";
    mcpServers: Array<{ name: string; status: string }>;
}

/**
 * 获取资源 URI
 */
export interface GetAssetUrisRequest {
    type: "get_asset_uris";
}

export interface GetAssetUrisResponse {
    type: "asset_uris_response";
    assetUris: any;
}

/**
 * 列出会话
 */
export interface ListSessionsRequest {
    type: "list_sessions_request";
}

export interface ListSessionsResponse {
    type: "list_sessions_response";
    sessions: Array<{
        id: string;
        lastModified: number;
        messageCount: number;
        summary: string;
        worktree?: string;
        isCurrentWorkspace: boolean;
        /** The session's stored permission mode (official `getSessionPermissionModes()`). */
        permissionMode?: PermissionMode;
    }>;
}

/**
 * 获取会话详情
 */
export interface GetSessionRequest {
    type: "get_session_request";
    sessionId: string;
}

export interface GetSessionResponse {
    type: "get_session_response";
    messages: any[];
}

/**
 * 执行命令
 */
export interface ExecRequest {
    type: "exec";
    command: string;
    params: string[];
}

export interface ExecResponse {
    type: "exec_response";
    stdout: string;
    stderr: string;
    exitCode: number;
}

/**
 * 列出文件
 */
export interface ListFilesRequest {
    type: "list_files_request";
    pattern?: string;
}

export interface ListFilesResponse {
    type: "list_files_response";
    files: Array<{
        path: string;
        name: string;
        type: "file" | "directory";
    }>;
}

/**
 * 统计路径类型（文件 / 目录）
 */
export interface StatPathRequest {
    type: "stat_path_request";
    /**
     * 路径数组，可以是工作区相对路径或绝对路径
     */
    paths: string[];
}

export interface StatPathResponse {
    type: "stat_path_response";
    entries: Array<{
        path: string;
        /**
         * 文件类型：file / directory / other / not_found
         */
        type: "file" | "directory" | "other" | "not_found";
    }>;
}

/**
 * 打开内容（临时文件）
 */
export interface OpenContentRequest {
    type: "open_content";
    content: string;
    fileName: string;
    editable: boolean;
}

export interface OpenContentResponse {
    type: "open_content_response";
    updatedContent?: string;
}

/**
 * 当前选区
 */
export interface SelectionRange {
    filePath: string;
    startLine: number;
    endLine: number;
    startColumn?: number;
    endColumn?: number;
    selectedText: string;
}

export interface GetCurrentSelectionRequest {
    type: "get_current_selection";
}

export interface GetCurrentSelectionResponse {
    type: "get_current_selection_response";
    selection: SelectionRange | null;
}

/**
 * 打开 URL
 */
export interface OpenURLRequest {
    type: "open_url";
    url: string;
}

export interface OpenURLResponse {
    type: "open_url_response";
}

/**
 * 显示通知
 */
export interface ShowNotificationRequest {
    type: "show_notification";
    message: string;
    severity: "info" | "warning" | "error";
    buttons?: string[];
    onlyIfNotVisible?: boolean;
}

export interface ShowNotificationResponse {
    type: "show_notification_response";
    buttonValue?: string;
}

/**
 * 新建会话标签
 */
export interface NewConversationTabRequest {
    type: "new_conversation_tab";
    initialPrompt?: string;
}

export interface NewConversationTabResponse {
    type: "new_conversation_tab_response";
}

/**
 * 重命名标签
 */
export interface RenameTabRequest {
    type: "rename_tab";
    title: string;
}

export interface RenameTabResponse {
    type: "rename_tab_response";
}

/**
 * 获取认证状态
 */
// export interface GetAuthStatusRequest {
//     type: "get_auth_status";
// }

// export interface GetAuthStatusResponse {
//     type: "get_auth_status_response";
//     status: null | { authenticated: boolean };
// }

/**
 * 登录请求
 */
// export interface LoginRequest {
//     type: "login";
//     method: "claude.ai" | "console.anthropic.com";
// }

// export interface LoginResponse {
//     type: "login_response";
//     auth: {
//         authenticated: boolean;
//         apiKey?: string;
//     };
// }

/**
 * 提交 OAuth 代码
 */
// export interface SubmitOAuthCodeRequest {
//     type: "submit_oauth_code";
//     code: string;
// }

// export interface SubmitOAuthCodeResponse {
//     type: "submit_oauth_code_response";
// }

/**
 * 打开配置文件
 */
export interface OpenConfigFileRequest {
    type: "open_config_file";
    configType: string;
}

export interface OpenConfigFileResponse {
    type: "open_config_file_response";
}

/**
 * 应用设置（官方 apply_settings）
 *
 * The official payload (`index.js`: `applySettings($,J,Z)` sends
 * `{settings, flagsOnly, scope}`). The host validates every key against the
 * whitelist in `settingsWhitelist.ts` before anything is written.
 */
export interface ApplySettingsRequest {
    type: "apply_settings";
    /** Key to value; `null` clears the key. */
    settings: Record<string, unknown>;
    /** Write to the session-scoped flag layer only, not to a file. */
    flagsOnly?: boolean;
    /** `"localSettings"` targets `.claude/settings.local.json`. */
    scope?: string;
}

export interface ApplySettingsResponse {
    type: "apply_settings_response";
}

/**
 * One comment on a plan in the plan preview (the official shape): the text the
 * user selected, the heading above it, and what they wrote.
 */
export interface PlanComment {
    id: string;
    selectedText: string;
    sectionHeading: string;
    comment: string;
}

/**
 * The plan preview requests. Payloads from `index.js`; unlike most requests the
 * channel travels in the body:
 * `{type:"open_markdown_preview", channelId, content, title, enableComments}`,
 * `{type:"remove_plan_comment", channelId, commentId}`,
 * `{type:"close_plan_preview", channelId}`. The official host also answers
 * `{type:"get_plan_comments", channelId}`, which its webview never sends.
 */
export interface OpenMarkdownPreviewRequest {
    type: "open_markdown_preview";
    channelId: string;
    /** The plan's markdown. */
    content: string;
    title?: string;
    enableComments?: boolean;
}

export interface OpenMarkdownPreviewResponse {
    type: "open_markdown_preview_response";
}

export interface GetPlanCommentsRequest {
    type: "get_plan_comments";
    channelId: string;
}

export interface GetPlanCommentsResponse {
    type: "get_plan_comments_response";
    comments: PlanComment[];
}

export interface RemovePlanCommentRequest {
    type: "remove_plan_comment";
    channelId: string;
    commentId: string;
}

export interface RemovePlanCommentResponse {
    type: "remove_plan_comment_response";
}

export interface ClosePlanPreviewRequest {
    type: "close_plan_preview";
    channelId: string;
}

export interface ClosePlanPreviewResponse {
    type: "close_plan_preview_response";
}

/** Host → webview: a comment made in the plan preview (`plan_comment`). */
export interface PlanCommentMessage extends BaseMessage {
    type: "plan_comment";
    channelId: string;
    comment: PlanComment;
}

/**
 * The settings files a permission rule can be added to or removed from (the
 * official `Wo$`). `session` and `cliArg` rules are not editable here.
 */
export type EditableRuleDestination = "userSettings" | "projectSettings" | "localSettings";

/**
 * The official permission-rule requests, sent by the "Permission rules" dialog
 * ("/" → Permissions). Payloads from `index.js`:
 * `{type:"list_permission_rules"}`,
 * `{type:"add_permission_rules", rules, behavior, destination}`,
 * `{type:"remove_permission_rule", rule, behavior, source}`; the channel is on
 * the envelope.
 *
 * Every answer is in-band: a bad shape is `error: "invalid request"`, a failed
 * write or read is `error: <message>`, never an error response.
 */
export interface ListPermissionRulesRequest {
    type: "list_permission_rules";
}

export interface ListPermissionRulesResponse {
    type: "list_permission_rules_response";
    /** The session's live rules (`SDKControlPermissionRulesState`, `sdk.d.ts` L4522). */
    state?: SDKControlPermissionRulesState;
    error?: string;
}

export interface AddPermissionRulesRequest {
    type: "add_permission_rules";
    /** 1 to 100 rule strings, each at most 10 000 characters. */
    rules: string[];
    behavior: PermissionBehavior;
    destination: EditableRuleDestination;
}

export interface AddPermissionRulesResponse {
    type: "add_permission_rules_response";
    state?: SDKControlPermissionRulesState;
    /** Written, but the running session had not re-read it yet. */
    pending?: true;
    /** What the CLI said about the rules it stored (e.g. saved as a tool-wide rule). */
    warnings?: string[];
    error?: string;
}

export interface RemovePermissionRuleRequest {
    type: "remove_permission_rule";
    /** The rule string verbatim, as the listing reports it. */
    rule: string;
    behavior: PermissionBehavior;
    source: EditableRuleDestination;
}

export interface RemovePermissionRuleResponse {
    type: "remove_permission_rule_response";
    state?: SDKControlPermissionRulesState;
    pending?: true;
    error?: string;
}

/**
 * 在终端打开 Claude
 *
 * The official payload (`index.js`: `openClaudeInTerminal($,J,Z)`). All three
 * fields are optional, and the host validates `prompt` and `args` with `JI0`
 * before it launches anything.
 */
export interface OpenClaudeInTerminalRequest {
    type: "open_claude_in_terminal";
    /** A bare slash command, e.g. `/review`. Nothing else is accepted. */
    prompt?: string;
    /** `[]`, or exactly `["--resume", <session id>]`. */
    args?: string[];
    /** `"bottom"` (the terminal panel), `"window"` or `"beside"`. */
    location?: "bottom" | "window" | "beside";
}

export interface OpenClaudeInTerminalResponse {
    type: "open_claude_in_terminal_response";
}

/**
 * 认证 URL 通知（Extension → WebView）
 */
// export interface AuthURLRequest {
//     type: "auth_url";
//     url: string;
//     method: string;
// }


/**
 * 获取设置请求
 */
export interface GetSettingsRequest {
    type: "get_settings";
}

export interface GetSettingsResponse {
    type: "get_settings_response";
    settings: any;
  // New fields for Profile Management
  activeProfile: string | null;
  profiles: string[];
  hasWorkspace: boolean;
  metadata?: Record<
    string,
    {
      effectiveScope: 'managed' | 'cli' | 'profile' | 'local' | 'shared' | 'global' | 'default';
      values: {
        managed?: any;
        cli?: any;
        profile?: any;
        local?: any;
        shared?: any;
        global?: any;
        default?: any;
      };
    }
  >;
}

/**
 * 切换 Profile 请求
 */
export interface SwitchProfileRequest {
  type: 'switch_profile';
  profile: string | null; // null for default
}

export interface SwitchProfileResponse {
  type: 'switch_profile_response';
  success: boolean;
}

/**
 * 创建 Profile 请求
 */
export interface CreateProfileRequest {
  type: 'create_profile';
  name: string;
}

export interface CreateProfileResponse {
  type: 'create_profile_response';
  success: boolean;
  error?: string;
}

/**
 * 删除 Profile 请求
 */
export interface DeleteProfileRequest {
  type: 'delete_profile';
  name: string;
}

export interface DeleteProfileResponse {
  type: 'delete_profile_response';
  success: boolean;
  error?: string;
}

/**
 * 更新设置请求
 */
export interface UpdateSettingRequest {
    type: "update_setting";
    key: string;
    value: any;
    target?: 'local' | 'shared' | 'global';
}

export interface UpdateSettingResponse {
    type: "update_setting_response";
    success: boolean;
}

/**
 * 重置设置请求（删除某层的值，回落到继承）
 */
export interface ResetSettingRequest {
    type: "reset_setting";
    key: string;
    target: 'local' | 'shared' | 'global';
}

export interface ResetSettingResponse {
    type: "reset_setting_response";
    success: boolean;
}

/**
 * 获取扩展配置请求 (~/.forge.json)
 */
export interface GetExtensionConfigRequest {
    type: "get_extension_config";
}

export interface GetExtensionConfigResponse {
    type: "get_extension_config_response";
    config: {
        defaultPermissionMode: string;
        defaultModel: string;
        defaultThinkingLevel: string;
        systemNotifications: boolean;
        completionSound: boolean;
        customModels: Array<{ id: string; name?: string }>;
        disabledModels: string[];
    };
}

/**
 * 更新扩展配置请求
 */
export interface UpdateExtensionConfigRequest {
    type: "update_extension_config";
    key: string;
    value: any;
}

export interface UpdateExtensionConfigResponse {
    type: "update_extension_config_response";
    success: boolean;
}

// ============================================================================
// Extension → WebView 请求类型
// ============================================================================

/**
 * 工具权限请求
 */
export interface ToolPermissionRequest {
    type: "tool_permission_request";
    toolName: string;
    inputs: Record<string, unknown>;
    suggestions: PermissionUpdate[];
    /**
     * The `CanUseTool` options the official host forwards
     * (`requestToolPermission(..., {defaultToNo, suppressAlwaysAllowRule,
     * toolUseId: toolUseID, agentId: agentID})`, `sdk.d.ts` L213).
     */
    /** Open on the decline option, with no one-key approve shortcut. */
    defaultToNo?: boolean;
    /** Offer no "don't ask again" option: the rule would grant more than this ask. */
    suppressAlwaysAllowRule?: boolean;
    toolUseId?: string;
    agentId?: string;
}

export interface ToolPermissionResponse {
    type: "tool_permission_response";
    result: PermissionResult;
}

/**
 * @ 提及插入
 */
export interface InsertAtMentionRequest {
    type: "insert_at_mention";
    text: string;
}

/**
 * 选区变化通知
 */
export interface SelectionChangedRequest {
    type: "selection_changed";
    selection: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
}

/**
 * 扩展配置变更通知 (Extension → WebView broadcast)
 */
export interface ExtensionConfigChangedRequest {
    type: "extension_config_changed";
    key: string;
    value: any;
}

/**
 * 状态更新
 */
export interface UpdateStateRequest {
    type: "update_state";
    // 与 init_response.state 对齐，保证双方一致
    state: InitResponse['state'];
    // 后端下发的 Claude 配置对象
    config: GetClaudeStateResponse['config'];
}

// ============================================================================
// 联合类型
// ============================================================================

/**
 * 所有 WebView → Extension 的消息
 */
export type WebViewToExtensionMessage =
    | LaunchClaudeMessage
    | IOMessage
    | InterruptClaudeMessage
    | CloseChannelMessage
    | RequestMessage
    | ResponseMessage
    | CancelRequestMessage;

/**
 * 所有 Extension → WebView 的消息
 */
export type ExtensionToWebViewMessage =
    | IOMessage
    | CloseChannelMessage
    | LLMRequestErrorMessage
    | PlanCommentMessage
    | RequestMessage
    | ResponseMessage;

/**
 * Extension 发送时的封装格式
 */
export interface FromExtensionWrapper {
    type: "from-extension";
    message: ExtensionToWebViewMessage;
}

// ============================================================================
// 请求和响应的联合类型
// ============================================================================

/**
 * WebView → Extension 的所有请求类型
 */
export type WebViewRequest =
    | InitRequest
    | OpenFileRequest
    | OpenDiffRequest
    | OpenContentRequest
    | SetPermissionModeRequest
    | PersistSessionPermissionModeRequest
    | SetModelRequest
    | GetAppliedSettingsRequest
    | SetThinkingLevelRequest
    | GetCurrentSelectionRequest
    | ShowNotificationRequest
    | NewConversationTabRequest
    | RenameTabRequest
    | GetClaudeStateRequest
    | SdkProbeRequest
    | GetMcpServersRequest
    | GetAssetUrisRequest
    | ListSessionsRequest
    | GetSessionRequest
    | ExecRequest
    | ListFilesRequest
    | OpenURLRequest
    | StatPathRequest
    // | GetAuthStatusRequest
    // | LoginRequest
    // | SubmitOAuthCodeRequest
    | OpenConfigFileRequest
    | OpenConfigFileRequest
    | ApplySettingsRequest
    | ListPermissionRulesRequest
    | AddPermissionRulesRequest
    | RemovePermissionRuleRequest
    | OpenMarkdownPreviewRequest
    | GetPlanCommentsRequest
    | RemovePlanCommentRequest
    | ClosePlanPreviewRequest
    | OpenClaudeInTerminalRequest
    | GetSettingsRequest
    | UpdateSettingRequest
    | ResetSettingRequest
    | SwitchProfileRequest
    | CreateProfileRequest
    | DeleteProfileRequest
    | GetExtensionConfigRequest
    | UpdateExtensionConfigRequest;

/**
 * Extension → WebView 的所有响应类型
 */
export type WebViewRequestResponse =
    | InitResponse
    | OpenFileResponse
    | OpenDiffResponse
    | OpenContentResponse
    | SetPermissionModeResponse
    | PersistSessionPermissionModeResponse
    | SetModelResponse
    | GetAppliedSettingsResponse
    | SetThinkingLevelResponse
    | GetCurrentSelectionResponse
    | ShowNotificationResponse
    | NewConversationTabResponse
    | RenameTabResponse
    | GetClaudeStateResponse
    | SdkProbeResponse
    | GetMcpServersResponse
    | GetAssetUrisResponse
    | ListSessionsResponse
    | GetSessionResponse
    | ExecResponse
    | ListFilesResponse
    | OpenURLResponse
    | StatPathResponse
    // | GetAuthStatusResponse
    // | LoginResponse
    // | SubmitOAuthCodeResponse
    | OpenConfigFileResponse
    | OpenConfigFileResponse
    | ApplySettingsResponse
    | ListPermissionRulesResponse
    | AddPermissionRulesResponse
    | RemovePermissionRuleResponse
    | OpenMarkdownPreviewResponse
    | GetPlanCommentsResponse
    | RemovePlanCommentResponse
    | ClosePlanPreviewResponse
    | OpenClaudeInTerminalResponse
    | GetSettingsResponse
    | UpdateSettingResponse
    | ResetSettingResponse
    | SwitchProfileResponse
    | CreateProfileResponse
    | DeleteProfileResponse
    | GetExtensionConfigResponse
    | UpdateExtensionConfigResponse;

/**
 * Extension → WebView 的所有请求类型
 */
export type ExtensionRequest =
    | ToolPermissionRequest
    | InsertAtMentionRequest
    | SelectionChangedRequest
    | UpdateStateRequest
    | VisibilityChangedRequest
    | UiCommandRequest;
    // | AuthURLRequest;

/**
 * UI 命令（Extension → WebView）
 *
 * VSCode 命令与键绑定驱动的单向通知，WebView 不回复。
 * 用于 forge.focus / forge.blur / forge.newConversation 等命令。
 */
export type UiCommandName =
    | "focus_input"
    | "blur_input"
    | "focus_last_message"
    | "new_conversation";

export interface UiCommandRequest {
    type: "ui_command";
    command: UiCommandName;
}

/**
 * 可见性变化（Extension → WebView）
 *
 * 原始代码：Analyze/extension.unpack.js:2648-2656
 */
export interface VisibilityChangedRequest {
    type: "visibility_changed";
    isVisible: boolean;
}

/**
 * WebView → Extension 的所有响应类型
 */
export type ExtensionRequestResponse =
    | ToolPermissionResponse;
