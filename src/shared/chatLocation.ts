/**
 * Where the chat opens: the official `claudeCode.preferredLocation`.
 *
 * The official setting has two values, `"panel"` (a new editor tab) and
 * `"sidebar"` (the secondary side bar), and defaults to `"panel"`: Claude Code
 * opens its chat as an editor tab in a column of its own, beside your code
 * (`createPanel` → `findUnusedColumn`), and locks that column. VS Code gives a
 * new column half of the editor area, which is the size the chat opens at.
 *
 * Forge's setting had only the two side bars (`secondary`, `primary`), and
 * defaulted to the secondary one, which VS Code keeps narrow. `panel` is now
 * the default, as the official's is (the user, 2026-09-26: "Open as editor tab
 * a panel with the right size"); the side-bar values keep their meaning, so a
 * setting written before still does what it did.
 */
export type ChatLocation = 'panel' | 'secondary' | 'primary';

export const CHAT_LOCATIONS: readonly ChatLocation[] = ['panel', 'secondary', 'primary'];

export const DEFAULT_CHAT_LOCATION: ChatLocation = 'panel';

/** A setting value as the host should read it: anything unknown is the default. */
export function chatLocationFrom(value: unknown): ChatLocation {
    return (CHAT_LOCATIONS as readonly unknown[]).includes(value) ? (value as ChatLocation) : DEFAULT_CHAT_LOCATION;
}
