import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';

/**
 * One listed conversation, as `list_sessions_response` carries it.
 *
 * This mirrors the host's `SessionListEntry`, which is the SDK's
 * `SDKSessionInfo` (sdk.d.ts:5455) plus the host's `archived` flag and its
 * worktree / workspace derivation, exactly as the official `buildSessionList`
 * assembles it. The official `Session.fromServer` reads `id`, `lastModified`,
 * `summary`, `customTitle`, `worktree`, `gitBranch`, `fileSize` and `archived`
 * off the same object.
 */
export interface SessionSummary {
  id: string;
  lastModified: number;
  summary: string;
  /** The latest `custom-title` line, when the session has one (step 20). */
  customTitle?: string;
  /** In the host's archived set (step 21). */
  archived?: boolean;
  /** The branch at the end of the session; the search matches it (step 23). */
  gitBranch?: string;
  /** The first meaningful user prompt (`SDKSessionInfo.firstPrompt`). */
  firstPrompt?: string;
  /** The session's working directory (`SDKSessionInfo.cwd`). */
  cwd?: string;
  /** The user-set session tag (`SDKSessionInfo.tag`, set by `tagSession`). */
  tag?: string;
  /** Transcript size in bytes (`SDKSessionInfo.fileSize`). */
  fileSize?: number;
  /** When the session started (`SDKSessionInfo.createdAt`), ms since epoch. */
  createdAt?: number;
  worktree?: { name: string; path: string };
  isCurrentWorkspace: boolean;
  /** The mode the host keeps for this session (step 18). */
  permissionMode?: PermissionMode;
}
