import { signal, computed, effect } from 'alien-signals';
import { EventEmitter } from '../utils/events';
import type { ConnectionManager } from './ConnectionManager';
import { Session, type SessionContext, type SessionOptions } from './Session';
import type { PermissionRequest } from './PermissionRequest';
import type { SessionSummary } from './types';
import type { BaseTransport } from '../transport/BaseTransport';
import { bypassGateDecidablyOpen, restorableSessionMode } from './modePersist';

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

  private currentConnectionPromise?: Promise<void>;
  private effectCleanups: Array<() => void> = [];

  /** The official `lastLocalRenameAt` / `renamesInFlight` / `renameBaseline` (step 20). */
  private readonly lastLocalRenameAt = new Map<string, number>();
  private readonly renamesInFlight = new Map<string, number>();
  private readonly renameBaseline = new Map<
    string,
    { summary: string | undefined; hasPersistedTitle: boolean }
  >();
  private readonly renameSubscriptions = new Map<BaseTransport, () => void>();

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
        void this.listSessions();
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
          session.loadFromServer();
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
        const response = await connection.listSessions();

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
            existingSession.archived(summary.archived === true);
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
          // The official restore: the mode the host kept for it, else the initial mode.
          const restored = this.restorableSessionMode(summary, connection);
          const initialPermissionMode = connection.config()?.initialPermissionMode;
          if (restored) session.adoptPersistedSessionMode(restored);
          else if (initialPermissionMode) session.permissionMode(initialPermissionMode);

          this.attachPermissionListener(session);
          this.sessions([...this.sessions(), session]);
        }

        this.sessions(
          [...this.sessions()].sort((a, b) => b.lastModifiedTime() - a.lastModifiedTime())
        );
      } finally {
        this.currentConnectionPromise = undefined;
      }
    })();

    await this.currentConnectionPromise;
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

  /** The official `restorableSessionMode`: the stored mode, bypass only while it is allowed. */
  private restorableSessionMode(summary: Pick<SessionSummary, 'permissionMode'>, connection: BaseTransport) {
    return restorableSessionMode(summary, connection.config(), connection.claudeConfig()?.claudeSettings);
  }

  setActiveSession(session: Session | undefined): void {
    this.activeSession(session);
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
