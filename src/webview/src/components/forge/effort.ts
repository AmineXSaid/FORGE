/**
 * Effort levels, taken verbatim from the real Claude Code webview bundle.
 *
 * The label is what the model menu, the command menu and the model pill display,
 * copied rather than invented so the scale reads identically to the official
 * extension -- "Extra high", not "xhigh" or "very high".
 *
 * Ultracode sits past Max, as the official slider's final notch does.
 */

/** level -> the label shown to the user. */
export const EFFORT_LABEL: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
  ultracode: 'Ultracode',
};

/** The scale in order, for cycling through it. */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'] as const;

export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** The level past Max, drawn in its own colour and animated wherever it shows. */
export const ULTRACODE = 'ultracode';

/**
 * The class that tints a level's name by its heat: orange at Extra high, red at
 * Max, and Ultracode's animated violet-and-pink. Everyday levels stay untinted.
 */
export function effortToneClass(level: string | undefined): string | undefined {
  if (level === ULTRACODE) return 'fg-ultracode-text';
  if (level === 'max') return 'fg-effort--max';
  if (level === 'xhigh') return 'fg-effort--xhigh';
  return undefined;
}

/**
 * Label for a level. Anything unrecognised reads "Auto", which is what the
 * official build falls back to when no level has been chosen yet.
 */
export function effortLabel(level: string | undefined): string {
  return level ? EFFORT_LABEL[level] ?? 'Auto' : 'Auto';
}

/**
 * Map the SDK's thinking level onto the effort scale.
 *
 * The SDK only distinguishes off from on, so `default_on` sits at the middle of
 * the scale and `off` has no effort at all.
 */
export function levelFromThinking(thinkingLevel: string | undefined): string | undefined {
  if (!thinkingLevel || thinkingLevel === 'off') return undefined;
  if (thinkingLevel === 'default_on') return 'medium';
  return thinkingLevel;
}
