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
import type { GuardLevel } from './levels';
import { summariseClaims, type ToolCallRecord } from '../../shared/claimCheck';

/** Calls remembered per session, newest kept. Claims can name earlier turns' edits. */
const MAX_CALLS = 500;

/** Most "give the final answer" nudges in one turn. */
export const MAX_EMPTY_ANSWER_NUDGES = 2;

/**
 * A test command. Wider than the claim badge's (`claimCheck.ts`, untouched):
 * a run this misses makes an honest "tests pass" look unbacked, and a
 * challenge on an honest report costs more than one that never fires.
 */
export const TEST_COMMAND = new RegExp(
  [
    String.raw`\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test`,
    String.raw`\bvitest\b|\bjest\b|\bpytest\b|\bgo test\b|\bcargo (?:test|nextest)\b|\bmvn test\b|\bgradlew?\b[^|;&]*\b(?:test|check)\b`,
    String.raw`\bmake (?:test|check)\b|\bphpunit\b|\brspec\b|\btox\b|\bunittest\b|\bdotnet test\b|\bdeno test\b|\bctest\b|\bmocha\b`,
    String.raw`\bplaywright test\b|\bnode --test\b|\bbazel test\b|\bswift test\b`,
    // A `test` / `spec` / `check` subcommand or script of a task runner.
    String.raw`\b(?:npm|pnpm|yarn|bun|make|just|task|mix|rake|composer|deno task|poetry run|uv run)\s+(?:run\s+)?(?:test|tests|spec|check)(?:[:\-_][\w:-]+)?\b`,
    // A test script run directly (the command itself, or what an interpreter runs), never one merely read.
    String.raw`(?:^|[;&|]\s*)(?:(?:bash|sh|zsh|python3?|node|npx tsx|tsx)\s+)?(?:\.{0,2}\/)?(?:[\w.-]+\/)*(?:test|tests|run[-_]tests|spec|check)(?:[-_]\w+)*\.(?:sh|py|js|mjs|ts)\b`,
  ].join('|'),
  'i',
);

/**
 * Lines that are not claims of finished work: what is still open, what is
 * not done, what happened before this session. The Alpha report template asks
 * for a Remaining section and "Tests: not run"; both read as claims to the
 * badge's regexes, and challenging an honest report trains the model to drop
 * those sections.
 */
const NOT_DONE = /\b(?:not (?:yet )?run|haven'?t|have not|not yet|still (?:needs?|to)|needs? to be|pending|remaining|already|previously|earlier|before this|in #\d+|in commit)\b/i;

/** A heading that opens a section of open items: `Remaining`, `## Next steps`, `**Not done**:`. */
const OPEN_HEADING = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?(?:remaining|next(?: steps)?|not done|open items|left to do|todo)\b/i;

/** Any heading: `## X`, `**X**`, `X:` alone on a line. */
const ANY_HEADING = /^\s*(?:#{1,6}\s+\S|(?:\*\*|__)[^*_]+(?:\*\*|__):?\s*$|[A-Z][\w /-]{0,40}:\s*$)/;

/** The report with the lines that do not claim finished work taken out. */
export function claimLines(report: string): string {
  const kept: string[] = [];
  let inOpenSection = false;
  for (const line of report.split(/\r?\n/)) {
    if (OPEN_HEADING.test(line)) {
      // "Remaining: x" carries its item on the heading line; either way the
      // line goes, and a bare heading opens the section.
      inOpenSection = true;
      continue;
    }
    if (inOpenSection && ANY_HEADING.test(line)) inOpenSection = false;
    if (inOpenSection || NOT_DONE.test(line)) continue;
    kept.push(line);
  }
  return kept.join('\n');
}

/** Formatters and codemods that rewrite the files they are given. */
const REWRITES_FILES = /^(?:npx\s+|pnpm\s+(?:exec\s+|dlx\s+)?|yarn\s+|bunx\s+)?(?:prettier\b.*--write|eslint\b.*--fix|biome\b.*--write|black|isort|ruff\b.*(?:format|--fix)|gofmt\b.*-w|goimports\b.*-w|rustfmt|clang-format\b.*-i|jscodeshift|stylelint\b.*--fix|autopep8\b.*-i)\b/;

/**
 * The files a write-shaped shell command changes, for the claim check: a
 * redirect or `tee` target, `sed -i` / `perl -i`, `mv` / `cp` / `rm`,
 * `git mv|rm|checkout|restore`, a known formatter or codemod. Anything else,
 * `cat src/a.ts` included, changes nothing.
 */
export function filesWrittenBy(command: string): string[] {
  const out: string[] = [];
  const pathish = (t: string) => !t.startsWith('-') && /[\w-]+\.[A-Za-z]\w{0,9}$|\//.test(t);
  const strip = (t: string) => t.replace(/^['"]|['"]$/g, '');
  for (const m of command.matchAll(/(?:^|[^0-9&>])>>?\s*(?!&)([^\s&|;>]+)/g)) {
    if (m[1] !== '/dev/null') out.push(strip(m[1]));
  }
  for (const segment of command.split(/&&|\|\||;|\|/)) {
    const words = segment.trim().split(/\s+/).map(strip).filter(Boolean);
    if (!words.length) continue;
    const [cmd, sub] = words;
    const args = words.slice(1).filter(pathish);
    if (cmd === 'tee') out.push(...args);
    else if ((cmd === 'sed' || cmd === 'perl') && words.some((w) => /^-\w*i/.test(w))) out.push(...args);
    else if (cmd === 'mv' || cmd === 'cp' || cmd === 'rm') out.push(...args);
    else if (cmd === 'git' && /^(?:mv|rm|checkout|restore)$/.test(sub ?? '')) out.push(...words.slice(2).filter(pathish));
    else if (REWRITES_FILES.test(segment.trim())) out.push(...args);
  }
  return [...new Set(out)];
}

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
  /** The session was resumed: its earlier turns' calls are not in this store. */
  resumed: boolean;
}

/** Which of the gate's checks run (the policy's `emptyAnswer` / `claimChallenge`). */
export interface StopChecks {
  emptyAnswer: boolean;
  claimChallenge: boolean;
}

/** The older call shape: what each level ran before the policy existed. */
function checksFor(level: GuardLevel): StopChecks {
  return { emptyAnswer: level !== 'off', claimChallenge: level === 'strict' };
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

  /**
   * The session was resumed (SessionStart `source: 'resume'`): the store holds
   * none of its earlier calls, so a summary that names earlier work is not
   * checked until this process has seen a call of its own.
   */
  markResumed(sessionId: string): void {
    this.stateFor(sessionId).resumed = true;
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
    // A write-shaped command is evidence for the files it writes.
    if (name === 'Bash' && typeof command === 'string') {
      for (const file of filesWrittenBy(command)) state.calls.push({ name: 'Write', input: { file_path: file } });
    }
    while (state.calls.length > MAX_CALLS) state.calls.shift();
  }

  /**
   * What, if anything, to tell the model before it may stop.
   *
   * @param lastMessage the SDK's `last_assistant_message`
   * @param stopHookActive the SDK's `stop_hook_active`
   * @returns the text to send back as `additionalContext`, or undefined to let
   *   the turn end.
   */
  onStop(
    sessionId: string,
    checks: GuardLevel | StopChecks,
    lastMessage: string | undefined,
    stopHookActive: boolean,
  ): string | undefined {
    const { emptyAnswer, claimChallenge } = typeof checks === 'string' ? checksFor(checks) : checks;
    if ((!emptyAnswer && !claimChallenge) || stopHookActive) return undefined;
    const state = this.stateFor(sessionId);
    const text = (lastMessage ?? '').trim();

    if (!text) {
      if (!emptyAnswer || state.callsThisTurn === 0 || state.emptyNudges >= MAX_EMPTY_ANSWER_NUDGES) return undefined;
      state.emptyNudges += 1;
      return (
        'Your last message was empty, right after a tool result. Give the user your final answer now, ' +
        'using the tool results above. Do not call more tools unless you really need to.'
      );
    }

    // The claim challenge runs under `strict` or Alpha (the policy); otherwise
    // Claude's own summaries are left to the webview's badge.
    if (!claimChallenge || state.claimChallenged) return undefined;
    // No evidence store, no challenge: a resumed session's earlier calls are
    // not here, and nothing has run since.
    if (state.resumed && !state.calls.length && !state.testRuns.length && state.callsThisTurn === 0) return undefined;
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
    const summary = summariseClaims(claimLines(text), state.calls);
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
      state = { calls: [], testRuns: [], callsThisTurn: 0, claimChallenged: false, emptyNudges: 0, resumed: false };
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
