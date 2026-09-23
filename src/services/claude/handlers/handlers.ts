/**
 * Claude Agent Handlers - 统一处理器文件
 *
 * 职责：处理所有来自 WebView 的请求
 * 依赖：通过 HandlerContext 注入所有服务
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type {
    InitRequest,
    InitResponse,
    UpdateStateRequest,
    ForgeAction,
    RunForgeActionRequest,
    RunForgeActionResponse,
    ListForgeItemsRequest,
    ListForgeItemsResponse,
    ListPluginsRequest,
    ListPluginsResponse,
    EnableBypassPermissionsRequest,
    EnableBypassPermissionsResponse,
    ListMarketplacesRequest,
    ListMarketplacesResponse,
    InstallPluginRequest,
    InstallPluginResponse,
    UninstallPluginRequest,
    UninstallPluginResponse,
    UpdatePluginRequest,
    UpdatePluginResponse,
    SetPluginEnabledRequest,
    SetPluginEnabledResponse,
    AddMarketplaceRequest,
    AddMarketplaceResponse,
    RemoveMarketplaceRequest,
    RemoveMarketplaceResponse,
    RefreshMarketplaceRequest,
    RefreshMarketplaceResponse,
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
    SelectionRange,
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
    ForkConversationRequest,
    ForkConversationResponse,
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
    OpenForgeSettingsRequest,
    OpenForgeSettingsResponse,
    ForgeSettingsTab,
    OpenConfigRequest,
    OpenConfigResponse,
    OpenHelpRequest,
    OpenHelpResponse,
    EndpointAction,
    RunEndpointActionRequest,
    RunEndpointActionResponse,
    GetEndpointHealthRequest,
    GetEndpointHealthResponse,
    SyncEndpointHealthRequest,
    SyncEndpointHealthResponse,
    RevealChatRequest,
    RevealChatResponse,
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
import {
    isForgeSettingsTab,
    CONFIG_SEARCH_MAX_LENGTH,
    FORGE_CONFIG_SEARCH,
    FORGE_HELP_URL,
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
    terminalEnvironment,
    SET_UP_ENDPOINT_ACTION,
    TERMINAL_NEEDS_ENDPOINT,
    type WindowsShellKind
} from '../terminalLaunch';
import { readClaudeSettings, toClaudeSettingsSnapshot } from '../claudeSettings';
import { attachSessionPermissionModes, initialPermissionModeFrom, validSessionId } from '../sessionPermissionModes';
import { plannedRename } from '../sessionIdentity';
import { pairRow } from '../../endpoints/models';
import { checkedProfileCount, healthyModelCount, keepHealthy } from '../../endpoints/healthStore';
import { supportsSecondarySidebar } from '../../../commands/forgeCommands';
import { planForkConversation } from '../forkConversation';
import { listItems as listForgeItems } from '../../customizations/customizations';
import { PluginManager } from '../pluginManager';
/**
 * 初始化请求
 */
export async function handleInit(
    _request: InitRequest,
    context: HandlerContext
): Promise<InitResponse> {
    context.logService.info('[handleInit] 处理初始化请求');

    // The official `onClientInit = () => { this.broadcastSessionStates(); … }`:
    // until the feed arrives the sessions list shows no status dot at all.
    context.agentService.sendSessionStates();

    return {
        type: "init_response",
        state: await buildInitState(context)
    };
}

/**
 * The state `init` answers with, and `update_state` pushes (the official
 * `getCurrentState()`, sent by `pushStateUpdate()`).
 *
 * One builder for both, so a push can never carry a thinner state than the
 * handshake did -- the webview replaces its whole config from either.
 */
export async function buildInitState(context: HandlerContext): Promise<InitResponse["state"]> {
    const { configService, workspaceService } = context;

    // TODO: 从 AuthManager 获取认证状态
    // const authStatus = null;

    // The picker's current row: the endpoint and model pair in use, named by
    // its profile (the row value). Not the CLI's `model` setting, which named a
    // Claude tier and is no longer read or written.
    const modelSetting = context.endpointService.resolveActiveProfile()?.name ?? '';

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
    const { defaultPermissionMode, focusView } = await configService.getExtensionConfig();
    const initialPermissionMode = initialPermissionModeFrom(defaultPermissionMode, allowDangerouslySkipPermissions);

    // The official `browserIntegrationSupported: this.isBrowserIntegrationSupported()`
    // on the same init state object (extension.js @3061483). It gates the "+"
    // menu's "Browse the web" row and the `@browser:` send path (step 28).
    const browserIntegrationSupported = context.sdkService.isBrowserIntegrationSupported();

    // Forge-only: how many endpoint profiles parse. The empty state offers to
    // set one up when this is 0. Profiles that failed to parse are not counted
    // -- one is "configured" only if it can actually be selected.
    const endpointProfileCount = context.endpointService.listProfiles().profiles.length;

    // What the welcome gate decides on. A stored read, never a probe: the gate
    // must answer on the handshake, and a sweep is a minute of real completions.
    const health = context.endpointHealthService?.getAllHealth() ?? [];
    const endpointHealthyModelCount = healthyModelCount(health);
    const endpointHealthCheckedProfileCount = checkedProfileCount(health);

    return {
        defaultCwd,
        openNewInTab,
        // authStatus,
        modelSetting,
        platform: process.platform,
        thinkingLevel,
        ...(initialPermissionMode !== undefined && { initialPermissionMode }),
        allowDangerouslySkipPermissions,
        endpointProfileCount,
        endpointHealthyModelCount,
        endpointHealthCheckedProfileCount,
        browserIntegrationSupported,
        // The official `focusViewEnabled` on the init state: the persisted
        // preference, so a reload comes back in focus view (step 30).
        focusViewEnabled: focusView === true
    };
}

/**
 * The official `pushStateUpdate()`:
 *
 *   let Q={type:"request",channelId:"",requestId:l8(),
 *          request:{type:"update_state",state:this.getCurrentState(),config:$}}
 *
 * Forge sends it when the endpoint settings change, so a page holding the
 * welcome gate learns about an endpoint the moment it is saved, without a
 * reload. `config` is the same bounded read `get_claude_state` answers with,
 * because a new or newly selected profile changes the model list the gate
 * and the picker both read.
 */
export async function buildStateUpdate(context: HandlerContext): Promise<UpdateStateRequest> {
    const [state, { config }] = await Promise.all([
        buildInitState(context),
        claudeStateConfig(context)
    ]);
    return { type: "update_state", state, config };
}

/**
 * The same push without the model config: a read of settings and the stored
 * health, so it is ready at once. The config can take the CLI's whole probe
 * budget -- about ten seconds with no profile, measured on a fresh install --
 * and the welcome gate needs only the endpoint count, so the state goes first
 * and the config follows (the webview keeps its config when a push has none).
 */
export async function buildStateOnlyUpdate(context: HandlerContext): Promise<UpdateStateRequest> {
    return { type: "update_state", state: await buildInitState(context) };
}

/**
 * The model picker's rows: one per endpoint profile, each the endpoint with its
 * one model (`pairRow`), or `undefined` when there is no profile at all.
 *
 * One function, used by both `get_claude_state` and `sdk_probe`, so the chat's
 * picker and Settings can never disagree. The CLI's own model table is never
 * served: it lists Anthropic tiers, and Forge talks only to the endpoints the
 * user set up. Nothing here touches the network -- the rows come from settings
 * and the stored health -- so the handshake no longer waits on a gateway's
 * `/models`, and no longer falls back to the Anthropic table when one is slow.
 */
function endpointModelRows(context: HandlerContext): ReturnType<typeof pairRow>[] | undefined {
    const { profiles } = context.endpointService.listProfiles();
    if (!profiles.length) return undefined;
    const active = context.endpointService.resolveActiveProfile()?.name;
    return profiles.map((profile) => ({
        ...pairRow(profile, context.endpointHealthService?.getHealth(profile.name)),
        ...(profile.name === active && { active: true }),
    }));
}

export async function handleGetClaudeState(
    _request: GetClaudeStateRequest,
    context: HandlerContext
): Promise<GetClaudeStateResponse> {
    const { logService } = context;

    logService.info('[handleGetClaudeState] 获取 Claude 状态');
    const startedAt = Date.now();

    // Nothing below may reject or wait forever.
    //
    // The webview blocks its whole handshake on this one request: `initialize()`
    // sets `claudeConfig` and reaches "connected" only once this answers. So an
    // unanswered request does not degrade one surface, it takes down two at
    // once -- the model picker renders `undefined` as a permanent
    // "Loading models…", and the welcome gate reads it as "not known yet"
    // rather than "no models", so the page that offers to set an endpoint up
    // never appears either. That is one bug wearing two faces, and the cure is
    // that this function always answers.
    const { config, provisional } = await claudeStateConfig(context);

    logService.info(
        `[handleGetClaudeState] answered in ${Date.now() - startedAt}ms with ` +
        `${config.models.length} model row(s)${provisional ? ', provisionally' : ''}`
    );

    return {
        type: "get_claude_state_response",
        config,
        provisional
    };
}

/**
 * The config the webview starts on, and whether it may still improve.
 *
 * Every wait in here is bounded and every failure is caught, because the
 * caller's contract is that it always answers. `provisional` says the answer
 * was cut short rather than complete, which is the webview's cue to ask again
 * once the probe has had time to land -- see `refreshClaudeState` there.
 */
async function claudeStateConfig(
    context: HandlerContext
): Promise<{ config: ClaudeConfig; provisional: boolean }> {
    const { logService } = context;

    // The pairs are a read of settings and stored health, so they are ready
    // at once. The CLI probe is still needed for the command list, and gets
    // one budget whatever is configured: it no longer carries the model list.
    const rows = endpointModelRows(context) ?? [];
    const probed = await bounded(
        configProbe(context),
        CONFIG_PROBE_BUDGET_MS,
        { commands: [], models: [], accountInfo: null },
        (reason) => logService.warn(
            `[endpoints] the CLI config probe ${reason}; serving the endpoint models and an ` +
            `empty command list. Run "Forge: Run Endpoint Diagnostics" if this persists.`
        )
    );
    const config = probed.value;

    // Never the CLI's table: those are Anthropic tiers. No profile means no
    // models, and the chat shows its setup page instead of a picker.
    delete config.unavailable_models;
    config.models = rows;

    return { config, provisional: probed.degraded };
}

/**
 * `promise`, but it always settles inside `budgetMs` and never rejects.
 *
 * `degraded` is the honest part: it says the fallback is being served because
 * the real answer timed out or threw, not because the real answer was empty.
 */
async function bounded<T>(
    promise: Promise<T>,
    budgetMs: number,
    fallback: T,
    onDegraded: (reason: string) => void
): Promise<{ value: T; degraded: boolean }> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Attached now, not at race time: a rejection that loses the race is still
    // handled here, so giving up on a probe cannot raise an unhandled rejection
    // in the extension host.
    const settled = promise.then(
        (value) => ({ value, degraded: false }),
        (error) => {
            onDegraded(`failed: ${error instanceof Error ? error.message : String(error)}`);
            return { value: fallback, degraded: true };
        }
    );

    try {
        return await Promise.race([
            settled,
            new Promise<{ value: T; degraded: boolean }>((resolve) => {
                timer = setTimeout(() => {
                    onDegraded(`did not answer in ${budgetMs}ms`);
                    resolve({ value: fallback, degraded: true });
                }, budgetMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** How long a completed probe is reused before the CLI is asked again. */
export const CONFIG_CACHE_TTL_MS = 30000;

interface ProbeCacheEntry {
    inFlight?: Promise<ClaudeConfig>;
    settled?: { value: ClaudeConfig; at: number };
}

/**
 * Keyed on the context, not module-global.
 *
 * There is one `HandlerContext` per extension host, so this dedupes exactly
 * what it should in production -- while a caller holding a different context
 * (every spec builds its own) gets its own cold CLI, rather than whatever the
 * previous one happened to leave behind.
 */
let probeCache = new WeakMap<HandlerContext, ProbeCacheEntry>();

/**
 * The CLI config probe, shared across calls on one context.
 *
 * Two reasons this is not just `loadConfig`. Giving up on the probe does not
 * cancel it, so the answer it was still fetching is kept here and handed
 * straight to the webview's follow-up request -- which is what turns a
 * provisional empty picker into the real one. And a second caller arriving
 * while it runs joins the one in flight instead of launching another CLI,
 * because launching Claude twice to ask it the same question is the slow part
 * of this handshake happening twice.
 */
function configProbe(context: HandlerContext): Promise<ClaudeConfig> {
    const entry = probeCache.get(context) ?? {};
    probeCache.set(context, entry);

    if (entry.settled && Date.now() - entry.settled.at < CONFIG_CACHE_TTL_MS) {
        return Promise.resolve(entry.settled.value);
    }

    if (!entry.inFlight) {
        entry.inFlight = loadConfig(context)
            .then((value) => {
                entry.settled = { value, at: Date.now() };
                entry.inFlight = undefined;
                return value;
            })
            .catch((error) => {
                entry.inFlight = undefined;
                throw error;
            });
    }

    return entry.inFlight;
}

/** Drops every shared probe, so a spec can start from a cold CLI. */
export function resetConfigProbe(): void {
    probeCache = new WeakMap();
}

/**
 * How long the CLI config probe may hold up the handshake. It only supplies
 * the command list now, so a slow CLI costs a late "/" menu, never the model
 * list: long enough for a healthy local launch, short enough not to read as a
 * hung UI.
 */
export const CONFIG_PROBE_BUDGET_MS = 8000;

/**
 * `loadConfig`, but it gives up instead of waiting forever.
 *
 * The fallback is an empty config: with a profile active the caller fills in
 * `models` straight after, so the menu opens with the gateway's real models and
 * the commands list catches up on a later read rather than never appearing.
 *
 * Thin over `bounded` on purpose. This used to carry its own copy of the race,
 * and the copies disagreed -- this one caught a slow probe while the handshake
 * around it still had two unbounded waits either side. One rule, one place.
 */
export async function loadConfigBounded(context: HandlerContext, budgetMs: number): Promise<ClaudeConfig> {
    const { value } = await bounded(
        loadConfig(context),
        budgetMs,
        { commands: [], models: [], accountInfo: null },
        (reason) => context.logService.warn(
            `[endpoints] the CLI config probe ${reason}; ` +
            `serving the profile's models and an empty command list. ` +
            `Run "Forge: Run Endpoint Diagnostics" if this persists.`
        )
    );
    return value;
}

/**
 * 一次性 SDK 探测
 */
export async function handleSdkProbe(
    request: SdkProbeRequest,
    context: HandlerContext
): Promise<SdkProbeResponse> {
    const { sdkService, workspaceService, endpointService, logService } = context;
    const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();
    const capabilities = request.capabilities ?? [];
    const result = await sdkService.probe({
        capabilities,
        cwd,
        timeoutMs: request.timeoutMs
    });

    // The CLI's model table describes Anthropic tiers; Forge offers only the
    // endpoint and model pairs the user set up (none, before any exists).
    // The row shape is the SDK's `ModelInfo` exactly, so `Session.ts` and
    // Settings gate on it without knowing anything changed.
    if (capabilities.includes("supportedModels")) {
        // The CLI's own supportedModels failure no longer matters: its answer
        // is never used, and reporting it would show an error about nothing.
        const { supportedModels: _discarded, ...errors } = result.errors ?? {};
        return {
            type: "sdk_probe_response",
            data: { ...result.data, supportedModels: endpointModelRows(context) ?? [] },
            errors
        };
    }

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
 * Editors that are never "the file the user is looking at".
 *
 * The official `fI4`, ported as a **denylist** rather than the
 * `scheme !== "file"` allowlist this used to apply. The difference is not
 * cosmetic: an allowlist of `file` also throws away untitled buffers and
 * virtual documents the user is genuinely working in, while letting nothing
 * else through. What actually needs excluding is the editors that are not the
 * user's document at all -- diff panes Forge itself opened, output channels,
 * comment editors.
 */
const IGNORED_EDITOR_SCHEMES = new Set([
    'comment',
    'output',
    // The official lists its own diff-view schemes here. Forge's equivalents go
    // beside them, so a proposed-diff pane never reads as the open file.
    'forge-diff',
    'forge-diff-left',
    'forge-diff-right',
]);

/**
 * The official host's `Ri(editor, redact)`.
 *
 * The empty-selection branch is the whole point: with only a cursor in the
 * file, the official still returns the file -- same `startLine` and `endLine`,
 * and **no `selectedText`** -- where Forge used to return `null` and tell the
 * model nothing. That is why "what file am I seeing rn?" got
 * "I don't have visibility into what file you're currently viewing".
 */
export function selectionFromEditor(editor: vscode.TextEditor): SelectionRange | null {
    const document = editor.document;
    if (IGNORED_EDITOR_SCHEMES.has(document.uri.scheme)) return null;

    const selection = editor.selection;
    // `document.fileName`, as the official does -- `uri.fsPath` is empty for a
    // document that has no file behind it yet.
    const filePath = document.fileName;
    const sourceUri = document.uri.toString();

    if (selection.isEmpty) {
        return {
            filePath,
            sourceUri,
            startLine: selection.start.line + 1,
            endLine: selection.start.line + 1
        };
    }

    return {
        filePath,
        sourceUri,
        startLine: selection.start.line + 1,
        endLine: selection.end.line + 1,
        startColumn: selection.start.character,
        endColumn: selection.end.character,
        selectedText: document.getText(selection)
    };
}

/**
 * 获取当前编辑器选区
 */
export async function handleGetCurrentSelection(
    _context: HandlerContext
): Promise<GetCurrentSelectionResponse> {
    const editor = vscode.window.activeTextEditor;
    return {
        type: "get_current_selection_response",
        selection: editor ? selectionFromEditor(editor) : null
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
        // Still an answer: the list must never wait on a reply that is not
        // coming. `error` is what lets it say "could not load" and offer a
        // retry, instead of "no conversations yet".
        return {
            type: "list_sessions_response",
            sessions: [],
            error: error instanceof Error ? error.message : String(error)
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
 * Fork a conversation (step 25).
 *
 * The official host is one line, because its store does the validating:
 *
 *   case"fork_conversation":
 *     return{type:"fork_conversation_response",
 *            sessionId:await(await U6.load(this.cwd,this.logger))
 *              .forkSession($.request.forkedFromSession,$.request.resumeSessionAt)}
 *
 * Forge validates first (B3 — the webview is untrusted) and then forks through
 * the SDK. A bad id **throws**, exactly as the official's store does
 * (`invalid session id` / `Session … not found` / `Message … not found in
 * session …`), so the webview's `.catch` shows "Failed to fork conversation: …"
 * instead of silently opening nothing.
 */
export async function handleForkConversation(
    request: ForkConversationRequest,
    context: HandlerContext
): Promise<ForkConversationResponse> {
    const { logService, sessionService, workspaceService } = context;

    const plan = planForkConversation(request);
    if (!plan) {
        logService.warn(
            `Refusing fork_conversation: forkedFromSession is not a session id, or resumeSessionAt is not a message uuid`
        );
        throw new Error('invalid session id');
    }

    const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();
    const sessionId = await sessionService.forkSession(plan, cwd);
    return { type: "fork_conversation_response", sessionId };
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
    const { workspaceService, fileSystemService, agentService } = context;
    const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();

    // Step 28: the official `findFiles($)` (extension.js @3306700), minus the
    // `@terminal:` branch Forge has no mentions for:
    //
    //   let Q=$?.toLowerCase()??"";
    //   if(Q.startsWith("browser:"))return this.getMatchingBrowserTabs($,!1);
    //   …
    //   let X="browser:",Y=Q&&X.startsWith(Q);
    //   let K=await this.getMatchingBrowserTabs($,!0);
    //   …
    //   if(Y)return[…K,…U]; return[…U,…K]
    //
    // So a `browser:` query lists tabs live, typing towards it ("b", "bro", …)
    // floats them above the files, and every other query keeps files first with
    // the cached tabs appended. This is how "Browse the web" -- which inserts
    // the bare `@browser:` -- turns into a real `@browser:<group>:<id>:<url>`
    // mention that `browserMentionBlocks` can parse.
    const query = request.pattern?.toLowerCase() ?? "";
    if (query.startsWith("browser:")) {
        return {
            type: "list_files_response",
            files: await agentService.getMatchingBrowserTabs(request.pattern, false)
        };
    }

    const typingTowardsBrowser = !!query && "browser:".startsWith(query);
    const [tabs, files] = await Promise.all([
        agentService.getMatchingBrowserTabs(request.pattern, true),
        fileSystemService.findFiles(request.pattern, cwd)
    ]);

    return {
        type: "list_files_response",
        files: typingTowardsBrowser ? [...tabs, ...files] : [...files, ...tabs]
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
 * The endpoint tools, keyed by what the webview asks for rather than by id.
 *
 * Exported so the spec tests the real mapping rather than a copy of it. The
 * webview sends an `EndpointAction`; only these seven strings resolve, and
 * anything else is rejected before a command runs. That is the whole point:
 * the webview names an action, the host names the command (B3).
 *
 * Every one opens a picker, a report or a probe, and none writes without
 * confirming first -- `add` asks five questions and then a save destination.
 */
export const ENDPOINT_ACTION_COMMANDS: Record<EndpointAction, string> = {
    select: "forge.selectEndpoint",
    add: "forge.addEndpoint",
    edit: "forge.editEndpoints",
    status: "forge.endpointStatus",
    diagnostics: "forge.runEndpointDiagnostics",
    capabilities: "forge.detectCapabilities",
    models: "forge.listEndpointModels",
};

export async function handleRunEndpointAction(
    request: RunEndpointActionRequest,
    context: HandlerContext
): Promise<RunEndpointActionResponse> {
    const command = Object.prototype.hasOwnProperty.call(ENDPOINT_ACTION_COMMANDS, request.action)
        ? ENDPOINT_ACTION_COMMANDS[request.action]
        : undefined;
    if (!command) {
        // Not a warning-and-continue: an unknown action means the webview and
        // the host disagree about the protocol, and running nothing quietly is
        // how "the button does nothing" happens.
        throw new Error(`Unknown endpoint action: ${String(request.action)}`);
    }
    context.logService.info(`[run_endpoint_action] ${request.action} -> ${command}`);
    await vscode.commands.executeCommand(command);
    return { type: "run_endpoint_action_response" };
}

/**
 * The Settings page's create and add buttons, keyed by what the webview asks
 * for. Exported so the spec tests the real mapping. Same rule as the endpoint
 * actions (B3): only these five strings resolve, each to a command that asks
 * its own questions and confirms before writing anything.
 */
export const FORGE_ACTION_COMMANDS: Record<ForgeAction, string> = {
    "create-skill": "forge.createSkill",
    "add-skill": "forge.addSkill",
    "create-agent": "forge.createSubagent",
    "create-command": "forge.createSlashCommand",
    "add-mcp-server": "forge.addMcpServer",
};

export async function handleRunForgeAction(
    request: RunForgeActionRequest,
    context: HandlerContext
): Promise<RunForgeActionResponse> {
    const command = Object.prototype.hasOwnProperty.call(FORGE_ACTION_COMMANDS, request.action)
        ? FORGE_ACTION_COMMANDS[request.action]
        : undefined;
    if (!command) {
        throw new Error(`Unknown Forge action: ${String(request.action)}`);
    }
    context.logService.info(`[run_forge_action] ${request.action} -> ${command}`);
    await vscode.commands.executeCommand(command);
    return { type: "run_forge_action_response" };
}

/**
 * The skills, subagents or slash commands in this workspace and the user's config home. A
 * directory that does not exist is an empty list, never an error: a fresh
 * install has neither, and "none yet" is the answer the tab should give.
 */
export async function handleListForgeItems(
    request: ListForgeItemsRequest,
    context: HandlerContext
): Promise<ListForgeItemsResponse> {
    if (request.kind !== "skills" && request.kind !== "agents" && request.kind !== "commands") {
        throw new Error(`list_forge_items: unknown kind ${String(request.kind)}`);
    }
    const root = context.workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath;
    return { type: "list_forge_items_response", items: listForgeItems(request.kind, root) };
}

/** The confirmation's button: the one answer that turns bypass on. */
export const ALLOW_BYPASS_ACTION = 'Allow bypass permissions';

/**
 * Turn on bypass permissions, after asking (see `EnableBypassPermissionsRequest`).
 *
 * Nothing is written without the modal's explicit answer. A managed policy
 * that disables bypass wins, as the official honours it
 * (`disableBypassPermissionsMode === "disable"` hides the row there).
 * Machine scope, as the official declares its setting: written to the user's
 * settings, never a workspace a repository could ship. The setting change
 * relaunches idle channels with the allow option, so the conversation
 * continues in bypass from its next message.
 */
export async function handleEnableBypassPermissions(
    _request: EnableBypassPermissionsRequest,
    context: HandlerContext
): Promise<EnableBypassPermissionsResponse> {
    if (context.sdkService.getAllowDangerouslySkipPermissions()) {
        return { type: "enable_bypass_permissions_response", enabled: true };
    }
    const policy = context.agentService.getCachedClaudeSettings?.()?.effective?.permissions;
    if (policy?.disableBypassPermissionsMode === 'disable') {
        void vscode.window.showWarningMessage('Forge: bypass permissions is disabled by your organization\'s managed settings.');
        return { type: "enable_bypass_permissions_response", enabled: false };
    }
    const answer = await vscode.window.showWarningMessage(
        'Allow bypass permissions?',
        {
            modal: true,
            detail:
                'Forge will run tools and commands, including ones that change or delete files, without asking first. ' +
                'Recommended only for sandboxes with no internet access. You can turn it off again in Settings ' +
                '(forge.allowDangerouslySkipPermissions).',
        },
        ALLOW_BYPASS_ACTION
    );
    if (answer !== ALLOW_BYPASS_ACTION) {
        return { type: "enable_bypass_permissions_response", enabled: false };
    }
    await vscode.workspace
        .getConfiguration('forge')
        .update('allowDangerouslySkipPermissions', true, vscode.ConfigurationTarget.Global);
    context.logService.info('[bypass] forge.allowDangerouslySkipPermissions turned on by the user');
    return { type: "enable_bypass_permissions_response", enabled: true };
}

/**
 * Plugins and marketplaces: the official `pluginManager` requests, one
 * `claude plugin ...` subcommand each (see `pluginManager.ts`). They run in the
 * workspace folder, as the official runs them in its `cwd`, so project-scope
 * installs land in this project; with no folder open, in the home folder,
 * where only user-scope installs mean anything.
 *
 * Each handler takes the manager as an optional third argument so the spec can
 * hand in one with a stand-in `execFile`.
 */
export function pluginManagerFor(context: HandlerContext): PluginManager {
    return new PluginManager(
        () => context.sdkService.getClaudeBinary(),
        (message) => context.logService.info(`[plugins] ${message}`),
    );
}

function pluginCwd(context: HandlerContext): string {
    return context.workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath ?? os.homedir();
}

export async function handleListPlugins(
    request: ListPluginsRequest,
    context: HandlerContext,
    manager: PluginManager = pluginManagerFor(context)
): Promise<ListPluginsResponse> {
    return manager.listPlugins(pluginCwd(context), { includeAvailable: request.includeAvailable === true });
}

export async function handleListMarketplaces(
    _request: ListMarketplacesRequest,
    context: HandlerContext,
    manager: PluginManager = pluginManagerFor(context)
): Promise<ListMarketplacesResponse> {
    return manager.listMarketplaces(pluginCwd(context));
}

export async function handleInstallPlugin(
    request: InstallPluginRequest,
    context: HandlerContext,
    manager: PluginManager = pluginManagerFor(context)
): Promise<InstallPluginResponse> {
    return manager.installPlugin(request.pluginId, request.scope, pluginCwd(context));
}

export async function handleUninstallPlugin(
    request: UninstallPluginRequest,
    context: HandlerContext,
    manager: PluginManager = pluginManagerFor(context)
): Promise<UninstallPluginResponse> {
    return manager.uninstallPlugin(request.pluginId, pluginCwd(context));
}

export async function handleUpdatePlugin(
    request: UpdatePluginRequest,
    context: HandlerContext,
    manager: PluginManager = pluginManagerFor(context)
): Promise<UpdatePluginResponse> {
    return manager.updatePlugin(request.pluginId, request.scope, pluginCwd(context));
}

export async function handleSetPluginEnabled(
    request: SetPluginEnabledRequest,
    context: HandlerContext,
    manager: PluginManager = pluginManagerFor(context)
): Promise<SetPluginEnabledResponse> {
    return manager.setPluginEnabled(request.pluginId, request.enabled, pluginCwd(context));
}

export async function handleAddMarketplace(
    request: AddMarketplaceRequest,
    context: HandlerContext,
    manager: PluginManager = pluginManagerFor(context)
): Promise<AddMarketplaceResponse> {
    return manager.addMarketplace(request.source, pluginCwd(context));
}

export async function handleRemoveMarketplace(
    request: RemoveMarketplaceRequest,
    context: HandlerContext,
    manager: PluginManager = pluginManagerFor(context)
): Promise<RemoveMarketplaceResponse> {
    return manager.removeMarketplace(request.marketplaceId, pluginCwd(context));
}

export async function handleRefreshMarketplace(
    request: RefreshMarketplaceRequest,
    context: HandlerContext,
    manager: PluginManager = pluginManagerFor(context)
): Promise<RefreshMarketplaceResponse> {
    return manager.refreshMarketplace(request.marketplaceId, pluginCwd(context));
}

/**
 * The stored health verdicts. A pure read -- nothing here touches the network.
 *
 * B3: `profileName` is checked against `listProfiles()` before it is used. An
 * unknown name is rejected rather than coerced to the active profile, because a
 * webview that can nominate a name the host does not know is a webview whose
 * idea of the profile set has drifted, and answering with *some* profile's
 * verdicts would put the wrong endpoint's numbers on screen.
 */
export async function handleGetEndpointHealth(
    request: GetEndpointHealthRequest,
    context: HandlerContext
): Promise<GetEndpointHealthResponse> {
    const service = context.endpointHealthService;
    if (!service) return { type: "get_endpoint_health_response", health: [] };

    const name = validEndpointProfileName(request.profileName, context);
    const health = name ? [service.getHealth(name)].filter(isPresent) : service.getAllHealth();
    return { type: "get_endpoint_health_response", health };
}

/**
 * Sweep now, or cancel the sweep running.
 *
 * Always answers with every profile's health rather than just the swept one, so
 * the settings table and the welcome page can render from one response without
 * stitching. A sweep that fails does not reject: it comes back carrying `error`
 * beside the verdicts it could not replace.
 */
export async function handleSyncEndpointHealth(
    request: SyncEndpointHealthRequest,
    context: HandlerContext
): Promise<SyncEndpointHealthResponse> {
    const service = context.endpointHealthService;
    if (!service) return { type: "sync_endpoint_health_response", health: [] };

    const name = validEndpointProfileName(request.profileName, context);

    if (request.cancel) {
        service.cancelSync(name);
        return { type: "sync_endpoint_health_response", health: service.getAllHealth() };
    }

    context.logService.info(`[sync_endpoint_health] sweeping ${name ? `"${name}"` : 'every profile'}`);
    if (name) await service.syncProfile(name);
    else await service.syncAll();

    return { type: "sync_endpoint_health_response", health: service.getAllHealth() };
}

/**
 * A profile name the host already knows, or nothing.
 *
 * Returns `undefined` for an absent name -- "every profile" is a legitimate
 * request -- and throws for one that is present and unknown, which is the case
 * the webview is not allowed to talk the host into.
 */
function validEndpointProfileName(
    profileName: string | undefined,
    context: HandlerContext
): string | undefined {
    if (profileName === undefined) return undefined;
    const name = String(profileName).trim();
    if (!name) return undefined;
    const known = context.endpointService.listProfiles().profiles.some((p) => p.name === name);
    if (!known) throw new Error(`Unknown endpoint profile: ${name}`);
    return name;
}

function isPresent<T>(value: T | undefined): value is T {
    return value !== undefined;
}

/**
 * Bring the chat view forward, wherever it is configured to live.
 *
 * The host runs its own commands here: `forge.sidebar.open` knows the
 * primary/secondary fallback, and `forge.newConversation` reveals and then
 * sends the UI command. The webview names an intent, never a command (B3).
 */
export async function handleRevealChat(
    request: RevealChatRequest,
    context: HandlerContext
): Promise<RevealChatResponse> {
    // The history started fading out when it was clicked, which is (to within a
    // message hop) now. Everything below is measured from here.
    const startedAt = Date.now();

    // B3: a session id is checked before it goes anywhere, and a malformed one
    // is refused rather than dropped, so the row that sent it can say so.
    const sessionId = request.sessionId;
    if (sessionId !== undefined && !validSessionId(sessionId)) {
        throw new Error('reveal_chat: sessionId is not a session id');
    }
    context.logService.info(
        `[reveal_chat] newConversation=${Boolean(request.newConversation)} ` +
        `session=${sessionId ?? '-'} fromView=${Boolean(request.fromView)}`
    );
    // Told before it is revealed, so the chat is ready to play its entrance
    // on the frame it becomes visible rather than one frame late.
    if (request.fromView) {
        context.agentService.notifyClient({ type: 'ui_command', command: 'arrive' });
    }
    await vscode.commands.executeCommand(
        request.newConversation && !sessionId ? 'forge.newConversation' : 'forge.sidebar.open'
    );

    // A row in the history names a conversation. The chat opens it the way its
    // own dropdown does (`activateSessionFromServer`); before this the id was
    // dropped here and the chat simply stayed on whatever it had.
    if (sessionId) {
        context.agentService.notifyClient({ type: 'ui_command', command: 'open_session', sessionId });
    }

    // The request came from the sessions view in the primary side bar. Once
    // the chat is up in the secondary one, the history that launched it has
    // served its purpose, so the primary side bar closes behind it.
    //
    // Only then. With the chat in the primary side bar this would close what
    // was just revealed; and the history opened as an editor tab
    // ("Forge: Past Conversations") is not in a side bar at all, so closing one
    // would take away Explorer or whatever else is there.
    if (request.fromView && chatLivesInSecondarySideBar()) {
        // Hold for what is left of the webview's own exit, so the history has
        // faded out before its panel goes. A slow reveal has already used that
        // time up, and waiting the full length again on top of it is what left
        // an empty panel on screen.
        await delay(Math.max(0, SIDEBAR_HANDOFF_MS - (Date.now() - startedAt)));
        await vscode.commands.executeCommand('workbench.action.closeSidebar');
    }
    return { type: "reveal_chat_response" };
}

/**
 * How long the host waits before closing the side bar it handed off from.
 *
 * Paired with `--forge-handoff-duration` in `forge-design.css`: the webview
 * fades the history out over that long, and the panel must not be taken away
 * mid-fade. Keep this the longer of the two if they ever drift.
 */
export const SIDEBAR_HANDOFF_MS = 70;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The same two inputs the container `when` clauses use, in the same order.
 *
 * Duplicating the rule would let it drift from the manifest, which is how the
 * "/" rows ended up opening General; this reads the setting and the version
 * check that decide it.
 */
function chatLivesInSecondarySideBar(): boolean {
    const preferred = vscode.workspace
        .getConfiguration('forge')
        .get<string>('preferredLocation', 'secondary');
    return preferred !== 'primary' && supportsSecondarySidebar(vscode.version);
}

/**
 * 打开配置文件
 *
 * File types only. The `command:<id>` escape hatch this used to carry is gone
 * (step 32): the webview naming a VS Code command is what B3 forbids, and every
 * row that needed one now has a typed request whose vocabulary the host owns --
 * `open_forge_settings`, `open_config`, `open_help`, `run_endpoint_action`.
 */
export async function handleOpenConfigFile(
    request: OpenConfigFileRequest,
    context: HandlerContext
): Promise<OpenConfigFileResponse> {
    const { configType } = request;

    try {
        // Step 32 deleted the `command:` branch. The webview used to be able to
        // name a VS Code command here, from an allow-list; it now names a
        // Settings tab (`open_forge_settings`), a settings search
        // (`open_config`) or the docs (`open_help`), and nothing on this path
        // executes a command the webview chose. A leftover `command:` value is
        // treated as what it now is: not a config file.
        if (configType.startsWith("command:")) {
            throw new Error(
                `Not a config file: ${configType} -- open_config_file no longer runs commands; use the typed request for this row.`
            );
        }
        // VS Code 设置
        else if (configType === "vscode") {
            await vscode.commands.executeCommand('workbench.action.openSettings', FORGE_CONFIG_SEARCH);
        }
        // 用户配置文件
        else {
            const configPath = getConfigFilePath(
                configType,
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
            );
            // A memory file that does not exist yet is created empty, as the
            // CLI's `/memory` does, so "Edit" always opens something to type in.
            if (MEMORY_FILE_TYPES.has(configType) && !fs.existsSync(configPath)) {
                fs.mkdirSync(path.dirname(configPath), { recursive: true });
                fs.writeFileSync(configPath, '', { encoding: 'utf8', flag: 'wx' });
            }
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
 * Step 32: the official `openConfig($)`, verbatim except for the brand string.
 *
 *   await commands.executeCommand("workbench.action.focusFirstEditorGroup");
 *   await commands.executeCommand("workbench.action.openSettings", $ || "claudeCode");
 *
 * Both official callers pass nothing, so the default is what actually ships;
 * Forge's is `forge`, its settings prefix. B3: `searchString` must be a string
 * and is length-capped, because it is the one thing the webview controls here,
 * and it is a search box query -- not a path, a command or an id.
 */
export async function handleOpenConfig(
    request: OpenConfigRequest,
    _context: HandlerContext
): Promise<OpenConfigResponse> {
    const { searchString } = request;
    if (searchString !== undefined && typeof searchString !== 'string') {
        throw new Error('open_config: searchString must be a string');
    }
    if (typeof searchString === 'string' && searchString.length > CONFIG_SEARCH_MAX_LENGTH) {
        throw new Error(`open_config: searchString is longer than ${CONFIG_SEARCH_MAX_LENGTH} characters`);
    }
    await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
    await vscode.commands.executeCommand('workbench.action.openSettings', searchString || FORGE_CONFIG_SEARCH);
    return { type: "open_config_response" };
}

/**
 * Step 32: the official `openHelp()`, verbatim.
 *
 *   let $=Uri.parse("https://code.claude.com/docs/en/vs-code");await env.openExternal($)
 *
 * The URL is a constant on the host side: the webview sends no payload, so
 * there is nothing here it can point somewhere else.
 */
export async function handleOpenHelp(
    _request: OpenHelpRequest,
    _context: HandlerContext
): Promise<OpenHelpResponse> {
    await vscode.env.openExternal(vscode.Uri.parse(FORGE_HELP_URL));
    return { type: "open_help_response" };
}

/**
 * Step 31: open Forge's Settings page on a named tab.
 *
 * This replaces `open_config_file {configType:"command:forge.openSettings"}`.
 * The difference is B3: the webview no longer names a VS Code command, it names
 * a tab, and the only values it can name are the real tab ids. Anything else
 * falls back to General **and runs nothing else** -- there is no path here that
 * executes a command the webview chose.
 */
export async function handleOpenForgeSettings(
    request: OpenForgeSettingsRequest,
    context: HandlerContext
): Promise<OpenForgeSettingsResponse> {
    const tab: ForgeSettingsTab = isForgeSettingsTab(request.tab) ? request.tab : 'general';
    if (request.tab !== undefined && tab !== request.tab) {
        context.logService.warn(`[openForgeSettings] unknown tab ${JSON.stringify(request.tab)}; opening General`);
    }
    // The settings page is a singleton, so it takes no instanceId.
    context.webViewService.openEditorPage('settings', 'Forge Settings', undefined, { tab });
    return { type: "open_forge_settings_response", tab };
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

    // The chat's endpoint, relay and model, or nothing to run: a CLI started
    // without them can only answer "Not logged in · Please run /login".
    let endpointEnv = await context.endpointService.getEnvironment();
    if (!Object.keys(endpointEnv).length) {
        // The welcome page's `$ forge` lands here every time: it is shown only
        // while there is no endpoint. So offer the setup and open the terminal
        // on what it saves, rather than refusing. Dismissed, or a setup that
        // saves nothing: no terminal, and nothing to report.
        const choice = await vscode.window.showInformationMessage(TERMINAL_NEEDS_ENDPOINT, SET_UP_ENDPOINT_ACTION);
        if (choice !== SET_UP_ENDPOINT_ACTION) {
            return { type: "open_claude_in_terminal_response" };
        }
        await vscode.commands.executeCommand("forge.addEndpoint");
        endpointEnv = await context.endpointService.getEnvironment();
        if (!Object.keys(endpointEnv).length) {
            logService.info("Terminal not opened: the endpoint setup saved nothing");
            return { type: "open_claude_in_terminal_response" };
        }
    }
    const env = terminalEnvironment(endpointEnv, await context.configService.getEnvironmentVariables());

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
        env
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

    const config: ClaudeConfig = {
        // Official field name: the CLI's initialize response carries `commands`
        // (SDKControlInitializeResponse), which the official webview reads as
        // `claudeConfig.commands`. `supportedCommands()` returns that same list.
        commands: await query.supportedCommands?.() || [],
        // In the CLI's order, every field as sent.
        models: init.models ?? [],
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

/** The memory files the Settings page edits; opening one that is missing creates it. */
const MEMORY_FILE_TYPES = new Set(["user-claude-md", "project-claude-md", "local-claude-md"]);

/**
 * The files `open_config_file` may open: a closed set of names, each mapped to
 * one path here (B3). It used to fall through to `~/.claude/<configType>.json`
 * for anything else, which let the webview pick a path segment -- and made the
 * Memory tab's "Edit" buttons open `~/.claude/user-claude-md.json`, a file
 * nothing reads, instead of the CLAUDE.md the CLI loads.
 *
 * Exported for the spec.
 */
export function getConfigFilePath(configType: string, workspaceRoot: string | undefined): string {
    const homeDir = os.homedir();
    const project = (file: string) => {
        if (!workspaceRoot) {
            throw new Error("No workspace folder open");
        }
        return path.join(workspaceRoot, file);
    };

    switch (configType) {
        case "settings":
            return path.join(homeDir, ".claude", "settings.json");
        case "config":
            return path.join(homeDir, ".claude", "config.json");
        case "mcp-global":
            // Global MCP servers: ~/.claude.json (home directory root, NOT inside .claude/)
            return path.join(homeDir, ".claude.json");
        case "mcp-project":
            // Project MCP servers: .mcp.json in workspace root
            return project(".mcp.json");
        // The CLI's memory files: the user's in its config home (which honours
        // CLAUDE_CONFIG_DIR), the project's shared one at the root, and the
        // personal, git-ignored one beside it.
        case "user-claude-md":
            return path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(homeDir, ".claude"), "CLAUDE.md");
        case "project-claude-md":
            return project("CLAUDE.md");
        case "local-claude-md":
            return project("CLAUDE.local.md");
        default:
            throw new Error(`Not a config file: ${configType}`);
    }
}
