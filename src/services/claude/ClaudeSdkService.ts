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
import { IAgentService } from '../agents/agentService';
import { AsyncStream } from './transport';
import { allowsDangerouslySkipPermissions, buildExtraArgs, describeBuild } from './cliArgs';
import type { ClaudeBinary } from './permissionRules';
import { OFFICIAL_CLI_ENV_DEFAULTS, isMuslLinux, resolveClaudeExecutable, withOfficialEntrypoint } from './cliLaunch';
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
     * The official `getAllowDangerouslySkipPermissions()`. Forge has no such
     * setting; bypass is allowed when `forge.cliArgs` enables it.
     */
    getAllowDangerouslySkipPermissions(): boolean;

    /**
     * The official settings store's session modes (`C1$`): one `globalState`
     * entry per conversation, so a reopened session starts in its mode (step 18).
     */
    getSessionPermissionModeStore(): SessionPermissionModeStore;
}

const VS_CODE_APPEND_PROMPT = `
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
        this.logService.info('[ClaudeSdkService] 已初始化');
    }

    /**
     * 调用 Claude SDK 进行查询
     */
    async query(params: SdkQueryParams): Promise<Query> {
        const { inputStream, resume, canUseTool, model, cwd, permissionMode, thinking, onStderrError } = params;

        this.logService.info('========================================');
        this.logService.info('ClaudeSdkService.query() 开始调用');
        this.logService.info('========================================');
        this.logService.info(`📋 输入参数:`);
        this.logService.info(`  - model: ${model}`);
        this.logService.info(`  - cwd: ${cwd}`);
        this.logService.info(`  - permissionMode: ${permissionMode}`);
        this.logService.info(`  - resume: ${resume}`);
        this.logService.info(`  - thinking: ${thinking ? JSON.stringify(thinking) : 'undefined'}`);

        // 参数转换
        const modelParam = model === null ? "default" : model;
        const permissionModeParam = permissionMode as PermissionMode;
        const cwdParam = cwd;

        this.logService.info(`🔄 参数转换:`);
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
        this.logService.info(`🌍 环境变量 (env):`);
        if (env && Object.keys(env).length > 0) {
            for (const [key, value] of Object.entries(env)) {
                this.logService.info(`  - ${key}: ${redactEnvValue(key, value)}`);
            }
        } else {
            this.logService.info(`  (empty)`);
        }

        // 记录 CLI 路径
        const forgePath = path.join(os.homedir(), '.claude', 'forge.json');
        this.logService.info(`📂 CLI 可执行文件与配置:`);
        this.logService.info(`  - CLI Path: ${cliPath}`);
        this.logService.info(`  - Settings Path: ${forgePath}`);

        // 检查 CLI 是否存在
        if (!(await this.fileSystemService.pathExists(cliPath))) {
          this.logService.error(`❌ Claude CLI not found at: ${cliPath}`);
          throw new Error(`Claude CLI not found at: ${cliPath}`);
        }
        this.logService.info(`  ✓ CLI 文件存在`);

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

        // 构建 SDK Options
        const options: Options = {
            // 基本参数
            cwd: cwdParam,
            resume: resume || undefined,
            model: agentOptions?.model ?? modelParam,
            permissionMode: permissionModeParam,
            thinking,

            // CanUseTool 回调
            canUseTool,

            // 日志回调 - 捕获 SDK 进程的所有标准错误输出
            stderr: (data: string) => {
                const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
                const lines = data.trim().split('\n');

                for (const line of lines) {
                    if (!line.trim()) continue;

                    // 检测错误级别
                    const lowerLine = line.toLowerCase();
                    let level = 'INFO';

                    if (lowerLine.includes('error') || lowerLine.includes('failed') || lowerLine.includes('exception')) {
                        level = 'ERROR';
                    } else if (lowerLine.includes('warn') || lowerLine.includes('warning')) {
                        level = 'WARN';
                    } else if (lowerLine.includes('exit') || lowerLine.includes('terminated')) {
                        level = 'EXIT';
                    }

                    this.logService.info(`[${timestamp}] [SDK ${level}] ${line}`);

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

            // 工具作用域：仅在 Agent 实际做出限制时传入，
            // 空数组会被解读为“完全禁用工具”，这并非无限制 Agent 的本意。
            ...(agentOptions?.allowedTools ? { allowedTools: agentOptions.allowedTools } : {}),
            ...(agentOptions?.disallowedTools ? { disallowedTools: agentOptions.disallowedTools } : {}),

            // Hooks
            hooks: {
                // PreToolUse: 工具执行前
                PreToolUse: [{
                    matcher: "Edit|Write|MultiEdit",
                    hooks: [async (input, toolUseID, options) => {
                        if ('tool_name' in input) {
                            // `effort.level` is the effort this turn actually ran at, as the
                            // CLI reports it (BaseHookInput, `sdk.d.ts` L191).
                            this.logService.info(`[Hook] PreToolUse: ${input.tool_name}${input.effort ? ` (effort: ${input.effort.level})` : ''}`);
                        }
                        return { continue: true };
                    }]
                }] as HookCallbackMatcher[],
                // PostToolUse: 工具执行后
                PostToolUse: [{
                    matcher: "Edit|Write|MultiEdit",
                    hooks: [async (input, toolUseID, options) => {
                        if ('tool_name' in input) {
                            // `effort.level` is the effort this turn actually ran at, as the
                            // CLI reports it (BaseHookInput, `sdk.d.ts` L191).
                            this.logService.info(`[Hook] PostToolUse: ${input.tool_name}${input.effort ? ` (effort: ${input.effort.level})` : ''}`);
                        }
                        return { continue: true };
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

            includePartialMessages: true
        };

        // CLI 直通参数：Forge 的内置标志 + forge.cliArgs 用户配置
        // --settings 指向 forge.json，Profile 切换通过 ConfigurationService 同步内容到此文件，
        // CLI 会监听此文件变化，实现热更新。
        const cliArgs = buildExtraArgs(
            {
                'debug': null,
                'debug-to-stderr': null,
                'settings': path.join(os.homedir(), '.claude', 'forge.json'),
            },
            vscode.workspace.getConfiguration('forge').get('cliArgs'),
            // The Options of this launch: a configured flag is reported as a
            // duplicate only when the SDK also derives it from one of them.
            options,
        );
        this.logService.info(`🚩 CLI 直通参数 (extraArgs):`);
        for (const line of describeBuild(cliArgs)) {
            this.logService.info(line);
        }
        for (const d of cliArgs.rejected) {
            this.logService.warn(`forge.cliArgs: --${d.flag} was not applied (${d.reason})`);
        }

        options.extraArgs = cliArgs.extraArgs;

        // 调用 SDK
        this.logService.info('');
        this.logService.info('🚀 准备调用 Claude Agent SDK');
        this.logService.info('----------------------------------------');

        // 设置入口点环境变量
        process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-vscode';
        this.logService.info(`🔧 环境变量:`);
        this.logService.info(`  - CLAUDE_CODE_ENTRYPOINT: ${process.env.CLAUDE_CODE_ENTRYPOINT}`);
        const customEnvVars = await this.configService.getEnvironmentVariables();
        for (const [key, value] of Object.entries(customEnvVars)) {
            this.logService.info(`  - ${key}: ${value}`);
        }

        this.logService.info('');
        this.logService.info('📦 导入 SDK...');

        try {
            // 调用 SDK query() 函数
            const { query } = await import('@anthropic-ai/claude-agent-sdk');

            this.logService.info(`  - Options: [已配置参数 ${Object.keys(options).join(', ')}]`);

            const result = query({ prompt: inputStream, options });
            return result;
        } catch (error) {
            this.logService.error('');
            this.logService.error('❌❌❌ SDK 调用失败 ❌❌❌');
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
            this.logService.info('🛑 中断 Claude SDK 查询');
            await query.interrupt();
            this.logService.info('✓ 查询已中断');
        } catch (error) {
            this.logService.error(`❌ 中断查询失败: ${error}`);
            throw error;
        }
    }

    /**
     * 获取合并后的环境变量 (process.env + custom)
     */
    private async getMergedEnvironmentVariables(endpointProfile?: string): Promise<Record<string, string>> {
        const customVars = await this.configService.getEnvironmentVariables();

        // 安全合并 process.env (过滤 undefined)
        // Base overrides applied before process.env.
        const env: Record<string, string> = {};
        Object.entries(process.env).forEach(([key, value]) => {
            if (value !== undefined) {
                env[key] = value;
            }
        });
        // The official host's defaults (MCP in the background, TodoWrite instead of Task tools).
        Object.assign(env, OFFICIAL_CLI_ENV_DEFAULTS);

        // Endpoint routing. When a profile is active this points the spawned CLI
        // at a loopback relay that owns the mTLS / proxy / transform path the
        // binary cannot do itself. With no profile it returns {} and the default
        // Anthropic endpoint is used untouched.
        const endpointEnv = await this.endpointService.getEnvironment(endpointProfile);
        if (Object.keys(endpointEnv).length > 0) {
            this.logService.info(`🔌 端点配置生效: ANTHROPIC_BASE_URL=${endpointEnv.ANTHROPIC_BASE_URL}`);
        }

        // User-defined variables win over everything, so an explicit override in
        // settings can always take precedence over a profile -- except the
        // entrypoint, which the official stamps last. Setting it here rather than
        // on process.env (below) is what makes the *first* launch report it too:
        // this env object is built before that assignment runs.
        return withOfficialEntrypoint({ ...env, ...endpointEnv, ...customVars });
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
        return allowsDangerouslySkipPermissions(vscode.workspace.getConfiguration('forge').get('cliArgs'));
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
