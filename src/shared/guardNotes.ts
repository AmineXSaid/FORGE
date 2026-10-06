/**
 * The one-line notes the chat shows when a guard sends the model back (48b).
 *
 * AlphaCode shows each automatic follow-up as a one-line system notice and
 * hides the model-facing text, live and on reload (`auto_poke_display_summary`,
 * `todo.rs`; `session/render.rs`). Forge does the same: every guard message
 * to the model starts with a stable marker, `[Forge check: <kind> — not a user
 * message]`, the host tells the chat which kind fired, and the session loader
 * finds the same marker in the transcript's `hook_additional_context`.
 *
 * Shared by the host (marker, kinds) and the webview (the one-line text), so
 * the two can never disagree on a kind.
 */

export type GuardNoteKind = 'claim' | 'empty-answer' | 'loop' | 'read-only' | 'edit-errors' | 'step-budget';

export const GUARD_NOTE_KINDS: readonly GuardNoteKind[] = ['claim', 'empty-answer', 'loop', 'read-only', 'edit-errors', 'step-budget'];

export function isGuardNoteKind(value: unknown): value is GuardNoteKind {
  return typeof value === 'string' && (GUARD_NOTE_KINDS as readonly string[]).includes(value);
}

/** The prefix every guard send-back carries, so the model reads it as Forge's, not the user's. */
export function guardMarker(kind: GuardNoteKind): string {
  return `[Forge check: ${kind} — not a user message]`;
}

/** Every marker in a text, in order: one hook result can carry several. */
export function guardMarkersIn(text: string): GuardNoteKind[] {
  const kinds: GuardNoteKind[] = [];
  for (const m of text.matchAll(/\[Forge check: ([a-z-]+) — not a user message\]/g)) {
    if (isGuardNoteKind(m[1])) kinds.push(m[1]);
  }
  return kinds;
}

/**
 * The user-facing line for a note. `detail` is a count where one is known
 * (errors an edit introduced, steps left).
 */
export function guardNoteText(kind: GuardNoteKind, detail?: string): string {
  switch (kind) {
    case 'claim':
      return 'Checking the summary against what was actually done…';
    case 'empty-answer':
      return 'The reply was empty; asked for the final answer…';
    case 'loop':
      return 'Same steps repeating; asked to change approach…';
    case 'read-only':
      return 'Many reads without a change; asked to act or say what is missing…';
    case 'edit-errors':
      return `The last edit introduced ${detail && /^\d+$/.test(detail) ? detail : 'new'} error(s); sent back to fix them…`;
    case 'step-budget':
      return `${detail && /^\d+$/.test(detail) ? detail : 'Few'} steps left this turn; asked to wrap up…`;
  }
}
