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
import { loopGuard as defaultLoopGuard, thresholdsFor, type LoopGuard, type LoopVerdict } from './loopGuard';
import { inputKey, repeatGuard as defaultRepeatGuard, type RepeatGuard } from './repeatGuard';
import { toolResponseText } from './smartStream';
import { stopGate as defaultStopGate, type StopGate } from './stopGate';

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
  log(line: string): void;
  /** Told when a guard ends the turn, to show the user why. */
  onStop(message: string): void;
  /** Errors an edit introduced; `strict` only. Absent: the check is skipped. */
  editDiagnostics?: EditDiagnostics;
  /**
   * Count steps per user message and stop past the level's `maxTurns`. For
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

export function stepCapMessage(steps: number): string {
  return (
    `Forge stopped this turn at its step limit (${steps} steps) so a small model cannot run forever. ` +
    `Ask it to summarise what is done and what is left, or say "continue" to give it another round.`
  );
}

export function createGuardHooks(deps: GuardHookDeps) {
  const loop = deps.state?.loop ?? defaultLoopGuard;
  const repeat = deps.state?.repeat ?? defaultRepeatGuard;
  const hints = deps.state?.hints ?? defaultFailureHints;
  const gate = deps.state?.gate ?? defaultStopGate;
  /** Steps taken since the user last spoke, per session (terminal only). */
  const steps = new Map<string, number>();
  const sid = (input: GuardHookInput) => input.session_id ?? 'default';

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
    const context = [extraNudge, verdict.action === 'nudge' ? verdict.message : undefined].filter(Boolean).join('\n\n');
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
    /** PreToolUse on an edit, `strict`: snapshot the file's errors before it changes. */
    async preEdit(input: GuardHookInput): Promise<SyncHookJSONOutput> {
      if (input.hook_event_name !== 'PreToolUse' || deps.level() !== 'strict' || !deps.editDiagnostics) return CONTINUE;
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
      const loopVerdict = loop.record(sid(input), deps.level(), input.tool_name, input.tool_input, `refused:${verdict.tier}`);
      if (loopVerdict.action !== 'none') deps.log(`[LoopGuard] ${loopVerdict.action} after refused ${input.tool_name}: ${loopVerdict.detail}`);
      const deny = {
        hookEventName: 'PreToolUse' as const,
        permissionDecision: 'deny' as const,
        permissionDecisionReason:
          loopVerdict.action === 'none' ? verdict.reason : `${verdict.reason}\n\n${loopVerdict.message}`,
      };
      if (loopVerdict.action === 'stop') {
        deps.onStop(loopVerdict.message);
        return { continue: false, stopReason: loopVerdict.message, hookSpecificOutput: deny };
      }
      return { continue: true, hookSpecificOutput: deny };
    },

    /** The user has spoken: counts for the previous turn no longer apply. A 'system' continuation is the same turn. */
    async userPromptSubmit(input: GuardHookInput): Promise<SyncHookJSONOutput> {
      if (input.hook_event_name === 'UserPromptSubmit' && input.source !== 'system') {
        loop.beginTurn(sid(input));
        hints.beginTurn(sid(input));
        gate.beginTurn(sid(input));
        steps.delete(sid(input));
      }
      return CONTINUE;
    },

    /** The last check before the model may finish: an unbacked claim or an empty answer goes back once. */
    async stop(input: GuardHookInput): Promise<SyncHookJSONOutput> {
      if (input.hook_event_name !== 'Stop') return CONTINUE;
      const feedback = gate.onStop(sid(input), deps.level(), input.last_assistant_message, input.stop_hook_active ?? false);
      if (!feedback) return CONTINUE;
      deps.log(`[StopGate] sent back before stopping: ${feedback.split('\n')[0]}`);
      return { continue: true, hookSpecificOutput: { hookEventName: 'Stop', additionalContext: feedback } };
    },

    /** A failed tool: what the repeat guard counts, a hint for the fix, and a step for the loop guard. */
    async postToolUseFailure(input: GuardHookInput): Promise<SyncHookJSONOutput> {
      if (input.hook_event_name !== 'PostToolUseFailure' || !input.tool_name) return CONTINUE;
      // An interrupt is the user stopping the turn, not the model failing to adapt.
      if (input.is_interrupt) return CONTINUE;
      const sessionId = sid(input);
      const error = String(input.error ?? '');
      const level = deps.level();
      gate.recordCall(sessionId, input.tool_name, input.tool_input, false);
      const nudge = repeat.recordFailure(sessionId, input.tool_name, input.tool_input, error);
      const hint = level === 'off' ? undefined : hints.hintFor(sessionId, input.tool_name, input.tool_input, error, input.cwd);
      const verdict = loop.record(sessionId, level, input.tool_name, input.tool_input, `error:${error}`);
      const extra = [hint, nudge].filter(Boolean).join('\n\n') || undefined;
      return guardOutput('PostToolUseFailure', input.tool_name, verdict, extra);
    },

    /** PostToolUse on an edit, `strict`: the errors the edit introduced, from the language servers. */
    async postEdit(input: GuardHookInput): Promise<SyncHookJSONOutput> {
      if (input.hook_event_name !== 'PostToolUse' || deps.level() !== 'strict' || !deps.editDiagnostics) return CONTINUE;
      const file = editTarget(input.tool_name, input.tool_input);
      const report = file && input.tool_use_id ? await deps.editDiagnostics.after(input.tool_use_id, file) : undefined;
      if (!report) return CONTINUE;
      deps.log(`[EditDiagnostics] ${report.split('\n')[0]}`);
      return { continue: true, hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: report } };
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
      const verdict = loop.record(sid(input), deps.level(), input.tool_name, input.tool_input, outcome);
      return guardOutput('PostToolUse', input.tool_name, verdict);
    },

    /**
     * One more step this turn -- every attempted call, refused ones included,
     * as the SDK's `maxTurns` counts -- and past the level's cap, end the turn
     * (hosts without `maxTurns`).
     */
    countStep(input: GuardHookInput): SyncHookJSONOutput {
      const cap = deps.stepCap ? thresholdsFor(deps.level())?.maxTurns : undefined;
      if (!cap) return CONTINUE;
      const n = (steps.get(sid(input)) ?? 0) + 1;
      steps.set(sid(input), n);
      if (n <= cap) return CONTINUE;
      const message = stepCapMessage(n);
      deps.log(`[StepCap] stopped after ${n} steps`);
      deps.onStop(message);
      return { continue: false, stopReason: message };
    },

    /**
     * One hook input from any host (the CLI's HTTP hooks): the methods above in
     * the SDK's order, merged. A deny or a stop wins; additional context joins.
     */
    async handle(input: GuardHookInput): Promise<SyncHookJSONOutput> {
      if (deps.level() === 'off') return CONTINUE;
      switch (input.hook_event_name) {
        case 'PreToolUse':
          return merge('PreToolUse', [await hooks.preEdit(input), await hooks.preToolUse(input), hooks.countStep(input)]);
        case 'UserPromptSubmit':
          return hooks.userPromptSubmit(input);
        case 'Stop':
          return hooks.stop(input);
        case 'PostToolUseFailure':
          return hooks.postToolUseFailure(input);
        case 'PostToolUse':
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
