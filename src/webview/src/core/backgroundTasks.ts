/**
 * The tasks pane's model: every background task the CLI reports in this
 * session, of every type. Forge-only, after the Claude desktop app's tasks
 * pane ("subagents, background shell commands, and dynamic workflows"; click
 * one to see its output, or stop it -- code.claude.com/docs/en/desktop).
 *
 * The official VS Code webview keeps only `local_agent` tasks
 * (`handleTaskStarted` returns early for anything else), so the Agent map and
 * the pill stay on `agentMap.ts`. This module keeps the other types --
 * `local_workflow`, `local_bash`, `mcp_task`, and any type a newer CLI adds --
 * from the same five events (sdk.d.ts 0.3.274):
 *
 *   task_started   L5671  task_id, task_type, description, workflow_name, is_backgrounded, ambient
 *   task_progress  L5646  usage, last_tool_name, summary ("render it regardless of task type")
 *   task_updated   L5707  patch.status (pending/running/completed/failed/killed/paused), error, end_time
 *   task_notification L5616 status (completed/failed/stopped), summary, output_file, usage
 *   background_tasks_changed L3476 the live background set (replace semantics)
 *
 * Agents are listed from the agent map instead, which also rebuilds them
 * from a loaded transcript.
 */
import type { AgentDisplayStatus, AgentMap, AgentUsage, SubagentTask } from './agentMap';
import { displayStatus } from './agentMap';

export type TaskKind = 'agent' | 'workflow' | 'shell' | 'mcp' | 'task';

export type TaskStatus = 'pending' | 'running' | 'paused' | 'waiting' | 'completed' | 'failed' | 'stopped';

export interface OtherTask {
  taskId: string;
  taskType: string;
  description: string;
  workflowName?: string;
  toolUseId?: string;
  status: TaskStatus;
  startTime: number;
  endTime?: number;
  usage?: AgentUsage;
  lastTool?: string;
  summary?: string;
  error?: string;
  outputFile?: string;
  isBackgrounded?: boolean;
}

export type OtherTasks = ReadonlyMap<string, OtherTask>;

export const EMPTY_TASKS: OtherTasks = new Map();

/** The pane's label for a task type. */
export function kindOf(taskType: string | undefined): TaskKind {
  switch (taskType) {
    case 'local_agent':
      return 'agent';
    case 'local_workflow':
      return 'workflow';
    case 'local_bash':
      return 'shell';
    case 'mcp_task':
      return 'mcp';
    default:
      return 'task';
  }
}

export const KIND_LABELS: Record<TaskKind, string> = {
  agent: 'Agent',
  workflow: 'Workflow',
  shell: 'Shell',
  mcp: 'MCP',
  task: 'Task',
};

function statusFromPatch(status: string | undefined): TaskStatus | undefined {
  switch (status) {
    case 'pending':
    case 'running':
    case 'paused':
    case 'completed':
    case 'failed':
      return status;
    case 'killed':
    case 'stopped':
      return 'stopped';
    default:
      return undefined;
  }
}

function isEvent(event: unknown): event is { type: string; subtype: string; task_id?: string } & Record<string, unknown> {
  return typeof event === 'object' && event !== null && (event as { type?: unknown }).type === 'system';
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function usageOf(v: unknown): AgentUsage | undefined {
  const u = v as { total_tokens?: unknown; tool_uses?: unknown; duration_ms?: unknown } | undefined;
  if (!u || typeof u.total_tokens !== 'number') return undefined;
  return { totalTokens: u.total_tokens, toolUses: Number(u.tool_uses) || 0, durationMs: Number(u.duration_ms) || 0 };
}

/** Apply one `system` event; returns the same map when nothing changed. */
export function applyOtherTaskEvent(tasks: OtherTasks, event: unknown, now = Date.now()): OtherTasks {
  if (!isEvent(event)) return tasks;
  const id = str(event.task_id);
  switch (event.subtype) {
    case 'task_started': {
      if (!id || event.task_type === 'local_agent') return tasks;
      // `ambient`: housekeeping the SDK says hosts should not count as
      // activity. The desktop pane may list it; Forge leaves it out.
      if (event.ambient === true) return tasks;
      const next = new Map(tasks);
      const prev = tasks.get(id);
      next.set(id, {
        ...prev,
        taskId: id,
        taskType: str(event.task_type) ?? 'task',
        description: str(event.description) ?? str(event.workflow_name) ?? 'Task',
        workflowName: str(event.workflow_name),
        toolUseId: str(event.tool_use_id) ?? prev?.toolUseId,
        isBackgrounded: typeof event.is_backgrounded === 'boolean' ? event.is_backgrounded : prev?.isBackgrounded,
        status: 'running',
        startTime: prev?.startTime ?? now,
        endTime: undefined,
      });
      return next;
    }
    case 'task_progress': {
      const task = id ? tasks.get(id) : undefined;
      if (!task) return tasks;
      const next = new Map(tasks);
      next.set(task.taskId, {
        ...task,
        usage: usageOf(event.usage) ?? task.usage,
        lastTool: str(event.last_tool_name) ?? task.lastTool,
        summary: str(event.summary) ?? task.summary,
      });
      return next;
    }
    case 'task_updated': {
      const task = id ? tasks.get(id) : undefined;
      if (!task) return tasks;
      const patch = (event.patch ?? {}) as Record<string, unknown>;
      const status = statusFromPatch(str(patch.status));
      const ended = status === 'completed' || status === 'failed' || status === 'stopped';
      const next = new Map(tasks);
      next.set(task.taskId, {
        ...task,
        status: status ?? task.status,
        description: str(patch.description) ?? task.description,
        error: str(patch.error) ?? task.error,
        isBackgrounded: typeof patch.is_backgrounded === 'boolean' ? patch.is_backgrounded : task.isBackgrounded,
        endTime: ended ? (typeof patch.end_time === 'number' ? patch.end_time : task.endTime ?? now) : task.endTime,
      });
      return next;
    }
    case 'task_notification': {
      const task = id ? tasks.get(id) : undefined;
      if (!task) return tasks;
      const next = new Map(tasks);
      next.set(task.taskId, {
        ...task,
        status: statusFromPatch(str(event.status)) ?? 'completed',
        summary: str(event.summary) || task.summary,
        outputFile: str(event.output_file) ?? task.outputFile,
        usage: usageOf(event.usage) ?? task.usage,
        endTime: task.endTime ?? now,
      });
      return next;
    }
    default:
      return tasks;
  }
}

/** The CLI process ended: nothing it ran is still running. */
export function stopRunningTasks(tasks: OtherTasks, now: number): OtherTasks {
  let next: Map<string, OtherTask> | undefined;
  for (const [id, task] of tasks) {
    if (task.status !== 'running' && task.status !== 'pending' && task.status !== 'paused') continue;
    next ??= new Map(tasks);
    next.set(id, { ...task, status: 'stopped', endTime: now });
  }
  return next ?? tasks;
}

/** A stop the host confirmed, before the CLI's own notification arrives. */
export function markTaskStopped(tasks: OtherTasks, taskId: string, now = Date.now()): OtherTasks {
  const task = tasks.get(taskId);
  if (!task || (task.status !== 'running' && task.status !== 'pending' && task.status !== 'paused')) return tasks;
  const next = new Map(tasks);
  next.set(taskId, { ...task, status: 'stopped', endTime: now });
  return next;
}

// ---------------------------------------------------------------------------
// The pane's rows: agents (from the agent map) and every other task, one list.

export interface PaneRow {
  taskId: string;
  kind: TaskKind;
  title: string;
  status: TaskStatus;
  startTime: number;
  endTime?: number;
  usage?: AgentUsage;
  /** What it is doing now, or what it ended with. */
  activity?: string;
  error?: string;
  outputFile?: string;
  /** Agents only: the key the Agent map and the transcript use. */
  agentKey?: string;
  stoppable: boolean;
}

const AGENT_STATUS: Record<AgentDisplayStatus, TaskStatus> = {
  working: 'running',
  waiting: 'waiting',
  finished: 'completed',
  failed: 'failed',
  stopped: 'stopped',
};

export function isLive(status: TaskStatus): boolean {
  return status === 'running' || status === 'waiting' || status === 'pending' || status === 'paused';
}

/** Running first (oldest first), then finished (newest first). */
export function paneRows(
  agents: AgentMap,
  awaiting: ReadonlySet<string>,
  running: ReadonlyMap<string, SubagentTask>,
  others: OtherTasks
): PaneRow[] {
  const rows: PaneRow[] = [];
  for (const agent of agents.values()) {
    const status = AGENT_STATUS[displayStatus(agent, awaiting)];
    const live = running.get(agent.taskId);
    rows.push({
      taskId: agent.taskId,
      kind: 'agent',
      title: agent.description ?? 'Agent',
      status,
      startTime: agent.startTime,
      endTime: agent.endTime,
      usage: agent.usage,
      activity: isLive(status) ? live?.summary ?? live?.recentTools?.at(-1) : agent.summary,
      error: agent.error,
      outputFile: agent.outputFile,
      agentKey: agent.toolUseId ?? agent.taskId,
      // A transcript-rebuilt agent (`call:` id) has no task the CLI could stop.
      stoppable: isLive(status) && !agent.taskId.startsWith('call:'),
    });
  }
  for (const task of others.values()) {
    rows.push({
      taskId: task.taskId,
      kind: kindOf(task.taskType),
      title: task.workflowName && task.description === task.workflowName ? task.workflowName : task.description,
      status: task.status,
      startTime: task.startTime,
      endTime: task.endTime,
      usage: task.usage,
      activity: isLive(task.status) ? task.summary ?? task.lastTool : task.summary,
      error: task.error,
      outputFile: task.outputFile,
      stoppable: isLive(task.status),
    });
  }
  const live = rows.filter((r) => isLive(r.status)).sort((a, b) => a.startTime - b.startTime);
  const done = rows.filter((r) => !isLive(r.status)).sort((a, b) => (b.endTime ?? b.startTime) - (a.endTime ?? a.startTime));
  return [...live, ...done];
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  paused: 'Paused',
  waiting: 'Waiting for your permission',
  completed: 'Completed',
  failed: 'Failed',
  stopped: 'Stopped',
};

/** The status dot (the official `vG` states). */
export function dotOf(status: TaskStatus): 'running' | 'waiting' | 'idle' | 'failed' {
  if (status === 'waiting') return 'waiting';
  if (isLive(status)) return 'running';
  return status === 'completed' ? 'idle' : 'failed';
}

const KIND_NOUNS: Record<TaskKind, [string, string]> = {
  agent: ['agent', 'agents'],
  workflow: ['workflow', 'workflows'],
  shell: ['command', 'commands'],
  mcp: ['MCP task', 'MCP tasks'],
  task: ['task', 'tasks'],
};

/**
 * The tray's one line: what runs, by kind ("3 agents, 1 workflow running"),
 * led by anything waiting on you; once all has ended, how it ended.
 */
export function trayHeadline(rows: readonly PaneRow[]): string {
  const live = rows.filter((r) => isLive(r.status));
  if (live.length > 0) {
    const waiting = live.filter((r) => r.status === 'waiting').length;
    const counts = new Map<TaskKind, number>();
    for (const r of live) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
    const parts = [...counts].map(([kind, n]) => `${n} ${KIND_NOUNS[kind][n === 1 ? 0 : 1]}`);
    const runningLine = `${parts.join(', ')} running`;
    return waiting > 0 ? `${waiting} waiting for you · ${runningLine}` : runningLine;
  }
  const failed = rows.filter((r) => r.status === 'failed').length;
  const stopped = rows.filter((r) => r.status === 'stopped').length;
  const finished = rows.length - failed - stopped;
  return [
    finished > 0 ? `${finished} finished` : '',
    failed > 0 ? `${failed} failed` : '',
    stopped > 0 ? `${stopped} stopped` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
