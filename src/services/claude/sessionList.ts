/**
 * The session list row, built from the SDK the way the official host builds it.
 *
 * The official `buildSessionList` calls the bundled SDK's `listSessions` and
 * maps its `SDKSessionInfo`s straight onto the rows it sends the webview
 * (`extension.js`):
 *
 *   async buildSessionList(){
 *     let $={dir:this.cwd,includeWorktrees:!1,includeProgrammatic:this.includeProgrammaticSessions},
 *         Q=x2(), X=Q===void 0?await Lb$($):await ok$($,void 0,Q),   // Lb$ = SDK listSessions
 *         ...
 *     let z=new Set(this.settings.getArchivedSessionIds()),
 *         W=X.map((U)=>{ let V=J.get(U.sessionId); return {
 *            id:U.sessionId, archived:z.has(U.sessionId), lastModified:U.lastModified,
 *            fileSize:U.fileSize, summary:U.summary, customTitle:U.customTitle,
 *            gitBranch:U.gitBranch, worktree:l$$(U.cwd),
 *            isCurrentWorkspace:BI0(U.cwd,this.cwd), ...V } });
 *     ... U.permissionMode=V ... return W }
 *
 *   var Sg=/[/\\]\.claude[/\\]worktrees[/\\]([^/\\]+)$/;
 *   function l$$($){ if(!$) return; let Q=Sg.exec($); if(!Q?.[1]) return; return {name:Q[1],path:$} }
 *   function BI0($,Q){ let X=l$$(Q); if(!X) return !0; if(!$) return !0;
 *                      return l$$($)?.name===X.name }
 *
 * `includeProgrammaticSessions` is `!0` on the official comms class, so the
 * options are `{dir, includeWorktrees:false, includeProgrammatic:true}`.
 *
 * The teleport metadata (`...V`) is the official's cross-window session
 * hand-off; Forge has one window, so there is nothing to merge in.
 *
 * Kept free of `vscode` and of the SDK import so the specs can drive it with
 * plain objects.
 */
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';

/** The `SDKSessionInfo` fields this maps (sdk.d.ts:5455). */
export interface SdkSessionInfoLike {
    sessionId: string;
    summary: string;
    lastModified: number;
    fileSize?: number;
    customTitle?: string;
    firstPrompt?: string;
    gitBranch?: string;
    cwd?: string;
    tag?: string;
    createdAt?: number;
}

/** One row of `list_sessions_response.sessions`, in the official's field order. */
export interface SessionListRow {
    id: string;
    archived: boolean;
    lastModified: number;
    fileSize?: number;
    summary: string;
    customTitle?: string;
    firstPrompt?: string;
    gitBranch?: string;
    cwd?: string;
    tag?: string;
    createdAt?: number;
    worktree?: { name: string; path: string };
    isCurrentWorkspace: boolean;
    permissionMode?: PermissionMode;
}

/** `Sg`: a worktree checkout under `<root>/.claude/worktrees/<name>`. */
const WORKTREE_PATH = /[/\\]\.claude[/\\]worktrees[/\\]([^/\\]+)$/;

/** `l$$`: the worktree a path is in, or undefined when it is the main checkout. */
export function worktreeOf(dir: string | undefined): { name: string; path: string } | undefined {
    if (!dir) return undefined;
    const match = WORKTREE_PATH.exec(dir);
    if (!match?.[1]) return undefined;
    return { name: match[1], path: dir };
}

/**
 * `BI0`: whether a session belongs to the window that is asking. A host outside
 * a worktree claims every session; inside one, only sessions from the same
 * worktree (and sessions with no recorded cwd) are its own.
 */
export function isCurrentWorkspace(sessionCwd: string | undefined, hostCwd: string | undefined): boolean {
    const hostWorktree = worktreeOf(hostCwd);
    if (!hostWorktree) return true;
    if (!sessionCwd) return true;
    return worktreeOf(sessionCwd)?.name === hostWorktree.name;
}

/** The options the official passes to `listSessions` (`ListSessionsOptions`). */
export function sessionListOptions(cwd: string): {
    dir: string;
    includeWorktrees: boolean;
    includeProgrammatic: boolean;
} {
    return { dir: cwd, includeWorktrees: false, includeProgrammatic: true };
}

/** One `SDKSessionInfo` as a list row. */
export function toSessionListRow(
    info: SdkSessionInfoLike,
    hostCwd: string,
    archivedIds: ReadonlySet<string>
): SessionListRow {
    return {
        id: info.sessionId,
        archived: archivedIds.has(info.sessionId),
        lastModified: info.lastModified,
        fileSize: info.fileSize,
        summary: info.summary,
        customTitle: info.customTitle,
        firstPrompt: info.firstPrompt,
        gitBranch: info.gitBranch,
        cwd: info.cwd,
        tag: info.tag,
        createdAt: info.createdAt,
        worktree: worktreeOf(info.cwd),
        isCurrentWorkspace: isCurrentWorkspace(info.cwd, hostCwd),
    };
}

/** The whole list, in the order the SDK returned it (the official does not re-sort). */
export function toSessionList(
    infos: readonly SdkSessionInfoLike[],
    hostCwd: string,
    archivedIds: ReadonlySet<string> = new Set()
): SessionListRow[] {
    return infos.map((info) => toSessionListRow(info, hostCwd, archivedIds));
}
