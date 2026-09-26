/**
 * Stop gate: one last check before the model is allowed to finish a turn.
 *
 * Two things a small model does at the end of a turn that nothing else in the
 * pipeline catches:
 *
 *   - **It claims work it did not do.** "I updated `config.ts` and the tests
 *     pass", with no edit to `config.ts` and no test run in the session. The
 *     webview's claim badge tells the *reader*; nothing told the *model*, so
 *     the turn ended on a false report. alphacode's `claim_checker.rs` has the
 *     same blind spot -- it only logs. Here the finding goes back to the model
 *     once, and it has to either do the work or correct the summary.
 *   - **It goes quiet after a tool result.** The turn ends with an empty
 *     message right after a tool ran, so the user gets no answer at all.
 *     alphacode `response_recovery.rs` `maybe_continue_empty_post_tool_response`
 *     asks for the final answer; so does this, at most twice a turn.
 *
 * Both go back as the Stop hook's `additionalContext`, which the SDK delivers
 * to the model and continues the turn with (`sdk.d.ts`
 * `StopHookSpecificOutput`). Each fires a bounded number of times per turn,
 * never while `stop_hook_active` says the model is already continuing because
 * of a stop hook, and the CLI's own cap on consecutive stop-hook blocks
 * (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`, 8) is the last backstop.
 */
import type { GuardLevel } from '../endpoints/profile';
import { summariseClaims, type ToolCallRecord } from '../../shared/claimCheck';

/** Calls remembered per session, newest kept. Claims can name earlier turns' edits. */
const MAX_CALLS = 500;

/** Most "give the final answer" nudges in one turn. */
export const MAX_EMPTY_ANSWER_NUDGES = 2;

/** A test command, as the claim checker recognises one. */
const TEST_COMMAND = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test|\bvitest\b|\bjest\b|\bpytest\b|\bgo test\b|\bcargo test\b|\bmvn test\b|\bgradle test\b|\bmake test\b|\bphpunit\b|\brspec\b|\btox\b/i;

/** A claim that the tests *passed*, rather than merely ran. */
const CLAIMS_PASSING = /\b(?:pass(?:ed|es|ing)?|green|succeed(?:ed|s)?|all good)\b/i;

interface SessionState {
  /** Successful calls, oldest first. What a claim can be verified against. */
  calls: ToolCallRecord[];
  /** Test commands that ran this session, and whether each one exited cleanly. */
  testRuns: { command: string; ok: boolean }[];
  /** Tool calls since the user last spoke. */
  callsThisTurn: number;
  claimChallenged: boolean;
  emptyNudges: number;
}

export class StopGate {
  private readonly sessions = new Map<string, SessionState>();

  /** The user has spoken: a new turn, with its own budget of challenges. */
  beginTurn(sessionId: string): void {
    const state = this.stateFor(sessionId);
    state.callsThisTurn = 0;
    state.claimChallenged = false;
    state.emptyNudges = 0;
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** Record a finished tool call. Only successes can back a claim. */
  recordCall(sessionId: string, name: string, input: unknown, ok: boolean): void {
    const state = this.stateFor(sessionId);
    state.callsThisTurn += 1;
    const record: ToolCallRecord = {
      name,
      input: (input && typeof input === 'object' ? input : {}) as Record<string, unknown>,
    };
    const command = record.input.command;
    if (name === 'Bash' && typeof command === 'string' && TEST_COMMAND.test(command)) {
      state.testRuns.push({ command, ok });
      if (state.testRuns.length > MAX_CALLS) state.testRuns.shift();
    }
    if (!ok) return;
    state.calls.push(record);
    if (state.calls.length > MAX_CALLS) state.calls.shift();
  }

  /**
   * What, if anything, to tell the model before it may stop.
   *
   * @param lastMessage the SDK's `last_assistant_message`
   * @param stopHookActive the SDK's `stop_hook_active`
   * @returns the text to send back as `additionalContext`, or undefined to let
   *   the turn end.
   */
  onStop(sessionId: string, level: GuardLevel, lastMessage: string | undefined, stopHookActive: boolean): string | undefined {
    if (level === 'off' || stopHookActive) return undefined;
    const state = this.stateFor(sessionId);
    const text = (lastMessage ?? '').trim();

    if (!text) {
      if (state.callsThisTurn === 0 || state.emptyNudges >= MAX_EMPTY_ANSWER_NUDGES) return undefined;
      state.emptyNudges += 1;
      return (
        'Your last message was empty, right after a tool result. Give the user your final answer now, ' +
        'using the tool results above. Do not call more tools unless you really need to.'
      );
    }

    // The claim challenge is for the small models it was built for: under
    // `standard`, Claude's own summaries are left to the webview's badge.
    if (level !== 'strict' || state.claimChallenged) return undefined;
    const problems = this.unverifiedClaims(state, text);
    if (!problems.length) return undefined;
    state.claimChallenged = true;
    return (
      'Before you finish: your summary claims work that no tool call in this session shows.\n' +
      problems.map((p) => `- ${p}`).join('\n') +
      '\nIf the work is still to be done, do it now and check it. Otherwise correct your summary so it ' +
      'reports only what you actually did.'
    );
  }

  /** Each unverified claim, as one line saying what is missing. */
  private unverifiedClaims(state: SessionState, text: string): string[] {
    const summary = summariseClaims(text, state.calls);
    const lines: string[] = [];
    for (const verdict of summary?.verdicts ?? []) {
      if (verdict.verified) continue;
      const quote = `"${verdict.claim.text.slice(0, 160)}"`;
      if (verdict.claim.kind === 'file-edit') {
        lines.push(`${quote}: no Write or Edit to ${verdict.claim.target} was made.`);
        continue;
      }
      // Tests are judged on the runs themselves, failed ones included: "I ran
      // the tests, three fail" is an honest report, and "the tests pass" after
      // runs that all failed is not.
      if (!state.testRuns.length) {
        lines.push(`${quote}: no test command was run.`);
      } else if (CLAIMS_PASSING.test(verdict.claim.text) && !state.testRuns.some((r) => r.ok)) {
        const last = state.testRuns[state.testRuns.length - 1];
        lines.push(`${quote}: the test run (${last.command}) failed.`);
      }
    }
    return lines;
  }

  private stateFor(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = { calls: [], testRuns: [], callsThisTurn: 0, claimChallenged: false, emptyNudges: 0 };
      this.sessions.set(sessionId, state);
      while (this.sessions.size > 64) {
        const oldest = this.sessions.keys().next();
        if (oldest.done) break;
        this.sessions.delete(oldest.value);
      }
    }
    return state;
  }
}

/** The gate the extension host uses. */
export const stopGate = new StopGate();
