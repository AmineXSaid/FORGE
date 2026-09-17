import { describe, expect, it } from 'vitest';
import { Message } from '../src/webview/src/models/Message';
import { ContentBlockWrapper } from '../src/webview/src/models/ContentBlockWrapper';
import { messageStatus, statusDotClass } from '../src/webview/src/utils/messageStatus';
import { processAndAttachMessage } from '../src/webview/src/utils/messageUtils';

const text = (t = 'hello') => new ContentBlockWrapper({ type: 'text', text: t });
const tool = (id = 'tu_1', result?: { is_error?: boolean }) => {
	const wrapper = new ContentBlockWrapper({ type: 'tool_use', id, name: 'Bash', input: {} } as any);
	if (result) wrapper.setToolResult({ type: 'tool_result', tool_use_id: id, content: 'out', is_error: result.is_error } as any);
	return wrapper;
};
const assistant = (...wrappers: ContentBlockWrapper[]) => new Message('assistant', { role: 'assistant', content: wrappers });

describe('messageStatus (official p85)', () => {
	it('text only: no status, busy or not', () => {
		expect(messageStatus(assistant(text()), true)).toBeNull();
		expect(messageStatus(assistant(text()), false)).toBeNull();
	});

	it('tool_use without a result, not busy: failure', () => {
		expect(messageStatus(assistant(tool()), false)).toBe('failure');
	});

	it('tool_use without a result, busy: progress', () => {
		expect(messageStatus(assistant(tool()), true)).toBe('progress');
	});

	it('tool result with is_error: failure, even while busy', () => {
		expect(messageStatus(assistant(tool('tu_1', { is_error: true })), true)).toBe('failure');
		expect(messageStatus(assistant(tool('tu_1', { is_error: true })), false)).toBe('failure');
	});

	it('tool result without an error: success, busy or not', () => {
		expect(messageStatus(assistant(tool('tu_1', { is_error: false })), true)).toBe('success');
		expect(messageStatus(assistant(tool('tu_1', {})), false)).toBe('success');
	});

	it('only the first tool_use decides', () => {
		expect(messageStatus(assistant(text(), tool('a', { is_error: false }), tool('b', { is_error: true })), false)).toBe('success');
		expect(messageStatus(assistant(tool('a', { is_error: true }), tool('b', { is_error: false })), false)).toBe('failure');
		expect(messageStatus(assistant(tool('a'), tool('b', { is_error: false })), true)).toBe('progress');
	});

	it('thinking or other non-tool blocks give no status', () => {
		const thinking = new ContentBlockWrapper({ type: 'thinking', thinking: 'hmm' });
		expect(messageStatus(assistant(thinking, text()), true)).toBeNull();
	});

	it('a non-assistant message or string content gives no status', () => {
		const user = new Message('user', { role: 'user', content: [tool()] });
		expect(messageStatus(user, true)).toBeNull();
		expect(messageStatus(new Message('assistant', { role: 'assistant', content: 'plain' }), true)).toBeNull();
		expect(messageStatus(assistant(), true)).toBeNull();
	});

	it('follows the result once it is attached to the tool_use', () => {
		const messages: Message[] = [];
		processAndAttachMessage(messages, {
			type: 'assistant',
			message: { id: 'm1', content: [{ type: 'tool_use', id: 'tu_9', name: 'Read', input: {} }] },
		});
		const row = messages[0];
		expect(messageStatus(row, true)).toBe('progress');
		processAndAttachMessage(messages, {
			type: 'user',
			message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_9', content: 'boom', is_error: true }] },
		});
		expect(messageStatus(row, true)).toBe('failure');
		expect(messageStatus(row, false)).toBe('failure');
	});
});

describe('statusDotClass (official u85)', () => {
	it('maps each status to its ported class, and no status to no class', () => {
		expect(statusDotClass('success')).toBe('fg-chat__dotSuccess');
		expect(statusDotClass('failure')).toBe('fg-chat__dotFailure');
		expect(statusDotClass('progress')).toBe('fg-chat__dotProgress');
		expect(statusDotClass(null)).toBe('');
	});
});
