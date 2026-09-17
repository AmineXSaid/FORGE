/**
 * The command menu's "Slash Commands" section, ported from the official webview.
 *
 *   Y55  -- a command whose name is not unique is invoked by its namespaced alias
 *           (`plugin:name`) so the two stay distinguishable;
 *   qz0  -- each command registers as `slash-command-<invocation>`, labelled
 *           `/<invocation>`, in the "Slash Commands" section (sorted by label);
 *   X55 / Uz0 -- `usage` and `context` are special: the official runs
 *           `account-usage` and opens the context view for them instead of
 *           sending the command.
 *
 * Forge scope (CLAUDE.md): Account & usage and the context view are out of scope,
 * so those two rows are left out rather than wired to something else.
 */
import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import type { MenuCommand } from './CommandMenu.vue';

/**
 * The CLI's init `commands` entries. `aliases` is read by the official `Y55`
 * (`Z.aliases?.find(...)`) but is not in the installed SDK 0.1.77 typing, so it
 * stays optional and is used only when the CLI sends it.
 */
export type CliSlashCommand = SlashCommand & { aliases?: string[] };

export const SLASH_COMMAND_ID_PREFIX = 'slash-command-';

/** Official `X55`: rows whose action is not "send the command". */
const OUT_OF_SCOPE_INVOCATIONS = new Set(['usage', 'context']);

/** Official `Y55`: the name the command is invoked by. */
export function slashCommandInvocations(commands: readonly CliSlashCommand[]): Array<{ cmd: CliSlashCommand; invocation: string }> {
  const counts = new Map<string, number>();
  for (const cmd of commands) counts.set(cmd.name, (counts.get(cmd.name) ?? 0) + 1);
  return commands.map((cmd) => {
    const alias = cmd.aliases?.find((a) => a.endsWith(`:${cmd.name}`));
    const duplicated = (counts.get(cmd.name) ?? 0) > 1;
    return { cmd, invocation: duplicated && alias ? alias : cmd.name };
  });
}

/** Official `qz0` rows, minus the out-of-scope `usage` / `context`. */
export function slashCommandRows(
  commands: readonly CliSlashCommand[] | undefined,
  describe: (text: string) => string = (text) => text,
): MenuCommand[] {
  if (!Array.isArray(commands)) return [];
  return slashCommandInvocations(commands.filter((c) => typeof c?.name === 'string' && c.name.length > 0))
    .filter(({ invocation }) => !OUT_OF_SCOPE_INVOCATIONS.has(invocation))
    .map(({ cmd, invocation }) => ({
      id: `${SLASH_COMMAND_ID_PREFIX}${invocation}`,
      label: `/${invocation}`,
      description: describe(typeof cmd.description === 'string' ? cmd.description : ''),
      section: 'Slash Commands' as const,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Official `KZ` for a slash-command row opened from the "/" button (no slash
 * query in the composer):
 *   - Tab (`Uz0`): replace the draft with `"<label> "` so arguments can be typed;
 *   - click / Enter: run the command, i.e. send `/<invocation>` as a message.
 */
export function slashCommandSelection(
  id: string,
  viaTab: boolean,
): { kind: 'insert'; text: string } | { kind: 'send'; text: string } | null {
  if (!id.startsWith(SLASH_COMMAND_ID_PREFIX)) return null;
  const invocation = id.slice(SLASH_COMMAND_ID_PREFIX.length);
  if (!invocation || OUT_OF_SCOPE_INVOCATIONS.has(invocation)) return null;
  return viaTab ? { kind: 'insert', text: `/${invocation} ` } : { kind: 'send', text: `/${invocation}` };
}
