/**
 * Loop guard: notice when the model is going round in circles, tell it once,
 * and stop the turn if it keeps going.
 *
 * The repeat guard (`repeatGuard.ts`) only sees *failures*. The loops that
 * waste an afternoon with a small model are usually successes that change
 * nothing: the same file read again, the same test run with no edit in
 * between, an edit and a build alternating with the same error each time.
 * None of those fail, so none of them ever reach the repeat guard.
 *
 * Detection, from Gemini CLI's `loopDetectionService.ts` `checkToolCallLoop`:
 * a cycle of 1 to 5 steps repeated N times in a row. A step here is the tool,
 * its input *and a hash of its result*, which is stricter than Gemini's
 * name-and-arguments key and is what OpenHands' `StuckDetector` compares: a
 * poll that returns something new each time is progress, not a loop, and must
 * not be flagged.
 *
 * Response, from Gemini CLI's `_recoverFromLoop` and Roo Code / OpenCode:
 *
 *   strike 1   the model is told, in the tool result's context, what it is
 *              repeating and to change approach (Gemini's feedback text);
 *   strike 2   the turn is stopped and the user is told, because a model that
 *              loops again after being warned will not stop on its own. Roo
 *              Code pauses for the user at this point, and OpenCode raises its
 *              `doom_loop` permission prompt.
 *
 * Everything resets when the user sends a message: the turn is theirs again.
 */
import { createHash } from 'node:crypto';
import type { GuardLevel } from '../endpoints/profile';
import { inputKey } from './repeatGuard';

export interface LoopThresholds {
  /** How many times a cycle must repeat back to back to count as a loop. */
  repeats: number;
}

/** Longest cycle checked, in steps. Gemini CLI checks 1 to 5. */
export const MAX_CYCLE = 5;

/**
 * `strict` flags a loop at 3 repeats: three identical steps with identical
 * results in a row, which Roo Code (`consecutiveMistakeLimit` 3) and OpenCode
 * (`DOOM_LOOP_THRESHOLD` 3) also treat as stuck. `standard` uses Gemini CLI's
 * 5, which is loose enough for Claude never to trip it doing real work.
 */
export function thresholdsFor(level: GuardLevel): LoopThresholds | undefined {
  switch (level) {
    case 'strict': return { repeats: 3 };
    case 'standard': return { repeats: 5 };
    default: return undefined;
  }
}

/**
 * Input fields that are commentary, not the call: a Bash command re-run with a
 * reworded `description` is the same command.
 */
const VOLATILE_INPUT_KEYS = new Set(['description', 'intent', 'reason', 'explanation']);

export type LoopVerdict =
  | { action: 'none' }
  | { action: 'nudge'; message: string; detail: string }
  | { action: 'stop'; message: string; detail: string };

interface Step {
  key: string;
  tool: string;
}

interface SessionState {
  steps: Step[];
  strikes: number;
}

/** Most sessions tracked at once; the oldest is dropped past this. */
const MAX_SESSIONS = 64;

export class LoopGuard {
  private readonly sessions = new Map<string, SessionState>();

  /** The user has spoken: whatever came before is not this turn's loop. */
  beginTurn(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Record one finished tool call and decide what to do about it.
   *
   * @param outcome the tool's result text, or its error. Hashed, not stored.
   */
  record(
    sessionId: string,
    level: GuardLevel,
    tool: string,
    input: unknown,
    outcome: string,
  ): LoopVerdict {
    const thresholds = thresholdsFor(level);
    if (!thresholds) return { action: 'none' };

    const state = this.stateFor(sessionId);
    state.steps.push({ key: stepKey(tool, input, outcome), tool });
    const keep = MAX_CYCLE * thresholds.repeats;
    if (state.steps.length > keep) state.steps.splice(0, state.steps.length - keep);

    const cycle = findCycle(state.steps, thresholds.repeats);
    if (!cycle) return { action: 'none' };

    // Start counting afresh: after a warning the model deserves a full cycle's
    // worth of new evidence before it is judged again.
    state.steps = [];
    state.strikes += 1;
    const detail = describeCycle(cycle, thresholds.repeats);
    if (state.strikes === 1) {
      return {
        action: 'nudge',
        detail,
        message:
          `Potential loop detected: ${detail}. Take a step back and check whether you are making ` +
          `progress. If you are not, look at what the previous attempts returned and change your ` +
          `approach — do not repeat the same tool calls without new results. If you are blocked, ` +
          `stop and tell the user what is blocking you.`,
      };
    }
    return {
      action: 'stop',
      detail,
      message:
        `Forge stopped this turn: the model kept repeating ${detail} after being warned. ` +
        `Tell it what to do differently, or ask it to explain what is blocking it.`,
    };
  }

  /** Test seam. */
  strikesFor(sessionId: string): number {
    return this.sessions.get(sessionId)?.strikes ?? 0;
  }

  private stateFor(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = { steps: [], strikes: 0 };
      this.sessions.set(sessionId, state);
      while (this.sessions.size > MAX_SESSIONS) {
        const oldest = this.sessions.keys().next();
        if (oldest.done) break;
        this.sessions.delete(oldest.value);
      }
    }
    return state;
  }
}

/** Tool, input without commentary fields, and a hash of the result. */
export function stepKey(tool: string, input: unknown, outcome: string): string {
  const stripped = input && typeof input === 'object' && !Array.isArray(input)
    ? Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([k]) => !VOLATILE_INPUT_KEYS.has(k)))
    : input;
  const outcomeHash = createHash('sha256').update(outcome).digest('hex').slice(0, 16);
  return `${tool}\u0000${inputKey(stripped)}\u0000${outcomeHash}`;
}

/**
 * The shortest cycle of 1..MAX_CYCLE steps that the history ends with,
 * repeated `repeats` times back to back, or undefined.
 */
export function findCycle(steps: readonly Step[], repeats: number): Step[] | undefined {
  const n = steps.length;
  for (let k = 1; k <= MAX_CYCLE; k++) {
    const needed = k * repeats;
    if (n < needed) break;
    const cycle = steps.slice(n - k);
    let matches = true;
    for (let i = 0; i < needed && matches; i++) {
      matches = steps[n - needed + i].key === cycle[i % k].key;
    }
    if (matches) return cycle;
  }
  return undefined;
}

function describeCycle(cycle: readonly Step[], repeats: number): string {
  if (cycle.length === 1) {
    return `the same ${cycle[0].tool} call ${repeats} times in a row, with the same result each time`;
  }
  return `the same ${cycle.length}-step cycle (${cycle.map((s) => s.tool).join(' → ')}) ` +
    `${repeats} times in a row, with the same results each time`;
}

/** The guard the extension host uses. */
export const loopGuard = new LoopGuard();
