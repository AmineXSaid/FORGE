/**
 * `rewind_code`: what the host will accept from the webview, and what it hands
 * to the SDK (step 24).
 *
 * The official handler does no validation of its own — it destructures and
 * passes straight through:
 *
 *   case"rewind_code":{let{userMessageId:X,dryRun:J}=$.request;
 *     return this.withChannel($.channelId,async(Y)=>{
 *       let z=await Y.query.rewindFiles(X,{dryRun:J});
 *       if(z.error)throw Error(z.error);
 *       return{type:"rewind_code_response",canRewind:z.canRewind,
 *              filesChanged:z.filesChanged,insertions:z.insertions,
 *              deletions:z.deletions,skippedLinks:z.skippedLinks}})}
 *
 * B3 says the webview is untrusted input, so Forge checks the two fields before
 * they reach the CLI's control protocol. The check is deliberately the same
 * shape as the official's own id check (`y0` / `SD0`, ported in
 * `sessionPermissionModes.ts`): a message uuid is minted with
 * `crypto.randomUUID()` on both sides of the CLI, so it is a UUID or it is junk.
 *
 * `dryRun` is **optional, not a boolean**. The sender is
 * `{...,dryRun:Z?.dryRun}`, so `session.rewindCode(id)` puts the key on the
 * wire with the value `undefined` — that is the real run, and refusing it would
 * break the confirm path. Only a value that is neither a boolean nor
 * `undefined` is refused.
 */

/** `SD0`: the uuid shape the CLI mints for a message, same as a session id. */
const MESSAGE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The id when it is one, else null. Nothing else reaches `rewindFiles`. */
export function validMessageUuid(id: unknown): string | null {
    if (typeof id !== 'string') return null;
    return MESSAGE_UUID.test(id) ? id : null;
}

export interface RewindCodePlan {
    userMessageId: string;
    /** Passed on as `{dryRun}`; `undefined` is the official's real run. */
    dryRun: boolean | undefined;
}

/**
 * The request the host will act on, or `null` when it refuses. Refusing is
 * Forge's addition; the official would let a bad id reach the CLI, which
 * answers `canRewind:false`. Answering `canRewind:false` locally is the same
 * outcome without the round trip.
 */
export function planRewindCode(request: unknown): RewindCodePlan | null {
    if (typeof request !== 'object' || request === null) return null;
    const { userMessageId, dryRun } = request as { userMessageId?: unknown; dryRun?: unknown };
    const id = validMessageUuid(userMessageId);
    if (id === null) return null;
    if (dryRun !== undefined && typeof dryRun !== 'boolean') return null;
    return { userMessageId: id, dryRun: dryRun as boolean | undefined };
}

/**
 * The official's forwarding, as data: the five fields it copies off
 * `RewindFilesResult` (sdk.d.ts:3124), with `error` left out because the
 * official throws it instead.
 *
 * The SDK marks `filesChanged`, `insertions`, `deletions` and `skippedLinks`
 * optional, and `skippedLinks` is only ever populated by a real rewind, so a
 * key that is absent stays absent rather than becoming `undefined` on the wire.
 */
export interface RewindFilesResultLike {
    canRewind: boolean;
    error?: string;
    filesChanged?: string[];
    insertions?: number;
    deletions?: number;
    skippedLinks?: number;
}

export interface RewindCodeResponseFields {
    canRewind: boolean;
    filesChanged?: string[];
    insertions?: number;
    deletions?: number;
    skippedLinks?: number;
}

/** `{canRewind, filesChanged, insertions, deletions, skippedLinks}`, absent keys omitted. */
export function rewindResponseFields(result: RewindFilesResultLike): RewindCodeResponseFields {
    const fields: RewindCodeResponseFields = { canRewind: result.canRewind === true };
    if (result.filesChanged !== undefined) fields.filesChanged = result.filesChanged;
    if (result.insertions !== undefined) fields.insertions = result.insertions;
    if (result.deletions !== undefined) fields.deletions = result.deletions;
    if (result.skippedLinks !== undefined) fields.skippedLinks = result.skippedLinks;
    return fields;
}
