/**
 * Effort and thinking, translated for an OpenAI-compatible endpoint.
 *
 * The CLI's effort ladder is entirely client-side: it changes the system
 * prompt, the thinking budget and how workflows run, and it keeps doing all of
 * that against any endpoint. What it *also* does is put a top-level `effort` on
 * the request (`sdk.d.ts:1807`), which an OpenAI-shaped gateway will not
 * understand under that name.
 *
 * So this file does two things and deliberately not a third:
 *
 *   - renames `effort` to `reasoning_effort`, which is the OpenAI spelling;
 *   - keeps it inside what the endpoint actually honours, so a rung the gateway
 *     would reject or ignore is downgraded to the nearest one it takes;
 *   - does **not** try to make an endpoint reason that cannot. `effort: false`
 *     means the field is omitted entirely, and the UI hides the rows (B4).
 *
 * Ultracode needs nothing here. It is `xhigh` plus CLI-side workflows, so once
 * `xhigh` is in `effortLevels` it works by virtue of the rung existing.
 */
import type { Capabilities } from '../profile';

/** The ladder, weakest first. Order is what makes a downgrade meaningful. */
export const EFFORT_LADDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export type EffortLevel = typeof EFFORT_LADDER[number];

export interface ReasoningResult {
  /** The value to send as `reasoning_effort`, or undefined to omit it. */
  effort?: string;
  warnings: string[];
}

/**
 * Derive an effort level from a thinking budget.
 *
 * Used only when the request carries a thinking budget and no explicit effort:
 * most OpenAI-compatible endpoints have no token-budget knob at all, so the
 * budget has to be expressed as the nearest rung or it is lost entirely.
 *
 * The thresholds follow the CLI's own defaults closely enough to preserve the
 * user's intent, which is all that is available without a budget parameter.
 */
export function effortForBudget(budgetTokens: number): EffortLevel {
  if (budgetTokens <= 0) return 'low';
  if (budgetTokens <= 4_096) return 'low';
  if (budgetTokens <= 16_384) return 'medium';
  if (budgetTokens <= 32_768) return 'high';
  return 'xhigh';
}

/**
 * Pick the level to actually send.
 *
 * A level the endpoint does not list is downgraded to the strongest one below
 * it rather than dropped. Dropping would silently fall back to the endpoint's
 * default, which is usually weaker than every rung the user could have picked -
 * so asking for `xhigh` on a gateway that stops at `high` would produce *less*
 * reasoning than asking for `medium`, which is the wrong way round.
 */
export function resolveEffort(requested: string, supported: string[]): string | undefined {
  if (!supported.length) return undefined;
  if (supported.includes(requested)) return requested;

  const wantedRank = EFFORT_LADDER.indexOf(requested as EffortLevel);
  if (wantedRank === -1) {
    // An unknown name from a newer CLI. Send nothing rather than guess.
    return undefined;
  }

  // Strongest supported rung at or below what was asked for.
  const below = supported
    .filter((level) => {
      const rank = EFFORT_LADDER.indexOf(level as EffortLevel);
      return rank !== -1 && rank <= wantedRank;
    })
    .sort((a, b) => EFFORT_LADDER.indexOf(b as EffortLevel) - EFFORT_LADDER.indexOf(a as EffortLevel));

  if (below.length) return below[0];

  // Everything the endpoint offers is stronger than what was asked for; take
  // the weakest of those rather than nothing.
  return [...supported].sort(
    (a, b) => EFFORT_LADDER.indexOf(a as EffortLevel) - EFFORT_LADDER.indexOf(b as EffortLevel),
  )[0];
}

/**
 * Work out the `reasoning_effort` for one request.
 *
 * @param effort  the request's top-level `effort`, if the CLI sent one.
 * @param thinking the request's `thinking` block, if any.
 */
export function reasoningFor(
  effort: unknown,
  thinking: { type?: string; budget_tokens?: number } | undefined,
  caps: Capabilities,
): ReasoningResult {
  const warnings: string[] = [];

  // The profile says this endpoint has no reasoning knob. Sending the field
  // anyway is a 400 on some gateways and a no-op on the rest.
  if (!caps.effort) return { warnings };

  let requested: string | undefined;

  if (thinking?.type === 'disabled') {
    // Thinking explicitly off is a real instruction, not an absence: send the
    // weakest rung the endpoint offers rather than letting its default decide.
    // It wins over a named effort: `reasoning_effort` is an OpenAI endpoint's
    // only reasoning knob, and CLI 2.1.x names the effort on every request, so
    // otherwise the Thinking toggle would change nothing on the wire (B7).
    requested = caps.effortLevels.includes('minimal') ? 'minimal' : 'low';
  } else if (typeof effort === 'string') {
    requested = effort;
  } else if (typeof effort === 'number') {
    // The CLI can send an integer budget instead of a name.
    requested = effortForBudget(effort);
  } else if (thinking?.type === 'enabled' && typeof thinking.budget_tokens === 'number') {
    requested = effortForBudget(thinking.budget_tokens);
  }

  if (!requested) return { warnings };

  const resolved = resolveEffort(requested, caps.effortLevels);
  if (resolved && resolved !== requested) {
    warnings.push(
      `effort "${requested}" is not in capabilities.effortLevels ` +
      `[${caps.effortLevels.join(', ')}]; sent "${resolved}" instead`,
    );
  }
  if (!resolved) {
    warnings.push(`effort "${requested}" could not be mapped to this endpoint; omitted`);
  }

  return { effort: resolved, warnings };
}
