/**
 * agents-and-workflows, phase 4:
 *
 * - Focus view's subagent spans (`uj0` / `PL1` / `gj0`, `j` in `mj0`) and the
 *   running-subagent rows (`NL1`, `IK1`: index.js @3464344, @3469534, @4856350);
 * - the working indicator naming a running subagent's latest tool;
 * - workflow tasks counted as background work;
 * - the query options the official host leaves unset.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Message } from '../src/webview/src/models/Message';
import { processAndAttachMessage } from '../src/webview/src/utils/messageUtils';
import {
  focusViewRows,
  insideSubagentSpan,
  subagentRowsByFold,
  subagentSpans,
  type FocusRow,
} from '../src/webview/src/core/focusView';
import {
  applyTaskEvent,
  emptyTaskState,
  formatLongDuration,
  overflowRowLabel,
  overflowRowMeta,
  splitSubagentRows,
  subagentRowLabel,
  subagentRowMeta,
  type SubagentTask,
} from '../src/webview/src/core/agentMap';
import { runningStep, stepLabel } from '../src/webview/src/core/currentStep';

const rows = (raws: any[]): Message[] => {
  const out: Message[] = [];
  for (const raw of raws) processAndAttachMessage(out, raw);
  return out;
};
const userText = (text: string, uuid: string) => ({ type: 'user', uuid, parent_tool_use_id: null, message: { role: 'user', content: text } });
const assistantText = (text: string, id: string, parent: string | null = null) => ({
  type: 'assistant', uuid: `a-${id}`, parent_tool_use_id: parent, message: { id, role: 'assistant', content: [{ type: 'text', text }] },
});
const agentCall = (id: string, description = 'audit relay', name = 'Agent') => ({
  type: 'assistant', uuid: `c-${id}`, parent_tool_use_id: null,
  message: { id: `m-${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name, input: { description, prompt: 'p' } }] },
});
const subRead = (id: string, parent: string) => ({
  type: 'assistant', uuid: `s-${id}`, parent_tool_use_id: parent,
  message: { id: `ms-${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: 'a.ts' } }] },
});
const result = (id: string, text = 'done') => ({
  type: 'user', uuid: `r-${id}`, parent_tool_use_id: null,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] },
});
const task = (taskId: string, extra: Partial<SubagentTask> = {}): SubagentTask => ({
  taskId, description: `task ${taskId}`, taskType: 'local_agent', startTime: 1000, status: 'running', ...extra,
});

describe('subagent spans (uj0 / PL1)', () => {
  it('spans run from an Agent/Task/Skill call to its result; an open one has no end', () => {
    const m = rows([userText('go', 'u1'), agentCall('tu1'), result('tu1'), agentCall('tu2', 'x', 'Task'), agentCall('tu3', 'y', 'Skill'), agentCall('tu4', 'z', 'skill__lint')]);
    expect(subagentSpans(m)).toEqual([{ use: 1, end: 2 }, { use: 3, end: undefined }, { use: 4, end: undefined }, { use: 5, end: undefined }]);
    expect(insideSubagentSpan(subagentSpans(m), 2)).toBe(false);
    expect(insideSubagentSpan(subagentSpans(m), 6)).toBe(true);
  });

  it('a Read call is not a span', () => {
    const m = rows([subRead('r1', 'x')]);
    expect(subagentSpans(m)).toEqual([]);
  });

  it('text the main thread writes while a subagent runs is not the turn\'s reply (H)', () => {
    // A streamed assistant row (no sdkParentToolUseId) inside an open span, then
    // nothing else: the turn stays live with a pending Agent call.
    const m = rows([userText('go', 'u1'), agentCall('tu1')]);
    const streamed = new Message('assistant', { role: 'assistant', content: [] }, Date.now(), { betaMessageId: 'mx' });
    const withText = rows([assistantText('Working on it', 'mx')])[0];
    streamed.message = withText.message;
    m.push(streamed);
    const out = focusViewRows(m, { busy: true, isToolHidden: () => false });
    // The streamed text is folded away rather than shown as the reply.
    expect(out.filter((r) => r.kind === 'message').map((r) => (r as any).idx)).toEqual([0]);
    expect(out.some((r) => r.kind === 'fold')).toBe(true);
  });
});

describe('subagentRowsByFold (NL1)', () => {
  const foldRows = (): FocusRow[] => {
    const m = rows([userText('go', 'u1'), agentCall('tu1'), agentCall('tu2', 'b'), subRead('r1', 'tu1')]);
    return focusViewRows(m, { busy: true, isToolHidden: () => false });
  };

  it('puts each task under the fold holding its Agent call', () => {
    const r = foldRows();
    const fold = r.find((x) => x.kind === 'fold')!;
    const placed = subagentRowsByFold(r, [task('a', { toolUseId: 'tu1' }), task('b', { toolUseId: 'tu2' })]);
    expect(placed.tail).toEqual([]);
    expect(placed.byFoldKey.get((fold as any).fold.key)!.map((t) => t.taskId)).toEqual(['a', 'b']);
  });

  it('a task no fold holds joins the last fold with tool calls, oldest first', () => {
    const r = foldRows();
    const fold = r.find((x) => x.kind === 'fold')!;
    const placed = subagentRowsByFold(r, [task('late', { startTime: 9 }), task('early', { startTime: 1 })]);
    expect(placed.byFoldKey.get((fold as any).fold.key)!.map((t) => t.taskId)).toEqual(['early', 'late']);
  });

  it('with no fold at all, they go to the tail', () => {
    const m = rows([userText('go', 'u1'), assistantText('hi', 'm1')]);
    const r = focusViewRows(m, { busy: false, isToolHidden: () => false });
    const placed = subagentRowsByFold(r, [task('x')]);
    expect(placed.tail.map((t) => t.taskId)).toEqual(['x']);
  });

  it('nothing running, nothing placed', () => {
    expect(subagentRowsByFold(foldRows(), [])).toEqual({ byFoldKey: new Map(), tail: [] });
  });
});

describe('IK1 rows', () => {
  it('label: description, then summary or latest tool', () => {
    expect(subagentRowLabel(task('a'))).toBe('task a');
    expect(subagentRowLabel(task('a', { recentTools: ['Grep', 'Read'] }))).toBe('task a: Read');
    expect(subagentRowLabel(task('a', { summary: 'Scanning', recentTools: ['Read'] }))).toBe('task a: Scanning');
    expect(subagentRowLabel(task('a', { summary: 'task a' }))).toBe('task a');
  });

  it('meta: tokens, tools, elapsed', () => {
    expect(subagentRowMeta(task('a'), 43_000)).toBe('42s');
    expect(subagentRowMeta(task('a', { usage: { totalTokens: 1200, toolUses: 1, durationMs: 0 } }), 61_000)).toBe('1.2k tokens · 1 tool · 1m 0s');
  });

  it('up to 4 rows; past that 3 rows and an overflow row', () => {
    expect(splitSubagentRows([1, 2, 3, 4])).toEqual({ visible: [1, 2, 3, 4], overflow: [] });
    expect(splitSubagentRows([1, 2, 3, 4, 5])).toEqual({ visible: [1, 2, 3], overflow: [4, 5] });
    expect(overflowRowLabel(1)).toBe('+1 more agent');
    expect(overflowRowLabel(2)).toBe('+2 more agents');
    expect(overflowRowMeta([task('a'), task('b')], 31_000)).toBe('1m 0s combined');
    expect(overflowRowMeta([task('a', { usage: { totalTokens: 500, toolUses: 2, durationMs: 0 } })], 4_601_000)).toBe('500 tokens · 2 tools · 1h 16m combined');
    expect(formatLongDuration(3_600_000)).toBe('1h 0m');
  });
});

describe('working indicator', () => {
  it('names the Agent call, not the subagent\'s own tool, and adds its latest tool', () => {
    const m = rows([userText('go', 'u1'), agentCall('tu1', 'audit relay'), subRead('r1', 'tu1')]);
    const step = runningStep(m)!;
    expect(step).toEqual({ id: 'tu1', label: 'Running a subagent: audit relay' });
    expect(stepLabel(step, [task('a', { toolUseId: 'tu1', recentTools: ['Grep', 'Read'] })])).toBe('Running a subagent: audit relay · Read');
    expect(stepLabel(step, [task('a', { toolUseId: 'other', recentTools: ['Grep'] })])).toBe('Running a subagent: audit relay');
    expect(stepLabel(step)).toBe('Running a subagent: audit relay');
  });

  it('a task with no progress yet adds nothing', () => {
    expect(stepLabel({ id: 'tu1', label: 'Running a subagent: x' }, [task('a', { toolUseId: 'tu1' })])).toBe('Running a subagent: x');
  });
});

describe('workflows as tasks', () => {
  it('a local_workflow is background work, not an agent in the map (the official handleTaskStarted)', () => {
    let s = emptyTaskState();
    s = applyTaskEvent(s, { type: 'system', subtype: 'task_started', task_id: 'wf1', task_type: 'local_workflow', workflow_name: 'audit', description: 'audit' }, [])!;
    s = applyTaskEvent(s, { type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'wf1', task_type: 'local_workflow', description: 'audit' }] }, [])!;
    expect(s.agentMapAgents.size).toBe(0);
    expect([...s.backgroundTaskIds]).toEqual(['wf1']);
  });

  it('the unread trigger counts background tasks as busy, as the official does', () => {
    const store = readFileSync(join(__dirname, '../src/webview/src/core/SessionStore.ts'), 'utf8');
    expect(store).toMatch(/\(session\?\.busy\(\) \?\? false\) \|\| \(session\?\.backgroundTaskIds\(\)\.size \?\? 0\) > 0/);
  });
});

describe('query options', () => {
  it('leaves perTaskStopAffordance / agentProgressSummaries / forwardSubagentText unset, as the official host does', () => {
    // extension.js @3289793 passes `agentProgressSummaries: void 0` and neither of
    // the other two (sdk.d.ts L1719 / L1781 / L1969).
    const sdk = readFileSync(join(__dirname, '../src/services/claude/ClaudeSdkService.ts'), 'utf8');
    for (const option of ['perTaskStopAffordance', 'agentProgressSummaries', 'forwardSubagentText']) {
      expect(sdk).not.toContain(option);
    }
  });
});

describe('ChatPage focus-view branches', () => {
  it('the plain turn list is the v-else of the focus list, with nothing in between', () => {
    // A v-if element between the two re-binds the v-else, and focus view then
    // draws the folded transcript *and* the plain one.
    const page = readFileSync(join(__dirname, '../src/webview/src/pages/ChatPage.vue'), 'utf8');
    expect(page).toMatch(/<\/template>\n\s*<div\n\s*v-for="\(turn, t\) in turns"\n\s*v-else/);
  });
});
