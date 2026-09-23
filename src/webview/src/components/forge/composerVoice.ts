/**
 * What the composer says before you type, in Forge's voice.
 *
 * A deliberate departure from the official copy, at the user's request
 * (2026-09-19): the official reads "Ask Claude to edit…", then "ctrl esc to
 * focus or unfocus Claude", and "Queue another message…" while a turn runs.
 * Forge keeps the same three states and the same shortcut hint, and words them
 * as a forge. See docs/forge-design.md.
 */

/** Before the first-run hint is dismissed: the official "Ask … to edit…". */
export const FIRST_RUN_PLACEHOLDER = 'What shall we forge today?';

/** While a turn runs: the official "Queue another message…". */
export const WORKING_PLACEHOLDER = 'The iron’s hot. Queue another message…';

/** The rest of the time, one of these, then the focus shortcut. */
export const IDLE_LINES: readonly string[] = [
  'What shall we forge next?',
  'Strike while the iron’s hot…',
  'Bring a spark: a bug, an idea, a feature…',
  'Hammer out a plan, a fix, a feature…',
];

/** A stable pick for one composer: the same line until the composer is rebuilt. */
export function pickIdleLine(random: number = Math.random()): string {
  const index = Math.min(IDLE_LINES.length - 1, Math.max(0, Math.floor(random * IDLE_LINES.length)));
  return IDLE_LINES[index];
}

/**
 * The placeholder for a state. The shortcut hint the official shows after the
 * first run is kept, shortened so it survives a narrow sidebar.
 */
export function forgePlaceholder(state: { working: boolean; firstRun: boolean; mac: boolean; idleLine: string }): string {
  if (state.working) return WORKING_PLACEHOLDER;
  if (state.firstRun) return FIRST_RUN_PLACEHOLDER;
  const shortcut = state.mac ? '⌘ Esc' : 'ctrl esc';
  return `${state.idleLine} · ${shortcut} toggles focus`;
}
