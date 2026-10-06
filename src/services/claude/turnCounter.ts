/**
 * The host's own step count per channel (48b), for a conversation that is
 * already running when Alpha mode goes on.
 *
 * The SDK's `maxTurns` is fixed at launch, and Alpha must not relaunch a
 * running conversation (that kills its background shells and subagents and
 * empties the CLI's session flag layer). So the host counts model turns itself
 * -- root assistant messages that carry a `tool_use`, the unit `maxTurns`
 * counts (`loopGuard.ts`), so parallel calls in one message count once -- and
 * interrupts past the cap. In a process launched with `maxTurns` it only
 * counts, for the wrap-up nudge: never both caps at once.
 */
import { STRICT_MAX_TURNS } from '../../forge-sdk/guards/loopGuard';

export interface TurnCount {
  /** Model turns since the user last spoke. */
  turns: number;
  /** The `maxTurns` this process was launched with, if any. */
  launchMaxTurns?: number;
  /** Already interrupted this turn. */
  capped?: boolean;
}

/** A root assistant message with at least one tool call: one model turn. */
export function isModelTurn(message: unknown): boolean {
  const m = message as { type?: string; parent_tool_use_id?: unknown; message?: { content?: unknown } };
  if (m?.type !== 'assistant' || m.parent_tool_use_id) return false;
  const content = m.message?.content;
  return Array.isArray(content) && content.some((b) => (b as { type?: string })?.type === 'tool_use');
}

/** The user spoke: a new turn. */
export function resetTurns(count: TurnCount): void {
  count.turns = 0;
  count.capped = false;
}

/**
 * Count one SDK message. Returns true when the host should interrupt now:
 * Alpha is on, the process has no `maxTurns` of its own, and this is the
 * model turn past the cap (the 61st).
 */
export function countTurn(count: TurnCount, message: unknown, alpha: boolean, cap = STRICT_MAX_TURNS): boolean {
  if (!isModelTurn(message)) return false;
  count.turns += 1;
  if (!alpha || count.launchMaxTurns || count.capped || count.turns <= cap) return false;
  count.capped = true;
  return true;
}
