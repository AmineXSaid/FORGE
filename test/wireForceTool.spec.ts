/**
 * Forced tool mode (`capabilities.forceToolUse`): claude-code-router's
 * `tooluse` transformer. Every request with tools goes out with
 * tool_choice "required" plus an ExitTool, and a call to ExitTool comes back
 * as the reply's text -- the CLI never sees it.
 */
import { describe, expect, it } from 'vitest';
import { EXIT_TOOL_NAME, forcesToolUse, toOpenAI } from '../src/services/endpoints/wire/toOpenAI';
import { OpenAiToAnthropicStream } from '../src/services/endpoints/wire/fromOpenAI';
import { toAnthropicMessage } from '../src/services/endpoints/wire/anthropicServer';
import { parseProfile } from '../src/services/endpoints/profile';

const TOOLS = [{ name: 'Read', input_schema: { type: 'object', properties: { file_path: { type: 'string' } } } }];
const profile = (forceToolUse: boolean) => parseProfile(
  { name: 'gw', wire: 'openai', baseUrl: 'https://gw/v1', model: 'm', capabilities: { forceToolUse } }, 'test');

describe('the request', () => {
  it('adds ExitTool, requires a tool, and says so at the end of the system prompt', () => {
    const { body } = toOpenAI({ model: 'm', system: 'You are helpful.', tools: TOOLS, messages: [{ role: 'user', content: 'hi' }] }, profile(true));
    expect((body.tools as any[]).map((t) => t.function.name)).toEqual(['Read', EXIT_TOOL_NAME]);
    expect(body.tool_choice).toBe('required');
    const system = (body.messages as any[])[0];
    expect(system.role).toBe('system');
    expect(system.content).toMatch(/^You are helpful\.\n\nTool mode is active/);
  });

  it('is off by default, and off for requests without tools or with a pinned choice', () => {
    const base = { model: 'm', messages: [{ role: 'user' as const, content: 'hi' }] };
    expect(forcesToolUse({ ...base, tools: TOOLS }, profile(false).capabilities)).toBe(false);
    expect(forcesToolUse(base, profile(true).capabilities)).toBe(false);
    expect(forcesToolUse({ ...base, tools: TOOLS, tool_choice: { type: 'tool', name: 'Read' } }, profile(true).capabilities)).toBe(false);
    expect(forcesToolUse({ ...base, tools: TOOLS, tool_choice: { type: 'none' } }, profile(true).capabilities)).toBe(false);
    expect(forcesToolUse({ ...base, tools: TOOLS, tool_choice: { type: 'auto' } }, profile(true).capabilities)).toBe(true);
  });
});

/** Run chunks through a stream in forced mode; return text, tool names and stop reason. */
function run(chunks: any[]) {
  const stream = new OpenAiToAnthropicStream({ model: 'm', tools: TOOLS, exitTool: EXIT_TOOL_NAME });
  const frames = [...chunks.flatMap((c) => stream.push(c)), ...stream.end()]
    .map((f) => JSON.parse(f.split('\n').find((l) => l.startsWith('data: '))!.slice(6)));
  return {
    text: frames.filter((f) => f.delta?.type === 'text_delta').map((f) => f.delta.text).join(''),
    tools: frames.filter((f) => f.type === 'content_block_start' && f.content_block.type === 'tool_use').map((f) => f.content_block.name),
    stop: frames.find((f) => f.type === 'message_delta').delta.stop_reason,
  };
}
const call = (index: number, name: string, args: unknown) =>
  ({ choices: [{ delta: { tool_calls: [{ index, id: `c${index}`, function: { name, arguments: JSON.stringify(args) } }] } }] });
const finish = { choices: [{ delta: {}, finish_reason: 'tool_calls' }] };

describe('the reply', () => {
  it('turns an ExitTool call into the final text and ends the turn', () => {
    const out = run([call(0, EXIT_TOOL_NAME, { response: 'The file says hello.' }), finish]);
    expect(out).toEqual({ text: 'The file says hello.', tools: [], stop: 'end_turn' });
  });

  it('keeps real tool calls made alongside it', () => {
    const out = run([call(0, 'Read', { file_path: 'a' }), call(1, EXIT_TOOL_NAME, { response: 'Reading a.' }), finish]);
    expect(out.tools).toEqual(['Read']);
    expect(out.text).toBe('Reading a.');
    expect(out.stop).toBe('tool_use');
  });

  it('does the same for a non-streamed reply', () => {
    const msg: any = toAnthropicMessage(
      { choices: [{ message: { tool_calls: [{ id: 'x', function: { name: EXIT_TOOL_NAME, arguments: '{"response":"done"}' } }] }, finish_reason: 'tool_calls' }] },
      'm',
      { tools: TOOLS, exitTool: EXIT_TOOL_NAME },
    );
    expect(msg.content).toEqual([{ type: 'text', text: 'done' }]);
    expect(msg.stop_reason).toBe('end_turn');
  });
});
