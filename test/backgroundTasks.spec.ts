/**
 * Forge's tasks pane model (core/backgroundTasks.ts): every task type the CLI
 * reports, not only `local_agent` (sdk.d.ts 0.3.274, L5671/L5646/L5707/L5616).
 */
import { describe, expect, it } from 'vitest';
import { signal } from 'alien-signals';
import {
  EMPTY_TASKS,
  applyOtherTaskEvent,
  dotOf,
  kindOf,
  markTaskStopped,
  paneRows,
  stopRunningTasks,
  type OtherTasks,
} from '../src/webview/src/core/backgroundTasks';
import { addAgent, EMPTY_AGENT_MAP, finishAgent } from '../src/webview/src/core/agentMap';
import { Session } from '../src/webview/src/core/Session';

const sys = (subtype: string, fields: Record<string, unknown>) => ({ type: 'system', subtype, uuid: 'u', session_id: 's', ...fields });
const run = (events: unknown[], tasks: OtherTasks = EMPTY_TASKS, now = 1000) => events.reduce<OtherTasks>((t, e) => applyOtherTaskEvent(t, e, now), tasks);

describe('applyOtherTaskEvent', () => {
  it('a workflow: started -> progress -> notification', () => {
    let t = run([sys('task_started', { task_id: 'w1', task_type: 'local_workflow', workflow_name: 'audit', description: 'audit relay' })]);
    expect(t.get('w1')).toMatchObject({ taskType: 'local_workflow', description: 'audit relay', workflowName: 'audit', status: 'running', startTime: 1000 });
    t = run([sys('task_progress', { task_id: 'w1', description: 'audit relay', usage: { total_tokens: 900, tool_uses: 4, duration_ms: 3000 }, last_tool_name: 'Grep', summary: 'Phase 2 of 3' })], t);
    expect(t.get('w1')).toMatchObject({ usage: { totalTokens: 900, toolUses: 4, durationMs: 3000 }, lastTool: 'Grep', summary: 'Phase 2 of 3' });
    t = run([sys('task_notification', { task_id: 'w1', status: 'completed', output_file: '/tmp/w1.out', summary: 'Report ready' })], t, 5000);
    expect(t.get('w1')).toMatchObject({ status: 'completed', summary: 'Report ready', outputFile: '/tmp/w1.out', endTime: 5000 });
  });

  it('a background shell; killed and failed patches', () => {
    let t = run([sys('task_started', { task_id: 'b1', task_type: 'local_bash', description: 'pnpm test --watch', is_backgrounded: true })]);
    expect(t.get('b1')).toMatchObject({ status: 'running', isBackgrounded: true });
    t = run([sys('task_updated', { task_id: 'b1', patch: { status: 'killed', end_time: 4242 } })], t);
    expect(t.get('b1')).toMatchObject({ status: 'stopped', endTime: 4242 });
    t = run([sys('task_started', { task_id: 'm1', task_type: 'mcp_task', description: 'index' }), sys('task_updated', { task_id: 'm1', patch: { status: 'failed', error: 'boom' } })], t, 7000);
    expect(t.get('m1')).toMatchObject({ status: 'failed', error: 'boom', endTime: 7000 });
  });

  it('leaves agents to the agent map, ambient tasks out, and unknown ids alone', () => {
    const t = run([
      sys('task_started', { task_id: 'a1', task_type: 'local_agent', description: 'x' }),
      sys('task_started', { task_id: 'h1', task_type: 'local_bash', description: 'watcher', ambient: true }),
      sys('task_progress', { task_id: 'nope', usage: { total_tokens: 1, tool_uses: 1, duration_ms: 1 } }),
      sys('api_retry', { attempt: 1 }),
      { type: 'assistant' },
    ]);
    expect(t).toBe(EMPTY_TASKS);
  });

  it('process end stops what runs; a confirmed stop marks one', () => {
    const t = run([sys('task_started', { task_id: 'b1', task_type: 'local_bash', description: 'a' }), sys('task_started', { task_id: 'b2', task_type: 'local_bash', description: 'b' }), sys('task_notification', { task_id: 'b2', status: 'completed', output_file: '', summary: '' })]);
    const stopped = stopRunningTasks(t, 9);
    expect(stopped.get('b1')).toMatchObject({ status: 'stopped', endTime: 9 });
    expect(stopped.get('b2')!.status).toBe('completed');
    expect(markTaskStopped(t, 'b1', 3).get('b1')!.status).toBe('stopped');
    expect(markTaskStopped(t, 'b2')).toBe(t);
  });

  it('kinds and dots', () => {
    expect(['local_agent', 'local_workflow', 'local_bash', 'mcp_task', 'remote_agent'].map(kindOf)).toEqual(['agent', 'workflow', 'shell', 'mcp', 'task']);
    expect([dotOf('running'), dotOf('waiting'), dotOf('completed'), dotOf('failed'), dotOf('stopped')]).toEqual(['running', 'waiting', 'idle', 'failed', 'failed']);
  });
});

describe('paneRows', () => {
  it('lists agents and other tasks together: running oldest first, then finished newest first', () => {
    let agents = addAgent(EMPTY_AGENT_MAP, { taskId: 'a1', toolUseId: 'tu1', description: 'audit', startTime: 10 });
    agents = addAgent(agents, { taskId: 'a2', toolUseId: 'tu2', description: 'done one', startTime: 5 });
    agents = finishAgent(agents, { taskId: 'a2', status: 'completed', summary: 'all good', endTime: 50 });
    const others = run([sys('task_started', { task_id: 'b1', task_type: 'local_bash', description: 'watch' })], EMPTY_TASKS, 20);
    const rows = paneRows(agents, new Set(['a1']), new Map([['a1', { taskId: 'a1', description: 'audit', taskType: 'local_agent', startTime: 10, status: 'running' as const, recentTools: ['Grep'] }]]), others);
    expect(rows.map((r) => [r.taskId, r.kind, r.status, r.stoppable])).toEqual([
      ['a1', 'agent', 'waiting', true],
      ['b1', 'shell', 'running', true],
      ['a2', 'agent', 'completed', false],
    ]);
    expect(rows[0].activity).toBe('Grep');
    expect(rows[2].activity).toBe('all good');
  });

  it('a transcript-rebuilt agent cannot be stopped', () => {
    const agents = addAgent(EMPTY_AGENT_MAP, { taskId: 'call:tu9', toolUseId: 'tu9', startTime: 1 });
    expect(paneRows(agents, new Set(), new Map(), EMPTY_TASKS)[0].stoppable).toBe(false);
  });
});

describe('Session wiring', () => {
  it('feeds otherTasks from the stream and stops them when the process ends', async () => {
    let push!: (e: any) => void;
    let end!: () => void;
    const stream = {
      async *[Symbol.asyncIterator]() {
        const queue: any[] = [];
        let wake: (() => void) | undefined;
        let done = false;
        push = (e) => { queue.push(e); wake?.(); };
        end = () => { done = true; wake?.(); };
        for (;;) {
          while (queue.length) yield queue.shift();
          if (done) return;
          await new Promise<void>((r) => (wake = r));
          wake = undefined;
        }
      },
    };
    const session = new Session(async () => ({ config: () => ({}), launchClaude: () => stream }) as any, { currentSelection: signal(undefined) } as any, {});
    await session.launchClaude();
    await new Promise((r) => setTimeout(r, 0));
    push(sys('task_started', { task_id: 'w1', task_type: 'local_workflow', description: 'audit' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(session.otherTasks().get('w1')!.status).toBe('running');
    end();
    await new Promise((r) => setTimeout(r, 10));
    expect(session.otherTasks().get('w1')!.status).toBe('stopped');
  });
});

describe('trayHeadline', () => {
  const row = (kind: any, status: any) => ({ taskId: Math.random().toString(), kind, title: 't', status, startTime: 0, stoppable: false });
  it('names what runs by kind, waiting first', async () => {
    const { trayHeadline } = await import('../src/webview/src/core/backgroundTasks');
    expect(trayHeadline([row('agent', 'running'), row('agent', 'running'), row('workflow', 'running'), row('shell', 'running')])).toBe('2 agents, 1 workflow, 1 command running');
    expect(trayHeadline([row('agent', 'waiting'), row('agent', 'running')])).toBe('1 waiting for you · 2 agents running');
    expect(trayHeadline([row('agent', 'completed'), row('shell', 'failed'), row('agent', 'stopped'), row('agent', 'completed')])).toBe('2 finished · 1 failed · 1 stopped');
  });
});
