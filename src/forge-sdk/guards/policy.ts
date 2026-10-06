/**
 * What the guards do, from two inputs: the endpoint profile's guard level and
 * the user's Alpha mode switch (`docs/backend-wiring/48-alpha-mode.md`, 48b).
 *
 * One table, read by every guard, so "Alpha off" provably equals what each
 * level did before Alpha existed (`test/guardPolicy.spec.ts` asserts the whole
 * level x alpha matrix).
 *
 *   strict            every check, small-model thresholds, the 60-step cap and
 *                     the small-model rules. Alpha adds only its rules.
 *   standard          hints, empty-answer nudge, a loose loop threshold (5).
 *   off               nothing.
 *   standard/off +    every check, with thresholds tuned for strong models: a
 *   Alpha             3-repeat cycle (its key includes the outcome, so a poll
 *                     with new output never trips it), a read-only reminder at
 *                     20 reads (Claude sends 4-6 reads per message exploring;
 *                     8 is a small-model value), and the 60-step cap.
 *
 * The repeat guard is not in the policy: the chat runs it at every level, and
 * the terminal hook server only when it runs at all.
 */
import type { GuardLevel } from './levels';
import { STRICT_MAX_TURNS, thresholdsFor, type LoopThresholds } from './loopGuard';

export interface GuardPolicy {
  /** Failure hints on a failed tool (`failureHints.ts`). */
  hints: boolean;
  /** "Give your final answer" after an empty reply (`stopGate.ts`). */
  emptyAnswer: boolean;
  /** Claims no tool call backs go back once a turn (`stopGate.ts`). */
  claimChallenge: boolean;
  /** Errors an edit introduced, from the language servers (`editDiagnostics.ts`). */
  editDiagnostics: boolean;
  /** The loop guard's thresholds, or undefined for no loop guard. */
  loop: LoopThresholds | undefined;
  /** Most model turns per user message, or undefined for no cap. */
  stepCap: number | undefined;
  /** `resources/endpoint-rules/_small-models.md` in the system prompt. */
  smallModelRules: boolean;
  /** `resources/endpoint-rules/_alpha.md`. */
  alphaRules: boolean;
}

/** Read-only calls in a row before the reminder, under Alpha on a non-strict profile. */
export const ALPHA_READ_ONLY_STREAK = 20;

/** Alpha's thresholds on a profile that is not `strict`. */
export const ALPHA_THRESHOLDS: LoopThresholds = {
  repeats: 3,
  readOnlyStreak: ALPHA_READ_ONLY_STREAK,
  maxTurns: STRICT_MAX_TURNS,
};

export function guardPolicy(level: GuardLevel, alpha: boolean): GuardPolicy {
  if (level === 'strict' || alpha) {
    const loop = level === 'strict' ? thresholdsFor('strict') : ALPHA_THRESHOLDS;
    return {
      hints: true,
      emptyAnswer: true,
      claimChallenge: true,
      editDiagnostics: true,
      loop,
      stepCap: loop?.maxTurns,
      smallModelRules: level === 'strict',
      alphaRules: alpha,
    };
  }
  const on = level === 'standard';
  return {
    hints: on,
    emptyAnswer: on,
    claimChallenge: false,
    editDiagnostics: false,
    loop: thresholdsFor(level),
    stepCap: undefined,
    smallModelRules: false,
    alphaRules: false,
  };
}
