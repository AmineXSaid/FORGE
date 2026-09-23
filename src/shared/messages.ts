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
        /**
         * How many endpoint profiles parse, from either source.
         *
         * Forge-only: the official has no endpoint concept. `0` is what the
         * empty state uses to offer setting one up, and it is a count rather
         * than a boolean so the card can stop appearing the moment one exists
         * without a second round trip.
         */
        endpointProfileCount?: number;
        /**
         * How many models answered a real request, across every profile.
         *
         * A count beside `endpointProfileCount` for the same reason that one is
         * a count: the welcome gate decides on the handshake rather than paying
         * a second round trip, and "101 models listed" is not an answer to
         * "can Forge send your work anywhere". Zero with
         * `endpointHealthCheckedProfileCount > 0` is the loud case -- profiles
         * exist, they were measured, and nothing replied.
         *
         * `undefined` is "not known yet", which is deliberately not zero: the
         * gate must not flash on launch.
         */
        endpointHealthyModelCount?: number;
        /**
         * How many profiles have a completed sweep behind them. `0` with
         * profiles present means never checked, which is a different welcome
         * state from "checked, and nothing answered".
         */
        endpointHealthCheckedProfileCount?: number;
        /**
         * The official `browserIntegrationSupported:this.isBrowserIntegrationSupported()`
         * (extension.js @3061483). It is a field on the init state, not something
         * the webview computes -- the "+" menu reads
         * `connection.config.value?.browserIntegrationSupported` (index.js
         * @5085744), and so does the send path.
         *
         * The official's own test is `authManager.getAuthStatus()?.authMethod==="claudeai"`.
         * Forge keeps login out of scope, so it has no auth status to read; it
         * gates on what it *can* observe and what the feature actually needs --
         * a resolvable Claude binary, since the browser MCP server is that
         * binary run with `--claude-in-chrome-mcp`. See
         * `docs/backend-wiring/results/28-browser-integration.md`.
         */
        browserIntegrationSupported?: boolean;
        /**
         * The official `focusViewEnabled` on the config the webview reads
         * (`comms.connection.value?.config.value?.focusViewEnabled ?? !1`,
         * index.js @4700510). The official persists it as the VS Code setting
         * `claudeCode.focusView`; Forge keeps it in its own extension config
         * file, which is where every other Forge-owned preference lives. Step 30.
         */
        focusViewEnabled?: boolean;
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
    /**
     * The config was cut short rather than complete: a probe timed out or
     * failed, so `models` or `commands` may be emptier than the truth.
     *
     * The host answers within a budget whatever happens, because the webview's
     * handshake blocks on this request -- but "answered quickly" and "answered
     * fully" are different claims, and only the host can tell them apart. This
     * is how it says which one it made, so the webview knows to ask again
     * instead of treating an empty model list as settled fact.
     */
    provisional?: boolean;
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

/**
 * One listed conversation, in the official host's own field order
 * (`buildSessionList`), which is the SDK's `SDKSessionInfo` (sdk.d.ts:5455)
 * plus the host's archived flag and its worktree / workspace derivation.
 */
export interface SessionListEntry {
    /** `SDKSessionInfo.sessionId`. */
    id: string;
    /** In the host's `hiddenSessionIds` set (step 21). */
    archived: boolean;
    /** `SDKSessionInfo.lastModified`, ms since epoch. */
    lastModified: number;
    /** `SDKSessionInfo.fileSize`, bytes; local JSONL storage only. */
    fileSize?: number;
    /** `SDKSessionInfo.summary`: the custom title, else the auto summary or first prompt. */
    summary: string;
    /** `SDKSessionInfo.customTitle`: the latest `custom-title` line (step 20). */
    customTitle?: string;
    /** `SDKSessionInfo.firstPrompt`: the first meaningful user prompt. */
    firstPrompt?: string;
    /** `SDKSessionInfo.gitBranch`: the branch at the end of the session (step 23). */
    gitBranch?: string;
    /** `SDKSessionInfo.cwd`: the session's working directory. */
    cwd?: string;
    /** `SDKSessionInfo.tag`: the user-set session tag (`tagSession`). */
    tag?: string;
    /** `SDKSessionInfo.createdAt`, ms since epoch, from the first entry. */
    createdAt?: number;
    /** `l$$(cwd)`: the `.claude/worktrees/<name>` checkout, when it is one. */
    worktree?: { name: string; path: string };
    /** `BI0(cwd, hostCwd)`: whether this window owns the session. */
    isCurrentWorkspace: boolean;
    /** The session's stored permission mode (official `getSessionPermissionModes()`). */
    permissionMode?: PermissionMode;
}

export interface ListSessionsResponse {
    type: "list_sessions_response";
    sessions: SessionListEntry[];
    /**
     * Forge-only: set when the store could not be read, with `sessions` empty.
     *
     * The host always answers, and "no history yet" is an empty list with no
     * error -- the SDK reads a missing project directory as none. This field is
     * what tells a real failure apart from that, so the list can offer a retry
     * instead of claiming there are no conversations, and so a failed read is
     * never mistaken for every conversation having been deleted.
     */
    error?: string;
}

/**
 * The official `rename_session` (`index.js`:
 * `renameSession($,J){return this.sendRequest({type:"rename_session",sessionId:$,title:J})}`).
 *
 * The host caps the title with `GX` and appends one
 * `{"type":"custom-title","sessionId","customTitle"}` line to the transcript;
 * it never rewrites the file. A bad id, a non-string title, an empty title or
 * a transcript it cannot find all come back as `skipped: true` rather than an
 * error (`{type:"rename_session_response",skipped:!0}`).
 */
export interface RenameSessionRequest {
    type: "rename_session";
    sessionId: string;
    title: string;
}

export interface RenameSessionResponse {
    type: "rename_session_response";
    skipped: boolean;
}

/**
 * The official `archive_session` / `unarchive_session` (`index.js`:
 * `archiveSession($){return this.sendRequest({type:"archive_session",sessionId:$})}`).
 *
 * The host keeps the ids in `globalState` (`hiddenSessionIds`), so an archived
 * conversation stays archived across reloads; `unarchive_session` also stamps
 * `sessionUnarchivedAt`. An id that is not a session id is ignored and the bare
 * response is returned either way (`if(y0($)===null) return {type:"…_response"}`).
 */
export interface ArchiveSessionRequest {
    type: "archive_session";
    sessionId: string;
}

export interface ArchiveSessionResponse {
    type: "archive_session_response";
}

export interface UnarchiveSessionRequest {
    type: "unarchive_session";
    sessionId: string;
}

export interface UnarchiveSessionResponse {
    type: "unarchive_session_response";
}

/**
 * The official `set_session_unread` (`index.js`:
 * `setSessionUnread($,J){return this.sendRequest({type:"set_session_unread",sessionKey:$,unread:J})}`).
 *
 * `sessionKey` is the official `c$(sessionId, isRemote)` — the id, prefixed
 * `remote:` for a cloud session. Forge has local sessions only, so it is the id;
 * the host still validates it the way the official does (a 1..200 character
 * string), not as a UUID.
 *
 * The base dispatcher answers a bare `{type:"set_session_unread_response"}`;
 * the real work is in the webview-provider subclass
 * (`this.onSetSessionUnread?.($.request.sessionKey, $.request.unread)`).
 */
export interface SetSessionUnreadRequest {
    type: "set_session_unread";
    sessionKey: string;
    unread: boolean;
}

export interface SetSessionUnreadResponse {
    type: "set_session_unread_response";
}

/**
 * The official `rewind_code` (`index.js`:
 * `async rewindCode($,J,Z){return this.sendRequest({type:"rewind_code",userMessageId:J,dryRun:Z?.dryRun},$)}`).
 *
 * Unlike every other request in group 5 this one is **channel-scoped**: `$` is
 * the channelId, so the host resolves it against a live channel's `query` the
 * way the official's `withChannel` does.
 *
 * `dryRun` is `Z?.dryRun`, so it is genuinely optional — the official sends the
 * key with the value `undefined` when `rewindCode(id)` is called with no
 * options, and that is the real run. The step file's "`dryRun` is a boolean" is
 * wrong; see `docs/backend-wiring/results/24-rewind-code.md`.
 */
export interface RewindCodeRequest {
    type: "rewind_code";
    userMessageId: string;
    dryRun?: boolean;
}

/**
 * The official response, field for field
 * (`extension.js`: `{type:"rewind_code_response",canRewind:z.canRewind,
 * filesChanged:z.filesChanged,insertions:z.insertions,deletions:z.deletions,
 * skippedLinks:z.skippedLinks}`).
 *
 * These are five of the six fields on the SDK's `RewindFilesResult`
 * (sdk.d.ts:3124). The sixth, `error`, is deliberately not forwarded: the
 * official **throws** it (`if(z.error)throw Error(z.error)`), so the webview
 * sees a rejected request rather than a shaped error. Forge's host already maps
 * a thrown handler error onto `{type:"error",error}` and its transport rejects
 * that promise, so the official's semantics carry over unchanged.
 */
/**
 * The official `fork_conversation` (`index.js`:
 * `async forkConversation($,J){return(await this.sendRequest({type:"fork_conversation",forkedFromSession:$,resumeSessionAt:J})).sessionId}`).
 *
 * **Not** channel-scoped: forking copies a transcript on disk, which the host
 * can do without a running session.
 *
 * `resumeSessionAt` is the uuid of the message the fork should end at — the
 * message *before* the one the user picked, so the picked prompt can be edited
 * and re-sent. Omitted means "copy the whole conversation".
 */
export interface ForkConversationRequest {
    type: "fork_conversation";
    forkedFromSession: string;
    resumeSessionAt?: string;
    /**
     * The SDK's `ForkSessionOptions.title` (sdk.d.ts:779), which the official
     * never sends. Forge accepts it so the option is reachable; when it is
     * absent the SDK derives `<original> (fork)`, which is what the official
     * gets by never passing one.
     */
    title?: string;
}

export interface ForkConversationResponse {
    type: "fork_conversation_response";
    /** The new session's uuid. The official reads exactly this field. */
    sessionId: string;
}

export interface RewindCodeResponse {
    type: "rewind_code_response";
    canRewind: boolean;
    filesChanged?: string[];
    insertions?: number;
    deletions?: number;
    /**
     * Only ever set by a real (non-dryRun) rewind: the count of tracked files
     * left alone because a symlink, a hard link or another non-regular file was
     * found at the tracked path (sdk.d.ts:3131).
     */
    skippedLinks?: number;
}

/**
 * Step 29, output styles. All three senders are channel-scoped (`index.js`
 * @3323774), and all three handlers are `withChannel` (`extension.js` @3069195).
 *
 *   async getOutputStyle($){let J=await this.sendRequest({type:"get_output_style"},$);
 *     return{outputStyle:J.outputStyle,availableStyles:J.availableStyles}}
 *   async getOutputStyleLocations($){…{type:"get_output_style_locations"}…}
 *   async createOutputStyle($,J,Z,Y){return(await this.sendRequest(
 *     {type:"create_output_style",draft:J,level:Z,replace:Y},$)).result}
 */
export interface GetOutputStyleRequest {
    type: "get_output_style";
}

export interface GetOutputStyleResponse {
    type: "get_output_style_response";
    /**
     * The official omits this key entirely unless `getSettings().effective.outputStyle`
     * is a string (`...typeof W==="string"&&{outputStyle:W}`), so "the CLI could
     * not say" is distinguishable from any particular style.
     */
    outputStyle?: string;
    /**
     * The official's two-source fallback: `channel.outputStyles ?? z.available_output_styles`
     * — the list a `create_output_style` reload produced, else the one the
     * session was initialised with.
     */
    availableStyles?: string[];
}

export interface GetOutputStyleLocationsRequest {
    type: "get_output_style_locations";
}

export interface GetOutputStyleLocationsResponse {
    type: "get_output_style_locations_response";
    /** `path.join(".claude","output-styles")` — **relative**, as the official sends it. */
    project: string;
    /** The user folder, tildified (`WO$`). */
    user: string;
}

/** The official draft the wizard builds, field for field. */
export interface OutputStyleDraftPayload {
    name: string;
    description: string;
    instructions: string;
    keepCodingInstructions?: boolean;
}

export interface CreateOutputStyleRequest {
    type: "create_output_style";
    draft: OutputStyleDraftPayload;
    level: "project" | "user";
    /** Only `true` ever overwrites an existing style file. */
    replace?: boolean;
}

export type CreateOutputStyleResult =
    /** The name is taken at that level and `replace` was not set. */
    | { kind: "exists" }
    | {
          kind: "saved";
          /** The absolute path written. */
          filePath: string;
          /** Present only when the CLI reloaded its list in time. */
          availableStyles?: string[];
      };

export interface CreateOutputStyleResponse {
    type: "create_output_style_response";
    result: CreateOutputStyleResult;
}

/**
 * Step 32, the two rows that used to reach VS Code through a command name.
 *
 * The official senders (`index.js` @3322678):
 *
 *   openConfig($){return this.sendRequest({type:"open_config",searchString:$})}
 *   openHelp(){return this.sendRequest({type:"open_help"})}
 *
 * and the handlers (`extension.js` @3319627):
 *
 *   async openConfig($){await commands.executeCommand("workbench.action.focusFirstEditorGroup"),
 *     await commands.executeCommand("workbench.action.openSettings",$||"claudeCode")}
 *   async openHelp(){let $=Uri.parse("https://code.claude.com/docs/en/vs-code");
 *     await env.openExternal($)}
 *
 * Both "/" rows call them with no argument, so the search string is always the
 * default. Forge's default is its own settings prefix, `forge`, which is what
 * `open_config_file {configType:"vscode"}` already searched for.
 *
 * The docs URL is **not** rebranded: Forge runs the Claude Code CLI, and
 * `https://code.claude.com/docs/en/vs-code` is the documentation for what it
 * actually does. The row's label stays "View help docs".
 */
export const FORGE_CONFIG_SEARCH = "forge";
export const FORGE_HELP_URL = "https://code.claude.com/docs/en/vs-code";

/**
 * A settings search box is a few words. The official caps nothing, but the
 * webview is untrusted input (B3) and a string this long is not a search.
 */
export const CONFIG_SEARCH_MAX_LENGTH = 200;

export interface OpenConfigRequest {
    type: "open_config";
    /** Omitted uses `FORGE_CONFIG_SEARCH`, as the official's `$||"claudeCode"` does. */
    searchString?: string;
}

export interface OpenConfigResponse {
    type: "open_config_response";
}

export interface OpenHelpRequest {
    type: "open_help";
}

export interface OpenHelpResponse {
    type: "open_help_response";
}

/**
 * Step 31, Forge's Settings page.
 *
 * The official's Customize rows hand off to the *host's* own UI, so there is no
 * official request to copy here -- Forge's Settings page is Forge's. What is
 * copied is the shape B3 asks for: a typed request with a closed set of values,
 * replacing `open_config_file {configType:"command:forge.openSettings"}`, which
 * let the webview name a VS Code command.
 *
 * The tab ids are the real ones from `components/settings/tabs`, and this list
 * is the single source of truth for them: `SettingsPage`'s `tabs` array and the
 * host's validation both read it, so a tab cannot exist on one side only.
 */
export const FORGE_SETTINGS_TABS = [
    "general",
    "models",
    "profiles",
    "plugins",
    "environments",
    "memory-and-rules",
    "permissions",
    "sandbox",
    "network",
    "hooks",
    "skills",
    // Forge-only: the CLI's subagents, listed and created from Settings.
    "agents",
    "mcp-servers",
    "slash-commands",
    // Forge-only, from the endpoints line: `SettingsPage` renders an Endpoints
    // tab, so it belongs in the closed set too. Left out, the "/" Endpoints row
    // would validate as unknown and fall back to General.
    "endpoints",
] as const;

export type ForgeSettingsTab = (typeof FORGE_SETTINGS_TABS)[number];

export const isForgeSettingsTab = (value: unknown): value is ForgeSettingsTab =>
    typeof value === "string" && (FORGE_SETTINGS_TABS as readonly string[]).includes(value);

export interface OpenForgeSettingsRequest {
    type: "open_forge_settings";
    /** Omitted, or anything not in `FORGE_SETTINGS_TABS`, opens General. */
    tab?: string;
}

export interface OpenForgeSettingsResponse {
    type: "open_forge_settings_response";
    /** The tab actually opened, so the caller can see a fallback happen. */
    tab: ForgeSettingsTab;
}

/**
 * Host → Settings page push: select this tab. Sent when `open_forge_settings`
 * reveals a Settings panel that is **already open** -- a new panel gets its tab
 * from the bootstrap instead.
 */
export interface SelectSettingsTabRequest {
    type: "select_settings_tab";
    tab: ForgeSettingsTab;
}

/**
 * Step 30, Focus view. The official sender (`index.js` @3324257) patches its
 * own config first, so the toggle flips without waiting for the host:
 *
 *   async setFocusView($){let J=this.config.value;
 *     if(J)this.config.value={...J,focusViewEnabled:$};
 *     await this.sendRequest({type:"set_focus_view",enabled:$})}
 *
 * and the handler (`extension.js` @3115148) is:
 *
 *   async setFocusView($){return await this.settings.setFocusView($),
 *     this.syncFocusViewToChannels($),this.pushStateUpdate(),
 *     {type:"set_focus_view_response"}}
 *
 * Not channel-scoped: it is a window-wide preference that is then pushed to
 * every running channel as the `viewMode` flag setting.
 */
export interface SetFocusViewRequest {
    type: "set_focus_view";
    enabled: boolean;
}

export interface SetFocusViewResponse {
    type: "set_focus_view_response";
}

/**
 * Step 28, the three browser requests. The official senders (`index.js`
 * @3316158) and handlers (`extension.js` @3064039):
 *
 *   ensureChromeMcpEnabled($){return this.sendRequest({type:"ensure_chrome_mcp_enabled"},$)}
 *   disableChromeMcp($){return this.sendRequest({type:"disable_chrome_mcp"},$)}
 *   createNewBrowserTab(){return this.sendRequest({type:"create_new_browser_tab"})}
 *
 * The first two are **channel-scoped** (`$` is the channelId, and the host
 * throws `channelId is required for …` without one); `create_new_browser_tab`
 * is not, because it opens its own MCP connection rather than using the
 * session's query.
 *
 * None of the three carries a payload: the server key, its command and its
 * arguments are the host's, never the webview's (B3).
 */
export interface EnsureChromeMcpEnabledRequest {
    type: "ensure_chrome_mcp_enabled";
}

export interface EnsureChromeMcpEnabledResponse {
    type: "ensure_chrome_mcp_enabled_response";
    /**
     * The official `wasDisabled`: whether the browser MCP was *not* connected
     * before this call. The webview uses it to decide whether the turn needs
     * the `<browser_instruction>` block, so it is only true the first time.
     */
    wasDisabled: boolean;
}

export interface DisableChromeMcpRequest {
    type: "disable_chrome_mcp";
}

export interface DisableChromeMcpResponse {
    type: "disable_chrome_mcp_response";
    /**
     * The official `wasEnabled`: whether it had been connected. When it was, the
     * host also enqueues the synthetic "[Browser disconnected: …]" user message,
     * so the model stops offering browser tools mid-session.
     */
    wasEnabled: boolean;
}

export interface CreateNewBrowserTabRequest {
    type: "create_new_browser_tab";
}

export interface CreateNewBrowserTabResponse {
    type: "create_new_browser_tab_response";
    /** The official fields, from `tabs_context_mcp {createIfEmpty:true}`. */
    tabGroupId: string;
    tabId: number;
}

/**
 * The official `session_states_update` push (`sendSessionStates($,Q,X,J,Y)`):
 *
 *   {type:"session_states_update", sessions, activeSessionId,
 *    openSessionIds, unreadSessionKeys, liveElsewhereSessions}
 *
 * It is the feed the sessions list's status dot reads. Until `unreadSessionKeys`
 * arrives the webview shows no dot at all (`a6` returns undefined while every
 * set is undefined), which is why the host pushes it on `init`.
 *
 * Forge fills `openSessionIds` from the channels the host is actually running,
 * which is the single-window equivalent of the official's `sessionPanels`.
 * `sessions` (the per-tab state list) and `liveElsewhereSessions` are
 * multi-surface features Forge has no second surface for, so they are omitted.
 */
export interface SessionStatesUpdateRequest {
    type: "session_states_update";
    /** The official per-tab state list. Forge has no session tabs; always empty. */
    sessions: unknown[];
    activeSessionId?: string;
    /** Session ids the host is currently running a channel for. */
    openSessionIds: string[];
    /** The host's unread set (`sessionUnread:<scope root>` in globalState). */
    unreadSessionKeys: string[];
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
        /**
         * The official adds `"browser"` (and `"terminal"`, which Forge has no
         * mentions for) alongside the file kinds: the `@` dropdown lists open
         * browser tabs as `browser:<group>:<id>:<url>` rows, so selecting one
         * writes a mention the `@browser` regex can parse (step 28).
         */
        type: "file" | "directory" | "browser";
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
/**
 * The editor the user is looking at, and what is highlighted in it.
 *
 * Shaped after the official host's `Ri(editor, redact)`: an empty selection is
 * still a selection -- it carries the file with `startLine === endLine` and
 * **no `selectedText`**. That absence is load-bearing. The message builder
 * branches on it to choose between `<ide_selection>` and `<ide_opened_file>`,
 * so a cursor sitting in a file is how "the file I have open" reaches the
 * model at all.
 */
export interface SelectionRange {
    /** The official uses `document.fileName`, not `uri.fsPath`. */
    filePath: string;
    /** The official's `sourceUri`: `document.uri.toString()`. */
    sourceUri?: string;
    startLine: number;
    endLine: number;
    startColumn?: number;
    endColumn?: number;
    /** Absent when nothing is highlighted -- not `""`. See above. */
    selectedText?: string;
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
 * One of the endpoint tools, named by what it does rather than by a command id.
 *
 * Forge-only: the official has no endpoint concept, so there is no request to
 * copy. The shape follows the rule the official's own handlers follow and that
 * B3 states outright -- the webview must not name what the host executes. It
 * names an action from a closed set; the host owns the mapping to a command.
 *
 * Every one of these opens a picker, a report or a probe. None writes without
 * confirming first: `add` asks five questions and then a save destination.
 */
export type EndpointAction =
    | "select"
    | "add"
    | "edit"
    | "status"
    | "diagnostics"
    | "capabilities"
    | "models";

export interface RunEndpointActionRequest {
    type: "run_endpoint_action";
    action: EndpointAction;
}

export interface RunEndpointActionResponse {
    type: "run_endpoint_action_response";
}

/**
 * The Settings page's create and add buttons, on `run_endpoint_action`'s rule:
 * the webview names an action, only these strings resolve, and the host names
 * the command. Each runs a short guided flow of native prompts and writes the
 * file the CLI reads. Forge-only; the official host has no equivalent.
 */
export type ForgeAction =
    | "create-skill"
    | "add-skill"
    | "create-agent"
    | "add-mcp-server";

export interface RunForgeActionRequest {
    type: "run_forge_action";
    action: ForgeAction;
}

export interface RunForgeActionResponse {
    type: "run_forge_action_response";
}

/** What the Skills and Agents tabs list. */
export type ForgeItemKind = "skills" | "agents";

export interface ForgeItemEntry {
    kind: ForgeItemKind;
    name: string;
    description: string;
    /** `project`: the workspace's `.claude/`; `user`: the CLI's config home. */
    scope: "user" | "project";
    /** The file to open: a skill's SKILL.md, an agent's .md. */
    path: string;
}

export interface ListForgeItemsRequest {
    type: "list_forge_items";
    kind: ForgeItemKind;
}

export interface ListForgeItemsResponse {
    type: "list_forge_items_response";
    items: ForgeItemEntry[];
}

/**
 * What one model id did when the endpoint was actually asked to serve it.
 *
 * Produced by `probeOne` in `services/endpoints/check.ts` -- one real
 * `max_tokens: 4` completion, not a listing. Being listed is not being
 * servable: of 101 ids one NVIDIA account listed, 28 answered, 60 returned
 * 404, 10 accepted the request and never replied, and 3 errored.
 */
export interface ModelHealth {
    id: string;
    servable: boolean;
    /** Round-trip of the probe completion, ms. */
    ms: number;
    /** Why not, when not. Already produced (and truncated) by `probeOne`. */
    detail?: string;
    /** Epoch ms of the probe that produced this. */
    checkedAt: number;
}

/**
 * One endpoint profile's health, as last measured from *this* machine.
 *
 * Forge-only: the official extension has no endpoint concept, so there is no
 * request, response or record here to copy from `extension.js` (B1 does not
 * apply). The shape follows `run_endpoint_action`'s rule instead -- the webview
 * names a profile from a set the host already knows, never a URL or a command.
 */
export interface EndpointHealth {
    profileName: string;
    /** Epoch ms of the last completed sweep; `undefined` if never swept. */
    lastSyncedAt?: number;
    /** Set when the sweep could not start at all (auth, DNS, TLS). */
    error?: string;
    /** How many ids the gateway listed, before probing. */
    listed: number;
    models: ModelHealth[];
    /**
     * This is the profile `forge.endpointProfile` selects. Runtime only: which
     * profile is active is a setting, not something a sweep measured, and
     * storing it would let a stale record claim an endpoint is in use.
     */
    active?: boolean;
    /** A sweep is running right now. Runtime only -- never stored. */
    syncing?: boolean;
    /** Progress of the running sweep: probes finished, probes planned. */
    checked?: number;
    total?: number;
}

/**
 * Read the stored verdicts. Pure: never probes, never touches the network.
 *
 * `profileName` narrows to one profile and is validated against
 * `listProfiles()` host-side (B3) -- an unknown name is rejected, not coerced.
 */
export interface GetEndpointHealthRequest {
    type: "get_endpoint_health";
    profileName?: string;
}

export interface GetEndpointHealthResponse {
    type: "get_endpoint_health_response";
    health: EndpointHealth[];
}

/**
 * Sweep now: list the gateway's models, probe them, store what answered.
 *
 * Every probe is a billable completion, so this is only ever user-initiated or
 * on the `forge.endpointHealth.syncIntervalMinutes` timer. `cancel: true`
 * aborts the sweep in flight and answers with the verdicts as they stand.
 */
export interface SyncEndpointHealthRequest {
    type: "sync_endpoint_health";
    profileName?: string;
    cancel?: boolean;
}

export interface SyncEndpointHealthResponse {
    type: "sync_endpoint_health_response";
    health: EndpointHealth[];
}

/**
 * The host pushing health as it changes, so a sweep started in one surface
 * fills in the table in another without either of them polling.
 *
 * Modelled on the official `session_states_update` push, which is the only
 * shape in this protocol for "the host has news": a `request` with no response,
 * on the empty channel.
 */
export interface EndpointHealthUpdateRequest {
    type: "endpoint_health_update";
    health: EndpointHealth[];
}

/**
 * Bring the chat view forward, wherever it lives.
 *
 * Sent by the standalone sessions view, which is its own webview in its own
 * activity-bar container. Swapping that webview's page to the chat renders the
 * chat *inside the sessions container* -- on the left, in the activity bar,
 * instead of in the side bar the chat is configured to live in. The host owns
 * where the chat is, so the view asks rather than guesses.
 */
export interface RevealChatRequest {
    type: "reveal_chat";
    /** Start a new conversation once it is focused. */
    newConversation?: boolean;
}

export interface RevealChatResponse {
    type: "reveal_chat_response";
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
    /**
     * Why this command was flagged as risky, when it was (A3).
     *
     * Forge-only: the official host has no risk classifier. Present so the
     * dialog can say *what* is dangerous rather than only that something is —
     * "would remove ~/.ssh, a credential store" is actionable where a generic
     * warning is not. Absent for anything the classifier found unremarkable,
     * which is almost everything.
     */
    riskReason?: string;
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
    /**
     * `null` when no eligible editor is focused.
     *
     * This used to be `{start, end}` positions, which nothing could consume:
     * the webview feeds this straight into `appContext.currentSelection`, which
     * is a `SelectionRange` — so the receiver was wired to a payload the sender
     * would never have matched. The official fires its `Ri(...)` object here,
     * and so does Forge now.
     */
    selection: SelectionRange | null;
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
 * The official `session_renamed` push (Extension → WebView broadcast).
 *
 * `sendSessionRenamed($,J)` fans the capped title out to every open webview
 * after a rename lands on disk, and the webview's `sessionRenamedEvents` feed
 * `adoptPersistedTitle($,J)`. Forge has one webview, so this is the echo the
 * renaming window itself relies on when another surface (a VS Code command)
 * renames the session.
 */
export interface SessionRenamedRequest {
    type: "session_renamed";
    sessionId: string;
    title: string;
}

/**
 * 状态更新
 */
export interface UpdateStateRequest {
    type: "update_state";
    // 与 init_response.state 对齐，保证双方一致
    state: InitResponse['state'];
    /**
     * 后端下发的 Claude 配置对象. Optional, as the official's is: its receiver
     * keeps the config it has when a push carries none (`WA0(current, config)`).
     */
    config?: GetClaudeStateResponse['config'];
}

/**
 * The official `sendSessionStoreChanged()`:
 *
 *   {type:"request",channelId:"",requestId:l8(),request:{type:"session_store_changed"}}
 *
 * and its receiver, `case"session_store_changed":this.sessionStoreChanges.value++`,
 * which an effect turns into `listSessionsAfterInFlight("store_sync")`. No
 * payload: it only says the list on disk is not the list on screen. Forge
 * sends it when a transcript appears or disappears in the project's store, and
 * when a new conversation's id first becomes known.
 */
export interface SessionStoreChangedRequest {
    type: "session_store_changed";
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
    | RenameSessionRequest
    | ArchiveSessionRequest
    | UnarchiveSessionRequest
    | SetSessionUnreadRequest
    | RewindCodeRequest
    | ForkConversationRequest
    | EnsureChromeMcpEnabledRequest
    | DisableChromeMcpRequest
    | CreateNewBrowserTabRequest
    | GetOutputStyleRequest
    | GetOutputStyleLocationsRequest
    | CreateOutputStyleRequest
    | SetFocusViewRequest
    | OpenForgeSettingsRequest
    | OpenConfigRequest
    | OpenHelpRequest
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
    | RunEndpointActionRequest
    | RunForgeActionRequest
    | ListForgeItemsRequest
    | GetEndpointHealthRequest
    | SyncEndpointHealthRequest
    | RevealChatRequest
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
    | RenameSessionResponse
    | ArchiveSessionResponse
    | UnarchiveSessionResponse
    | SetSessionUnreadResponse
    | RewindCodeResponse
    | ForkConversationResponse
    | EnsureChromeMcpEnabledResponse
    | DisableChromeMcpResponse
    | CreateNewBrowserTabResponse
    | GetOutputStyleResponse
    | GetOutputStyleLocationsResponse
    | CreateOutputStyleResponse
    | SetFocusViewResponse
    | OpenForgeSettingsResponse
    | OpenConfigResponse
    | OpenHelpResponse
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
    | RunEndpointActionResponse
    | RunForgeActionResponse
    | ListForgeItemsResponse
    | GetEndpointHealthResponse
    | SyncEndpointHealthResponse
    | RevealChatResponse
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
    | SessionStoreChangedRequest
    | VisibilityChangedRequest
    | SessionRenamedRequest
    | SessionStatesUpdateRequest
    | EndpointHealthUpdateRequest
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
    | "new_conversation"
    /**
     * Put the welcome page up, whatever the model list says.
     *
     * The page normally appears on its own when there is nothing to talk to.
     * This is the way to look at it deliberately -- from the palette, or to
     * reach the setup flow again without emptying the model list first.
     */
    | "show_welcome";

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
