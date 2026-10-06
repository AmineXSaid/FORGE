/**
 * The small-model guards as hooks: one place, two ways in.
 *
 * - **SDK callbacks.** `ClaudeSdkService` wires each method below into the
 *   Agent SDK's `hooks` option, beside its own non-guard hooks, so the chat
 *   behaves exactly as it did when these bodies were inline there.
 * - **The CLI's HTTP hooks.** A terminal CLI has no SDK session to call back
 *   into, but it POSTs every hook input to a URL (`type: 'http'`, measured
 *   against CLI 2.1.274). `handle()` answers one such input by running the same
 *   methods in the SDK's order and merging their outputs, and `stepCap` stands
 *   in for the SDK's `maxTurns`, which the CLI honours only with `--print`.
 *
 * Nothing here knows about VS Code: the level, the log, the stop notice and the
 * diagnostics source are injected, so the same code serves any host.
 */
import type { SyncHookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import type { EditDiagnostics } from './editDiagnostics';
import { failureHints as defaultFailureHints, type FailureHints } from './failureHints';
import type { GuardLevel } from './levels';
import { loopGuard as defaultLoopGuard, type LoopGuard, type LoopVerdict } from './loopGuard';
import { guardPolicy, type GuardPolicy } from './policy';
import { inputKey, repeatGuard as defaultRepeatGuard, type RepeatGuard } from './repeatGuard';
import { toolResponseText } from './smartStream';
import { stopGate as defaultStopGate, type StopGate } from './stopGate';
import { guardMarker, type GuardNoteKind } from '../../shared/guardNotes';

/** The fields of a hook input the guards read. Everything else passes through untouched. */
export interface GuardHookInput {
  hook_event_name: string;
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  tool_use_id?: string;
  agent_id?: string;
  prompt_id?: string;
  error?: unknown;
  is_interrupt?: boolean;
  source?: string;
  last_assistant_message?: string;
  stop_hook_active?: boolean;
}

export interface GuardHookDeps {
  /** The guard level now; read on every call, so a profile switch applies at once. */
  level(): GuardLevel;
  /**
   * The user's Alpha mode switch now (48b); read on every call, so a toggle
   * applies from the next tool call, mid-turn included. Absent: off.
   */
  alpha?(): boolean;
  /**
   * Model turns used since the user last spoke, from the host's own counter
   * (`ClaudeAgentService`). Feeds the wrap-up nudge before the step cap.
   * Absent: this hook set's own step count (the terminal).
   */
  turnsUsed?(sessionId: string): number;
  /**
   * Told every time a guard sends the model back (48b), so the host can show
   * a one-line note. The model-facing text carries `guardMarker(kind)`.
   */
  onNote?(kind: GuardNoteKind, detail?: string): void;
  /**
   * The Alpha working rules' text (`_alpha.md`), for delivery into a running
   * conversation on the next user message. Absent: no rules from the hooks
   * (the terminal passes no system prompt text at all).
   */
  alphaRules?(): string | undefined;
  /** The line that retracts the rules once the switch goes off. */
  alphaRulesOff?: string;
  /** This process was launched with the Alpha rules in its system prompt. */
  rulesInSystemPrompt?: boolean;
  log(line: string): void;
  /** Told when a guard ends the turn, to show the user why. */
  onStop(message: string): void;
  /** Errors an edit introduced, when the policy runs the check. Absent: the check is skipped. */
  editDiagnostics?: EditDiagnostics;
  /**
   * Count model turns per user message and stop past the policy's step cap. For
   * hosts that cannot pass `maxTurns` to the CLI (an interactive terminal);
   * an SDK session sets `maxTurns` instead and leaves this off.
   */
  stepCap?: boolean;
  /** The guard state, injectable for tests; defaults to the shared instances. */
  state?: { loop?: LoopGuard; repeat?: RepeatGuard; hints?: FailureHints; gate?: StopGate };
}

/** The file tools whose edits are checked against the language servers. */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

function editTarget(toolName: string | undefined, input: unknown): string | undefined {
  if (!toolName || !EDIT_TOOLS.has(toolName)) return undefined;
  const file = (input as { file_path?: unknown } | undefined)?.file_path;
  return typeof file === 'string' && file.trim() ? file : undefined;
}

const CONTINUE: SyncHookJSONOutput = { continue: true };

/** Steps left when the wrap-up nudge is given. */
export const STEP_BUDGET_WARNING = 10;

export function stepCapMessage(steps: number, alpha = false): string {
  return alpha
    ? `Forge stopped this turn at Alpha mode's step limit (${steps} steps). ` +
        `Ask it to summarise what is done and what is left, or say "continue" to give it another round.`
    : `Forge stopped this turn at its step limit (${steps} steps) so a small model cannot run forever. ` +
        `Ask it to summarise what is done and what is left, or say "continue" to give it another round.`;
}

/** The wrap-up nudge, `STEP_BUDGET_WARNING` steps before the cap. */
export function stepBudgetMessage(left: number): string {
  return (
    `${left} steps left this turn. Bring the current change to a consistent state, then report ` +
    'Result / Changes / Verification / Remaining.'
  );
}

export function createGuardHooks(deps: GuardHookDeps) {
  const loop = deps.state?.loop ?? defaultLoopGuard;
  const repeat = deps.state?.repeat ?? defaultRepeatGuard;
  const hints = deps.state?.hints ?? defaultFailureHints;
  const gate = deps.state?.gate ?? defaultStopGate;
  /**
   * Model turns since the user last spoke, per session (terminal only). A
   * PreToolUse starts a new turn only once a result has come back since the
   * last counted one: parallel calls arrive back to back and count once.
   */
  const steps = new Map<string, { count: number; awaitingResult: boolean }>();
  /** Sessions already given the wrap-up nudge this turn. */
  const budgetNudged = new Set<string>();
  const sid = (input: GuardHookInput) => input.session_id ?? 'default';
  const alphaOn = () => deps.alpha?.() ?? false;
  /**
   * Where the Alpha rules stand in each conversation: in the system prompt
   * (launched with Alpha on), delivered as context, or needed. History rules
   * can be summarised away by a compaction; system-prompt rules cannot.
   */
  const rulesState = new Map<string, 'in-system-prompt' | 'delivered' | 'needed'>();
  const rulesFor = (id: string) => rulesState.get(id) ?? (deps.rulesInSystemPrompt ? 'in-system-prompt' : 'needed');
  /** A guard message for the model, marked as Forge's, and the host told. */
  const mark = (kind: GuardNoteKind, text: string, detail?: string): string => {
    deps.onNote?.(kind, detail);
    return `${guardMarker(kind)} ${text}`;
  };
  const policy = (): GuardPolicy => guardPolicy(deps.level(), alphaOn());
  /** A result came back: the next PreToolUse is a new model turn. */
  const resultArrived = (input: GuardHookInput) => {
    const s = steps.get(sid(input));
    if (s) s.awaitingResult = false;
  };

  /** The wrap-up nudge, once a turn, when the step budget is nearly spent. */
  function stepBudget(input: GuardHookInput, p: GuardPolicy): string | undefined {
    const cap = p.stepCap;
    const id = sid(input);
    if (!cap || budgetNudged.has(id)) return undefined;
    const used = deps.turnsUsed?.(id) ?? steps.get(id)?.count ?? 0;
    if (used < cap - STEP_BUDGET_WARNING) return undefined;
    budgetNudged.add(id);
    deps.log(`[StepCap] ${used} of ${cap} steps used; asked to wrap up`);
    const left = Math.max(0, cap - used);
    return mark('step-budget', stepBudgetMessage(left), String(left));
  }

  /**
   * A loop verdict as hook output. A nudge goes to the model as context on this
   * tool's result; a stop ends the turn (`continue: false`) and tells the user,
   * because a hook's `stopReason` never reaches the SDK's message stream.
   */
  function guardOutput(
    event: 'PostToolUse' | 'PostToolUseFailure',
    toolName: string,
    verdict: LoopVerdict,
    extraNudge?: string,
  ): SyncHookJSONOutput {
    const nudge =
      verdict.action === 'nudge'
        ? mark(verdict.detail.endsWith('read-only calls in a row') ? 'read-only' : 'loop', verdict.message)
        : undefined;
    const context = [extraNudge, nudge].filter(Boolean).join('\n\n');
    if (verdict.action !== 'none') deps.log(`[LoopGuard] ${verdict.action} after ${toolName}: ${verdict.detail}`);
    if (verdict.action === 'stop') {
      deps.onStop(verdict.message);
      return {
        continue: false,
        stopReason: verdict.message,
        hookSpecificOutput: { hookEventName: event, additionalContext: verdict.message },
      };
    }
    if (!context) return CONTINUE;
    return { continue: true, hookSpecificOutput: { hookEventName: event, additionalContext: context } };
  }

  const hooks = {
    /** PreToolUse on an edit, when the policy checks edits: snapshot the file's errors before it changes. */
    async preEdit(input: GuardHookInput): Promise<SyncHookJSONOutput> {
      if (input.hook_event_name !== 'PreToolUse' || !policy().editDiagnostics || !deps.editDiagnostics) return CONTINUE;
      const file = editTarget(input.tool_name, input.tool_input);
      if (file && input.tool_use_id) deps.editDiagnostics.before(input.tool_use_id, file);
      return CONTINUE;
    },

    /**
     * PreToolUse on every tool: refuse a call that already failed the same way,
     * or a success re-run with nothing changed. Denied with the reason, since a
     * model that is not told why simply tries again.
     */
    async preToolUse(input: GuardHookInput): Promise<SyncHookJSONOutput> {
      if (input.hook_event_name !== 'PreToolUse' || !input.tool_name) return CONTINUE;
      const failed = repeat.check(sid(input), input.tool_name, input.tool_input);
      const verdict = failed.refuse
        ? failed
        : repeat.checkRepeat(
            { sessionId: sid(input), agentId: input.agent_id, promptId: input.prompt_id },
            input.tool_name,
            input.tool_input,
          );
      if (!verdict.refuse) return CONTINUE;
      deps.log(
        `[RepeatGuard] refused ${input.tool_name} (${verdict.tier}, ` +
          `${verdict.failures} prior ${verdict.tier === 'identical-success' ? 'run' : 'failure'}(s))`,
      );
      // A refused call never reaches PostToolUse, so without this the loop
      // guard never sees a model that keeps retrying it: the refusal is the
      // step's outcome. Repeated, it earns the loop nudge, then the stop.
      // A refused call is finished: no result will come back for it.
      resultArrived(input);
      const loopVerdict = loop.record(sid(input), policy().loop, input.tool_name, input.tool_input, `refused:${verdict.tier}`, input.agent_id);
      if (loopVerdict.action !== 'none') deps.log(`[LoopGuard] ${loopVerdict.action} after refused ${input.tool_name}: ${loopVerdict.detail}`);
      const deny = {
        hookEventName: 'PreToolUse' as const,
        permissionDecision: 'deny' as const,
        // The refusal itself gets no note (it shows as a refused call); a loop
        // nudge riding on it is a send-back like any other.
        permissionDecisionReason:
          loopVerdict.action === 'none'
            ? verdict.reason
            : `${verdict.reason}\n\n${loopVerdict.action === 'nudge' ? mark('loop', loopVerdict.message) : loopVerdict.message}`,
      };
      if (loopVerdict.action === 'stop') {
        deps.onStop(loopVerdict.message);
        return { continue: false, stopReason: loopVerdict.message, hookSpecificOutput: deny };
      }
      return { continue: true, hookSpecificOutput: deny };
    },

    /**
     * The user has spoken: counts for the previous turn no longer apply. A
     * 'system' continuation is the same turn. Also where the Alpha rules reach
     * a running conversation: once when the switch is on and the rules are not
     * there yet, and one retraction line when it goes off.
     */
    async userPromptSubmit(input: GuardHookInput): Promise<SyncHookJSONOutput> {
      if (input.hook_event_name !== 'UserPromptSubmit' || input.source === 'system') return CONTINUE;
      const id = sid(input);
      loop.beginTurn(id);
      hints.beginTurn(id);
      gate.beginTurn(id);
      steps.delete(id);
      budgetNudged.delete(id);
      if (!deps.alphaRules) return CONTINUE;
      const state = rulesFor(id);
      let context: string | undefined;
      if (alphaOn() && state === 'needed') {
        context = deps.alphaRules();
        if (context) rulesState.set(id, 'delivered');
      } else if (!alphaOn() && state !== 'needed') {
        context = deps.alphaRulesOff;
        rulesState.set(id, 'needed');
      }
      if (!context) return CONTINUE;
      deps.log(`[AlphaRules] ${alphaOn() ? 'delivered the Alpha rules' : 'retracted the Alpha rules'} on the next message`);
      return { continue: true, hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } };
    },

    /** A resumed session: the claim check has none of its earlier calls (`stopGate.ts`). */
    /**
     * SessionStart. A resumed session: the claim check has none of its
     * earlier calls (`stopGate.ts`). A compaction: rules delivered as history
     * may have been summarised away, so they go again on the next message.
     */
    async sessionStart(input: GuardHookInput): Promise<SyncHookJSONOutput> {
      if (input.hook_event_name !== 'SessionStart') return CONTINUE;
      if (input.source === 'resume') gate.markResumed(sid(input));
      if (input.source === 'compact' && rulesFor(sid(input)) === 'delivered') rulesState.set(sid(input), 'needed');
      return CONTINUE;
    },

    /** The last check before the model may finish: an unbacked claim or an empty answer goes back once. */
    async stop(input: GuardHookInput): Promise<SyncHookJSONOutput> {
      if (input.hook_event_name !== 'Stop') return CONTINUE;
      const p = policy();
      const feedback = gate.onStop(
        sid(input),
        { emptyAnswer: p.emptyAnswer, claimChallenge: p.claimChallenge },
        input.last_assistant_message,
        input.stop_hook_active ?? false,
      );
      if (!feedback) return CONTINUE;
      deps.log(`[StopGate] sent back before stopping: ${feedback.split('\n')[0]}`);
      const marked = mark(feedback.startsWith('Before you finish') ? 'claim' : 'empty-answer', feedback);
      return { continue: true, hookSpecificOutput: { hookEventName: 'Stop', additionalContext: marked } };
    },

    /** A failed tool: what the repeat guard counts, a hint for the fix, and a step for the loop guard. */
    async postToolUseFailure(input: GuardHookInput): Promise<SyncHookJSONOutput> {
      if (input.hook_event_name !== 'PostToolUseFailure' || !input.tool_name) return CONTINUE;
      // An interrupt is the user stopping the turn, not the model failing to adapt.
      if (input.is_interrupt) return CONTINUE;
      const sessionId = sid(input);
      const error = String(input.error ?? '');
      const p = policy();
      gate.recordCall(sessionId, input.tool_name, input.tool_input, false);
      const nudge = repeat.recordFailure(sessionId, input.tool_name, input.tool_input, error);
      const hint = p.hints ? hints.hintFor(sessionId, input.tool_name, input.tool_input, error, input.cwd) : undefined;
      const verdict = loop.record(sessionId, p.loop, input.tool_name, input.tool_input, `error:${error}`, input.agent_id);
      const extra = [hint, nudge, stepBudget(input, p)].filter(Boolean).join('\n\n') || undefined;
      return guardOutput('PostToolUseFailure', input.tool_name, verdict, extra);
    },

    /** PostToolUse on an edit, when the policy checks edits: the errors the edit introduced. */
    async postEdit(input: GuardHookInput): Promise<SyncHookJSONOutput> {
      if (input.hook_event_name !== 'PostToolUse' || !policy().editDiagnostics || !deps.editDiagnostics) return CONTINUE;
      const file = editTarget(input.tool_name, input.tool_input);
      const report = file && input.tool_use_id ? await deps.editDiagnostics.after(input.tool_use_id, file) : undefined;
      if (!report) return CONTINUE;
      deps.log(`[EditDiagnostics] ${report.split('\n')[0]}`);
      const count = /(\d+) (?:new )?error\(s\)/.exec(report)?.[1];
      return { continue: true, hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: mark('edit-errors', report, count) } };
    },

    /** A success clears the failure streak and is evidence for the claim check. */
    async postToolUseRecord(input: GuardHookInput): Promise<SyncHookJSONOutput> {
      if (input.hook_event_name !== 'PostToolUse' || !input.tool_name) return CONTINUE;
      const sessionId = sid(input);
      repeat.recordSuccess(sessionId, input.tool_name, input.tool_input);
      repeat.recordRepeat({ sessionId, agentId: input.agent_id, promptId: input.prompt_id }, input.tool_name, input.tool_input);
      gate.recordCall(sessionId, input.tool_name, input.tool_input, true);
      return CONTINUE;
    },

    /** The same step with the same result, over and over, is a loop even when every step succeeds. */
    async postToolUseLoop(input: GuardHookInput): Promise<SyncHookJSONOutput> {
      if (input.hook_event_name !== 'PostToolUse' || !input.tool_name) return CONTINUE;
      const raw = input.tool_response;
      const outcome = toolResponseText(raw) || inputKey(raw);
      const p = policy();
      const verdict = loop.record(sid(input), p.loop, input.tool_name, input.tool_input, outcome, input.agent_id);
      return guardOutput('PostToolUse', input.tool_name, verdict, stepBudget(input, p));
    },

    /**
     * One more model turn -- parallel calls count once, as the SDK's
     * `maxTurns` counts model turns -- and past the policy's cap, end the turn
     * (hosts without `maxTurns`).
     */
    countStep(input: GuardHookInput): SyncHookJSONOutput {
      const cap = deps.stepCap ? policy().stepCap : undefined;
      if (!cap) return CONTINUE;
      const id = sid(input);
      const state = steps.get(id) ?? { count: 0, awaitingResult: false };
      steps.set(id, state);
      if (state.awaitingResult) return CONTINUE;
      state.count += 1;
      state.awaitingResult = true;
      if (state.count <= cap) return CONTINUE;
      const message = stepCapMessage(state.count, alphaOn());
      deps.log(`[StepCap] stopped after ${state.count} steps`);
      deps.onStop(message);
      return { continue: false, stopReason: message };
    },

    /**
     * One hook input from any host (the CLI's HTTP hooks): the methods above in
     * the SDK's order, merged. A deny or a stop wins; additional context joins.
     */
    async handle(input: GuardHookInput): Promise<SyncHookJSONOutput> {
      // The terminal at `off` with Alpha off runs nothing, as before Alpha.
      if (deps.level() === 'off' && !alphaOn()) return CONTINUE;
      switch (input.hook_event_name) {
        case 'PreToolUse':
          return merge('PreToolUse', [await hooks.preEdit(input), await hooks.preToolUse(input), hooks.countStep(input)]);
        case 'UserPromptSubmit':
          return hooks.userPromptSubmit(input);
        case 'SessionStart':
          return hooks.sessionStart(input);
        case 'Stop':
          return hooks.stop(input);
        case 'PostToolUseFailure':
          resultArrived(input);
          return hooks.postToolUseFailure(input);
        case 'PostToolUse':
          resultArrived(input);
          return merge('PostToolUse', [
            await hooks.postEdit(input),
            await hooks.postToolUseRecord(input),
            await hooks.postToolUseLoop(input),
          ]);
        default:
          return CONTINUE;
      }
    },
  };
  return hooks;
}

export type GuardHooks = ReturnType<typeof createGuardHooks>;

/** Several hook outputs for one event as one: the first stop or deny wins, context is joined. */
export function merge(event: string, outputs: SyncHookJSONOutput[]): SyncHookJSONOutput {
  const stop = outputs.find((o) => o.continue === false);
  const specific = outputs.map((o) => o.hookSpecificOutput as Record<string, unknown> | undefined).filter(Boolean) as Record<string, unknown>[];
  const deny = specific.find((s) => s.permissionDecision === 'deny');
  const context = specific.map((s) => s.additionalContext).filter((c): c is string => typeof c === 'string' && !!c);
  const out: SyncHookJSONOutput = stop ? { continue: false, stopReason: stop.stopReason } : { continue: true };
  if (deny) {
    out.hookSpecificOutput = deny as SyncHookJSONOutput['hookSpecificOutput'];
  } else if (context.length) {
    out.hookSpecificOutput = { hookEventName: event, additionalContext: context.join('\n\n') } as SyncHookJSONOutput['hookSpecificOutput'];
  }
  return out;
}
