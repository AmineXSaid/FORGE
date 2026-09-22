/**
 * The rewind flow's two pure helpers, ported from the official webview
 * (step 24). Both are used by the `mo` confirm dialog and by the "/" Rewind
 * picker.
 */

/**
 * `p_1`: why a tracked file was left alone by a real rewind. Quoted verbatim.
 */
export const SKIPPED_LINKS_REASON =
    'the tracked path is (or became) a link or other non-regular file, its directory changed since the checkpoint, or its backup could not be safely read';

/**
 * `TR($)`: the meta message a finished rewind inserts.
 *
 *   function TR($){
 *     if(!$)return"Code rewind successful";
 *     return `Code rewind completed, but ${$} ${$===1?"file was":"files were"} skipped: ${p_1}`}
 *
 * `0` and `undefined` both take the first branch, which is why a dry run (whose
 * `skippedLinks` is never set) reads as a plain success.
 */
export function rewindResultMessage(skippedLinks: number | undefined): string {
    if (!skippedLinks) return 'Code rewind successful';
    return `Code rewind completed, but ${skippedLinks} ${skippedLinks === 1 ? 'file was' : 'files were'} skipped: ${SKIPPED_LINKS_REASON}`;
}

/**
 * `VU0($,J)`: a changed file's path as the dialog lists it — relative to the
 * session's cwd when it sits under it, otherwise untouched.
 *
 *   function VU0($,J){if(!J)return $;
 *     if($.startsWith(J)){let Z=$.slice(J.length);
 *       if(Z.startsWith("/")||Z.startsWith("\\"))Z=Z.slice(1);return Z}
 *     return $}
 *
 * Both separators, because the official runs on Windows too.
 */
export function relativeToCwd(path: string, cwd: string | undefined): string {
    if (!cwd) return path;
    if (path.startsWith(cwd)) {
        let rest = path.slice(cwd.length);
        if (rest.startsWith('/') || rest.startsWith('\\')) rest = rest.slice(1);
        return rest;
    }
    return path;
}

/**
 * The official `mo`'s enable rule for its primary button:
 *
 *   let W=z?.filesChanged&&z.filesChanged.length>0,
 *       B=z?.canRewind&&!Q&&(W||Z)
 *
 * So: the dry run said it can rewind, the dry run has finished, and either
 * there is something to restore **or** a fork will follow anyway. A "nothing
 * changed" rewind with no fork after it is a no-op, and the official refuses to
 * offer it.
 */
export function rewindConfirmEnabled(
    result: { canRewind?: boolean; filesChanged?: string[] } | null,
    loading: boolean,
    willForkAfter: boolean
): boolean {
    const hasChanges = !!result?.filesChanged && result.filesChanged.length > 0;
    return !!result?.canRewind && !loading && (hasChanges || willForkAfter);
}

/** A transcript row as the "Rewind to…" picker needs it (`yH0`'s `z`). */
export interface RewindTarget {
    /** The user message's uuid: what `rewind_code` and `fork_conversation` key off. */
    uuid: string;
    /** `b85($)`: the message's text blocks joined and trimmed. */
    promptText: string;
    /**
     * The uuid of the nearest earlier user-or-assistant message, i.e. where a
     * fork would resume from. `undefined` on the first message, which is what
     * makes the official start a brand new session instead of forking.
     */
    resumeAtMessageId: string | undefined;
    /** `message.timestamp`, for the relative time on the row. */
    timestamp: number;
}

/** The shape `rewindTargets` reads off a transcript row. */
export interface RewindCandidate {
    type: string;
    uuid?: string;
    isSynthetic?: boolean;
    parentToolUseId?: string;
    timestamp: number;
    text: string;
}

/**
 * `yH0`'s list, ported:
 *
 *   for(let P=0;P<Q.length;P++){let M=Q[P];
 *     if(M.type!=="user"||M.isSynthetic||!M.uuid||M.parentToolUseId)continue;
 *     let w=b85(M); if(!w)continue;
 *     let N; for(let O=P-1;O>=0;O--){let _=Q[O];
 *       if(_.uuid&&(_.type==="assistant"||_.type==="user")){N=_.uuid;break}}
 *     j.push({message:M,promptText:w,resumeAtMessageId:N})}
 *   return j.reverse()
 *
 * Newest first, and only real user prompts: not synthetic, not a subagent's
 * message, with a uuid and some text.
 */
export function rewindTargets(messages: readonly RewindCandidate[]): RewindTarget[] {
    const out: RewindTarget[] = [];
    for (let i = 0; i < messages.length; i++) {
        const message = messages[i]!;
        if (message.type !== 'user' || message.isSynthetic || !message.uuid || message.parentToolUseId) continue;
        const promptText = message.text.trim();
        if (!promptText) continue;
        let resumeAtMessageId: string | undefined;
        for (let j = i - 1; j >= 0; j--) {
            const earlier = messages[j]!;
            if (earlier.uuid && (earlier.type === 'assistant' || earlier.type === 'user')) {
                resumeAtMessageId = earlier.uuid;
                break;
            }
        }
        out.push({ uuid: message.uuid, promptText, resumeAtMessageId, timestamp: message.timestamp });
    }
    return out.reverse();
}

/**
 * `I85($)`: the picker's relative time.
 *
 *   let J=Math.floor((Date.now()-$)/1000);
 *   if(J<60)return"just now";
 *   let Z=Math.floor(J/60); if(Z<60)return `${Z}m ago`;
 *   let Y=Math.floor(Z/60); if(Y<24)return `${Y}h ago`;
 *   return `${Math.floor(Y/24)}d ago`
 */
export function relativeTime(timestamp: number, now: number = Date.now()): string {
    const seconds = Math.floor((now - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}
