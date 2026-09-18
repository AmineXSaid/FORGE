import { signal, computed, effect } from 'alien-signals';
import type { BaseTransport } from '../transport/BaseTransport';
import type { PermissionRequest } from './PermissionRequest';
import type {
  AddPermissionRulesResponse,
  AppliedSettings,
  EditableRuleDestination,
  ListPermissionRulesResponse,
  ModelOption,
  PlanComment,
  RemovePermissionRuleResponse,
} from '../../../shared/messages';
import type { SessionSummary } from './types';
import type { PermissionBehavior, PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import { processAndAttachMessage, retireStreamedRows /*, mergeConsecutiveReadMessages */ } from '../utils/messageUtils';
import { Message as MessageModel } from '../models/Message';
import type { Message } from '../models/Message';
import { StreamAssembler } from '../models/StreamAssembler';
import { allModelRows, currentModelInfo, findModelRow, modelFamily, servedModelOf } from '../components/forge/modelCatalog';
import { DEFAULT_EFFORT_LEVELS, NO_EFFORT, isUltracodeAvailable, type EffortState } from '../components/forge/effort';

/** The model name the CLI puts on messages it synthesizes itself (the official `JT`). */
const SYNTHETIC_MODEL = '<synthetic>';

export interface SelectionRange {
  filePath: string;
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
  selectedText?: string;
}

export interface UsageData {
  totalTokens: number;
  totalCost: number;
  contextWindow: number;
}

export interface AttachmentPayload {
  fileName: string;
  mediaType: string;
  data: string;
  fileSize?: number;
}

const IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;

export interface SessionOptions {
  isExplicit?: boolean;
  existingWorktree?: { name: string; path: string };
  resumeId?: string;
}

export interface SessionContext {
  currentSelection: ReturnType<typeof signal<SelectionRange | undefined>>;
  commandRegistry: { registerAction: (...args: any[]) => void };
  fileOpener: {
    open: (filePath: string, location?: any) => Promise<void> | void;
    openContent: (
      content: string,
      fileName: string,
      editable: boolean
    ) => Promise<string | undefined>;
  };
  showNotification?: (
    message: string,
    severity: 'info' | 'warning' | 'error',
    buttons?: string[],
    onlyIfNotVisible?: boolean
  ) => Promise<string | undefined>;
  startNewConversationTab?: (initialPrompt?: string) => boolean;
  renameTab?: (title: string) => boolean;
  openURL?: (url: string) => void;
}

export class Session {
  private readonly claudeChannelId = signal<string | undefined>(undefined);
  private currentConnectionPromise?: Promise<BaseTransport>;

  // The official session's effort bookkeeping, same names and meaning.
  /** Ultracode has been seeded (or chosen), so a late settings read must not re-seed it. */
  private ultracodeSeeded = false;
  /** Bumped on every user effort change, so a reply that raced it is not adopted. */
  private effortChangeCount = 0;
  /** A flag layer may hold `ultracode:true`, so the next level pick must clear it first. */
  private ultracodeFlagMayBeSet = false;
  /** The level shown came from the CLI, not a pick, so picking it again still writes. */
  private shownLevelUnpicked = false;
  /** Bumped on every model pick, so a reread that raced it is not adopted. */
  private modelSelectionWrites = 0;
  /** A slash command was sent: re-read what the CLI applied when the turn ends. */
  private rereadAppliedOnResult = false;
  /** The official `settingsApplyChain`: settings writes go out one at a time, in order. */
  private settingsApplyChain: Promise<unknown> = Promise.resolve();
  private lastSentSelection?: SelectionRange;
  private effectCleanup?: () => void;

  /** The official `hasStreamingMessages`: set by the first stream_event. */
  private hasStreamingMessages = false;
  /** The official `streamedAttempt`: the root API message streaming now, and the rows built for it. */
  private streamedAttempt?: { betaMessageId: string; rows: Message[] };
  private readonly assembler = new StreamAssembler(
    (betaMessageId, parentToolUseId) => {
      const row = new MessageModel('assistant', { role: 'assistant', content: [] }, Date.now(), { betaMessageId });
      if (parentToolUseId === null && this.streamedAttempt?.betaMessageId === betaMessageId) {
        this.streamedAttempt.rows.push(row);
      }
      this.messages([...this.messages(), row]);
      return row;
    },
    (betaMessageId) => {
      this.messages(this.retireAbandonedStreamedRows(this.messages()));
      this.streamedAttempt = { betaMessageId, rows: [] };
    }
  );

  readonly connection = signal<BaseTransport | undefined>(undefined);

  readonly busy = signal(false);
  readonly isLoading = signal(false);
  readonly error = signal<string | undefined>(undefined);
  readonly sessionId = signal<string | undefined>(undefined);
  readonly isExplicit = signal(false);
  readonly lastModifiedTime = signal<number>(Date.now());
  readonly messages = signal<Message[]>([]);
  readonly messageCount = signal<number>(0);
  readonly cwd = signal<string | undefined>(undefined);
  readonly permissionMode = signal<PermissionMode>('default');
  readonly summary = signal<string | undefined>(undefined);
  readonly modelSelection = signal<string | undefined>(undefined);
  /**
   * The official `lastServedModel`: the model the CLI reports on the last
   * top-level assistant message. The pill names it when it differs from the
   * selection (Default served by Opus reads "Opus 5"). Cleared on a model switch.
   */
  readonly lastServedModel = signal<string | undefined>(undefined);
  /** The official `thinkingLevelOverride`: what this session's toggle last set. */
  readonly thinkingLevelOverride = signal<string | undefined>(undefined);
  /**
   * The official `effortLevel`: the level the effort controls show. It starts
   * unset and is seeded from what the CLI reports it applied, never from a
   * Forge default. Separate from `thinkingLevel` -- choosing an effort must not
   * touch thinking, and the other way round.
   */
  readonly effortLevel = signal<string | undefined>(undefined);
  /** The official `ultracodeEnabled`: `xhigh` plus the session-scoped `ultracode` flag. */
  readonly ultracodeEnabled = signal(false);
  readonly todos = signal<any[]>([]);
  readonly worktree = signal<{ name: string; path: string } | undefined>(undefined);
  readonly selection = signal<SelectionRange | undefined>(undefined);
  readonly usageData = signal<UsageData>({
    totalTokens: 0,
    totalCost: 0,
    contextWindow: 200000
  });

  readonly claudeConfig = computed(() => {
    const conn = this.connection();
    return conn?.claudeConfig?.();
  });

  readonly config = computed(() => {
    const conn = this.connection();
    return conn?.config?.();
  });

  /** The official `IH`: selectable models, then the greyed ones. */
  readonly modelRows = computed(() => allModelRows(this.claudeConfig()));

  /** The official `currentModelInfo`: the selected model's row, where its capabilities live. */
  readonly currentModelInfo = computed(() => currentModelInfo(this.modelRows(), this.modelSelection()));

  /** The official `currentModelSupportsEffort`: gates both effort rows (step 13). */
  readonly currentModelSupportsEffort = computed(() => this.currentModelInfo()?.supportsEffort ?? false);

  /** The official `currentModelSupportsFastMode`: gates "Toggle fast mode" (step 15). */
  readonly currentModelSupportsFastMode = computed(() => this.currentModelInfo()?.supportsFastMode ?? false);

  /**
   * The official `currentModelSupportsAutoMode`: `undefined` while the model is
   * unknown, as the official keeps it, so "unknown" is not read as "no".
   */
  readonly currentModelSupportsAutoMode = computed(() => {
    const info = this.currentModelInfo();
    return info ? (info.supportsAutoMode ?? false) : undefined;
  });

  /**
   * The official `thinkingLevel`: this session's toggle, else the persisted level
   * the host reported at init, else "off". Independent of effort in both
   * directions.
   */
  readonly thinkingLevel = computed(
    () => this.thinkingLevelOverride() ?? this.connection()?.config()?.thinkingLevel ?? 'off'
  );

  /** The official `config.claudeSettings`: the CLI's own settings read (`applied`, `effective`). */
  readonly claudeSettings = computed(() => this.claudeConfig()?.claudeSettings);

  /** The official `ultracodeAvailable`: settings read, workflows on, model lists `xhigh`. */
  readonly ultracodeAvailable = computed(() =>
    isUltracodeAvailable(this.claudeSettings(), this.currentModelInfo()?.supportedEffortLevels)
  );

  /**
   * What every effort control renders from. The official reads the model with
   * `bK` for the footer and the "/" row (`if (Y1?.supportsEffort) ...`), and
   * falls back to `["low","medium","high"]` when the model lists no levels.
   */
  readonly effortState = computed<EffortState>(() => {
    const row = findModelRow(this.modelRows(), this.modelSelection());
    if (!row?.supportsEffort) return NO_EFFORT;
    return {
      supported: true,
      level: this.effortLevel(),
      levels: row.supportedEffortLevels ?? DEFAULT_EFFORT_LEVELS,
      ultracodeAvailable: this.ultracodeAvailable(),
      ultracodeSelected: this.ultracodeEnabled(),
    };
  });

  /** `ModelInfo.supportsAdaptiveThinking`: whether Claude decides when and how much to think. */
  readonly currentModelSupportsAdaptiveThinking = computed(
    () => this.currentModelInfo()?.supportsAdaptiveThinking ?? false
  );

  readonly permissionRequests = computed<PermissionRequest[]>(() => {
    const conn = this.connection();
    const channelId = this.claudeChannelId();
    if (!conn || !channelId) {
      return [];
    }

    return conn
      .permissionRequests()
      .filter((request) => request.channelId === channelId);
  });

  isOffline(): boolean {
    return (
      !this.connection() &&
      !!this.sessionId() &&
      this.messages().length === 0 &&
      !this.currentConnectionPromise
    );
  }

  constructor(
    private readonly connectionProvider: () => Promise<BaseTransport>,
    private readonly context: SessionContext,
    options: SessionOptions = {}
  ) {
    this.isExplicit(options.isExplicit ?? true);

    effect(() => {
      this.selection(this.context.currentSelection());
    });

    // The official seeding effect: show the effort the CLI reports it applied,
    // until the user picks one; and seed Ultracode once, from the same read.
    effect(() => {
      const claudeSettings = this.claudeSettings();
      const applied = claudeSettings?.applied;
      const seed = applied !== undefined ? (applied.effort ?? undefined) : claudeSettings?.effective.effortLevel;
      if (seed && !this.effortLevel()) this.effortLevel(seed);
      if (!this.ultracodeSeeded && claudeSettings) {
        this.ultracodeSeeded = true;
        const on = applied !== undefined ? applied.ultracode === true : claudeSettings.effective.ultracode === true;
        this.ultracodeFlagMayBeSet ||= claudeSettings.effective.ultracode === true;
        if (on) {
          this.ultracodeEnabled(true);
          this.ultracodeFlagMayBeSet = true;
          this.effortLevel('xhigh');
        }
      }
    });
  }

  static fromServer(
    summary: SessionSummary,
    connectionProvider: () => Promise<BaseTransport>,
    context: SessionContext
  ): Session {
    const session = new Session(connectionProvider, context, { isExplicit: true });
    session.sessionId(summary.id);
    session.lastModifiedTime(summary.lastModified);
    session.summary(summary.summary);
    session.worktree(summary.worktree);
    session.messageCount(summary.messageCount ?? 0);  // 保存服务器返回的消息数量
    return session;
  }

  async getConnection(): Promise<BaseTransport> {
    const current = this.connection();
    if (current) {
      return current;
    }
    if (this.currentConnectionPromise) {
      return this.currentConnectionPromise;
    }

    this.currentConnectionPromise = this.connectionProvider().then((conn) => {
      this.connection(conn);
      return conn;
    });

    return this.currentConnectionPromise;
  }

  async preloadConnection(): Promise<void> {
    await this.getConnection();
    await this.launchClaude();
  }

  async loadFromServer(): Promise<void> {
    const sessionId = this.sessionId();
    if (!sessionId) return;

    this.isLoading(true);
    try {
      const connection = await this.getConnection();
      const response = await connection.getSession(sessionId);
      const accumulator: Message[] = [];
      for (const raw of response?.messages ?? []) {
        this.processMessage(raw);
        // 使用 processAndAttachMessage 来绑定 tool_result
        // 这样历史消息中的 tool_result 也会正确绑定到 tool_use
        processAndAttachMessage(accumulator, raw);
      }
      // 移除 ReadCoalesced 合并逻辑
      // this.messages(mergeConsecutiveReadMessages(accumulator));
      this.messages(accumulator);
      await this.launchClaude();
    } finally {
      this.isLoading(false);
    }
  }

  async send(
    input: string,
    attachments: AttachmentPayload[] = [],
    includeSelection = false
  ): Promise<void> {
    const connection = await this.getConnection();

    // 官方路线：不在 slash 命令时临时切换 thinkingLevel，保持会话一致性，
    // 由 SDK/服务端在 assistant 消息中提供 thinking/redacted_thinking 块以满足约束
    const isSlash = this.isSlashCommand(input);
    // `/effort`, `/model` and friends change settings inside the CLI; the
    // official re-reads what it applied once that turn ends.
    if (input.trimStart().startsWith('/')) this.rereadAppliedOnResult = true;

    // 启动 channel（确保已带上当前 thinkingLevel）
    await this.launchClaude();

    const shouldIncludeSelection = includeSelection && !isSlash;
    let selectionPayload: SelectionRange | undefined;

    if (shouldIncludeSelection && !this.isSameSelection(this.lastSentSelection, this.selection())) {
      selectionPayload = this.selection();
      this.lastSentSelection = selectionPayload;
    }

    const userMessage = this.buildUserMessage(input, attachments, selectionPayload);
    const messageModel = MessageModel.fromRaw(userMessage);

    if (messageModel) {
      this.messages([...this.messages(), messageModel]);
    }

    if (!this.summary()) {
      this.summary(input);
    }
    this.isExplicit(false);
    this.lastModifiedTime(Date.now());
    this.busy(true);

    try {
      const channelId = this.claudeChannelId();
      if (!channelId) throw new Error('No active channel');
      connection.sendInput(channelId, userMessage, false);
    } catch (error) {
      this.busy(false);
      throw error;
    }
  }

  async launchClaude(): Promise<string> {
    const existingChannel = this.claudeChannelId();
    if (existingChannel) {
      return existingChannel;
    }

    this.error(undefined);
    const channelId = Math.random().toString(36).slice(2);
    this.claudeChannelId(channelId);

    const connection = await this.getConnection();

    if (!this.cwd()) {
      this.cwd(connection.config()?.defaultCwd);
    }

    if (!this.modelSelection()) {
      this.modelSelection(connection.config()?.modelSetting);
    }

    const stream = connection.launchClaude(
      channelId,
      this.sessionId() ?? undefined,
      this.cwd() ?? undefined,
      this.modelSelection() ?? undefined,
      this.permissionMode(),
      this.thinkingLevel()
    );

    void this.readMessages(stream);
    return channelId;
  }

  async interrupt(): Promise<void> {
    const channelId = this.claudeChannelId();
    if (!channelId) {
      return;
    }
    const connection = await this.getConnection();
    connection.interruptClaude(channelId);
  }

  async restartClaude(): Promise<void> {
    await this.interrupt();
    this.claudeChannelId(undefined);
    this.busy(false);
    await this.launchClaude();
  }

  async listFiles(pattern?: string, signal?: AbortSignal): Promise<any> {
    const connection = await this.getConnection();
    return connection.listFiles(pattern, signal);
  }

  /**
   * The official `setPermissionMode(mode, push, userInitiated = true)`: set it
   * here, then (when `push`) on the CLI. A prompt answer passes
   * `userInitiated: false`, so the host does not make it the default for new
   * sessions; leaving `dontAsk` never does either.
   */
  async setPermissionMode(mode: PermissionMode, applyToConnection = true, userInitiated = true): Promise<boolean> {
    const previous = this.permissionMode();
    this.permissionMode(mode);

    const channelId = this.claudeChannelId();
    if (!channelId || !applyToConnection) {
      return true;
    }
    const connection = await this.getConnection();
    const success = await connection.setPermissionMode(channelId, mode, userInitiated && previous !== 'dontAsk');
    if (!success) {
      this.permissionMode(previous);
    }
    return success;
  }

  /**
   * The official `setModel`: select optimistically, forget the last served model
   * (it belonged to the old selection), and on failure put both back and say so.
   * The official response has no `success` field -- a failure is an error
   * response, which the transport raises.
   */
  async setModel(model: ModelOption): Promise<boolean> {
    const previous = this.modelSelection();
    const previousServed = this.lastServedModel();
    this.modelSelection(model.value);
    this.modelSelectionWrites++;
    this.lastServedModel(undefined);

    const channelId = this.claudeChannelId();
    if (!channelId) {
      return true;
    }

    const connection = await this.getConnection();
    try {
      // The new model may not run the old effort (Sonnet has no Max): adopt
      // what the CLI says it applied, unless the user picked an effort meanwhile.
      const changes = this.effortChangeCount;
      const response = await this.queueSettingsApply(() => connection.setModel(channelId, model));
      if (this.effortChangeCount === changes) this.adoptAppliedEffort(response?.applied);
      return true;
    } catch (error) {
      if (this.modelSelection() === model.value) {
        this.modelSelection(previous);
        this.modelSelectionWrites++;
        this.lastServedModel(previousServed);
      }
      void this.context.showNotification?.(
        `Failed to set model: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
      return false;
    }
  }

  /** The official `applySettings`: make sure a channel exists, then write. */
  async applySettings(settings: Record<string, unknown>, opts?: { flagsOnly?: boolean; scope?: string }): Promise<void> {
    const connection = await this.getConnection();
    const channelId = await this.launchClaude();
    await connection.applySettings(settings, opts, channelId);
  }

  /** The official `queueSettingsApply`: one settings write at a time, in order. */
  private queueSettingsApply<T>(work: () => Promise<T>): Promise<T> {
    const next = this.settingsApplyChain.then(work, work);
    this.settingsApplyChain = next.then(
      () => {},
      () => {}
    );
    return next;
  }

  /**
   * The official `setEffortLevel`: show the level at once, then -- in order --
   * switch Ultracode off if it may be on, and write `effortLevel` to user
   * settings, which the host also pushes to the running CLI.
   */
  async setEffortLevel(level: string): Promise<void> {
    this.ultracodeSeeded = true;
    const clearUltracode = this.ultracodeEnabled() || this.ultracodeFlagMayBeSet;
    if (this.effortLevel() === level && !clearUltracode && !this.shownLevelUnpicked) return;
    this.effortChangeCount++;
    this.effortLevel(level);
    this.ultracodeEnabled(false);
    this.ultracodeFlagMayBeSet = false;
    this.shownLevelUnpicked = false;
    await this.queueSettingsApply(async () => {
      if (clearUltracode) await this.applySettings({ ultracode: null }, { flagsOnly: true });
      await this.applySettings({ effortLevel: level });
    });
  }

  /**
   * The official `enableUltracode`: Extra high effort, persisted like any
   * level, then the session-scoped `ultracode` flag.
   */
  async enableUltracode(): Promise<void> {
    this.ultracodeSeeded = true;
    if (this.ultracodeEnabled()) return;
    this.effortChangeCount++;
    this.effortLevel('xhigh');
    this.ultracodeEnabled(true);
    this.ultracodeFlagMayBeSet = true;
    this.shownLevelUnpicked = false;
    await this.queueSettingsApply(async () => {
      await this.applySettings({ effortLevel: 'xhigh' });
      await this.applySettings({ ultracode: true }, { flagsOnly: true });
    });
  }

  /**
   * The official `adoptAppliedEffort`: show the effort the CLI says it runs at
   * -- after `maxEffortLevel` caps and model downgrades -- and whether
   * Ultracode is on.
   */
  adoptAppliedEffort(applied: AppliedSettings | undefined): void {
    if (applied === undefined || typeof applied.effort !== 'string') return;
    this.ultracodeSeeded = true;
    if (this.effortLevel() !== applied.effort) {
      this.effortLevel(applied.effort);
      this.shownLevelUnpicked = true;
    }
    const ultracode = applied.ultracode ?? (applied.effort === 'xhigh' ? undefined : false);
    if (ultracode !== undefined) {
      this.ultracodeEnabled(ultracode);
      this.ultracodeFlagMayBeSet ||= ultracode;
    }
  }

  /**
   * The official `rereadAppliedSettings`: ask the CLI what it applied and adopt
   * the effort and the model, unless the user changed either in the meantime.
   */
  async rereadAppliedSettings(opts: { effort?: boolean; model?: boolean } = {}): Promise<void> {
    const connection = this.connection();
    const channelId = this.claudeChannelId();
    if (!connection || !channelId) return;
    const changes = this.effortChangeCount;
    const modelWrites = this.modelSelectionWrites;
    let applied: AppliedSettings | undefined;
    try {
      applied = await this.queueSettingsApply(() => connection.getAppliedSettings(channelId));
    } catch (error) {
      console.error('Failed to re-read applied Claude settings:', error);
      return;
    }
    if (applied === undefined || this.claudeChannelId() !== channelId) return;
    if (opts.effort !== false && this.effortChangeCount === changes) this.adoptAppliedEffort(applied);
    if (opts.model !== false && applied.model && this.modelSelectionWrites === modelWrites) {
      this.lastServedModel(undefined);
      this.adoptCliReportedModel(applied.model);
    }
  }

  /**
   * The official `adoptCliReportedModel`: point the picker at the row for the
   * model the CLI reports, when that is not already the current row.
   */
  private adoptCliReportedModel(model: string): void {
    const rows = this.claudeConfig()?.models;
    if (!rows) return;
    if (this.currentModelInfo()?.resolvedModel === model) return;
    const row =
      rows.find((r) => r.value !== 'default' && r.resolvedModel === model) ??
      rows.find((r) => r.value === model) ??
      rows.find((r) => r.value === modelFamily(model));
    if (row) {
      this.modelSelection(row.value);
      this.modelSelectionWrites++;
    }
  }

  /** The official `setThinkingLevel`: show it at once, then tell the host. */
  async setThinkingLevel(level: string): Promise<void> {
    this.thinkingLevelOverride(level);

    const channelId = this.claudeChannelId();
    if (!channelId) {
      return;
    }

    const connection = await this.getConnection();
    await connection.setThinkingLevel(channelId, level);
  }

  /** The official `getPlanComments(channelId)`, for this session's channel. */
  readonly planComments = computed<PlanComment[]>(() => {
    const channelId = this.claudeChannelId();
    const conn = this.connection();
    if (!channelId || !conn) return [];
    return conn.planCommentsByChannel().get(channelId) ?? [];
  });

  /** The official session's `openMarkdownPreview(content, title, enableComments)`. */
  openMarkdownPreview(content: string, title: string, enableComments: boolean): void {
    const channelId = this.claudeChannelId();
    const conn = this.connection();
    if (!conn || !channelId) return;
    void conn.openMarkdownPreview(channelId, content, title, enableComments);
  }

  /** The official `closePlanPreview()`. */
  closePlanPreview(): void {
    const channelId = this.claudeChannelId();
    const conn = this.connection();
    if (!conn || !channelId) return;
    void conn.closePlanPreview(channelId);
  }

  /** The official `removePlanComment(channelId, id)`, for this session's channel. */
  removePlanComment(commentId: string): void {
    const channelId = this.claudeChannelId();
    const conn = this.connection();
    if (!conn || !channelId) return;
    void conn.removePlanComment(channelId, commentId);
  }

  /** The official session's `listPermissionRules()`: on this session's CLI, launching it if needed. */
  async listPermissionRules(): Promise<ListPermissionRulesResponse> {
    const connection = await this.getConnection();
    const channelId = await this.launchClaude();
    return connection.listPermissionRules(channelId);
  }

  /** The official `addPermissionRules(rules, behavior, destination)`. */
  async addPermissionRules(
    rules: string[],
    behavior: PermissionBehavior,
    destination: EditableRuleDestination
  ): Promise<AddPermissionRulesResponse> {
    const connection = await this.getConnection();
    const channelId = await this.launchClaude();
    return connection.addPermissionRules(channelId, rules, behavior, destination);
  }

  /** The official `removePermissionRule(rule, behavior, source)`. */
  async removePermissionRule(
    rule: string,
    behavior: PermissionBehavior,
    source: EditableRuleDestination
  ): Promise<RemovePermissionRuleResponse> {
    const connection = await this.getConnection();
    const channelId = await this.launchClaude();
    return connection.removePermissionRule(channelId, rule, behavior, source);
  }

  async getMcpServers(): Promise<any> {
    const connection = await this.getConnection();
    const channelId = await this.launchClaude();
    return connection.getMcpServers(channelId);
  }

  async openConfigFile(configType: string): Promise<void> {
    const connection = await this.getConnection();
    await connection.openConfigFile(configType);
  }

  /**
   * Called for every permission request on this session's channel. The store
   * subscribes when the session is created, which is before its connection
   * exists, so the listener attaches once the connection is set (it used to
   * return a no-op then, and nothing ever fired).
   */
  onPermissionRequested(callback: (request: PermissionRequest) => void): () => void {
    let detach: (() => void) | undefined;
    const stop = effect(() => {
      const connection = this.connection();
      detach?.();
      detach = undefined;
      if (!connection) return;
      detach = connection.permissionRequested.add((request) => {
        // 动态获取当前 channelId，避免闭包捕获旧值
        if (request.channelId === this.claudeChannelId()) {
          callback(request);
        }
      });
    });
    return () => {
      stop();
      detach?.();
    };
  }

  dispose(): void {
    if (this.effectCleanup) {
      this.effectCleanup();
    }
  }

  private async readMessages(stream: AsyncIterable<any>): Promise<void> {
    try {
      for await (const event of stream) {
        this.processIncomingMessage(event);
      }
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
      this.busy(false);
    } finally {
      this.claudeChannelId(undefined);
    }
  }

  /** The official `retireAbandonedStreamedRows`: drop rows of the previous stream that no final message replaced. */
  private retireAbandonedStreamedRows(messages: Message[]): Message[] {
    const attempt = this.streamedAttempt;
    this.streamedAttempt = undefined;
    if (!attempt) return messages;
    return retireStreamedRows(messages, attempt.rows);
  }

  private processIncomingMessage(event: any): void {
    // 处理 LLM 请求错误（来自 SDK stderr 致命错误）
    // 双路分发：
    //   - 用户触发的请求（busy=true）→ 以 tip 消息追加到消息流，由 LLMErrorBlock 渲染
    //   - 非用户触发（busy=false，如 Profile 切换预热）→ VSCode Notification
    if (event?.type === '__llm_request_error__') {
      if (this.busy()) {
        // 用户主动请求期间的 LLM 错误：构造标准 raw 事件，走统一的 fromRaw → contentParsers 路径
        // 与 Interrupt 消息的分化方式一致：user 消息 → llm_error content block → tip 类型分化
        const syntheticEvent = {
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'llm_error', message: event.error }],
          },
        };
        const currentMessages = [...this.messages()] as Message[];
        processAndAttachMessage(currentMessages, syntheticEvent);
        this.messages(currentMessages);
        this.busy(false);
      } else {
        // 非用户触发（Profile 切换预热、channel 启动探测等）：VSCode Notification
        this.context.showNotification?.(event.error, 'error');
      }
      return;
    }

    // 🔥 使用完整的消息处理流程

    // 0. Stream events feed the assembler, which appends partial rows and grows
    //    them in place (the official `processMessage`, ahead of the message copy).
    if (event?.type === 'stream_event') {
      this.hasStreamingMessages = true;
      this.assembler.processStreamEvent(event.event, event.parent_tool_use_id ?? null);
    }

    // 1. 获取当前消息数组（转为可变数组）
    let currentMessages = [...this.messages()] as Message[];

    // 2. 处理特殊消息（TodoWrite, usage 等）
    this.processMessage(event);

    // A root final message for a different API message than the one streaming means
    // that stream was abandoned (a retry): retire its rows, as the official does.
    if (
      event?.type === 'assistant' &&
      !event.parent_tool_use_id &&
      event.message?.model &&
      event.message.model !== SYNTHETIC_MODEL &&
      this.streamedAttempt !== undefined &&
      event.message.id !== this.streamedAttempt.betaMessageId
    ) {
      currentMessages = this.retireAbandonedStreamedRows(currentMessages);
    }

    // 3. 使用工具函数处理消息：
    //    - 关联 tool_result 到 tool_use（响应式更新）
    //    - 流式时用最终 assistant 消息替换对应的部分行（官方 `ZM`）
    //    - 将原始事件转换为 Message 并添加到数组
    processAndAttachMessage(currentMessages, event, this.hasStreamingMessages);

    // 4. 合并连续 Read 消息为 ReadCoalesced（已禁用，保留作为参考）
    // const merged = mergeConsecutiveReadMessages(currentMessages);

    // 5. 更新 messages signal
    // this.messages(merged);
    this.messages(currentMessages);

    // 6. 更新其他状态
    if (event?.type === 'system') {
      this.sessionId(event.session_id);
      if (event.subtype === 'init') {
        this.busy(true);
      }
    } else if (event?.type === 'result') {
      this.busy(false);
      if (this.rereadAppliedOnResult) {
        this.rereadAppliedOnResult = false;
        void this.rereadAppliedSettings();
      }
    }
  }

  /**
   * 处理特殊消息（TodoWrite, usage 统计）
   */
  private processMessage(event: any): void {
    if (
      event.type === 'assistant' &&
      event.message?.content &&
      Array.isArray(event.message.content)
    ) {
      // 处理 TodoWrite
      for (const block of event.message.content) {
        if (
          block.type === 'tool_use' &&
          block.name === 'TodoWrite' &&
          block.input &&
          typeof block.input === 'object' &&
          'todos' in block.input
        ) {
          this.todos(block.input.todos);
        }
      }

      // 处理 usage 统计
      if (event.message.usage) {
        this.updateUsage(event.message.usage);
      }

      // The official records which model served each top-level turn.
      const served = servedModelOf(event);
      if (served) {
        this.lastServedModel(served);
      }
    }
  }

  /**
   * 更新 token 使用统计
   */
  private updateUsage(usage: any): void {
    const totalTokens =
      usage.input_tokens +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      usage.output_tokens;

    const current = this.usageData();
    this.usageData({
      totalTokens,
      totalCost: current.totalCost,
      contextWindow: current.contextWindow
    });
  }

  private buildUserMessage(
    input: string,
    attachments: AttachmentPayload[],
    selection?: SelectionRange
  ): any {
    const content: any[] = [];

    if (selection?.selectedText) {
      content.push({
        type: 'text',
        text: `<ide_selection>The user selected the lines ${selection.startLine} to ${selection.endLine} from ${selection.filePath}:
${selection.selectedText}

This may or may not be related to the current task.</ide_selection>`
      });
    }

    for (const attachment of attachments) {
      const { fileName, mediaType, data } = attachment;
      if (!data) {
        console.error(`Attachment missing data: ${fileName}`);
        continue;
      }

      const normalizedType = (mediaType || 'application/octet-stream').toLowerCase();

      if (IMAGE_MEDIA_TYPES.includes(normalizedType as (typeof IMAGE_MEDIA_TYPES)[number])) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: normalizedType,
            data
          }
        });
        continue;
      }

      if (normalizedType === 'text/plain') {
        try {
          const decoded = typeof globalThis.atob === 'function' ? globalThis.atob(data) : '';
          content.push({
            type: 'document',
            source: {
              type: 'text',
              media_type: 'text/plain',
              data: decoded
            },
            title: fileName
          });
          continue;
        } catch (error) {
          console.error('Failed to decode text attachment', error);
        }
      }

      if (normalizedType === 'application/pdf') {
        content.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data
          },
          title: fileName
        });
        continue;
      }

      console.error(`Unsupported attachment type: ${fileName} (${normalizedType})`);
    }

    content.push({ type: 'text', text: input });

    return {
      type: 'user',
      session_id: '',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content
      }
    };
  }

  private isSlashCommand(input: string): boolean {
    return input.trim().startsWith('/');
  }

  private isSameSelection(a?: SelectionRange, b?: SelectionRange): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return (
      a.filePath === b.filePath &&
      a.startLine === b.startLine &&
      a.endLine === b.endLine &&
      a.startColumn === b.startColumn &&
      a.endColumn === b.endColumn &&
      a.selectedText === b.selectedText
    );
  }
}
