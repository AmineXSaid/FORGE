import { signal } from "alien-signals";
import { AsyncQueue } from "./AsyncQueue";
import { EventEmitter } from "../utils/events";
import { PermissionRequest } from "../core/PermissionRequest";
import { escapeBidiControls } from "../core/permissionPrompt";
import type { PermissionBehavior, PermissionResult, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type {
  AddPermissionRulesResponse,
  EditableRuleDestination,
  EndpointAction,
  ForgeAction,
  ForgeItemKind,
  RunForgeActionResponse,
  ListForgeItemsResponse,
  ListPluginsResponse,
  ListMarketplacesResponse,
  InstallPluginResponse,
  UninstallPluginResponse,
  UpdatePluginResponse,
  SetPluginEnabledResponse,
  AddMarketplaceResponse,
  RemoveMarketplaceResponse,
  RefreshMarketplaceResponse,
  PluginInstallScope,
  EndpointHealth,
  GetEndpointHealthResponse,
  SyncEndpointHealthResponse,
  ListPermissionRulesResponse,
  PlanComment,
  SetPermissionModeResponse,
  RemovePermissionRuleResponse,
  RenameSessionResponse,
  ArchiveSessionResponse,
  UnarchiveSessionResponse,
  SetSessionUnreadResponse,
  RewindCodeResponse,
  ForkConversationResponse,
  EnsureChromeMcpEnabledResponse,
  DisableChromeMcpResponse,
  CreateNewBrowserTabResponse,
  GetOutputStyleResponse,
  GetOutputStyleLocationsResponse,
  CreateOutputStyleResponse,
  CreateOutputStyleResult,
  OutputStyleDraftPayload,
  AppliedSettings,
  ExtensionRequestResponse,
  ExtensionToWebViewMessage,
  GetAppliedSettingsResponse,
  GetClaudeStateResponse,
  InitResponse,
  RequestMessage,
  SdkProbeResponse,
  ToolPermissionRequest,
  WebViewToExtensionMessage,
  WebViewRequest,
  ShowNotificationRequest,
  UiCommandName,
  ForgeSettingsTab,
  OpenForgeSettingsResponse,
  OpenConfigResponse,
  OpenHelpResponse,
  OpenOutputPanelResponse,
} from "../../../shared/messages";
import { isForgeSettingsTab } from "../../../shared/messages";

type ConnectionState = "connecting" | "connected" | "disconnected";

/**
 * How long to leave a provisional config alone before asking again.
 *
 * Long enough that the probe the host is still running has a real chance of
 * having landed, short enough that nobody settles into believing the empty
 * picker. The host serves a completed probe from cache, so a retry that lands
 * after it finished is answered immediately.
 */
export const CLAUDE_STATE_REFRESH_DELAY_MS = 4000;

/** How many times a provisional answer is chased before it is taken as final. */
export const CLAUDE_STATE_REFRESH_ATTEMPTS = 3;

interface RequestHandler {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

/**
 * WebView ↔ Extension 传输抽象基类
 * - 使用 alien-signals 管理状态（统一架构）
 */
/** How long a mention sent to a hidden chat is kept for it (the official `JF`). */
export const PENDING_AT_MENTION_MS = 15_000;

export abstract class BaseTransport {
  readonly state = signal<ConnectionState>("connecting");
  readonly isVisible = signal(true);
  /** Mentions sent while the chat was hidden (the official `pendingAtMentions`). */
  private pendingAtMentions: Array<{ text: string; at: number }> = [];
  readonly permissionRequests = signal<PermissionRequest[]>([]);
  /** The official `planCommentsByChannel`: comments made in each channel's plan preview. */
  readonly planCommentsByChannel = signal<Map<string, PlanComment[]>>(new Map());
  readonly config = signal<InitResponse["state"] | undefined>(undefined);
  readonly claudeConfig = signal<GetClaudeStateResponse["config"] | undefined>(undefined);

  /**
   * The official `openSessionIds` / `unreadSessionKeys`, filled by the
   * `session_states_update` push (step 22).
   *
   * Both start `undefined` on purpose: that is the official's "feed not ready"
   * state. While every feed is undefined the list draws no status dot at all
   * (`a6` returns early), and `reportActiveSessionUnread` answers
   * `"feed_not_ready"` instead of sending. The host pushes on `init`, so the
   * gap only lasts until the first answer.
   */
  readonly openSessionIds = signal<string[] | undefined>(undefined);
  readonly unreadSessionKeys = signal<string[] | undefined>(undefined);

  /**
   * Endpoint health, filled by `get_endpoint_health` and kept current by the
   * host's `endpoint_health_update` push.
   *
   * `undefined` while nothing has answered, on the same discipline as the feeds
   * above: the welcome gate reads it, and zero-healthy is a state that holds
   * the whole surface, so it must never be guessed before the host has spoken.
   */
  readonly endpointHealth = signal<EndpointHealth[] | undefined>(undefined);

  /**
   * The official `sessionStoreChanges`: a counter the `session_store_changed`
   * push bumps. The session store watches it and re-reads the list, so a
   * conversation created or deleted anywhere shows up without a reload.
   */
  readonly sessionStoreChanges = signal(0);

  private initPromise?: Promise<void>;
  private initialized = false;

  get opened(): Promise<void> {
    return this.ensureInitialized();
  }
  get closed(): Promise<void> {
    return Promise.resolve();
  }

  readonly permissionRequested: EventEmitter<PermissionRequest> =
    new EventEmitter<PermissionRequest>();

  readonly extensionConfigChanged: EventEmitter<{ key: string; value: any }> =
    new EventEmitter<{ key: string; value: any }>();

  /**
   * The official `sessionRenamedEvents`: a title that landed on disk, pushed
   * back so the list adopts it (`adoptPersistedTitle`). Step 20.
   */
  readonly sessionRenamedEvents: EventEmitter<{ sessionId: string; title: string }> =
    new EventEmitter<{ sessionId: string; title: string }>();

  /**
   * UI commands driven by VS Code commands and keybindings (forge.focus,
   * forge.newConversation, ...). One-way: the extension notifies, the webview
   * acts, and nothing is sent back.
   */
  readonly uiCommand: EventEmitter<UiCommandName> = new EventEmitter<UiCommandName>();
  /** `ui_command open_session`: a history row asked the chat to open this conversation. */
  readonly openSessionRequested: EventEmitter<string> = new EventEmitter<string>();

  /**
   * Step 31: the host asking the Settings page to select a tab. Sent only when
   * a Settings panel that is already open gets revealed -- a new one is told
   * through its bootstrap instead.
   */
  readonly selectSettingsTab: EventEmitter<ForgeSettingsTab> = new EventEmitter<ForgeSettingsTab>();

  protected readonly fromHost = new AsyncQueue<ExtensionToWebViewMessage>();
  protected readonly streams = new Map<string, AsyncQueue<any>>();
  protected readonly outstandingRequests = new Map<string, RequestHandler>();

  constructor(
    protected readonly atMentionEvents: EventEmitter<string>,
    protected readonly selectionChangedEvents: EventEmitter<any>
  ) {
    void this.readMessages();
  }

  protected abstract send(message: WebViewToExtensionMessage): void;

  async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (!this.initPromise) {
      this.initPromise = this.initialize()
        .then(() => {
          this.initialized = true;
        })
        .catch((error) => {
          this.initPromise = undefined;
          throw error;
        });
    }

    return this.initPromise;
  }

  async initialize(): Promise<void> {
    const initResponse = await this.sendRequest<InitResponse>({ type: "init" });
    // Spread, rather than copying field by field.
    //
    // This used to rebuild the object one property at a time behind an
    // `as InitResponse["state"]` cast, so a field added host-side reached the
    // webview as `undefined` and the cast kept the typechecker quiet about it.
    // `endpointProfileCount` was dropped exactly that way. The only thing worth
    // overriding is the one default this has always applied.
    this.config({
      ...initResponse.state,
      openNewInTab: initResponse.state.openNewInTab ?? false,
      // Step 28. The official keeps this on `connection.config`, refreshed by
      // the host's `update_state` push; Forge has no such push, so the value is
      // whatever `init` answered -- re-send `init` to refresh it.
      browserIntegrationSupported: initResponse.state.browserIntegrationSupported ?? false,
      // Step 30: the persisted Focus view preference, so the transcript opens
      // in the state the host recorded.
      focusViewEnabled: initResponse.state.focusViewEnabled ?? false,
    });

    // The handshake must not be able to end here without a config.
    //
    // `claudeConfig` left `undefined` is what the model picker renders as a
    // permanent "Loading models…", and what the welcome gate reads as "not
    // known yet" rather than "no models" -- so a host that threw took both
    // surfaces down at once and left no way back, since nothing re-runs
    // `initialize()`. An empty config is a worse answer than the real one and a
    // far better one than none: the picker says "No models available" and the
    // welcome page offers to set an endpoint up.
    const claudeState = await this.sendRequest<GetClaudeStateResponse>({
      type: "get_claude_state",
    }).catch((error) => {
      console.error("[forge] get_claude_state failed; continuing with an empty config", error);
      return undefined;
    });

    this.claudeConfig(claudeState?.config ?? { commands: [], models: [], accountInfo: null });
    this.state("connected");

    // Answered, but only provisionally: a probe was cut short, so the real
    // models or commands may still be on their way. Asking again costs the user
    // nothing now that the UI is already up.
    if (claudeState?.provisional) this.refreshClaudeState();
  }

  private claudeStateRefreshes = 0;

  /**
   * Ask again for a config the host could only answer provisionally.
   *
   * The host bounds its own handshake so it always answers, which means a slow
   * CLI probe comes back as an empty model list rather than not at all. It
   * keeps that probe running behind the answer it gave, so asking again once
   * the probe has had time to land turns the empty picker into the real one --
   * without the webview ever having waited on it. Bounded attempts, because a
   * genuinely empty gateway is also a legitimate answer and polling it forever
   * would never learn anything new.
   */
  private refreshClaudeState(): void {
    if (this.claudeStateRefreshes >= CLAUDE_STATE_REFRESH_ATTEMPTS) return;
    this.claudeStateRefreshes += 1;

    setTimeout(() => {
      this.sendRequest<GetClaudeStateResponse>({ type: "get_claude_state" })
        .then((state) => {
          this.claudeConfig(state.config);
          if (state.provisional) this.refreshClaudeState();
        })
        // The answer already on screen stands; a failed retry is not worse news
        // than the provisional one it was trying to improve on.
        .catch(() => undefined);
    }, CLAUDE_STATE_REFRESH_DELAY_MS);
  }

  launchClaude(
    channelId: string,
    resume?: string,
    cwd?: string,
    model?: string,
    permissionMode?: PermissionMode,
    thinkingLevel?: string
  ): AsyncQueue<any> {
    const queue = new AsyncQueue<any>();
    this.streams.set(channelId, queue);
    this.send({
      type: "launch_claude",
      channelId,
      resume,
      cwd,
      model,
      permissionMode,
      thinkingLevel,
    });
    return queue;
  }

  sendInput(channelId: string, message: any, done: boolean): void {
    this.send({ type: "io_message", channelId, message, done });
  }

  interruptClaude(channelId: string): void {
    this.send({ type: "interrupt_claude", channelId });
  }

  openFile(filePath: string, location?: any): Promise<any> {
    return this.sendRequest({ type: "open_file", filePath, location });
  }
  openConfigFile(configType: string): Promise<any> {
    return this.sendRequest({ type: "open_config_file", configType });
  }
  /**
   * Step 31: open Forge's Settings page on a tab. The host decides what a tab
   * id means and falls back to General for anything it does not know, so the
   * answer says which tab was actually opened.
   *
   * This replaced the endpoints line's `openSettings(section)`: same rows, same
   * destination, but the tab comes from the closed `FORGE_SETTINGS_TABS` set
   * rather than a free string, and the host echoes back what it opened.
   */
  openForgeSettings(tab?: ForgeSettingsTab): Promise<OpenForgeSettingsResponse> {
    return this.sendRequest<OpenForgeSettingsResponse>({ type: "open_forge_settings", tab });
  }
  /**
   * Step 32, the official `openConfig($)` / `openHelp()` (index.js @3322678).
   * Both "/" rows call them with no argument, so the host's defaults are what
   * ship: its own settings prefix, and the docs URL.
   */
  openConfig(searchString?: string): Promise<OpenConfigResponse> {
    return this.sendRequest<OpenConfigResponse>({ type: "open_config", searchString });
  }
  openHelp(): Promise<OpenHelpResponse> {
    return this.sendRequest<OpenHelpResponse>({ type: "open_help" });
  }
  /** The official `openOutputPanel()`: the error banner's "View output logs". */
  openOutputPanel(): Promise<OpenOutputPanelResponse> {
    return this.sendRequest<OpenOutputPanelResponse>({ type: "open_output_panel" });
  }
  /**
   * One of the endpoint tools, named by what it does.
   *
   * Not a command id: the webview naming what the host executes is the thing
   * B3 forbids, which is why the `command:` escape hatch in `open_config_file`
   * is gone. The host owns the action → command mapping.
   */
  runEndpointAction(action: EndpointAction): Promise<any> {
    return this.sendRequest({ type: "run_endpoint_action", action });
  }

  /**
   * The Settings page's create and add buttons. Answers when the guided flow
   * ends, saved or dismissed, so the caller can refresh what it lists then.
   */
  runForgeAction(action: ForgeAction): Promise<RunForgeActionResponse> {
    return this.sendRequest<RunForgeActionResponse>({ type: "run_forge_action", action });
  }

  /** The skills or subagents the CLI would load here, project ones first. */
  listForgeItems(kind: ForgeItemKind): Promise<ListForgeItemsResponse> {
    return this.sendRequest<ListForgeItemsResponse>({ type: "list_forge_items", kind });
  }

  /** Forge-only: ask the host to turn bypass permissions on (it confirms first). */
  async enableBypassPermissions(): Promise<boolean> {
    const response = await this.sendRequest<{ enabled?: boolean }>({ type: "enable_bypass_permissions" });
    return response?.enabled === true;
  }

  // The official plugin manager's senders: same names, same payloads.
  listPlugins(options?: { includeAvailable?: boolean }): Promise<ListPluginsResponse> {
    return this.sendRequest<ListPluginsResponse>({ type: "list_plugins", includeAvailable: options?.includeAvailable });
  }
  listMarketplaces(): Promise<ListMarketplacesResponse> {
    return this.sendRequest<ListMarketplacesResponse>({ type: "list_marketplaces" });
  }
  installPlugin(pluginId: string, scope: PluginInstallScope): Promise<InstallPluginResponse> {
    return this.sendRequest<InstallPluginResponse>({ type: "install_plugin", pluginId, scope });
  }
  uninstallPlugin(pluginId: string): Promise<UninstallPluginResponse> {
    return this.sendRequest<UninstallPluginResponse>({ type: "uninstall_plugin", pluginId });
  }
  updatePlugin(pluginId: string, scope: PluginInstallScope): Promise<UpdatePluginResponse> {
    return this.sendRequest<UpdatePluginResponse>({ type: "update_plugin", pluginId, scope });
  }
  setPluginEnabled(pluginId: string, enabled: boolean): Promise<SetPluginEnabledResponse> {
    return this.sendRequest<SetPluginEnabledResponse>({ type: "set_plugin_enabled", pluginId, enabled });
  }
  addMarketplace(source: string): Promise<AddMarketplaceResponse> {
    return this.sendRequest<AddMarketplaceResponse>({ type: "add_marketplace", source });
  }
  removeMarketplace(marketplaceId: string): Promise<RemoveMarketplaceResponse> {
    return this.sendRequest<RemoveMarketplaceResponse>({ type: "remove_marketplace", marketplaceId });
  }
  refreshMarketplace(marketplaceId: string): Promise<RefreshMarketplaceResponse> {
    return this.sendRequest<RefreshMarketplaceResponse>({ type: "refresh_marketplace", marketplaceId });
  }
  /**
   * What each endpoint's models did when they were last asked to serve.
   *
   * A pure read host-side: no probe, no network, so calling it on render costs
   * nothing. `profileName` narrows to one profile and is validated against the
   * host's own profile list -- an unknown name is rejected, which is why this
   * goes through `runHostAction` at every call site.
   */
  getEndpointHealth(profileName?: string): Promise<GetEndpointHealthResponse> {
    return this.sendRequest<GetEndpointHealthResponse>({ type: "get_endpoint_health", profileName });
  }
  /**
   * Sweep now, or cancel the sweep in flight.
   *
   * Every probe is a billable completion on a paid endpoint, so this is only
   * ever sent from a button the user pressed. Progress arrives on the
   * `endpoint_health_update` push while it runs.
   */
  syncEndpointHealth(profileName?: string, cancel = false): Promise<SyncEndpointHealthResponse> {
    return this.sendRequest<SyncEndpointHealthResponse>({
      type: "sync_endpoint_health",
      profileName,
      cancel,
    });
  }
  /**
   * Bring the chat view forward, wherever the host keeps it.
   *
   * The standalone sessions view is its own webview in its own container, so
   * rendering the chat locally would put it in the activity bar rather than in
   * the side bar the chat belongs to.
   */
  /**
   * Bring the chat forward from the history: to a new conversation, to the one
   * a row names (`sessionId`), or as it is ("Back to chat"). `fromView` says
   * the history is the activity-bar view, whose side bar may close behind it.
   */
  revealChat(options: { newConversation?: boolean; sessionId?: string; fromView?: boolean } = {}): Promise<any> {
    return this.sendRequest({
      type: "reveal_chat",
      newConversation: options.newConversation ?? false,
      ...(options.sessionId !== undefined && { sessionId: options.sessionId }),
      ...(options.fromView !== undefined && { fromView: options.fromView }),
    });
  }
  getMcpServers(channelId?: string): Promise<any> {
    return this.sendRequest({ type: "get_mcp_servers" }, channelId);
  }
  sdkProbe(capabilities: string[], timeoutMs?: number): Promise<SdkProbeResponse> {
    return this.sendRequest({ type: "sdk_probe", capabilities, timeoutMs });
  }

  async openContent(
    content: string,
    fileName: string,
    editable: boolean,
    signal?: AbortSignal
  ): Promise<string | undefined> {
    const response = await this.sendRequest(
      { type: "open_content", content, fileName, editable },
      undefined,
      signal
    );
    return (response as any).updatedContent;
  }

  async openDiff(
    originalFilePath: string,
    newFilePath: string,
    edits: any[],
    supportMultiEdits: boolean,
    signal?: AbortSignal
  ): Promise<any[]> {
    const response = await this.sendRequest(
      {
        type: "open_diff",
        originalFilePath,
        newFilePath,
        edits,
        supportMultiEdits,
      },
      undefined,
      signal
    );
    return (response as any).newEdits;
  }

  /** The official `setPermissionMode($,J,Z)`: `{mode, userInitiated}`, answered with `success`. */
  async setPermissionMode(channelId: string, mode: PermissionMode, userInitiated?: boolean): Promise<boolean> {
    const response = await this.sendRequest<SetPermissionModeResponse>(
      { type: "set_permission_mode", mode, userInitiated },
      channelId
    );
    return !!response?.success;
  }

  /**
   * The official `persistSessionPermissionMode($,J,Z,Y)`: keep (or clear) the
   * mode a conversation reopens in (step 18). The answer carries nothing.
   */
  async persistSessionPermissionMode(
    sessionId: string,
    mode: PermissionMode,
    previousSessionId?: string,
    carriedFromStore?: boolean
  ): Promise<void> {
    await this.sendRequest({
      type: "persist_session_permission_mode",
      sessionId,
      mode,
      previousSessionId,
      carriedFromStore,
    });
  }

  /**
   * The official `openMarkdownPreview($,J,Z,Y)`: show the plan beside the chat.
   * Without comments, the channel's comments are dropped first.
   */
  openMarkdownPreview(channelId: string, content: string, title: string, enableComments: boolean): Promise<unknown> {
    if (!enableComments) {
      const next = new Map(this.planCommentsByChannel());
      next.set(channelId, []);
      this.planCommentsByChannel(next);
    }
    return this.sendRequest({ type: "open_markdown_preview", channelId, content, title, enableComments });
  }

  /** The official `removePlanComment($,J)`: drop it here at once, then tell the host. */
  removePlanComment(channelId: string, commentId: string): Promise<unknown> {
    const all = this.planCommentsByChannel();
    const next = new Map(all);
    next.set(channelId, (all.get(channelId) ?? []).filter((c) => c.id !== commentId));
    this.planCommentsByChannel(next);
    return this.sendRequest({ type: "remove_plan_comment", channelId, commentId });
  }

  /** The official `closePlanPreview($)`. */
  closePlanPreview(channelId: string): Promise<unknown> {
    return this.sendRequest({ type: "close_plan_preview", channelId });
  }

  async setModel(channelId: string, model: any): Promise<any> {
    return this.sendRequest({ type: "set_model", model }, channelId);
  }

  /** The official `getAppliedSettings($)`: what the CLI says it applied, or undefined. */
  async getAppliedSettings(channelId: string): Promise<AppliedSettings | undefined> {
    const response = await this.sendRequest<GetAppliedSettingsResponse>({ type: "get_applied_settings" }, channelId);
    return response?.applied;
  }

  /**
   * The official `setThinkingLevel($,J)`: note the level in the local config,
   * so a new session starts from it, then tell the host.
   */
  async setThinkingLevel(channelId: string, thinkingLevel: string): Promise<void> {
    const config = this.config();
    if (config) this.config({ ...config, thinkingLevel });
    await this.sendRequest({ type: "set_thinking_level", thinkingLevel }, channelId);
  }

  /** The official `listPermissionRules($)`. The answer is in-band: `state` or `error`. */
  listPermissionRules(channelId: string): Promise<ListPermissionRulesResponse> {
    return this.sendRequest({ type: "list_permission_rules" }, channelId);
  }

  /** The official `addPermissionRules($,J,Z,Y)`: `{rules, behavior, destination}`. */
  addPermissionRules(
    channelId: string,
    rules: string[],
    behavior: PermissionBehavior,
    destination: EditableRuleDestination
  ): Promise<AddPermissionRulesResponse> {
    return this.sendRequest({ type: "add_permission_rules", rules, behavior, destination }, channelId);
  }

  /** The official `removePermissionRule($,J,Z,Y)`: `{rule, behavior, source}`. */
  removePermissionRule(
    channelId: string,
    rule: string,
    behavior: PermissionBehavior,
    source: EditableRuleDestination
  ): Promise<RemovePermissionRuleResponse> {
    return this.sendRequest({ type: "remove_permission_rule", rule, behavior, source }, channelId);
  }

  listSessions(): Promise<any> {
    return this.sendRequest({ type: "list_sessions_request" });
  }
  /**
   * The official `renameSession($,J)`: ask the host to append a `custom-title`
   * line for this conversation. The answer's `skipped` says the host refused
   * the id or could not find the transcript (step 20).
   */
  renameSession(sessionId: string, title: string): Promise<RenameSessionResponse> {
    return this.sendRequest({ type: "rename_session", sessionId, title });
  }
  /** The official `archiveSession($)`: hide the conversation from the list (step 21). */
  archiveSession(sessionId: string): Promise<ArchiveSessionResponse> {
    return this.sendRequest({ type: "archive_session", sessionId });
  }
  /** The official `unarchiveSession($)`: bring it back. */
  unarchiveSession(sessionId: string): Promise<UnarchiveSessionResponse> {
    return this.sendRequest({ type: "unarchive_session", sessionId });
  }
  /**
   * The official `setSessionUnread($,J)`: mark a conversation unread, or read
   * (step 22).
   *
   * `sessionKey` is the official `c$(sessionId, isRemote)` -- the id for a local
   * conversation, `remote:<id>` for a cloud one. Forge has local sessions only,
   * so it is the id; the host still validates it as a bounded string, the way
   * the official does, rather than as a UUID.
   */
  setSessionUnread(sessionKey: string, unread: boolean): Promise<SetSessionUnreadResponse> {
    return this.sendRequest({ type: "set_session_unread", sessionKey, unread });
  }
  /**
   * The official `rewindCode($,J,Z)` (step 24):
   *
   *   async rewindCode($,J,Z){
   *     return this.sendRequest({type:"rewind_code",userMessageId:J,dryRun:Z?.dryRun},$)}
   *
   * `$` is the **channelId** -- this is the only channel-scoped request in
   * group 5, because the host answers it off a live channel's `query`.
   *
   * `dryRun` is `Z?.dryRun`, so calling this with no options puts the key on the
   * wire as `undefined`, and that is the real run. The host accepts it.
   *
   * A failure arrives as a rejected promise, not a shaped response: the official
   * host throws `z.error`, and Forge's host maps a thrown handler error onto
   * `{type:"error",error}`, which `case "response"` below rejects.
   */
  rewindCode(
    channelId: string,
    userMessageId: string,
    options?: { dryRun?: boolean }
  ): Promise<RewindCodeResponse> {
    return this.sendRequest({ type: "rewind_code", userMessageId, dryRun: options?.dryRun }, channelId);
  }
  /**
   * The official `forkConversation($,J)` (step 25):
   *
   *   async forkConversation($,J){
   *     return(await this.sendRequest({type:"fork_conversation",
   *       forkedFromSession:$,resumeSessionAt:J})).sessionId}
   *
   * Not channel-scoped, and it resolves to the **bare session id**, not the
   * response object -- the official unwraps it here, so its callers read a
   * string. A failure rejects, because the host throws for an unknown session
   * or an unknown message.
   *
   * `title` is the SDK's `ForkSessionOptions.title` (sdk.d.ts:779); the official
   * never passes one and neither does the UI, but the host accepts it, so the
   * option is reachable rather than silently unavailable.
   */
  async forkConversation(
    forkedFromSession: string,
    resumeSessionAt?: string,
    title?: string
  ): Promise<string> {
    const response = await this.sendRequest<ForkConversationResponse>({
      type: "fork_conversation",
      forkedFromSession,
      resumeSessionAt,
      ...(title !== undefined && { title }),
    });
    return response.sessionId;
  }
  /**
   * Step 28, the three browser requests, with the official's own scoping
   * (index.js @3316158):
   *
   *   ensureChromeMcpEnabled($){return this.sendRequest({type:"ensure_chrome_mcp_enabled"},$)}
   *   disableChromeMcp($){return this.sendRequest({type:"disable_chrome_mcp"},$)}
   *   createNewBrowserTab(){return this.sendRequest({type:"create_new_browser_tab"})}
   *
   * The first two pass the channelId; the third deliberately does not.
   */
  ensureChromeMcpEnabled(channelId: string): Promise<EnsureChromeMcpEnabledResponse> {
    return this.sendRequest({ type: "ensure_chrome_mcp_enabled" }, channelId);
  }
  disableChromeMcp(channelId: string): Promise<DisableChromeMcpResponse> {
    return this.sendRequest({ type: "disable_chrome_mcp" }, channelId);
  }
  createNewBrowserTab(): Promise<CreateNewBrowserTabResponse> {
    return this.sendRequest({ type: "create_new_browser_tab" });
  }
  /**
   * Step 29, the three output-style requests (index.js @3323774). All three are
   * channel-scoped, and `createOutputStyle` unwraps `.result` here, as the
   * official does, so its callers read the result union directly.
   */
  async getOutputStyle(channelId: string): Promise<{ outputStyle?: string; availableStyles?: string[] }> {
    const response = await this.sendRequest<GetOutputStyleResponse>({ type: "get_output_style" }, channelId);
    return { outputStyle: response.outputStyle, availableStyles: response.availableStyles };
  }
  async getOutputStyleLocations(channelId: string): Promise<{ project: string; user: string }> {
    const response = await this.sendRequest<GetOutputStyleLocationsResponse>(
      { type: "get_output_style_locations" },
      channelId
    );
    return { project: response.project, user: response.user };
  }
  async createOutputStyle(
    channelId: string,
    draft: OutputStyleDraftPayload,
    level: "project" | "user",
    replace?: boolean
  ): Promise<CreateOutputStyleResult> {
    const response = await this.sendRequest<CreateOutputStyleResponse>(
      { type: "create_output_style", draft, level, replace },
      channelId
    );
    return response.result;
  }
  /**
   * Step 30, the official `setFocusView($)` (index.js @3324257): patch the
   * config first so the toggle and the transcript flip at once, then tell the
   * host. Not channel-scoped.
   */
  async setFocusView(enabled: boolean): Promise<void> {
    const config = this.config();
    if (config) this.config({ ...config, focusViewEnabled: enabled });
    await this.sendRequest({ type: "set_focus_view", enabled });
  }
  getSession(sessionId: string): Promise<any> {
    return this.sendRequest({ type: "get_session_request", sessionId });
  }
  listFiles(pattern?: string, signal?: AbortSignal): Promise<any> {
    return this.sendRequest({ type: "list_files_request", pattern }, undefined, signal);
  }
  statPaths(paths: string[]): Promise<any> {
    return this.sendRequest({ type: "stat_path_request", paths });
  }
  startNewConversationTab(initialPrompt?: string): Promise<any> {
    return this.sendRequest({
      type: "new_conversation_tab",
      initialPrompt,
    } as any);
  }
  renameTab(title: string): Promise<any> {
    return this.sendRequest({ type: "rename_tab", title } as any);
  }
  /**
   * The official `applySettings($,J,Z)`: the settings patch, then
   * `{flagsOnly, scope}`. A `null` value clears that key.
   */
  applySettings(
    settings: Record<string, unknown>,
    opts?: { flagsOnly?: boolean; scope?: string },
    channelId?: string
  ): Promise<any> {
    return this.sendRequest(
      { type: "apply_settings", settings, flagsOnly: opts?.flagsOnly, scope: opts?.scope },
      channelId
    );
  }

  /** The official `openClaudeInTerminal($,J,Z)`: prompt, args, location. */
  openClaudeInTerminal(
    prompt?: string,
    args?: string[],
    location?: "bottom" | "window" | "beside"
  ): Promise<any> {
    return this.sendRequest({ type: "open_claude_in_terminal", prompt, args, location });
  }
  /**
   * Returns the promise rather than swallowing it, like every other request
   * here. A caller that drops it is choosing to, and one that wants to report
   * a failure can -- which is the difference between a row that says why it
   * did nothing and a row that just doesn't work.
   */
  openURL(url: string): Promise<any> {
    return this.sendRequest({ type: "open_url", url });
  }
  getCurrentSelection(): Promise<any> {
    return this.sendRequest({ type: "get_current_selection" });
  }
  getAssetUris(): Promise<any> {
    return this.sendRequest({ type: "get_asset_uris" });
  }

  getSettings(): Promise<any> {
    return this.sendRequest({ type: "get_settings" });
  }

  updateSetting(key: string, value: any, target?: 'local' | 'shared' | 'global'): Promise<any> {
    return this.sendRequest({ type: 'update_setting', key, value, target });
  }

  resetSetting(key: string, target: 'local' | 'shared' | 'global'): Promise<any> {
    return this.sendRequest({ type: 'reset_setting', key, target });
  }

  switchProfile(profile: string | null): Promise<any> {
    return this.sendRequest({ type: 'switch_profile', profile });
  }

  createProfile(name: string): Promise<any> {
    return this.sendRequest({ type: 'create_profile', name });
  }

  deleteProfile(name: string): Promise<any> {
    return this.sendRequest({ type: 'delete_profile', name });
  }

  getExtensionConfig(): Promise<any> {
    return this.sendRequest({ type: 'get_extension_config' });
  }

  updateExtensionConfig(key: string, value: any): Promise<any> {
    return this.sendRequest({ type: 'update_extension_config', key, value });
  }

  showNotification(
    message: string,
    severity: ShowNotificationRequest["severity"],
    buttons?: string[],
    onlyIfNotVisible?: boolean
  ): Promise<string | undefined> {
    return this.sendRequest({
      type: "show_notification",
      message,
      severity,
      buttons,
      onlyIfNotVisible,
    }).then((r: any) => r.buttonValue);
  }

  onPermissionRequested(callback: (request: PermissionRequest) => void): void {
    this.permissionRequested.add(callback);
  }

  close(): void {
    /* no-op */
  }

  protected async sendRequest<TResponse = any>(
    request: WebViewRequest,
    channelId?: string,
    abortSignal?: AbortSignal
  ): Promise<TResponse> {
    const requestId = Math.random().toString(36).slice(2);
    const abortHandler = () => {
      this.cancelRequest(requestId);
    };
    if (abortSignal) {
      abortSignal.addEventListener("abort", abortHandler, { once: true });
    }

    return new Promise<TResponse>((resolve, reject) => {
      this.outstandingRequests.set(requestId, { resolve, reject });
      this.send({ type: "request", channelId, requestId, request });
    }).finally(() => {
      if (abortSignal) abortSignal.removeEventListener("abort", abortHandler);
    });
  }

  protected cancelRequest(requestId: string): void {
    this.send({ type: "cancel_request", targetRequestId: requestId });
  }

  private async readMessages(): Promise<void> {
    try {
      for await (const message of this.fromHost) {
        switch (message.type) {
          case "io_message": {
            const stream = this.streams.get(message.channelId);
            if (stream) {
              stream.enqueue(message.message);
            } else {
              console.warn(`[BaseTransport] Missing stream for ${message.channelId}`);
            }
            break;
          }
          case "close_channel": {
            const stream = this.streams.get(message.channelId);
            if (stream) {
              if (message.error) stream.error(new Error(message.error));
              stream.done();
              // 延迟删除，给尾部 io_message/result 留出时间片
              setTimeout(() => {
                this.streams.delete(message.channelId);
              }, 50);
            } else {
              this.streams.delete(message.channelId);
            }
            break;
          }
          case "sdk_error": {
            // 将 LLM 请求错误作为特殊事件注入到消息流中
            const errorStream = this.streams.get(message.channelId);
            if (errorStream) {
              errorStream.enqueue({
                type: '__llm_request_error__',
                error: message.error,
                statusCode: message.statusCode,
                errorType: message.errorType,
              });
            }
            break;
          }
          case "plan_comment": {
            // The official `planCommentsByChannel`: a comment made in the plan preview.
            const all = this.planCommentsByChannel();
            const next = new Map(all);
            next.set(message.channelId, [...(all.get(message.channelId) ?? []), message.comment]);
            this.planCommentsByChannel(next);
            break;
          }
          case "request":
            // Not awaited, as the official (`case"request":this.processRequest($);break;`):
            // a permission request settles only when the prompt is answered, and
            // awaiting it here stalled every other message meanwhile -- the
            // stream of other sessions, plan comments, and the answer's own
            // set_permission_mode reply (a deadlock on "Yes, and auto-accept").
            this.processRequest(message as RequestMessage).catch((error) =>
              console.error("[BaseTransport] request failed", error)
            );
            break;
          case "response": {
            const handler = this.outstandingRequests.get(message.requestId);
            if (!handler) {
              // 多 WebView 宿主场景下，其他实例也会收到响应但没有对应的 pending request
              // 这是预期行为，这里静默忽略
              // console.warn(
              //   `[BaseTransport] No handler for response ${message.requestId}`
              // );
              break;
            }
            const response = (message as any).response;
            if (response && (response as any).type === "error") {
              handler.reject(new Error((response as any).error));
            } else {
              handler.resolve(response);
            }
            this.outstandingRequests.delete(message.requestId);
            break;
          }
          default:
            console.warn(
              `[BaseTransport] Unknown message type ${(message as any).type}`
            );
        }
      }
    } catch (error) {
      for (const stream of this.streams.values()) stream.error(error);
    } finally {
      for (const stream of this.streams.values()) stream.done();
      this.streams.clear();
    }
  }

  private async processRequest(message: RequestMessage): Promise<void> {
    const req: any = (message as any).request;
    switch (req.type) {
      case "tool_permission_request": {
        const response = await this.handleToolPermissionRequest(
          (message.channelId ?? "") as string,
          req as ToolPermissionRequest
        );
        this.send({ type: "response", requestId: message.requestId, response });
        break;
      }
      case "insert_at_mention": {
        // The official: emitted now if the chat shows, else held until it does
        // (`pendingAtMentions`), and dropped after 15 s (`JF`).
        if (this.isVisible()) this.atMentionEvents.emit(req.text);
        else this.pendingAtMentions.push({ text: req.text, at: Date.now() });
        break;
      }
      case "selection_changed": {
        this.selectionChangedEvents.emit(req.selection);
        break;
      }
      case "select_settings_tab": {
        if (isForgeSettingsTab(req.tab)) this.selectSettingsTab.emit(req.tab);
        break;
      }
      case "ui_command": {
        if (req.command === "open_session") {
          if (typeof req.sessionId === "string" && req.sessionId) this.openSessionRequested.emit(req.sessionId);
          break;
        }
        this.uiCommand.emit(req.command as UiCommandName);
        break;
      }
      case "visibility_changed": {
        this.isVisible(req.isVisible);
        if (req.isVisible && this.pendingAtMentions.length > 0) {
          const pending = this.pendingAtMentions;
          this.pendingAtMentions = [];
          const now = Date.now();
          for (const mention of pending) if (now - mention.at <= PENDING_AT_MENTION_MS) this.atMentionEvents.emit(mention.text);
        }
        break;
      }

      case "update_state": {
        // The official receiver: `this.config.value=$.request.state`, and the
        // model config kept when the push carries none. Spread, for the reason
        // `initialize()` spreads: this used to copy nine fields by hand, so the
        // endpoint counts the welcome gate reads never arrived and a page
        // holding the gate could not learn an endpoint had just been saved.
        if (req.state && typeof req.state === "object") {
          this.config({
            ...(req.state as InitResponse["state"]),
            // Where this webview lives, which `init` answered for it alone; a
            // broadcast push is not about any one webview.
            openNewInTab: this.config()?.openNewInTab ?? false,
            browserIntegrationSupported: req.state.browserIntegrationSupported ?? false,
            focusViewEnabled: req.state.focusViewEnabled ?? false,
          });
        }
        if (req.config) this.claudeConfig(req.config);
        break;
      }
      case "session_store_changed": {
        // The official `this.sessionStoreChanges.value++`.
        this.sessionStoreChanges(this.sessionStoreChanges() + 1);
        break;
      }
      case "session_renamed": {
        // The official push (`sendSessionRenamed`), consumed by
        // `adoptPersistedTitle`. Nothing is answered.
        if (typeof req.sessionId === "string" && typeof req.title === "string") {
          this.sessionRenamedEvents.emit({ sessionId: req.sessionId, title: req.title });
        }
        break;
      }
      case "session_states_update": {
        // The official receiver, field for field:
        //
        //   this.sessionStates.value=$.request.sessions,
        //   this.activeSessionId.value=$.request.activeSessionId,
        //   if($.request.openSessionIds!==void 0) this.openSessionIds.value=...;
        //   if($.request.unreadSessionKeys!==void 0) this.unreadSessionKeys.value=...;
        //   if($.request.liveElsewhereSessions!==void 0) ...
        //
        // Each feed is assigned only when the push carries it, so a partial
        // update never clears a list back to "not ready". Forge has no second
        // surface, so `sessions` and `liveElsewhereSessions` are not consumed.
        if (req.openSessionIds !== undefined) this.openSessionIds(req.openSessionIds);
        if (req.unreadSessionKeys !== undefined) this.unreadSessionKeys(req.unreadSessionKeys);
        break;
      }
      case "endpoint_health_update": {
        // Forge-only, on the `session_states_update` model: a `request` the
        // host sends and nothing answers. Assigned only when the push carries
        // the field, so a malformed one never clears the table to "not ready".
        if (Array.isArray(req.health)) this.endpointHealth(req.health);
        break;
      }
      case "extension_config_changed": {
        this.extensionConfigChanged.emit({ key: req.key, value: req.value });
        // "Default Permission Mode" is the official initialPermissionMode setting:
        // ask the host again, so the next new session starts in it (step 18).
        if (req.key === "defaultPermissionMode") void this.refreshInitialPermissionMode();
        // The official `pushStateUpdate()` after `setFocusView`, which lands on
        // `config.focusViewEnabled`. Forge's host broadcasts the same change
        // through this push, so a toggle made anywhere reaches the transcript.
        if (req.key === "focusView" && typeof req.value === "boolean") {
          const current = this.config();
          if (current) this.config({ ...current, focusViewEnabled: req.value });
        }
        break;
      }
      default:
        console.warn("[BaseTransport] Unhandled request", req);
    }
  }

  /** Re-read the host's `initialPermissionMode` (its gate decides, not the webview). */
  private async refreshInitialPermissionMode(): Promise<void> {
    try {
      const initResponse = await this.sendRequest<InitResponse>({ type: "init" });
      const config = this.config();
      if (config) this.config({ ...config, initialPermissionMode: initResponse.state.initialPermissionMode });
    } catch (error) {
      console.warn("[BaseTransport] Could not re-read the initial permission mode", error);
    }
  }

  private async handleToolPermissionRequest(
    channelId: string,
    request: ToolPermissionRequest
  ): Promise<ExtensionRequestResponse> {
    let trackedRequest: PermissionRequest | undefined;
    return new Promise<ExtensionRequestResponse>((resolve) => {
      // The official `handleToolPermissionRequest`: name, inputs and
      // suggestions with bidi controls spelled out (`S5`), the two booleans
      // strictly `=== true`.
      const permissionRequest = new PermissionRequest(
        channelId,
        escapeBidiControls(request.toolName),
        escapeBidiControls(request.inputs),
        escapeBidiControls(request.suggestions ?? []),
        request.defaultToNo === true,
        request.suppressAlwaysAllowRule === true,
        request.toolUseId,
        request.agentId,
        // Forge-only (A3). Escaped like every other host-supplied string: it
        // quotes a path the model chose, so it is untrusted text.
        request.riskReason ? escapeBidiControls(request.riskReason) : undefined
      );
      trackedRequest = permissionRequest;

      permissionRequest.onResolved((resolution: PermissionResult) => {
        resolve({ type: "tool_permission_response", result: resolution });
        this.permissionRequests(
          this.permissionRequests().filter((i) => i !== permissionRequest)
        );
      });

      this.permissionRequests([
        ...this.permissionRequests(),
        permissionRequest,
      ]);
      this.permissionRequested.emit(permissionRequest);
    }).finally(() => {
      if (trackedRequest) {
        this.permissionRequests(
          this.permissionRequests().filter((i) => i !== trackedRequest)
        );
      }
    });
  }
}
