/**
 * "Open Forge in Terminal" is paused for now (the user's decision, 2026-09-28):
 * the terminal runs Anthropic's CLI, whose own welcome box Forge cannot remove,
 * so every way into it is shown greyed out with "(soon)" instead of opening it.
 *
 * One switch: set this to true and every entry point comes back -- the "/"
 * menu's "Open Forge in Terminal" and "Toggle fast mode" rows, the welcome
 * page's "Use the terminal", the empty chat's terminal card and its tip. The
 * host side (`open_claude_in_terminal`) is untouched and still works.
 */
export const TERMINAL_AVAILABLE = false;

/** What a paused entry point says after its label. */
export const SOON = 'soon';
