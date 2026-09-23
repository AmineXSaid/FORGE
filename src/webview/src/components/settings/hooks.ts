/**
 * The `hooks` setting, as the CLI reads it, and the edits the Hooks tab makes.
 *
 *   hooks: { [event]: [{ matcher?: string, hooks: [{ type: 'command', command, timeout? }] }] }
 *
 * Kept free of Vue so the spec drives it directly. Every edit returns a new
 * object: the store writes whole values, and a hook the page does not know
 * how to show (a `prompt` or `http` hook, an event it does not list) must
 * survive an edit next to it.
 */

export interface HookCommand {
  type: string;
  command?: string;
  timeout?: number;
  [key: string]: unknown;
}

export interface HookMatcher {
  matcher?: string;
  hooks: HookCommand[];
  [key: string]: unknown;
}

export type HooksConfig = Record<string, HookMatcher[]>;

export interface HookEvent {
  id: string;
  /** The CLI's own summary for the event (its `/hooks` menu). */
  summary: string;
  /** What the matcher is tested against, when the event takes one. */
  matcher?: { field: string; placeholder: string };
}

/*
 * The events offered for a new hook: the ones people reach for, with the
 * CLI's summaries and matcher fields (read from the bundled CLI). Hooks on any
 * other event still list and can be removed; they are added in the file.
 */
export const HOOK_EVENTS: readonly HookEvent[] = [
  { id: 'PreToolUse', summary: 'Before tool execution', matcher: { field: 'tool name', placeholder: 'Bash, or Edit|Write' } },
  { id: 'PostToolUse', summary: 'After tool execution', matcher: { field: 'tool name', placeholder: 'Edit|Write' } },
  { id: 'PostToolUseFailure', summary: 'After tool execution fails', matcher: { field: 'tool name', placeholder: 'Bash' } },
  { id: 'PermissionRequest', summary: 'When a permission dialog is displayed', matcher: { field: 'tool name', placeholder: 'Bash' } },
  { id: 'UserPromptSubmit', summary: 'When the user submits a prompt' },
  { id: 'Notification', summary: 'When notifications are sent', matcher: { field: 'notification type', placeholder: 'permission_prompt' } },
  { id: 'Stop', summary: 'Right before Claude concludes its response' },
  { id: 'SubagentStart', summary: 'When a subagent (Agent tool call) is started', matcher: { field: 'agent type', placeholder: 'code-reviewer' } },
  { id: 'SubagentStop', summary: 'Right before a subagent (Agent tool call) concludes its response', matcher: { field: 'agent type', placeholder: 'code-reviewer' } },
  { id: 'PreCompact', summary: 'Before conversation compaction', matcher: { field: 'trigger', placeholder: 'manual or auto' } },
  { id: 'PostCompact', summary: 'After conversation compaction', matcher: { field: 'trigger', placeholder: 'manual or auto' } },
  { id: 'SessionStart', summary: 'When a new session is started', matcher: { field: 'source', placeholder: 'startup, resume, clear or compact' } },
  { id: 'SessionEnd', summary: 'When a session is ending', matcher: { field: 'reason', placeholder: 'clear or logout' } },
];

export function hookEvent(id: string): HookEvent | undefined {
  return HOOK_EVENTS.find((e) => e.id === id);
}

/** One hook as a row: where it sits in the setting, so it can be removed. */
export interface HookRow {
  event: string;
  matcher: string;
  type: string;
  command: string;
  timeout?: number;
  /** Position in `hooks[event]` and in that entry's `hooks`. */
  group: number;
  index: number;
}

export function asHooksConfig(value: unknown): HooksConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: HooksConfig = {};
  for (const [event, groups] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(groups)) out[event] = groups.filter((g): g is HookMatcher => !!g && typeof g === 'object' && Array.isArray((g as HookMatcher).hooks));
  }
  return out;
}

/** Every hook in a config, flattened in file order. */
export function hookRows(config: HooksConfig): HookRow[] {
  const rows: HookRow[] = [];
  for (const [event, groups] of Object.entries(config)) {
    groups.forEach((group, g) => {
      group.hooks.forEach((hook, i) => {
        rows.push({
          event,
          matcher: group.matcher ?? '',
          type: hook.type,
          command: typeof hook.command === 'string' ? hook.command : '',
          timeout: typeof hook.timeout === 'number' ? hook.timeout : undefined,
          group: g,
          index: i,
        });
      });
    });
  }
  return rows;
}

export interface NewHook {
  event: string;
  matcher: string;
  command: string;
  /** Seconds; 0 or absent means the CLI's default. */
  timeout?: number;
}

/** Why a new hook cannot be saved, or undefined when it can. */
export function validateHook(hook: NewHook): string | undefined {
  const event = hookEvent(hook.event);
  if (!event) return 'Pick an event.';
  if (!hook.command.trim()) return 'Enter the command to run.';
  if (/\r|\n/.test(hook.command)) return 'Keep the command on one line; call a script for anything longer.';
  const matcher = hook.matcher.trim();
  if (matcher && event.matcher && matcher !== '*') {
    try {
      new RegExp(matcher);
    } catch {
      return 'The matcher is not a valid pattern. Use a name like Bash, or alternatives like Edit|Write.';
    }
  }
  if (hook.timeout !== undefined && hook.timeout !== 0 && (hook.timeout < 1 || hook.timeout > 3600 || !Number.isInteger(hook.timeout))) {
    return 'Timeout is whole seconds, 1 to 3600.';
  }
  return undefined;
}

/**
 * Add a command hook. It joins an existing entry with the same matcher, as
 * the CLI's `/hooks` menu does, rather than repeating the matcher.
 */
export function addHook(config: HooksConfig, hook: NewHook): HooksConfig {
  const event = hookEvent(hook.event);
  const matcher = event?.matcher ? hook.matcher.trim() : '';
  const command: HookCommand = { type: 'command', command: hook.command.trim() };
  if (hook.timeout) command.timeout = hook.timeout;
  const groups = [...(config[hook.event] ?? [])];
  const at = groups.findIndex((g) => (g.matcher ?? '') === matcher);
  if (at >= 0) {
    groups[at] = { ...groups[at], hooks: [...groups[at].hooks, command] };
  } else {
    groups.push(matcher ? { matcher, hooks: [command] } : { hooks: [command] });
  }
  return { ...config, [hook.event]: groups };
}

/** Remove one hook; an entry left empty goes, and an event left empty goes. */
export function removeHook(config: HooksConfig, row: Pick<HookRow, 'event' | 'group' | 'index'>): HooksConfig {
  const groups = config[row.event];
  if (!groups?.[row.group]?.hooks[row.index]) return config;
  const nextGroups = groups
    .map((g, gi) => (gi === row.group ? { ...g, hooks: g.hooks.filter((_, hi) => hi !== row.index) } : g))
    .filter((g) => g.hooks.length > 0);
  const next = { ...config };
  if (nextGroups.length) next[row.event] = nextGroups;
  else delete next[row.event];
  return next;
}
