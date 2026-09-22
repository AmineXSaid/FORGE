/**
 * Step 24: `rewind_code`.
 *
 * Host: `rewindCode.ts` (the validator and the field forwarding),
 * `ClaudeAgentService.rewindCode` with its `requireChannel` / throwing error
 * path, and the dispatcher case.
 * Webview: `core/rewind.ts` (`TR`, `VU0`, `mo`'s enable rule, `yH0`'s list and
 * `I85`), `Session.rewindCode` / `insertMetaMessage`, and the transport method.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { signal } from 'alien-signals';
import {
  planRewindCode,
  rewindResponseFields,
  validMessageUuid,
} from '../src/services/claude/rewindCode';
import { ClaudeAgentService } from '../src/services/claude/ClaudeAgentService';
import { convertMessage } from '../src/services/claude/ClaudeSessionService';
import { buildExtraArgs, forgeBaseCliArgs } from '../src/services/claude/cliArgs';
import {
  SKIPPED_LINKS_REASON,
  relativeTime,
  relativeToCwd,
  rewindConfirmEnabled,
  rewindResultMessage,
  rewindTargets,
} from '../src/webview/src/core/rewind';
import { Session } from '../src/webview/src/core/Session';
import { BaseTransport } from '../src/webview/src/transport/BaseTransport';
import { Message as MessageModel } from '../src/webview/src/models/Message';
import { processAndAttachMessage } from '../src/webview/src/utils/messageUtils';

beforeAll(() => {
  (globalThis as any).window ??= {
    location: new URL('http://localhost/index.html'),
    history: { replaceState: () => {} },
  };
});

const U1 = '11111111-0000-4000-8000-000000000001';
const U2 = '11111111-0000-4000-8000-000000000002';

// ---------------------------------------------------------------------------
// The validator (B3): the webview is untrusted input
// ---------------------------------------------------------------------------

describe('validMessageUuid', () => {
  it('accepts a uuid in either case', () => {
    expect(validMessageUuid(U1)).toBe(U1);
    expect(validMessageUuid(U1.toUpperCase())).toBe(U1.toUpperCase());
  });

  it('refuses anything that is not one', () => {
    for (const bad of [
      '',
      '   ',
      'not-a-uuid',
      '../../etc/passwd',
      `${U1}/../x`,
      `${U1}\u0000`,
      `${U1} `,
      U1.slice(0, -1),
      `${U1}0`,
      42,
      null,
      undefined,
      {},
      [U1],
      true,
    ]) {
      expect(validMessageUuid(bad)).toBeNull();
    }
  });
});

describe('planRewindCode', () => {
  it('takes a uuid with no dryRun as the real run', () => {
    expect(planRewindCode({ type: 'rewind_code', userMessageId: U1 })).toEqual({
      userMessageId: U1,
      dryRun: undefined,
    });
  });

  it('takes dryRun true and false', () => {
    expect(planRewindCode({ userMessageId: U1, dryRun: true })?.dryRun).toBe(true);
    expect(planRewindCode({ userMessageId: U1, dryRun: false })?.dryRun).toBe(false);
  });

  it('accepts an explicit undefined dryRun, because the sender always sets the key', () => {
    // `{...,dryRun:Z?.dryRun}` puts the key on the wire with value undefined.
    expect(planRewindCode({ userMessageId: U1, dryRun: undefined })).toEqual({
      userMessageId: U1,
      dryRun: undefined,
    });
  });

  it('refuses a bad id', () => {
    expect(planRewindCode({ userMessageId: 'nope', dryRun: true })).toBeNull();
    expect(planRewindCode({ userMessageId: '../../x' })).toBeNull();
    expect(planRewindCode({ dryRun: true })).toBeNull();
  });

  it('refuses a dryRun that is neither boolean nor absent', () => {
    for (const bad of ['true', 1, 0, null, {}, []]) {
      expect(planRewindCode({ userMessageId: U1, dryRun: bad })).toBeNull();
    }
  });

  it('refuses a non-object request', () => {
    for (const bad of [null, undefined, 'rewind_code', 7]) {
      expect(planRewindCode(bad)).toBeNull();
    }
  });
});

describe('rewindResponseFields', () => {
  it('forwards the official five and omits absent keys', () => {
    expect(rewindResponseFields({ canRewind: true })).toEqual({ canRewind: true });
    expect(
      rewindResponseFields({
        canRewind: true,
        filesChanged: ['a.ts'],
        insertions: 3,
        deletions: 1,
        skippedLinks: 2,
      })
    ).toEqual({ canRewind: true, filesChanged: ['a.ts'], insertions: 3, deletions: 1, skippedLinks: 2 });
  });

  it('never forwards `error` -- the official throws it instead', () => {
    const out = rewindResponseFields({ canRewind: false, error: 'no checkpoint' });
    expect(out).toEqual({ canRewind: false });
    expect('error' in out).toBe(false);
  });

  it('keeps zeroes, which are meaningful counts', () => {
    expect(rewindResponseFields({ canRewind: true, insertions: 0, deletions: 0, filesChanged: [] })).toEqual({
      canRewind: true,
      insertions: 0,
      deletions: 0,
      filesChanged: [],
    });
  });
});

// ---------------------------------------------------------------------------
// The host: withChannel, the SDK call and the throwing error path
// ---------------------------------------------------------------------------

describe('ClaudeAgentService.rewindCode', () => {
  const svc = (rewindFiles: any) => {
    const log = { info: () => {}, warn: () => {}, error: () => {} };
    const s = new (ClaudeAgentService as any)(log, {}, {}, {}, {}, {}, {}, {}, {}, {});
    s.channels = new Map([['ch1', { query: { rewindFiles } }]]);
    return s;
  };

  it('passes the id and dryRun straight to query.rewindFiles', async () => {
    const rewindFiles = vi.fn(async () => ({ canRewind: true, filesChanged: ['a.ts'], insertions: 2, deletions: 1 }));
    const s = svc(rewindFiles);
    const out = await s.processRequest(
      { type: 'request', requestId: 'r1', channelId: 'ch1', request: { type: 'rewind_code', userMessageId: U1, dryRun: true } },
      undefined as any
    );
    expect(rewindFiles).toHaveBeenCalledWith(U1, { dryRun: true });
    expect(out).toEqual({
      type: 'rewind_code_response',
      canRewind: true,
      filesChanged: ['a.ts'],
      insertions: 2,
      deletions: 1,
    });
  });

  it('sends `{dryRun: undefined}` for the real run, as the official does', async () => {
    const rewindFiles = vi.fn(async () => ({ canRewind: true, skippedLinks: 1 }));
    const s = svc(rewindFiles);
    const out = await s.rewindCode('ch1', { type: 'rewind_code', userMessageId: U1 });
    expect(rewindFiles).toHaveBeenCalledWith(U1, { dryRun: undefined });
    expect(out).toEqual({ type: 'rewind_code_response', canRewind: true, skippedLinks: 1 });
  });

  it('throws `result.error`, so the webview sees a rejected request', async () => {
    const s = svc(async () => ({ canRewind: false, error: 'no file checkpoint found' }));
    await expect(s.rewindCode('ch1', { userMessageId: U1 })).rejects.toThrow('no file checkpoint found');
  });

  it('throws when the channel is not open (the official `withChannel`)', async () => {
    const s = svc(async () => ({ canRewind: true }));
    await expect(s.rewindCode('nope', { userMessageId: U1 })).rejects.toThrow('Channel not found: nope');
    await expect(s.rewindCode(undefined, { userMessageId: U1 })).rejects.toThrow('Channel not found');
  });

  it('refuses a bad id before it reaches the channel', async () => {
    const rewindFiles = vi.fn(async () => ({ canRewind: true }));
    const s = svc(rewindFiles);
    expect(await s.rewindCode('ch1', { userMessageId: '../../etc/passwd' })).toEqual({
      type: 'rewind_code_response',
      canRewind: false,
    });
    expect(await s.rewindCode('ch1', { userMessageId: U1, dryRun: 'yes' })).toEqual({
      type: 'rewind_code_response',
      canRewind: false,
    });
    expect(rewindFiles).not.toHaveBeenCalled();
  });

  it('refuses a bad id even when the channel does not exist, without throwing', async () => {
    // Validation comes first, so a junk id is never the reason a channel lookup
    // leaks the channel list through an error message.
    const s = svc(async () => ({ canRewind: true }));
    expect(await s.rewindCode('nope', { userMessageId: 'junk' })).toEqual({
      type: 'rewind_code_response',
      canRewind: false,
    });
  });
});

// ---------------------------------------------------------------------------
// The webview's ported helpers
// ---------------------------------------------------------------------------

describe('rewindResultMessage (TR)', () => {
  it('reads as plain success for 0 and undefined', () => {
    expect(rewindResultMessage(undefined)).toBe('Code rewind successful');
    expect(rewindResultMessage(0)).toBe('Code rewind successful');
  });

  it('singularises one skipped file', () => {
    expect(rewindResultMessage(1)).toBe(`Code rewind completed, but 1 file was skipped: ${SKIPPED_LINKS_REASON}`);
  });

  it('pluralises more than one', () => {
    expect(rewindResultMessage(3)).toBe(`Code rewind completed, but 3 files were skipped: ${SKIPPED_LINKS_REASON}`);
  });
});

describe('relativeToCwd (VU0)', () => {
  it('strips the cwd and the separator, both slashes', () => {
    expect(relativeToCwd('/repo/src/a.ts', '/repo')).toBe('src/a.ts');
    expect(relativeToCwd('C:\\repo\\src\\a.ts', 'C:\\repo')).toBe('src\\a.ts');
  });

  it('leaves a path that is not under the cwd alone', () => {
    expect(relativeToCwd('/elsewhere/a.ts', '/repo')).toBe('/elsewhere/a.ts');
  });

  it('leaves everything alone with no cwd', () => {
    expect(relativeToCwd('/repo/src/a.ts', undefined)).toBe('/repo/src/a.ts');
    expect(relativeToCwd('/repo/src/a.ts', '')).toBe('/repo/src/a.ts');
  });

  it('handles the cwd itself and a cwd with a trailing separator', () => {
    expect(relativeToCwd('/repo', '/repo')).toBe('');
    expect(relativeToCwd('/repo/src/a.ts', '/repo/')).toBe('src/a.ts');
  });
});

describe('rewindConfirmEnabled (mo`s `B`)', () => {
  const changed = { canRewind: true, filesChanged: ['a.ts'] };
  const unchanged = { canRewind: true, filesChanged: [] };

  it('is off while the dry run is in flight', () => {
    expect(rewindConfirmEnabled(null, true, false)).toBe(false);
    expect(rewindConfirmEnabled(changed, true, false)).toBe(false);
  });

  it('is on once files changed', () => {
    expect(rewindConfirmEnabled(changed, false, false)).toBe(true);
  });

  it('is off for a no-change rewind with no fork after it', () => {
    expect(rewindConfirmEnabled(unchanged, false, false)).toBe(false);
  });

  it('is on for a no-change rewind when a fork follows', () => {
    expect(rewindConfirmEnabled(unchanged, false, true)).toBe(true);
  });

  it('is off when the dry run said it cannot rewind', () => {
    expect(rewindConfirmEnabled({ canRewind: false, filesChanged: ['a.ts'] }, false, true)).toBe(false);
    expect(rewindConfirmEnabled(null, false, true)).toBe(false);
  });
});

describe('rewindTargets (yH0`s list)', () => {
  const row = (over: Partial<Parameters<typeof rewindTargets>[0][number]>) => ({
    type: 'user',
    uuid: undefined,
    timestamp: 0,
    text: 'hi',
    ...over,
  });

  it('lists user prompts newest first, with the previous message as the resume point', () => {
    expect(
      rewindTargets([
        row({ uuid: 'u1', text: 'first', timestamp: 1 }),
        row({ type: 'assistant', uuid: 'a1', text: 'reply', timestamp: 2 }),
        row({ uuid: 'u2', text: 'second', timestamp: 3 }),
      ])
    ).toEqual([
      { uuid: 'u2', promptText: 'second', resumeAtMessageId: 'a1', timestamp: 3 },
      { uuid: 'u1', promptText: 'first', resumeAtMessageId: undefined, timestamp: 1 },
    ]);
  });

  it('skips synthetic, subagent, uuid-less and empty rows', () => {
    expect(
      rewindTargets([
        row({ uuid: 'u1', isSynthetic: true }),
        row({ uuid: 'u2', parentToolUseId: 'tool-1' }),
        row({ uuid: undefined }),
        row({ uuid: 'u4', text: '   ' }),
        row({ type: 'assistant', uuid: 'a1' }),
      ])
    ).toEqual([]);
  });

  it('trims the prompt text', () => {
    expect(rewindTargets([row({ uuid: 'u1', text: '  padded  ' })])[0]!.promptText).toBe('padded');
  });

  it('walks back past rows with no uuid to find the resume point', () => {
    const out = rewindTargets([
      row({ type: 'assistant', uuid: 'a1' }),
      row({ type: 'assistant', uuid: undefined }),
      row({ uuid: 'u2' }),
    ]);
    expect(out[0]!.resumeAtMessageId).toBe('a1');
  });
});

describe('relativeTime (I85)', () => {
  const now = 1_000_000_000_000;
  it('matches the official thresholds', () => {
    expect(relativeTime(now, now)).toBe('just now');
    expect(relativeTime(now - 59_000, now)).toBe('just now');
    expect(relativeTime(now - 60_000, now)).toBe('1m ago');
    expect(relativeTime(now - 59 * 60_000, now)).toBe('59m ago');
    expect(relativeTime(now - 60 * 60_000, now)).toBe('1h ago');
    expect(relativeTime(now - 23 * 3_600_000, now)).toBe('23h ago');
    expect(relativeTime(now - 24 * 3_600_000, now)).toBe('1d ago');
    expect(relativeTime(now - 10 * 24 * 3_600_000, now)).toBe('10d ago');
  });
});

// ---------------------------------------------------------------------------
// The transport and the session
// ---------------------------------------------------------------------------

describe('BaseTransport.rewindCode', () => {
  const t = () => {
    const sent: any[] = [];
    const transport = new (BaseTransport as any)();
    transport.send = (m: any) => sent.push(m);
    return { transport, sent };
  };

  it('is channel-scoped and carries dryRun', () => {
    const { transport, sent } = t();
    void transport.rewindCode('ch1', U1, { dryRun: true });
    expect(sent[0].channelId).toBe('ch1');
    expect(sent[0].request).toEqual({ type: 'rewind_code', userMessageId: U1, dryRun: true });
  });

  it('puts the dryRun key on the wire as undefined with no options', () => {
    const { transport, sent } = t();
    void transport.rewindCode('ch1', U1);
    expect(sent[0].request).toEqual({ type: 'rewind_code', userMessageId: U1, dryRun: undefined });
    expect('dryRun' in sent[0].request).toBe(true);
  });
});

describe('Session.rewindCode / insertMetaMessage', () => {
  const sessionContext = {
    currentSelection: signal(undefined),
    commandRegistry: { registerAction: () => {} },
    fileOpener: {},
    renameTab: () => {},
  } as any;
  const session = (connection?: unknown) =>
    new Session(async () => (connection ?? {}) as never, sessionContext, {} as any);

  it('throws with no connection', async () => {
    const s = session();
    (s as any).claudeChannelId('ch1');
    await expect(s.rewindCode(U1)).rejects.toThrow('No active session');
  });

  it('throws with a connection but no channel -- there is nothing to rewind against', async () => {
    const rewindCode = vi.fn(async () => ({ type: 'rewind_code_response', canRewind: true }));
    const s = session({ rewindCode });
    s.connection({ rewindCode } as any);
    await expect(s.rewindCode(U1)).rejects.toThrow('No active session');
    expect(rewindCode).not.toHaveBeenCalled();
  });

  it('calls the connection with the channel id', async () => {
    const rewindCode = vi.fn(async () => ({ type: 'rewind_code_response', canRewind: true }));
    const s = session({ rewindCode });
    (s as any).claudeChannelId('ch1');
    s.connection({ rewindCode } as any);
    await s.rewindCode(U1, { dryRun: true });
    expect(rewindCode).toHaveBeenCalledWith('ch1', U1, { dryRun: true });
  });

  it('routes showNotification to the app context', () => {
    const showNotification = vi.fn(async () => undefined);
    const s = new Session(async () => ({}) as never, { ...sessionContext, showNotification }, {} as any);
    s.showNotification('Code rewind completed, but 1 file was skipped', 'warning');
    expect(showNotification).toHaveBeenCalledWith('Code rewind completed, but 1 file was skipped', 'warning');
  });

  it('appends a meta row with one text block and a fresh uuid', () => {
    const s = session();
    (globalThis as any).crypto ??= {};
    if (!(globalThis as any).crypto.randomUUID) (globalThis as any).crypto.randomUUID = () => U2;
    s.insertMetaMessage('Code rewind successful');
    const messages = s.messages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('meta');
    expect(messages[0].uuid).toBeTruthy();
    expect(messages[0].isEmpty).toBe(false);
    expect((messages[0].message.content as any[])[0].content).toEqual({
      type: 'text',
      text: 'Code rewind successful',
    });
  });

  it('keeps earlier rows', () => {
    const s = session();
    s.insertMetaMessage('one');
    s.insertMetaMessage('two');
    expect(s.messages().map((m: any) => m.message.content[0].content.text)).toEqual(['one', 'two']);
  });
});

// ---------------------------------------------------------------------------
// Where the user-message uuid comes from (the thing rewind and fork key off)
// ---------------------------------------------------------------------------

describe('buildUserMessage mints a uuid, as the official does', () => {
  const sessionContext = {
    currentSelection: signal(undefined),
    commandRegistry: { registerAction: () => {} },
    fileOpener: {},
    renameTab: () => {},
  } as any;

  it('puts a fresh uuid on the message it sends to the CLI', () => {
    const s = new Session(async () => ({}) as never, sessionContext, {} as any);
    const a = (s as any).buildUserMessage('hello', []);
    const b = (s as any).buildUserMessage('hello again', []);
    expect(a.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(b.uuid).not.toBe(a.uuid);
    // The rest of the official `U` shape is unchanged.
    expect(a.type).toBe('user');
    expect(a.session_id).toBe('');
    expect(a.parent_tool_use_id).toBeNull();
  });

  it('carries that uuid onto the transcript row', () => {
    const s = new Session(async () => ({}) as never, sessionContext, {} as any);
    const raw = (s as any).buildUserMessage('hello', []);
    const row = MessageModel.fromRaw(raw);
    expect(row?.uuid).toBe(raw.uuid);
  });
});

describe('processAndAttachMessage: the replay guard', () => {
  const userRow = (uuid: string | undefined, text: string) =>
    MessageModel.fromRaw({ type: 'user', uuid, message: { role: 'user', content: text } })!;

  it('drops the echo of a message already on screen', () => {
    const messages = [userRow(U1, 'hello')];
    processAndAttachMessage(messages, {
      type: 'user',
      uuid: U1,
      isReplay: true,
      message: { role: 'user', content: 'hello' },
    });
    expect(messages).toHaveLength(1);
  });

  it('keeps a replayed message the webview never sent', () => {
    const messages = [userRow(U1, 'hello')];
    processAndAttachMessage(messages, {
      type: 'user',
      uuid: U2,
      isReplay: true,
      message: { role: 'user', content: 'injected by a hook' },
    });
    expect(messages).toHaveLength(2);
    expect(messages[1]!.uuid).toBe(U2);
  });

  it('keeps a replayed message with no uuid, as the official does', () => {
    const messages = [userRow(U1, 'hello')];
    processAndAttachMessage(messages, {
      type: 'user',
      isReplay: true,
      message: { role: 'user', content: 'no uuid' },
    });
    expect(messages).toHaveLength(2);
  });

  it('does not touch a normal (non-replay) message with a duplicate uuid', () => {
    // Only `isReplay` rows are deduped; a plain stream row is appended the way
    // it always was, so nothing about the live transcript changes.
    const messages = [userRow(U1, 'hello')];
    processAndAttachMessage(messages, { type: 'user', uuid: U1, message: { role: 'user', content: 'hello' } });
    expect(messages).toHaveLength(2);
  });

  it('still attaches a tool_result carried by a dropped echo', () => {
    const assistant = MessageModel.fromRaw({
      type: 'assistant',
      uuid: 'a1',
      message: { role: 'assistant', id: 'msg_1', content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: {} }] },
    })!;
    const echo = userRow(U1, 'x');
    const messages = [assistant, echo];
    processAndAttachMessage(messages, {
      type: 'user',
      uuid: U1,
      isReplay: true,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'done' }] },
    });
    expect(messages).toHaveLength(2);
    const wrapper = (assistant.message.content as any[])[0];
    expect(wrapper.toolResult().content).toBe('done');
  });
});

describe('convertMessage carries the transcript uuid', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    uuid: U1,
    sessionId: 'ssssssss-0000-4000-8000-000000000009',
    timestamp: '2026-09-19T10:00:00.000Z',
    type: 'user' as const,
    message: { role: 'user', content: 'hello' },
    ...over,
  });

  it('puts the row uuid on `uuid` and the session id on `session_id`', () => {
    const out = convertMessage(row() as any);
    expect(out.uuid).toBe(U1);
    expect(out.session_id).toBe('ssssssss-0000-4000-8000-000000000009');
  });

  it('does the same for an assistant row, and does not overwrite uuid with the API message id', () => {
    const out = convertMessage(row({ type: 'assistant', message: { role: 'assistant', id: 'msg_abc', content: [] } }) as any);
    expect(out.uuid).toBe(U1);
    expect(out.uuid).not.toBe('msg_abc');
    expect(out.session_id).toBe('ssssssss-0000-4000-8000-000000000009');
  });

  it('survives the trip through Message.fromRaw, which is what the picker reads', () => {
    const loaded = MessageModel.fromRaw(convertMessage(row() as any));
    expect(loaded?.uuid).toBe(U1);
    // `betaMessageId` is still derived from message.id, not from the row uuid.
    const assistant = MessageModel.fromRaw(
      convertMessage(row({ type: 'assistant', message: { role: 'assistant', id: 'msg_abc', content: [{ type: 'text', text: 'hi' }] } }) as any)
    );
    expect(assistant?.uuid).toBe(U1);
    expect(assistant?.betaMessageId).toBe('msg_abc');
  });

  it('keeps dropping meta, system and attachment rows', () => {
    expect(convertMessage(row({ isMeta: true }) as any)).toBeUndefined();
    expect(convertMessage(row({ type: 'system' }) as any)).toBeUndefined();
    expect(convertMessage(row({ type: 'attachment' }) as any)).toBeUndefined();
  });
});

describe('--replay-user-messages survives the cliArgs gate', () => {
  const base = forgeBaseCliArgs('/home/u/.claude/forge.json');

  it('is in the base map Forge actually launches with', () => {
    // Asserted against the exported map ClaudeSdkService.query() passes, not a
    // copy, so deleting the flag there fails here.
    expect(base).toEqual({
      'debug': null,
      'debug-to-stderr': null,
      'replay-user-messages': null,
      'settings': '/home/u/.claude/forge.json',
    });
  });

  it('is carried through from the base map', () => {
    const { extraArgs, rejected } = buildExtraArgs(base, undefined);
    expect(extraArgs).toHaveProperty('replay-user-messages', null);
    expect(rejected).toEqual([]);
  });

  it('is not a PROTOCOL flag, so a user can also set it without being refused', () => {
    const { extraArgs, rejected } = buildExtraArgs({}, { 'replay-user-messages': true });
    expect(rejected).toEqual([]);
    expect(extraArgs).toHaveProperty('replay-user-messages');
  });

  it('can still be turned off by the user, the way any base flag can', () => {
    const { extraArgs } = buildExtraArgs(base, { 'replay-user-messages': false });
    expect(extraArgs).not.toHaveProperty('replay-user-messages');
  });
});

// A signal import is needed for the Session fake's shape in some environments.
void signal;
