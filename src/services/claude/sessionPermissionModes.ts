/**
 * Each conversation's permission mode, kept across reloads (step 18).
 *
 * Ported from the official host (`extension.js`), where the settings store
 * `C1$` keeps one `globalState` entry per session:
 *
 *   var Il$=200, El$=2592000000, Bm0=86400000;
 *   function Cl$($){ ... typeof $.updatedAt==="number" && Number.isFinite(..)
 *                        && $.updatedAt<=Date.now()+Bm0 && pH($.mode) }
 *   var E1$="sessionPermissionMode:"; function xF($){ return E1$+$ }
 *   getSessionPermissionModes / gatedSessionMode / setSessionPermissionMode /
 *   clearSessionPermissionMode / moveSessionPermissionMode / pruneSessionPermissionModes
 *
 * and the request handler:
 *
 *   async persistSessionPermissionMode($,Q,X,J){ let Y=y0($); if(!Y) return {...};
 *     let z = X ? y0(X) : null,
 *         K = Q==="bypassPermissions" && !(J===!0 && z!==null && z!==Y) && !this.bypassPersistGateOpen();
 *     if (K && !(z && z!==Y)) return {...};
 *     if (z && z!==Y) { if (J) return await this.settings.moveSessionPermissionMode(z,Y,
 *                                           {bypassBarredByHost:!this.bypassPersistGateOpen()}), {...};
 *                       if (await this.settings.clearSessionPermissionMode(z), K) return {...};
 *                       pH(Q) ? set(Y,Q) : clear(Y); return {...} }
 *     pH(Q) ? set(Y,Q) : clear(Y); return {...} }
 *
 * Plan and "Don't ask" are never stored (a session reopened after planning
 * starts in the initial mode). Kept free of `vscode` so the specs can import it.
 */
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import { isPermissionMode } from './permissionMode';

/** `E1$`: the `globalState` key prefix, followed by the session id. */
export const SESSION_MODE_KEY_PREFIX = 'sessionPermissionMode:';

/** `Il$`: how many sessions keep a mode; the oldest go first. */
export const MAX_STORED_SESSION_MODES = 200;

/** `El$`: a stored mode is forgotten after 30 days. */
export const SESSION_MODE_MAX_AGE_MS = 2_592_000_000;

/** `Bm0`: how far in the future a timestamp may be before the entry is junk. */
export const SESSION_MODE_CLOCK_SKEW_MS = 86_400_000;

/**
 * `zo$` / `pH`: the modes a session keeps. The official list also has `auto`;
 * Forge keeps Auto out of its UI (user decision, step 17), so it is neither
 * stored nor restored here, and a request for it clears the entry as plan does.
 */
export const STORED_SESSION_MODES = ['default', 'acceptEdits', 'bypassPermissions'] as const;
export type StoredSessionMode = (typeof STORED_SESSION_MODES)[number];

export function isStoredSessionMode(mode: unknown): mode is StoredSessionMode {
    return typeof mode === 'string' && (STORED_SESSION_MODES as readonly string[]).includes(mode);
}

/** `SD0`: a CLI session id. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `y0`: the id when it is one, else null. Nothing else becomes a storage key. */
export function validSessionId(id: unknown): string | null {
    if (typeof id !== 'string') return null;
    return SESSION_ID.test(id) ? id : null;
}

export const sessionModeKey = (sessionId: string): string => SESSION_MODE_KEY_PREFIX + sessionId;

export interface SessionModeEntry {
    mode: StoredSessionMode;
    updatedAt: number;
}

/** `Cl$`: a well-formed entry, not stamped more than a day ahead. */
export function isSessionModeEntry(value: unknown, now: number = Date.now()): value is SessionModeEntry {
    if (typeof value !== 'object' || value === null) return false;
    const updatedAt = (value as { updatedAt?: unknown }).updatedAt;
    return (
        typeof updatedAt === 'number' &&
        Number.isFinite(updatedAt) &&
        updatedAt <= now + SESSION_MODE_CLOCK_SKEW_MS &&
        isStoredSessionMode((value as { mode?: unknown }).mode)
    );
}

/** VS Code's `Memento` (globalState), as far as the store goes. */
export interface SessionModeMemento {
    get(key: string): unknown;
    update(key: string, value: unknown): PromiseLike<void>;
    keys(): readonly string[];
}

/** The part of the official `C1$` that keeps session modes. */
export class SessionPermissionModeStore {
    constructor(
        private readonly memento: SessionModeMemento,
        /** The official `getAllowDangerouslySkipPermissions()`. */
        private readonly allowBypass: () => boolean,
        private readonly now: () => number = Date.now
    ) {}

    /** `getSessionPermissionModes`: every live entry, by session id. */
    getSessionPermissionModes(): Record<string, StoredSessionMode> {
        const modes: Record<string, StoredSessionMode> = {};
        const allowBypass = this.allowBypass();
        for (const key of this.sessionPermissionModeKeys()) {
            const mode = this.gatedSessionMode(this.memento.get(key), allowBypass);
            if (mode !== undefined) modes[key.slice(SESSION_MODE_KEY_PREFIX.length)] = mode;
        }
        return modes;
    }

    /** `gatedSessionMode`: the entry's mode unless it is junk, stale, or a bypass that is not allowed. */
    gatedSessionMode(entry: unknown, allowBypass: boolean): StoredSessionMode | undefined {
        if (!isSessionModeEntry(entry, this.now())) return undefined;
        if (entry.updatedAt < this.now() - SESSION_MODE_MAX_AGE_MS) return undefined;
        if (entry.mode === 'bypassPermissions' && !allowBypass) return undefined;
        return entry.mode;
    }

    async setSessionPermissionMode(sessionId: string, mode: StoredSessionMode): Promise<void> {
        await this.memento.update(sessionModeKey(sessionId), { mode, updatedAt: this.now() });
        await this.pruneSessionPermissionModes(sessionId);
    }

    async clearSessionPermissionMode(sessionId: string): Promise<void> {
        await this.memento.update(sessionModeKey(sessionId), undefined);
    }

    /**
     * `moveSessionPermissionMode`: the CLI gave the conversation a new id, so its
     * mode moves with it. The re-reads are the official's: if the old entry
     * changed while the new one was being written, the newer value wins and the
     * old key is only dropped when it still holds what was moved.
     */
    async moveSessionPermissionMode(
        fromId: string,
        toId: string,
        options: { bypassBarredByHost: boolean }
    ): Promise<void> {
        const carried = (entry: unknown): StoredSessionMode | undefined => {
            const mode = this.gatedSessionMode(entry, this.allowBypass());
            return mode === 'bypassPermissions' && options.bypassBarredByHost ? undefined : mode;
        };
        const fromKey = sessionModeKey(fromId);
        const original = this.memento.get(fromKey);
        if (original === undefined) {
            await this.memento.update(fromKey, undefined);
            return;
        }
        const mode = carried(original);
        if (mode === undefined) {
            await this.memento.update(fromKey, undefined);
            return;
        }
        const toKey = sessionModeKey(toId);
        const moved: SessionModeEntry = { mode, updatedAt: this.now() };
        await this.memento.update(toKey, moved);

        const current = this.memento.get(fromKey);
        if (current === original) {
            await this.memento.update(fromKey, undefined);
            return;
        }
        if (current === undefined) {
            if (this.memento.get(toKey) === moved) await this.memento.update(toKey, undefined);
            return;
        }
        if (this.memento.get(toKey) !== moved) return;
        const newer = carried(current);
        await this.memento.update(toKey, newer === undefined ? undefined : { mode: newer, updatedAt: this.now() });
        if (this.memento.get(fromKey) === current) await this.memento.update(fromKey, undefined);
    }

    private sessionPermissionModeKeys(): string[] {
        return this.memento.keys().filter((key) => key.startsWith(SESSION_MODE_KEY_PREFIX));
    }

    /** `pruneSessionPermissionModes`: drop junk and stale entries, then all but the newest 200 (never `keepId`). */
    async pruneSessionPermissionModes(keepId: string): Promise<void> {
        const cutoff = this.now() - SESSION_MODE_MAX_AGE_MS;
        const live: Array<[string, number]> = [];
        for (const key of this.sessionPermissionModeKeys()) {
            const entry = this.memento.get(key);
            if (!isSessionModeEntry(entry, this.now()) || entry.updatedAt < cutoff) {
                await this.memento.update(key, undefined);
                continue;
            }
            live.push([key, entry.updatedAt]);
        }
        if (live.length > MAX_STORED_SESSION_MODES) {
            live.sort((a, b) => b[1] - a[1]);
            const keepKey = sessionModeKey(keepId);
            for (const [key] of live.slice(MAX_STORED_SESSION_MODES)) {
                if (key !== keepKey) await this.memento.update(key, undefined);
            }
        }
    }
}

/**
 * The official `bypassPersistGateOpen()`: bypass may be stored only when it is
 * allowed and the CLI's settings (read at least once) don't disable it.
 */
export function bypassPersistGateOpen(
    allowBypass: boolean,
    claudeSettings: { effective: { permissions?: { disableBypassPermissionsMode?: string } } } | undefined
): boolean {
    if (!allowBypass) return false;
    if (claudeSettings === undefined) return false;
    return claudeSettings.effective.permissions?.disableBypassPermissionsMode !== 'disable';
}

export type PersistSessionModeOutcome = 'stored' | 'cleared' | 'moved' | 'ignored';

/**
 * The official `persistSessionPermissionMode(sessionId, mode, previousSessionId,
 * carriedFromStore)`. The answer is always the bare response; the outcome is
 * returned for the log and the specs.
 *
 * Forge is stricter than the official in two places, because the webview is
 * untrusted input (B3): a `mode` that is not a permission mode at all is
 * ignored rather than clearing the entry, and `carriedFromStore` must be
 * exactly `true` (the official takes any truthy value for the move).
 */
export async function persistSessionPermissionMode(
    store: SessionPermissionModeStore,
    request: { sessionId: unknown; mode: unknown; previousSessionId?: unknown; carriedFromStore?: unknown },
    gateOpen: () => boolean
): Promise<PersistSessionModeOutcome> {
    const sessionId = validSessionId(request.sessionId);
    if (!sessionId) return 'ignored';
    const { mode } = request;
    if (!isPermissionMode(mode)) return 'ignored';
    const carriedFromStore = request.carriedFromStore === true;
    const previous = request.previousSessionId ? validSessionId(request.previousSessionId) : null;
    const moving = previous !== null && previous !== sessionId;

    const bypassRefused = mode === 'bypassPermissions' && !(carriedFromStore && moving) && !gateOpen();
    if (bypassRefused && !moving) return 'ignored';

    if (moving) {
        if (carriedFromStore) {
            await store.moveSessionPermissionMode(previous, sessionId, { bypassBarredByHost: !gateOpen() });
            return 'moved';
        }
        await store.clearSessionPermissionMode(previous);
        if (bypassRefused) return 'cleared';
    }
    return storeOrClear(store, sessionId, mode);
}

async function storeOrClear(
    store: SessionPermissionModeStore,
    sessionId: string,
    mode: PermissionMode
): Promise<PersistSessionModeOutcome> {
    if (isStoredSessionMode(mode)) {
        await store.setSessionPermissionMode(sessionId, mode);
        return 'stored';
    }
    await store.clearSessionPermissionMode(sessionId);
    return 'cleared';
}

/**
 * `list_sessions` attaches each session's stored mode as `permissionMode`,
 * except bypass while the CLI's settings disable it (the official loop over
 * `getSessionPermissionModes()`).
 */
export function attachSessionPermissionModes<T extends { id: string }>(
    sessions: T[],
    modes: Record<string, StoredSessionMode>,
    bypassDisabledBySettings: boolean
): Array<T & { permissionMode?: StoredSessionMode }> {
    return sessions.map((session) => {
        const mode = Object.hasOwn(modes, session.id) ? modes[session.id] : undefined;
        if (!mode || (mode === 'bypassPermissions' && bypassDisabledBySettings)) return session;
        return { ...session, permissionMode: mode };
    });
}

/**
 * The official `getInitialPermissionMode()`: the setting ("manual" is an alias
 * for "default"), else the last default the user picked, and bypass only while
 * it is allowed.
 *
 * Forge's setting is Settings > General > "Default Permission Mode"
 * (`defaultPermissionMode` in ~/.forge.json). Forge always has a value for it
 * (the extension config merges its defaults), so the official's second layer --
 * the last mode picked, kept by `persistDefaultPermissionMode` -- is never
 * reached, exactly as in the official when its setting is set. That layer is
 * therefore not ported. Auto is kept out of Forge, so it is not an initial mode.
 */
export function initialPermissionModeFrom(setting: unknown, allowBypass: boolean): PermissionMode | undefined {
    const mode = setting === 'manual' ? 'default' : setting;
    if (!isPermissionMode(mode) || mode === 'auto') return undefined;
    if (mode === 'bypassPermissions' && !allowBypass) return 'default';
    return mode;
}
