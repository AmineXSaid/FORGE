/**
 * Unread conversations, kept across reloads (step 22).
 *
 * Ported from the official settings store and the window manager
 * (`extension.js`):
 *
 *   var TS=500;
 *   sessionGroupsKey(){ return `sessionGroups:${this.sessionListScopeRoot()}` }
 *   sessionListScopeRoot(){ let $=workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir();
 *                           return A7$(NK($)) }
 *   unreadSessionKeysKey(){ return this.sessionGroupsKey()
 *                                .replace(/^sessionGroups:/,"sessionUnread:") }
 *   getUnreadSessionKeys(){ let $=globalState.get(this.unreadSessionKeysKey());
 *                           if(!Array.isArray($)) return [];
 *                           let Q=bJ(), X=new Set;
 *                           for(let J of $){ let Y=Q.safeParse(J);
 *                             if(Y.success && !X.has(Y.data)) X.add(Y.data) }
 *                           return [...X].slice(-TS) }
 *   async setUnreadSessionKeys($){ await globalState
 *                                    .update(this.unreadSessionKeysKey(), $.slice(-TS)) }
 *
 *   setSessionUnread($,Q){ if(!bJ().safeParse($).success||Q!==!0&&Q!==!1) return !1;
 *                          …
 *                          if(this.unreadSessionKeys.has($)===Q){ … return !1 }
 *                          if(Q){ while(this.unreadSessionKeys.size>=TS){
 *                                   let z=this.unreadSessionKeys.values().next().value;
 *                                   if(z===void 0) break;
 *                                   this.unreadSessionKeys.delete(z) }
 *                                 this.unreadSessionKeys.add($) }
 *                          else this.unreadSessionKeys.delete($);
 *                          this.settings.setUnreadSessionKeys?.([...this.unreadSessionKeys])…
 *                          return this.broadcastSessionStates(), !0 }
 *
 *   var Sg=/[/\\]\.claude[/\\]worktrees[/\\]([^/\\]+)$/;
 *   function A7$($){ return $.replace(Sg,"") }
 *   var cs$=200; var bJ=w$(()=>g().min(1).max(cs$));   // a key: 1..200 chars
 *
 * The key is a **session key**, not a session id: the official's `c$($,J)`
 * prefixes remote sessions with `remote:`. Forge has local sessions only, so a
 * key is the id — but the store validates it as the official does (a bounded
 * string), not as a UUID, so a `remote:` key would round-trip unchanged.
 *
 * Not ported, with the reason:
 * - `pendingRestoreUnreadClear` / `pendingSidebarUnreadClear`: bookkeeping for a
 *   tab restore racing a sidebar view, both multi-surface;
 * - `refreshUnreadFromStore` re-reading before every write, and the "another
 *   window changed it" branch: one webview, one writer;
 * - `refreshTabIcon`: Forge has no per-session editor tabs.
 *
 * Kept free of `vscode` so the specs can drive it with a Map.
 */

/** The `Memento` surface this store needs. */
export interface UnreadSessionsMemento {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

/** `TS`: how many keys are kept; the oldest go first. */
export const MAX_UNREAD_SESSION_KEYS = 500;

/** `cs$`: the longest key the store accepts. */
export const MAX_SESSION_KEY_LENGTH = 200;

/** `Sg`: a worktree checkout, stripped from the scope root by `A7$`. */
const WORKTREE_SUFFIX = /[/\\]\.claude[/\\]worktrees[/\\][^/\\]+$/;

/** `A7$`: the scope root is the main checkout, so a worktree shares its list. */
export function sessionListScopeRoot(workspaceFolder: string): string {
    return workspaceFolder.replace(WORKTREE_SUFFIX, '');
}

/** `unreadSessionKeysKey()`. */
export function unreadSessionKeysKey(workspaceFolder: string): string {
    return `sessionUnread:${sessionListScopeRoot(workspaceFolder)}`;
}

/** `bJ()`: a key is a string of 1..200 characters. Nothing else is stored. */
export function isSessionKey(value: unknown): value is string {
    return typeof value === 'string' && value.length >= 1 && value.length <= MAX_SESSION_KEY_LENGTH;
}

export class UnreadSessionStore {
    constructor(
        private readonly memento: UnreadSessionsMemento,
        private readonly workspaceFolder: () => string
    ) {}

    private key(): string {
        return unreadSessionKeysKey(this.workspaceFolder());
    }

    /** `getUnreadSessionKeys()`: valid, deduped, newest 500, in insertion order. */
    getUnreadSessionKeys(): string[] {
        const stored = this.memento.get<unknown>(this.key());
        if (!Array.isArray(stored)) return [];
        const kept = new Set<string>();
        for (const value of stored) {
            if (isSessionKey(value)) kept.add(value);
        }
        return [...kept].slice(-MAX_UNREAD_SESSION_KEYS);
    }

    /**
     * `setSessionUnread($,Q)`: returns whether anything changed, so the caller
     * knows whether to broadcast. A bad key or a non-boolean is refused.
     */
    async setSessionUnread(sessionKey: unknown, unread: unknown): Promise<boolean> {
        if (!isSessionKey(sessionKey)) return false;
        if (unread !== true && unread !== false) return false;

        const keys = this.getUnreadSessionKeys();
        const known = new Set(keys);
        if (known.has(sessionKey) === unread) return false;

        let next: string[];
        if (unread) {
            // `while(size>=TS) delete the oldest`, then add.
            next = [...keys.slice(Math.max(0, keys.length - (MAX_UNREAD_SESSION_KEYS - 1))), sessionKey];
        } else {
            next = keys.filter((key) => key !== sessionKey);
        }
        await this.memento.update(this.key(), next.slice(-MAX_UNREAD_SESSION_KEYS));
        return true;
    }
}
