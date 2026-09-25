/**
 * ClaudeSessionService - 历史会话加载和管理
 *
 * 职责：
 * 1. 从 ~/.claude/projects/ 目录加载会话历史
 * 2. 解析 .jsonl 文件（每行一个 JSON 对象）
 * 3. 组织会话消息和生成摘要
 * 4. 支持会话列表查询和消息检索
 *
 * 依赖：
 * - ILogService: 日志服务
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createDecorator } from '../../di/instantiation';
import { ILogService } from '../logService';
import { sessionListOptions, toSessionList, type SessionListRow } from './sessionList';
import { plannedRename } from './sessionIdentity';
import type { ForkConversationPlan } from './forkConversation';

export const IClaudeSessionService = createDecorator<IClaudeSessionService>('claudeSessionService');

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 会话消息类型
 */
interface SessionMessage {
    uuid: string;
    sessionId: string;
    parentUuid?: string;
    timestamp: string;
    type: "user" | "assistant" | "attachment" | "system" | "summary";
    message?: any;
    isMeta?: boolean;
    isSidechain?: boolean;
    leafUuid?: string;
    summary?: string;
    toolUseResult?: any;
    gitBranch?: string;
    cwd?: string;

}

/**
 * 会话信息
 *
 * The official row (`buildSessionList`), which is the SDK's `SDKSessionInfo`
 * plus the archived flag and the worktree/workspace fields — see
 * `sessionList.ts` for the port.
 */
export type SessionInfo = SessionListRow;

/**
 * 会话服务接口
 */
export interface IClaudeSessionService {
    readonly _serviceBrand: undefined;

    /**
     * 列出指定工作目录的所有会话
     */
    listSessions(cwd: string, archivedIds?: ReadonlySet<string>): Promise<SessionInfo[]>;

    /**
     * 获取指定会话的所有消息
     */
    getSession(sessionIdOrPath: string, cwd: string): Promise<any[]>;

    /**
     * Append a `custom-title` line to a session's transcript (step 20).
     * Resolves to `true` when the rename was skipped, as the official's
     * `rename_session_response.skipped` does.
     */
    renameSession(sessionId: string, title: string, cwd: string): Promise<boolean>;

    /**
     * Copy a conversation's transcript into a new session, optionally stopping
     * at a message (step 25). Resolves to the new session's id; throws the way
     * the official's store throws when the source or the message is unknown.
     */
    forkSession(plan: ForkConversationPlan, cwd: string): Promise<string>;
}

// ============================================================================
// 路径管理函数
// ============================================================================

/**
 * 获取 Claude 配置目录
 */
function getConfigDir(): string {
    return process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
}

/**
 * 获取项目历史目录
 */
function getProjectsDir(): string {
    return path.join(getConfigDir(), "projects");
}

/**
 * 获取特定项目的历史目录
 */
export function getProjectHistoryDir(cwd: string): string {
    return path.join(getProjectsDir(), cwd.replace(/[^a-zA-Z0-9]/g, "-"));
}

/**
 * Whether the CLI can resume `sessionId`: a transcript for it exists, in this
 * project's history directory or any other project's (the CLI finds a session
 * by id wherever it was recorded).
 *
 * A conversation that never carried a message has an id -- the CLI names it
 * in its first `system/init` -- but no transcript, and `--resume` of that id
 * fails with "No conversation found with session ID". Forge relaunches idle
 * channels when the endpoint changes (picking another model in a fresh
 * conversation does it), so this is checked before every resume. The id is
 * validated before it touches the filesystem (B3): anything but a UUID is
 * "nothing to resume".
 */
export async function sessionTranscriptExists(
    sessionId: string,
    cwd: string,
    exists: (file: string) => Promise<boolean> = (file) => fs.access(file).then(() => true, () => false),
    list: (dir: string) => Promise<string[]> = (dir) => fs.readdir(dir),
): Promise<boolean> {
    const id = validateSessionId(sessionId);
    if (!id) return false;
    if (await exists(path.join(getProjectHistoryDir(cwd), `${id}.jsonl`))) return true;
    let projects: string[];
    try {
        projects = await list(getProjectsDir());
    } catch {
        return false;
    }
    for (const project of projects) {
        if (await exists(path.join(getProjectsDir(), project, `${id}.jsonl`))) return true;
    }
    return false;
}

/**
 * UUID 正则表达式
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 验证 UUID
 */
function validateSessionId(id: string): string | null {
    return typeof id !== "string" ? null : UUID_REGEX.test(id) ? id : null;
}

/**
 * 读取 JSONL 文件
 */
async function readJSONL(filePath: string): Promise<SessionMessage[]> {
    try {
        const content = await fs.readFile(filePath, "utf8");
        if (!content.trim()) {
            return [];
        }

        return content
            .split("\n")
            .filter(line => line.trim())
            .map(line => {
                try {
                    return JSON.parse(line);
                } catch {
                    return null;
                }
            })
            .filter(obj => obj !== null) as SessionMessage[];
    } catch {
        return [];
    }
}

/**
 * 转换消息格式（用于返回给前端）
 */
export function convertMessage(msg: SessionMessage): any | undefined {
    if (msg.isMeta) {
        return undefined;
    }

    // `msg.uuid` is the **transcript row's** uuid and `msg.sessionId` is the
    // session's. Both rows used to put the row uuid into `session_id` and the
    // assistant row overwrote `uuid` with the API message id -- so a conversation
    // loaded from disk arrived with no message uuids at all, and `rewind_code` /
    // `fork_conversation` had nothing to key off (step 24).
    //
    // `Message.fromRaw` already derives `betaMessageId` from `message.id`
    // itself, so the API id does not need carrying separately.
    if (msg.type === "user") {
        return {
            type: "user",
            message: msg.message,
            uuid: msg.uuid,
            session_id: msg.sessionId,
            parent_tool_use_id: null,
            toolUseResult: msg.toolUseResult
        };
    }

    if (msg.type === "assistant") {
        return {
            type: "assistant",
            message: msg.message,
            uuid: msg.uuid,
            session_id: msg.sessionId,
            parent_tool_use_id: null
        };
    }

    if (msg.type === "system" || msg.type === "attachment") {
        return undefined;
    }

    return undefined;
}

// ============================================================================
// ClaudeSessionService 实现
// ============================================================================

/**
 * 会话数据容器
 */
interface SessionData {
    sessionMessages: Map<string, Set<string>>;
    messages: Map<string, SessionMessage>;
    summaries: Map<string, string>;
}

/**
 * 加载项目的会话历史
 */
async function loadProjectData(cwd: string): Promise<SessionData> {
    const projectDir = getProjectHistoryDir(cwd);

    let files: string[];
    try {
        files = await fs.readdir(projectDir);
    } catch {
        return {
            sessionMessages: new Map(),
            messages: new Map(),
            summaries: new Map()
        };
    }

    const fileStats = await Promise.all(
        files.map(async file => {
            const filePath = path.join(projectDir, file);
            const stat = await fs.stat(filePath);
            return { name: filePath, stat };
        })
    );

    const jsonlFiles = fileStats
        .filter(file => file.stat.isFile() && file.name.endsWith(".jsonl"))
        .sort((a, b) => a.stat.mtime.getTime() - b.stat.mtime.getTime());

    const loadedData = await Promise.all(
        jsonlFiles.map(async file => {
            const sessionId = validateSessionId(path.basename(file.name, ".jsonl"));

            if (!sessionId) {
                return {
                    sessionId,
                    sessionMessages: new Map<string, SessionMessage>(),
                    summaries: new Map<string, string>()
                };
            }

            const messages = new Map<string, SessionMessage>();
            const summaries = new Map<string, string>();

            try {
                for (const msg of await readJSONL(file.name)) {
                    if (
                        msg.type === "user" ||
                        msg.type === "assistant" ||
                        msg.type === "attachment" ||
                        msg.type === "system"
                    ) {
                        messages.set(msg.uuid, msg);
                    } else if (msg.type === "summary" && msg.leafUuid) {
                        summaries.set(msg.leafUuid, msg.summary!);
                    }
                }
            } catch {
            }

            return { sessionId, sessionMessages: messages, summaries };
        })
    );

    const sessionMessages = new Map<string, Set<string>>();
    const allMessages = new Map<string, SessionMessage>();
    const allSummaries = new Map<string, string>();

    for (const { sessionId, sessionMessages: messages, summaries } of loadedData) {
        if (!sessionId) continue;

        sessionMessages.set(sessionId, new Set(messages.keys()));

        for (const [uuid, msg] of messages.entries()) {
            allMessages.set(uuid, msg);
        }

        for (const [uuid, summary] of summaries.entries()) {
            allSummaries.set(uuid, summary);
        }
    }

    return {
        sessionMessages,
        messages: allMessages,
        summaries: allSummaries
    };
}

/**
 * 重建完整的对话链
 */
function getTranscript(message: SessionMessage, data: SessionData): SessionMessage[] {
    const result: SessionMessage[] = [];
    let current: SessionMessage | undefined = message;

    while (current) {
        result.unshift(current);
        current = current.parentUuid ? data.messages.get(current.parentUuid) : undefined;
    }

    return result;
}


// ============================================================================
// ClaudeSessionService 实现
// ============================================================================

/**
 * Claude 会话服务实现
 */
export class ClaudeSessionService implements IClaudeSessionService {
    readonly _serviceBrand: undefined;

    constructor(
        @ILogService private readonly logService: ILogService
    ) {
        this.logService.info('[ClaudeSessionService] Initialized');
    }

    /**
     * 列出指定工作目录的所有会话
     *
     * The official host reads the list through the SDK (`Lb$` is the bundled
     * SDK's `listSessions`) and maps `SDKSessionInfo` onto the rows, so Forge
     * calls the same API rather than re-deriving `customTitle`, `gitBranch`,
     * `fileSize`, `tag` and `createdAt` from the transcript itself. The SDK
     * already prefers the latest `custom-title` line for `summary` and drops
     * sidechain sessions (`Nu` returns null for `"isSidechain":true`).
     */
    async listSessions(cwd: string, archivedIds: ReadonlySet<string> = new Set()): Promise<SessionInfo[]> {
        try {
            this.logService.info(`[ClaudeSessionService] Listing sessions: ${cwd}`);

            const { listSessions } = await import('@anthropic-ai/claude-agent-sdk');
            const infos = await listSessions(sessionListOptions(cwd));
            const sessions = toSessionList(infos, cwd, archivedIds);

            this.logService.info(`[ClaudeSessionService] Found ${sessions.length} session(s)`);
            return sessions;
        } catch (error) {
            // Thrown on, not swallowed into `[]`: an empty list is what "no
            // history" looks like (the SDK answers a missing directory with
            // none), so a failure has to stay distinguishable from it. The
            // handler turns this into an answer that carries the error.
            this.logService.error(`[ClaudeSessionService] Could not list sessions:`, error);
            throw error;
        }
    }

    /**
     * Append one `custom-title` line to the session's transcript (step 20).
     *
     * The official host validates the types, caps the title with `GX`, and
     * hands both to its store; the store answers `skipped` rather than
     * throwing when the id is unusable or the transcript cannot be found. The
     * SDK's `renameSession` (sdk.d.ts:3029) performs the same append, so a
     * failure here is reported the same way: `skipped`.
     */
    async renameSession(sessionId: string, title: string, cwd: string): Promise<boolean> {
        const planned = plannedRename(sessionId, title);
        if (!planned) {
            this.logService.warn(`[ClaudeSessionService] rename_session skipped: bad id or empty title`);
            return true;
        }

        try {
            const { renameSession } = await import('@anthropic-ai/claude-agent-sdk');
            await renameSession(planned.sessionId, planned.title, { dir: cwd });
            this.logService.info(`[ClaudeSessionService] Session renamed: ${planned.sessionId}`);
            return false;
        } catch (error) {
            // The transcript moved, is empty, or lives in another project dir.
            this.logService.warn(`[ClaudeSessionService] rename_session skipped: ${error}`);
            return true;
        }
    }

    /**
     * Fork a conversation (step 25), through the SDK rather than through a port
     * of the official's own store — the user's decision, consistent with the
     * lister and the rename.
     *
     * `forkSession(sessionId, {dir?, upToMessageId?, title?})` (sdk.d.ts:770)
     * answers `{sessionId}`; the official's response field is the bare string,
     * so it is unwrapped here. `dir` is the workspace, the same value
     * `sessionListOptions(cwd)` passes the lister, so a fork is looked up in the
     * project the window is open on rather than in every project directory.
     *
     * Errors are **not** swallowed: the official's store throws for an unknown
     * session or an unknown message, the handler lets that reach the transport,
     * and the webview shows "Failed to fork conversation: …". Rename can answer
     * `skipped` because the official's rename can; fork cannot.
     */
    async forkSession(plan: ForkConversationPlan, cwd: string): Promise<string> {
        const { forkSession } = await import('@anthropic-ai/claude-agent-sdk');
        const result = await forkSession(plan.forkedFromSession, {
            dir: cwd,
            ...(plan.upToMessageId !== undefined && { upToMessageId: plan.upToMessageId }),
            ...(plan.title !== undefined && { title: plan.title }),
        });
        this.logService.info(
            `[ClaudeSessionService] Session forked: ${plan.forkedFromSession} -> ${result.sessionId}` +
            (plan.upToMessageId ? ` (up to ${plan.upToMessageId})` : ' (whole conversation)')
        );
        return result.sessionId;
    }

    /**
     * 获取指定会话的所有消息
     */
    async getSession(sessionIdOrPath: string, cwd: string): Promise<any[]> {
        try {
            this.logService.info(`[ClaudeSessionService] Reading session: ${sessionIdOrPath}`);

            if (sessionIdOrPath.endsWith(".jsonl")) {
                const messages: any[] = [];
                for (const msg of await readJSONL(sessionIdOrPath)) {
                    messages.push(msg);
                }
                return messages;
            }

            const data = await loadProjectData(cwd);

            const messageUuids = data.sessionMessages.get(sessionIdOrPath);
            if (!messageUuids) {
                return [];
            }

            const sessionMessageList = Array.from(data.messages.values())
                .filter(msg => messageUuids.has(msg.uuid))
                .sort((a, b) =>
                    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
                );

            const latestMessage = sessionMessageList[0];
            if (!latestMessage) {
                return [];
            }

            const result = getTranscript(latestMessage, data)
                .map(convertMessage)
                .filter(msg => !!msg);

            this.logService.info(`[ClaudeSessionService] Read ${result.length} message(s)`);
            return result;
        } catch (error) {
            this.logService.error(`[ClaudeSessionService] Could not read the session:`, error);
            return [];
        }
    }

}
