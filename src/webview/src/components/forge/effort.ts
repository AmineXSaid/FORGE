/**
 * Effort, ported from the real Claude Code webview bundle.
 *
 * The levels are the model's own (`ModelInfo.supportedEffortLevels`), never a
 * fixed list: Sonnet may stop at High while Opus goes to Max. Ultracode is not a
 * level. It is `xhigh` effort *plus* the session-scoped `ultracode` flag, offered
 * as one extra notch past the model's top level, and only where the model has
 * `xhigh` and workflows are not disabled.
 */
import type { ClaudeSettingsSnapshot } from '../../../../shared/messages';

/** `V25`: level -> the label shown to the user. */
export const EFFORT_LABEL: Readonly<Record<string, string>> = Object.freeze({
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
});

/** The official fallback when a model supports effort but lists no levels. */
export const DEFAULT_EFFORT_LEVELS: readonly string[] = Object.freeze(['low', 'medium', 'high']);

/** `Xq0`: what the pill says while Ultracode is on. */
export const ULTRACODE_LABEL = 'Ultracode';

/** `Io`: what the "/" Effort row's suffix says while Ultracode is on. */
export const ULTRACODE_DESCRIPTION = 'Ultracode - xhigh + workflows';

/** `kK`: a level's label. No level chosen yet, or an unknown one, reads "Auto". */
export function effortLabel(level: string | undefined): string {
  return level ? EFFORT_LABEL[level] ?? 'Auto' : 'Auto';
}

/**
 * `Xq0`: the effort beside the model name in the pill. Nothing at all for a
 * model without effort, and nothing until a level is known.
 */
export function pillEffortLabel(
  supportsEffort: boolean,
  level: string | undefined,
  ultracodeSelected: boolean
): string | undefined {
  if (!supportsEffort) return undefined;
  if (ultracodeSelected) return ULTRACODE_LABEL;
  return level === undefined ? undefined : effortLabel(level);
}

/** The "/" Effort row's suffix: `(K0 ? Io : kK(w0))`. */
export function effortRowSuffix(level: string | undefined, ultracodeSelected: boolean): string {
  return ultracodeSelected ? ULTRACODE_DESCRIPTION : effortLabel(level);
}

/** A step of the effort control: a level, or the Ultracode notch. */
export type EffortPick = { kind: 'level'; level: string } | { kind: 'ultracode' };

/**
 * Clicking the Effort row (not the slider) steps to the next notch, wrapping --
 * the official registry row and the mode menu's row compute it the same way:
 * `w2 = n.length + (H1 ? 1 : 0); b4 = ((K0 ? w2-1 : w0 ? n.indexOf(w0) : -1) + 1) % w2`.
 * From no level at all it starts at the lowest.
 */
export function nextEffortPick(
  levels: readonly string[],
  level: string | undefined,
  ultracodeAvailable: boolean,
  ultracodeSelected: boolean
): EffortPick {
  const notches = levels.length + (ultracodeAvailable ? 1 : 0);
  const at = ultracodeSelected ? notches - 1 : level ? levels.indexOf(level) : -1;
  const next = (at + 1) % notches;
  if (ultracodeAvailable && next === notches - 1) return { kind: 'ultracode' };
  return { kind: 'level', level: levels[next] };
}

/**
 * The official session's `ultracodeAvailable`: no settings read yet means no,
 * `disableWorkflows: true` means no, and otherwise the model must list `xhigh`.
 */
export function isUltracodeAvailable(
  claudeSettings: ClaudeSettingsSnapshot | undefined,
  supportedEffortLevels: readonly string[] | undefined
): boolean {
  if (!claudeSettings) return false;
  if (claudeSettings.effective.disableWorkflows === true) return false;
  return supportedEffortLevels?.includes('xhigh') ?? false;
}

/**
 * Everything the effort controls render from, computed once in the session and
 * handed to the pill, the model menu and the "/" menu alike.
 */
export interface EffortState {
  /** `ModelInfo.supportsEffort` for the current model; false hides every effort control. */
  supported: boolean;
  /** The chosen level, `undefined` until the CLI or the user has said. */
  level: string | undefined;
  /** The model's levels (`supportedEffortLevels ?? ["low","medium","high"]`). */
  levels: readonly string[];
  ultracodeAvailable: boolean;
  ultracodeSelected: boolean;
}

/** No effort control at all: the state for a model without effort. */
export const NO_EFFORT: EffortState = Object.freeze({
  supported: false,
  level: undefined,
  levels: DEFAULT_EFFORT_LEVELS,
  ultracodeAvailable: false,
  ultracodeSelected: false,
});

/**
 * Forge's brand heat on a level's name: orange at Extra high, red at Max, and
 * Ultracode's animated violet-and-pink. Everyday levels stay untinted. Colour
 * only -- the one intended difference from the official.
 */
export function effortToneClass(level: string | undefined, ultracodeSelected = false): string | undefined {
  if (ultracodeSelected) return 'fg-ultracode-text';
  if (level === 'max') return 'fg-effort--max';
  if (level === 'xhigh') return 'fg-effort--xhigh';
  return undefined;
}

/** One capability chip on a model row (Forge's model menu, not the official's). */
export interface ModelCapability {
  id: 'max' | 'ultracode' | 'fast';
  label: string;
  title: string;
}

/**
 * The capability chips on a model row: Max when the CLI lists `max` for it,
 * Ultracode when it would be offered (the official `ultracodeAvailable` rule),
 * Fast when the model supports fast mode. Only what the CLI reports -- a model
 * that does not list a level gets no chip for it.
 *
 * Forge-only, at the user's request (2026-09-19): it shows at a glance which
 * models offer Max and Ultracode. See docs/forge-design.md.
 */
export function modelCapabilities(
  row: { supportsEffort?: boolean; supportedEffortLevels?: readonly string[]; supportsFastMode?: boolean },
  claudeSettings: ClaudeSettingsSnapshot | undefined
): ModelCapability[] {
  const levels = row.supportsEffort ? row.supportedEffortLevels ?? DEFAULT_EFFORT_LEVELS : [];
  const chips: ModelCapability[] = [];
  if (levels.includes('max')) chips.push({ id: 'max', label: 'Max', title: 'Offers Max effort' });
  if (row.supportsEffort && isUltracodeAvailable(claudeSettings, levels)) {
    chips.push({ id: 'ultracode', label: 'Ultracode', title: 'Offers Ultracode' });
  }
  if (row.supportsFastMode) chips.push({ id: 'fast', label: 'Fast', title: 'Supports fast mode' });
  return chips;
}
