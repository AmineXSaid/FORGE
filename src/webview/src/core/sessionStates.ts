/**
 * The sessions list's status dot, ported from the official webview (step 22).
 *
 * The official derives the dot in the **webview**, from the session's own
 * signals plus three feeds the host pushes in `session_states_update`. The host
 * does not compute it. `docs/backend-wiring/22-sessions-unread-status.md` said
 * the host "derives working and needs-input from live channels"; the bundle does
 * not, and the step file has been corrected.
 *
 * From `webview/index.js`:
 *
 *   var qF="remote:";
 *   function c$($,J){ if(!$) return; return J?`${qF}${$}`:$ }
 *
 *   function SF1($,J,Z,Y){ if(!Y) return !1;
 *     let X=c$($,J), Q=Z!==void 0&&Z!==null?c$(Z,!0):void 0;
 *     return X!==void 0&&Y.has(X)||Q!==void 0&&Y.has(Q) }
 *
 *   function lH0($,J,Z,Y,X){
 *     if(!$&&X===void 0) return Y?"unread":void 0;
 *     let Q=$?Z:X==="waiting", G=$?J:X==="running";
 *     if(Q) return "waiting";
 *     if(G) return "running";
 *     return Y?"unread":"idle" }
 *
 *   function dH0($,J){ if($==="unread") return "Unread";
 *     let Z=J===void 0?"Open in a tab":…;
 *     return $==="waiting"?`${Z} — awaiting input`
 *          : $==="running"?`${Z} — running` : Z }
 *
 * and the caller `a6`, which returns `undefined` -- no dot at all -- while every
 * feed is still undefined:
 *
 *   a6=H0((X1)=>{ if(!e0&&!c5&&!Z5) return;
 *     return lH0(A4(X1,e0),X1.busy.value,X1.pendingInput.value,A4(X1,c5),X9(X1)?.activity) })
 *
 * Forge has local sessions only and no second surface, so `isRemote`,
 * `teleportedFromSessionId` and the `liveElsewhere` activity are always absent.
 * They are still parameters here, because dropping them would change `lH0`'s
 * behaviour for the open/idle cases, and because a `remote:` key must round-trip
 * unchanged through the host store.
 */

/** The official `openState` values. `undefined` means "draw no dot". */
export type SessionOpenState = 'running' | 'waiting' | 'idle' | 'unread' | 'failed';

/** `qF`: the prefix that distinguishes a cloud session's key from a local id. */
export const REMOTE_KEY_PREFIX = 'remote:';

/**
 * `c$($,J)`: the key the unread store is addressed by. An empty id has no key,
 * which is why a conversation the CLI has not named yet is never marked unread.
 */
export function sessionKey(sessionId: string | undefined, isRemote = false): string | undefined {
    if (!sessionId) return undefined;
    return isRemote ? `${REMOTE_KEY_PREFIX}${sessionId}` : sessionId;
}

/**
 * `SF1($,J,Z,Y)`: is this session in that feed? A teleported session also
 * answers to the key of the session it came from, which is always remote.
 */
export function feedHasSession(
    sessionId: string | undefined,
    isRemote: boolean,
    teleportedFrom: string | undefined | null,
    feed: ReadonlySet<string> | undefined
): boolean {
    if (!feed) return false;
    const own = sessionKey(sessionId, isRemote);
    const origin =
        teleportedFrom !== undefined && teleportedFrom !== null
            ? sessionKey(teleportedFrom, true)
            : undefined;
    return (own !== undefined && feed.has(own)) || (origin !== undefined && feed.has(origin));
}

/**
 * `lH0($,J,Z,Y,X)`: the dot's state.
 *
 * A conversation this host is not running shows `unread` or nothing at all --
 * `busy` and `pendingInput` belong to a live channel and mean nothing once it
 * has closed. A conversation it is running reports `waiting` over `running`,
 * and only falls back to `unread` when it is neither.
 */
export function openStateFor(
    isOpen: boolean,
    busy: boolean,
    pendingInput: boolean,
    isUnread: boolean,
    elsewhereActivity?: 'waiting' | 'running'
): SessionOpenState | undefined {
    if (!isOpen && elsewhereActivity === undefined) return isUnread ? 'unread' : undefined;
    const waiting = isOpen ? pendingInput : elsewhereActivity === 'waiting';
    const running = isOpen ? busy : elsewhereActivity === 'running';
    if (waiting) return 'waiting';
    if (running) return 'running';
    return isUnread ? 'unread' : 'idle';
}

/**
 * `dH0($,J)`: the dot's tooltip. Forge never has an "elsewhere" kind, so the
 * base is always the official's own default, "Open in a tab".
 */
export function openStateTitle(
    state: SessionOpenState,
    elsewhereKind?: 'terminal' | 'vscode' | 'desktop' | string
): string {
    if (state === 'unread') return 'Unread';
    const base =
        elsewhereKind === undefined
            ? 'Open in a tab'
            : elsewhereKind === 'terminal'
              ? 'Open in a terminal'
              : elsewhereKind === 'vscode'
                ? 'Open in another VS Code window'
                : elsewhereKind === 'desktop'
                  ? 'Open in Claude Desktop'
                  : 'Open in another Claude process';
    if (state === 'waiting') return `${base} — awaiting input`;
    if (state === 'running') return `${base} — running`;
    return base;
}
