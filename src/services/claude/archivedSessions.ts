/**
 * Archived conversations, kept across reloads (step 21).
 *
 * Ported from the official settings store (`extension.js`), which keeps two
 * `globalState` entries:
 *
 *   getArchivedSessionIds(){ return this.context.globalState.get("hiddenSessionIds")??[] }
 *   async archiveSession($){ await this.archiveSessions([$]) }
 *   async archiveSessions($){ let Q=this.getArchivedSessionIds(), X=new Set(Q),
 *                             J=$.filter((Y)=>!X.has(Y));
 *                             if(J.length>0) await this.context.globalState
 *                               .update("hiddenSessionIds",[...Q,...new Set(J)]) }
 *   async unarchiveSession($){ let Q=Date.now(), X=Zf$(this.getSessionUnarchiveTimes(),Q);
 *                              await this.context.globalState
 *                                .update("sessionUnarchivedAt",{...X,[$]:Q});
 *                              let J=this.getArchivedSessionIds();
 *                              if(J.includes($)) await this.context.globalState
 *                                .update("hiddenSessionIds",J.filter((Y)=>Y!==$)) }
 *   getSessionUnarchiveTimes(){ let $=this.context.globalState.get("sessionUnarchivedAt");
 *                               if(!$||typeof $!=="object"||Array.isArray($)) return {};
 *                               let Q={}; for(let[X,J]of Object.entries($))
 *                                 if(typeof J==="number"&&Number.isFinite(J)) Q[X]=J;
 *                               return Q }
 *
 *   var uA0=14, Hf$=86400000;
 *   function Zf$($,Q){ let X=Q-uA0*Hf$, J={};
 *                      for(let[Y,z]of Object.entries($))
 *                        if(typeof z==="number"&&Number.isFinite(z)&&z>X) J[Y]=z;
 *                      return J }
 *
 * and the two request handlers:
 *
 *   async archiveSession($){ if(y0($)===null) return {type:"archive_session_response"};
 *                            return await this.settings.archiveSession($),
 *                                   {type:"archive_session_response"} }
 *   async unarchiveSession($){ if(y0($)===null) return {type:"unarchive_session_response"};
 *                              await this.settings.unarchiveSession($);
 *                              let Q=[$], X=await this.teleportOriginOf($);
 *                              if(X) Q.push(`${UG}${X}`);
 *                              let J=this.settings.getSessionGroups(), Y=tY(J,Q);
 *                              if(Y) await this.settings.setSessionGroups(Y);
 *                              return {type:"unarchive_session_response"} }
 *
 * `sessionUnarchivedAt` is what stops auto-archive from re-archiving something
 * the user just pulled back out. Auto-archive itself is **not** in scope
 * (`CLAUDE.md` does not list it), but the timestamp is written anyway, because
 * it is the official's own record of the action and costs nothing.
 *
 * Not ported, with the reason:
 * - the session-groups pruning in `unarchiveSession` (`tY(getSessionGroups(), …)`):
 *   session groups are not in scope, so there is no group to prune from;
 * - `teleportOriginOf` and the `remote:` key it pushes: Forge has no cross-window
 *   teleport.
 *
 * Kept free of `vscode` so the specs can drive it with a Map.
 */

/** The `Memento` surface this store needs (the same shape step 18 uses). */
export interface ArchivedSessionsMemento {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

/** The official `globalState` keys. */
export const ARCHIVED_SESSION_IDS_KEY = 'hiddenSessionIds';
export const SESSION_UNARCHIVED_AT_KEY = 'sessionUnarchivedAt';

/** `uA0` × `Hf$`: an unarchive timestamp is forgotten after 14 days. */
export const UNARCHIVE_TIME_MAX_AGE_MS = 14 * 86_400_000;

/** `Zf$`: drop junk and anything older than the window. */
export function pruneUnarchiveTimes(
    times: Record<string, unknown>,
    now: number
): Record<string, number> {
    const cutoff = now - UNARCHIVE_TIME_MAX_AGE_MS;
    const kept: Record<string, number> = {};
    for (const [id, at] of Object.entries(times)) {
        if (typeof at === 'number' && Number.isFinite(at) && at > cutoff) kept[id] = at;
    }
    return kept;
}

export class ArchivedSessionStore {
    constructor(
        private readonly memento: ArchivedSessionsMemento,
        private readonly now: () => number = () => Date.now()
    ) {}

    /** `getArchivedSessionIds()`: the stored array, ignoring anything that is not one. */
    getArchivedSessionIds(): string[] {
        const stored = this.memento.get<unknown>(ARCHIVED_SESSION_IDS_KEY);
        if (!Array.isArray(stored)) return [];
        return stored.filter((id): id is string => typeof id === 'string');
    }

    /** The set the list rows are flagged against. */
    getArchivedSessionIdSet(): Set<string> {
        return new Set(this.getArchivedSessionIds());
    }

    /** `archiveSessions($)`: append the ids that are not already there, deduped. */
    async archiveSessions(ids: readonly string[]): Promise<void> {
        const current = this.getArchivedSessionIds();
        const known = new Set(current);
        const added = ids.filter((id) => !known.has(id));
        if (added.length === 0) return;
        await this.memento.update(ARCHIVED_SESSION_IDS_KEY, [...current, ...new Set(added)]);
    }

    /** `archiveSession($)`. */
    async archiveSession(id: string): Promise<void> {
        await this.archiveSessions([id]);
    }

    /** `getSessionUnarchiveTimes()`: the stored map, keeping only finite numbers. */
    getSessionUnarchiveTimes(): Record<string, number> {
        const stored = this.memento.get<unknown>(SESSION_UNARCHIVED_AT_KEY);
        if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
        const kept: Record<string, number> = {};
        for (const [id, at] of Object.entries(stored as Record<string, unknown>)) {
            if (typeof at === 'number' && Number.isFinite(at)) kept[id] = at;
        }
        return kept;
    }

    /**
     * `unarchiveSession($)`: stamp the time (pruning the old ones first), then
     * drop the id from the archived list. The stamp is written even when the id
     * was not archived, exactly as the official does.
     */
    async unarchiveSession(id: string): Promise<void> {
        const now = this.now();
        const times = pruneUnarchiveTimes(this.getSessionUnarchiveTimes(), now);
        await this.memento.update(SESSION_UNARCHIVED_AT_KEY, { ...times, [id]: now });
        const archived = this.getArchivedSessionIds();
        if (archived.includes(id)) {
            await this.memento.update(
                ARCHIVED_SESSION_IDS_KEY,
                archived.filter((other) => other !== id)
            );
        }
    }
}
