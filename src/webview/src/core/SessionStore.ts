import { signal, computed, effect } from 'alien-signals';
import { EventEmitter } from '../utils/events';
import type { ConnectionManager } from './ConnectionManager';
import { Session, type SessionContext, type SessionOptions } from './Session';
import type { PermissionRequest } from './PermissionRequest';
import type { SessionSummary } from './types';
import type { BaseTransport } from '../transport/BaseTransport';
import { bypassGateDecidablyOpen, restorableSessionMode } from './modePersist';
import { sessionKey } from './sessionStates';
import {
  DEFAULT_SECTION_COLLAPSE_STATE,
  applyPanelSectionToggle,
  normalizeSessionGroups,
  readCollapsedPanelSections,
  readSectionCollapseState,
  sectionCollapsePatch,
  withoutSessions,
  type PanelSection,
  type SessionGroup,
  type SessionSectionCollapseState,
} from '../../../shared/sessionGroups';

/**
 * How long the list waits for the host before giving up.
 *
 * The host always answers, but a list that waits on a reply that is not coming
 * -- a host that crashed, a message loop that stopped -- used to read
 * "Loading conversations…" forever. Bounded, so it turns into an error with a
 * retry instead, and so the in-flight read is released for that retry.
 */
export const LIST_SESSIONS_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface PermissionEvent {
  session: Session;
  permissionRequest: PermissionRequest;
}

export class SessionStore {
  readonly sessions = signal<Session[]>([]);
  readonly activeSession = signal<Session | undefined>(undefined);
  readonly permissionRequested = new EventEmitter<PermissionEvent>();

  readonly sessionsByLastModified = computed(() =>
    [...this.sessions()].sort((a, b) => b.lastModifiedTime() - a.lastModifiedTime())
  );

  readonly connectionState = computed(() => this.connectionManager.state());

  /**
   * The two feeds the status dot reads, straight off the connection
   * (`session_states_update`). `undefined` means the host has not answered yet,
   * and the list draws no dot at all until it does. Step 22.
   */
  readonly openSessionIds = computed(() => this.connectionManager.connection()?.openSessionIds());
  readonly unreadSessionKeys = computed(() =>
    this.connectionManager.connection()?.unreadSessionKeys()
  );

  /**
   * Session groups and the list's section collapse state, as the official
   * store keeps them (production audit, Phase 6):
   *
   *   sessionGroups=t1([]); sessionGroupsLoaded=t1(!1); sessionSectionCollapseState=t1(zF);
   *   sessionSectionWritesInFlight=0; sessionSectionWriteSeq=0; sessionSectionReadSkipped=!1;
   *   groupWritesInFlight=0; lastGroupWriteAt=0;
   *   collapsedPanelSections=t1([]); sectionWritesInFlight=0; sectionWriteSeq=0; sectionReadSkipped=!1;
   *
   * The counters keep a read that raced a write from putting stale state back.
   */
  readonly sessionGroups = signal<SessionGroup[]>([]);
  readonly sessionGroupsLoaded = signal(false);
  readonly sessionSectionCollapseState = signal<SessionSectionCollapseState>({ ...DEFAULT_SECTION_COLLAPSE_STATE });
  readonly collapsedPanelSections = signal<PanelSection[]>([]);
  private sessionSectionWritesInFlight = 0;
  private sessionSectionWriteSeq = 0;
  private sessionSectionReadSkipped = false;
  private groupWritesInFlight = 0;
  private lastGroupWriteAt = 0;
  private sectionWritesInFlight = 0;
  private sectionWriteSeq = 0;
  private sectionReadSkipped = false;

  private currentConnectionPromise?: Promise<void>;
  /** Rows a listing created, so a later listing may drop them when their file goes. */
  private readonly listedRows = new WeakSet<Session>();
  private effectCleanups: Array<() => void> = [];

  /** The official `lastLocalRenameAt` / `renamesInFlight` / `renameBaseline` (step 20). */
  private readonly lastLocalRenameAt = new Map<string, number>();
  private readonly renamesInFlight = new Map<string, number>();
  private readonly renameBaseline = new Map<
    string,
    { summary: string | undefined; hasPersistedTitle: boolean }
  >();
  private readonly renameSubscriptions = new Map<BaseTransport, () => void>();
  /** The official `lastArchiveChangeAt` / `archiveWritesInFlight` (step 21). */
  private readonly lastArchiveChangeAt = new Map<string, number>();
  private readonly archiveWritesInFlight = new Map<string, number>();

  /**
   * The official `previousBusyState` / `hasUnseenCompletion` /
   * `pendingUnreadMirror` (step 22).
   *
   * `hasUnseenCompletion` is a signal in the official because its window badge
   * renders it; Forge has no badge and nothing else reads it, so it is a plain
   * field -- reading and writing a signal inside the effect that depends on it
   * would re-enter. Behaviour is unchanged.
   */
  private previousBusyState = false;
  private hasUnseenCompletion = false;
  private pendingUnreadMirror?: Session;

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly context: SessionContext
  ) {
    this.effectCleanups.push(
      effect(() => {
        const connection = this.connectionManager.connection();
        if (!connection) return;
        // The official wiring:
        //   G.sessionRenamedEvents.add(({sessionId:E,title:I})=>q.adoptPersistedTitle(E,I))
        if (!this.renameSubscriptions.has(connection)) {
          this.renameSubscriptions.set(
            connection,
            connection.sessionRenamedEvents.add(({ sessionId, title }) =>
              this.adoptPersistedTitle(sessionId, title)
            )
          );
        }
        void this.listSessions().catch((error) =>
          console.warn('[SessionStore] listing sessions failed', error)
        );
        // `this.listSessions("connection"),this.listSessionGroups(),this.listCollapsedPanelSections()`.
        queueMicrotask(() => {
          void this.listSessionGroups();
          void this.listCollapsedPanelSections();
        });
      })
    );

    /**
     * The official store sync:
     *
     *   a5(()=>{ let z=this.activeConnection.value, q=z?.sessionStoreChanges.value??0;
     *            if(!z||q===0) return; wZ(()=>{ this.listSessionsAfterInFlight("store_sync") }) })
     *
     * `session_store_changed` bumps the counter; the list is read again outside
     * the effect (the official's `wZ` is an untracked scope), so the effect
     * depends on the counter and nothing the read touches.
     */
    this.effectCleanups.push(
      effect(() => {
        const connection = this.connectionManager.connection();
        const changes = connection?.sessionStoreChanges?.() ?? 0;
        if (!connection || changes === 0) return;
        queueMicrotask(() => {
          void this.listSessionsAfterInFlight().catch((error) =>
            console.warn('[SessionStore] store sync failed', error)
          );
        });
      })
    );

    /**
     * The official unread trigger, ported as-is (step 22):
     *
     *   a5(()=>{ let z=this.activeSession.value, q=this.comms.connection.value,
     *     U=q?.isVisible.value??!0,
     *     V=(z?.busy.value??!1)||(z?.backgroundTaskIds.value.size??0)>0;
     *     if(this.previousBusyState&&!V&&!U) this.hasUnseenCompletion.value=!0,
     *       this.pendingUnreadMirror=this.reportActiveSessionUnread(z,q,!0)==="feed_not_ready"?z??void 0:void 0;
     *     if(this.previousBusyState=V,U&&this.hasUnseenCompletion.value)
     *       this.hasUnseenCompletion.value=!1,this.pendingUnreadMirror=void 0,
     *       this.reportActiveSessionUnread(z,q,!1);
     *     if(this.pendingUnreadMirror!==void 0&&!U&&this.hasUnseenCompletion.value&&
     *        q?.unreadSessionKeys.value!==void 0){ let H=this.pendingUnreadMirror;
     *       this.pendingUnreadMirror=void 0,this.reportActiveSessionUnread(H,q,!0) } })
     *
     * So a turn that finishes while the webview is hidden marks the open
     * conversation unread, and showing the webview again marks it read. The
     * third branch retries the mark once the feed arrives.
     *
     * Forge has no `backgroundTaskIds`, so "busy" is the session's own flag.
     */
    this.effectCleanups.push(
      effect(() => {
        const session = this.activeSession();
        const connection = this.connectionManager.connection();
        const visible = connection?.isVisible() ?? true;
        const busy = session?.busy() ?? false;

        if (this.previousBusyState && !busy && !visible) {
          this.hasUnseenCompletion = true;
          this.pendingUnreadMirror =
            this.reportActiveSessionUnread(session, connection, true) === 'feed_not_ready'
              ? (session ?? undefined)
              : undefined;
        }
        this.previousBusyState = busy;
        if (visible && this.hasUnseenCompletion) {
          this.hasUnseenCompletion = false;
          this.pendingUnreadMirror = undefined;
          this.reportActiveSessionUnread(session, connection, false);
        }
        if (
          this.pendingUnreadMirror !== undefined &&
          !visible &&
          this.hasUnseenCompletion &&
          connection?.unreadSessionKeys() !== undefined
        ) {
          const pending = this.pendingUnreadMirror;
          this.pendingUnreadMirror = undefined;
          this.reportActiveSessionUnread(pending, connection, true);
        }
      })
    );

    this.effectCleanups.push(
      effect(() => {
        const session = this.activeSession();
        const defaultTitle = 'Forge';

        if (!session) {
          this.context.renameTab?.(defaultTitle);
          return;
        }

        if (session.isOffline()) {
          // A failure is shown in the chat's error banner (`loadFailed`).
          session.loadFromServer().catch(() => {});
        } else {
          session.preloadConnection();
        }

        const url = new URL(window.location.toString());
        if (session.sessionId()) {
          url.searchParams.set('session', session.sessionId()!);
        } else {
          url.searchParams.delete('session');
        }
        window.history.replaceState({}, '', url.toString());

        const summary = session.summary();
        const title = summary && summary.length > 25 ? `${summary.slice(0, 24)}…` : summary;
        this.context.renameTab?.(title || defaultTitle);
      })
    );

    this.effectCleanups.push(
      effect(() => {
        const sessions = this.sessions();
        const seen = new Map<string, Session>();
        const deduped: Session[] = [];
        let changed = false;

        for (const session of sessions) {
          const id = session.sessionId();
          if (!id) {
            deduped.push(session);
            continue;
          }

          const duplicate = seen.get(id);
          if (duplicate && duplicate !== session) {
            this.mergeSessionMetadata(duplicate, session);
            if (this.activeSession() === session) {
              this.activeSession(duplicate);
            }
            changed = true;
            continue;
          }

          seen.set(id, session);
          deduped.push(session);
        }

        if (changed) {
          this.sessions([...deduped].sort((a, b) => b.lastModifiedTime() - a.lastModifiedTime()));
        }
      })
    );
  }

  onPermissionRequested(callback: (event: PermissionEvent) => void): () => void {
    return this.permissionRequested.add(callback);
  }

  async getConnection() {
    return this.connectionManager.get();
  }

  private pendingActive?: Promise<Session>;

  /**
   * The active session, created if there is none yet. Concurrent callers share
   * one creation, so the runtime's first session and a message sent before it
   * existed land in the same conversation.
   *
   * The composer is usable as soon as the chat draws, but the first session is
   * only created once the connection, the selection, the asset URIs and the
   * session list have loaded. A message sent in that second used to be
   * dropped with the composer already cleared (found by the end-to-end run,
   * 2026-09-24: the first message of a fresh install vanished).
   */
  async ensureActiveSession(): Promise<Session> {
    const active = this.activeSession();
    if (active) return active;
    this.pendingActive ??= this.createSession({ isExplicit: false }).finally(() => {
      this.pendingActive = undefined;
    });
    return this.pendingActive;
  }

  async createSession(options: SessionOptions = {}): Promise<Session> {
    const session = new Session(() => this.getConnection(), this.context, options);
    // The official `createSession`: a new conversation starts in the initial mode.
    // Set before the session goes active, because going active launches it.
    const connection = await this.getConnection();
    const initialPermissionMode = connection.config()?.initialPermissionMode;
    if (initialPermissionMode) session.permissionMode(initialPermissionMode);

    this.sessions([session, ...this.sessions()]);
    this.activeSession(session);

    this.attachPermissionListener(session);

    return session;
  }

  async listSessions(): Promise<void> {
    if (this.currentConnectionPromise) {
      return this.currentConnectionPromise;
    }

    this.currentConnectionPromise = (async () => {
      try {
        const connection = await this.getConnection();
        // The official stamps the refresh before it asks, so a rename or an
        // archive made *after* this point is not overwritten by a list that
        // was already on its way.
        const requestedAt = Date.now();
        const response = await withTimeout(
          connection.listSessions(),
          LIST_SESSIONS_TIMEOUT_MS,
          'Forge did not answer. The extension host may still be starting.'
        );
        // The host answers a store it could not read with an error beside an
        // empty list. Surfaced, so the list offers a retry -- and so a failed
        // read is never merged as "every conversation is gone" below.
        if (response?.error) throw new Error(response.error);

        const existing = new Map(
          this.sessions()
            .filter((session) => !!session.sessionId())
            .map((session) => [session.sessionId() as string, session])
        );

        for (const summary of response.sessions ?? []) {
          if (!summary.isCurrentWorkspace) {
            continue;
          }

          const existingSession = existing.get(summary.id);
          if (existingSession) {
            existingSession.lastModifiedTime(summary.lastModified);
            // The official merge:
            //   if(K.customTitle){ D.hasPersistedTitle.value=!0;
            //     let O=this.lastLocalRenameAt.get(K.id)??0;
            //     if(!this.renamesInFlight.has(K.id)&&O<Z&&D.summary.value!==K.customTitle)
            //       D.summary.value=K.customTitle }
            // A row without a customTitle leaves the title alone entirely.
            if (summary.customTitle) {
              existingSession.hasPersistedTitle(true);
              const renamedAt = this.lastLocalRenameAt.get(summary.id) ?? 0;
              if (
                !this.renamesInFlight.has(summary.id) &&
                renamedAt < requestedAt &&
                existingSession.summary() !== summary.customTitle
              ) {
                existingSession.summary(summary.customTitle);
              }
            }
            existingSession.worktree(summary.worktree);
            existingSession.gitBranch(summary.gitBranch);
            existingSession.fileSize(summary.fileSize);
            existingSession.tag(summary.tag);
            existingSession.firstPrompt(summary.firstPrompt);
            existingSession.createdAt(summary.createdAt);
            // The official merge:
            //   let N=this.lastArchiveChangeAt.get(K.id)??0;
            //   if(!this.archiveWritesInFlight.has(K.id)&&N<Z){ … D.archived.value=O }
            const archivedAt = this.lastArchiveChangeAt.get(summary.id) ?? 0;
            if (!this.archiveWritesInFlight.has(summary.id) && archivedAt < requestedAt) {
              existingSession.archived(summary.archived === true);
            }
            // The official refresh: follow the host's stored mode (step 18).
            existingSession.reconcilePersistedSessionMode(this.restorableSessionMode(summary, connection), {
              bypassGateDecidablyOpen: bypassGateDecidablyOpen(connection.config(), connection.claudeConfig()?.claudeSettings),
            });
            continue;
          }

          const session = Session.fromServer(
            summary as SessionSummary,
            () => this.getConnection(),
            this.context
          );
          this.listedRows.add(session);
          // The official restore: the mode the host kept for it, else the initial mode.
          const restored = this.restorableSessionMode(summary, connection);
          const initialPermissionMode = connection.config()?.initialPermissionMode;
          if (restored) session.adoptPersistedSessionMode(restored);
          else if (initialPermissionMode) session.permissionMode(initialPermissionMode);

          this.attachPermissionListener(session);
          this.sessions([...this.sessions(), session]);
        }

        // A conversation the store no longer lists was deleted: drop its row.
        // Only rows an earlier listing created, and only while nothing is using
        // them -- the open conversation stays whatever happened to its file,
        // one that is running or loaded is kept, and a conversation started in
        // this panel was never a listed row to begin with.
        const listed = new Set(
          (response.sessions ?? [])
            .filter((summary: SessionSummary) => summary.isCurrentWorkspace)
            .map((summary: SessionSummary) => summary.id)
        );
        const active = this.activeSession();
        const kept = this.sessions().filter((session) => {
          const id = session.sessionId();
          if (!id || listed.has(id) || !this.listedRows.has(session)) return true;
          return session === active || session.busy() || session.messages().length > 0;
        });

        this.sessions(kept.sort((a, b) => b.lastModifiedTime() - a.lastModifiedTime()));
      } finally {
        this.currentConnectionPromise = undefined;
      }
    })();

    await this.currentConnectionPromise;
  }

  /**
   * The official `listSessionsAfterInFlight`: a list already on its way was
   * asked for before the change being reported, so wait for it and ask again.
   */
  async listSessionsAfterInFlight(): Promise<void> {
    const inFlight = this.currentConnectionPromise;
    if (inFlight) {
      try {
        await inFlight;
      } catch {
        // The next read is the one that matters.
      }
    }
    return this.listSessions();
  }

  /**
   * The official `renameSession($,J)`: show the new title straight away, ask
   * the host to write it, and put the old one back if the write failed.
   *
   *   async renameSession($,J){ this.lastLocalRenameAt.set($,Date.now());
   *     let Z=this.sessions.value.find((Y)=>Y.sessionId.value===$);
   *     if(Z&&!this.renamesInFlight.has($))
   *       this.renameBaseline.set($,{summary:Z.summary.value,
   *                                  hasPersistedTitle:Z.hasPersistedTitle.value});
   *     if(Z) Z.summary.value=J, Z.hasPersistedTitle.value=!0;
   *     this.renamesInFlight.set($,(this.renamesInFlight.get($)??0)+1);
   *     try{ await(await this.getConnection()).renameSession($,J) }
   *     catch(Y){ let X=this.renameBaseline.get($);
   *               if(Z&&Z.summary.value===J&&X) Z.summary.value=X.summary,
   *                                             Z.hasPersistedTitle.value=X.hasPersistedTitle;
   *               throw Y }
   *     finally{ ... } this.lastLocalRenameAt.set($,Date.now()) }
   *
   * A host that answers `skipped` wrote nothing, so the optimistic title is
   * rolled back the same way a thrown request is.
   */
  async renameSession(sessionId: string, title: string): Promise<void> {
    this.lastLocalRenameAt.set(sessionId, Date.now());
    const session = this.sessions().find((s) => s.sessionId() === sessionId);
    if (session && !this.renamesInFlight.has(sessionId)) {
      this.renameBaseline.set(sessionId, {
        summary: session.summary(),
        hasPersistedTitle: session.hasPersistedTitle(),
      });
    }
    if (session) {
      session.summary(title);
      session.hasPersistedTitle(true);
    }
    this.renamesInFlight.set(sessionId, (this.renamesInFlight.get(sessionId) ?? 0) + 1);

    const rollback = () => {
      const baseline = this.renameBaseline.get(sessionId);
      if (session && session.summary() === title && baseline) {
        session.summary(baseline.summary);
        session.hasPersistedTitle(baseline.hasPersistedTitle);
      }
    };

    try {
      const connection = await this.getConnection();
      const response = await connection.renameSession(sessionId, title);
      if (response?.skipped) rollback();
    } catch (error) {
      rollback();
      throw error;
    } finally {
      const outstanding = this.renamesInFlight.get(sessionId) ?? 1;
      if (outstanding <= 1) {
        this.renamesInFlight.delete(sessionId);
        this.renameBaseline.delete(sessionId);
      } else {
        this.renamesInFlight.set(sessionId, outstanding - 1);
      }
    }
    this.lastLocalRenameAt.set(sessionId, Date.now());
  }

  /**
   * The official `adoptPersistedTitle($,J)`: a title the host pushed back
   * (`session_renamed`), taken on without sending anything.
   */
  adoptPersistedTitle(sessionId: string, title: string): void {
    const active = this.activeSession();
    const session =
      active?.sessionId() === sessionId
        ? active
        : this.sessions().find((s) => s.sessionId() === sessionId);
    if (!session || session.summary() === title) return;
    this.lastLocalRenameAt.set(sessionId, Date.now());
    session.summary(title);
    session.hasPersistedTitle(true);
  }

  /**
   * The official `archiveSession($)`: hide the conversation, and move off it if
   * it was the open one.
   *
   *   async archiveSession($){ let J=$.sessionId.value;
   *     if(!J){ this.sessions.value=this.sessions.value.filter((Z)=>Z!==$);
   *             this.replaceActiveSessionIfArchived($); return }
   *     if(await this.writeArchivedFlag($,J,!0,(Z)=>Z.archiveSession(J)), $.archived.value)
   *       this.replaceActiveSessionIfArchived($) }
   */
  async archiveSession(session: Session): Promise<void> {
    const id = session.sessionId();
    if (!id) {
      // Nothing on disk to hide: drop the row outright.
      this.sessions(this.sessions().filter((other) => other !== session));
      this.replaceActiveSessionIfArchived(session);
      return;
    }
    await this.writeArchivedFlag(session, id, true, (connection) => connection.archiveSession(id));
    if (session.archived()) this.replaceActiveSessionIfArchived(session);
  }

  /**
   * The official `unarchiveSession($)`: the row comes back ungrouped (the host
   * prunes it too), so the groups are pruned at once and read again after.
   *
   *   async unarchiveSession($){ let J=$.sessionId.value; if(!J) return;
   *     let Z=[J], …; let X=$T(this.sessionGroups.value,Z); if(X) this.sessionGroups.value=X;
   *     this.groupWritesInFlight+=1;
   *     try{ await this.writeArchivedFlag($,J,!1,(Q)=>Q.unarchiveSession(J)) }
   *     finally{ this.groupWritesInFlight-=1 }
   *     this.listSessionGroups() }
   */
  async unarchiveSession(session: Session): Promise<void> {
    const id = session.sessionId();
    if (!id) return;
    const pruned = withoutSessions(this.sessionGroups(), [id]);
    if (pruned) this.sessionGroups(pruned);
    this.groupWritesInFlight += 1;
    try {
      await this.writeArchivedFlag(session, id, false, (connection) => connection.unarchiveSession(id));
    } finally {
      this.groupWritesInFlight -= 1;
    }
    void this.listSessionGroups();
  }

  /**
   * The official `listSessionGroups($)`:
   *
   *   let J=await this.getConnection(), Z=Date.now(), Y=this.sessionSectionWriteSeq,
   *       X=await J.getSessionGroups();
   *   if(this.sessionSectionWritesInFlight>0) this.sessionSectionReadSkipped=!0;
   *   else if(Y!==this.sessionSectionWriteSeq) this.sessionSectionReadSkipped=!1, this.listSessionGroups();
   *   else this.sessionSectionReadSkipped=!1, this.sessionSectionCollapseState.value=w_1(X.sectionCollapseState);
   *   if(this.groupWritesInFlight>0) return;
   *   if(!$?.forceAdopt&&this.lastGroupWriteAt>=Z) return;
   *   this.sessionGroups.value=X.groups, this.sessionGroupsLoaded.value=!0
   */
  async listSessionGroups(options: { forceAdopt?: boolean } = {}): Promise<void> {
    try {
      const connection = await this.getConnection();
      const startedAt = Date.now();
      const seq = this.sessionSectionWriteSeq;
      const response = await connection.getSessionGroups();
      if (this.sessionSectionWritesInFlight > 0) this.sessionSectionReadSkipped = true;
      else if (seq !== this.sessionSectionWriteSeq) {
        this.sessionSectionReadSkipped = false;
        void this.listSessionGroups();
      } else {
        this.sessionSectionReadSkipped = false;
        this.sessionSectionCollapseState(readSectionCollapseState(response.sectionCollapseState));
      }
      if (this.groupWritesInFlight > 0) return;
      if (!options.forceAdopt && this.lastGroupWriteAt >= startedAt) return;
      this.sessionGroups(normalizeSessionGroups(response.groups));
      this.sessionGroupsLoaded(true);
    } catch (error) {
      console.error('Failed to load session groups:', error);
    }
  }

  /**
   * The official `updateSessionGroups($)`: normalise, show at once, write, and
   * read back only if the write failed.
   */
  async updateSessionGroups(groups: SessionGroup[]): Promise<void> {
    const next = normalizeSessionGroups(groups);
    this.lastGroupWriteAt = Date.now();
    this.sessionGroups(next);
    this.groupWritesInFlight += 1;
    let failed = false;
    try {
      await (await this.getConnection()).updateSessionGroups(next);
    } catch (error) {
      console.error('Failed to persist session groups:', error);
      failed = true;
    } finally {
      this.groupWritesInFlight -= 1;
    }
    if (failed) void this.listSessionGroups();
  }

  /** The official `updateSessionSectionCollapseState($)`: Ungrouped / Archived. */
  async updateSessionSectionCollapseState(patch: Partial<SessionSectionCollapseState>): Promise<void> {
    const clean = sectionCollapsePatch(patch);
    if (Object.keys(clean).length === 0) return;
    this.sessionSectionWriteSeq += 1;
    this.sessionSectionCollapseState({ ...this.sessionSectionCollapseState(), ...clean });
    this.sessionSectionWritesInFlight += 1;
    let failed = false;
    try {
      await (await this.getConnection()).updateSessionSectionCollapseState(clean);
    } catch (error) {
      console.error('Failed to persist section collapse state:', error);
      failed = true;
    } finally {
      this.sessionSectionWritesInFlight -= 1;
    }
    if (failed || this.sessionSectionReadSkipped) {
      this.sessionSectionReadSkipped = this.sessionSectionWritesInFlight > 0;
      if (!this.sessionSectionReadSkipped) void this.listSessionGroups();
    }
  }

  /** The official `listCollapsedPanelSections()`. */
  async listCollapsedPanelSections(): Promise<void> {
    try {
      const connection = await this.getConnection();
      const seq = this.sectionWriteSeq;
      const response = await connection.getCollapsedPanelSections();
      if (this.sectionWritesInFlight > 0) {
        this.sectionReadSkipped = true;
        return;
      }
      this.sectionReadSkipped = false;
      if (seq !== this.sectionWriteSeq) {
        void this.listCollapsedPanelSections();
        return;
      }
      this.collapsedPanelSections(readCollapsedPanelSections(response.sections));
    } catch (error) {
      console.error('Failed to load collapsed panel sections:', error);
    }
  }

  /** The official `setPanelSectionCollapsed($,J)`: show at once, then write. */
  async setPanelSectionCollapsed(section: PanelSection, collapsed: boolean): Promise<void> {
    const toggle = { section, collapsed };
    this.sectionWriteSeq += 1;
    this.collapsedPanelSections(applyPanelSectionToggle(this.collapsedPanelSections(), toggle));
    this.sectionWritesInFlight += 1;
    let failed = false;
    try {
      await (await this.getConnection()).updateCollapsedPanelSections(toggle);
    } catch (error) {
      console.error('Failed to persist collapsed panel sections:', error);
      failed = true;
    } finally {
      this.sectionWritesInFlight -= 1;
    }
    if (failed || this.sectionReadSkipped) {
      this.sectionReadSkipped = this.sectionWritesInFlight > 0;
      if (!this.sectionReadSkipped) void this.listCollapsedPanelSections();
    }
  }

  /** The official seed (`collapsedPanelSectionsSeed`): what the page was built with, before any read. */
  seedCollapsedPanelSections(sections: unknown): void {
    const seeded = readCollapsedPanelSections(sections);
    if (seeded.length > 0) this.collapsedPanelSections(seeded);
  }

  /**
   * The official `writeArchivedFlag($,J,Z,Y)`: flip the flag at once, stamp the
   * write, and put it back if the request failed.
   */
  private async writeArchivedFlag(
    session: Session,
    id: string,
    archived: boolean,
    write: (connection: BaseTransport) => Promise<unknown>
  ): Promise<void> {
    session.archived(archived);
    this.lastArchiveChangeAt.set(id, Date.now());
    this.archiveWritesInFlight.set(id, (this.archiveWritesInFlight.get(id) ?? 0) + 1);
    try {
      await write(await this.getConnection());
    } catch (error) {
      console.error(`Failed to ${archived ? 'archive' : 'unarchive'} session:`, error);
      session.archived(!archived);
    } finally {
      const outstanding = this.archiveWritesInFlight.get(id) ?? 1;
      if (outstanding <= 1) this.archiveWritesInFlight.delete(id);
      else this.archiveWritesInFlight.set(id, outstanding - 1);
    }
    this.lastArchiveChangeAt.set(id, Date.now());
    this.sessions([...this.sessions()]);
  }

  /**
   * The official `setSessionUnread($,J)`: hand the key to the host and let the
   * `session_states_update` push come back.
   *
   *   async setSessionUnread($,J){ try{ await(await this.getConnection())
   *     .setSessionUnread($,J) }catch(Z){ console.error(…) } }
   *
   * Nothing is flipped locally first: unlike a rename or an archive, the unread
   * set only ever lives on the host, so the feed is the single source of truth.
   */
  async setSessionUnread(key: string, unread: boolean): Promise<void> {
    try {
      await (await this.getConnection()).setSessionUnread(key, unread);
    } catch (error) {
      console.error('Failed to set session unread:', error);
    }
  }

  /**
   * The official `reportActiveSessionUnread($,J,Z)`:
   *
   *   if(!$?.sessionIdFromCli.value) return "not_applicable";
   *   let Y=c$($.sessionId.value,$.isRemote.value);
   *   if(!Y||!J) return "not_applicable";
   *   if(J.unreadSessionKeys.value===void 0) return "feed_not_ready";
   *   return J.setSessionUnread(Y,Z),"sent"
   *
   * The `feed_not_ready` answer is not a failure: the caller keeps the session
   * in `pendingUnreadMirror` and reports it again once the feed lands.
   */
  reportActiveSessionUnread(
    session: Session | undefined,
    connection: BaseTransport | undefined,
    unread: boolean
  ): 'not_applicable' | 'feed_not_ready' | 'sent' {
    if (!session?.sessionIdFromCli()) return 'not_applicable';
    const key = sessionKey(session.sessionId());
    if (!key || !connection) return 'not_applicable';
    if (connection.unreadSessionKeys() === undefined) return 'feed_not_ready';
    void this.setSessionUnread(key, unread);
    return 'sent';
  }

  /**
   * The official `replaceActiveSessionIfArchived($)`: if the archived session
   * was the open one, move to the first session that is neither it nor
   * archived (`v_1`), and start a new conversation when there is none.
   */
  private replaceActiveSessionIfArchived(session: Session): void {
    if (this.activeSession() !== session) return;
    const replacement = this.sessions().find(
      (other) => other !== session && !other.archived()
    );
    this.activeSession(replacement);
    if (!replacement) void this.createSession();
  }

  /** The official `restorableSessionMode`: the stored mode, bypass only while it is allowed. */
  private restorableSessionMode(summary: Pick<SessionSummary, 'permissionMode'>, connection: BaseTransport) {
    return restorableSessionMode(summary, connection.config(), connection.claudeConfig()?.claudeSettings);
  }

  setActiveSession(session: Session | undefined): void {
    this.activeSession(session);
  }

  /**
   * The official `activateSessionFromServer($,J,Z)` (step 25): open a
   * conversation by id, optionally with a draft for the composer.
   *
   *   let Y=()=>{let V=this.sessions.value.find((H)=>H.sessionId.value===$);
   *              if(!V)return!1; if(J)V.initialPrompt.value=J;
   *              if(this.activeSession.value=V,V.loadFailed.value)V.loadFromServer({retry:!0});
   *              return!0};
   *   if(Y())return!0;
   *   let X=await this.getConnection(), Q=await X.listSessions("activate");
   *   if(Z?.())return!0; if(Y())return!0;
   *   let G=Q.sessions.find((V)=>V.id===$); if(!G)return!1;
   *   …fromServer, restore the mode, attach the listener, set the prompt, activate…
   *
   * So: try what is already loaded, else re-list and try again, else give up.
   * A freshly forked session is never in the list yet, which is why the re-list
   * is not an optimisation but the normal path for a fork.
   *
   * A session whose load failed retries, as the official does; one that was
   * never loaded (`isOffline()`) loads.
   */
  async activateSessionFromServer(sessionId: string, initialPrompt?: string): Promise<boolean> {
    const activate = (): boolean => {
      const found = this.sessions().find((s) => s.sessionId() === sessionId);
      if (!found) return false;
      if (initialPrompt) found.initialPrompt(initialPrompt);
      this.activeSession(found);
      if (found.loadFailed()) found.loadFromServer({ retry: true }).catch(() => {});
      else if (found.isOffline()) found.loadFromServer().catch(() => {});
      return true;
    };
    if (activate()) return true;

    try {
      await this.listSessions();
    } catch (error) {
      console.warn('[SessionStore] listing sessions failed', error);
    }
    if (activate()) return true;

    // The list did not have it either. The official builds the session from the
    // listed row; Forge's `listSessions` already turns every row into a Session,
    // so there is nothing left to build -- the id is genuinely unknown.
    return false;
  }

  dispose(): void {
    // 清理所有 effects
    for (const cleanup of this.effectCleanups) {
      cleanup();
    }
    this.effectCleanups = [];

    for (const unsubscribe of this.renameSubscriptions.values()) unsubscribe();
    this.renameSubscriptions.clear();

    // 清理所有 sessions
    for (const session of this.sessions()) {
      session.dispose();
    }
  }

  private attachPermissionListener(session: Session): void {
    session.onPermissionRequested((request) => {
      this.permissionRequested.emit({
        session,
        permissionRequest: request
      });
      if (this.activeSession() !== session) {
        this.activeSession(session);
      }
    });
  }

  private mergeSessionMetadata(target: Session, source: Session): void {
    if (source.summary() && source.summary() !== target.summary()) {
      target.summary(source.summary());
    }

    if (source.lastModifiedTime() > target.lastModifiedTime()) {
      target.lastModifiedTime(source.lastModifiedTime());
    }

    if (!target.worktree() && source.worktree()) {
      target.worktree(source.worktree());
    }
  }
}
