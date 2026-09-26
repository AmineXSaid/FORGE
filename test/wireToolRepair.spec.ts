/**
 * Relay tool-call repair: the near-misses small models make, fixed before the
 * CLI rejects them.
 *
 * The CLI validates a tool call before any hook runs -- an unknown name is
 * `No such tool available`, bad arguments are `InputValidationError` -- so
 * every case here would otherwise cost a round trip, and a small model that
 * gets one wrong often repeats it. Fixtures are the shapes real open-weight
 * models and gateways produce.
 */
import { describe, expect, it } from 'vitest';
import { repairArguments, resolveToolName, type ToolSpec } from '../src/services/endpoints/wire/toolRepair';
import {
  balancedJson,
  findMarker,
  partialMarkerTail,
  recoverToolCalls,
} from '../src/services/endpoints/wire/textToolCalls';
import { OpenAiToAnthropicStream } from '../src/services/endpoints/wire/fromOpenAI';
import { toAnthropicMessage } from '../src/services/endpoints/wire/anthropicServer';
import { repairJson } from '../src/services/endpoints/wire/jsonRepair';

const TOOLS: ToolSpec[] = [
  {
    name: 'Read',
    input_schema: {
      type: 'object',
      properties: { file_path: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' } },
      required: ['file_path'],
    },
  },
  {
    name: 'Bash',
    input_schema: {
      type: 'object',
      properties: { command: { type: 'string' }, timeout: { type: 'number' }, run_in_background: { type: 'boolean' } },
      required: ['command'],
    },
  },
  {
    name: 'Grep',
    input_schema: {
      type: 'object',
      properties: { pattern: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' } },
      required: ['pattern'],
    },
  },
  {
    name: 'Edit',
    input_schema: {
      type: 'object',
      properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } },
    },
  },
  {
    name: 'TodoWrite',
    input_schema: { type: 'object', properties: { todos: { type: 'array', items: { type: 'object' } } } },
  },
  { name: 'Agent', input_schema: { type: 'object', properties: { prompt: { type: 'string' } } } },
  { name: 'mcp__github__create_issue', input_schema: { type: 'object', properties: { title: { type: 'string' } } } },
];

describe('resolveToolName: only ever a tool this request offers', () => {
  it.each([
    ['Read', 'Read'],
    ['read', 'Read'],
    ['BASH', 'Bash'],
    ['functions.Read', 'Read'],
    ['tools:Grep', 'Grep'],
    ['Bash.intent', 'Bash'],
    ['ls.intent.extra', undefined],
    ['read_file', 'Read'],
    ['shell', 'Bash'],
    ['execute_command', 'Bash'],
    ['str_replace', 'Edit'],
    ['todo_write', 'TodoWrite'],
    ['task', 'Agent'],
    ['create_issue', 'mcp__github__create_issue'],
    ['Web-Fetch', undefined],
    ['delete_everything', undefined],
    ['', undefined],
  ])('%s -> %s', (raw, expected) => {
    expect(resolveToolName(raw, TOOLS)).toBe(expected);
  });

  it('prefers the candidate that exists: Task when this CLI has no Agent tool', () => {
    expect(resolveToolName('subagent', [{ name: 'Task' }])).toBe('Task');
  });

  it('never invents a tool the request does not offer', () => {
    expect(resolveToolName('read_file', [{ name: 'Bash' }])).toBeUndefined();
    expect(resolveToolName('Read', [])).toBeUndefined();
  });
});

describe('repairArguments', () => {
  const schema = (name: string) => TOOLS.find((t) => t.name === name)!.input_schema;
  const repaired = (raw: string | undefined, tool?: string) =>
    JSON.parse(repairArguments(raw, tool ? schema(tool) : undefined).json);

  it('passes valid arguments through untouched, with no notes', () => {
    const out = repairArguments('{"file_path":"a.ts"}', schema('Read'));
    expect(out).toEqual({ json: '{"file_path":"a.ts"}', notes: [] });
  });

  it.each([
    ['', {}],
    ['   ', {}],
    ['null', {}],
    ["{'file_path': 'a.ts',}", { file_path: 'a.ts' }],
    ['{"file_path": "a.ts"', { file_path: 'a.ts' }],
    ['{"command": "ls", "run_in_background": True}', { command: 'ls', run_in_background: true }],
    ['"{\\"file_path\\":\\"a.ts\\"}"', { file_path: 'a.ts' }],
    ['[{"file_path":"a.ts"}]', { file_path: 'a.ts' }],
    ['"just prose"', {}],
    ['[1,2]', {}],
  ])('%s -> %j', (raw, expected) => {
    expect(repaired(raw)).toEqual(expected);
  });

  it('coerces scalars to the type the schema declares', () => {
    expect(repaired('{"file_path":"a.ts","offset":"10","limit":"5"}', 'Read')).toEqual({ file_path: 'a.ts', offset: 10, limit: 5 });
    expect(repaired('{"command":"ls","run_in_background":"true","timeout":"1.5"}', 'Bash'))
      .toEqual({ command: 'ls', run_in_background: true, timeout: 1.5 });
    expect(repaired('{"command":42}', 'Bash')).toEqual({ command: '42' });
    expect(repaired('{"todos":"[{\\"content\\":\\"x\\"}]"}', 'TodoWrite')).toEqual({ todos: [{ content: 'x' }] });
  });

  it('does not coerce what the schema does not ask for', () => {
    // "1.5" is not an integer, so offset stays a string for the CLI to reject.
    expect(repaired('{"file_path":"a.ts","offset":"1.5"}', 'Read')).toEqual({ file_path: 'a.ts', offset: '1.5' });
    expect(repaired('{"file_path":"a.ts","extra":"7"}', 'Read')).toEqual({ file_path: 'a.ts', extra: '7' });
  });

  it('renames a key to the schema one when the schema key is missing', () => {
    expect(repaired('{"path":"a.ts"}', 'Read')).toEqual({ file_path: 'a.ts' });
    expect(repaired('{"filePath":"a.ts"}', 'Read')).toEqual({ file_path: 'a.ts' });
    expect(repaired('{"cmd":"ls"}', 'Bash')).toEqual({ command: 'ls' });
    expect(repaired('{"file_path":"a","old_str":"x","new_str":"y"}', 'Edit'))
      .toEqual({ file_path: 'a', old_string: 'x', new_string: 'y' });
  });

  it('never renames a key the schema itself defines', () => {
    // Grep has its own `path`; it must not be taken for Read's file_path logic.
    expect(repaired('{"query":"foo","path":"src"}', 'Grep')).toEqual({ pattern: 'foo', path: 'src' });
  });

  it('says what it changed, for the output channel', () => {
    const { notes } = repairArguments('{"path":"a.ts","offset":"3"}', schema('Read'));
    expect(notes).toEqual(['renamed argument "path" to "file_path"', 'coerced "offset" to integer']);
  });
});

/** Run OpenAI chunks through the translator, with the request's tools. */
function run(chunks: any[], tools: ToolSpec[] | undefined = TOOLS, notes: string[] = []): any[] {
  const stream = new OpenAiToAnthropicStream({ model: 'm', tools, onRepair: (n) => notes.push(n) });
  const frames: string[] = [];
  for (const c of chunks) frames.push(...stream.push(c));
  frames.push(...stream.end());
  return frames.map((raw) => JSON.parse(raw.split('\n').find((l) => l.startsWith('data: '))!.slice(6)));
}

const toolUses = (frames: any[]) => frames
  .filter((f) => f.type === 'content_block_start' && f.content_block.type === 'tool_use')
  .map((f) => ({
    name: f.content_block.name,
    input: JSON.parse(frames
      .filter((d) => d.type === 'content_block_delta' && d.index === f.index)
      .map((d) => d.delta.partial_json).join('') || '{}'),
  }));
const text = (frames: any[]) => frames
  .filter((f) => f.type === 'content_block_delta' && f.delta.type === 'text_delta')
  .map((f) => f.delta.text).join('');
const stopReason = (frames: any[]) => frames.find((f) => f.type === 'message_delta').delta.stop_reason;
const call = (index: number, fn: Record<string, unknown>, id?: string) =>
  ({ choices: [{ delta: { tool_calls: [{ index, ...(id ? { id } : {}), function: fn }] } }] });
const finish = (reason = 'tool_calls') => ({ choices: [{ delta: {}, finish_reason: reason }] });
const say = (content: string) => ({ choices: [{ delta: { content } }] });

describe('stream: assembling native tool calls', () => {
  it('ignores a name the gateway repeats in every chunk', () => {
    const frames = run([
      call(0, { name: 'Bash', arguments: '{"comm' }, 'c1'),
      call(0, { name: 'Bash', arguments: 'and":"ls"}' }),
      finish(),
    ]);
    expect(toolUses(frames)).toEqual([{ name: 'Bash', input: { command: 'ls' } }]);
  });

  it('joins a name the gateway splits across chunks', () => {
    const frames = run([call(0, { name: 'Ba' }, 'c1'), call(0, { name: 'sh', arguments: '{"command":"ls"}' }), finish()]);
    expect(toolUses(frames)).toEqual([{ name: 'Bash', input: { command: 'ls' } }]);
  });

  it('separates parallel calls a gateway sends all on index 0', () => {
    const frames = run([
      call(0, { name: 'Read', arguments: '{"file_path":"a.ts"}' }, 'c1'),
      call(0, { name: 'Read', arguments: '{"file_path":"b.ts"}' }, 'c2'),
      finish(),
    ]);
    expect(toolUses(frames)).toEqual([
      { name: 'Read', input: { file_path: 'a.ts' } },
      { name: 'Read', input: { file_path: 'b.ts' } },
    ]);
  });

  it('resolves a near-miss name and repairs its arguments, and logs both', () => {
    const notes: string[] = [];
    const frames = run([call(0, { name: 'read_file', arguments: "{'path': 'a.ts', 'limit': '20'}" }, 'c1'), finish()], TOOLS, notes);
    expect(toolUses(frames)).toEqual([{ name: 'Read', input: { file_path: 'a.ts', limit: 20 } }]);
    expect(notes).toContain('tool name "read_file" -> "Read"');
    expect(notes.some((n) => n.includes('repaired malformed JSON'))).toBe(true);
  });

  it('drops a call that never got a name, and does not leave the CLI waiting on it', () => {
    const frames = run([call(0, { arguments: '{"x":1}' }, 'c1'), finish()]);
    expect(toolUses(frames)).toEqual([]);
    expect(stopReason(frames)).toBe('end_turn');
  });

  it('accepts arguments sent as an object instead of a string', () => {
    const frames = run([call(0, { name: 'Read', arguments: { file_path: 'a.ts' } }, 'c1'), finish()]);
    expect(toolUses(frames)).toEqual([{ name: 'Read', input: { file_path: 'a.ts' } }]);
  });

  it('leaves names and arguments alone when the request carried no tools', () => {
    const frames = run([call(0, { name: 'read_file', arguments: '{"path":"a"}' }, 'c1'), finish()], []);
    expect(toolUses(frames)).toEqual([{ name: 'read_file', input: { path: 'a' } }]);
  });
});

describe('stream: recovering tool calls written as text', () => {
  it.each([
    ['Hermes / Qwen', '<tool_call>\n{"name": "Read", "arguments": {"file_path": "a.ts"}}\n</tool_call>'],
    ['Hermes without a closing tag', '<tool_call>{"name":"Read","arguments":{"file_path":"a.ts"}}'],
    ['Qwen3-Coder XML', '<function=Read>\n<parameter=file_path>\na.ts\n</parameter>\n</function>'],
    ['gpt-oss', 'to=functions.Read <|constrain|>json<|message|>{"file_path":"a.ts"}'],
    ['Mistral array', '[TOOL_CALLS][{"name":"Read","arguments":{"file_path":"a.ts"}}]'],
    ['Mistral named', '[TOOL_CALLS]Read[ARGS]{"file_path":"a.ts"}'],
    ['Llama 3', '<|python_tag|>{"name": "Read", "parameters": {"file_path": "a.ts"}}'],
    ['DeepSeek', '<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>Read\n```json\n{"file_path":"a.ts"}\n```<｜tool▁call▁end｜><｜tool▁calls▁end｜>'],
    ['whole-reply fenced JSON', '```json\n{"name": "Read", "arguments": {"file_path": "a.ts"}}\n```'],
  ])('%s', (_label, markup) => {
    const frames = run([say(markup), finish('stop')]);
    expect(toolUses(frames)).toEqual([{ name: 'Read', input: { file_path: 'a.ts' } }]);
    expect(stopReason(frames)).toBe('tool_use');
    expect(text(frames)).toBe('');
  });

  it('keeps the prose before the call, even when the marker is split across chunks', () => {
    const frames = run([
      say('Let me read it. <tool'),
      say('_call>{"name":"Read","arguments":{"file_path":"a.ts"}}</tool_call>'),
      finish('stop'),
    ]);
    expect(text(frames)).toBe('Let me read it. ');
    expect(toolUses(frames)).toEqual([{ name: 'Read', input: { file_path: 'a.ts' } }]);
  });

  it('recovers several calls in one reply, in order', () => {
    const frames = run([
      say('<tool_call>{"name":"Read","arguments":{"file_path":"a"}}</tool_call>\n'),
      say('<tool_call>{"name":"bash","arguments":{"command":"ls"}}</tool_call>'),
      finish('stop'),
    ]);
    expect(toolUses(frames).map((c) => c.name)).toEqual(['Read', 'Bash']);
  });

  it('repairs recovered arguments against the schema too', () => {
    const frames = run([say('<function=Read><parameter=file_path>a.ts</parameter><parameter=limit>20</parameter></function>'), finish('stop')]);
    expect(toolUses(frames)).toEqual([{ name: 'Read', input: { file_path: 'a.ts', limit: 20 } }]);
  });

  it('leaves prose that only mentions a tool call alone', () => {
    const prose = 'Use <tool_call>{"name":"Deploy","arguments":{}}</tool_call> to deploy.';
    const frames = run([say(prose), finish('stop')]);
    expect(toolUses(frames)).toEqual([]);
    expect(text(frames)).toBe(prose);
    expect(stopReason(frames)).toBe('end_turn');
  });

  it('does not touch an answer that opens with an ordinary code block', () => {
    const answer = '```ts\nconst x = 1;\n```\nThat is the fix.';
    const frames = run([say(answer.slice(0, 5)), say(answer.slice(5)), finish('stop')]);
    expect(text(frames)).toBe(answer);
    expect(toolUses(frames)).toEqual([]);
  });

  it('does not recover from text when the model also made a native call', () => {
    const frames = run([
      say('<tool_call>{"name":"Bash","arguments":{"command":"rm -rf x"}}</tool_call>'),
      call(0, { name: 'Read', arguments: '{"file_path":"a"}' }, 'c1'),
      finish(),
    ]);
    expect(toolUses(frames)).toEqual([{ name: 'Read', input: { file_path: 'a' } }]);
    expect(text(frames)).toContain('<tool_call>');
  });

  it('streams plain text without holding it, when the request has no tools', () => {
    const stream = new OpenAiToAnthropicStream({ model: 'm' });
    const first = stream.push(say('<tool_call> is just text here'));
    expect(first.some((f) => f.includes('text_delta'))).toBe(true);
  });
});

describe('non-streamed replies get the same repair', () => {
  it('recovers a text tool call and resolves names in a whole message', () => {
    const msg: any = toAnthropicMessage(
      { choices: [{ message: { content: 'Reading.\n<tool_call>{"name":"read_file","arguments":{"path":"a.ts"}}</tool_call>' }, finish_reason: 'stop' }] },
      'm',
      { tools: TOOLS },
    );
    expect(msg.content).toEqual([
      { type: 'text', text: 'Reading.' },
      { type: 'tool_use', id: expect.any(String), name: 'Read', input: { file_path: 'a.ts' } },
    ]);
    expect(msg.stop_reason).toBe('tool_use');
  });

  it('repairs malformed native arguments instead of passing _raw', () => {
    const msg: any = toAnthropicMessage(
      { choices: [{ message: { tool_calls: [{ id: 'c', function: { name: 'Read', arguments: "{'file_path':'a.ts'" } }] }, finish_reason: 'tool_calls' }] },
      'm',
      { tools: TOOLS },
    );
    expect(msg.content[0]).toMatchObject({ type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } });
  });
});

describe('textToolCalls helpers', () => {
  it('finds the earliest marker', () => {
    expect(findMarker('abc to=functions.x <tool_call>')).toBe(4);
    expect(findMarker('nothing here')).toBe(-1);
  });

  it('holds back a tail that could still become a marker', () => {
    expect(partialMarkerTail('hello <tool_c')).toBe(7);
    expect(partialMarkerTail('hello world.')).toBe(0);
  });

  it('extracts balanced JSON, ignoring braces inside strings', () => {
    expect(balancedJson('x {"a":"}{","b":{"c":1}} tail', 2)).toBe('{"a":"}{","b":{"c":1}}');
    expect(balancedJson('{"open":', 0)).toBeUndefined();
  });

  it('returns nothing when no call names an offered tool', () => {
    expect(recoverToolCalls('<tool_call>{"name":"Nope","arguments":{}}</tool_call>', TOOLS)).toBeUndefined();
  });
});

describe('repairJson: the mistakes small models make in tool arguments', () => {
  it.each([
    ["{'file_path': 'a.ts'}", { file_path: 'a.ts' }],
    ['{"a": 1,}', { a: 1 }],
    ['{"a": [1, 2,]}', { a: [1, 2] }],
    ['{"file_path": "a.ts"', { file_path: 'a.ts' }],
    ['{"file_path": "a.t', { file_path: 'a.t' }],
    ['{"k":', { k: null }],
    ['{"a": True, "b": False, "c": None}', { a: true, b: false, c: null }],
    ['{file_path: "a.ts", limit: 5}', { file_path: 'a.ts', limit: 5 }],
    ['{"a": "line\none\ttab"}', { a: 'line\none\ttab' }],
    ["{'s': 'it\\'s \"quoted\"'}", { s: 'it\'s "quoted"' }],
    ['{"a": 1 // why\n, /* note */ "b": 2}', { a: 1, b: 2 }],
    ['{"a": {"b": [1, {"c": 2', { a: { b: [1, { c: 2 }] } }],
  ])('%s', (raw, expected) => {
    expect(JSON.parse(repairJson(raw))).toEqual(expected);
  });

  it.each(['nonsense text', '{not json'])('refuses what it cannot make valid: %s', (raw) => {
    expect(() => repairJson(raw)).toThrow();
  });

  it('leaves valid JSON meaning unchanged', () => {
    const valid = '{"command":"echo \\"hi\\"","n":[1,2.5,-3],"ok":true,"x":null}';
    expect(JSON.parse(repairJson(valid))).toEqual(JSON.parse(valid));
  });
});
