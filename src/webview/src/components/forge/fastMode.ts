/**
 * "Toggle fast mode", the official "/" row, copied from the registry:
 *
 *   if (!$.currentModelSupportsFastMode.value) { J.commandRegistry.unregisterAction("fast"); return }
 *   J.commandRegistry.registerAction({id:"fast", label:"Toggle fast mode",
 *     description:"Toggle fast mode for faster responses (Opus only)"}, "Model",
 *     () => { J.openClaudeInTerminal("/fast", [], "bottom") })
 *
 * The row exists only while the current model reports `supportsFastMode`
 * (`currentModelSupportsFastMode`, step 12). It has no `keepMenuOpen`, so the
 * menu closes, and it runs `claude /fast` in a terminal through step 09's
 * `open_claude_in_terminal`, whose validator accepts a bare slash command.
 */
import type { MenuCommand } from './CommandMenu.vue';

export const FAST_MODE_ROW: Readonly<MenuCommand> = Object.freeze({
  id: 'fast',
  label: 'Toggle fast mode',
  description: 'Toggle fast mode for faster responses (Opus only)',
  section: 'Model',
});

/** What the row sends: the official `openClaudeInTerminal("/fast", [], "bottom")`. */
export const FAST_MODE_LAUNCH = Object.freeze({
  prompt: '/fast',
  args: [] as string[],
  location: 'bottom' as const,
});

/** The row, when the current model supports fast mode; otherwise none (B4). */
export function fastModeRows(currentModelSupportsFastMode: boolean): MenuCommand[] {
  return currentModelSupportsFastMode ? [{ ...FAST_MODE_ROW }] : [];
}
