/**
 * Claude Agent Handlers - 统一处理器文件
 *
 * 职责：处理所有来自 WebView 的请求
 * 依赖：通过 HandlerContext 注入所有服务
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { INTERACTIVE_CONCURRENCY, type EndpointHealth } from '../../endpoints/health';
import { profileModelRows, type SdkModelRow } from '../../endpoints/models';
import * as fs from 'fs';
import * as os from 'os';
import type {
    GetEndpointHealthRequest,
    GetEndpointHealthResponse,
    SyncEndpointHealthRequest,
    SyncEndpointHealthResponse,
    EndpointHealth as EndpointHealthDto,
    InitRequest,
    InitResponse,
    GetClaudeStateRequest,
    GetClaudeStateResponse,
    ClaudeConfig,
    GetMcpServersRequest,
    GetMcpServersResponse,
    GetAssetUrisRequest,
    GetAssetUrisResponse,
    OpenFileRequest,
    OpenFileResponse,
    GetCurrentSelectionResponse,
    ShowNotificationRequest,
    ShowNotificationResponse,
    NewConversationTabRequest,
    NewConversationTabResponse,
    RenameTabRequest,
    RenameTabResponse,
    OpenDiffRequest,
    OpenDiffResponse,
    ListSessionsRequest,
    ListSessionsResponse,
    RenameSessionRequest,
    RenameSessionResponse,
    ArchiveSessionRequest,
    ArchiveSessionResponse,
    UnarchiveSessionRequest,
    UnarchiveSessionResponse,
    SetSessionUnreadRequest,
    SetSessionUnreadResponse,
    GetSessionRequest,
    GetSessionResponse,
    ExecRequest,
    ExecResponse,
    ListFilesRequest,
    ListFilesResponse,
    StatPathRequest,
    StatPathResponse,
    OpenContentRequest,
    OpenContentResponse,
    OpenURLRequest,
    OpenURLResponse,
    // GetAuthStatusRequest,
    // GetAuthStatusResponse,
    // LoginRequest,
    // LoginResponse,
    // SubmitOAuthCodeRequest,
    // SubmitOAuthCodeResponse,
    OpenConfigFileRequest,
    OpenConfigFileResponse,
    OpenClaudeInTerminalRequest,
    OpenClaudeInTerminalResponse,
    GetSettingsRequest,
    GetSettingsResponse,
    UpdateSettingRequest,
    UpdateSettingResponse,
    ResetSettingRequest,
    ResetSettingResponse,
    SwitchProfileRequest,
    SwitchProfileResponse,
    CreateProfileRequest,
    CreateProfileResponse,
    DeleteProfileRequest,
    DeleteProfileResponse,
    GetExtensionConfigRequest,
    GetExtensionConfigResponse,
    UpdateExtensionConfigRequest,
    UpdateExtensionConfigResponse,
    SdkProbeRequest,
    SdkProbeResponse
} from '../../../shared/messages';
import type { HandlerContext } from './types';
import type { PermissionMode, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { AsyncStream } from '../transport/AsyncStream';
import { reviewProposedDiff, closeDiffEditor } from '../../diff/proposedDiff';
import {
    INVALID_REQUEST_MESSAGE,
    buildCommandLine,
    detectWindowsShell,
    isTerminalLocation,
    isValidOpenClaudeInTerminalRequest,
    quoteExecutable,
    readDefaultProfile,
    shouldDisposeAfterExecution,
    terminalPlacement,
    type WindowsShellKind
} from '../terminalLaunch';
import { readClaudeSettings, toClaudeSettingsSnapshot } from '../claudeSettings';
import { attachSessionPermissionModes, initialPermissionModeFrom, validSessionId } from '../sessionPermissionModes';
import { plannedRename } from '../sessionIdentity';
/**
 * 初始化请求
 */
export async function handleInit(
    _request: InitRequest,
    context: HandlerContext
): Promise<InitResponse> {
    const { configService, workspaceService, logService, agentService } = context;

    logService.info('[handleInit] 处理初始化请求');

    // TODO: 从 AuthManager 获取认证状态
    // const authStatus = null;

    // 获取模型设置（读 CLI settings.json 的 'model' 字段，与 Settings 页 Model Manage 一致）
    const modelSetting = (await configService.getSetting<string>('model')) || 'default';

    // 获取默认工作目录
    const defaultCwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();

    // TODO: 从配置获取 openNewInTab
    const openNewInTab = false;

    // The official `thinkingLevel: this.settings.getThinkingLevel()`: the
    // persisted level (globalState), "default_on" when nothing is stored.
    const thinkingLevel = context.sdkService.getThinkingLevel();

    // The official `initialPermissionMode: this.settings.getInitialPermissionMode()`
    // and `allowDangerouslySkipPermissions`: new sessions start in the first, and a
    // stored bypass is restored only with the second (step 18).
    const allowDangerouslySkipPermissions = context.sdkService.getAllowDangerouslySkipPermissions();
    const { defaultPermissionMode } = await configService.getExtensionConfig();
    const initialPermissionMode = initialPermissionModeFrom(defaultPermissionMode, allowDangerouslySkipPermissions);

    // The official `onClientInit = () => { this.broadcastSessionStates(); … }`:
    // until the feed arrives the sessions list shows no status dot at all.
    agentService.sendSessionStates();

    return {
        type: "init_response",
        state: {
            defaultCwd,
            openNewInTab,
            // authStatus,
            modelSetting,
            platform: process.platform,
            thinkingLevel,
            ...(initialPermissionMode !== undefined && { initialPermissionMode }),
            allowDangerouslySkipPermissions,
            ...endpointGateState(context)
        }
    };
}

/**
 * What the welcome gate needs, on the handshake.
 *
 * Three counts rather than one boolean, because the gate has three states and
 * they offer different buttons: no profiles at all, profiles never checked, and
 * profiles checked with nothing answering. Reading the stored verdicts only --
 * a probe here would put a gateway round trip in front of the first paint.
 */
function endpointGateState(context: HandlerContext): {
    endpointProfileCount: number;
    endpointHealthyModelCount: number;
    endpointHealthCheckedProfileCount: number;
} {
    const { endpointService, endpointHealthService, logService } = context;
    try {
        const { profiles } = endpointService.listProfiles();
        const health = endpointHealthService.getAllHealth();
        return {
            endpointProfileCount: profiles.length,
            endpointHealthyModelCount: health.reduce(
                (n, h) => n + h.models.filter((m) => m.servable).length,
                0
            ),
            endpointHealthCheckedProfileCount: health.filter((h) => h.lastSyncedAt !== undefined).length
        };
    } catch (error) {
        // A broken profiles directory must not stop the webview initialising.
        logService.warn(`[health] could not read the gate state: ${error}`);
        return { endpointProfileCount: 0, endpointHealthyModelCount: 0, endpointHealthCheckedProfileCount: 0 };
    }
}

/**
 * 获取 Claude 状态
 */
export async function handleGetClaudeState(
    _request: GetClaudeStateRequest,
    context: HandlerContext
): Promise<GetClaudeStateResponse> {
    const { logService } = context;

    logService.info('[handleGetClaudeState] 获取 Claude 状态');

    const config = await loadConfig(context);

    return {
        type: "get_claude_state_response",
        config
    };
}

/**
 * 一次性 SDK 探测
 */
export async function handleSdkProbe(
    request: SdkProbeRequest,
    context: HandlerContext
): Promise<SdkProbeResponse> {
    const { sdkService, workspaceService } = context;
    const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();
    const result = await sdkService.probe({
        capabilities: request.capabilities ?? [],
        cwd,
        timeoutMs: request.timeoutMs
    });

    return {
        type: "sdk_probe_response",
        data: result.data,
        errors: result.errors
    };
}

/**
 * 获取 MCP 服务器
 */
export async function handleGetMcpServers(
    _request: GetMcpServersRequest,
    context: HandlerContext,
    channelId?: string
): Promise<GetMcpServersResponse> {
    return await getMcpServers(context, channelId);
}

/**
 * 获取资源 URI
 */
export async function handleGetAssetUris(
    _request: GetAssetUrisRequest,
    context: HandlerContext
): Promise<GetAssetUrisResponse> {
    return {
        type: "asset_uris_response",
        assetUris: getAssetUris(context)
    };
}

/**
 * Handle get_settings request
 */
export async function handleGetSettings(
    _request: GetSettingsRequest,
    context: HandlerContext
): Promise<GetSettingsResponse> {
    // Use getAllSettings() for effective values — it deep-merges object-type settings
    // (env, permissions, etc.) across profile/default layers correctly.
    // inspectAll() provides per-key scope/layer metadata for UI rendering.
    const settings = await context.configService.getAllSettings();
    const detailedSettings = await context.configService.inspectAll();
    const metadata: any = {};

    for (const [key, inspection] of Object.entries(detailedSettings)) {
      metadata[key] = {
        effectiveScope: inspection.effectiveScope,
        values: inspection.values
      };
    }

    const activeProfile = context.configService.activeProfile;
    const profiles = await context.configService.getProfiles();

    return {
      type: 'get_settings_response',
      settings,
      metadata,
      activeProfile,
      profiles,
      hasWorkspace: context.configService.hasWorkspace
    };
  }

/**
 * Handle switch_profile request
 */
export async function handleSwitchProfile(
  request: SwitchProfileRequest,
  context: HandlerContext
): Promise<SwitchProfileResponse> {
  await context.configService.switchProfile(request.profile);
  return {
    type: 'switch_profile_response',
    success: true
  };
}

/**
 * Handle create_profile request
 */
export async function handleCreateProfile(
  request: CreateProfileRequest,
  context: HandlerContext
): Promise<CreateProfileResponse> {
  try {
    await context.configService.createProfile(request.name);
    return {
      type: 'create_profile_response',
      success: true
    };
  } catch (e: any) {
    return {
      type: 'create_profile_response',
      success: false,
      error: e.message
    };
  }
}

/**
 * Handle delete_profile request
 */
export async function handleDeleteProfile(
  request: DeleteProfileRequest,
  context: HandlerContext
): Promise<DeleteProfileResponse> {
  try {
    await context.configService.deleteProfile(request.name);
    return {
      type: 'delete_profile_response',
      success: true
    };
  } catch (e: any) {
    return {
      type: 'delete_profile_response',
      success: false,
      error: e.message
    };
  }
}

/**
 * Handle update_setting request
 */
export async function handleUpdateSetting(
    request: UpdateSettingRequest,
    context: HandlerContext
): Promise<UpdateSettingResponse> {
    // Default to 'global' if target not specified
    const target = request.target || 'global';
    await context.configService.updateSetting(request.key, request.value, target);
    return {
        type: "update_setting_response",
        success: true
    };
}

/**
 * Handle reset_setting request (delete value at a specific scope)
 */
export async function handleResetSetting(
    request: ResetSettingRequest,
    context: HandlerContext
): Promise<ResetSettingResponse> {
    await context.configService.resetSetting(request.key, request.target);
    return {
        type: "reset_setting_response",
        success: true
    };
}

/**
 * Handle get_extension_config request
 */
export async function handleGetExtensionConfig(
    _request: GetExtensionConfigRequest,
    context: HandlerContext
): Promise<GetExtensionConfigResponse> {
    const config = await context.configService.getExtensionConfig();
    return {
        type: 'get_extension_config_response',
        config
    };
}

/**
 * Handle update_extension_config request
 */
export async function handleUpdateExtensionConfig(
    request: UpdateExtensionConfigRequest,
    context: HandlerContext
): Promise<UpdateExtensionConfigResponse> {
    await context.configService.updateExtensionConfig(request.key as any, request.value);

    // Broadcast config change to all webviews (so chat page ModelSelect can refresh)
    pushToWebview(context, 'config-changed', {
        type: 'extension_config_changed',
        key: request.key,
        value: request.value,
    });

    return {
        type: 'update_extension_config_response',
        success: true
    };
}

/**
 * A host → webview push, shaped like the official's own
 * (`{type:"request",channelId:"",requestId:l8(),request}`): a request the
 * webview handles in `processRequest` and never answers.
 */
function pushToWebview(context: HandlerContext, tag: string, request: object): void {
    context.webViewService.postMessage({
        type: 'request',
        requestId: `${tag}-${Date.now()}`,
        request
    });
}

/**
 * 打开文件
 */
export async function handleOpenFile(
    request: OpenFileRequest,
    context: HandlerContext
): Promise<OpenFileResponse> {
    const { logService, workspaceService, fileSystemService } = context;
    const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();
    const { filePath, location } = request;

    try {
        const searchResults = await fileSystemService.findFiles(filePath, cwd);
        const resolvedPath = await fileSystemService.resolveExistingPath(filePath, cwd, searchResults);
        const stat = await fs.promises.stat(resolvedPath);
        const uri = vscode.Uri.file(resolvedPath);

        if (stat.isDirectory()) {
            await vscode.commands.executeCommand("revealInExplorer", uri);
            return { type: "open_file_response" };
        }

        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, { preview: false });

        if (location) {
            const startLine = Math.max((location.startLine ?? 1) - 1, 0);
            const endLine = Math.max((location.endLine ?? location.startLine ?? 1) - 1, startLine);
            const startColumn = Math.max(location.startColumn ?? 0, 0);
            const endColumn = Math.max(location.endColumn ?? startColumn, startColumn);

            const range = new vscode.Range(
                new vscode.Position(startLine, startColumn),
                new vscode.Position(endLine, endColumn)
            );

            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            editor.selection = new vscode.Selection(range.start, range.end);
        }

        return { type: "open_file_response" };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logService.error(`[handleOpenFile] 打开文件失败: ${errorMsg}`);
        throw new Error(`Failed to open file: ${errorMsg}`);
    }
}

/**
 * 获取当前编辑器选区
 */
export async function handleGetCurrentSelection(
    context: HandlerContext
): Promise<GetCurrentSelectionResponse> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty || editor.document.uri.scheme !== "file") {
        return {
            type: "get_current_selection_response",
            selection: null
        };
    }

    const document = editor.document;
    const selection = editor.selection;

    return {
        type: "get_current_selection_response",
        selection: {
            filePath: document.uri.fsPath,
            startLine: selection.start.line + 1,
            endLine: selection.end.line + 1,
            startColumn: selection.start.character,
            endColumn: selection.end.character,
            selectedText: document.getText(selection)
        }
    };
}

/**
 * 显示通知
 */
export async function handleShowNotification(
    request: ShowNotificationRequest,
    context: HandlerContext
): Promise<ShowNotificationResponse> {
    const { message, severity, buttons = [] } = request;

    let result: string | undefined;
    switch (severity) {
        case "error":
            result = await vscode.window.showErrorMessage(message, ...buttons);
            break;
        case "warning":
            result = await vscode.window.showWarningMessage(message, ...buttons);
            break;
        case "info":
        default:
            result = await vscode.window.showInformationMessage(message, ...buttons);
            break;
    }

    return {
        type: "show_notification_response",
        buttonValue: result
    };
}

/**
 * 新建会话标签页（聚焦侧边栏）
 */
export async function handleNewConversationTab(
    _request: NewConversationTabRequest,
    context: HandlerContext
): Promise<NewConversationTabResponse> {
    const { logService } = context;

    try {
        await vscode.commands.executeCommand("forge.chatView.focus");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logService.warn(`Failed to focus chat view: ${message}`);
    }
    return {
        type: "new_conversation_tab_response"
    };
}

/**
 * 重命名标签（目前仅占位）
 */
export async function handleRenameTab(
    _request: RenameTabRequest,
    context: HandlerContext
): Promise<RenameTabResponse> {
    return {
        type: "rename_tab_response"
    };
}

/**
 * 打开 Diff 编辑器
 */
export async function handleOpenDiff(
    request: OpenDiffRequest,
    context: HandlerContext,
    signal: AbortSignal
): Promise<OpenDiffResponse> {
    const { logService, workspaceService, fileSystemService } = context;
    const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();

    logService.info(`Opening diff for: ${request.originalFilePath}`);

    const originalPath = fileSystemService.resolveFilePath(request.originalFilePath, cwd);
    const fallbackNewPath = request.newFilePath ? fileSystemService.resolveFilePath(request.newFilePath, cwd) : undefined;

    if (signal.aborted) {
        return {
            type: "open_diff_response",
            newEdits: request.edits
        };
    }

    const rightPath = await prepareDiffRightFile(originalPath, fallbackNewPath, request.edits, context);

    const leftExists = await fileSystemService.pathExists(originalPath);
    const leftPath = leftExists
        ? originalPath
        : await fileSystemService.createTempFile(path.basename(request.originalFilePath || request.newFilePath || "untitled"), "");

    const leftUri = vscode.Uri.file(leftPath);
    const rightUri = vscode.Uri.file(rightPath);

    const diffTitle = `${path.basename(request.originalFilePath || request.newFilePath || rightPath)} (Forge)`;

    // Wait for the user to accept or reject from the editor title bar. The
    // response is how the decision reaches the CLI: the edits we return are the
    // ones it applies, so rejecting means returning none.
    const decision = await reviewProposedDiff(leftUri, rightUri, diffTitle, signal, logService);
    await closeDiffEditor(rightUri);

    return {
        type: "open_diff_response",
        newEdits: decision === "accept" ? request.edits : []
    };
}

/**
 * 列出历史会话
 *
 * The official `buildSessionList`: read the list through the SDK, flag the
 * archived ids from `hiddenSessionIds`, derive `worktree` / `isCurrentWorkspace`
 * from each session's cwd, then attach the stored permission modes.
 */
export async function handleListSessions(
    _request: ListSessionsRequest,
    context: HandlerContext
): Promise<ListSessionsResponse> {
    const { logService, sessionService, workspaceService } = context;

    try {
        const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();
        // `let z=new Set(this.settings.getArchivedSessionIds())`, then
        // `archived: z.has(U.sessionId)` on every row (step 21).
        const archivedIds = context.sdkService.getArchivedSessionStore().getArchivedSessionIdSet();
        const sessions = await sessionService.listSessions(cwd, archivedIds);

        // The official list: each session's stored mode as `permissionMode`,
        // except bypass while the CLI's settings disable it (step 18).
        const bypassDisabled =
            context.agentService.getCachedClaudeSettings()?.effective.permissions?.disableBypassPermissionsMode === 'disable';
        return {
            type: "list_sessions_response",
            sessions: attachSessionPermissionModes(
                sessions,
                context.sdkService.getSessionPermissionModeStore().getSessionPermissionModes(),
                bypassDisabled
            )
        };
    } catch (error) {
        logService.error(`Failed to list sessions: ${error}`);
        return {
            type: "list_sessions_response",
            sessions: []
        };
    }
}

/**
 * Rename a conversation (step 20).
 *
 * The official host:
 *
 *   async renameSession($,Q,X){ if(typeof $!=="string"||typeof Q!=="string")
 *                                 return {type:"rename_session_response",skipped:!0};
 *                               let J=GX(Q),
 *                                   z=await(await U6.load(this.cwd,this.logger)).renameSession($,J,X===!0);
 *                               if(!z) this.onSessionRenamed?.($,J), this.renameSessionOnCli($,J);
 *                               return {type:"rename_session_response",skipped:z} }
 *
 * Forge appends the same `custom-title` line through the SDK's `renameSession`
 * (sdk.d.ts:3029) and, when it lands, pushes `session_renamed` the way
 * `onSessionRenamed` does. `renameSessionOnCli` has no counterpart: the
 * installed SDK's `Query` has no `renameSession` (see `docs/sdk-upgrade.md`),
 * so a live CLI process learns the new title when it next resumes.
 */
export async function handleRenameSession(
    request: RenameSessionRequest,
    context: HandlerContext
): Promise<RenameSessionResponse> {
    const { logService, sessionService, workspaceService } = context;

    const planned = plannedRename(request.sessionId, request.title);
    if (!planned) {
        return { type: "rename_session_response", skipped: true };
    }

    try {
        const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();
        const skipped = await sessionService.renameSession(planned.sessionId, planned.title, cwd);
        if (!skipped) {
            pushToWebview(context, 'session-renamed', {
                type: 'session_renamed',
                sessionId: planned.sessionId,
                title: planned.title
            });
        }
        return { type: "rename_session_response", skipped };
    } catch (error) {
        logService.error(`Failed to rename session: ${error}`);
        return { type: "rename_session_response", skipped: true };
    }
}

/**
 * Archive a conversation (step 21).
 *
 *   async archiveSession($){ if(y0($)===null) return {type:"archive_session_response"};
 *                            return await this.settings.archiveSession($),
 *                                   {type:"archive_session_response"} }
 *
 * An id that is not a session id is ignored, and the bare response is returned
 * either way -- the official never errors here.
 */
export async function handleArchiveSession(
    request: ArchiveSessionRequest,
    context: HandlerContext
): Promise<ArchiveSessionResponse> {
    const id = validSessionId(request.sessionId);
    if (id === null) return { type: "archive_session_response" };
    try {
        await context.sdkService.getArchivedSessionStore().archiveSession(id);
    } catch (error) {
        context.logService.error(`Failed to archive session: ${error}`);
    }
    return { type: "archive_session_response" };
}

/**
 * Unarchive a conversation (step 21).
 *
 *   async unarchiveSession($){ if(y0($)===null) return {type:"unarchive_session_response"};
 *                              await this.settings.unarchiveSession($); … }
 *
 * The official then prunes the id out of its session groups. Session groups are
 * not in Forge's scope (`CLAUDE.md`), so there is no group to prune from; the
 * `sessionUnarchivedAt` stamp is still written, as the official writes it.
 */
export async function handleUnarchiveSession(
    request: UnarchiveSessionRequest,
    context: HandlerContext
): Promise<UnarchiveSessionResponse> {
    const id = validSessionId(request.sessionId);
    if (id === null) return { type: "unarchive_session_response" };
    try {
        await context.sdkService.getArchivedSessionStore().unarchiveSession(id);
    } catch (error) {
        context.logService.error(`Failed to unarchive session: ${error}`);
    }
    return { type: "unarchive_session_response" };
}

/**
 * Mark a conversation unread, or read (step 22).
 *
 * The base dispatcher answers a bare response
 * (`case"set_session_unread":return{type:"set_session_unread_response"}`); the
 * webview-provider subclass forwards it
 * (`this.onSetSessionUnread?.($.request.sessionKey, $.request.unread)`) to the
 * window manager's `setSessionUnread`, which writes `globalState` and then
 * `broadcastSessionStates()`. Forge does both here.
 *
 * `sessionKey` is validated as the official validates it — a 1..200 character
 * string (`bJ()`), not a UUID — because a remote key is `remote:<id>`.
 */
export async function handleSetSessionUnread(
    request: SetSessionUnreadRequest,
    context: HandlerContext
): Promise<SetSessionUnreadResponse> {
    try {
        const changed = await context.sdkService
            .getUnreadSessionStore()
            .setSessionUnread(request.sessionKey, request.unread);
        // `return this.broadcastSessionStates(), !0` -- only when it changed.
        if (changed) context.agentService.sendSessionStates();
    } catch (error) {
        context.logService.error(`Failed to set session unread: ${error}`);
    }
    return { type: "set_session_unread_response" };
}

/**
 * 获取会话详情
 */
export async function handleGetSession(
    request: GetSessionRequest,
    context: HandlerContext
): Promise<GetSessionResponse> {
    const { logService, sessionService, workspaceService } = context;

    try {
        const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();
        const messages = await sessionService.getSession(request.sessionId, cwd);

        return {
            type: "get_session_response",
            messages
        };
    } catch (error) {
        logService.error(`Failed to get session: ${error}`);
        return {
            type: "get_session_response",
            messages: []
        };
    }
}

/**
 * 执行命令
 */
export async function handleExec(
    request: ExecRequest,
    context: HandlerContext
): Promise<ExecResponse> {
    const { workspaceService } = context;
    const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();
    const { command, params } = request;

    return new Promise<ExecResponse>((resolve) => {
        const { spawn } = require('child_process');
        let stdout = "";
        let stderr = "";

        const proc = spawn(command, params, {
            cwd,
            shell: false
        });

        proc.stdout?.on("data", (data: Buffer) => {
            stdout += data.toString();
        });

        proc.stderr?.on("data", (data: Buffer) => {
            stderr += data.toString();
        });

        proc.on("close", (code: number) => {
            resolve({
                type: "exec_response",
                stdout,
                stderr,
                exitCode: code || 0
            });
        });

        proc.on("error", (error: Error) => {
            resolve({
                type: "exec_response",
                stdout: "",
                stderr: error.message,
                exitCode: 1
            });
        });
    });
}

/**
 * 列出文件
 */
export async function handleListFiles(
    request: ListFilesRequest,
    context: HandlerContext
): Promise<ListFilesResponse> {
    const { workspaceService, fileSystemService } = context;
    const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();

    return {
        type: "list_files_response",
        files: await fileSystemService.findFiles(request.pattern, cwd)
    };
}

/**
 * 统计路径类型（文件 / 目录 / 其它）
 */
export async function handleStatPath(
    request: StatPathRequest,
    context: HandlerContext
): Promise<StatPathResponse> {
    const { workspaceService, fileSystemService } = context;
    const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();
    const paths = Array.isArray(request.paths) ? request.paths : [];

    const entries: StatPathResponse["entries"] = [];

    for (const raw of paths) {
        if (!raw || typeof raw !== "string") {
            continue;
        }

        const absolute = fileSystemService.normalizeAbsolutePath(raw, cwd);

        try {
            const stat = await fs.promises.stat(absolute);
            let type: StatPathResponse["entries"][number]["type"] = "other";

            if (stat.isFile()) type = "file";
            else if (stat.isDirectory()) type = "directory";

            entries.push({ path: raw, type });
        } catch {
            entries.push({ path: raw, type: "not_found" });
        }
    }

    return {
        type: "stat_path_response",
        entries
    };
}

/**
 * 打开内容（临时文件编辑）
 */
export async function handleOpenContent(
    request: OpenContentRequest,
    context: HandlerContext,
    signal: AbortSignal
): Promise<OpenContentResponse> {
    const { logService, fileSystemService } = context;
    const { content, fileName, editable } = request;

    logService.info(`Opening content as: ${fileName} (editable: ${editable})`);

    if (!editable) {
        const document = await vscode.workspace.openTextDocument({
            content,
            language: detectLanguage(fileName)
        });
        await vscode.window.showTextDocument(document, { preview: true });

        return {
            type: "open_content_response"
        };
    }

    const tempPath = await fileSystemService.createTempFile(fileName || "claude.txt", content);
    const tempUri = vscode.Uri.file(tempPath);
    const document = await vscode.workspace.openTextDocument(tempUri);
    await vscode.window.showTextDocument(document, { preview: false });

    const updatedContent = await waitForDocumentEdits(document, signal);

    return {
        type: "open_content_response",
        updatedContent
    };
}

/**
 * 打开 URL
 */
export async function handleOpenURL(
    request: OpenURLRequest,
    context: HandlerContext
): Promise<OpenURLResponse> {
    const { url } = request;

    try {
        await vscode.env.openExternal(vscode.Uri.parse(url));
        return { type: "open_url_response" };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to open URL: ${errorMsg}`);
    }
}

/**
 * 获取认证状态
 */
// export async function handleGetAuthStatus(
//     _request: GetAuthStatusRequest,
//     context: HandlerContext
// ): Promise<GetAuthStatusResponse> {
//     // TODO: 实现认证状态获取
//     // const status = authManager?.getAuthStatus();

//     return {
//         type: "get_auth_status_response",
//         status: null
//     };
// }

/**
 * 登录
 */
// export async function handleLogin(
//     request: LoginRequest,
//     context: HandlerContext
// ): Promise<LoginResponse> {
//     const { logService, agentService } = context;
//     const { method } = request;

//     // TODO: 实现认证流程
//     logService.info(`Login requested with method: ${method}`);

//     // 关闭所有现有通道
//     await agentService.closeAllChannelsWithCredentialChange();

//     return {
//         type: "login_response",
//         auth: {
//             authenticated: false
//         }
//     };
// }

/**
 * 提交 OAuth 代码
 */
// export async function handleSubmitOAuthCode(
//     request: SubmitOAuthCodeRequest,
//     context: HandlerContext
// ): Promise<SubmitOAuthCodeResponse> {
//     const { logService } = context;
//     const { code } = request;

//     // TODO: 实现 OAuth 代码提交
//     logService.info(`OAuth code submitted: ${code.substring(0, 10)}...`);

//     return {
//         type: "submit_oauth_code_response"
//     };
// }

/**
 * 打开配置文件
 */
export async function handleOpenConfigFile(
    request: OpenConfigFileRequest,
    context: HandlerContext
): Promise<OpenConfigFileResponse> {
    const { configType } = request;

    try {
        // A Forge command the webview may trigger (command menu rows). Allow-listed:
        // the webview is not a general command runner.
        if (configType.startsWith("command:")) {
            const command = configType.slice("command:".length);
            const allowed = new Set(["forge.openSettings", "forge.showLogs", "forge.newConversation"]);
            if (!allowed.has(command)) {
                throw new Error(`Command not allowed from the webview: ${command}`);
            }
            await vscode.commands.executeCommand(command);
        }
        // VS Code 设置
        else if (configType === "vscode") {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'forge');
        }
        // "Set up an endpoint": profiles are YAML files in a folder, so this
        // opens a filled-in template the user saves into it. An untitled
        // document rather than a written file, because writing a half-finished
        // profile into the folder would make it load and fail on the next
        // sweep -- and because this has to work on remote and WSL, where
        // revealing a local path does not.
        else if (configType === "endpoints") {
            await openEndpointTemplate(context);
        }
        // 用户配置文件
        else {
            const configPath = getConfigFilePath(configType);
            const uri = vscode.Uri.file(configPath);
            await vscode.window.showTextDocument(uri);
        }

        return { type: "open_config_file_response" };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to open config file: ${errorMsg}`);
    }
}

/**
 * 在终端打开 Claude
 *
 * The official `case"open_claude_in_terminal"`: validate with `JI0`, then run
 * `claude-vscode.terminal.open`, whose body is `Qd0`. Ported here, with Forge's
 * bundled binary in place of the official's PATH lookup -- see
 * `terminalLaunch.ts` for why, and for the pure half of this.
 */
export async function handleOpenClaudeInTerminal(
    request: OpenClaudeInTerminalRequest,
    context: HandlerContext
): Promise<OpenClaudeInTerminalResponse> {
    const { logService, sdkService, terminalService } = context;

    // JI0. The webview is untrusted: nothing but a bare slash command and
    // `--resume <session id>` reaches a shell.
    if (!isValidOpenClaudeInTerminalRequest(request)) {
        throw new Error(INVALID_REQUEST_MESSAGE);
    }
    // The official command registration drops an unrecognised location rather
    // than failing: `U = $d0(W) ? W : void 0`.
    const location = isTerminalLocation(request.location) ? request.location : undefined;

    logService.info("Creating new Claude terminal");

    // The same native binary a session launches, quoted for the shell the
    // default profile will actually start.
    const executable = sdkService.resolveClaudeExecutablePath();
    const shell = process.platform === "win32" ? detectDefaultWindowsShell() : "unknown";
    const commandLine = buildCommandLine(
        quoteExecutable(process.platform, executable, shell),
        request.args ?? [],
        request.prompt
    );

    const placement = terminalPlacement(location);
    const terminal = terminalService.createTerminal({
        // The official reads the CLI's own title variable first.
        name: process.env.CLAUDE_CODE_TERMINAL_TITLE || "Forge",
        iconPath: vscode.Uri.file(sdkService.asAbsolutePath(path.join("resources", "forge-logo.svg"))),
        location:
            placement === "beside"
                ? { viewColumn: vscode.ViewColumn.Beside }
                : placement === "one"
                  ? { viewColumn: vscode.ViewColumn.One }
                  : undefined,
        isTransient: true,
        // cmd.exe must not resolve an executable out of the working directory.
        env: { NoDefaultCurrentDirectoryInExePath: "1" }
    });

    // Ya$: close the terminal again once the command it exists for has finished.
    const endedListener = vscode.window.onDidEndTerminalShellExecution((event) => {
        if (
            event.terminal === terminal &&
            shouldDisposeAfterExecution(event.execution.commandLine.value, commandLine, event.exitCode)
        ) {
            logService.info(`Claude terminal closed after executing ${event.execution.commandLine.value}`);
            terminal.dispose();
        }
    });

    // Shell integration if it arrives, a plain sendText after 3s if it does not.
    let started = false;
    const integrationListener = vscode.window.onDidChangeTerminalShellIntegration((event) => {
        if (event.terminal === terminal && !started) {
            started = true;
            logService.info("Terminal shell integration available");
            event.shellIntegration.executeCommand(commandLine);
        }
    });
    setTimeout(() => {
        if (!terminal.shellIntegration && !started) {
            started = true;
            terminal.sendText(commandLine);
        }
    }, 3000);

    const closedListener = vscode.window.onDidCloseTerminal((closed) => {
        if (closed === terminal) {
            endedListener.dispose();
            integrationListener.dispose();
            closedListener.dispose();
        }
    });

    terminal.show();
    if (location === "window") {
        await vscode.commands.executeCommand("workbench.action.moveEditorToNewWindow");
    }

    return { type: "open_claude_in_terminal_response" };
}

/**
 * `el0` + `Qa$`: which shell `terminal.integrated.defaultProfile.windows` starts.
 * Only Windows needs this -- elsewhere POSIX quoting is correct for every shell.
 */
function detectDefaultWindowsShell(): WindowsShellKind {
    const configuration = vscode.workspace.getConfiguration("terminal.integrated");
    const defaultProfile = configuration.get("defaultProfile.windows") ?? undefined;
    const { profileSource, profilePath, suppressBuiltinName } = readDefaultProfile(
        configuration.get("profiles.windows"),
        typeof defaultProfile === "string" ? defaultProfile : undefined
    );
    return detectWindowsShell({
        profileName: defaultProfile,
        profileSource,
        profilePath,
        suppressBuiltinName,
        envShell: vscode.env.shell
    });
}

// ============================================================================
// 配置和状态管理
// ============================================================================

/**
 * 加载配置缓存
 */
async function loadConfig(context: HandlerContext): Promise<ClaudeConfig> {
    const { logService, sdkService, workspaceService } = context;

    logService.info("Loading config cache by launching Claude...");

    const inputStream = new AsyncStream<SDKUserMessage>();
    const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();

    const query = await sdkService.query({
        inputStream,
        resume: null,
        canUseTool: async () => ({
            behavior: "deny" as const,
            message: "Config loading only"
        }),
        model: "default",
        cwd,
        permissionMode: "default",
        // The official config probe launches with thinking disabled.
        thinking: { type: "disabled" }
    });

    inputStream.done();

    // The official config probe reads the initialize response itself
    // (`initializationResult()`, `sdk.d.ts` L2769) and the webview takes
    // `claudeConfig.models` and `claudeConfig.unavailable_models` straight from
    // it. `supportedModels()` is `models` alone, so it would lose the greyed rows.
    const init = await query.initializationResult();
    const unavailable = (init as { unavailable_models?: unknown }).unavailable_models;

    // When a profile is active the CLI's model list describes Anthropic's
    // tiers, which this gateway does not serve. Replace it with what the
    // gateway answered for. B7: the picker changes, not just its label.
    const endpointRows = await endpointModelRows(context).catch((error) => {
        logService.warn(`[health] could not build endpoint model rows: ${error}`);
        return undefined;
    });

    const config: ClaudeConfig = {
        // Official field name: the CLI's initialize response carries `commands`
        // (SDKControlInitializeResponse), which the official webview reads as
        // `claudeConfig.commands`. `supportedCommands()` returns that same list.
        commands: await query.supportedCommands?.() || [],
        // In the CLI's order, every field as sent -- unless a profile is
        // active, in which case the gateway's answered models replace them.
        models: (endpointRows?.rows as ClaudeConfig['models'] | undefined) ?? init.models ?? [],
        // `@internal` in the CLI's schema, so absent from the typings; the CLI
        // omits the key when there is nothing to grey out, and so does Forge.
        ...(Array.isArray(unavailable) && unavailable.length > 0
            ? { unavailable_models: unavailable as ClaudeConfig['models'] }
            : {}),
        accountInfo: await (query as any).accountInfo?.() || null
    };

    // The official config probe also reads `getSettings()` and keeps it as
    // `claudeSettings`: the effort control seeds from `applied`, and Ultracode
    // is gated on `effective.disableWorkflows`.
    try {
        const claudeSettings = toClaudeSettingsSnapshot(await readClaudeSettings(query));
        if (claudeSettings) config.claudeSettings = claudeSettings;
        // The official keeps this read as `cachedClaudeSettings` (the bypass gate).
        context.agentService.noteClaudeSettings(claudeSettings);
    } catch (error) {
        logService.warn(`Failed to read Claude settings on the config probe: ${error}`);
    }

    logService.info(`  - Config: [${JSON.stringify(config)}]`);
    await query.return?.();

    return config;
}

/**
 * 获取 MCP 服务器状态
 */
async function getMcpServers(
    context: HandlerContext,
    channelId?: string
): Promise<GetMcpServersResponse> {
    const { logService, agentService } = context;

    if (!channelId) {
        throw new Error('Channel ID is required');
    }

    // TODO: 通过 agentService 获取 channel
    // const channel = agentService.getChannel(channelId);

    try {
        return {
            type: "get_mcp_servers_response",
            // mcpServers: await channel.query.mcpServerStatus?.() || []
            mcpServers: []
        };
    } catch (error) {
        logService.error(`Error fetching MCP servers: ${error}`);
        return {
            type: "get_mcp_servers_response",
            mcpServers: []
        };
    }
}

/**
 * 获取资源 URI
 */
function getAssetUris(context: HandlerContext): Record<string, { light: string; dark: string }> {
    const { webViewService } = context;
    const webview = webViewService.getWebView();

    if (!webview) {
        return {};
    }

    // The Forge mark, with the brand fill baked in: these URIs are consumed as
    // <img src>, where currentColor has nothing to inherit and renders black.
    const assets = {
        forge: {
            light: path.join("resources", "forge-logo-brand.svg"),
            dark: path.join("resources", "forge-logo-brand.svg")
        }
    } as const;

    // TODO: 获取 extensionPath
    const extensionPath = process.cwd();

    const toWebviewUri = (relativePath: string) =>
        webview.asWebviewUri(
            vscode.Uri.file(path.join(extensionPath, relativePath))
        ).toString();

    return Object.fromEntries(
        Object.entries(assets).map(([key, value]) => [
            key,
            {
                light: toWebviewUri(value.light),
                dark: toWebviewUri(value.dark)
            }
        ])
    );
}

// ============================================================================
// 辅助方法
// ============================================================================

async function prepareDiffRightFile(
    originalPath: string,
    fallbackPath: string | undefined,
    edits: OpenDiffRequest["edits"],
    context: HandlerContext
): Promise<string> {
    let baseContent = "";

    if (await context.fileSystemService.pathExists(originalPath)) {
        baseContent = await fs.promises.readFile(originalPath, "utf8");
    } else if (fallbackPath && await context.fileSystemService.pathExists(fallbackPath)) {
        baseContent = await fs.promises.readFile(fallbackPath, "utf8");
    }

    let modified = baseContent;

    for (const edit of edits) {
        const oldString = edit.oldString ?? "";
        const newString = edit.newString ?? "";

        if (!oldString) {
            modified += newString;
            continue;
        }

        if (edit.replaceAll) {
            modified = modified.split(oldString).join(newString);
        } else {
            const index = modified.indexOf(oldString);
            if (index >= 0) {
                modified = `${modified.slice(0, index)}${newString}${modified.slice(index + oldString.length)}`;
            } else {
                modified += newString;
            }
        }
    }

    const baseName = path.basename(fallbackPath || originalPath || "claude.diff");
    const outputName = baseName.endsWith(".claude") ? baseName : `${baseName}.claude`;

    return context.fileSystemService.createTempFile(outputName, modified);
}

async function waitForDocumentEdits(
    document: vscode.TextDocument,
    signal: AbortSignal
): Promise<string> {
    let currentText = document.getText();
    let resolved = false;

    return new Promise<string>((resolve) => {
        const disposables: vscode.Disposable[] = [];

        const cleanup = () => {
            if (!resolved) {
                resolved = true;
                disposables.forEach(d => d.dispose());
            }
        };

        disposables.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document.uri.toString() === document.uri.toString()) {
                    currentText = event.document.getText();
                }
            })
        );

        disposables.push(
            vscode.workspace.onDidSaveTextDocument(event => {
                if (event.uri.toString() === document.uri.toString()) {
                    currentText = event.getText();
                    cleanup();
                    resolve(currentText);
                }
            })
        );

        disposables.push(
            vscode.workspace.onDidCloseTextDocument(event => {
                if (event.uri.toString() === document.uri.toString()) {
                    cleanup();
                    resolve(currentText);
                }
            })
        );

        if (signal.aborted) {
            cleanup();
            resolve(currentText);
            return;
        }

        signal.addEventListener("abort", () => {
            cleanup();
            resolve(currentText);
        }, { once: true });
    });
}

function detectLanguage(fileName?: string): string {
    if (!fileName) {
        return "plaintext";
    }

    const ext = path.extname(fileName).toLowerCase();
    switch (ext) {
        case ".ts":
        case ".tsx":
            return "typescript";
        case ".js":
        case ".jsx":
            return "javascript";
        case ".json":
            return "json";
        case ".py":
            return "python";
        case ".java":
            return "java";
        case ".go":
            return "go";
        case ".rs":
            return "rust";
        case ".md":
            return "markdown";
        case ".sh":
            return "shellscript";
        case ".css":
            return "css";
        case ".html":
        case ".htm":
            return "html";
        default:
            return "plaintext";
    }
}

function getConfigFilePath(configType: string): string {
    const homeDir = os.homedir();

    switch (configType) {
        case "settings":
            return path.join(homeDir, ".claude", "settings.json");
        case "config":
            return path.join(homeDir, ".claude", "config.json");
        case "mcp-global":
            // Global MCP servers: ~/.claude.json (home directory root, NOT inside .claude/)
            return path.join(homeDir, ".claude.json");
        case "mcp-project": {
            // Project MCP servers: .mcp.json in workspace root
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                throw new Error("No workspace folder open");
            }
            return path.join(workspaceRoot, ".mcp.json");
        }
        default:
            return path.join(homeDir, ".claude", `${configType}.json`);
    }
}


// ============================================================================
// Endpoint health
// ============================================================================

/**
 * The stored verdicts, as the webview sees them.
 *
 * A straight field copy rather than a pass-through of the host record: the DTO
 * is the protocol and the record is a host type, and letting one become the
 * other by accident is how a `fingerprint` ends up in a webview.
 */
function toHealthDto(health: EndpointHealth): EndpointHealthDto {
    return {
        profileName: health.profileName,
        ...(health.lastSyncedAt !== undefined ? { lastSyncedAt: health.lastSyncedAt } : {}),
        ...(health.error ? { error: health.error } : {}),
        listed: health.listed,
        models: health.models.map((m) => ({
            id: m.id,
            servable: m.servable,
            ms: m.ms,
            ...(m.detail ? { detail: m.detail } : {}),
            checkedAt: m.checkedAt,
        })),
    };
}

/** Pure read of `globalState`. No probing, no network, safe to call on open. */
export async function handleGetEndpointHealth(
    request: GetEndpointHealthRequest,
    context: HandlerContext
): Promise<GetEndpointHealthResponse> {
    const { endpointHealthService } = context;
    const name = typeof request.profileName === 'string' ? request.profileName.trim() : '';
    if (name) {
        const one = endpointHealthService.getHealth(name);
        return { type: 'get_endpoint_health_response', health: one ? [toHealthDto(one)] : [] };
    }
    return {
        type: 'get_endpoint_health_response',
        health: endpointHealthService.getAllHealth().map(toHealthDto),
    };
}

/**
 * Sweep now, or cancel the sweep in flight.
 *
 * B3: `profileName` is validated against `listProfiles()` inside the health
 * service before it can reach a transport. An unknown name is an error, never
 * a silent fall back to the active profile -- the webview must not be able to
 * aim a sweep at something the host did not offer it.
 */
export async function handleSyncEndpointHealth(
    request: SyncEndpointHealthRequest,
    context: HandlerContext
): Promise<SyncEndpointHealthResponse> {
    const { endpointHealthService, logService } = context;
    const name = typeof request.profileName === 'string' ? request.profileName.trim() : '';

    if (request.cancel) {
        endpointHealthService.cancelSync(name || undefined);
        logService.info(`[health] sweep cancelled${name ? ` for "${name}"` : ''}`);
        return {
            type: 'sync_endpoint_health_response',
            health: endpointHealthService.getAllHealth().map(toHealthDto),
        };
    }

    // A button press is interactive: the user is watching, so probe harder than
    // a background sweep would.
    const options = { concurrency: INTERACTIVE_CONCURRENCY };
    if (name) {
        await endpointHealthService.syncProfile(name, options);
    } else {
        await endpointHealthService.syncAll(options);
    }
    return {
        type: 'sync_endpoint_health_response',
        health: endpointHealthService.getAllHealth().map(toHealthDto),
    };
}

/**
 * The picker's rows, when a profile is active.
 *
 * This is the point of the whole feature: the rows offered here are the models
 * that *answered a real request*, not the models a gateway listed. The two
 * differ by more than anyone expects -- 28 of 101 on the account measured in
 * `keepServable`'s docstring.
 *
 * Exactly one function feeds both `get_claude_state` and any later probe, on
 * purpose. Two copies of this rule would drift, and the drift would show up as
 * a picker offering a model the table calls dead.
 *
 * Returns `undefined` when no profile is active, which leaves the CLI's own
 * model list untouched -- Forge only replaces it when it knows better.
 */
export async function endpointModelRows(
    context: HandlerContext
): Promise<{ rows: SdkModelRow[]; source: string } | undefined> {
    const { endpointService, endpointHealthService, logService } = context;

    const health = endpointHealthService.getHealth();
    const served = await endpointService.servedModels(undefined, health);
    if (!served) return undefined;

    // Never empty the picker because health is *unknown*. `keepHealthy` already
    // returns the candidates untouched when nothing has been swept, but saying
    // which path was taken is what makes an empty picker debuggable instead of
    // mysterious -- the failure this line exists for was "the model list didn't
    // load", reported with no way to tell why.
    const swept = health?.lastSyncedAt !== undefined;
    logService.info(
        `[health] picker for "${served.profile.name}": ${served.ids.length} row(s) ` +
        `from ${served.source}${swept ? ', filtered by the last sweep' : ', never swept'}`
    );

    const pings = new Map(
        (health?.models ?? []).filter((m) => m.servable).map((m) => [m.id, m.ms] as const)
    );
    return {
        rows: profileModelRows(served.profile, served.ids, pings),
        source: served.source,
    };
}


/** Where endpoint profiles live, matching `EndpointService.profilesDir`. */
function endpointProfilesDir(): string {
    const configured = vscode.workspace
        .getConfiguration('forge')
        .get<string>('endpointProfilesDir', '');
    return configured?.trim()
        ? configured.replace(/^~(?=$|[/\\])/, os.homedir())
        : path.join(os.homedir(), '.forge', 'endpoints');
}

/**
 * A starting profile, opened untitled so nothing lands in the folder until the
 * user saves it.
 *
 * Deliberately not pre-filled with a credential: `${env:VAR}` keeps the token
 * in the environment, which is the only shape the loader accepts anyway.
 */
const ENDPOINT_TEMPLATE = `# Save this into:
#   {{dir}}
# as <name>.yaml. Forge reloads profiles when the folder changes.

name: my-gateway
description: My OpenAI-compatible gateway
wire: openai            # openai | anthropic | raw
baseUrl: https://gateway.example.com/v1
model: some-model-id

auth:
  kind: bearer          # none | bearer | header | exchange | exec
  value: \${env:MY_GATEWAY_TOKEN}

# Optional: name the models yourself instead of asking the gateway.
# models:
#   - id: some-model-id
#     displayName: Some Model

capabilities:
  contextWindow: 128000
  maxOutputTokens: 4096
`;

async function openEndpointTemplate(context: HandlerContext): Promise<void> {
    const dir = endpointProfilesDir();
    // Created now so "save into this folder" is true when the user tries.
    await fs.promises.mkdir(dir, { recursive: true }).catch(() => { /* reported on save */ });
    const doc = await vscode.workspace.openTextDocument({
        language: 'yaml',
        content: ENDPOINT_TEMPLATE.replace('{{dir}}', dir),
    });
    await vscode.window.showTextDocument(doc);
    context.logService.info(`[endpoints] opened a profile template for ${dir}`);
}
