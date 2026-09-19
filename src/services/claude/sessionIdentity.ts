/**
 * Session ids and titles: the checks that run before anything touches a
 * transcript on disk (B3), ported from the official host (`extension.js`).
 *
 * The official rename path is:
 *
 *   var ls$=200; function GX($){ return Ix($,ls$) }
 *   function Ix($,Q){ if($.length<=Q) return $;
 *                     let X=[]; for(let J of $){ if(X.length>=Q) break; X.push(J) }
 *                     return X.join("") }
 *
 *   function bg($){ return typeof $==="string" && !$.includes("/") && !$.includes("\\")
 *                          && !$.includes("..") && !$.includes("\x00") }
 *   var ds$=/^(?:CON|PRN|AUX|NUL|COM[0-9\u00b9\u00b2\u00b3]|LPT[0-9\u00b9\u00b2\u00b3]) *(?:\.|$)/i;
 *   function sY($){ return bg($) && !/[:<>"|?*\u0000-\u001f]/.test($)
 *                          && !ds$.test($) && !/[. ]$/.test($) }
 *
 *   async renameSession($,Q,X){ if(typeof $!=="string"||typeof Q!=="string")
 *                                 return {type:"rename_session_response",skipped:!0};
 *                               let J=GX(Q), z=await store.renameSession($,J,X===!0); ... }
 *   // and inside the store: if(!sY($)) return !0  // skipped
 *
 * `GX` is *only* a code-point cap -- it does not trim and does not strip
 * newlines (the step file says it does; the bundle says otherwise, and the
 * results file records the correction). The trim happens one layer down, in
 * the SDK's `renameSession`:
 *
 *   async function WZ(e,t,n={},r){ if(!Qe(e)) throw Error(`Invalid sessionId: ${e}`);
 *                                  if(!t.trim()) throw Error("title must be non-empty");
 *                                  let o=JSON.stringify({type:"custom-title",
 *                                        customTitle:t.trim(),sessionId:e})+"\n";
 *                                  await YZ(e,o,n,...) }            // sdk.mjs 0.3.274
 *
 * so a title that is only whitespace is rejected, and what lands on disk is
 * the trimmed, capped string. `Qe` is the SDK's UUID check, which is why this
 * module requires the id to pass **both** `sY` (filesystem safety, the
 * official's guard) and the UUID form (the SDK's guard) before a request is
 * allowed anywhere near the transcript.
 *
 * Kept free of `vscode` and of `fs` so the specs can import it directly.
 */

/** `ls$`: the title cap, counted in code points rather than UTF-16 units. */
export const SESSION_TITLE_MAX_CODE_POINTS = 200;

/** `SD0`: a CLI session id, and the SDK's `Qe`. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `ds$`: the Windows device names a file may not be called. */
const DOS_DEVICE_NAME =
    /^(?:CON|PRN|AUX|NUL|COM[0-9\u00b9\u00b2\u00b3]|LPT[0-9\u00b9\u00b2\u00b3]) *(?:\.|$)/i;

/** The characters Windows refuses in a file name, plus the C0 controls. */
// eslint-disable-next-line no-control-regex
const UNSAFE_NAME_CHARS = /[:<>"|?*\u0000-\u001f]/;

/** `bg`: no separator, no parent hop, no NUL -- nothing that escapes a directory. */
export function isPathSafeSegment(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        !value.includes('/') &&
        !value.includes('\\') &&
        !value.includes('..') &&
        !value.includes('\u0000')
    );
}

/**
 * `sY`: `bg`, plus the characters Windows refuses, plus the device names, plus
 * no trailing dot or space. This is the official store's own gate on a session
 * id before it is joined into a transcript path.
 */
export function isFilesystemSafeSessionId(value: unknown): value is string {
    return (
        isPathSafeSegment(value) &&
        !UNSAFE_NAME_CHARS.test(value) &&
        !DOS_DEVICE_NAME.test(value) &&
        !/[. ]$/.test(value)
    );
}

/**
 * The id a rename, archive or unarchive is allowed to name: filesystem-safe
 * (the official `sY`) **and** a CLI session id (the SDK's `Qe`). Returns the id
 * so callers pass the validated value on rather than the raw request field.
 */
export function renameableSessionId(value: unknown): string | null {
    if (!isFilesystemSafeSessionId(value)) return null;
    return SESSION_ID.test(value) ? value : null;
}

/**
 * `Ix($, ls$)`: cut to at most `SESSION_TITLE_MAX_CODE_POINTS` code points, so
 * an emoji or an astral character is never split in half. No trim, no newline
 * stripping -- the official does neither here.
 */
export function capSessionTitle(title: string, max = SESSION_TITLE_MAX_CODE_POINTS): string {
    if (title.length <= max) return title;
    const out: string[] = [];
    for (const ch of title) {
        if (out.length >= max) break;
        out.push(ch);
    }
    return out.join('');
}

/** What the host writes: the official `GX`, then the SDK's own trim. */
export function sessionTitleForDisk(title: string): string {
    return capSessionTitle(title).trim();
}

/**
 * The whole gate for `rename_session`. `null` means "skipped" -- the official
 * answers `{type:"rename_session_response",skipped:true}` for a non-string id
 * or title, for an id the store refuses, and for a transcript it cannot find;
 * it never returns an error to the webview.
 */
export function plannedRename(
    sessionId: unknown,
    title: unknown
): { sessionId: string; title: string } | null {
    if (typeof sessionId !== 'string' || typeof title !== 'string') return null;
    const id = renameableSessionId(sessionId);
    if (!id) return null;
    const capped = sessionTitleForDisk(title);
    if (!capped) return null;
    return { sessionId: id, title: capped };
}
