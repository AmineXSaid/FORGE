/**
 * Gemini thought signatures and `<thought>` tags across the OpenAI bridge.
 *
 * Gemini 3 rejects the next request with "Function call is missing a
 * thought_signature" unless each signed call goes back with its signature.
 * The CLI cannot carry it, so the relay keeps it by tool call id.
 */
import { describe, expect, it } from 'vitest';
import { toOpenAI, type AnthropicRequest } from '../src/services/endpoints/wire/toOpenAI';
import { OpenAiToAnthropicStream } from '../src/services/endpoints/wire/fromOpenAI';
import { toAnthropicMessage } from '../src/services/endpoints/wire/anthropicServer';
import {
  mergeReasoningDetails,
  requiresSignatures,
  SKIP_SIGNATURE,
  splitThoughtTags,
  ThoughtSignatureStore,
  ThoughtTagSplitter,
} from '../src/services/endpoints/wire/thoughtSignatures';
import { parseProfile, type EndpointProfile } from '../src/services/endpoints/profile';

function profile(model = 'gemini-3-pro-preview'): EndpointProfile {
  return parseProfile({ name: 'gw', wire: 'openai', baseUrl: 'https://gw/v1', model }, 'test');
}

function frames(stream: OpenAiToAnthropicStream, chunks: unknown[]): any[] {
  const out: string[] = [];
  for (const c of chunks) out.push(...stream.push(c));
  out.push(...stream.end());
  return out.map((raw) => JSON.parse(raw.split('\n').find((l) => l.startsWith('data: '))!.slice(6)));
}

/** The CLI's next request after a turn that called `Read` with this id. */
function followUp(id: string, model = 'gemini-3-pro-preview', extra: any[] = []): AnthropicRequest {
  return {
    model,
    messages: [
      { role: 'user', content: 'read it' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id, name: 'Read', input: { file_path: '/a' } },
          ...extra,
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
    ],
  };
}

const assistantOf = (body: Record<string, unknown>): any =>
  (body.messages as any[]).find((m) => m.role === 'assistant');

describe('thought signatures: Google OpenAI endpoint', () => {
  it('captures a streamed signature and echoes it on the same call', () => {
    const store = new ThoughtSignatureStore();
    const stream = new OpenAiToAnthropicStream({ model: 'gemini-3-pro-preview', signatures: store });
    const out = frames(stream, [
      {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: 'Read', arguments: '{"file_path":"/a"}' },
              extra_content: { google: { thought_signature: 'SIG_A' } },
            }],
          },
        }],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const start = out.find((f) => f.content_block?.type === 'tool_use');
    expect(start.content_block.id).toBe('call_1');
    expect(store.signatureFor('call_1')).toBe('SIG_A');

    const { body } = toOpenAI(followUp('call_1'), profile(), { signatures: store });
    expect(assistantOf(body).tool_calls[0].extra_content).toEqual({ google: { thought_signature: 'SIG_A' } });
  });

  it('reads LiteLLM provider_specific_fields too', () => {
    const store = new ThoughtSignatureStore();
    const stream = new OpenAiToAnthropicStream({ model: 'm', signatures: store });
    frames(stream, [
      {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0, id: 'call_2', function: { name: 'Read', arguments: '{}' },
              provider_specific_fields: { thought_signature: 'SIG_L' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
      },
    ]);
    expect(store.signatureFor('call_2')).toBe('SIG_L');
  });

  it('signs only the first of parallel calls when the signature is unknown on Gemini 3', () => {
    const req = followUp('call_x');
    (req.messages![1].content as any[]).push({ type: 'tool_use', id: 'call_y', name: 'Read', input: {} });
    const { body } = toOpenAI(req, profile(), { signatures: new ThoughtSignatureStore() });
    const calls = assistantOf(body).tool_calls;
    expect(calls[0].extra_content.google.thought_signature).toBe(SKIP_SIGNATURE);
    expect(calls[1].extra_content).toBeUndefined();
  });

  it('adds nothing for a model that does not need signatures', () => {
    const { body } = toOpenAI(followUp('call_z', 'gpt-4o'), profile('gpt-4o'), {
      signatures: new ThoughtSignatureStore(),
    });
    expect(assistantOf(body).tool_calls[0].extra_content).toBeUndefined();
    expect(assistantOf(body).reasoning_details).toBeUndefined();
  });

  it('checks the mapped model, not only the CLI model id', () => {
    const p = parseProfile({
      name: 'gw', wire: 'openai', baseUrl: 'https://gw/v1', model: 'x',
      modelMap: { 'claude-sonnet-5': 'google/gemini-3-flash' },
    }, 'test');
    const { body } = toOpenAI(followUp('c', 'claude-sonnet-5'), p);
    expect(assistantOf(body).tool_calls[0].extra_content.google.thought_signature).toBe(SKIP_SIGNATURE);
  });

  it('knows which models require signatures', () => {
    expect(requiresSignatures('gemini-3-pro-preview')).toBe(true);
    expect(requiresSignatures('google/gemini-3.1-flash')).toBe(true);
    expect(requiresSignatures('gemini-2.5-pro')).toBe(false);
    expect(requiresSignatures('gpt-5')).toBe(false);
    expect(requiresSignatures(undefined)).toBe(false);
  });

  it('non-streamed replies are captured as well', () => {
    const store = new ThoughtSignatureStore();
    const msg: any = toAnthropicMessage({
      choices: [{
        message: {
          content: '<thought>check the file</thought>Reading it.',
          tool_calls: [{
            id: 'call_3', function: { name: 'Read', arguments: '{}' },
            extra_content: { google: { thought_signature: 'SIG_N' } },
          }],
        },
      }],
    }, 'gemini-3-pro-preview', { signatures: store, thoughtTags: true });
    expect(store.signatureFor('call_3')).toBe('SIG_N');
    expect(msg.content[0]).toMatchObject({ type: 'thinking', thinking: 'check the file' });
    expect(msg.content[1]).toEqual({ type: 'text', text: 'Reading it.' });
  });
});

describe('thought signatures: OpenRouter reasoning_details', () => {
  it('collects streamed reasoning_details and echoes them on the assistant message', () => {
    const store = new ThoughtSignatureStore();
    const stream = new OpenAiToAnthropicStream({ model: 'm', reasoningField: 'reasoning', signatures: store });
    frames(stream, [
      { choices: [{ delta: { reasoning: 'Thin', reasoning_details: [{ type: 'reasoning.text', text: 'Thin', index: 0 }] } }] },
      { choices: [{ delta: { reasoning: 'king', reasoning_details: [{ type: 'reasoning.text', text: 'king', index: 0 }] } }] },
      {
        choices: [{
          delta: {
            reasoning_details: [{ type: 'reasoning.encrypted', data: 'ENC', id: 'call_4', index: 1 }],
            tool_calls: [{ index: 0, id: 'call_4', function: { name: 'Read', arguments: '{}' } }],
          },
          finish_reason: 'tool_calls',
        }],
      },
    ]);
    const { body } = toOpenAI(followUp('call_4', 'google/gemini-3-pro'), profile('x'), { signatures: store });
    expect(assistantOf(body).reasoning_details).toEqual([
      { type: 'reasoning.text', text: 'Thinking', index: 0 },
      { type: 'reasoning.encrypted', data: 'ENC', id: 'call_4', index: 1 },
    ]);
  });

  it('ignores junk fragments', () => {
    const into: unknown[] = [];
    mergeReasoningDetails(into, 'nope');
    mergeReasoningDetails(into, [null, 3, { type: 'reasoning.text', text: 'a' }]);
    expect(into).toEqual([{ type: 'reasoning.text', text: 'a' }]);
  });
});

describe('<thought> tags', () => {
  it('splits tags across arbitrary chunk boundaries', () => {
    const s = new ThoughtTagSplitter();
    const parts = ['<tho', 'ught>plan ', 'it</th', 'ought>\nAnswer <b>', ' done'].flatMap((c) => s.push(c));
    parts.push(...s.flush());
    const thinking = parts.filter((p) => p.kind === 'thinking').map((p) => p.text).join('');
    const text = parts.filter((p) => p.kind === 'text').map((p) => p.text).join('');
    expect(thinking).toBe('plan it');
    expect(text).toBe('Answer <b> done');
  });

  it('a dangling partial tag at the end is text', () => {
    expect(splitThoughtTags('a <thou')).toEqual({ thinking: '', text: 'a <thou' });
  });

  it('the stream turns tagged thoughts into a thinking block before the text', () => {
    const stream = new OpenAiToAnthropicStream({ model: 'gemini-3-flash', thoughtTags: true });
    const out = frames(stream, [
      { choices: [{ delta: { content: '<thought>Let me ' } }] },
      { choices: [{ delta: { content: 'think</thought>Hi!' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]);
    const starts = out.filter((f) => f.type === 'content_block_start').map((f) => f.content_block.type);
    expect(starts).toEqual(['thinking', 'text']);
    const thinking = out.filter((f) => f.delta?.type === 'thinking_delta').map((f) => f.delta.thinking).join('');
    const text = out.filter((f) => f.delta?.type === 'text_delta').map((f) => f.delta.text).join('');
    expect(thinking).toBe('Let me think');
    expect(text).toBe('Hi!');
  });

  it('leaves tags alone when the option is off', () => {
    const stream = new OpenAiToAnthropicStream({ model: 'gpt-4o' });
    const out = frames(stream, [{ choices: [{ delta: { content: '<thought>x</thought>' }, finish_reason: 'stop' }] }]);
    const text = out.filter((f) => f.delta?.type === 'text_delta').map((f) => f.delta.text).join('');
    expect(text).toBe('<thought>x</thought>');
  });
});

describe('ThoughtSignatureStore', () => {
  it('evicts the oldest entries past its limit', () => {
    const store = new ThoughtSignatureStore(2);
    for (const id of ['a', 'b', 'c']) store.remember([id], { signatures: new Map([[id, `s${id}`]]) });
    expect(store.signatureFor('a')).toBeUndefined();
    expect(store.signatureFor('c')).toBe('sc');
    expect(store.size).toBe(2);
  });
});
