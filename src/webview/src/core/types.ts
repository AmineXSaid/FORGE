import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';

export interface SessionSummary {
  id: string;
  lastModified: number;
  summary: string;
  worktree?: { name: string; path: string };
  messageCount: number;
  isCurrentWorkspace: boolean;
  /** The mode the host keeps for this session (step 18). */
  permissionMode?: PermissionMode;
}
