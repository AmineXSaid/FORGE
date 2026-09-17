import { describe, expect, it } from 'vitest';
import {
	StreamAssembler,
	applyDelta,
	finishToolInput,
	stablePartialText,
} from '../src/webview/src/models/StreamAssembler';
import { Message } from '../src/webview/src/models/Message';
import { ContentBlockWrapper } from '../src/webview/src/models/ContentBlockWrapper';
import { processAndAttachMessage, retireStreamedRows } from '../src/webview/src/utils/messageUtils';

/** A harness like Session's: rows created by the assembler go into `messages`. */
function makeStream() {
	const messages: Message[] = [];
	const starts: string[] = [];
	const assembler = new StreamAssembler(
		(betaMessageId) => {
			const row = new Message('assistant', { role: 'assistant', content: [] }, 0, { betaMessageId });
			messages.push(row);
			return row;
		},
		(id) => starts.push(id)
	);
	const send = (event: any, parent: string | null = null) => assembler.processStreamEvent(event, parent);
	return { messages, starts, send };
}

const wrappersOf = (m: Message) => m.message.content as ContentBlockWrapper[];
const textOf = (m: Message) => (wrappersOf(m)[0].content as { text: string }).text;

const messageStart = (id: string) => ({ type: 'message_start', message: { id, content: [], usage: {} } });
const blockStart = (index: number, content_block: any) => ({ type: 'content_block_start', index, content_block });
const textDelta = (index: number, text: string) => ({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } });
const blockStop = (index: number) => ({ type: 'content_block_stop', index });

describe('stablePartialText (official wL0)', () => {
	it('keeps a single paragraph as it is', () => {
		expect(stablePartialText('Hello, wor')).toBe('Hello, wor');
	});

	it('drops the last paragraph once there are two', () => {
		expect(stablePartialText('First paragraph.\n\nSecond, still gro')).toBe('First paragraph.');
	});

	it('hides a trailing unclosed code fence', () => {
		expect(stablePartialText('Here is code:\n\n```ts\nconst a = 1;')).toBe('Here is code:');
	});

	it('hides a trailing half-streamed table', () => {
		expect(stablePartialText('Intro.\n\n| a | b |\n| - | - |\n| 1 |')).toBe('Intro.');
	});

	it('joins the kept paragraphs with exactly one blank line', () => {
		expect(stablePartialText('A\n\n\n\nB\n\nC')).toBe('A\n\nB');
	});

	it('splits inside a fence that contains a blank line, as the official does', () => {
		expect(stablePartialText('```\nline one\n\nline two')).toBe('```\nline one');
	});

	it('returns an empty text unchanged', () => {
		expect(stablePartialText('')).toBe('');
	});
});

describe('applyDelta / finishToolInput (official Bj0 / Kj0)', () => {
	it('appends text and thinking, and sets the signature', () => {
		const text: any = { type: 'text', text: 'a' };
		applyDelta(text, { type: 'text_delta', text: 'b' });
		expect(text.text).toBe('ab');

		const thinking: any = { type: 'thinking', thinking: 'x' };
		applyDelta(thinking, { type: 'thinking_delta', thinking: 'y' });
		applyDelta(thinking, { type: 'signature_delta', signature: 'sig' });
		expect(thinking).toMatchObject({ thinking: 'xy', signature: 'sig' });
	});

	it('collects citations on a text block', () => {
		const text: any = { type: 'text', text: '' };
		applyDelta(text, { type: 'citations_delta', citation: { cited_text: 'c' } });
		expect(text.citations).toEqual([{ cited_text: 'c' }]);
	});

	it('parses streamed tool input JSON when the block stops', () => {
		const tool: any = { type: 'tool_use', id: 't1', name: 'Read', input: {} };
		applyDelta(tool, { type: 'input_json_delta', partial_json: '{"file_path":' });
		applyDelta(tool, { type: 'input_json_delta', partial_json: '"a.ts"}' });
		expect(finishToolInput(tool)).toBeUndefined();
		expect(tool.input).toEqual({ file_path: 'a.ts' });
		expect(Object.getOwnPropertySymbols(tool)).toEqual([]);
	});

	it('keeps invalid tool JSON as a string and reports it', () => {
		const tool: any = { type: 'tool_use', input: {} };
		applyDelta(tool, { type: 'input_json_delta', partial_json: '{"broken' });
		expect(finishToolInput(tool)).toMatch(/not valid JSON/);
		expect(tool.input).toBe('{"broken');
	});

	it('reports a tool block that never received input', () => {
		const tool: any = { type: 'tool_use', input: {} };
		expect(finishToolInput(tool)).toMatch(/without receiving any input/);
		expect(tool.input).toEqual({});
	});

	it('ignores a delta whose type does not match its block', () => {
		const thinking: any = { type: 'thinking', thinking: 'keep' };
		applyDelta(thinking, { type: 'text_delta', text: 'nope' });
		expect(thinking).toEqual({ type: 'thinking', thinking: 'keep' });

		const redacted: any = { type: 'redacted_thinking', data: 'x' };
		applyDelta(redacted, { type: 'thinking_delta', thinking: 'nope' });
		expect(redacted).toEqual({ type: 'redacted_thinking', data: 'x' });

		const text: any = { type: 'text', text: 'keep' };
		applyDelta(text, { type: 'input_json_delta', partial_json: '{}' });
		applyDelta(text, { type: 'unknown_delta' });
		expect(text).toEqual({ type: 'text', text: 'keep' });
	});
});

describe('StreamAssembler (official y51 / pR1)', () => {
	it('builds a partial text row, grows it in place, and completes it on stop', () => {
		const { messages, starts, send } = makeStream();
		send(messageStart('msg_1'));
		send(blockStart(0, { type: 'text', text: '' }));

		expect(messages).toHaveLength(1);
		const row = messages[0];
		const wrapper = wrappersOf(row)[0];
		expect(row).toMatchObject({ type: 'assistant', betaMessageId: 'msg_1', uuid: undefined });
		expect(wrapper.isPartial).toBe(true);
		expect(row.isEmpty).toBe(true);

		send(textDelta(0, 'Para one.\n\n'));
		send(textDelta(0, '```js\nlet x'));
		expect(textOf(row)).toBe('Para one.\n\n```js\nlet x');
		expect(wrapper.revision()).toBe(2);
		expect(wrapper.isPartial).toBe(true);
		expect(row.isEmpty).toBe(false);
		expect(stablePartialText(textOf(row))).toBe('Para one.');

		send(blockStop(0));
		expect(wrapper.isPartial).toBe(false);
		expect(wrapper.revision()).toBe(3);

		send({ type: 'message_stop' });
		expect(starts).toEqual(['msg_1']);
	});

	it('ignores events that arrive before message_start or after message_stop', () => {
		const { messages, send } = makeStream();
		send(blockStart(0, { type: 'text', text: '' }));
		send(textDelta(0, 'lost'));
		send(blockStop(0));
		expect(messages).toHaveLength(0);

		send(messageStart('msg_1'));
		send(blockStart(0, { type: 'text', text: '' }));
		send({ type: 'message_stop' });
		send(textDelta(0, 'late'));
		send(blockStop(0));
		expect(textOf(messages[0])).toBe('');
		expect(wrappersOf(messages[0])[0].isPartial).toBe(true);
	});

	it('ignores a delta or stop for a block index it never saw, and unknown events', () => {
		const { messages, send } = makeStream();
		send(messageStart('msg_1'));
		send(blockStart(0, { type: 'text', text: 'a' }));
		send(textDelta(5, 'nope'));
		send(blockStop(5));
		send({ type: 'ping' });
		send(undefined);
		expect(textOf(messages[0])).toBe('a');
		expect(wrappersOf(messages[0])[0].isPartial).toBe(true);
	});

	it('gives each content block its own row', () => {
		const { messages, send } = makeStream();
		send(messageStart('msg_1'));
		send(blockStart(0, { type: 'thinking', thinking: '' }));
		send(blockStart(1, { type: 'text', text: '' }));
		send(blockStart(2, { type: 'tool_use', id: 'tu_1', name: 'Read', input: {} }));
		expect(messages.map((m) => wrappersOf(m)[0].content.type)).toEqual(['thinking', 'text', 'tool_use']);
		expect(messages.every((m) => m.betaMessageId === 'msg_1')).toBe(true);
	});

	it('hides a streaming tool_use row until it completes, then parses its input', () => {
		const { messages, send } = makeStream();
		send(messageStart('msg_1'));
		send(blockStart(0, { type: 'tool_use', id: 'tu_1', name: 'Read', input: {} }));
		send({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"file_path":"x.ts"}' } });
		expect(messages[0].isEmpty).toBe(true);

		send(blockStop(0));
		expect(messages[0].isEmpty).toBe(false);
		expect((wrappersOf(messages[0])[0].content as any).input).toEqual({ file_path: 'x.ts' });
	});

	it('does not build a row for a block type Forge renders only from the final message, but keeps indexes aligned', () => {
		const { messages, send } = makeStream();
		send(messageStart('msg_1'));
		send(blockStart(0, { type: 'redacted_thinking', data: 'opaque' }));
		send(blockStart(1, { type: 'text', text: '' }));
		send(textDelta(1, 'after redacted'));
		expect(messages).toHaveLength(1);
		expect(textOf(messages[0])).toBe('after redacted');
	});

	it('keeps a subagent stream apart from the root stream', () => {
		const { messages, starts, send } = makeStream();
		send(messageStart('root_1'));
		send(messageStart('sub_1'), 'toolu_task');
		send(blockStart(0, { type: 'text', text: '' }));
		send(blockStart(0, { type: 'text', text: '' }), 'toolu_task');
		send(textDelta(0, 'root text'));
		send(textDelta(0, 'sub text'), 'toolu_task');
		expect(messages.map(textOf)).toEqual(['root text', 'sub text']);
		expect(messages.map((m) => m.betaMessageId)).toEqual(['root_1', 'sub_1']);
		expect(starts).toEqual(['root_1']);
	});
});

describe('processAndAttachMessage with streaming (official ZM)', () => {
	const finalText = (id: string, uuid: string | undefined, text: string) => ({
		type: 'assistant',
		uuid,
		message: { id, role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text }] },
	});

	it('replaces the partial row with the final message, which is not partial', () => {
		const { messages, send } = makeStream();
		send(messageStart('msg_1'));
		send(blockStart(0, { type: 'text', text: '' }));
		send(textDelta(0, 'Done.\n\nTail'));
		send(blockStop(0));

		processAndAttachMessage(messages, finalText('msg_1', 'u1', 'Done.\n\nTail'), true);
		expect(messages).toHaveLength(1);
		expect(messages[0].uuid).toBe('u1');
		expect(wrappersOf(messages[0])[0].isPartial).toBe(false);
		expect(textOf(messages[0])).toBe('Done.\n\nTail');
	});

	it('replaces each row of a multi-block message with the final message of the same type', () => {
		const { messages, send } = makeStream();
		send(messageStart('msg_1'));
		send(blockStart(0, { type: 'text', text: '' }));
		send(textDelta(0, 'Reading'));
		send(blockStart(1, { type: 'tool_use', id: 'tu_1', name: 'Read', input: {} }));

		processAndAttachMessage(messages, {
			type: 'assistant',
			uuid: 'u2',
			message: { id: 'msg_1', model: 'm', content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'a' } }] },
		}, true);
		processAndAttachMessage(messages, finalText('msg_1', 'u1', 'Reading'), true);

		expect(messages.map((m) => m.uuid)).toEqual(['u1', 'u2']);
		expect(messages.map((m) => wrappersOf(m)[0].content.type)).toEqual(['text', 'tool_use']);
	});

	it('replaces a row that already has the same uuid', () => {
		const messages: Message[] = [];
		processAndAttachMessage(messages, finalText('msg_1', 'u1', 'first'), true);
		processAndAttachMessage(messages, finalText('msg_1', 'u1', 'second'), true);
		expect(messages.map(textOf)).toEqual(['second']);
	});

	it('appends when the session is not streaming, as before', () => {
		const { messages, send } = makeStream();
		send(messageStart('msg_1'));
		send(blockStart(0, { type: 'text', text: 'partial' }));
		processAndAttachMessage(messages, finalText('msg_1', 'u1', 'partial'), false);
		expect(messages).toHaveLength(2);
	});

	it('appends a final message without a uuid, or from a different API message', () => {
		const { messages, send } = makeStream();
		send(messageStart('msg_1'));
		send(blockStart(0, { type: 'text', text: 'partial' }));
		processAndAttachMessage(messages, finalText('msg_1', undefined, 'no uuid'), true);
		processAndAttachMessage(messages, finalText('msg_2', 'u9', 'other message'), true);
		expect(messages.map(textOf)).toEqual(['partial', 'no uuid', 'other message']);
	});

	it('does not let a blank final text replace a row, nor match a blank row', () => {
		const { messages, send } = makeStream();
		send(messageStart('msg_1'));
		send(blockStart(0, { type: 'text', text: '' }));
		processAndAttachMessage(messages, finalText('msg_1', 'u1', '(no content)'), true);
		expect(messages).toHaveLength(2);
		expect(messages[0].uuid).toBeUndefined();
		expect(messages[1].isEmpty).toBe(true);

		processAndAttachMessage(messages, finalText('msg_1', 'u2', 'real text'), true);
		expect(messages).toHaveLength(3);
	});

	it('never replaces a message that has no API message id (a local user row)', () => {
		const messages: Message[] = [Message.fromRaw({ type: 'user', message: { role: 'user', content: 'hi' } })!];
		processAndAttachMessage(messages, { type: 'assistant', uuid: 'u1', message: { model: 'm', content: [{ type: 'text', text: 'reply' }] } }, true);
		expect(messages.map((m) => m.type)).toEqual(['user', 'assistant']);
	});

	it('drops an assistant message with no renderable content', () => {
		const messages: Message[] = [];
		processAndAttachMessage(messages, { type: 'assistant', uuid: 'u1', message: { id: 'm', content: [{ type: 'redacted_thinking', data: 'x' }] } }, true);
		expect(messages).toHaveLength(0);
	});
});

describe('retireStreamedRows (official retireAbandonedStreamedRows)', () => {
	it('removes rows an abandoned stream left behind', () => {
		const { messages, send } = makeStream();
		send(messageStart('attempt_1'));
		send(blockStart(0, { type: 'text', text: 'stuck' }));
		const rows = [...messages];
		const kept = Message.fromRaw({ type: 'user', message: { role: 'user', content: 'prompt' } })!;
		const list = [kept, ...messages];
		expect(retireStreamedRows(list, rows)).toEqual([kept]);
	});

	it('returns the same array when every row was already replaced, or there are none', () => {
		const list = [Message.fromRaw({ type: 'user', message: { role: 'user', content: 'x' } })!];
		const replaced = new Message('assistant', { role: 'assistant', content: [] });
		expect(retireStreamedRows(list, [replaced])).toBe(list);
		expect(retireStreamedRows(list, [])).toBe(list);
	});
});

describe('Message.isEmpty (official _Z.isEmpty)', () => {
	const assistant = (...wrappers: ContentBlockWrapper[]) => new Message('assistant', { role: 'assistant', content: wrappers });

	it('is empty for blank text and the CLI "(no content)" placeholder', () => {
		expect(assistant(new ContentBlockWrapper({ type: 'text', text: '  \n' })).isEmpty).toBe(true);
		expect(assistant(new ContentBlockWrapper({ type: 'text', text: '(no content)' })).isEmpty).toBe(true);
		expect(assistant(new ContentBlockWrapper({ type: 'text', text: 'hi' })).isEmpty).toBe(false);
	});

	it('is empty only while every tool_use is still partial', () => {
		const tool = new ContentBlockWrapper({ type: 'tool_use', id: 't', name: 'Read', input: {} } as any, true);
		const message = assistant(tool);
		expect(message.isEmpty).toBe(true);
		tool.complete();
		expect(message.isEmpty).toBe(false);
	});

	it('is not empty when blank text sits next to a real block', () => {
		const message = assistant(
			new ContentBlockWrapper({ type: 'text', text: '' }),
			new ContentBlockWrapper({ type: 'thinking', thinking: 'x' })
		);
		expect(message.isEmpty).toBe(false);
	});
});
