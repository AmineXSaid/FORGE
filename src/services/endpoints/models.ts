/**
 * The model rows the webview picker shows when a profile is active.
 *
 * The picker reads the SDK's `ModelInfo` shape (`ClaudeConfig.models`), which
 * normally comes from the CLI's initialize response. That list describes
 * Anthropic's tiers, and when the CLI has been pointed at someone else's
 * gateway those tiers are not what is being served -- so the rows are built
 * from the profile instead, in the same shape, and the webview cannot tell the
 * difference.
 *
 * Field names here are therefore exactly the SDK's, not a parallel shape.
 */
import type { EndpointProfile, ProfileModel } from './profile';
import type { ListedModel } from './check';

/** The SDK's `ModelInfo`, as far as the picker reads it. */
export interface SdkModelRow {
  value: string;
  displayName: string;
  description: string;
  /**
   * Effort and fast mode are Anthropic-side features with no equivalent on a
   * private gateway, and this profile schema has no way to declare them. They
   * are reported `false` rather than left undefined, because the webview reads
   * undefined as "not known yet" and leaves the control waiting forever.
   */
  supportsEffort: boolean;
  supportsFastMode: boolean;
  supportsAutoMode: boolean;
  unavailable?: boolean;
}

/** How a row's `description` says the model answered. */
export function answeredIn(ms: number): string {
  return ms < 1000 ? `answered in ${ms}ms` : `answered in ${(ms / 1000).toFixed(1)}s`;
}

function describe(
  model: ProfileModel,
  profile: EndpointProfile,
  health: { ms: number } | undefined,
): string {
  if (model.description) return model.description;
  return [
    profile.description ?? `Served by ${profile.name}`,
    model.contextWindow ? `${model.contextWindow.toLocaleString()} token context` : '',
    health ? answeredIn(health.ms) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Translate a profile's models into picker rows.
 *
 * @param models the ids to build rows for, already filtered by health. Passed
 *   in rather than read off the profile so the one place that decides what is
 *   offered stays the one place that decides it.
 * @param pings round-trips by id, when a sweep has measured them. A row that
 *   can say how fast the model answered is a row the user can choose between.
 */
export function profileModelRows(
  profile: EndpointProfile,
  models: readonly string[],
  pings: ReadonlyMap<string, number> = new Map(),
): SdkModelRow[] {
  const declared = new Map((profile.models ?? []).map((m) => [m.id, m]));
  return models.map((id) => {
    const model = declared.get(id) ?? { id };
    const ms = pings.get(id);
    return {
      value: id,
      // Real model names, not Claude tier labels: the picker is describing what
      // this gateway serves.
      displayName: model.displayName ?? id,
      description: describe(model, profile, ms === undefined ? undefined : { ms }),
      supportsEffort: false,
      supportsFastMode: false,
      supportsAutoMode: false,
      ...(model.unavailable ? { unavailable: true } : {}),
    };
  });
}

/**
 * The ids a profile offers before health is applied.
 *
 * A declared `models` block wins. Otherwise the gateway's listing, and failing
 * that the single `model` the profile names, which every profile has.
 */
export function candidateIds(
  profile: EndpointProfile,
  listed: readonly ListedModel[],
): { ids: string[]; source: 'declared' | 'listing' } {
  if (profile.models?.length) {
    return { ids: profile.models.map((m) => m.id), source: 'declared' };
  }
  if (listed.length) return { ids: listed.map((m) => m.id), source: 'listing' };
  return { ids: [profile.model], source: 'declared' };
}

/**
 * The context window to report for a model.
 *
 * Falls back to the endpoint-wide capability, which is the value the rest of
 * the pipeline already keys off.
 */
export function contextWindowFor(profile: EndpointProfile, modelId: string | undefined): number {
  const model = profile.models?.find((m) => m.id === modelId);
  return model?.contextWindow ?? profile.capabilities.contextWindow;
}
