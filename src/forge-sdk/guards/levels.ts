/**
 * How hard the small-model guards work, per endpoint profile (`guards`).
 * `strict` for weak models, `standard` for strong ones, `off` for none.
 */
export type GuardLevel = "strict" | "standard" | "off";
export const GUARD_LEVELS: readonly GuardLevel[] = ["strict", "standard", "off"];

/**
 * The level a profile runs at: its own `guards`, else `strict` for an
 * OpenAI-wire endpoint (the small, self-hosted models the guards exist for)
 * and `standard` for anything else.
 */
export function resolveGuardLevel(profile: { guards?: GuardLevel; wire?: string } | undefined): GuardLevel {
  return profile?.guards ?? (profile?.wire === "openai" ? "strict" : "standard");
}
