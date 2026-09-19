/**
 * Keeping each conversation's permission mode on the host (step 18).
 *
 * A port of the official webview's `SL1` (the session's `modePersist`), same
 * method names and bookkeeping. A deliberate mode choice becomes an "intent";
 * the intent is committed to the host (`persist_session_permission_mode`) once
 * the session has an id and a connection, and only when it needs to be:
 * the CLI accepted the mode, the launch applied it, or it lowers privilege
 * (leaving bypass, or a mode that is not kept, which clears the stored one).
 * `storeMirror` is what the host is believed to hold for this session.
 *
 * Kept free of Vue and signals so the specs can drive it directly.
 */
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';

/**
 * `aF0` / `Z01`: the modes the host keeps. The official list also has `auto`;
 * Forge keeps Auto out, and the host neither stores nor restores it.
 */
export const STORED_SESSION_MODES: readonly PermissionMode[] = ['default', 'acceptEdits', 'bypassPermissions'];

export function isStoredSessionMode(mode: unknown): mode is PermissionMode {
  return typeof mode === 'string' && (STORED_SESSION_MODES as readonly string[]).includes(mode);
}

/** The one call the persister makes (the official connection's `persistSessionPermissionMode`). */
export interface ModePersistConnection {
  persistSessionPermissionMode(
    sessionId: string,
    mode: PermissionMode,
    previousSessionId?: string,
    carriedFromStore?: boolean
  ): Promise<unknown>;
}

type IntentOutcome = 'pending' | 'launchApplied' | 'accepted' | 'refused' | 'unknown';

interface ModeIntent {
  mode: PermissionMode;
  token: number;
  outcome: IntentOutcome;
  privilegeReducing: boolean;
  committed: boolean;
  owedReductionFromSupersession: boolean;
  hadCommitFailure: boolean;
  owedClearSessionId?: string;
}

export class ModePersist {
  private intent?: ModeIntent;
  private token = 0;
  private commitInFlight = false;
  private flushSwallowedWhileCommitInFlight = false;
  private storeMirror?: PermissionMode;

  /** Called when a commit settles and a flush was swallowed meanwhile (the session re-flushes). */
  constructor(private readonly onCommitSettledWithFlushOwed: () => void) {}

  get mirror(): PermissionMode | undefined {
    return this.storeMirror;
  }

  get currentToken(): number {
    return this.token;
  }

  seedMirror(mode: PermissionMode | undefined): void {
    this.storeMirror = mode;
  }

  reconcileMirror(mode: PermissionMode | undefined): void {
    this.storeMirror = mode;
  }

  /**
   * The user picked `mode`. `pushDeliverable` is whether the pick goes to a live
   * CLI (then the outcome waits for its answer) or only into the next launch.
   */
  deliberateCycle(mode: PermissionMode, options: { exitingMode?: PermissionMode; pushDeliverable: boolean }): number {
    this.token++;
    const previous = this.intent;
    const owedClearSessionId = previous?.committed ? undefined : previous?.owedClearSessionId;
    const previousStillReducing =
      previous !== undefined && !previous.committed && previous.outcome !== 'refused' && previous.privilegeReducing;
    const owedReduction =
      previous !== undefined &&
      !previous.committed &&
      (previous.privilegeReducing || previous.owedReductionFromSupersession);
    this.intent = {
      mode,
      token: this.token,
      outcome: options.pushDeliverable ? 'pending' : 'launchApplied',
      privilegeReducing:
        !isStoredSessionMode(mode) ||
        (mode !== 'bypassPermissions' &&
          (options.exitingMode === 'bypassPermissions' ||
            this.storeMirror === 'bypassPermissions' ||
            previousStillReducing)),
      committed: false,
      owedReductionFromSupersession: false,
      hadCommitFailure: previous !== undefined && !previous.committed && previous.hadCommitFailure,
      owedClearSessionId,
    };
    this.intent.owedReductionFromSupersession = owedReduction && !this.intent.privilegeReducing;
    return this.token;
  }

  /** The CLI answered the push for `token`. */
  pushResolved(token: number, accepted: boolean): void {
    if (this.intent?.token !== token) return;
    this.intent.outcome = accepted ? 'accepted' : 'refused';
    if (!accepted) this.convertDyingObligationCarrierToClear();
  }

  /** The push for `token` failed without an answer. */
  pushUnsettled(token: number): void {
    if (this.intent?.token !== token) return;
    if (this.intent.outcome === 'pending') this.intent.outcome = 'unknown';
    this.convertDyingObligationCarrierToClear();
  }

  /**
   * An intent that only carried a superseded reduction and is itself dead
   * (refused or unknown) still owes that reduction: turn it into a clear.
   */
  private convertDyingObligationCarrierToClear(): void {
    const intent = this.intent;
    if (
      intent === undefined ||
      intent.committed ||
      !intent.owedReductionFromSupersession ||
      (intent.outcome !== 'refused' && intent.outcome !== 'unknown')
    ) {
      return;
    }
    intent.mode = 'plan';
    intent.privilegeReducing = true;
    intent.owedReductionFromSupersession = false;
  }

  hasStaleEntryDebt(): boolean {
    const intent = this.intent;
    return intent !== undefined && !intent.committed && intent.hadCommitFailure;
  }

  /** The CLI replaced the session id: an uncommitted intent also owes clearing the old one. */
  noteSessionIdChange(previousSessionId: string): void {
    const intent = this.intent;
    if (intent !== undefined && !intent.committed) intent.owedClearSessionId ??= previousSessionId;
  }

  hasPendingDeliberateChoice(): boolean {
    const intent = this.intent;
    return intent !== undefined && !intent.committed && intent.outcome !== 'refused';
  }

  private intentNeedsCommit(): boolean {
    const intent = this.intent;
    return (
      intent !== undefined &&
      !intent.committed &&
      (intent.privilegeReducing || intent.outcome === 'accepted' || intent.outcome === 'launchApplied')
    );
  }

  /** Commit the intent for `sessionId`, if it needs it. True when a request went out. */
  tryCommit(connection: ModePersistConnection, sessionId: string, previousSessionId?: string): boolean {
    const intent = this.intent;
    if (intent === undefined || !this.intentNeedsCommit()) return false;
    if (this.commitInFlight) {
      this.flushSwallowedWhileCommitInFlight = true;
      return false;
    }
    const mirrorBefore = this.storeMirror;
    const stored = isStoredSessionMode(intent.mode) ? intent.mode : undefined;
    this.storeMirror = stored;
    const clearId =
      intent.owedClearSessionId !== undefined && intent.owedClearSessionId !== sessionId
        ? intent.owedClearSessionId
        : previousSessionId;
    this.commitInFlight = true;
    const committedMode = intent.mode;
    connection.persistSessionPermissionMode(sessionId, intent.mode, clearId).then(
      () => {
        this.commitInFlight = false;
        if (this.intent?.token === intent.token && this.intent.mode === committedMode) {
          this.intent.committed = true;
          this.intent.hadCommitFailure = false;
          this.intent.owedClearSessionId = undefined;
        }
        this.reofferSwallowedFlush();
      },
      () => {
        this.commitInFlight = false;
        if (this.intent !== undefined && !this.intent.committed) {
          this.intent.hadCommitFailure = true;
          this.intent.owedClearSessionId ??= sessionId;
        }
        if (this.storeMirror === stored) this.storeMirror = mirrorBefore;
        this.reofferSwallowedFlush();
      }
    );
    return true;
  }

  private reofferSwallowedFlush(): void {
    if (!this.flushSwallowedWhileCommitInFlight) return;
    this.flushSwallowedWhileCommitInFlight = false;
    if (this.intentNeedsCommit()) this.onCommitSettledWithFlushOwed();
  }

  /** The CLI replaced the id with nothing to commit: move the stored mode along. */
  moveCommittedEntry(connection: ModePersistConnection, sessionId: string, previousSessionId: string): void {
    const mode = this.storeMirror;
    if (mode === undefined) return;
    connection.persistSessionPermissionMode(sessionId, mode, previousSessionId, true).catch(() => {});
  }
}

/**
 * The official `restorableSessionMode(summary, connection)`: the stored mode a
 * listed session reopens in, except bypass unless it is allowed and the CLI's
 * settings don't disable it.
 */
export function restorableSessionMode(
  summary: { permissionMode?: PermissionMode },
  config: { allowDangerouslySkipPermissions?: boolean } | undefined,
  claudeSettings: { effective: { permissions?: { disableBypassPermissionsMode?: string } } } | undefined
): PermissionMode | undefined {
  const mode = summary.permissionMode;
  if (!mode) return undefined;
  if (mode === 'bypassPermissions') {
    const disabled = claudeSettings?.effective.permissions?.disableBypassPermissionsMode === 'disable';
    if (!config?.allowDangerouslySkipPermissions || disabled) return undefined;
  }
  return mode;
}

/**
 * The official list refresh's `bypassGateDecidablyOpen`: known to be open, so a
 * stored bypass that is gone from the list was really cleared.
 */
export function bypassGateDecidablyOpen(
  config: { allowDangerouslySkipPermissions?: boolean } | undefined,
  claudeSettings: { effective: { permissions?: { disableBypassPermissionsMode?: string } } } | undefined
): boolean {
  return (
    config !== undefined &&
    config.allowDangerouslySkipPermissions === true &&
    claudeSettings?.effective.permissions?.disableBypassPermissionsMode !== 'disable'
  );
}
