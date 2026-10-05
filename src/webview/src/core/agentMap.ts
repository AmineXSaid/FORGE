/**
 * Subagent and workflow task state: a port of the official session's task
 * handlers and the agent-map model helpers (index.js @3430592-@3437300 and
 * @3540210-@3543300). Pure functions over immutable Maps, so the session keeps
 * them in signals and the specs can feed real-shaped events.
 *
 * Names: the official minified name is given on each function.
 *
 * Event fields (sdk.d.ts, 0.3.274):
 *   task_started       SDKTaskStartedMessage       L5671
 *   task_progress      SDKTaskProgressMessage      L5646
 *   task_updated       SDKTaskUpdatedMessage       L5707
 *   task_notification  SDKTaskNotificationMessage  L5616
 *   background_tasks_changed SDKBackgroundTasksChangedMessage L3476
 */
import type {
  SDKBackgroundTasksChangedMessage,
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
  SDKTaskUpdatedMessage,
} from '@anthropic-ai/claude-agent-sdk';

/** The task events this module handles (sdk.d.ts L5002 union members). */
export type TaskEvent =
  | SDKTaskStartedMessage
  | SDKTaskProgressMessage
  | SDKTaskUpdatedMessage
  | SDKTaskNotificationMessage
  | SDKBackgroundTasksChangedMessage;

/** A tool_use / tool_result block as the transcript rows hold it (structurally). */
interface BlockContent {
  type?: string;
  id?: string;
  name?: string;
  text?: string;
  input?: unknown;
}
interface ToolResultLike {
  content?: unknown;
  is_error?: boolean;
}

/** A row of the Agent map (the official agent-map entry). */
export type AgentStatus = 'working' | 'finished' | 'failed' | 'stopped';
/** `AgentStatus` plus the derived `waiting` (the official `oC`). */
export type AgentDisplayStatus = AgentStatus | 'waiting';

export interface AgentUsage {
  totalTokens: number;
  toolUses: number;
  durationMs: number;
}

export interface AgentMapAgent {
  taskId: string;
  toolUseId?: string;
  /** The tool_use id of the Agent call this agent was spawned from; `null` = the main thread. */
  parentToolUseId?: string | null;
  description?: string;
  prompt?: string;
  subagentType?: string;
  isBackgrounded?: boolean;
  startTime: number;
  endTime?: number;
  status: AgentStatus;
  usage?: AgentUsage;
  summary?: string;
  result?: string;
  error?: string;
  outputFile?: string;
  wakeToolUseIds?: string[];
  /** Marked stopped because the CLI process went away, not because the agent ended. */
  processEnded?: boolean;
}

export type AgentMap = ReadonlyMap<string, AgentMapAgent>;

/** A running subagent (the official `subagentTasks` value). */
export interface SubagentTask {
  taskId: string;
  toolUseId?: string;
  description: string;
  prompt?: string;
  taskType: string;
  isBackgrounded?: boolean;
  startTime: number;
  status: 'running';
  usage?: AgentUsage;
  summary?: string;
  recentTools?: string[];
}

/** The official `N51`: the empty agent map. */
export const EMPTY_AGENT_MAP: AgentMap = new Map();

/** The official `nj0`: the spawn tool_use map is bounded. */
export const SPAWN_TOOL_USE_IDS_LIMIT = 1000;

/** The official `DR1`: agents rebuilt from a transcript before their task id is known. */
export const PROVISIONAL_PREFIX = 'call:';

/** The official `pC` / `uC`: the tools that spawn a subagent. */
export const AGENT_TOOL = 'Agent';
export const TASK_TOOL = 'Task';

/** The official `gz0`: the status labels. */
export const AGENT_STATUS_LABELS: Record<AgentDisplayStatus, string> = {
  working: 'Working',
  waiting: 'Waiting for your permission',
  finished: 'Finished',
  failed: 'Failed',
  stopped: 'Stopped',
};

// ---------------------------------------------------------------------------
// Text sanitising (the official `S5`): bidi controls are shown escaped.

const BIDI = /[؜‎‏‪-‮⁦-⁩]/g;

export function sanitize<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replace(BIDI, (c) => `\\u${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`) as T;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Agent-map helpers.

/** The official `sC`. */
export function isProvisionalId(taskId: string): boolean {
  return taskId.startsWith(PROVISIONAL_PREFIX);
}

/** The official `AR1`. */
function findByToolUseId(agents: AgentMap, toolUseId: string): AgentMapAgent | undefined {
  for (const agent of agents.values()) if (agent.toolUseId === toolUseId) return agent;
  return undefined;
}

/** The official `iC`: every tool_use id that belongs to this agent. */
export function agentToolUseIds(agent: AgentMapAgent): string[] {
  return agent.toolUseId === undefined ? agent.wakeToolUseIds ?? [] : [agent.toolUseId, ...(agent.wakeToolUseIds ?? [])];
}

export interface AgentStart {
  taskId: string;
  toolUseId?: string;
  parentToolUseId?: string | null;
  description?: string;
  prompt?: string;
  subagentType?: string;
  isBackgrounded?: boolean;
  startTime: number;
}

/** The official `FR1`: add an agent, or wake an existing one. */
export function addAgent(agents: AgentMap, start: AgentStart): AgentMap {
  const existing = agents.get(start.taskId);
  const byToolUse =
    existing === undefined && start.toolUseId !== undefined ? findByToolUseId(agents, start.toolUseId) : undefined;
  const base = existing ?? (byToolUse !== undefined && isProvisionalId(byToolUse.taskId) ? byToolUse : undefined);
  const next = new Map(agents);
  if (base !== undefined && base.taskId !== start.taskId) next.delete(base.taskId);
  const wakeToolUseIds =
    existing !== undefined &&
    start.toolUseId !== undefined &&
    start.toolUseId !== existing.toolUseId &&
    !(existing.wakeToolUseIds ?? []).includes(start.toolUseId)
      ? [...(existing.wakeToolUseIds ?? []), start.toolUseId]
      : existing?.wakeToolUseIds;
  next.set(start.taskId, {
    ...base,
    taskId: start.taskId,
    toolUseId: base?.toolUseId ?? start.toolUseId,
    parentToolUseId: base?.toolUseId !== undefined ? base.parentToolUseId : start.parentToolUseId,
    description: existing?.description ?? start.description,
    prompt: existing?.prompt ?? start.prompt,
    subagentType: start.subagentType ?? base?.subagentType,
    isBackgrounded: start.isBackgrounded ?? base?.isBackgrounded,
    startTime: base?.startTime ?? start.startTime,
    endTime: undefined,
    status: 'working',
    wakeToolUseIds,
    processEnded: undefined,
  });
  return next;
}

/** The official `O51`: re-key a provisional `call:` entry to the real task id. */
export function rekeyProvisional(agents: AgentMap, taskId: string, toolUseId: string | undefined): AgentMap {
  if (agents.has(taskId) || toolUseId === undefined) return agents;
  const provisional = findByToolUseId(agents, toolUseId);
  if (provisional === undefined || !isProvisionalId(provisional.taskId)) return agents;
  const next = new Map(agents);
  next.delete(provisional.taskId);
  next.set(taskId, { ...provisional, taskId });
  return next;
}

/** The official `PR1`: new usage; revives an agent only the process end had stopped. */
export function updateAgentUsage(agents: AgentMap, taskId: string, usage: AgentUsage): AgentMap {
  const agent = agents.get(taskId);
  if (!agent) return agents;
  const next = new Map(agents);
  next.set(
    taskId,
    agent.status === 'stopped' && agent.processEnded
      ? { ...agent, usage, status: 'working', endTime: undefined, processEnded: undefined }
      : { ...agent, usage }
  );
  return next;
}

/** The official `T51`: an SDK task status as an agent status. */
export function agentStatusOf(status: string | undefined): AgentStatus | undefined {
  switch (status) {
    case 'completed':
      return 'finished';
    case 'failed':
      return 'failed';
    case 'killed':
    case 'stopped':
      return 'stopped';
    default:
      return undefined;
  }
}

export interface AgentPatch {
  status?: string;
  error?: string;
  end_time?: number;
  is_backgrounded?: boolean;
}

/** The official `_51`: apply a `task_updated` patch. */
export function patchAgent(agents: AgentMap, taskId: string, patch: AgentPatch): AgentMap {
  const agent = agents.get(taskId);
  if (!agent) return agents;
  const updated: AgentMapAgent = { ...agent };
  let changed = false;
  const status = agentStatusOf(patch.status);
  if (status !== undefined && (agent.status !== status || agent.processEnded)) {
    updated.status = status;
    updated.endTime = patch.end_time ?? agent.endTime ?? Date.now();
    updated.processEnded = undefined;
    changed = true;
  }
  if (patch.error !== undefined && patch.error !== agent.error) {
    updated.error = patch.error;
    changed = true;
  }
  if (patch.is_backgrounded !== undefined && patch.is_backgrounded !== agent.isBackgrounded) {
    updated.isBackgrounded = patch.is_backgrounded;
    changed = true;
  }
  if (!changed) return agents;
  const next = new Map(agents);
  next.set(taskId, updated);
  return next;
}

export interface AgentNotification {
  taskId: string;
  status: string;
  summary?: string;
  usage?: AgentUsage;
  outputFile?: string;
  endTime: number;
}

/** The official `jR1`: a `task_notification` gives the final status (default "finished"). */
export function finishAgent(agents: AgentMap, notification: AgentNotification): AgentMap {
  const agent = agents.get(notification.taskId);
  if (!agent) return agents;
  const next = new Map(agents);
  next.set(notification.taskId, {
    ...agent,
    status: agentStatusOf(notification.status) ?? 'finished',
    summary: notification.summary,
    usage: notification.usage ?? agent.usage,
    outputFile: notification.outputFile ?? agent.outputFile,
    endTime: agent.endTime ?? notification.endTime,
    processEnded: undefined,
  });
  return next;
}

/** The official `MR1`: the process went away, so every working agent is stopped. */
export function stopWorkingAgents(agents: AgentMap, now: number): AgentMap {
  let next: Map<string, AgentMapAgent> | undefined;
  for (const [taskId, agent] of agents) {
    if (agent.status !== 'working') continue;
    next ??= new Map(agents);
    next.set(taskId, { ...agent, status: 'stopped', endTime: now, processEnded: true });
  }
  return next ?? agents;
}

/** The official `nC`: the agents with a pending permission request. */
export function agentsAwaitingPermission(requests: ReadonlyArray<{ agentId?: string }>): Set<string> {
  const ids = new Set<string>();
  for (const request of requests) if (request.agentId !== undefined) ids.add(request.agentId);
  return ids;
}

/** The official `oC`. */
export function displayStatus(agent: AgentMapAgent, awaiting: ReadonlySet<string>): AgentDisplayStatus {
  return agent.status === 'working' && awaiting.has(agent.taskId) ? 'waiting' : agent.status;
}

export type StatusDot = 'running' | 'waiting' | 'idle' | 'failed';

/** The official `R51`: a row's status dot. */
export function statusDotOf(status: AgentDisplayStatus): StatusDot {
  switch (status) {
    case 'working':
      return 'running';
    case 'waiting':
      return 'waiting';
    case 'finished':
      return 'idle';
    case 'failed':
    case 'stopped':
      return 'failed';
  }
}

/** The official `wR1`: the agents pill's dot. */
export function agentsPillDot(agents: AgentMap, awaiting: ReadonlySet<string>): 'running' | 'waiting' | 'idle' {
  let running = false;
  for (const agent of agents.values()) {
    if (agent.status !== 'working') continue;
    if (awaiting.has(agent.taskId)) return 'waiting';
    running = true;
  }
  return running ? 'running' : 'idle';
}

/** The official `NR1`. */
export function statusCounts(agents: AgentMap, awaiting: ReadonlySet<string>): Record<AgentDisplayStatus, number> {
  const counts: Record<AgentDisplayStatus, number> = { working: 0, waiting: 0, finished: 0, failed: 0, stopped: 0 };
  for (const agent of agents.values()) counts[displayStatus(agent, awaiting)]++;
  return counts;
}

export interface AgentTreeNode {
  agent: AgentMapAgent;
  children: AgentTreeNode[];
}

/** The official `_R1`. */
function contains(node: AgentTreeNode, target: AgentTreeNode): boolean {
  for (const child of node.children) if (child === target || contains(child, target)) return true;
  return false;
}

/** The official `OR1`: the tree, by `parentToolUseId`, oldest first. */
export function buildAgentTree(agents: AgentMap): AgentTreeNode[] {
  const byToolUse = new Map<string, AgentTreeNode>();
  const nodes: AgentTreeNode[] = [];
  const sorted = [...agents.values()].sort((a, b) => a.startTime - b.startTime);
  for (const agent of sorted) {
    const node: AgentTreeNode = { agent, children: [] };
    nodes.push(node);
    if (agent.toolUseId !== undefined) byToolUse.set(agent.toolUseId, node);
  }
  const roots: AgentTreeNode[] = [];
  for (const node of nodes) {
    const parentId = node.agent.parentToolUseId;
    const parent = parentId === undefined || parentId === null ? undefined : byToolUse.get(parentId);
    if (parent !== undefined && parent !== node && !contains(node, parent)) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** The structural bits of a transcript row the helpers read (Forge's `Message`). */
export interface TranscriptRow {
  type: string;
  timestamp: number;
  parentToolUseId?: string | null;
  sdkParentToolUseId?: string | null;
  origin?: { kind?: string; subkind?: string } | undefined;
  message: { content: string | ReadonlyArray<TranscriptBlock> };
}

export interface TranscriptBlock {
  content: BlockContent;
  toolResult?: () => ToolResultLike | undefined;
}

function blocksOf(row: TranscriptRow): ReadonlyArray<TranscriptBlock> {
  return Array.isArray(row.message.content) ? row.message.content : [];
}

/** The official `L51`: the parent tool-use id of the assistant row holding this tool_use. */
export function parentToolUseIdOf(messages: ReadonlyArray<TranscriptRow>, toolUseId: string): string | null | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const row = messages[i];
    if (row.type !== 'assistant') continue;
    for (const block of blocksOf(row)) {
      if (block.content?.type === 'tool_use' && block.content.id === toolUseId) {
        return row.sdkParentToolUseId !== undefined ? row.sdkParentToolUseId : row.parentToolUseId;
      }
    }
  }
  return undefined;
}

/** The official `RR1`: fill in parents that were not known when the agent started. */
export function fillParents(agents: AgentMap, messages: ReadonlyArray<TranscriptRow>): AgentMap {
  let next: Map<string, AgentMapAgent> | undefined;
  for (const [taskId, agent] of agents) {
    if (agent.parentToolUseId !== undefined || agent.toolUseId === undefined) continue;
    const parent = parentToolUseIdOf(messages, agent.toolUseId);
    if (parent === undefined) continue;
    next ??= new Map(agents);
    next.set(taskId, { ...agent, parentToolUseId: parent });
  }
  return next ?? agents;
}

// ---------------------------------------------------------------------------
// `<task-notification>` user rows (the official `qT`, `VF`, `HF`, `zT`).

const TASK_NOTIFICATION_TAG = 'task-notification';
const SUMMARY_TAG = 'summary';
const SUMMARY_RE = new RegExp(`<${SUMMARY_TAG}>([\\s\\S]*?)</${SUMMARY_TAG}>`);

function countOf(text: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at === -1) return count;
    count++;
    from = at + needle.length;
  }
}

function tagValue(text: string, tag: string): string | undefined {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  if (countOf(text, open) !== 1 || countOf(text, close) !== 1) return undefined;
  const start = text.indexOf(open) + open.length;
  const end = text.indexOf(close);
  const value = end < start ? undefined : text.slice(start, end).trim();
  return value === undefined || value.includes('<') ? undefined : value;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>' };
function unescapeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt);/g, (e) => ENTITIES[e] ?? e);
}

export interface TaskNotificationText {
  summary: string;
  hasTrailingContent: boolean;
  taskId?: string;
  toolUseId?: string;
  status?: string;
  result?: string;
  usage?: AgentUsage;
}

/** The official `qT`: a `<task-notification>` the CLI injected as a user row. */
export function parseTaskNotification(text: string): TaskNotificationText | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith(`<${TASK_NOTIFICATION_TAG}`)) return null;
  const close = `</${TASK_NOTIFICATION_TAG}>`;
  const end = trimmed.indexOf(close);
  if (end === -1) return null;
  if (trimmed.indexOf(close, end + close.length) !== -1) return null;
  const body = trimmed.slice(0, end);
  const summary = SUMMARY_RE.exec(body);
  if (summary?.[1]?.includes('<')) return null;
  if (countOf(body, `<${SUMMARY_TAG}>`) > 1 || countOf(body, `</${SUMMARY_TAG}>`) > 1) return null;
  const tokens = tagValue(body, 'subagent_tokens');
  const toolUses = tagValue(body, 'tool_uses');
  const duration = tagValue(body, 'duration_ms');
  const result = tagValue(body, 'result');
  return {
    summary: summary ? unescapeEntities(summary[1]).trim() : '',
    hasTrailingContent: trimmed.slice(end + close.length).trim() !== '',
    taskId: tagValue(body, 'task-id'),
    toolUseId: tagValue(body, 'tool-use-id'),
    status: tagValue(body, 'status'),
    result: result === undefined ? undefined : unescapeEntities(result).trim(),
    usage:
      tokens !== undefined && toolUses !== undefined && duration !== undefined
        ? { totalTokens: Number(tokens), toolUses: Number(toolUses), durationMs: Number(duration) }
        : undefined,
  };
}

/** The official `oj`: a row the CLI wrote for a task (or one with no origin). */
function isTaskNotificationOrigin(origin: TranscriptRow['origin']): boolean {
  if (origin === undefined) return true;
  return origin.kind === 'task-notification' && origin.subkind === undefined;
}

/** The official `ER1`. */
function taskNotificationOf(row: TranscriptRow): TaskNotificationText | null {
  if (row.type !== 'user' || !isTaskNotificationOrigin(row.origin)) return null;
  const first = blocksOf(row)[0]?.content;
  return first?.type === 'text' && typeof first.text === 'string' ? parseTaskNotification(first.text) : null;
}

/** The official `TR1`: the latest `<result>` a notification carried for this task. */
export function notificationResultOf(messages: ReadonlyArray<TranscriptRow>, taskId: string): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const notification = taskNotificationOf(messages[i]);
    if (notification?.taskId === taskId) return notification.result;
  }
  return undefined;
}

/** The official `b51`: a tool result's text. */
export function toolResultText(result: ToolResultLike | undefined): string | undefined {
  const content = result?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content as unknown[]) {
    const b = block as BlockContent | null;
    if (typeof b === 'object' && b !== null && b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
  }
  return parts.length === 0 ? undefined : parts.join('\n');
}

const TRAILER_RE =
  /\n?agentId:[ \t]*([A-Za-z0-9_-]+)[^\n]*(?:\nworktree(?:Path|Branch):[^\n]*)*\n<usage>[^<]*<\/usage>\s*$/;
const ASYNC_LAUNCH_RE =
  /^Async agent launched successfully\. \(This tool result is internal metadata[^\n]*\)\nagentId: ([A-Za-z0-9_-]+) /;
const CLOUD_LAUNCH_RE =
  /^Cloud agent launched\. \(This tool result is internal metadata[^\n]*\)\ntaskId: \S+\nsession_url: \S+\n/;

/** The official `zj0`: the agent id an Agent tool result names. */
export function agentIdOfResult(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  return ASYNC_LAUNCH_RE.exec(text)?.[1] ?? TRAILER_RE.exec(text)?.[1];
}

/** The official `kR1`: the result only says a background agent was launched. */
export function isAsyncLaunch(text: string | undefined): boolean {
  return text !== undefined && ASYNC_LAUNCH_RE.test(text);
}

/** The official `qj0`. */
function isCloudLaunch(text: string | undefined): boolean {
  return text !== undefined && CLOUD_LAUNCH_RE.test(text);
}

const REPORT_MARKER = 'The report follows:';
const NO_OUTPUT = ['(Subagent completed but returned no output.)', '(no text output)'];

/** The official `fR1`: the report inside an Agent tool result. */
export function agentReportOf(text: string | undefined): string | undefined {
  if (text === undefined || isAsyncLaunch(text)) return undefined;
  const trailer = TRAILER_RE.exec(text);
  let report = trailer ? text.slice(0, trailer.index) : text;
  const handBack = report.search(/^\[Subagent hand-back\]/m);
  const marker =
    handBack !== -1 && /^( {2}[^\n]*\n|\n)*$/.test(report.slice(0, handBack)) ? report.indexOf(REPORT_MARKER, handBack) : -1;
  if (marker !== -1) {
    report = report
      .slice(marker + REPORT_MARKER.length)
      .split('\n')
      .map((line) => (line.startsWith('  ') ? line.slice(2) : line))
      .join('\n');
  }
  report = report.trim();
  return report === '' || NO_OUTPUT.includes(report) ? undefined : report;
}

const INTERRUPTS = new Set(['[Request interrupted by user]', '[Request interrupted by user for tool use]']);

/** The official `Gj0`: the result says the user stopped it. */
function isUserStop(text: string | undefined): boolean {
  return text !== undefined && (INTERRUPTS.has(text) || text.startsWith("The user doesn't want to proceed"));
}

function stringOr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** The official `E51`: rebuild the agent map from a loaded transcript. */
export function agentsFromTranscript(messages: ReadonlyArray<TranscriptRow>): Map<string, AgentMapAgent> {
  const byToolUse = new Map<string, TaskNotificationText>();
  const byTask = new Map<string, TaskNotificationText[]>();
  for (const row of messages) {
    const notification = taskNotificationOf(row);
    if (notification?.toolUseId !== undefined) byToolUse.set(notification.toolUseId, notification);
    if (notification?.taskId !== undefined) {
      byTask.set(notification.taskId, [...(byTask.get(notification.taskId) ?? []), notification]);
    }
  }
  const agents = new Map<string, AgentMapAgent>();
  for (const row of messages) {
    if (row.type !== 'assistant') continue;
    for (const block of blocksOf(row)) {
      const use = block.content;
      if (use?.type !== 'tool_use' || use.id === undefined || (use.name !== AGENT_TOOL && use.name !== TASK_TOOL)) continue;
      const input = (typeof use.input === 'object' && use.input !== null ? use.input : {}) as Record<string, unknown>;
      const result = block.toolResult?.();
      const text = toolResultText(result);
      if (isCloudLaunch(text)) continue;
      const taskId = byToolUse.get(use.id)?.taskId ?? agentIdOfResult(text) ?? `${PROVISIONAL_PREFIX}${use.id}`;
      const notifications = byTask.get(taskId) ?? [];
      const latest = notifications.at(-1);
      const status: AgentStatus =
        agentStatusOf(latest?.status) ??
        (result === undefined || isAsyncLaunch(text)
          ? 'stopped'
          : result.is_error === true
            ? isUserStop(text)
              ? 'stopped'
              : 'failed'
            : 'finished');
      const wakes = notifications.map((n) => n.toolUseId).filter((id): id is string => id !== undefined && id !== use.id);
      agents.set(taskId, {
        taskId,
        toolUseId: use.id,
        parentToolUseId: row.sdkParentToolUseId ?? row.parentToolUseId ?? null,
        description: stringOr(input.description) ?? 'Agent',
        prompt: stringOr(input.prompt),
        subagentType: stringOr(input.subagent_type),
        isBackgrounded: input.run_in_background !== false,
        startTime: row.timestamp,
        endTime: row.timestamp,
        status,
        usage: latest?.usage,
        summary: latest?.summary,
        result: latest?.result,
        wakeToolUseIds: wakes.length > 0 ? wakes : undefined,
      });
    }
  }
  return agents;
}

// ---------------------------------------------------------------------------
// The session's task handlers, as pure state transitions.

export interface TaskState {
  subagentTasks: ReadonlyMap<string, SubagentTask>;
  agentMapAgents: AgentMap;
  backgroundTaskIds: ReadonlySet<string>;
  /** Mutable LRU: task id → spawning tool_use id (the official `subagentSpawnToolUseIds`). */
  subagentSpawnToolUseIds: Map<string, string>;
}

export function emptyTaskState(): TaskState {
  return {
    subagentTasks: new Map(),
    agentMapAgents: EMPTY_AGENT_MAP,
    backgroundTaskIds: new Set(),
    subagentSpawnToolUseIds: new Map(),
  };
}

/** The official `rememberSubagentSpawnToolUseId`. */
export function rememberSpawnToolUseId(map: Map<string, string>, taskId: string, toolUseId: string): void {
  map.delete(taskId);
  map.set(taskId, toolUseId);
  if (map.size > SPAWN_TOOL_USE_IDS_LIMIT) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

function usageOf(usage: { total_tokens: number; tool_uses: number; duration_ms: number }): AgentUsage {
  return { totalTokens: usage.total_tokens, toolUses: usage.tool_uses, durationMs: usage.duration_ms };
}

/** The official `handleTaskStarted`. */
export function handleTaskStarted(
  state: TaskState,
  event: SDKTaskStartedMessage,
  messages: ReadonlyArray<TranscriptRow>,
  now = Date.now()
): TaskState {
  if (!('task_id' in event)) return state;
  if (event.task_type !== 'local_agent') return state;
  const toolUseId: string | undefined = event.tool_use_id ?? state.subagentSpawnToolUseIds.get(event.task_id);
  if (toolUseId !== undefined) rememberSpawnToolUseId(state.subagentSpawnToolUseIds, event.task_id, toolUseId);
  const description = sanitize(event.description);
  const prompt = sanitize(event.prompt);
  const tasks = new Map(state.subagentTasks);
  tasks.set(event.task_id, {
    taskId: event.task_id,
    toolUseId,
    description,
    prompt,
    taskType: event.task_type,
    isBackgrounded: event.is_backgrounded,
    startTime: now,
    status: 'running',
  });
  return {
    ...state,
    subagentTasks: tasks,
    agentMapAgents: addAgent(state.agentMapAgents, {
      taskId: event.task_id,
      toolUseId,
      parentToolUseId: toolUseId === undefined ? undefined : parentToolUseIdOf(messages, toolUseId),
      description,
      prompt,
      subagentType: sanitize(event.subagent_type),
      isBackgrounded: event.is_backgrounded,
      startTime: now,
    }),
  };
}

/** The official `handleTaskUpdated`. */
export function handleTaskUpdated(state: TaskState, event: SDKTaskUpdatedMessage): TaskState {
  const { status, is_backgrounded } = event.patch ?? {};
  const agentMapAgents = patchAgent(state.agentMapAgents, event.task_id, {
    status,
    error: sanitize(event.patch?.error),
    end_time: event.patch?.end_time,
    is_backgrounded,
  });
  const task = state.subagentTasks.get(event.task_id);
  if (!task) return { ...state, agentMapAgents };
  const tasks = new Map(state.subagentTasks);
  if (status === 'completed' || status === 'failed' || status === 'killed') tasks.delete(event.task_id);
  else if (is_backgrounded !== undefined && is_backgrounded !== task.isBackgrounded) {
    tasks.set(event.task_id, { ...task, isBackgrounded: is_backgrounded });
  } else return { ...state, agentMapAgents };
  return { ...state, agentMapAgents, subagentTasks: tasks };
}

/** The official `handleBackgroundTasksChanged`: `tasks` replaces the list. */
export function handleBackgroundTasksChanged(state: TaskState, event: SDKBackgroundTasksChangedMessage): TaskState {
  const listed = new Set<string>(event.tasks.map((t) => t.task_id));
  let tasks: Map<string, SubagentTask> | undefined;
  for (const [taskId, task] of state.subagentTasks) {
    if (task.isBackgrounded === true && !listed.has(taskId)) {
      tasks ??= new Map(state.subagentTasks);
      tasks.delete(taskId);
    }
  }
  const ids = new Set<string>();
  for (const t of event.tasks) if (t.task_type === 'local_agent' || t.task_type === 'local_workflow') ids.add(t.task_id);
  const current = state.backgroundTaskIds;
  const sameIds = current.size === ids.size && [...ids].every((id) => current.has(id));
  return {
    ...state,
    subagentTasks: tasks ?? state.subagentTasks,
    backgroundTaskIds: sameIds ? current : ids,
  };
}

/** The official `handleTaskProgress`. */
export function handleTaskProgress(state: TaskState, event: SDKTaskProgressMessage): TaskState {
  if (!('task_id' in event)) return state;
  const usage = usageOf(event.usage);
  const agentMapAgents = updateAgentUsage(
    rekeyProvisional(state.agentMapAgents, event.task_id, event.tool_use_id),
    event.task_id,
    usage
  );
  const task = state.subagentTasks.get(event.task_id);
  if (!task) return { ...state, agentMapAgents };
  let recentTools = task.recentTools;
  const description = sanitize(event.description);
  const summary = sanitize(event.summary);
  const lastTool = sanitize(event.last_tool_name);
  const activity = description && description !== task.description ? description : lastTool;
  if (!summary && activity && activity !== recentTools?.[recentTools.length - 1]) {
    recentTools = [...(recentTools ?? []), activity].slice(-3);
  }
  const tasks = new Map(state.subagentTasks);
  tasks.set(event.task_id, { ...task, usage, summary: summary ?? task.summary, recentTools });
  return { ...state, agentMapAgents, subagentTasks: tasks };
}

/** The official `handleTaskNotification`. */
export function handleTaskNotification(state: TaskState, event: SDKTaskNotificationMessage, now = Date.now()): TaskState {
  if (!('task_id' in event)) return state;
  const agentMapAgents = finishAgent(rekeyProvisional(state.agentMapAgents, event.task_id, event.tool_use_id), {
    taskId: event.task_id,
    status: event.status,
    summary: sanitize(event.summary),
    usage: event.usage && usageOf(event.usage),
    outputFile: event.output_file,
    endTime: now,
  });
  if (!state.subagentTasks.has(event.task_id)) return { ...state, agentMapAgents };
  const tasks = new Map(state.subagentTasks);
  tasks.delete(event.task_id);
  return { ...state, agentMapAgents, subagentTasks: tasks };
}

/** The official `stopSubagent` tail: a still-working agent is marked killed. */
export function markStopped(agents: AgentMap, taskId: string): AgentMap {
  return agents.get(taskId)?.status === 'working' ? patchAgent(agents, taskId, { status: 'killed' }) : agents;
}

/** Dispatch one `system` message (the official @3538206). Returns undefined for other subtypes. */
export function applyTaskEvent(
  state: TaskState,
  event: { type?: string; subtype?: string } | null | undefined,
  messages: ReadonlyArray<TranscriptRow>,
  now = Date.now()
): TaskState | undefined {
  if (event?.type !== 'system') return undefined;
  const task = event as TaskEvent;
  switch (task.subtype) {
    case 'task_started':
      return handleTaskStarted(state, task, messages, now);
    case 'task_progress':
      return handleTaskProgress(state, task);
    case 'task_notification':
      return handleTaskNotification(state, task, now);
    case 'task_updated':
      return handleTaskUpdated(state, task);
    case 'background_tasks_changed':
      return handleBackgroundTasksChanged(state, task);
    default:
      return undefined;
  }
}

/** The official pill label `zF1` (`NY` pluralises). */
export function agentsPillLabel(count: number): string {
  return `${count} ${count === 1 ? 'agent' : 'agents'}`;
}

/** The official pill tooltip. */
export function agentsPillTooltip(dot: 'running' | 'waiting' | 'idle'): string {
  if (dot === 'waiting') return 'An agent is waiting for your permission · Click to open the agent map';
  if (dot === 'running') return 'Agents are working · Click to open the agent map';
  return 'Click to open the agent map';
}
