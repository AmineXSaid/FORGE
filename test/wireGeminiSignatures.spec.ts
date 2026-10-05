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

  it('joins text pieces that carry no index, but never encrypted details', () => {
    const into: unknown[] = [];
    mergeReasoningDetails(into, [{ type: 'reasoning.text', text: 'Thin', format: 'f' }]);
    mergeReasoningDetails(into, [{ type: 'reasoning.text', text: 'king', format: 'f' }]);
    mergeReasoningDetails(into, [{ type: 'reasoning.encrypted', data: 'A', id: 'c1' }]);
    mergeReasoningDetails(into, [{ type: 'reasoning.encrypted', data: 'B', id: 'c2' }]);
    expect(into).toEqual([
      { type: 'reasoning.text', text: 'Thinking', format: 'f' },
      { type: 'reasoning.encrypted', data: 'A', id: 'c1' },
      { type: 'reasoning.encrypted', data: 'B', id: 'c2' },
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

describe('review fixes', () => {
  it('non-streamed: a call without an id keeps its signature under the generated id', () => {
    const store = new ThoughtSignatureStore();
    const msg: any = toAnthropicMessage({
      id: 'r1',
      choices: [{
        message: {
          tool_calls: [{ function: { name: 'Read', arguments: '{}' }, extra_content: { google: { thought_signature: 'SIG_G' } } }],
        },
      }],
    }, 'gemini-3-pro-preview', { signatures: store, tools: [{ name: 'Read', input_schema: { type: 'object' } }] });
    const id = msg.content.find((b: any) => b.type === 'tool_use').id;
    expect(id).toBe('toolu_r1_0');
    expect(store.signatureFor(id)).toBe('SIG_G');
  });

  it('the newline after </thought> is dropped even when it arrives in the next chunk', () => {
    const s = new ThoughtTagSplitter();
    const parts = ['<thought>x</thought>', '\nHello'].flatMap((c) => s.push(c));
    expect(parts).toEqual([{ kind: 'thinking', text: 'x' }, { kind: 'text', text: 'Hello' }]);
  });
});

describe('end to end: CLI -> relay -> a Gemini 3 upstream that enforces signatures', () => {
  it('turn two carries turn one\'s signature, and thoughts never reach the reply text', async () => {
    const http = await import('node:http');
    const { Agent } = await import('undici');
    const { serveAnthropic } = await import('../src/services/endpoints/wire/anthropicServer');

    const seen: any[] = [];
    // Answers like Google's OpenAI endpoint: turn one streams a signed call,
    // turn two 400s unless the call comes back signed.
    const upstream = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = JSON.parse(raw);
        seen.push(body);
        const assistant = body.messages.find((m: any) => m.role === 'assistant' && m.tool_calls);
        if (assistant) {
          const sig = assistant.tool_calls[0].extra_content?.google?.thought_signature;
          if (sig !== 'SIG_REAL') {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Function call is missing a thought_signature in functionCall parts.' } }));
            return;
          }
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
        if (!assistant) {
          send({ id: 'g1', choices: [{ delta: { content: '<thought>I should read' } }] });
          send({ id: 'g1', choices: [{ delta: { content: ' the file</thought>' } }] });
          send({
            id: 'g1',
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0, id: 'function-call-1', type: 'function',
                  function: { name: 'Read', arguments: '{"file_path":"/a"}' },
                  extra_content: { google: { thought_signature: 'SIG_REAL' } },
                }],
              },
              finish_reason: 'tool_calls',
            }],
          });
        } else {
          send({ id: 'g2', choices: [{ delta: { content: 'It says ok.' }, finish_reason: 'stop' }] });
        }
        send({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } });
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    const upPort = (upstream.address() as any).port;

    const p = parseProfile({
      name: 'gemini', wire: 'openai', baseUrl: `http://127.0.0.1:${upPort}/v1`, model: 'gemini-3-pro-preview',
    }, 'test');
    let store = new ThoughtSignatureStore();
    const dispatcher = new Agent();
    const relay = http.createServer((req, res) => {
      void serveAnthropic(req, res, { profile: p, dispatcher, headers: {}, log: () => {}, signatures: store });
    });
    await new Promise<void>((r) => relay.listen(0, '127.0.0.1', r));
    const relayUrl = `http://127.0.0.1:${(relay.address() as any).port}/v1/messages`;

    const post = async (body: unknown) => {
      const r = await fetch(relayUrl, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
      return { status: r.status, text: await r.text() };
    };
    const events = (sse: string) => sse.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
    const tools = [{ name: 'Read', input_schema: { type: 'object', properties: { file_path: { type: 'string' } } } }];

    try {
      const one = await post({ model: 'gemini-3-pro-preview', stream: true, tools, messages: [{ role: 'user', content: 'read /a' }] });
      expect(one.status).toBe(200);
      const ev1 = events(one.text);
      const thinking = ev1.filter((e) => e.delta?.type === 'thinking_delta').map((e) => e.delta.thinking).join('');
      const text = ev1.filter((e) => e.delta?.type === 'text_delta').map((e) => e.delta.text).join('');
      expect(thinking).toBe('I should read the file');
      expect(text).not.toContain('thought');
      const toolUse = ev1.find((e) => e.content_block?.type === 'tool_use').content_block;
      expect(toolUse.id).toBe('function-call-1');
      expect(ev1.find((e) => e.type === 'message_delta').delta.stop_reason).toBe('tool_use');

      // What the CLI sends next: its own echo, with no signature anywhere.
      const turnTwo = {
        model: 'gemini-3-pro-preview', stream: true, tools,
        messages: [
          { role: 'user', content: 'read /a' },
          {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'I should read the file', signature: 'forge-bridge-unsigned' },
              { type: 'tool_use', id: toolUse.id, name: 'Read', input: { file_path: '/a' } },
            ],
          },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: 'ok' }] },
        ],
      };
      const two = await post(turnTwo);
      expect(two.status).toBe(200);
      expect(events(two.text).filter((e) => e.delta?.type === 'text_delta').map((e) => e.delta.text).join('')).toBe('It says ok.');
      const sentAssistant = seen[1].messages.find((m: any) => m.role === 'assistant');
      expect(sentAssistant.tool_calls[0].extra_content).toEqual({ google: { thought_signature: 'SIG_REAL' } });
      // The thinking text is never replayed into the prompt.
      expect(JSON.stringify(seen[1])).not.toContain('I should read the file');

      // Control: the same turn with the relay's memory gone. The bypass value
      // goes out instead, and this fake (which accepts only the real
      // signature) answers with Google's 400 -- passed through untouched.
      store = new ThoughtSignatureStore();
      const control = await post(turnTwo);
      expect(seen[2].messages.find((m: any) => m.role === 'assistant').tool_calls[0].extra_content)
        .toEqual({ google: { thought_signature: SKIP_SIGNATURE } });
      expect(control.status).toBe(400);
      expect(control.text).toContain('missing a thought_signature');
    } finally {
      relay.close();
      upstream.close();
      await dispatcher.close();
    }
  });
});
