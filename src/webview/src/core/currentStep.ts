/**
 * The working indicator's live step line: "Editing ChatPage.vue · 1m 7s"
 * instead of a random verb while a tool runs.
 *
 * Asked for on 2026-10-04: with a model that writes nothing between tool calls
 * (most non-Claude models), or with Focus view folding the tool rows away, the
 * only thing on screen during a long turn was "Forging…" -- no way to tell
 * whether it was reading, editing, running a test or stuck. The tool call is
 * already in the transcript the moment it streams in; this names it.
 *
 * Pure: takes the transcript's shape, not its classes, so it is testable
 * without a webview.
 */

/** The minimal transcript shape this reads (`Message` / `ContentBlockWrapper`). */
export interface StepSourceMessage {
  type: string;
  message: { content: unknown };
  /** Set on a subagent's own rows (the official `Xv`). */
  parentToolUseId?: string | null;
  sdkParentToolUseId?: string | null;
}

interface StepSourceBlock {
  content: { type?: string; id?: string; name?: string; input?: unknown };
  hasToolResult?: () => boolean;
}

export interface RunningStep {
  /** The tool_use id: a new id restarts the step's clock. */
  id: string;
  /** "Editing ChatPage.vue", "Running npm test", … */
  label: string;
}

/** What `task_progress` says a running subagent did last (`subagentTasks`). */
export interface StepSubagentTask {
  toolUseId?: string;
  recentTools?: string[];
}

/**
 * The newest tool call of the main thread that has no result yet, or undefined
 * between tools. A subagent's own calls are not the step: while it works the
 * step is its Agent call, and `stepLabel` adds what the subagent did last.
 */
export function runningStep(messages: readonly StepSourceMessage[]): RunningStep | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.type !== 'assistant' || !Array.isArray(message.message.content)) continue;
    if (message.parentToolUseId || message.sdkParentToolUseId) continue;
    const blocks = message.message.content as StepSourceBlock[];
    for (let j = blocks.length - 1; j >= 0; j--) {
      const block = blocks[j];
      if (block?.content?.type !== 'tool_use' || !block.content.id) continue;
      // The newest tool call decides: finished means nothing is running now.
      if (block.hasToolResult?.()) return undefined;
      return { id: block.content.id, label: describeStep(block.content.name ?? '', block.content.input) };
    }
  }
  return undefined;
}

/**
 * The step's line: for an Agent call whose task is running, its latest tool
 * from `task_progress` ("Running a subagent: audit relay · Grep").
 */
export function stepLabel(step: RunningStep, tasks?: Iterable<StepSubagentTask>): string {
  if (tasks) {
    for (const task of tasks) {
      if (task.toolUseId !== step.id) continue;
      const latest = task.recentTools?.at(-1);
      return latest ? `${step.label} · ${latest}` : step.label;
    }
  }
  return step.label;
}

const MAX_DETAIL = 48;

function clip(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > MAX_DETAIL ? `${oneLine.slice(0, MAX_DETAIL - 1)}…` : oneLine;
}

function baseName(path: unknown): string {
  if (typeof path !== 'string' || !path) return '';
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function str(input: unknown, key: string): string {
  const value = (input as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'string' ? value : '';
}

/** A short present-tense line for a tool call. Input may still be streaming in. */
export function describeStep(name: string, input: unknown): string {
  const file = baseName(str(input, 'file_path') || str(input, 'notebook_path') || str(input, 'path'));
  const withDetail = (verb: string, detail: string) => (detail ? `${verb} ${clip(detail)}` : verb);
  switch (name) {
    case 'Read': return withDetail('Reading', file);
    case 'Edit':
    case 'MultiEdit': return withDetail('Editing', file);
    case 'Write': return withDetail('Writing', file);
    case 'NotebookEdit': return withDetail('Editing', file);
    case 'Bash': return withDetail('Running', str(input, 'description') || str(input, 'command'));
    case 'BashOutput': return 'Reading command output';
    case 'KillShell': return 'Stopping a command';
    case 'Grep': return withDetail('Searching for', str(input, 'pattern'));
    case 'Glob': return withDetail('Finding', str(input, 'pattern'));
    case 'LS': return withDetail('Listing', file || 'files');
    case 'WebFetch': {
      const url = str(input, 'url');
      let host = '';
      try { host = url ? new URL(url).host : ''; } catch { host = url; }
      return withDetail('Fetching', host);
    }
    case 'WebSearch': return withDetail('Searching the web for', str(input, 'query'));
    case 'Task':
    case 'Agent': return withDetail('Running a subagent:', str(input, 'description'));
    case 'TodoWrite': return 'Updating the todo list';
    case 'Skill': return withDetail('Using skill', str(input, 'skill') || str(input, 'command'));
    default: {
      // mcp__server__tool → "Using tool (server)"
      const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
      if (mcp) return `Using ${mcp[2]} (${mcp[1]})`;
      return name ? `Using ${name}` : 'Working';
    }
  }
}

/** "12s", "1m 7s", "1h 3m". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
