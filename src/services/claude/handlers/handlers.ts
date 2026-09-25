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
    SetExpertModeRequest,
    SetExpertModeResponse,
    ArchiveSessionResponse,
    UnarchiveSessionRequest,
    UnarchiveSessionResponse,
    SetSessionUnreadRequest,
    GetSessionGroupsRequest,
    GetSessionGroupsResponse,
    UpdateSessionGroupsRequest,
    UpdateSessionGroupsResponse,
    UpdateSessionSectionCollapseStateRequest,
    UpdateSessionSectionCollapseStateResponse,
    GetCollapsedPanelSectionsRequest,
    GetCollapsedPanelSectionsResponse,
    UpdateCollapsedPanelSectionsRequest,
    UpdateCollapsedPanelSectionsResponse,
    SetSessionUnreadResponse,
    GetSessionRequest,
    GetSessionResponse,
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
import type { OpenOutputPanelRequest, OpenOutputPanelResponse } from '../../../shared/messages';
import type { HandlerContext } from './types';
import type { Query, SDKControlInitializeResponse, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { AsyncStream } from '../transport/AsyncStream';
import { getTrackedSelection, selectionFromEditor } from '../editorSelection';
import { assertSettingsPageKey, assertSettingsPageWrite } from '../settingsPageWrites';
import { MAX_STAT_PATHS, assertDiffEdits, assertLocalPath, assertOpenContent, isLocalPath } from '../webviewPaths';
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
import { checkedProfileCount } from '../../endpoints/healthStore';
import { answeringModelCount, isOffered } from '../../../shared/pairHealth';
import { supportsSecondarySidebar } from '../../../commands/forgeCommands';
import { planForkConversation } from '../forkConversation';
import {
    applyPanelSectionToggle,
    isGroupKey,
    normalizeSessionGroups,
    panelSectionToggle,
    sectionCollapsePatch,
    withoutSessions,
} from '../../../shared/sessionGroups';
import { listItems as listForgeItems } from '../../customizations/customizations';
import { PluginManager } from '../pluginManager';
/**
 * 初始化请求
 */
export async function handleInit(
    _request: InitRequest,
    context: HandlerContext,
    webviewId?: string
): Promise<InitResponse> {
    context.logService.info('[handleInit] init');

    // The official `onClientInit = () => { this.broadcastSessionStates(); … }`:
    // until the feed arrives the sessions list shows no status dot at all.
    context.agentService.sendSessionStates();

    return {
        type: "init_response",
        state: { ...(await buildInitState(context)), openNewInTab: isEditorTabChat(webviewId) }
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

    // Where the chat lives, not a preference: only `init` knows which webview
    // is asking, so it fills this in (`isEditorTabChat`); a broadcast state
    // push leaves the webview's own value alone.
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
    const endpointHealthyModelCount = answeringModelCount(health);
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
 *
 * Split by the pair's last check (`shared/pairHealth.ts`, the user's request of
 * 2026-09-25): `models` holds the pairs that answered or have not been measured
 * yet; `unavailable` holds the ones that did not answer, as the official's
 * greyed `unavailable_models` rows (`disabled`, the reason in the description).
 * The chat picker shows an unavailable row only while it is the model in use.
 */
function endpointModelRows(
    context: HandlerContext
): { models: PairModelRow[]; unavailable: PairModelRow[] } | undefined {
    const { profiles } = context.endpointService.listProfiles();
    if (!profiles.length) return undefined;
    const active = context.endpointService.resolveActiveProfile()?.name;
    const models: PairModelRow[] = [];
    const unavailable: PairModelRow[] = [];
    for (const profile of profiles) {
        const row: PairModelRow = {
            ...pairRow(profile, context.endpointHealthService?.getHealth(profile.name)),
            ...(profile.name === active && { active: true }),
        };
        if (!row.check || isOffered(row.check)) models.push(row);
        else unavailable.push({ ...row, disabled: true });
    }
    return { models, unavailable };
}

type PairModelRow = ReturnType<typeof pairRow>;

/** Every pair, in profile order, for Settings (which manages them all). */
function allEndpointModelRows(context: HandlerContext): PairModelRow[] {
    const rows = endpointModelRows(context);
    if (!rows) return [];
    const order = new Map(context.endpointService.listProfiles().profiles.map((p, i) => [p.name, i]));
    return [...rows.models, ...rows.unavailable].sort(
        (a, b) => (order.get(a.value) ?? 0) - (order.get(b.value) ?? 0)
    );
}

export async function handleGetClaudeState(
    _request: GetClaudeStateRequest,
    context: HandlerContext
): Promise<GetClaudeStateResponse> {
    const { logService } = context;

    logService.info('[handleGetClaudeState] get_claude_state');
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
 * The command list comes from the shared config (`loadSharedConfig`), which
 * the first chat launch settles from its own initialize response, and the
 * fallback probe otherwise. The handshake still answers inside one budget,
 * because the welcome gate cannot wait on a cold CLI; a cut-short answer is
 * `provisional`, and the settled config is pushed to every page the moment it
 * lands (the official `loadConfig().then(()=>this.pushStateUpdate())`), so an
 * empty "/" list is a moment, never the final answer.
 */
async function claudeStateConfig(
    context: HandlerContext
): Promise<{ config: ClaudeConfig; provisional: boolean }> {
    const { logService } = context;

    // The pairs are a read of settings and stored health, so they are ready
    // at once. The CLI is needed for the command list only.
    const rows = endpointModelRows(context);
    const settled = sharedConfig(context).settled;
    const probed = settled
        ? { value: settled, degraded: false }
        : await bounded(
            loadSharedConfig(context),
            CONFIG_PROBE_BUDGET_MS,
            { commands: [], models: [], accountInfo: null },
            (reason) => logService.warn(
                `[endpoints] the CLI config ${reason}; answering with the endpoint models now ` +
                `and pushing the command list when it lands.`
            )
        );

    // A copy: the shared config is the CLI's own answer and stays that way.
    // Never the CLI's table, which lists Anthropic tiers. No profile means no
    // models, and the chat shows its setup page instead of a picker.
    const config: ClaudeConfig = { ...probed.value, models: rows?.models ?? [] };
    delete config.unavailable_models;
    // The pairs that did not answer, greyed, as the official's unavailable
    // rows; the key is omitted when there are none, as the CLI omits it.
    if (rows?.unavailable.length) config.unavailable_models = rows.unavailable;

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
    // handled here, so giving up on a wait cannot raise an unhandled rejection
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

/**
 * How long the handshake waits for the shared config before answering
 * provisionally. The config is pushed when it settles, so this bounds only how
 * long the page waits for its first answer, never whether the "/" list fills.
 */
export const CONFIG_PROBE_BUDGET_MS = 8000;

/**
 * The official `loadConfig()` arms its fallback probe after 500ms, which gives
 * a chat launch that is already on its way the chance to claim the config.
 */
export const CONFIG_FALLBACK_PROBE_DELAY_MS = 500;

/** The official `configResolver`: who settles the pending config. */
export interface ConfigResolver {
    resolve(config: ClaudeConfig): void;
    reject(error: unknown): void;
    fallbackTimer?: ReturnType<typeof setTimeout>;
    /** Stops a fallback probe already running, once a launch has claimed it. */
    cancelProbe?: () => void;
}

interface SharedConfig {
    /** The official `this.config`: pending or settled, one per host. */
    config?: Promise<ClaudeConfig>;
    /** The official `settledConfig`. */
    settled?: ClaudeConfig;
    /** The official `configResolver`. */
    resolver?: ConfigResolver;
}

/** A fallback probe's cancel flag (the official `{cancelled, retire}`). */
interface ProbeToken {
    cancelled: boolean;
    retire?: () => void;
}

/**
 * Keyed on the context, not module-global. There is one `HandlerContext` per
 * extension host, so this is the official per-host state in production, while
 * every spec that builds its own context gets a cold CLI.
 */
let sharedConfigs = new WeakMap<HandlerContext, SharedConfig>();

function sharedConfig(context: HandlerContext): SharedConfig {
    let shared = sharedConfigs.get(context);
    if (!shared) {
        shared = {};
        sharedConfigs.set(context, shared);
    }
    return shared;
}

/** Drops every shared config, so a spec can start from a cold CLI. */
export function resetConfigProbe(): void {
    sharedConfigs = new WeakMap();
}

/**
 * The official `loadConfig()`:
 *
 *   if(this.config)return this.config;
 *   let $,Q=new Promise((X,J)=>{$={resolve:X,reject:J,fallbackTimer:void 0},
 *     this.configResolver=$,$.fallbackTimer=setTimeout((Y)=>this.startFallbackProbe(Y),500,$)})
 *     .catch((X)=>{...if(this.config===Q)this.config=void 0;
 *       if(this.configResolver===$)this.configResolver=void 0;throw X});
 *   return this.config=Q,Q.then((X)=>{if(this.config===Q)this.settledConfig=X},()=>{}),Q
 *
 * There is no give-up budget: the config is settled by the first chat launch
 * (`claimConfigResolver`) or, when none comes within 500ms, by a probe. Forge
 * adds the push on settle, because its handshake may have answered first.
 */
export function loadSharedConfig(context: HandlerContext): Promise<ClaudeConfig> {
    const shared = sharedConfig(context);
    if (shared.config) return shared.config;

    let resolver!: ConfigResolver;
    const pending: Promise<ClaudeConfig> = new Promise<ClaudeConfig>((resolve, reject) => {
        resolver = { resolve, reject };
        shared.resolver = resolver;
        resolver.fallbackTimer = setTimeout(
            () => startFallbackProbe(context, resolver),
            CONFIG_FALLBACK_PROBE_DELAY_MS
        );
    }).catch((error: unknown) => {
        context.logService.error(`Failed to load config cache: ${error}`);
        if (shared.config === pending) shared.config = undefined;
        if (shared.resolver === resolver) shared.resolver = undefined;
        throw error;
    });

    shared.config = pending;
    pending.then((value) => {
        if (shared.config !== pending) return;
        shared.settled = value;
        context.agentService.schedulePushStateUpdate?.();
    }, () => undefined);
    return pending;
}

/**
 * The official `claimConfigResolver()`: a launch takes the pending config over,
 * which cancels the fallback probe (armed or already running).
 */
export function claimConfigResolver(context: HandlerContext): ConfigResolver | undefined {
    const shared = sharedConfig(context);
    const resolver = shared.resolver;
    if (resolver) {
        clearTimeout(resolver.fallbackTimer);
        resolver.cancelProbe?.();
        shared.resolver = undefined;
    }
    return resolver;
}

/**
 * The official `releaseConfigResolver($,Q)`: a launch that cannot settle the
 * config hands it back, and the fallback probe starts at once.
 */
export function releaseConfigResolver(context: HandlerContext, resolver: ConfigResolver): void {
    const shared = sharedConfig(context);
    if (shared.resolver !== undefined) {
        resolver.reject(new Error("config invalidated mid-launch"));
        return;
    }
    resolver.cancelProbe = undefined;
    shared.resolver = resolver;
    resolver.fallbackTimer = setTimeout(() => startFallbackProbe(context, resolver), 0);
}

/** The official `startFallbackProbe($)`. */
function startFallbackProbe(context: HandlerContext, resolver: ConfigResolver): void {
    const shared = sharedConfig(context);
    if (shared.resolver !== resolver) return;

    const token: ProbeToken = { cancelled: false };
    resolver.cancelProbe = () => {
        token.cancelled = true;
        token.retire?.();
    };
    const settle = (finish: () => void) => {
        if (token.cancelled) return;
        if (shared.resolver === resolver) shared.resolver = undefined;
        finish();
    };
    loadConfig(context, token).then(
        (config) => settle(() => resolver.resolve(config)),
        (error) => settle(() => resolver.reject(error))
    );
}

/**
 * A chat launch's part (the official `launchClaude`, around
 * `C.initializationResult().then(...)`): the claimed config is settled from the
 * channel's own initialize response, so the "/" list costs no second CLI.
 *
 *   if(M(),this.configEpoch!==q)H?.reject(...);
 *   else if(H)H.resolve(p),...;
 *   else if(this.config)this.patchCachedConfig(q,()=>({models:p.models,...}))
 *
 * `M()` is the re-claim: a config asked for while this launch was spawning is
 * settled by it too. A later launch refreshes the cache instead: the official
 * patches its model lists there, and Forge's model rows come from settings,
 * so what it refreshes is the command list, which a new plugin or skill
 * changes. A launch that fails before answering hands the config back to the
 * fallback probe rather than rejecting it, so the handshake's provisional
 * answer is still followed by a real one.
 */
export async function settleConfigFromLaunch(
    context: HandlerContext,
    claimed: ConfigResolver | undefined,
    query: Query
): Promise<void> {
    let resolver = claimed;
    try {
        const init = await query.initializationResult();
        resolver ??= claimConfigResolver(context);
        const config = await configFromQuery(context, query, init);
        if (resolver) {
            resolver.resolve(config);
            return;
        }

        const shared = sharedConfig(context);
        if (shared.settled) {
            if (JSON.stringify(shared.settled.commands) === JSON.stringify(config.commands)) return;
            const patched = { ...shared.settled, commands: config.commands };
            shared.settled = patched;
            shared.config = Promise.resolve(patched);
            context.agentService.schedulePushStateUpdate?.();
        } else if (!shared.config) {
            // Nothing asked yet: this launch is the config (the official
            // startup seed), so the next ask is answered at once.
            shared.settled = config;
            shared.config = Promise.resolve(config);
            context.agentService.schedulePushStateUpdate?.();
        }
    } catch (error) {
        context.logService.warn(`[config] the launch could not settle the config: ${error}`);
        if (resolver) releaseConfigResolver(context, resolver);
    }
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
    const capabilities = request.capabilities ?? [];
    const result = await sdkService.probe({
        capabilities,
        cwd,
        // Bounded: the webview names how long a CLI may be kept alive.
        timeoutMs: clampProbeTimeout(request.timeoutMs)
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
            // Every pair, answering or not: Settings lists them all to manage.
            data: { ...result.data, supportedModels: allEndpointModelRows(context) },
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
    // B3: only the keys the Settings page writes, with the CLI's types.
    assertSettingsPageWrite(request.key, request.value, target);
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
    assertSettingsPageKey(request.key, request.target);
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
    // B3: a link in rendered output is not trusted (`webviewPaths.ts`).
    assertLocalPath(filePath, 'open_file: filePath');

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
        logService.error(`[handleOpenFile] Could not open the file: ${errorMsg}`);
        throw new Error(`Failed to open file: ${errorMsg}`);
    }
}

// The official `Ri` and `fI4` live with the tracker that uses them (`xd0`);
// re-exported so existing callers keep their import.
export { selectionFromEditor } from '../editorSelection';

/**
 * The official `get_current_selection`: the tracked selection (`()=>FK`),
 * which survives focus moving into a chat tab, where `activeTextEditor` is
 * `undefined`. Before tracking starts (a spec, or a host that never started
 * it) the active editor answers, as it used to.
 */
export async function handleGetCurrentSelection(
    _context: HandlerContext
): Promise<GetCurrentSelectionResponse> {
    const tracked = getTrackedSelection();
    const editor = vscode.window.activeTextEditor;
    return {
        type: "get_current_selection_response",
        selection: tracked ?? (editor ? selectionFromEditor(editor) : null)
    };
}

/**
 * 显示通知
 */
/** The most buttons a webview notification may carry; VS Code shows only a few. */
export const MAX_NOTIFICATION_BUTTONS = 5;

/**
 * The official `show_notification`, minus `onlyIfNotVisible` and the reveal on
 * a button: Forge's webview sends neither (every caller passes a message and a
 * severity), so both branches would be unreachable.
 *
 * B3: the message is a string, the buttons strings. The official spreads
 * whatever `buttons` is, so a string there became one button per character.
 */
export async function handleShowNotification(
    request: ShowNotificationRequest,
    _context: HandlerContext
): Promise<ShowNotificationResponse> {
    const { severity } = request;
    if (typeof request.message !== 'string') {
        throw new Error('show_notification: message is not a string');
    }
    const message = request.message;
    const buttons = Array.isArray(request.buttons)
        ? request.buttons.filter((b): b is string => typeof b === 'string').slice(0, MAX_NOTIFICATION_BUTTONS)
        : [];

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
 * `openNewInTab` for the webview asking: true for a chat in an editor tab.
 *
 * The official builds one host per webview with `openNewInTab = !!panelTab`
 * (`super(Q,QX(Y),X,!!Z,…)` in `class r8 extends kD`, where `Z` is the editor
 * panel, `void 0` for a side-bar view), and answers `init` with it. It used to
 * be hard-coded `false`, so a chat in a tab never opened new conversations as
 * tabs and never retitled its tab.
 */
export function isEditorTabChat(webviewId: string | undefined): boolean {
    return typeof webviewId === "string" && webviewId.startsWith("editor:chat:");
}

/**
 * 新建会话标签页
 *
 * The official handler:
 *
 *   else if($.request.type==="new_conversation_tab"){
 *     if($.request.sessionId!==void 0&&!cq($.request.sessionId))return{type:"new_conversation_tab_response"};
 *     return await E$.commands.executeCommand("claude-vscode.editor.open",$.request.sessionId,$.request.initialPrompt,…),
 *            {type:"new_conversation_tab_response"}}
 *
 * The webview sends it only when `openNewInTab` (a chat in a tab), from the
 * header's New session button and "/" → New conversation. Forge's request
 * carries no `sessionId` (the fork-into-a-tab branch is not ported), and
 * `forge.editor.open` takes no arguments, so a new, empty tab opens.
 */
export async function handleNewConversationTab(
    _request: NewConversationTabRequest,
    _context: HandlerContext
): Promise<NewConversationTabResponse> {
    await vscode.commands.executeCommand("forge.editor.open");
    return { type: "new_conversation_tab_response" };
}

/** The official `ls$`: `rename_tab` keeps at most this many code points (`GX`). */
export const MAX_TAB_TITLE_LENGTH = 200;

/**
 * Retitle the editor tab the chat is in. The official handler:
 *
 *   else if($.request.type==="rename_tab"){
 *     if(this.panelTab&&typeof $.request.title==="string")this.panelTab.title=GX($.request.title),…;
 *     return{type:"rename_tab_response"}}
 *
 * `GX` keeps the first 200 code points. The webview sends it only when
 * `openNewInTab` (a chat in a tab); for any other webview there is no panel,
 * and nothing changes. It used to do nothing at all.
 */
export async function handleRenameTab(
    request: RenameTabRequest,
    context: HandlerContext,
    webviewId?: string
): Promise<RenameTabResponse> {
    if (webviewId && typeof request.title === "string") {
        context.webViewService.renamePanel(webviewId, [...request.title].slice(0, MAX_TAB_TITLE_LENGTH).join(""));
    }
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

    // B3 (`webviewPaths.ts`): both paths are read into the diff's two sides.
    // A new file has no original, so one of the two may be empty, not both.
    if (!request.originalFilePath && !request.newFilePath) throw new Error('open_diff: no file path.');
    if (request.originalFilePath) assertLocalPath(request.originalFilePath, 'open_diff: originalFilePath');
    if (request.newFilePath) assertLocalPath(request.newFilePath, 'open_diff: newFilePath');
    assertDiffEdits(request.edits);

    logService.info(`Opening diff for: ${request.originalFilePath}`);

    const fallbackNewPath = request.newFilePath ? fileSystemService.resolveFilePath(request.newFilePath, cwd) : undefined;
    // `resolveFilePath('')` is the cwd, a directory: a new file's left side is
    // its own path, which does not exist yet and so opens empty.
    const originalPath = request.originalFilePath
        ? fileSystemService.resolveFilePath(request.originalFilePath, cwd)
        : fallbackNewPath!;

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
/**
 * Forge-only: the mode menu's Expert row (production audit, Phase 6, item 2).
 *
 * The webview is untrusted input (B3): `enabled` must be a boolean and the
 * channel one Forge is running; the output style is the fixed
 * `forge:Expert` (or none), never a value from the request.
 */
export async function handleSetExpertMode(
    request: SetExpertModeRequest,
    context: HandlerContext
): Promise<SetExpertModeResponse> {
    if (typeof request.enabled !== "boolean") {
        throw new Error("set_expert_mode: enabled must be true or false");
    }
    if (typeof request.channelId !== "string" || !request.channelId) {
        throw new Error("set_expert_mode: a running session is required");
    }
    await context.agentService.setExpertMode(request.channelId, request.enabled);
    return { type: "set_expert_mode_response", enabled: request.enabled };
}

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
 *                              await this.settings.unarchiveSession($);
 *                              let Q=[$], X=await this.teleportOriginOf($);
 *                              if(X) Q.push(`${UG}${X}`);
 *                              let J=this.settings.getSessionGroups(), Y=tY(J,Q);
 *                              if(Y) await this.settings.setSessionGroups(Y); … }
 *
 * The id comes back ungrouped: it is pruned out of every session group
 * (production audit, Phase 6). Forge has no teleported sessions, so there is
 * no `remote:` origin to prune with it.
 */
export async function handleUnarchiveSession(
    request: UnarchiveSessionRequest,
    context: HandlerContext
): Promise<UnarchiveSessionResponse> {
    const id = validSessionId(request.sessionId);
    if (id === null) return { type: "unarchive_session_response" };
    try {
        await context.sdkService.getArchivedSessionStore().unarchiveSession(id);
        const groups = context.sdkService.getSessionGroupStore();
        const pruned = withoutSessions(groups.getSessionGroups(), [id]);
        if (pruned) await groups.setSessionGroups(pruned);
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
 * The session groups and the list's section collapse state (production audit,
 * Phase 6), as the official host answers them:
 *
 *   async getSessionGroups(){ let $=this.settings.getSessionGroups(),
 *                                 Q=new Set(this.settings.getArchivedSessionIds());
 *                             return {type:"get_session_groups_response", groups:tY($,Q)??$,
 *                                     sectionCollapseState:this.settings.getSessionSectionCollapseState()} }
 *
 * Archived sessions are left out of the groups on the way out, not in storage.
 */
export async function handleGetSessionGroups(
    _request: GetSessionGroupsRequest,
    context: HandlerContext
): Promise<GetSessionGroupsResponse> {
    const store = context.sdkService.getSessionGroupStore();
    const groups = store.getSessionGroups();
    const archived = context.sdkService.getArchivedSessionStore().getArchivedSessionIdSet();
    return {
        type: "get_session_groups_response",
        groups: withoutSessions(groups, archived) ?? groups,
        sectionCollapseState: store.getSessionSectionCollapseState(),
    };
}

/**
 *   async updateSessionGroups($){ let Q=VG($), X=new Set(this.settings.getArchivedSessionIds());
 *                                 return await this.settings.setSessionGroups(tY(Q,X)??Q),
 *                                        {type:"update_session_groups_response"} }
 *
 * `groups` is untrusted: `VG` keeps what fits the schema (at most 100 groups,
 * names trimmed to 100 code points, 1..200 character ids, at most 1000 session
 * ids, each once) and anything that is not an array becomes no groups. The
 * stored list never holds an archived session.
 */
export async function handleUpdateSessionGroups(
    request: UpdateSessionGroupsRequest,
    context: HandlerContext
): Promise<UpdateSessionGroupsResponse> {
    const groups = normalizeSessionGroups((request as { groups?: unknown }).groups);
    const archived = context.sdkService.getArchivedSessionStore().getArchivedSessionIdSet();
    await context.sdkService.getSessionGroupStore().setSessionGroups(withoutSessions(groups, archived) ?? groups);
    return { type: "update_session_groups_response" };
}

/**
 *   async updateSessionSectionCollapseState($){ let Q=M7$($);
 *     if(Object.keys(Q).length>0) await this.settings.setSessionSectionCollapseState(
 *                                     L7$(this.settings.getSessionSectionCollapseState(),Q));
 *     return {type:"update_session_section_collapse_state_response"} }
 *
 * Only a boolean `ungroupedCollapsed` / `archivedCollapsed` is taken; a patch
 * with neither writes nothing.
 */
export async function handleUpdateSessionSectionCollapseState(
    request: UpdateSessionSectionCollapseStateRequest,
    context: HandlerContext
): Promise<UpdateSessionSectionCollapseStateResponse> {
    const patch = sectionCollapsePatch((request as { patch?: unknown }).patch);
    if (Object.keys(patch).length > 0) {
        const store = context.sdkService.getSessionGroupStore();
        await store.setSessionSectionCollapseState({ ...store.getSessionSectionCollapseState(), ...patch });
    }
    return { type: "update_session_section_collapse_state_response" };
}

/**
 *   case"get_collapsed_panel_sections": return {type:"get_collapsed_panel_sections_response",
 *                                               sections:this.settings.getCollapsedPanelSections()};
 */
export async function handleGetCollapsedPanelSections(
    _request: GetCollapsedPanelSectionsRequest,
    context: HandlerContext
): Promise<GetCollapsedPanelSectionsResponse> {
    return {
        type: "get_collapsed_panel_sections_response",
        sections: context.sdkService.getSessionGroupStore().getCollapsedPanelSections(),
    };
}

/**
 *   case"update_collapsed_panel_sections":{ let X=Lf$($.request.toggle);
 *     if(X) await this.settings.setCollapsedPanelSections(Df$(this.settings.getCollapsedPanelSections(),X));
 *     return {type:"update_collapsed_panel_sections_response"} }
 *
 * A toggle naming anything but "usage" or "sessions", or without a boolean,
 * writes nothing.
 */
export async function handleUpdateCollapsedPanelSections(
    request: UpdateCollapsedPanelSectionsRequest,
    context: HandlerContext
): Promise<UpdateCollapsedPanelSectionsResponse> {
    const toggle = panelSectionToggle((request as { toggle?: unknown }).toggle);
    if (toggle) {
        const store = context.sdkService.getSessionGroupStore();
        await store.setCollapsedPanelSections(applyPanelSectionToggle(store.getCollapsedPanelSections(), toggle));
    }
    return { type: "update_collapsed_panel_sections_response" };
}

/**
 * 获取会话详情
 */
export async function handleGetSession(
    request: GetSessionRequest,
    context: HandlerContext
): Promise<GetSessionResponse> {
    const { logService, sessionService, workspaceService } = context;

    // B3: the id names a file under the project's history. A path, or anything
    // that is not a session id, is refused before it reaches the disk.
    const sessionId = validSessionId(request.sessionId);
    if (!sessionId) {
        throw new Error('get_session_request: sessionId is not a session id');
    }

    try {
        const cwd = workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath || process.cwd();
        const messages = await sessionService.getSession(sessionId, cwd);

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
    // B3: bounded, and never a network path (`webviewPaths.ts`), which on
    // Windows would authenticate to that host just to stat it.
    const paths = Array.isArray(request.paths) ? request.paths.slice(0, MAX_STAT_PATHS) : [];

    const entries: StatPathResponse["entries"] = [];

    for (const raw of paths) {
        if (!raw || typeof raw !== "string") {
            continue;
        }
        if (!isLocalPath(raw)) {
            entries.push({ path: raw, type: "other" });
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
    // B3: bounded content; the name only ever becomes a sanitized temp file name.
    assertOpenContent(content, fileName, editable);

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
    _context: HandlerContext
): Promise<OpenURLResponse> {
    const { url } = request;

    // B3, stricter than the official (which hands any scheme to openExternal):
    // links reach this from rendered model output, and a `file:` or `command:`
    // link there must not launch anything. Web and mail links only.
    if (!isOpenableUrl(url)) {
        throw new Error('Only http, https and mailto links can be opened.');
    }

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
    // "Start new session in this group": the group must be one the host
    // stores. Any other reveal clears a group still waiting for its session.
    const groupId = request.groupId;
    if (groupId !== undefined && !isGroupKey(groupId)) {
        throw new Error('reveal_chat: groupId is not a group id');
    }
    const joins = request.newConversation && !sessionId && groupId !== undefined
        && context.sdkService.getSessionGroupStore().getSessionGroups().some((group) => group.id === groupId);
    context.agentService.setPendingGroup(joins ? groupId : undefined);
    context.logService.info(
        `[reveal_chat] newConversation=${Boolean(request.newConversation)} ` +
        `session=${sessionId ?? '-'} fromView=${Boolean(request.fromView)} group=${joins ? groupId : '-'}`
    );
    // Told before it is revealed, so the chat is ready to play its entrance
    // on the frame it becomes visible rather than one frame late.
    if (request.fromView) {
        context.agentService.notifyClient({ type: 'ui_command', command: 'arrive' });
    }
    const reveal = vscode.commands.executeCommand(
        request.newConversation && !sessionId ? 'forge.newConversation' : 'forge.sidebar.open'
    );

    // The request came from the sessions view in the primary side bar. With
    // the chat in the secondary one, the history that launched it has served
    // its purpose, so the primary side bar closes.
    //
    // Only then. With the chat in the primary side bar this would close what
    // is being revealed; and the history opened as an editor tab
    // ("Forge: Past Conversations") is not in a side bar at all, so closing one
    // would take away Explorer or whatever else is there.
    //
    // "Very very fast" (2026-09-24): it no longer waits for the reveal. The
    // side bar goes as soon as the history's own short exit has played, while
    // the chat is still being shown, so the two panels move together rather
    // than one after the other.
    //
    // Settled on its own: if the reveal below rejects, this promise is never
    // awaited, and an uncaught rejection from it would be reported against the
    // extension (production audit, 2026-09-24).
    const closing = request.fromView && chatLivesInSecondarySideBar()
        ? delay(Math.max(0, SIDEBAR_HANDOFF_MS - (Date.now() - startedAt)))
            .then(() => vscode.commands.executeCommand('workbench.action.closeSidebar'))
            .then(undefined, (error: unknown) => {
                context.logService.warn(`[reveal_chat] could not close the side bar: ${error instanceof Error ? error.message : String(error)}`);
            })
        : undefined;

    await reveal;

    // A row in the history names a conversation. The chat opens it the way its
    // own dropdown does (`activateSessionFromServer`); before this the id was
    // dropped here and the chat simply stayed on whatever it had.
    if (sessionId) {
        context.agentService.notifyClient({ type: 'ui_command', command: 'open_session', sessionId });
    }

    await closing;
    return { type: "reveal_chat_response" };
}

/**
 * How long the host waits before closing the side bar it handed off from.
 *
 * Paired with `--forge-handoff-duration` in `forge-design.css`: the webview
 * fades the history out over that long, and the panel must not be taken away
 * mid-fade. Keep this the longer of the two if they ever drift. Two frames
 * since 2026-09-24 ("very very fast"), down from 70ms.
 */
export const SIDEBAR_HANDOFF_MS = 30;

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
    _context: HandlerContext
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
/** The official `openOutputPanel(){this.output.show()}`: the Forge output channel. */
export async function handleOpenOutputPanel(
    _request: OpenOutputPanelRequest,
    context: HandlerContext
): Promise<OpenOutputPanelResponse> {
    context.logService.show();
    return { type: "open_output_panel_response" };
}

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
 * The official `spawnConfigProbe($)`: a CLI launched for its initialize
 * response alone.
 *
 * Its stdin stays open until the reads are done, and closes in the official
 * `z` (`J.done(),Y.return()`). Closing it straight after the launch, as this
 * used to, hands a cold CLI an end of input before it has answered
 * `initialize`: it exits, and the SDK rejects with "Query closed before
 * response received" -- the empty "/" list a fresh install showed.
 */
async function loadConfig(context: HandlerContext, token: ProbeToken = { cancelled: false }): Promise<ClaudeConfig> {
    const { logService, sdkService, workspaceService } = context;

    logService.info("Loading config cache by launching Claude (no channel)...");

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

    let retired = false;
    const retire = () => {
        if (retired) return;
        retired = true;
        inputStream.done();
        void Promise.resolve(query.return?.(undefined)).catch(() => undefined);
    };
    if (token.cancelled) {
        retire();
        throw new Error("config probe cancelled");
    }
    token.retire = retire;

    try {
        const init = await query.initializationResult();
        if (token.cancelled) throw new Error("config probe cancelled");
        const config = await configFromQuery(context, query, init);
        if (token.cancelled) throw new Error("config probe cancelled");
        logService.info(`  - Config: ${summarizeConfig(config)}`);
        logService.trace(`  - Config (full): ${JSON.stringify(config)}`);
        return config;
    } finally {
        retire();
    }
}

/**
 * The config the webview reads, from a CLI's initialize response: the probe's
 * and a chat launch's alike.
 *
 * The official webview takes `claudeConfig.models` and
 * `claudeConfig.unavailable_models` straight from the initialize response
 * (`initializationResult()`, `sdk.d.ts` L2769); `supportedModels()` is
 * `models` alone, so it would lose the greyed rows.
 */
export async function configFromQuery(
    context: HandlerContext,
    query: Query,
    init: SDKControlInitializeResponse
): Promise<ClaudeConfig> {
    const { logService } = context;
    const unavailable = (init as { unavailable_models?: unknown }).unavailable_models;

    const config: ClaudeConfig = {
        // Official field name: the CLI's initialize response carries `commands`
        // (SDKControlInitializeResponse), which the official webview reads as
        // `claudeConfig.commands`. `supportedCommands()` returns that list, or
        // the newer one a `commands_changed` message brought.
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

    // The official also reads `getSettings()` and keeps it as
    // `claudeSettings`: the effort control seeds from `applied`, and Ultracode
    // is gated on `effective.disableWorkflows`.
    try {
        const claudeSettings = toClaudeSettingsSnapshot(await readClaudeSettings(query));
        if (claudeSettings) config.claudeSettings = claudeSettings;
        // The official keeps this read as `cachedClaudeSettings` (the bypass gate).
        context.agentService.noteClaudeSettings(claudeSettings);
    } catch (error) {
        logService.warn(`Failed to read Claude settings for the config: ${error}`);
    }

    return config;
}

/**
 * 获取 MCP 服务器状态
 */
/**
 * The official `getMcpServers`:
 *
 *   async getMcpServers($){return this.withChannel($,async(Q)=>{try{
 *     return{type:"get_mcp_servers_response",
 *            mcpServers:(await Q.query.mcpServerStatus()).filter((J)=>J.name!=="claude-vscode")}}
 *   catch(X){return this.logger.error("Failed to get MCP server status",String(X)),
 *            {type:"get_mcp_servers_response",error:X instanceof Error&&X.message||String(X)}}})}
 *
 * `withChannel` throws for a channel that does not exist; a CLI that cannot
 * answer is an `error` field, not a thrown request. It used to be a
 * hard-coded `[]`.
 */
async function getMcpServers(
    context: HandlerContext,
    channelId?: string
): Promise<GetMcpServersResponse> {
    if (!channelId) {
        throw new Error('get_mcp_servers: a channel is required');
    }
    const statusOf = context.agentService.mcpServerStatusFor(channelId);
    try {
        return {
            type: "get_mcp_servers_response",
            mcpServers: (await statusOf()).filter((server) => server.name !== "claude-vscode")
        };
    } catch (error) {
        context.logService.error(`Failed to get MCP server status: ${String(error)}`);
        return {
            type: "get_mcp_servers_response",
            error: (error instanceof Error && error.message) || String(error)
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

    // The extension's own folder: `process.cwd()` is wherever VS Code was
    // started from, so the mark never loaded in an installed build.
    const extensionPath = context.sdkService.asAbsolutePath('.');

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

/** The schemes `open_url` hands to the OS: web and mail, nothing that runs. */
const OPENABLE_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

export function isOpenableUrl(url: unknown): url is string {
    if (typeof url !== 'string') return false;
    try {
        return OPENABLE_SCHEMES.has(new URL(url).protocol);
    } catch {
        return false;
    }
}

/** `sdk_probe`'s timeout: 1 to 60 seconds, 10 when unset or not a number. */
export function clampProbeTimeout(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 10_000;
    return Math.min(60_000, Math.max(1_000, Math.round(value)));
}

/**
 * One line for the config-probe log: each list as a count, each other field
 * by name. The whole object (every model, slash command and agent) went to
 * the output channel at info on every probe; it is at trace now.
 */
export function summarizeConfig(config: unknown): string {
    if (!config || typeof config !== "object") return String(config);
    const parts: string[] = [];
    for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) parts.push(`${key}: ${value.length}`);
        else if (value !== null && typeof value === "object") parts.push(`${key}: {${Object.keys(value).length} keys}`);
        else parts.push(`${key}: ${String(value)}`);
    }
    return parts.join(", ");
}
