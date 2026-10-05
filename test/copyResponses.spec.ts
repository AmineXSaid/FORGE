/**
 * "Copy responses" (2026-10-05): everything the model wrote on the chat page.
 */
import { describe, expect, it } from 'vitest';
import { responsesText } from '../src/webview/src/core/copyResponses';
import { Message } from '../src/webview/src/models/Message';
import { processAndAttachMessage } from '../src/webview/src/utils/messageUtils';

const rows = (raws: any[]): Message[] => {
  const out: Message[] = [];
  for (const raw of raws) processAndAttachMessage(out, raw);
  return out;
};
const user = (text: string) => ({ type: 'user', uuid: `u-${text}`, parent_tool_use_id: null, message: { role: 'user', content: text } });
const assistant = (id: string, content: any[], parent: string | null = null) => ({ type: 'assistant', uuid: `a-${id}`, parent_tool_use_id: parent, message: { id, role: 'assistant', content } });

describe('responsesText', () => {
  it('joins every top-level reply, in order, with a blank line', () => {
    const m = rows([
      user('first'),
      assistant('m1', [{ type: 'text', text: 'Hello.\n\n```ts\nconst a = 1;\n```' }]),
      user('second'),
      assistant('m2', [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: '  Done.  ' }]),
    ]);
    expect(responsesText(m)).toBe('Hello.\n\n```ts\nconst a = 1;\n```\n\nDone.');
  });

  it('leaves out the user, tool calls, thinking, subagents and empty placeholders', () => {
    const m = rows([
      user('do it'),
      assistant('m1', [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' } }]),
      { type: 'user', uuid: 'r1', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file text' }] } },
      assistant('s1', [{ type: 'text', text: 'subagent chatter' }], 'tu-agent'),
      assistant('m2', [{ type: 'text', text: '(no content)' }]),
      assistant('m3', [{ type: 'text', text: 'Final answer.' }]),
    ]);
    expect(responsesText(m)).toBe('Final answer.');
  });

  it('nothing written, nothing to copy', () => {
    expect(responsesText(rows([user('hi')]))).toBe('');
  });
});
