/**
 * `fork_conversation`: what the host will accept from the webview, and what it
 * hands to the SDK (step 25).
 *
 * The official handler is one line and validates nothing of its own:
 *
 *   case"fork_conversation":
 *     return{type:"fork_conversation_response",
 *            sessionId:await(await U6.load(this.cwd,this.logger))
 *              .forkSession($.request.forkedFromSession,$.request.resumeSessionAt)}
 *
 * …because its store validates for it (`if(!sY($))throw Error("invalid session id")`,
 * then `Session ${'$'} not found`, then `Message ${'Q'} not found in session ${'$'}`).
 *
 * Forge forks through the **SDK** instead of porting that store — the user's
 * decision, and consistent with step 20, which already put the lister and the
 * rename on the SDK. The two signatures differ and that is the whole reason it
 * was a question:
 *
 *   official store : forkSession(sessionId, upToMessageId)              positional
 *   SDK 0.3.274    : forkSession(sessionId, {dir?, upToMessageId?, title?})  options
 *                    -> Promise<{sessionId}>                     (sdk.d.ts:770)
 *
 * So `resumeSessionAt` becomes `upToMessageId`, `dir` carries the workspace the
 * way `sessionListOptions(cwd)` does for the lister, and the result is unwrapped
 * to the bare `sessionId` string the official's response field holds.
 *
 * The id checks are Forge's (B3: the webview is untrusted). They are the same
 * `SD0` uuid shape the session-permission store uses, because the official's own
 * store gate (`sY`) is a session-id check too.
 */

/** `SD0` / `sY`: the uuid shape a session id and a message uuid share. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The official's `GX` cap on a title, reused for the SDK's `title` option. */
export const MAX_FORK_TITLE_LENGTH = 200;

export interface ForkConversationPlan {
    /** The source session. */
    forkedFromSession: string;
    /** The SDK's `upToMessageId`; absent means "copy the whole conversation". */
    upToMessageId?: string;
    /** The SDK's `title`; absent lets the SDK derive `<original> (fork)`. */
    title?: string;
}

/**
 * The request the host will act on, or `null` when it refuses. A refusal is
 * answered as an error rather than a shaped response, because the official's
 * store throws for exactly these cases and the webview's `.catch` shows
 * "Failed to fork conversation: …".
 */
export function planForkConversation(request: unknown): ForkConversationPlan | null {
    if (typeof request !== 'object' || request === null) return null;
    const { forkedFromSession, resumeSessionAt, title } = request as {
        forkedFromSession?: unknown;
        resumeSessionAt?: unknown;
        title?: unknown;
    };
    if (typeof forkedFromSession !== 'string' || !UUID.test(forkedFromSession)) return null;
    if (resumeSessionAt !== undefined && (typeof resumeSessionAt !== 'string' || !UUID.test(resumeSessionAt))) {
        return null;
    }
    if (title !== undefined && typeof title !== 'string') return null;

    const plan: ForkConversationPlan = { forkedFromSession };
    if (resumeSessionAt !== undefined) plan.upToMessageId = resumeSessionAt;
    if (title !== undefined) {
        const capped = [...title].slice(0, MAX_FORK_TITLE_LENGTH).join('').trim();
        // An empty or whitespace-only title is no title, so the SDK derives one.
        if (capped) plan.title = capped;
    }
    return plan;
}
