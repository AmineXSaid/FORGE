/**
 * The model list the webview gates its UI on, when a profile is active.
 *
 * `Session.ts` already derives every gate from one place -- `currentModelInfo`,
 * which comes from `sdk_probe {capabilities:["supportedModels"]}`:
 *
 *     currentModelSupportsEffort   <- currentModelInfo()?.supportsEffort
 *     currentModelSupportsFastMode <- currentModelInfo()?.supportsFastMode
 *     isUltracodeAvailable(...)    <- currentModelInfo()?.supportedEffortLevels
 *
 * So the gating mechanism already exists and needs no change. It only needs a
 * different *source* when the CLI is pointed at someone else's gateway, where
 * the CLI's built-in table describes models that are not being served.
 *
 * Field names here are therefore exactly the SDK's `ModelInfo` (sdk.d.ts:1313),
 * not a parallel shape -- the whole point is that `Session.ts` cannot tell the
 * difference.
 */
import type { Capabilities, EndpointProfile } from './profile';

/**
 * One model a profile serves.
 *
 * Only `id` is required: a profile that lists bare ids still gets a working
 * picker showing real model names, which is the minimum this exists for.
 */
export interface ProfileModel {
  id: string;
  displayName?: string;
  description?: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
  supportsFastMode?: boolean;
  contextWindow?: number;
  /** Greyed out in the picker rather than hidden, as the official does. */
  unavailable?: boolean;
}

/** The SDK's `ModelInfo`, which is what the webview reads. */
/**
 * The effort levels the CLI and the webview know how to render.
 *
 * A profile's `capabilities.effortLevels` is free-form in the schema -- it is
 * whatever the gateway says it honours -- so a level outside this set has no
 * slider position to occupy and no meaning to the effort control. Narrowing
 * here keeps an invented level from reaching a row the UI gates on.
 */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type SdkEffortLevel = (typeof EFFORT_LEVELS)[number];

export function isEffortLevel(value: string): value is SdkEffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(value);
}

export interface SdkModelRow {
  value: string;
  displayName: string;
  description: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: SdkEffortLevel[];
  supportsFastMode?: boolean;
  supportsAutoMode?: boolean;
  unavailable?: boolean;
}

/**
 * Translate a profile's models into rows the webview can gate on.
 *
 * **Gating is the intersection** of what the model entry claims and what the
 * endpoint was measured to do. A model entry saying `supportsEffort: true`
 * against a profile whose probes found the gateway ignores `reasoning_effort`
 * yields a greyed row, not a working one: the entry is a claim, the capability
 * block is evidence, and evidence wins. The reverse also holds -- an endpoint
 * that honours effort does not make a model that has none grow one.
 *
 * This is B4 at the model level: a row appears only when its backend works.
 */
export function profileModelRows(profile: EndpointProfile): SdkModelRow[] {
  const caps = profile.capabilities;
  const declared = profile.models?.length
    ? profile.models
    // A profile with no `models` block still serves the one model it names, and
    // showing that beats showing the CLI's Claude tiers, which are not served
    // here at all.
    : [{ id: profile.model }];

  return declared.map((model) => toRow(model, caps, profile));
}

function toRow(model: ProfileModel, caps: Capabilities, profile: EndpointProfile): SdkModelRow {
  // The intersection. `?? caps.effort` rather than `?? false`: a profile that
  // declares endpoint-wide effort support and lists models without repeating it
  // means those models inherit it, which is the common single-model case.
  const effort = (model.supportsEffort ?? caps.effort) && caps.effort;

  // Levels intersect too, so a model claiming xhigh against an endpoint that
  // only honours up to high cannot offer Ultracode.
  const levels = (model.supportedEffortLevels ?? caps.effortLevels)
    .filter((level) => caps.effortLevels.includes(level))
    // A level the effort control cannot render is a slider notch that does
    // nothing, so it is dropped rather than offered.
    .filter(isEffortLevel);

  return {
    value: model.id,
    // Real model names, not Claude tier labels -- the picker is describing what
    // this gateway serves.
    displayName: model.displayName ?? model.id,
    description: model.description
      ?? [
        profile.description ?? `Served by ${profile.name}`,
        model.contextWindow ? `${model.contextWindow.toLocaleString()} token context` : '',
      ].filter(Boolean).join(' · '),
    supportsEffort: effort,
    supportedEffortLevels: effort ? levels : [],
    supportsFastMode: (model.supportsFastMode ?? caps.fastMode) && caps.fastMode,
    // Auto mode is an Anthropic-side routing feature with no equivalent on a
    // private gateway. Reported false rather than left undefined, because
    // `Session.ts` treats undefined as "unknown" and keeps the row waiting.
    supportsAutoMode: false,
    ...(model.unavailable ? { unavailable: true } : {}),
  };
}

/**
 * The context window to report for a model, for the transcript's meter.
 *
 * Falls back to the endpoint-wide capability, which is the value compaction and
 * output filtering already key off.
 */
export function contextWindowFor(profile: EndpointProfile, modelId: string | undefined): number {
  const model = profile.models?.find((m) => m.id === modelId);
  return model?.contextWindow ?? profile.capabilities.contextWindow;
}
