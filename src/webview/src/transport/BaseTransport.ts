import { signal } from "alien-signals";
import { AsyncQueue } from "./AsyncQueue";
import { EventEmitter } from "../utils/events";
import { PermissionRequest } from "../core/PermissionRequest";
import { escapeBidiControls } from "../core/permissionPrompt";
import type { PermissionBehavior, PermissionResult, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type {
  AddPermissionRulesResponse,
  EditableRuleDestination,
  ListPermissionRulesResponse,
  PlanComment,
  SetPermissionModeResponse,
  RemovePermissionRuleResponse,
  RenameSessionResponse,
  ArchiveSessionResponse,
  UnarchiveSessionResponse,
  SetSessionUnreadResponse,
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
} from "../../../shared/messages";

type ConnectionState = "connecting" | "connected" | "disconnected";

interface RequestHandler {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

/**
 * WebView ↔ Extension 传输抽象基类
 * - 使用 alien-signals 管理状态（统一架构）
 */
export abstract class BaseTransport {
  readonly state = signal<ConnectionState>("connecting");
  readonly isVisible = signal(true);
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
    this.config({
      defaultCwd: initResponse.state.defaultCwd,
      openNewInTab: initResponse.state.openNewInTab ?? false,
      modelSetting: initResponse.state.modelSetting,
      platform: initResponse.state.platform,
      thinkingLevel: initResponse.state.thinkingLevel,
      initialPermissionMode: initResponse.state.initialPermissionMode,
      allowDangerouslySkipPermissions: initResponse.state.allowDangerouslySkipPermissions,
    } as InitResponse["state"]);

    const claudeState = await this.sendRequest<GetClaudeStateResponse>({
      type: "get_claude_state",
    });
    this.claudeConfig(claudeState.config);
    this.state("connected");
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
  openURL(url: string): void {
    void this.sendRequest({ type: "open_url", url });
  }
  exec(command: string, params: string[]): Promise<any> {
    return this.sendRequest({ type: "exec", command, params });
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
    if (abortSignal)
      abortSignal.addEventListener("abort", abortHandler, { once: true });

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
            if (stream) stream.enqueue(message.message);
            else
              console.warn(
                `[BaseTransport] Missing stream for ${message.channelId}`
              );
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
            if (response && (response as any).type === "error")
              handler.reject(new Error((response as any).error));
            else handler.resolve(response);
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
        if (this.isVisible()) this.atMentionEvents.emit(req.text);
        break;
      }
      case "selection_changed": {
        this.selectionChangedEvents.emit(req.selection);
        break;
      }
      case "ui_command": {
        this.uiCommand.emit(req.command as UiCommandName);
        break;
      }
      case "visibility_changed": {
        this.isVisible(req.isVisible);
        break;
      }

      case "update_state": {
        this.config({
          defaultCwd: req.state.defaultCwd,
          openNewInTab: req.state.openNewInTab,
          modelSetting: req.state.modelSetting,
          platform: req.state.platform,
          thinkingLevel: req.state.thinkingLevel,
          initialPermissionMode: req.state.initialPermissionMode,
          allowDangerouslySkipPermissions: req.state.allowDangerouslySkipPermissions,
        } as InitResponse["state"]);
        this.claudeConfig(req.config);
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
      case "extension_config_changed": {
        this.extensionConfigChanged.emit({ key: req.key, value: req.value });
        // "Default Permission Mode" is the official initialPermissionMode setting:
        // ask the host again, so the next new session starts in it (step 18).
        if (req.key === "defaultPermissionMode") void this.refreshInitialPermissionMode();
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
        request.agentId
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
