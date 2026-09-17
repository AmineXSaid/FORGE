/**
 * The message stream after the Agent SDK upgrade (0.1.77 -> 0.3.274).
 *
 * `SDKMessage` grew from 11 members to 39: new `system` subtypes and four new
 * top-level types. The webview must keep drawing rows only for user and
 * assistant messages, and the fields 0.3.x adds to assistant messages and
 * stream events must not break the streamed-row replacement from step 03.
 *
 * The type-level checks below fail `tsc` (not vitest, which strips types) if a
 * later SDK adds or renames a member without these lists being updated. The
 * project tsconfig excludes specs, so check this file on its own when upgrading
 * again; docs/sdk-upgrade.md has the command.
 */
import { describe, expect, it } from 'vitest';
import type { PermissionMode, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { StreamAssembler } from '../src/webview/src/models/StreamAssembler';
import { Message } from '../src/webview/src/models/Message';
import type { ContentBlockWrapper } from '../src/webview/src/models/ContentBlockWrapper';
import { processAndAttachMessage } from '../src/webview/src/utils/messageUtils';

/** Every top-level `type` in `SDKMessage` (sdk.d.ts L5002). */
const TOP_LEVEL_TYPES = [
  'assistant',
  'user',
  'result',
  'system',
  'stream_event',
  'tool_progress',
  'auth_status',
  'tool_use_summary',
  'rate_limit_event',
  'prompt_suggestion',
  'conversation_reset',
] as const satisfies readonly SDKMessage['type'][];

/** Every `subtype` of a `system` member of `SDKMessage`. */
const SYSTEM_SUBTYPES = [
  'init',
  'compact_boundary',
  'status',
  'api_retry',
  'control_request_progress',
  'model_refusal_fallback',
  'model_refusal_no_fallback',
  'local_command_output',
  'hook_started',
  'hook_progress',
  'hook_response',
  'plugin_install',
  'task_notification',
  'task_started',
  'task_updated',
  'task_progress',
  'background_tasks_changed',
  'thinking_tokens',
  'session_state_changed',
  'worker_shutting_down',
  'commands_changed',
  'notification',
  'files_persisted',
  'memory_recall',
  'elicitation_complete',
  'permission_denied',
  'mirror_error',
  'informational',
] as const satisfies readonly Extract<SDKMessage, { type: 'system' }>['subtype'][];

// Exhaustive: nothing in the SDK's union is missing from the lists above.
type Missing<All, Listed> = [Exclude<All, Listed>] extends [never] ? true : Exclude<All, Listed>;
const allTopLevelListed: Missing<SDKMessage['type'], (typeof TOP_LEVEL_TYPES)[number]> = true;
const allSystemListed: Missing<Extract<SDKMessage, { type: 'system' }>['subtype'], (typeof SYSTEM_SUBTYPES)[number]> = true;
// Session.ts stores `session_id` from every system frame, so it must be required on all of them.
const systemFramesCarrySessionId: Extract<SDKMessage, { type: 'system' }>['session_id'] extends string ? true : false = true;
// 'delegate' left PermissionMode; 'auto' joined it.
const delegateRemoved: 'delegate' extends PermissionMode ? false : true = true;
const autoAdded: 'auto' extends PermissionMode ? true : false = true;

const wrappersOf = (m: Message) => m.message.content as ContentBlockWrapper[];

/** Frames that are not user or assistant messages, one per member of the union. */
function nonRowFrames(): Array<Record<string, unknown>> {
  const base = { uuid: '00000000-0000-4000-8000-000000000000', session_id: 'sess-1' };
  const frames: Array<Record<string, unknown>> = SYSTEM_SUBTYPES.map((subtype) => ({ ...base, type: 'system', subtype }));
  for (const type of TOP_LEVEL_TYPES) {
    if (type === 'assistant' || type === 'user' || type === 'system') continue;
    frames.push({ ...base, type, subtype: type === 'result' ? 'success' : undefined });
  }
  return frames;
}

describe('SDKMessage 0.3.274: frames that never become transcript rows', () => {
  it('lists the whole union (checked by tsc)', () => {
    expect([allTopLevelListed, allSystemListed, systemFramesCarrySessionId, delegateRemoved, autoAdded]).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(TOP_LEVEL_TYPES).toHaveLength(11);
    expect(SYSTEM_SUBTYPES).toHaveLength(28);
  });

  it('Message.fromRaw returns null for every non user/assistant frame', () => {
    for (const frame of nonRowFrames()) {
      expect(Message.fromRaw(frame), `${frame.type}/${frame.subtype ?? ''}`).toBeNull();
    }
  });

  it('processAndAttachMessage adds no row for them, streaming or not', () => {
    const existing = Message.fromRaw({ type: 'user', message: { role: 'user', content: 'hi' } })!;
    for (const streaming of [false, true]) {
      const messages = [existing];
      for (const frame of nonRowFrames()) processAndAttachMessage(messages, frame, streaming);
      expect(messages).toEqual([existing]);
    }
  });

  it('a user replay frame (isReplay) still renders as a user row', () => {
    const row = Message.fromRaw({
      type: 'user',
      isReplay: true,
      uuid: 'u-replay',
      session_id: 'sess-1',
      parent_tool_use_id: null,
      timestamp: '2026-09-17T10:00:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'again' }] },
    });
    expect(row?.type).toBe('user');
    expect(row?.uuid).toBe('u-replay');
  });
});

describe('0.3.x fields on assistant messages and stream events', () => {
  function stream() {
    const messages: Message[] = [];
    const assembler = new StreamAssembler((betaMessageId) => {
      const row = new Message('assistant', { role: 'assistant', content: [] }, 0, { betaMessageId });
      messages.push(row);
      return row;
    });
    // Session passes `event.event` and `parent_tool_use_id`; the new wrapper
    // fields (ttft_ms, user_message_uuid, user_message_uuids) stay on the wrapper.
    const send = (frame: { event: any; parent_tool_use_id: string | null }) =>
      assembler.processStreamEvent(frame.event, frame.parent_tool_use_id);
    return { messages, send };
  }

  const wrapper = (event: any) => ({
    type: 'stream_event' as const,
    event,
    parent_tool_use_id: null,
    uuid: '11111111-1111-4111-8111-111111111111',
    session_id: 'sess-1',
    ttft_ms: 412,
    user_message_uuid: 'client-1',
    user_message_uuids: ['client-1'],
  });

  it('a final message with timestamp, request_id, user_message_uuid and aborted replaces the streamed row', () => {
    const { messages, send } = stream();
    send(wrapper({ type: 'message_start', message: { id: 'msg_1', content: [], usage: {} } }));
    send(wrapper({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
    send(wrapper({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Half a sent' } }));
    expect(messages).toHaveLength(1);
    expect(wrappersOf(messages[0])[0].isPartial).toBe(true);

    processAndAttachMessage(
      messages,
      {
        type: 'assistant',
        uuid: 'u-final',
        session_id: 'sess-1',
        parent_tool_use_id: null,
        request_id: 'req_1',
        timestamp: '2026-09-17T10:00:01.000Z',
        user_message_uuid: 'client-1',
        user_message_uuids: ['client-1'],
        aborted: true,
        message: { id: 'msg_1', role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text: 'Half a sent' }] },
      },
      true
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].uuid).toBe('u-final');
    expect(wrappersOf(messages[0])[0].isPartial).toBe(false);
  });

  it('an assistant message with an error field and no content adds no row', () => {
    const messages: Message[] = [];
    processAndAttachMessage(
      messages,
      {
        type: 'assistant',
        uuid: 'u-err',
        session_id: 'sess-1',
        parent_tool_use_id: null,
        error: 'model_not_found',
        message: { id: 'msg_err', role: 'assistant', model: 'claude-sonnet-5', content: [] },
      },
      true
    );
    expect(messages).toEqual([]);
  });

  it('a user message timestamp stays readable (ISO string) on the row', () => {
    const row = Message.fromRaw({
      type: 'user',
      uuid: 'u-1',
      timestamp: '2026-09-17T10:00:00.000Z',
      message: { role: 'user', content: 'hello' },
    });
    expect(row?.timestamp).toBe('2026-09-17T10:00:00.000Z');
  });
});
