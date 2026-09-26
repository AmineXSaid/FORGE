/**
 * Phase 2: the OpenAI <-> Anthropic wire bridge.
 *
 * The plan names two things to test before anything else, and they are first
 * here for the reason it gives:
 *
 *   - tool-call streaming fidelity. OpenAI sends tool arguments as fragmented
 *     strings on a tool-indexed channel; Anthropic wants `input_json_delta`
 *     inside a block-indexed `tool_use`. The two index spaces do not line up,
 *     and losing a fragment loses the call.
 *   - `stop_reason`. `finish_reason: "tool_calls"` must arrive as
 *     `stop_reason: "tool_use"`, or the CLI ends the turn instead of running
 *     the tool, which presents as the model silently giving up.
 */
import { describe, expect, it } from 'vitest';
import { toOpenAI, type AnthropicRequest } from '../src/services/endpoints/wire/toOpenAI';
import { OpenAiToAnthropicStream, SseDecoder } from '../src/services/endpoints/wire/fromOpenAI';
import { parseProfile, type EndpointProfile } from '../src/services/endpoints/profile';

function profile(overrides: Record<string, unknown> = {}): EndpointProfile {
  return parseProfile(
    { name: 'gw', wire: 'openai', baseUrl: 'https://gw/v1', model: 'llama-3.3-70b', ...overrides },
    'test',
  );
}

/** Run a list of OpenAI chunks through the translator and parse what comes out. */
function run(chunks: any[], options: Partial<Parameters<typeof streamFor>[0]> = {}): any[] {
  const stream = streamFor({ model: 'claude-sonnet-5', ...options } as any);
  const frames: string[] = [];
  for (const c of chunks) frames.push(...stream.push(c));
  frames.push(...stream.end());
  return frames.map(parseFrame);
}

function streamFor(options: any) {
  return new OpenAiToAnthropicStream(options);
}

/** Turn one emitted SSE frame back into the object it encodes. */
function parseFrame(raw: string): any {
  const data = raw.split('\n').find((l) => l.startsWith('data: '))!.slice(6);
  return JSON.parse(data);
}

// ---------------------------------------------------------------------------
// Request translation
// ---------------------------------------------------------------------------

describe('toOpenAI: request translation', () => {
  it('puts the system prompt in a leading system message by default', () => {
    const { body } = toOpenAI(
      { system: 'You are Forge.', messages: [{ role: 'user', content: 'hi' }] },
      profile(),
    );
    expect((body.messages as any[])[0]).toEqual({ role: 'system', content: 'You are Forge.' });
  });

  it('flattens Anthropic system blocks into one string', () => {
    const { body } = toOpenAI(
      {
        system: [{ type: 'text', text: 'A.' }, { type: 'text', text: ' B.' }] as any,
        messages: [{ role: 'user', content: 'hi' }],
      },
      profile(),
    );
    expect((body.messages as any[])[0].content).toBe('A. B.');
  });

  it('honours systemRole: prepend-user for endpoints with no system role', () => {
    const { body } = toOpenAI(
      { system: 'RULES', messages: [{ role: 'user', content: 'hi' }] },
      profile({ capabilities: { systemRole: 'prepend-user' } }),
    );
    const messages = body.messages as any[];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ role: 'user', content: 'RULES\n\nhi' });
  });

  it('honours systemRole: top-level', () => {
    const { body } = toOpenAI(
      { system: 'RULES', messages: [{ role: 'user', content: 'hi' }] },
      profile({ capabilities: { systemRole: 'top-level' } }),
    );
    expect(body.system).toBe('RULES');
    expect((body.messages as any[])[0].role).toBe('user');
  });

  it('translates tool definitions, renaming input_schema to parameters', () => {
    const schema = { type: 'object', properties: { file_path: { type: 'string' } } };
    const { body } = toOpenAI(
      { messages: [], tools: [{ name: 'Read', description: 'Read a file', input_schema: schema }] },
      profile(),
    );
    expect(body.tools).toEqual([
      { type: 'function', function: { name: 'Read', description: 'Read a file', parameters: schema } },
    ]);
  });

  it.each([
    ['auto', 'auto'],
    ['any', 'required'],
    ['none', 'none'],
  ])('maps tool_choice %s to %s', (from, expected) => {
    const { body } = toOpenAI(
      { messages: [], tools: [{ name: 'T' }], tool_choice: { type: from } },
      profile(),
    );
    expect(body.tool_choice).toBe(expected);
  });

  it('maps a named tool_choice to the function form', () => {
    const { body } = toOpenAI(
      { messages: [], tools: [{ name: 'Read' }], tool_choice: { type: 'tool', name: 'Read' } },
      profile(),
    );
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'Read' } });
  });

  it('turns an assistant tool_use block into tool_calls', () => {
    const { body } = toOpenAI(
      {
        messages: [{
          role: 'assistant',
          content: [
            { type: 'text', text: 'Reading.' },
            { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'a.ts' } },
          ],
        }],
      },
      profile(),
    );
    expect((body.messages as any[])[0]).toEqual({
      role: 'assistant',
      content: 'Reading.',
      tool_calls: [{
        id: 'toolu_1',
        type: 'function',
        function: { name: 'Read', arguments: '{"file_path":"a.ts"}' },
      }],
    });
  });

  it('gives an assistant turn of pure tool calls a null content, not an empty string', () => {
    const { body } = toOpenAI(
      { messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'R', input: {} }] }] },
      profile(),
    );
    expect((body.messages as any[])[0].content).toBeNull();
  });

  it('fans N tool_result blocks out into N tool messages', () => {
    const { body } = toOpenAI(
      {
        messages: [{
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'a', content: 'first' },
            { type: 'tool_result', tool_use_id: 'b', content: 'second' },
          ],
        }],
      },
      profile(),
    );
    expect(body.messages).toEqual([
      { role: 'tool', tool_call_id: 'a', content: 'first' },
      { role: 'tool', tool_call_id: 'b', content: 'second' },
    ]);
  });

  it('moves an image inside a tool result into a following user message', () => {
    // A `tool` message's content is a string and nothing else, so pixels in a
    // tool result are a 400 if left in place and a lost screenshot if dropped.
    const { body } = toOpenAI(
      {
        messages: [{
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'a',
            content: [
              { type: 'text', text: 'screenshot taken' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
            ],
          }],
        }],
      },
      profile({ capabilities: { vision: true } }),
    );
    const messages = body.messages as any[];
    expect(messages[0]).toEqual({ role: 'tool', tool_call_id: 'a', content: 'screenshot taken' });
    expect(messages[1].role).toBe('user');
    expect(messages[1].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AAAA' },
    });
  });

  it('replaces images with a note when the endpoint cannot see', () => {
    const { body } = toOpenAI(
      {
        messages: [{
          role: 'user',
          content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }],
        }],
      },
      profile({ capabilities: { vision: false } }),
    );
    expect((body.messages as any[])[0].content).toMatch(/image omitted/);
  });

  it('drops prior thinking blocks rather than replaying them as text', () => {
    const { body } = toOpenAI(
      {
        messages: [{
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'private working', signature: 'sig' },
            { type: 'text', text: 'The answer is 4.' },
          ],
        }],
      },
      profile(),
    );
    expect((body.messages as any[])[0].content).toBe('The answer is 4.');
    expect(JSON.stringify(body)).not.toMatch(/private working/);
  });

  it('asks for usage on a streamed turn, which compaction depends on', () => {
    const { body } = toOpenAI({ messages: [], stream: true }, profile());
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it('maps stop_sequences to stop', () => {
    const { body } = toOpenAI({ messages: [], stop_sequences: ['END'] }, profile());
    expect(body.stop).toEqual(['END']);
  });

  it('clamps max_tokens to what the profile says the endpoint accepts', () => {
    const { body, warnings } = toOpenAI(
      { messages: [], max_tokens: 64000 },
      profile({ capabilities: { maxOutputTokens: 4096 } }),
    );
    expect(body.max_tokens).toBe(4096);
    expect(warnings.join()).toMatch(/clamped/);
  });

  it('drops tools and says so when the endpoint has none', () => {
    const { body, warnings } = toOpenAI(
      { messages: [], tools: [{ name: 'Read' }] },
      profile({ capabilities: { tools: false } }),
    );
    expect(body.tools).toBeUndefined();
    expect(warnings.join()).toMatch(/dropped 1 tool definition/);
  });

  describe('model ids', () => {
    it('passes an unmapped model straight through', () => {
      const { body, requestedModel } = toOpenAI({ messages: [], model: 'real-model-id' }, profile());
      expect(body.model).toBe('real-model-id');
      expect(requestedModel).toBe('real-model-id');
    });

    it('rewrites the CLI internal small-model id through modelMap', () => {
      const { body } = toOpenAI(
        { messages: [], model: 'claude-3-5-haiku-20241022' },
        profile({ modelMap: { 'claude-3-5-haiku-20241022': 'qwen2.5-7b' } }),
      );
      expect(body.model).toBe('qwen2.5-7b');
    });
  });

  it('merges extraBody into every request', () => {
    const { body } = toOpenAI({ messages: [] }, profile({ extraBody: { repetition_penalty: 1.05 } }));
    expect(body.repetition_penalty).toBe(1.05);
  });
});

// ---------------------------------------------------------------------------
// Stream translation
// ---------------------------------------------------------------------------

describe('fromOpenAI: stop_reason', () => {
  it('maps finish_reason tool_calls to stop_reason tool_use', () => {
    const frames = run([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'Read', arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const messageDelta = frames.find((f) => f.type === 'message_delta');
    expect(messageDelta.delta.stop_reason).toBe('tool_use');
  });

  it.each([
    ['stop', 'end_turn'],
    ['length', 'max_tokens'],
    ['content_filter', 'end_turn'],
  ])('maps finish_reason %s to %s', (finish, expected) => {
    const frames = run([
      { choices: [{ delta: { content: 'hi' } }] },
      { choices: [{ delta: {}, finish_reason: finish }] },
    ]);
    expect(frames.find((f) => f.type === 'message_delta').delta.stop_reason).toBe(expected);
  });

  it('reports tool_use even when the gateway wrongly says stop', () => {
    // Observed on real gateways. Trusting `stop` here strands the tool call and
    // the agent loop ends mid-turn.
    const frames = run([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'Read', arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]);
    expect(frames.find((f) => f.type === 'message_delta').delta.stop_reason).toBe('tool_use');
  });
});

describe('fromOpenAI: tool-call streaming fidelity', () => {
  /** A realistic fragmented single tool call after some text. */
  const fragmented = [
    { id: 'chatcmpl-1', choices: [{ delta: { role: 'assistant' } }] },
    { choices: [{ delta: { content: 'Let me look.' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'Read', arguments: '' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"file' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '_path":"a.ts"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 20 } },
  ];

  it('emits the Anthropic frame sequence in order', () => {
    // The tool's arguments go out as one delta: a call is held until it is
    // whole, so its name can be resolved and its arguments repaired.
    expect(run(fragmented).map((f) => f.type)).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
  });

  it('puts the tool block at block index 1, after the text block at 0', () => {
    // The crux: OpenAI tool index 0 is Anthropic block index 1 here, because
    // the text block already took index 0.
    const frames = run(fragmented);
    const starts = frames.filter((f) => f.type === 'content_block_start');
    expect(starts[0]).toMatchObject({ index: 0, content_block: { type: 'text' } });
    expect(starts[1]).toMatchObject({
      index: 1,
      content_block: { type: 'tool_use', id: 'call_1', name: 'Read' },
    });
  });

  it('reassembles the fragments into the exact original JSON', () => {
    const frames = run(fragmented);
    const json = frames
      .filter((f) => f.delta?.type === 'input_json_delta')
      .map((f) => f.delta.partial_json)
      .join('');
    expect(json).toBe('{"file_path":"a.ts"}');
    expect(JSON.parse(json)).toEqual({ file_path: 'a.ts' });
  });

  it('gives the tool block index 0 when the turn produced no text', () => {
    const frames = run([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'Read', arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    expect(frames.find((f) => f.type === 'content_block_start').index).toBe(0);
  });

  it('keeps two parallel tool calls on separate blocks with their own arguments', () => {
    const frames = run([
      { choices: [{ delta: { tool_calls: [
        { index: 0, id: 'c0', function: { name: 'Read', arguments: '' } },
        { index: 1, id: 'c1', function: { name: 'Grep', arguments: '' } },
      ] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":1}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '{"b":2}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const starts = frames.filter((f) => f.type === 'content_block_start');
    expect(starts.map((s) => [s.index, s.content_block.name])).toEqual([[0, 'Read'], [1, 'Grep']]);

    const byIndex = (i: number) => frames
      .filter((f) => f.type === 'content_block_delta' && f.index === i)
      .map((f) => f.delta.partial_json).join('');
    expect(byIndex(0)).toBe('{"a":1}');
    expect(byIndex(1)).toBe('{"b":2}');
  });

  it('buffers arguments that arrive before the tool name', () => {
    // Some gateways send a fragment before naming the function. The block
    // cannot open without a name, so the fragment has to be held, not dropped.
    const frames = run([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { arguments: '{"x"' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'Read', arguments: ':1}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const json = frames
      .filter((f) => f.delta?.type === 'input_json_delta')
      .map((f) => f.delta.partial_json).join('');
    expect(json).toBe('{"x":1}');
  });

  it('closes every open block before message_delta', () => {
    const frames = run(fragmented);
    const stops = frames.filter((f) => f.type === 'content_block_stop').map((f) => f.index);
    const starts = frames.filter((f) => f.type === 'content_block_start').map((f) => f.index);
    expect(stops.sort()).toEqual(starts.sort());
    const lastStop = frames.findLastIndex((f) => f.type === 'content_block_stop');
    expect(lastStop).toBeLessThan(frames.findIndex((f) => f.type === 'message_delta'));
  });
});

describe('fromOpenAI: usage, which compaction depends on', () => {
  it('carries usage into message_delta', () => {
    const frames = run([
      { choices: [{ delta: { content: 'hi' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1200, completion_tokens: 42 } },
    ]);
    expect(frames.find((f) => f.type === 'message_delta').usage).toMatchObject({
      input_tokens: 1200,
      output_tokens: 42,
    });
  });

  it('reads the usage frame that arrives AFTER finish_reason', () => {
    // The ordinary OpenAI shape, and what a real gateway sends:
    //
    //   {"choices":[{"delta":{},"finish_reason":"stop"}]}
    //   {"choices":[],"usage":{"prompt_tokens":60,"completion_tokens":31}}
    //   [DONE]
    //
    // Emitting message_delta on finish_reason reported zero tokens for every
    // streamed turn, so compaction never fired. Caught against a live gateway,
    // not by a fixture; pinned here so it cannot come back.
    const frames = run([
      { choices: [{ delta: { content: '1 2 3' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 60, total_tokens: 91, completion_tokens: 31 } },
    ]);
    const usage = frames.find((f) => f.type === 'message_delta').usage;
    expect(usage.input_tokens).toBe(60);
    expect(usage.output_tokens).toBe(31);
  });

  it('still ends the message exactly once when usage trails finish_reason', () => {
    const frames = run([
      { choices: [{ delta: { content: 'x' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } },
    ]);
    expect(frames.filter((f) => f.type === 'message_delta')).toHaveLength(1);
    expect(frames.filter((f) => f.type === 'message_stop')).toHaveLength(1);
    expect(frames.at(-1).type).toBe('message_stop');
    // Content blocks still close as soon as finish_reason says they are done.
    const lastStop = frames.findLastIndex((f) => f.type === 'content_block_stop');
    expect(lastStop).toBeLessThan(frames.findIndex((f) => f.type === 'message_delta'));
  });

  it('ignores stray content that arrives after finish_reason', () => {
    const frames = run([
      { choices: [{ delta: { content: 'real' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      { choices: [{ delta: { content: 'late' } }] },
    ]);
    expect(JSON.stringify(frames)).not.toMatch(/late/);
  });

  it('reads usage attached to a content frame, as OpenRouter sends it', () => {
    const frames = run([
      { choices: [{ delta: { content: 'hi' } }], usage: { prompt_tokens: 7, completion_tokens: 3 } },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]);
    expect(frames.find((f) => f.type === 'message_delta').usage.input_tokens).toBe(7);
  });

  it('prefers total_tokens, which can include reasoning the parts omit', () => {
    const frames = run([
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 350 } },
    ]);
    expect(frames.find((f) => f.type === 'message_delta').usage.output_tokens).toBe(250);
  });

  it('passes cached-token counts through', () => {
    const frames = run([
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 80 } } },
    ]);
    expect(frames.find((f) => f.type === 'message_delta').usage.cache_read_input_tokens).toBe(80);
  });

  it('falls back to an estimate when the endpoint reports nothing', () => {
    const frames = run(
      [{ choices: [{ delta: { content: 'hi' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }],
      { fallbackUsage: () => ({ input_tokens: 999, output_tokens: 11 }) } as any,
    );
    expect(frames.find((f) => f.type === 'message_delta').usage.input_tokens).toBe(999);
  });
});

describe('fromOpenAI: reasoning', () => {
  it('re-emits reasoning_content as a thinking block', () => {
    const frames = run(
      [
        { choices: [{ delta: { reasoning_content: 'weighing options' } }] },
        { choices: [{ delta: { content: 'Answer.' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ],
      { reasoningField: 'reasoning_content' } as any,
    );
    const start = frames.find((f) => f.type === 'content_block_start');
    expect(start.content_block.type).toBe('thinking');
    expect(frames.find((f) => f.delta?.type === 'thinking_delta').delta.thinking).toBe('weighing options');
  });

  it('signs the thinking block with a placeholder so the block is well-formed', () => {
    const frames = run(
      [
        { choices: [{ delta: { reasoning: 'hmm' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ],
      { reasoningField: 'reasoning' } as any,
    );
    expect(frames.find((f) => f.delta?.type === 'signature_delta').delta.signature).toBeTruthy();
  });

  it('ignores reasoning when the profile says the field is none', () => {
    const frames = run(
      [
        { choices: [{ delta: { reasoning_content: 'hidden' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ],
      { reasoningField: 'none' } as any,
    );
    expect(frames.some((f) => f.content_block?.type === 'thinking')).toBe(false);
  });

  it('closes the thinking block before opening the text block', () => {
    const frames = run(
      [
        { choices: [{ delta: { reasoning_content: 'think' } }] },
        { choices: [{ delta: { content: 'say' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ],
      { reasoningField: 'reasoning_content' } as any,
    );
    const types = frames.map((f) => f.type);
    const thinkingStop = frames.findIndex((f) => f.type === 'content_block_stop');
    const textStart = types.lastIndexOf('content_block_start');
    expect(thinkingStop).toBeLessThan(textStart);
  });
});

describe('fromOpenAI: a truncated stream still terminates the message', () => {
  it('closes out when the gateway just drops the connection', () => {
    const stream = new OpenAiToAnthropicStream({ model: 'm' });
    const frames = [
      ...stream.push({ choices: [{ delta: { content: 'partial' } }] }),
      ...stream.end(),
    ].map(parseFrame);
    expect(frames.at(-1).type).toBe('message_stop');
    expect(frames.some((f) => f.type === 'content_block_stop')).toBe(true);
  });

  it('is not done at finish_reason, because usage still follows it', () => {
    const stream = new OpenAiToAnthropicStream({ model: 'm' });
    stream.push({ choices: [{ delta: {}, finish_reason: 'stop' }] });
    // Content is closed, but the message is not terminated: a trailing usage
    // frame is still to come, and ending here would discard it.
    expect(stream.done).toBe(false);
  });

  it('emits nothing more once end() has terminated the message', () => {
    const stream = new OpenAiToAnthropicStream({ model: 'm' });
    stream.push({ choices: [{ delta: {}, finish_reason: 'stop' }] });
    expect(stream.end().length).toBeGreaterThan(0);
    expect(stream.done).toBe(true);
    expect(stream.push({ choices: [{ delta: { content: 'late' } }] })).toEqual([]);
    expect(stream.end()).toEqual([]);
  });
});

describe('SseDecoder: chunk boundaries fall wherever the network put them', () => {
  it('reassembles a payload split mid-JSON', () => {
    const d = new SseDecoder();
    expect(d.push('data: {"a"')).toEqual([]);
    expect(d.push(':1}\n\n')).toEqual(['{"a":1}']);
  });

  it('reassembles a payload split mid-prefix', () => {
    const d = new SseDecoder();
    expect(d.push('da')).toEqual([]);
    expect(d.push('ta: {"b":2}\n\n')).toEqual(['{"b":2}']);
  });

  it('returns several frames from one chunk', () => {
    const d = new SseDecoder();
    expect(d.push('data: {"a":1}\n\ndata: {"b":2}\n\n')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('tolerates CRLF from proxies', () => {
    const d = new SseDecoder();
    expect(d.push('data: {"a":1}\r\n\r\n')).toEqual(['{"a":1}']);
  });

  it('skips comment and event lines, keeping only data', () => {
    const d = new SseDecoder();
    expect(d.push(': keep-alive\n\nevent: message\ndata: {"a":1}\n\n')).toEqual(['{"a":1}']);
  });

  it('surfaces the [DONE] sentinel for the caller to handle', () => {
    const d = new SseDecoder();
    expect(d.push('data: [DONE]\n\n')).toEqual(['[DONE]']);
  });
});
