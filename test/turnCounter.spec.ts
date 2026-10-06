/**
 * 48b: the host's step count for a conversation already running when Alpha
 * mode goes on (`turnCounter.ts`), and where `ClaudeAgentService` resets it.
 */
import { describe, expect, it, vi } from 'vitest';
import { countTurn, isModelTurn, resetTurns, type TurnCount } from '../src/services/claude/turnCounter';
import { ClaudeAgentService } from '../src/services/claude/ClaudeAgentService';

const toolTurn = (extra: Record<string, unknown> = {}) => ({
    type: 'assistant',
    parent_tool_use_id: null,
    message: { content: [{ type: 'text', text: 'x' }, { type: 'tool_use', id: 't', name: 'Bash', input: {} }, { type: 'tool_use', id: 'u', name: 'Read', input: {} }] },
    ...extra,
});

describe('isModelTurn', () => {
    it('counts only root assistant messages that carry a tool_use (parallel calls once)', () => {
        expect(isModelTurn(toolTurn())).toBe(true);
        expect(isModelTurn(toolTurn({ parent_tool_use_id: 'toolu_sub' }))).toBe(false);
        expect(isModelTurn({ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } })).toBe(false);
        expect(isModelTurn({ type: 'user', message: { content: [{ type: 'tool_result' }] } })).toBe(false);
        expect(isModelTurn({ type: 'result' })).toBe(false);
    });
});

describe('countTurn', () => {
    it('interrupts at the 61st model turn under Alpha when the launch had no maxTurns, once', () => {
        const c: TurnCount = { turns: 0 };
        for (let i = 0; i < 60; i++) expect(countTurn(c, toolTurn(), true)).toBe(false);
        expect(countTurn(c, toolTurn(), true)).toBe(true);
        expect(countTurn(c, toolTurn(), true)).toBe(false);
        expect(c.turns).toBe(62);
    });

    it('never interrupts when the launch set maxTurns (it only counts), or with Alpha off', () => {
        const launched: TurnCount = { turns: 0, launchMaxTurns: 60 };
        const off: TurnCount = { turns: 0 };
        for (let i = 0; i < 80; i++) {
            expect(countTurn(launched, toolTurn(), true)).toBe(false);
            expect(countTurn(off, toolTurn(), false)).toBe(false);
        }
        expect(launched.turns).toBe(80);
    });

    it('resets on user input', () => {
        const c: TurnCount = { turns: 0 };
        for (let i = 0; i < 61; i++) countTurn(c, toolTurn(), true);
        resetTurns(c);
        expect(c).toEqual({ turns: 0, capped: false });
        expect(countTurn(c, toolTurn(), true)).toBe(false);
    });
});

describe('ClaudeAgentService: user input resets the channel count', () => {
    it('a user message sent into a channel starts the count again', () => {
        const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() };
        const s = new (ClaudeAgentService as any)(log, {}, {}, {}, {}, {}, {}, {}, {}, { postMessage: vi.fn() });
        const turnCount: TurnCount = { turns: 42, capped: true };
        s.channels = new Map([['ch', { in: { enqueue: vi.fn(), done: vi.fn() }, query: {}, turnCount }]]);
        s.watchdog = { turnStarted: vi.fn() };
        s.transportMessage('ch', { type: 'user', message: { role: 'user', content: 'go' }, uuid: 'u1' }, false);
        expect(turnCount).toEqual({ turns: 0, capped: false });
    });
});
