/**
 * A subagent's messages are not the user's.
 *
 * Found on Windows (2026-09-25): a model that delegates to subagents (the
 * Agent/Task tool) filled the chat with the prompts it wrote for them, drawn
 * as if the user had typed them, because Forge's `Message` dropped
 * `parent_tool_use_id`. The official keeps it on every message (`VT`:
 * `parentToolUseId` on user messages, `sdkParentToolUseId` on both) and tests
 * it in the row renderer (`Kt`), focus view (`BL1`, `Qv`, `Xv`) and the rewind
 * list (`yH0`).
 */
import { describe, expect, it } from 'vitest';
import { Message, isSubagentMessage } from '../src/webview/src/models/Message';
import { focusViewRows, isFocusVisible } from '../src/webview/src/core/focusView';
import { rewindTargets } from '../src/webview/src/core/rewind';

const TASK = 'toolu_agent_1';

/** The turn as the CLI streams it (see mock-host `__forgeSeedSubagentTranscript`). */
function transcript(): Message[] {
    const raw = [
        { type: 'user', uuid: 'u1', parent_tool_use_id: null, message: { role: 'user', content: 'dig all testcases' } },
        { type: 'assistant', uuid: 'a1', parent_tool_use_id: null, message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: TASK, name: 'Task', input: { prompt: 'Read the fixtures.' } }] } },
        { type: 'user', uuid: 'u2', parent_tool_use_id: TASK, message: { role: 'user', content: [{ type: 'text', text: 'I am debugging a TLS test failure. Read the fixtures.' }] } },
        { type: 'assistant', uuid: 'a2', parent_tool_use_id: TASK, message: { id: 'm2', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: 'x.py' } }] } },
        { type: 'user', uuid: 'u3', parent_tool_use_id: TASK, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_read', content: 'ok' }] } },
        { type: 'assistant', uuid: 'a3', parent_tool_use_id: TASK, message: { id: 'm3', role: 'assistant', content: [{ type: 'text', text: 'Subagent summary.' }] } },
        { type: 'user', uuid: 'u4', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: TASK, content: 'done' }] } },
        { type: 'assistant', uuid: 'a4', parent_tool_use_id: null, message: { id: 'm4', role: 'assistant', content: [{ type: 'text', text: 'Every TLS test builds its own TlsFactory.' }] } },
    ];
    return raw.map((r) => Message.fromRaw(r)!);
}

describe('the parent id, as the official VT keeps it', () => {
    it('is parentToolUseId on a user message and sdkParentToolUseId on both roles', () => {
        const [, , prompt, subCall] = transcript();
        expect(prompt.parentToolUseId).toBe(TASK);
        expect(prompt.sdkParentToolUseId).toBe(TASK);
        expect(subCall.parentToolUseId).toBeNull();
        expect(subCall.sdkParentToolUseId).toBe(TASK);
    });

    it('is absent on the main conversation', () => {
        const [userPrompt, taskCall] = transcript();
        expect(isSubagentMessage(userPrompt)).toBe(false);
        expect(isSubagentMessage(taskCall)).toBe(false);
    });

    it('marks every subagent message (the official Xv)', () => {
        const rows = transcript();
        expect(rows.map(isSubagentMessage)).toEqual([false, false, true, true, true, true, false, false]);
    });
});

describe('focus view', () => {
    it('never takes a subagent prompt for the user (BL1) or a subagent reply for the answer (Xv)', () => {
        const [, , prompt, , , subReply, , reply] = transcript();
        expect(isFocusVisible(prompt)).toBe(false);
        expect(isFocusVisible(subReply)).toBe(false);
        expect(isFocusVisible(reply)).toBe(true);
    });

    it('keeps the subagent inside the one turn: the prompt, one fold, the answer', () => {
        const rows = focusViewRows(transcript(), { busy: false, isToolHidden: () => false });
        expect(rows.map((r) => r.kind)).toEqual(['message', 'fold', 'message']);
        const shown = rows.filter((r) => r.kind === 'message').map((r) => (r as { msg: Message }).msg.uuid);
        expect(shown).toEqual(['u1', 'a4']);
    });
});

describe('the rewind list', () => {
    it('offers the user prompt and not the subagent prompt', () => {
        const targets = rewindTargets(
            transcript().map((m) => ({
                type: m.type,
                uuid: m.uuid,
                parentToolUseId: m.parentToolUseId ?? undefined,
                timestamp: m.timestamp,
                text: typeof m.message.content === 'string'
                    ? m.message.content
                    : m.message.content.map((w) => (w.content.type === 'text' ? w.content.text : '')).join(''),
            }))
        );
        expect(targets.map((t) => t.promptText)).toEqual(['dig all testcases']);
    });
});
