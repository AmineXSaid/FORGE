/**
 * 48b: guard send-backs shown as one-line notes, live and on reload.
 *
 * Live: the host's `forge_guard_note` reaches the channel's stream (only when
 * it has one), and `Session` appends exactly one tip row without ending the
 * turn. Reload: the session loader turns each Forge marker in a transcript row
 * (measured formats, CLI 2.1.274) into its own tip row. Both stay out of Focus
 * view. The marker and the one-line texts come from `shared/guardNotes.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { signal } from 'alien-signals';
import { BaseTransport } from '../src/webview/src/transport/BaseTransport';
import { EventEmitter } from '../src/webview/src/utils/events';
import { Session } from '../src/webview/src/core/Session';
import { Message } from '../src/webview/src/models/Message';
import { isFocusVisible } from '../src/webview/src/core/focusView';
import { convertMessage, guardNotesFrom } from '../src/services/claude/ClaudeSessionService';
import { GUARD_NOTE_KINDS, guardMarker, guardMarkersIn, guardNoteText, isGuardNoteKind } from '../src/shared/guardNotes';

class TestTransport extends BaseTransport {
    sent: any[] = [];
    protected send(message: any): void {
        this.sent.push(message);
    }
    feed(message: any) {
        (this as any).fromHost.enqueue(message);
    }
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('shared/guardNotes', () => {
    it('finds every marker in a text, in order, and only known kinds', () => {
        const text = `${guardMarker('loop')} a\n\n${guardMarker('step-budget')} b [Forge check: bogus — not a user message]`;
        expect(guardMarkersIn(text)).toEqual(['loop', 'step-budget']);
        expect(isGuardNoteKind('claim')).toBe(true);
        expect(isGuardNoteKind('nope')).toBe(false);
    });

    it('has a one-line text for every kind, with counts where given', () => {
        for (const kind of GUARD_NOTE_KINDS) expect(guardNoteText(kind)).toMatch(/…$/);
        expect(guardNoteText('edit-errors', '2')).toBe('The last edit introduced 2 error(s); sent back to fix them…');
        expect(guardNoteText('step-budget', '10')).toBe('10 steps left this turn; asked to wrap up…');
        expect(guardNoteText('edit-errors', '<b>')).not.toContain('<b>');
    });
});

describe('live: forge_guard_note', () => {
    it("reaches the channel's stream as one __forge_guard_note__ event", async () => {
        const t = new TestTransport(new EventEmitter(), new EventEmitter());
        const stream = t.launchClaude('c1');
        t.feed({ type: 'forge_guard_note', channelId: 'c1', kind: 'edit-errors', detail: '1' });
        const first = await stream[Symbol.asyncIterator]().next();
        expect(first.value).toEqual({ type: '__forge_guard_note__', kind: 'edit-errors', detail: '1' });
    });

    it('is dropped for a channel the webview does not have', async () => {
        const t = new TestTransport(new EventEmitter(), new EventEmitter());
        expect(() => t.feed({ type: 'forge_guard_note', channelId: 'nope', kind: 'claim' })).not.toThrow();
        await tick();
    });

    function session() {
        const s = Object.create(Session.prototype);
        Object.assign(s, { busy: signal(true), messages: signal<any[]>([]), context: { showNotification: vi.fn() } });
        return s;
    }

    it('Session appends exactly one tip row and leaves the turn running', () => {
        const s = session();
        s.processIncomingMessage({ type: '__forge_guard_note__', kind: 'claim' });
        expect(s.busy()).toBe(true);
        expect(s.messages()).toHaveLength(1);
        const row = s.messages()[0] as Message;
        expect(row.type).toBe('tip');
        expect(JSON.stringify(row)).toContain('Checking the summary against what was actually done…');
        expect(isFocusVisible(row)).toBe(false);
    });

    it('ignores an unknown kind', () => {
        const s = session();
        s.processIncomingMessage({ type: '__forge_guard_note__', kind: 'whatever' });
        expect(s.messages()).toHaveLength(0);
    });
});

describe('reload: the session loader', () => {
    const base = { sessionId: 's1', timestamp: '2026-10-06T00:00:00Z' };

    it('a Forge-marked hook_additional_context attachment becomes a note row', () => {
        const rows = guardNotesFrom({
            ...base,
            uuid: 'a1',
            type: 'attachment',
            attachment: { type: 'hook_additional_context', content: [`${guardMarker('claim')} Before you finish: …`], hookEvent: 'Stop' },
        } as any);
        expect(rows).toEqual([
            {
                type: 'user',
                message: { role: 'user', content: [{ type: 'forge_note', kind: 'claim', text: guardNoteText('claim') }] },
                uuid: 'a1#note0',
                session_id: 's1',
                parent_tool_use_id: null,
            },
        ]);
    });

    it('two markers in one attachment become two tip rows, each with its own uuid, both hidden in Focus view', () => {
        const rows = guardNotesFrom({
            ...base,
            uuid: 'a2',
            type: 'attachment',
            attachment: { type: 'hook_additional_context', content: [`${guardMarker('step-budget')} x\n\n${guardMarker('loop')} y`] },
        } as any);
        expect(rows.map((r) => r.uuid)).toEqual(['a2#note0', 'a2#note1']);
        for (const raw of rows) {
            const m = Message.fromRaw(raw as any)!;
            expect(m.type).toBe('tip');
            expect(isFocusVisible(m)).toBe(false);
        }
    });

    it('a loop nudge inside a refused call`s tool_result becomes a note', () => {
        const rows = guardNotesFrom({
            ...base,
            uuid: 'u1',
            type: 'user',
            message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', is_error: true, content: `Refused.\n\n${guardMarker('loop')} Potential loop` }] },
        } as any);
        expect(rows.map((r) => r.message.content[0].kind)).toEqual(['loop']);
    });

    it('any other attachment, and a plain row, still produce nothing', () => {
        expect(guardNotesFrom({ ...base, uuid: 'x', type: 'attachment', attachment: { type: 'hook_additional_context', content: ['plain context'] } } as any)).toEqual([]);
        expect(guardNotesFrom({ ...base, uuid: 'y', type: 'attachment', attachment: { type: 'todo_reminder', content: [guardMarker('claim')] } } as any)).toEqual([]);
        expect(guardNotesFrom({ ...base, uuid: 'z', type: 'user', message: { role: 'user', content: guardMarker('claim') } } as any)).toEqual([]);
        expect(convertMessage({ ...base, uuid: 'w', type: 'attachment', attachment: { type: 'hook_additional_context', content: [guardMarker('claim')] } } as any)).toBeUndefined();
    });
});
