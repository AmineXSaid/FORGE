/**
 * Messages sent while the model is working (2026-09-23).
 *
 * The official has no queue of its own: a message typed during a turn is sent
 * at once, and the CLI holds it -- folding it into the running turn between
 * tool rounds, or running it as the next turn. Forge diverted it to a
 * `queueMessage` event nothing listened to, after clearing the box, so it was
 * lost; the send button was Stop for the whole turn; Escape did nothing; and
 * the host treated one `result` as "idle", so an endpoint switch could close a
 * channel with a message still queued in it.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_PROMPT_CHARS,
  capPrompt,
  isInterruptKey,
  permissionOwnsEscape,
  sendButtonLabel,
  sendButtonState,
} from '../src/webview/src/utils/composerSubmit';
import { noteInputSent, noteOutput, type TurnTracking } from '../src/services/claude/pendingInputs';
import { ClaudeAgentService } from '../src/services/claude/ClaudeAgentService';
import { signal } from 'alien-signals';
import { Session } from '../src/webview/src/core/Session';

describe('the composer while a turn runs (the official `e0` and send button)', () => {
  it('sends with text in the box, turn or not; stops only an empty box during a turn', () => {
    expect(sendButtonState(true, true)).toBe('enabled');
    expect(sendButtonState(true, false)).toBe('stop');
    expect(sendButtonState(false, true)).toBe('enabled');
    expect(sendButtonState(false, false)).toBe('disabled');
  });

  it('names the two faces as the official does', () => {
    expect(sendButtonLabel('stop')).toBe('Stop');
    expect(sendButtonLabel('enabled')).toBe('Send message');
    expect(sendButtonLabel('disabled')).toBe('Send message');
  });

  it('caps a prompt at 50,000 characters and says so', () => {
    const short = 'x'.repeat(MAX_PROMPT_CHARS);
    expect(capPrompt(short)).toBe(short);
    const long = capPrompt('y'.repeat(MAX_PROMPT_CHARS + 10));
    expect(long.startsWith('y'.repeat(MAX_PROMPT_CHARS))).toBe(true);
    expect(long.endsWith('\n\n[Message truncated - exceeded 50,000 character limit]')).toBe(true);
  });
});

describe('Escape stops the turn (the official `Az0` and `wo`)', () => {
  const esc = (over: Partial<KeyboardEvent> = {}) => ({
    key: 'Escape', defaultPrevented: false, repeat: false, altKey: false, ctrlKey: false,
    metaKey: false, shiftKey: false, isComposing: false, keyCode: 27, ...over,
  });

  it('takes a plain Escape', () => {
    expect(isInterruptKey(esc())).toBe(true);
  });

  it('leaves one a menu or dialog already took, a held key, a chord, and IME composition', () => {
    expect(isInterruptKey(esc({ defaultPrevented: true }))).toBe(false);
    expect(isInterruptKey(esc({ repeat: true }))).toBe(false);
    for (const mod of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
      expect(isInterruptKey(esc({ [mod]: true }))).toBe(false);
    }
    expect(isInterruptKey(esc({ isComposing: true }))).toBe(false);
    expect(isInterruptKey(esc({ keyCode: 229 }))).toBe(false);
    expect(isInterruptKey(esc({ key: 'Enter' }))).toBe(false);
  });

  it('gives Escape to a permission prompt that is up', () => {
    expect(permissionOwnsEscape(1)).toBe(true);
    expect(permissionOwnsEscape(0)).toBe(false);
    expect(permissionOwnsEscape(1, true)).toBe(false);
  });
});

describe('what the CLI still holds (pendingInputs.ts)', () => {
  const user = (uuid: string) => ({ type: 'user', uuid, message: { role: 'user', content: 'hi' } });
  const replay = (uuid: string) => ({ type: 'user', isReplay: true, uuid });

  it('one message, one turn: idle after its result', () => {
    const c: TurnTracking = {};
    noteInputSent(c, user('a'));
    expect(c.turnOpen).toBe(true);
    noteOutput(c, replay('a'));
    expect(noteOutput(c, { type: 'result', user_message_uuid: 'a', user_message_uuids: ['a'] })).toBe(true);
    expect(c.turnOpen).toBe(false);
  });

  it('a message sent mid-turn that the turn did not take keeps the channel open past that result', () => {
    const c: TurnTracking = {};
    noteInputSent(c, user('a'));
    noteOutput(c, replay('a'));
    noteInputSent(c, user('b'));
    expect(noteOutput(c, { type: 'result', user_message_uuid: 'a', user_message_uuids: ['a'] })).toBe(false);
    expect(c.turnOpen).toBe(true);
    noteOutput(c, replay('b'));
    expect(noteOutput(c, { type: 'result', user_message_uuid: 'b', user_message_uuids: ['b'] })).toBe(true);
  });

  it('a message folded into the running turn is consumed by that turn', () => {
    const c: TurnTracking = {};
    noteInputSent(c, user('a'));
    noteInputSent(c, user('b'));
    noteOutput(c, replay('a'));
    noteOutput(c, replay('b'));
    expect(noteOutput(c, { type: 'result', user_message_uuid: 'b', user_message_uuids: ['a', 'b'] })).toBe(true);
  });

  it('an older CLI that lists nothing is treated as before: the result ends it', () => {
    const c: TurnTracking = {};
    noteInputSent(c, user('a'));
    noteInputSent(c, user('b'));
    expect(noteOutput(c, { type: 'result' })).toBe(true);
    expect(c.pendingInputs?.size).toBe(0);
  });
});

describe('the host never closes a channel with a message still queued', () => {
  function host() {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() };
    const s = new (ClaudeAgentService as any)(
      log, {}, { getDefaultWorkspaceFolder: () => undefined }, {}, {}, {}, {},
      { getThinkingLevel: () => 'off', getAllowDangerouslySkipPermissions: () => false }, {}, {},
      { getStatus: () => ({}) },
      { onDidChangeHealth: () => ({ dispose() {} }) },
    );
    s.setTransport({ send: () => {}, onMessage: () => {} });
    s.getShowThinkingSummaries = async () => undefined;
    s.sendSessionStoreChanged = () => {};

    // A CLI whose output the test writes.
    const queue: any[] = [];
    let wake: (() => void) | undefined;
    const stream = {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (queue.length) yield queue.shift();
          await new Promise<void>((r) => (wake = r));
        }
      },
      return() {},
    };
    s.spawnClaude = async () => stream;
    const closed: string[] = [];
    s.closeChannel = (id: string) => closed.push(id);
    const emit = async (m: any) => {
      queue.push(m);
      wake?.();
      await new Promise((r) => setTimeout(r, 0));
    };
    return { s, emit, closed };
  }
  const user = (uuid: string) => ({ type: 'user', uuid, session_id: '', parent_tool_use_id: null, message: { role: 'user', content: 'hi' } });

  it('an endpoint switch waits for the queued message`s turn, then recycles', async () => {
    const { s, emit, closed } = host();
    await s.launchClaude('c1', null, '/repo', null, 'default', null);
    s.transportMessage('c1', user('a'), false);
    await emit({ type: 'user', isReplay: true, uuid: 'a' });
    s.transportMessage('c1', user('b'), false); // typed while the model works
    await emit({ type: 'result', subtype: 'success', user_message_uuid: 'a', user_message_uuids: ['a'] });

    s.recycleIdleChannels();
    expect(closed).toEqual([]); // "b" is still in the CLI

    await emit({ type: 'user', isReplay: true, uuid: 'b' });
    await emit({ type: 'result', subtype: 'success', user_message_uuid: 'b', user_message_uuids: ['b'] });
    s.recycleIdleChannels();
    expect(closed).toEqual(['c1']);
  });

  it('a stale channel is retired after the last queued message has had its turn, not before', async () => {
    const { s, emit, closed } = host();
    await s.launchClaude('c2', null, '/repo', null, 'default', null);
    s.transportMessage('c2', user('a'), false);
    s.transportMessage('c2', user('b'), false);
    s.endpointGeneration += 1; // the endpoint changed during the turn
    await emit({ type: 'result', subtype: 'success', user_message_uuid: 'a', user_message_uuids: ['a'] });
    expect(closed).toEqual([]);
    await emit({ type: 'result', subtype: 'success', user_message_uuid: 'b', user_message_uuids: ['b'] });
    expect(closed).toEqual(['c2']);
  });
});

describe('Session: a message sent while the model works', () => {
  function makeSession(applied?: unknown) {
    const sent: any[] = [];
    const calls: string[] = [];
    const connection = {
      claudeConfig: signal({ commands: [], models: [], accountInfo: null, claudeSettings: { effective: {} } }),
      config: signal({ modelSetting: 'default' }),
      permissionRequests: signal([]),
      sendInput: vi.fn((_channel: string, message: unknown) => sent.push(message)),
      getAppliedSettings: vi.fn(async () => {
        calls.push('get_applied_settings');
        return applied;
      }),
    };
    const session = new Session(async () => connection as never, {
      currentSelection: signal(undefined),
      commandRegistry: { registerAction: () => {} },
      fileOpener: { open: () => {}, openContent: async () => undefined },
    } as never);
    (session as any).claudeChannelId('ch1');
    const feed = (m: unknown) => (session as any).processIncomingMessage(m);
    const settle = async () => {
      for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
    };
    return { session, sent, calls, feed, settle };
  }

  it('goes to the CLI at once, with its uuid and origin, and stays on screen once', async () => {
    const { session, sent, feed } = makeSession();
    await session.send('first', [], false, { kind: 'human' });
    feed({ type: 'system', subtype: 'init', session_id: 's1' });
    expect(session.busy()).toBe(true);

    await session.send('second', [], false, { kind: 'human' }); // mid-turn
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ type: 'user', origin: { kind: 'human' }, parent_tool_use_id: null });
    expect(typeof sent[1].uuid).toBe('string');

    // The CLI takes it and echoes it: no second row.
    const rows = () => session.messages().filter((m: any) => m.type === 'user').length;
    expect(rows()).toBe(2);
    feed({ type: 'user', isReplay: true, uuid: sent[1].uuid, message: sent[1].message });
    expect(rows()).toBe(2);
  });

  it('re-reads what a slash command applied after the turn that ran it, not the turn it was sent during', async () => {
    const { session, sent, calls, feed, settle } = makeSession({ effort: 'high' });
    await session.send('explain this', [], false, { kind: 'human' });
    feed({ type: 'system', subtype: 'init', session_id: 's1' });
    await session.send('/effort high', [], false, { kind: 'human' }); // queued in the CLI

    feed({ type: 'result', subtype: 'success', session_id: 's1' }); // the first turn ends
    await settle();
    expect(calls).toEqual([]);

    feed({ type: 'system', subtype: 'init', session_id: 's1' });
    feed({ type: 'user', isReplay: true, uuid: sent[1].uuid, message: sent[1].message }); // the CLI takes it
    feed({ type: 'result', subtype: 'success', session_id: 's1' });
    await settle();
    expect(calls).toEqual(['get_applied_settings']);
  });

  it('carries the editor selection with a typed message, never with a slash command', async () => {
    const { session, sent } = makeSession();
    session.selection({ filePath: '/repo/a.ts', startLine: 3, endLine: 4, startColumn: 0, endColumn: 0, selectedText: 'x' } as never);
    await session.send('/compact', [], true, { kind: 'human' });
    expect(JSON.stringify(sent[0].message.content)).not.toContain('ide_selection');
    await session.send('look here', [], true, { kind: 'human' });
    expect(JSON.stringify(sent[1].message.content)).toContain('ide_selection');
  });
});
