/**
 * The Agent map's two requests (agents-and-workflows, phase 3), in the six
 * places B2 names:
 *
 *   stop_subagent {taskId}              -> query.stopTask (sdk.d.ts L2991)
 *   get_subagent_transcript {sessionId, agentId}
 *                                       -> getSubagentMessages (sdk.d.ts L866)
 *
 * Official sender: index.js @3315029; handlers: extension.js @3049664 /
 * @3049731; dispatcher @3062759. Rejections: bad agentId, bad sessionId, no
 * running channel, a task the CLI no longer has.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { signal } from 'alien-signals';
import { ClaudeAgentService } from '../src/services/claude/ClaudeAgentService';
import { handleGetSubagentTranscript, SUBAGENT_ID } from '../src/services/claude/handlers/handlers';
import { BaseTransport } from '../src/webview/src/transport/BaseTransport';
import { Session } from '../src/webview/src/core/Session';
import { addAgent, EMPTY_AGENT_MAP } from '../src/webview/src/core/agentMap';

beforeAll(() => {
  (globalThis as any).window ??= {
    location: new URL('http://localhost/index.html'),
    history: { replaceState: () => {} },
  };
});

const SID = '3f2c8a10-5b7e-4d21-9a0c-1e2f3a4b5c6d';
const log = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() });

describe('stop_subagent (host)', () => {
  const svc = (stopTask: any) => {
    const s = new (ClaudeAgentService as any)(log(), {}, {}, {}, {}, {}, {}, {}, {}, {});
    s.channels = new Map([['ch1', { query: { stopTask } }]]);
    return s;
  };

  it('dispatches to query.stopTask and answers the bare response', async () => {
    const stopTask = vi.fn(async () => {});
    const s = svc(stopTask);
    const out = await s.processRequest(
      { type: 'request', requestId: 'r1', channelId: 'ch1', request: { type: 'stop_subagent', taskId: 'a1b2c3' } },
      undefined as any
    );
    expect(stopTask).toHaveBeenCalledWith('a1b2c3');
    expect(out).toEqual({ type: 'stop_subagent_response' });
  });

  it('a task the CLI no longer has is a shaped error, not a throw', async () => {
    const s = svc(vi.fn(async () => { throw new Error('No task found with ID: gone'); }));
    expect(await s.stopSubagent('ch1', 'gone')).toEqual({
      type: 'stop_subagent_response',
      error: 'Error: No task found with ID: gone',
    });
  });

  it('no running channel is the same shaped error', async () => {
    const stopTask = vi.fn();
    const s = svc(stopTask);
    expect((await s.stopSubagent('nope', 'a1')).error).toMatch(/Channel not found: nope/);
    expect((await s.stopSubagent(undefined, 'a1')).error).toMatch(/Channel not found/);
    expect(stopTask).not.toHaveBeenCalled();
  });

  it('refuses a task id that is not a non-empty string', async () => {
    const stopTask = vi.fn();
    const s = svc(stopTask);
    for (const bad of [undefined, 42, '', { id: 'x' }]) {
      expect((await s.stopSubagent('ch1', bad)).error).toMatch(/taskId must be a non-empty string/);
    }
    expect(stopTask).not.toHaveBeenCalled();
  });
});

describe('get_subagent_transcript (host)', () => {
  const context = (getSubagentMessages: any) =>
    ({
      logService: log(),
      sessionService: { getSubagentMessages },
      workspaceService: { getDefaultWorkspaceFolder: () => ({ uri: { fsPath: '/repo' } }) },
    }) as any;

  it('reads through the session service with the workspace as dir', async () => {
    const messages = [{ type: 'user', uuid: 'u', session_id: SID, message: {}, parent_tool_use_id: null, parent_agent_id: null }];
    const read = vi.fn(async () => messages);
    const out = await handleGetSubagentTranscript({ type: 'get_subagent_transcript', sessionId: SID, agentId: 'a1b2-c3_d4' }, context(read));
    expect(read).toHaveBeenCalledWith(SID, 'a1b2-c3_d4', '/repo');
    expect(out).toEqual({ type: 'get_subagent_transcript_response', messages });
  });

  it('refuses a bad session id or agent id before touching the disk (the official y0 + regex)', async () => {
    const read = vi.fn();
    const cases: Array<[unknown, unknown]> = [
      ['../../etc/passwd', 'a1'],
      ['not-a-session', 'a1'],
      [undefined, 'a1'],
      [SID, '../x'],
      [SID, 'a/b'],
      [SID, ''],
      [SID, 'x'.repeat(129)],
      [SID, 'has space'],
      [SID, 7],
    ];
    for (const [sessionId, agentId] of cases) {
      expect(
        await handleGetSubagentTranscript({ type: 'get_subagent_transcript', sessionId, agentId } as any, context(read))
      ).toEqual({ type: 'get_subagent_transcript_response', error: 'Not a session and agent id' });
    }
    expect(read).not.toHaveBeenCalled();
    expect(SUBAGENT_ID.test('x'.repeat(128))).toBe(true);
  });

  it('a read failure is a shaped error', async () => {
    const out = await handleGetSubagentTranscript(
      { type: 'get_subagent_transcript', sessionId: SID, agentId: 'a1' },
      context(vi.fn(async () => { throw new Error('ENOENT'); }))
    );
    expect(out).toEqual({ type: 'get_subagent_transcript_response', error: 'Error: ENOENT' });
  });

  it('is wired in the dispatcher, without a channel', async () => {
    const s = new (ClaudeAgentService as any)(log(), {}, {}, {}, {}, {}, {}, {}, {}, {});
    const read = vi.fn(async () => []);
    s.handlerContext = context(read);
    const out = await s.processRequest(
      { type: 'request', requestId: 'r1', request: { type: 'get_subagent_transcript', sessionId: SID, agentId: 'a1' } },
      undefined as any
    );
    expect(out).toEqual({ type: 'get_subagent_transcript_response', messages: [] });
  });
});

describe('BaseTransport senders (the official shapes)', () => {
  const t = () => {
    const sent: any[] = [];
    const transport = new (BaseTransport as any)();
    transport.send = (m: any) => sent.push(m);
    return { transport, sent };
  };

  it('stop_subagent is channel-scoped', () => {
    const { transport, sent } = t();
    void transport.stopSubagent('ch1', 'a1');
    expect(sent[0].channelId).toBe('ch1');
    expect(sent[0].request).toEqual({ type: 'stop_subagent', taskId: 'a1' });
  });

  it('get_subagent_transcript is not', () => {
    const { transport, sent } = t();
    void transport.getSubagentTranscript(SID, 'a1');
    expect(sent[0].channelId).toBeUndefined();
    expect(sent[0].request).toEqual({ type: 'get_subagent_transcript', sessionId: SID, agentId: 'a1' });
  });
});

describe('Session.stopSubagent / getSubagentTranscript', () => {
  const session = (transport: any, channel = true) => {
    const s = new Session(async () => transport, { currentSelection: signal(undefined) } as any, {});
    if (channel) (s as any).claudeChannelId('ch1');
    s.agentMapAgents(addAgent(EMPTY_AGENT_MAP, { taskId: 'a1', toolUseId: 'tu1', startTime: 1 }));
    return s;
  };

  it('marks a still-working agent stopped once the host confirms', async () => {
    const stopSubagent = vi.fn(async () => ({ type: 'stop_subagent_response' }));
    const s = session({ stopSubagent });
    await s.stopSubagent('a1');
    expect(stopSubagent).toHaveBeenCalledWith('ch1', 'a1');
    expect(s.agentMapAgents().get('a1')!.status).toBe('stopped');
  });

  it('throws the host error and leaves the agent alone', async () => {
    const s = session({ stopSubagent: async () => ({ type: 'stop_subagent_response', error: 'gone' }) });
    await expect(s.stopSubagent('a1')).rejects.toThrow('gone');
    expect(s.agentMapAgents().get('a1')!.status).toBe('working');
  });

  it('throws without a running process', async () => {
    const s = session({ stopSubagent: vi.fn() }, false);
    await expect(s.stopSubagent('a1')).rejects.toThrow('No running Claude process');
  });

  it('reads the transcript for the session; a provisional agent has none', async () => {
    const getSubagentTranscript = vi.fn(async () => ({ type: 'get_subagent_transcript_response', messages: [{ type: 'user' }] }));
    const s = session({ getSubagentTranscript });
    s.sessionId(SID);
    expect(await s.getSubagentTranscript('a1')).toEqual([{ type: 'user' }]);
    expect(getSubagentTranscript).toHaveBeenCalledWith(SID, 'a1');
    expect(await s.getSubagentTranscript('call:tu9')).toEqual([]);
    expect(getSubagentTranscript).toHaveBeenCalledTimes(1);
  });

  it('a transcript error is thrown, so the view shows its notice', async () => {
    const s = session({ getSubagentTranscript: async () => ({ error: 'Not a session and agent id' }) });
    s.sessionId(SID);
    await expect(s.getSubagentTranscript('a1')).rejects.toThrow('Not a session and agent id');
  });
});
