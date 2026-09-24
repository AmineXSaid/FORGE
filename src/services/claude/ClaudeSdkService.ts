/**
 * ClaudeSdkService - Claude Agent SDK 薄封装
 *
 * 职责：
 * 1. 封装 @anthropic-ai/claude-agent-sdk 的 query() 调用
 * 2. 构建 SDK Options 对象
 * 3. 处理参数转换和环境配置
 * 4. 提供 interrupt() 方法中断查询
 *
 * 依赖：
 * - ILogService: 日志服务
 * - IConfigurationService: 配置服务
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createDecorator } from '../../di/instantiation';
import { ILogService } from '../logService';
import { IConfigurationService } from '../configurationService';
import { IFileSystemService } from '../fileSystemService';
import { IEndpointService } from '../endpoints/endpointService';
import { repeatGuard } from './repeatGuard';
import { withSpawnRetry } from './spawnRetry';
import { budgetFor, filterToolResponse, fullOutputStore, toolResponseText } from './smartStream';
import { IAgentService } from '../agents/agentService';
import { AsyncStream } from './transport';
import { buildExtraArgs, describeBuild, forgeBaseCliArgs } from './cliArgs';
import type { ClaudeBinary } from './permissionRules';
import { isMuslLinux, mergeLaunchEnvironment, resolveClaudeExecutable } from './cliLaunch';
import { runDoctor, type DoctorResult } from './doctor';

// SDK 类型导入
import type {
    Options,
    Query,
    CanUseTool,
    PermissionMode,
    SDKUserMessage,
    HookCallbackMatcher,
    ThinkingConfig,
} from '@anthropic-ai/claude-agent-sdk';
import { readThinkingLevel, writeThinkingLevel, type ThinkingLevel } from './thinkingLevel';
import { SessionPermissionModeStore } from './sessionPermissionModes';
import { ArchivedSessionStore } from './archivedSessions';
import { UnreadSessionStore } from './unreadSessions';
import { SessionGroupStore } from './sessionGroupStore';

/** The official globalState key for the Claude-in-Chrome install prompt. */
const CHROME_EXTENSION_PROMPT_DISMISSED_KEY = 'chromeExtensionNotificationDismissed';

export const IClaudeSdkService = createDecorator<IClaudeSdkService>('claudeSdkService');

/**
 * SDK 查询参数
 */
/**
 * stderr 中解析出的致命错误
 */
export interface LLMRequestError {
    statusCode: string;    // HTTP 状态码 (e.g. "401", "503")
    message: string;       // 人类可读的错误描述
    type: string;          // 上游错误类型 (e.g. "authentication_error", "new_api_error")
    raw: string;           // 原始 stderr 行
}

export interface SdkQueryParams {
    inputStream: AsyncStream<SDKUserMessage>;
    resume: string | null;
    canUseTool: CanUseTool;
    model: string | null;  // ← 接受 null，内部转换
    cwd: string;
    permissionMode: PermissionMode | string;  // ← 接受字符串
    /**
     * The official `thinking` option (`m$$`): `{type:'enabled', budgetTokens, display?}`
     * or `{type:'disabled'}` (`Options.thinking`, `sdk.d.ts` L1794; it replaces the
     * deprecated `maxThinkingTokens`, L1816).
     */
    thinking?: ThinkingConfig;
    /** 当 stderr 检测到致命错误（流式请求回退失败）时的回调 */
    onStderrError?: (error: LLMRequestError) => void;
}

export interface SdkProbeParams {
    capabilities: string[];
    cwd: string;
    timeoutMs?: number;
}

export interface SdkProbeResult {
    data: Record<string, any>;
    errors?: Record<string, string>;
}

/**
 * SDK 服务接口
 */
export interface IClaudeSdkService {
    readonly _serviceBrand: undefined;

    /**
     * 调用 Claude SDK 进行查询
     */
    query(params: SdkQueryParams): Promise<Query>;

    /**
     * 一次性探测 SDK 能力并立即释放
     */
    probe(params: SdkProbeParams): Promise<SdkProbeResult>;

    /**
     * 中断正在进行的查询
     */
    interrupt(query: Query): Promise<void>;

    /**
     * 运行 `claude doctor`，报告 CLI 版本与健康状况
     */
    checkCliHealth(): Promise<DoctorResult>;

    /**
     * Forge 会话实际启动的原生 `claude` 二进制路径
     *
     * "Open Forge in Terminal" launches this, never a `claude` from PATH.
     */
    resolveClaudeExecutablePath(): string;

    /** `ExtensionContext.asAbsolutePath`, for bundled resources. */
    asAbsolutePath(relativePath: string): string;

    /** The official `getThinkingLevel`: `globalState["thinkingLevel"]`, or "default_on". */
    getThinkingLevel(): string;

    /** The official `setThinkingLevel` on the settings store (`globalState`). */
    setThinkingLevel(level: ThinkingLevel): Promise<void>;

    /**
     * The official `getClaudeBinary()`: the binary a session runs, with the
     * environment it runs in, for CLI subcommands such as `edit-permission-rules`.
     */
    getClaudeBinary(): Promise<ClaudeBinary>;

    /**
     * The official `getAllowDangerouslySkipPermissions()`, read from
     * `forge.allowDangerouslySkipPermissions` and nothing else.
     */
    getAllowDangerouslySkipPermissions(): boolean;

    /**
     * The official `isBrowserIntegrationSupported()` (extension.js @3310292),
     * which reads `authManager.getAuthStatus()?.authMethod==="claudeai"`.
     *
     * Forge keeps login out of scope, so there is no auth status to read. What
     * the feature actually needs is the Claude binary: the browser MCP server
     * *is* that binary run with `--claude-in-chrome-mcp`. So Forge answers
     * "does that binary resolve", which is observable and honest -- a build
     * without a bundled CLI leaves the "Browse the web" row out (B4) rather
     * than offering a row that cannot connect. Step 28.
     */
    isBrowserIntegrationSupported(): boolean;

    /**
     * The official `globalState.get("chromeExtensionNotificationDismissed")`:
     * once the user picks "Don't Show Again", the Claude-in-Chrome install
     * prompt never appears again (step 28).
     */
    isChromeExtensionPromptDismissed(): boolean;
    dismissChromeExtensionPrompt(): Promise<void>;

    /**
     * The official settings store's session modes (`C1$`): one `globalState`
     * entry per conversation, so a reopened session starts in its mode (step 18).
     */
    getSessionPermissionModeStore(): SessionPermissionModeStore;

    /**
     * The official settings store`s archived sessions (`hiddenSessionIds` and
     * `sessionUnarchivedAt` in `globalState`), step 21.
     */
    getArchivedSessionStore(): ArchivedSessionStore;

    /**
     * The official settings store`s unread keys
     * (`sessionUnread:<scope root>` in `globalState`), step 22.
     */
    getUnreadSessionStore(): UnreadSessionStore;

    /**
     * The official settings store's session groups, section collapse state
     * (`sessionGroups:` / `sessionSectionCollapseState:<scope root>`) and
     * collapsed panel sections (`collapsedPanelSections`), in `globalState`.
     */
    getSessionGroupStore(): SessionGroupStore;
}

/** Forge's bundled plugin, relative to the extension root (it ships: `.vscodeignore` keeps `resources/`). */
export const FORGE_PLUGIN_DIR = 'resources/forge-plugin';

/**
 * The Expert mode's output style. The CLI names a plugin's styles
 * `<plugin>:<name>` (the native CLI's plugin output-style loader:
 * `L=\`${n}:${M}\``), and the plugin is `forge`.
 */
export const EXPERT_OUTPUT_STYLE = 'forge:Expert';

export const VS_CODE_APPEND_PROMPT = `
  # Identity

  You are **Forge**, a coding agent made by **Lemino**, running inside Visual
  Studio Code.

  When someone greets you or asks who you are, answer as Forge in one short line
  and get straight to the work -- in the spirit of "I'm Forge, made by Lemino.
  What are we forging today?". Vary the wording naturally; it is an
  introduction, not a script to recite.

  Do not introduce yourself as Claude, as Claude Code, or as an assistant made
  by Anthropic. "Forge" is the product you are; if someone asks directly which
  underlying model you run on, answer that honestly rather than dodging.

  Lemino is Mohamed Amine Said, who works at KPIT Tunisia. Lemino created
  Forge, the coding agent you are, which runs inside Visual Studio Code to help
  with software engineering tasks. When asked who Lemino is, say so.

  # VSCode Extension Context

  You are running inside a VSCode native extension environment.

  ## Code References in Text
  IMPORTANT: When referencing files or code locations, use markdown link syntax to make them clickable:
  - For files: [filename.ts](src/filename.ts)
  - For specific lines: [filename.ts:42](src/filename.ts#L42)
  - For a range of lines: [filename.ts:42-51](src/filename.ts#L42-L51)
  - For folders: [src/utils/](src/utils/)
  Unless explicitly asked for by the user, DO NOT USE backtickets \` or HTML tags like code for file references - always use markdown [text](link) format.
  The URL links should be relative paths from the root of  the user's workspace.

  ## User Selection Context
  The user's IDE selection (if any) is included in the conversation context and marked with ide_selection tags. This represents code or text the user has highlighted in their editor and may or may not be relevant to their request.`;

/**
 * Names that carry a credential. The output channel is written to disk and is
 * the first thing anyone pastes into a bug report, so these never appear in it
 * verbatim -- the length is enough to tell "set" from "empty" while debugging.
 */
const SECRET_ENV_PATTERN = /(TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)/i;

function redactEnvValue(key: string, value: string): string {
    if (!SECRET_ENV_PATTERN.test(key)) return value;
    return value ? `<redacted, ${value.length} chars>` : '<empty>';
}

const SDK_PROBE_CAPABILITIES: Record<string, (query: Query) => Promise<any>> = {
    supportedCommands: (query) => query.supportedCommands?.(),
    supportedModels: (query) => query.supportedModels?.(),
    mcpServerStatus: (query) => query.mcpServerStatus?.(),
    accountInfo: (query) => query.accountInfo?.()
};

/**
 * ClaudeSdkService 实现
 */
export class ClaudeSdkService implements IClaudeSdkService {
    readonly _serviceBrand: undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        @ILogService private readonly logService: ILogService,
        @IConfigurationService private readonly configService: IConfigurationService,
        @IFileSystemService private readonly fileSystemService: IFileSystemService,
        @IEndpointService private readonly endpointService: IEndpointService,
        @IAgentService private readonly agentService: IAgentService
    ) {
        this.logService.info('[ClaudeSdkService] Initialized');
    }

    /**
     * 调用 Claude SDK 进行查询
     */
    async query(params: SdkQueryParams): Promise<Query> {
        const { inputStream, resume, canUseTool, model, cwd, permissionMode, thinking, onStderrError } = params;

        this.logService.info('========================================');
        this.logService.info('ClaudeSdkService.query() starting');
        this.logService.info('========================================');
        this.logService.info(`📋 Parameters:`);
        this.logService.info(`  - model: ${model}`);
        this.logService.info(`  - cwd: ${cwd}`);
        this.logService.info(`  - permissionMode: ${permissionMode}`);
        this.logService.info(`  - resume: ${resume}`);
        this.logService.info(`  - thinking: ${thinking ? JSON.stringify(thinking) : 'undefined'}`);

        // 参数转换
        const modelParam = model === null ? "default" : model;
        const permissionModeParam = permissionMode as PermissionMode;
        const cwdParam = cwd;

        this.logService.info(`🔄 Resolved:`);
        this.logService.info(`  - modelParam: ${modelParam}`);
        this.logService.info(`  - permissionModeParam: ${permissionModeParam}`);
        this.logService.info(`  - cwdParam: ${cwdParam}`);

        // 获取 CLI 路径（避免 TypeScript 类型推断问题）
        const cliPath = await this.getClaudeExecutablePath();

        // 获取环境变量（Agent 可绑定自己的端点 Profile）
        const env = await this.getMergedEnvironmentVariables(
            this.agentService.getActiveSdkOptions()?.endpointProfile
        );

        // 记录环境变量（凭据一律脱敏）
        // One line at info; the whole environment (redacted) at trace.
        this.logService.info(`🌍 Environment: ${Object.keys(env ?? {}).length} variable(s)`);
        for (const [key, value] of Object.entries(env ?? {})) {
            this.logService.trace(`  - ${key}: ${redactEnvValue(key, value)}`);
        }

        // 记录 CLI 路径
        const forgePath = path.join(os.homedir(), '.claude', 'forge.json');
        this.logService.info(`📂 CLI binary and settings:`);
        this.logService.info(`  - CLI Path: ${cliPath}`);
        this.logService.info(`  - Settings Path: ${forgePath}`);

        // 检查 CLI 是否存在
        if (!(await this.fileSystemService.pathExists(cliPath))) {
          this.logService.error(`❌ Claude CLI not found at: ${cliPath}`);
          throw new Error(`Claude CLI not found at: ${cliPath}`);
        }
        this.logService.info(`  ✓ CLI binary found`);

        // 检查文件权限
        try {
          const stats = await this.fileSystemService.stat(vscode.Uri.file(cliPath));
          const isExec = await this.fileSystemService.isExecutable(cliPath);
          this.logService.info(`  - File size: ${stats.size} bytes`);
          this.logService.info(`  - Is executable: ${isExec}`);
        } catch (e) {
          this.logService.warn(`  ⚠ Could not check file stats: ${e}`);
        }

        // 活动 Hermes Agent：人格、模型、工具作用域
        // 作用域由 CLI 依据 allowedTools 强制执行 —— CLI 从未获知的工具无法被调用。
        const agentOptions = this.agentService.getActiveSdkOptions();

        // On an endpoint the model is the profile's: the endpoint and its model
        // are one choice. The webview names the pair (its row value is the
        // profile name), which is not a model id, and a Claude default would be
        // sent to a gateway that does not serve it -- the "first message fails"
        // report. `relayEnvironment` put the profile's model in the env.
        const endpointModel = env.ANTHROPIC_BASE_URL && env.ANTHROPIC_MODEL ? env.ANTHROPIC_MODEL : undefined;

        // 构建 SDK Options
        const options: Options = {
            // 基本参数
            cwd: cwdParam,
            resume: resume || undefined,
            model: agentOptions?.model ?? endpointModel ?? modelParam,
            permissionMode: permissionModeParam,
            // sdk.d.ts:1894: "Must be set to `true` when using permissionMode:
            // 'bypassPermissions'." The official passes it on every launch; the
            // SDK then emits --allow-dangerously-skip-permissions, which is why
            // a session can switch into bypass later without a relaunch.
            ...(this.getAllowDangerouslySkipPermissions() && { allowDangerouslySkipPermissions: true }),
            thinking,

            // CanUseTool 回调
            canUseTool,

            // 日志回调 - 捕获 SDK 进程的所有标准错误输出
            stderr: (data: string) => {
                const lines = data.trim().split('\n');

                for (const line of lines) {
                    if (!line.trim()) continue;

                    // `--debug-to-stderr` writes every CLI debug line here, as
                    // `<ISO time> [LEVEL] message`. Only its errors and warnings
                    // belong in the Forge channel by default; the rest is trace,
                    // visible when the channel's level is set to Trace.
                    logStderrLine(this.logService, line);

                    // 检测流式请求回退错误：
                    // "Error streaming, falling back to non-streaming mode: {statusCode} {json}"
                    if (onStderrError) {
                        const streamingErrorMatch = line.match(
                            /Error streaming, falling back to non-streaming mode:\s*(\d+)\s*(.*)/
                        );
                        if (streamingErrorMatch) {
                            const statusCode = streamingErrorMatch[1];
                            const rest = streamingErrorMatch[2];

                            let message = `HTTP ${statusCode}`;
                            let errorType = 'unknown';
                            try {
                                const jsonMatch = rest.match(/(\{[\s\S]*\})/);
                                if (jsonMatch) {
                                    const parsed = JSON.parse(jsonMatch[1]);
                                    const err = parsed.error || parsed;
                                    message = err.message || err.msg || message;
                                    errorType = err.type || err.code || errorType;
                                }
                            } catch { /* non-JSON tail, use statusCode as message */ }

                            onStderrError({ statusCode, message, type: errorType, raw: line });
                        }
                    }
                }
            },

            // 环境变量
            env,

            // 系统提示追加
            systemPrompt: {
                type: 'preset',
                preset: 'claude_code',
                append: agentOptions?.systemPromptAppend
                    ? `${VS_CODE_APPEND_PROMPT}

${agentOptions.systemPromptAppend}`
                    : VS_CODE_APPEND_PROMPT
            },

            // Forge's own plugin (`sdk.d.ts` `plugins`): it carries the Expert
            // output style, which the CLI names `forge:Expert` and the mode
            // menu switches on per session through the flag layer.
            plugins: [{ type: 'local', path: this.context.asAbsolutePath(FORGE_PLUGIN_DIR) }],

            // 工具作用域：仅在 Agent 实际做出限制时传入，
            // 空数组会被解读为“完全禁用工具”，这并非无限制 Agent 的本意。
            ...(agentOptions?.allowedTools ? { allowedTools: agentOptions.allowedTools } : {}),
            ...(agentOptions?.disallowedTools ? { disallowedTools: agentOptions.disallowedTools } : {}),

            // Hooks
            hooks: {
                // PreToolUse: 工具执行前
                PreToolUse: [{
                    matcher: "Edit|Write|MultiEdit",
                    hooks: [async (input) => {
                        if ('tool_name' in input) {
                            // `effort.level` is the effort this turn actually ran at, as the
                            // CLI reports it (BaseHookInput, `sdk.d.ts` L191).
                            this.logService.trace(`[Hook] PreToolUse: ${input.tool_name}${input.effort ? ` (effort: ${input.effort.level})` : ''}`);
                        }
                        return { continue: true };
                    }]
                }, {
                    // The repeat guard watches every tool, not just the file
                    // ones: the calls a model loops on are usually the ones that
                    // do not exist, and those match no specific name.
                    hooks: [async (input) => {
                        if (!('tool_name' in input) || input.hook_event_name !== 'PreToolUse') {
                            return { continue: true };
                        }
                        const verdict = repeatGuard.check(
                            input.session_id ?? 'default',
                            input.tool_name,
                            input.tool_input,
                        );
                        if (!verdict.refuse) return { continue: true };

                        this.logService.info(
                            `[RepeatGuard] refused ${input.tool_name} (${verdict.tier}, ` +
                            `${verdict.failures} prior failure(s))`,
                        );
                        // Denied with an explanation rather than silently: the
                        // model has to be told why, or it simply tries again.
                        return {
                            continue: true,
                            hookSpecificOutput: {
                                hookEventName: 'PreToolUse',
                                permissionDecision: 'deny',
                                permissionDecisionReason: verdict.reason,
                            },
                        };
                    }]
                }] as HookCallbackMatcher[],

                // PostToolUseFailure: what the repeat guard counts.
                PostToolUseFailure: [{
                    hooks: [async (input) => {
                        if ('tool_name' in input && input.hook_event_name === 'PostToolUseFailure') {
                            // An interrupt is the user stopping the turn, not the
                            // model failing to adapt, so it must not build a streak.
                            if (!input.is_interrupt) {
                                repeatGuard.recordFailure(
                                    input.session_id ?? 'default',
                                    input.tool_name,
                                    input.tool_input,
                                    String(input.error ?? ''),
                                );
                            }
                        }
                        return { continue: true };
                    }]
                }] as HookCallbackMatcher[],
                // PostToolUse: 工具执行后
                PostToolUse: [{
                    matcher: "Edit|Write|MultiEdit",
                    hooks: [async (input) => {
                        if ('tool_name' in input) {
                            // `effort.level` is the effort this turn actually ran at, as the
                            // CLI reports it (BaseHookInput, `sdk.d.ts` L191).
                            this.logService.trace(`[Hook] PostToolUse: ${input.tool_name}${input.effort ? ` (effort: ${input.effort.level})` : ''}`);
                        }
                        return { continue: true };
                    }]
                }, {
                    // A success clears the streak, so a transient failure that
                    // later works does not leave the model one attempt away
                    // from being refused for a call that demonstrably succeeds.
                    hooks: [async (input) => {
                        if ('tool_name' in input && input.hook_event_name === 'PostToolUse') {
                            repeatGuard.recordSuccess(
                                input.session_id ?? 'default',
                                input.tool_name,
                                input.tool_input,
                            );
                        }
                        return { continue: true };
                    }]
                }, {
                    // Smart stream: abridge high-volume output before it reaches
                    // the model. The budget comes from the active endpoint's
                    // contextWindow, so a 32k self-hosted model filters hard
                    // where a 200k Claude barely filters at all.
                    hooks: [async (input) => {
                        if (!('tool_name' in input) || input.hook_event_name !== 'PostToolUse') {
                            return { continue: true };
                        }
                        // `tool_response` is not always a string: measured
                        // against the real CLI, Bash returns
                        // {stdout, stderr, interrupted, isImage}. Handling only
                        // strings silently skipped the one tool most likely to
                        // emit ten thousand lines.
                        const raw = input.tool_response;
                        const full = toolResponseText(raw);
                        if (!full) return { continue: true };

                        // The unabridged text is kept host-side: the claim
                        // checker verifies against tool output, and filtering
                        // away its evidence would make it report failures that
                        // did not happen.
                        fullOutputStore.set(input.tool_use_id, full);

                        const result = filterToolResponse(raw, budgetFor(this.activeContextWindow()));
                        if (!result) return { continue: true };

                        this.logService.info(
                            `[SmartStream] ${input.tool_name}: ${result.stats.originalLines} lines ` +
                            `-> ${result.stats.keptLines} (${result.stats.duplicateLines} repeated, ` +
                            `${result.stats.elidedLines} hidden)`,
                        );
                        return {
                            continue: true,
                            hookSpecificOutput: {
                                hookEventName: 'PostToolUse',
                                updatedToolOutput: result.response,
                            },
                        };
                    }]
                }] as HookCallbackMatcher[]
            },

            // CLI 可执行文件路径
            pathToClaudeCodeExecutable: cliPath,

            // 额外参数：在下方根据已构建的 Options 生成（见 buildExtraArgs）
            extraArgs: {},

            // 设置源 (控制 CLAUDE.md 和 settings.json 的加载)
            // 'user': ~/.claude/settings.json, ~/.claude/CLAUDE.md
            // 'project': .claude/settings.json, .claude/CLAUDE.md
            // 'local': .claude/settings.local.json, CLAUDE.local.md
            // 注意: forge.json 通过 extraArgs.settings 传入，作为 flagSettings 优先级最高
            settingSources: ['user', 'project', 'local'],

            includePartialMessages: true,

            // File checkpointing (sdk.d.ts:1605). `Query.rewindFiles()` has
            // nothing to restore unless the query that launched the session was
            // started with this on, and the official exposes no toggle for it,
            // so Forge turns it on for every session (step 24, the user's
            // decision on 2026-09-19). It is an SDK-native option, so it does
            // not go through cliArgs.ts's PROTOCOL / MANAGED / FREE gate.
            // The cost is real: the CLI backs a file up before it edits it.
            enableFileCheckpointing: true
        };

        // CLI 直通参数：Forge 的内置标志 + forge.cliArgs 用户配置
        // --settings 指向 forge.json，Profile 切换通过 ConfigurationService 同步内容到此文件，
        // CLI 会监听此文件变化，实现热更新。
        // The base map lives in cliArgs.ts (`forgeBaseCliArgs`) so a spec can
        // assert what actually ships -- including `--replay-user-messages`,
        // which the echo of a prompt the webview sent relies on being dropped by
        // the uuid guard in `messageUtils.processAndAttachMessage` (step 24).
        const cliArgs = buildExtraArgs(
            forgeBaseCliArgs(path.join(os.homedir(), '.claude', 'forge.json')),
            vscode.workspace.getConfiguration('forge').get('cliArgs'),
            // The Options of this launch: a configured flag is reported as a
            // duplicate only when the SDK also derives it from one of them.
            options,
        );
        this.logService.info(`🚩 CLI flags (extraArgs):`);
        for (const line of describeBuild(cliArgs)) {
            this.logService.info(line);
        }
        for (const d of cliArgs.rejected) {
            this.logService.warn(`forge.cliArgs: --${d.flag} was not applied (${d.reason})`);
        }

        options.extraArgs = cliArgs.extraArgs;

        // 调用 SDK
        this.logService.info('');
        this.logService.info('🚀 Calling the Claude Agent SDK');
        this.logService.info('----------------------------------------');

        // 设置入口点环境变量
        process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-vscode';
        this.logService.info(`🔧 Environment:`);
        this.logService.info(`  - CLAUDE_CODE_ENTRYPOINT: ${process.env.CLAUDE_CODE_ENTRYPOINT}`);
        const customEnvVars = await this.configService.getEnvironmentVariables();
        for (const [key, value] of Object.entries(customEnvVars)) {
            // Redacted like the env dump above: a custom variable is where people
            // put API keys.
            this.logService.info(`  - ${key}: ${redactEnvValue(key, value)}`);
        }

        this.logService.info('');
        this.logService.info('📦 Loading the SDK...');

        try {
            // 调用 SDK query() 函数
            const { query } = await import('@anthropic-ai/claude-agent-sdk');

            this.logService.info(`  - Options: [${Object.keys(options).join(', ')}]`);

            // Transient spawn failures only -- EBUSY and ETXTBSY in particular,
            // which happen while the CLI is being upgraded underneath a running
            // editor. A missing or non-executable binary is rethrown at once,
            // because retrying it five times only delays the message that
            // explains the problem. HTTP statuses never reach here: the CLI
            // handles its own 429/529 backoff.
            const result = await withSpawnRetry(
                async () => query({ prompt: inputStream, options }),
                cliPath,
                { log: (m) => this.logService.warn(m) },
            );
            return result;
        } catch (error) {
            this.logService.error('');
            this.logService.error('❌ SDK call failed');
            this.logService.error(`Error: ${error}`);
            if (error instanceof Error) {
                this.logService.error(`Message: ${error.message}`);
                this.logService.error(`Stack: ${error.stack}`);
            }
            this.logService.error('========================================');
            throw error;
        }
    }

    /**
     * The context window the smart-stream budget is derived from.
     *
     * The active profile's, when one is set, because that is the model the
     * output is actually going to. With no profile this is Anthropic's window,
     * where the budget works out large enough that ordinary tool output passes
     * through untouched -- which is the intended behaviour, not an accident:
     * no profile means no behaviour change.
     */
    private activeContextWindow(): number {
        return this.endpointService.getStatus().profile?.capabilities.contextWindow ?? 200_000;
    }

    /**
     * 一次性探测 SDK 能力并立即释放（轻量级版本）
     */
    async probe(params: SdkProbeParams): Promise<SdkProbeResult> {
        const capabilities = Array.from(new Set(params.capabilities ?? [])).filter(Boolean);
        if (capabilities.length === 0) {
            return { data: {} };
        }

        const timeoutMs = Math.max(1000, params.timeoutMs ?? 10000);
        const data: Record<string, any> = {};
        const errors: Record<string, string> = {};

        let query: Query | undefined;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        try {
            await Promise.race([
                (async () => {
                    // 使用轻量级查询
                    query = await this.queryLite(params.cwd);

                    for (const capability of capabilities) {
                        const handler = SDK_PROBE_CAPABILITIES[capability];
                        if (!handler) {
                            errors[capability] = 'Unsupported capability';
                            continue;
                        }

                        try {
                            data[capability] = await handler(query);
                        } catch (error) {
                            errors[capability] = error instanceof Error ? error.message : String(error);
                        }
                    }
                })(),
                new Promise<void>((_, reject) => {
                    timeoutId = setTimeout(() => {
                        reject(new Error('SDK probe timed out'));
                    }, timeoutMs);
                })
            ]);
        } catch (error) {
            if (query) {
                try {
                    await this.interrupt(query);
                } catch {
                    // 静默忽略中断错误
                }
            }
            throw error;
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            if (query?.return) {
                try {
                    await query.return();
                } catch {
                    // 静默忽略关闭错误
                }
            }
        }

        // 打印探测结果
        // this.logService.info(`[Probe] 结果: ${JSON.stringify(data, null, 2)}`);

        return {
            data,
            errors: Object.keys(errors).length ? errors : undefined
        };
    }

    /**
     * 轻量级 SDK 查询（仅用于 probe）
     * 不输出日志，不加载 hooks，最小化配置
     */
    private async queryLite(cwd: string): Promise<Query> {
        const inputStream = new AsyncStream<SDKUserMessage>();

        // 立即关闭输入流（probe 不需要发送消息）
        inputStream.done();

        const cliPath = await this.getClaudeExecutablePath();

        const options: Options = {
            // 最小化配置
            cwd,
            model: 'default',
            permissionMode: 'default' as PermissionMode,
            // The official config probe launches with thinking disabled.
            thinking: { type: 'disabled' },

            // 权限回调（直接拒绝）
            canUseTool: async () => ({
                behavior: 'deny' as const,
                message: 'SDK probe only'
            }),

            // 不加载任何设置源
            settingSources: [],

            // 不输出 stderr
            stderr: () => {},

            // CLI 路径
            pathToClaudeCodeExecutable: cliPath,

            // 最小化额外参数（移除 debug 标志）
            extraArgs: {},

            // 不包含 partial messages
            includePartialMessages: false,

            // 不加载 hooks
            hooks: {}
        };

        const { query } = await import('@anthropic-ai/claude-agent-sdk');
        return query({ prompt: inputStream, options });
    }

    /**
     * 中断正在进行的查询
     */
    async interrupt(query: Query): Promise<void> {
        try {
            this.logService.info('🛑 Interrupting the Claude SDK query');
            await query.interrupt();
            this.logService.info('✓ Query interrupted');
        } catch (error) {
            this.logService.error(`❌ Interrupt failed: ${error}`);
            throw error;
        }
    }

    /**
     * 获取合并后的环境变量 (process.env + custom)
     */
    private async getMergedEnvironmentVariables(endpointProfile?: string): Promise<Record<string, string>> {
        const customVars = await this.configService.getEnvironmentVariables();

        // 安全合并 process.env (过滤 undefined)
        const env: Record<string, string> = {};
        Object.entries(process.env).forEach(([key, value]) => {
            if (value !== undefined) {
                env[key] = value;
            }
        });

        // Endpoint routing. When a profile is active this points the spawned CLI
        // at a loopback relay that owns the mTLS / proxy / transform path the
        // binary cannot do itself. With no profile it returns {} and the default
        // Anthropic endpoint is used untouched.
        const endpointEnv = await this.endpointService.getEnvironment(endpointProfile);
        if (Object.keys(endpointEnv).length > 0) {
            this.logService.info(`🔌 Endpoint in use: ANTHROPIC_BASE_URL=${endpointEnv.ANTHROPIC_BASE_URL}`);
        }

        // User-defined variables win over the host's and the official defaults,
        // but not over the endpoint's relay keys (see `mergeLaunchEnvironment`),
        // and the entrypoint is stamped last, as the official does. Setting it
        // here rather than on process.env is what makes the *first* launch
        // report it too.
        // Forge's defaults (attribution header, non-essential traffic, install
        // checks) reach its own launches here and through forge.json, never
        // through ~/.claude/settings.json, which the terminal CLI reads too.
        await this.configService.whenReady();
        const launchDefaults = this.configService.forgeLaunchDefaults().env as Record<string, string> | undefined;
        const merged = mergeLaunchEnvironment(env, endpointEnv, customVars, launchDefaults ?? {});
        if (merged.shadowed.length) {
            this.logService.warn(
                `[env] ${merged.shadowed.join(', ')} from Forge's environment variables ` +
                `ignored: the endpoint in use sets ${merged.shadowed.length === 1 ? 'it' : 'them'}.`
            );
        }
        return merged.env;
    }

    /**
     * 运行 `claude doctor` 并把结果写入输出通道。
     *
     * CLI 标志会随版本漂移，提前暴露版本与环境问题，好过在对话中途
     * 收到一个不透明的 spawn 错误。此检查仅供参考，绝不阻塞激活。
     */
    async checkCliHealth(): Promise<DoctorResult> {
        let cliPath: string;
        try {
            cliPath = await this.getClaudeExecutablePath();
        } catch (error) {
            // No bundled binary (resources/native-binary is filled by the build):
            // report it like any other doctor failure instead of throwing.
            const message = error instanceof Error ? error.message : String(error);
            this.logService.warn(`🩺 claude doctor could not run: ${message}`);
            return { ok: false, output: '', error: message };
        }
        this.logService.info(`🩺 claude doctor: ${cliPath}`);

        const result = await runDoctor(cliPath);
        if (result.error) {
            this.logService.warn(`  doctor could not run: ${result.error}`);
            return result;
        }
        for (const line of result.output.split(/\r?\n/)) {
            this.logService.info(`  ${line}`);
        }
        if (!result.ok) {
            this.logService.warn('  CLI health check reported a problem; Forge may not be able to start a session.');
        }
        return result;
    }

    /**
     * 获取 Claude CLI 可执行文件路径
     *
     * The official `xh0`: a native binary under resources/, or an error. There is
     * no cli.js fallback: the SDK's flags follow its own CLI release.
     */
    private async getClaudeExecutablePath(): Promise<string> {
        return this.resolveClaudeExecutablePath();
    }

    /**
     * The same binary, synchronously, for callers outside the query path --
     * "Open Forge in Terminal" must launch what a session would launch.
     */
    resolveClaudeExecutablePath(): string {
        return resolveClaudeExecutable({
            platform: process.platform,
            arch: process.arch,
            asAbsolutePath: (relativePath) => this.context.asAbsolutePath(relativePath),
            exists: (absolutePath) => fs.existsSync(absolutePath),
            isMusl: () => isMuslLinux(),
        });
    }

    /** `ExtensionContext.asAbsolutePath`, for bundled resources such as the terminal icon. */
    asAbsolutePath(relativePath: string): string {
        return this.context.asAbsolutePath(relativePath);
    }

    /** The thinking level persists where the official keeps it: this extension's globalState. */
    getThinkingLevel(): string {
        return readThinkingLevel(this.context.globalState);
    }

    async setThinkingLevel(level: ThinkingLevel): Promise<void> {
        await writeThinkingLevel(this.context.globalState, level);
    }

    async getClaudeBinary(): Promise<ClaudeBinary> {
        return {
            pathToClaudeCodeExecutable: this.resolveClaudeExecutablePath(),
            // A native binary: no interpreter and no leading arguments (the official `o1$`).
            executableArgs: [],
            env: await this.getMergedEnvironmentVariables(),
        };
    }

    getAllowDangerouslySkipPermissions(): boolean {
        // The official `getAllowDangerouslySkipPermissions(){return W1("allowDangerouslySkipPermissions")||!1}`,
        // as `forge.allowDangerouslySkipPermissions`, and nothing else: the
        // bypass flags in `forge.cliArgs` are refused (`SETTING_OWNED_FLAGS`).
        const config = vscode.workspace.getConfiguration('forge');
        return config.get<boolean>('allowDangerouslySkipPermissions', false) === true;
    }

    /**
     * Step 28: the browser integration needs `claude --claude-in-chrome-mcp`,
     * so it is supported exactly when that binary resolves.
     * `resolveClaudeExecutable` throws when nothing is bundled for this
     * platform, which is the one case the official's row must not appear in.
     */
    isBrowserIntegrationSupported(): boolean {
        try {
            return !!this.resolveClaudeExecutablePath();
        } catch (error) {
            this.logService.warn(`[isBrowserIntegrationSupported] no Claude binary: ${error}`);
            return false;
        }
    }

    /** The official globalState key, verbatim. */
    isChromeExtensionPromptDismissed(): boolean {
        return this.context.globalState.get<boolean>(CHROME_EXTENSION_PROMPT_DISMISSED_KEY) === true;
    }

    async dismissChromeExtensionPrompt(): Promise<void> {
        await this.context.globalState.update(CHROME_EXTENSION_PROMPT_DISMISSED_KEY, true);
    }

    private unreadSessionStore?: UnreadSessionStore;

    getUnreadSessionStore(): UnreadSessionStore {
        this.unreadSessionStore ??= new UnreadSessionStore(
            this.context.globalState,
            () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir()
        );
        return this.unreadSessionStore;
    }

    private sessionGroupStore?: SessionGroupStore;

    getSessionGroupStore(): SessionGroupStore {
        this.sessionGroupStore ??= new SessionGroupStore(
            this.context.globalState,
            () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir()
        );
        return this.sessionGroupStore;
    }

    private archivedSessionStore?: ArchivedSessionStore;

    getArchivedSessionStore(): ArchivedSessionStore {
        this.archivedSessionStore ??= new ArchivedSessionStore(this.context.globalState);
        return this.archivedSessionStore;
    }

    private sessionPermissionModeStore?: SessionPermissionModeStore;

    getSessionPermissionModeStore(): SessionPermissionModeStore {
        this.sessionPermissionModeStore ??= new SessionPermissionModeStore(
            this.context.globalState,
            () => this.getAllowDangerouslySkipPermissions()
        );
        return this.sessionPermissionModeStore;
    }
}

/**
 * One stderr line from the CLI, at the level it carries.
 *
 * The CLI's debug logger writes `${new Date().toISOString()} [${level.toUpperCase()}] ${message}`
 * (the 0.3.274 native binary). `[ERROR]` and `[WARN]` keep their level; every
 * other marked line (`[DEBUG]`, `[INFO]`) is trace. An unmarked line is output
 * the CLI wrote itself, not its logger: a warning when it reads like a
 * failure, else trace. It used to log every line at info, several thousand a
 * session (production audit, 2026-09-24).
 */
export function stderrLineLevel(line: string): 'error' | 'warn' | 'trace' {
    const marked = line.match(/^\S+\s+\[(DEBUG|INFO|WARN|ERROR)\]/);
    if (marked) {
        if (marked[1] === 'ERROR') return 'error';
        if (marked[1] === 'WARN') return 'warn';
        return 'trace';
    }
    return /\b(error|failed|exception|fatal|panic)\b/i.test(line) ? 'warn' : 'trace';
}

export function logStderrLine(log: Pick<ILogService, 'error' | 'warn' | 'trace'>, line: string): void {
    log[stderrLineLevel(line)](`[CLI] ${line}`);
}
