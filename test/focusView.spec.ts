/**
 * Step 30: Focus view.
 *
 * Host: `ClaudeAgentService.setFocusView` -- persist, push `viewMode` to every
 * running channel, broadcast -- and the init state that seeds it.
 * Webview: `core/focusView.ts`, the ported `DL1` and its labels.
 */
import { describe, expect, it, vi } from 'vitest';
import { ClaudeAgentService } from '../src/services/claude/ClaudeAgentService';
import { Message } from '../src/webview/src/models/Message';
import { ContentBlockWrapper } from '../src/webview/src/models/ContentBlockWrapper';
import {
    autoExpandedFolds,
    foldDotState,
    foldLabel,
    foldRunningLabel,
    focusViewRows,
    isFocusVisible,
    pruneSettled,
    reconcileExpanded,
    type FocusFold,
    type FocusRow,
} from '../src/webview/src/core/focusView';

// ---------------------------------------------------------------------------
// The host request
// ---------------------------------------------------------------------------

const req = (s: any, request: Record<string, unknown>, channelId?: string) =>
    s.processRequest({ type: 'request', requestId: 'r1', channelId, request }, undefined as any);

function hostFor(channels = ['ch1', 'ch2']) {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const updateExtensionConfig = vi.fn(async () => {});
    const postMessage = vi.fn();
    const applyFlagSettings = vi.fn(async () => {});
    const s = new (ClaudeAgentService as any)(
        log,
        { updateExtensionConfig },
        {},
        {},
        {},
        {},
        {},
        {},
        {},
        { postMessage }
    );
    s.channels = new Map(channels.map((id) => [id, { query: { applyFlagSettings } }]));
    return { s, updateExtensionConfig, postMessage, applyFlagSettings };
}

describe('set_focus_view', () => {
    it('persists, pushes viewMode to every channel, and broadcasts', async () => {
        const { s, updateExtensionConfig, postMessage, applyFlagSettings } = hostFor();
        expect(await req(s, { type: 'set_focus_view', enabled: true })).toEqual({
            type: 'set_focus_view_response',
        });
        expect(updateExtensionConfig).toHaveBeenCalledWith('focusView', true);
        expect(applyFlagSettings).toHaveBeenCalledTimes(2);
        expect(applyFlagSettings).toHaveBeenCalledWith({ viewMode: 'focus' });
        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage.mock.calls[0][0]).toMatchObject({
            type: 'request',
            request: { type: 'extension_config_changed', key: 'focusView', value: true },
        });
    });

    it('clears viewMode with null when switched off, as the official does', async () => {
        const { s, applyFlagSettings } = hostFor(['ch1']);
        await req(s, { type: 'set_focus_view', enabled: true });
        applyFlagSettings.mockClear();
        await req(s, { type: 'set_focus_view', enabled: false });
        expect(applyFlagSettings).toHaveBeenCalledWith({ viewMode: null });
    });

    it('does not re-push a value the channels already have (`lastAppliedFocusView`)', async () => {
        const { s, applyFlagSettings } = hostFor(['ch1']);
        await req(s, { type: 'set_focus_view', enabled: true });
        applyFlagSettings.mockClear();
        await req(s, { type: 'set_focus_view', enabled: true });
        expect(applyFlagSettings).not.toHaveBeenCalled();
    });

    it('refuses anything but a boolean, before writing (B3)', async () => {
        for (const enabled of [undefined, null, 'true', 1, 0, {}, []]) {
            const { s, updateExtensionConfig, applyFlagSettings } = hostFor(['ch1']);
            await expect(req(s, { type: 'set_focus_view', enabled })).rejects.toThrow(
                'set_focus_view: enabled must be a boolean'
            );
            expect(updateExtensionConfig).not.toHaveBeenCalled();
            expect(applyFlagSettings).not.toHaveBeenCalled();
        }
    });

    it('survives a channel whose push fails', async () => {
        const { s } = hostFor(['ch1']);
        s.channels.get('ch1').query.applyFlagSettings = async () => {
            throw new Error('gone');
        };
        await expect(req(s, { type: 'set_focus_view', enabled: true })).resolves.toEqual({
            type: 'set_focus_view_response',
        });
    });
});

// ---------------------------------------------------------------------------
// The transcript filter
// ---------------------------------------------------------------------------

const text = (value: string) => new ContentBlockWrapper({ type: 'text', text: value } as any);
const thinking = (partial = false) =>
    new ContentBlockWrapper({ type: 'thinking', thinking: 'hmm' } as any, partial);

function toolUse(name: string, id = `t-${name}`, input: unknown = {}, partial = false): ContentBlockWrapper {
    return new ContentBlockWrapper({ type: 'tool_use', id, name, input } as any, partial);
}

function withResult(wrapper: ContentBlockWrapper, isError = false): ContentBlockWrapper {
    wrapper.setToolResult({ type: 'tool_result', tool_use_id: 'x', content: 'ok', is_error: isError } as any);
    return wrapper;
}

let uuid = 0;
function user(value: string): Message {
    return new Message('user', { role: 'user', content: [text(value)] }, Date.now(), { uuid: `u${uuid++}` });
}
function assistant(blocks: ContentBlockWrapper[], betaMessageId?: string): Message {
    return new Message('assistant', { role: 'assistant', content: blocks }, Date.now(), {
        uuid: `a${uuid++}`,
        betaMessageId,
    });
}
function toolResultRow(id: string): Message {
    return new Message(
        'user',
        {
            role: 'user',
            content: [new ContentBlockWrapper({ type: 'tool_result', tool_use_id: id, content: 'ok' } as any)],
        },
        Date.now(),
        { uuid: `r${uuid++}` }
    );
}

const options = { busy: false, isToolHidden: (name: string) => name === 'TodoRead' };

describe('isFocusVisible (the official `f`)', () => {
    it('keeps a user prompt and an assistant message that has text', () => {
        expect(isFocusVisible(user('do the thing'))).toBe(true);
        expect(isFocusVisible(assistant([text('done')]))).toBe(true);
    });

    it('hides a tool-only assistant turn, a thinking-only turn and a tool-result row', () => {
        expect(isFocusVisible(assistant([toolUse('Bash')]))).toBe(false);
        expect(isFocusVisible(assistant([thinking()]))).toBe(false);
        expect(isFocusVisible(toolResultRow('t-Bash'))).toBe(false);
    });

    it('hides an assistant turn whose only text is blank', () => {
        expect(isFocusVisible(assistant([text('   ')]))).toBe(false);
    });

    it('keeps a meta row', () => {
        const meta = new Message('meta', { role: 'meta', content: [text('Rewound')] }, Date.now());
        expect(isFocusVisible(meta)).toBe(true);
    });
});

describe('focusViewRows (the official `DL1`)', () => {
    it('leaves a transcript of only prompts and replies untouched', () => {
        const messages = [user('hi'), assistant([text('hello')])];
        expect(focusViewRows(messages, options).map((r) => r.kind)).toEqual(['message', 'message']);
    });

    it('folds a run of tool calls into one row that counts them', () => {
        const a = withResult(toolUse('Bash', 't1'));
        const b = withResult(toolUse('Read', 't2'));
        const messages = [
            user('do it'),
            assistant([a]),
            toolResultRow('t1'),
            assistant([b]),
            toolResultRow('t2'),
            assistant([text('done')]),
        ];
        const rows = focusViewRows(messages, options);
        expect(rows.map((r) => r.kind)).toEqual(['message', 'fold', 'message']);
        const fold = (rows[1] as Extract<FocusRow, { kind: 'fold' }>).fold;
        expect(fold.toolCallCount).toBe(2);
        expect(fold.errorCount).toBe(0);
        expect(fold.progress).toBe('settled');
        expect(fold.messages.map((m) => m.idx)).toEqual([1, 2, 3, 4]);
        expect(foldLabel(fold)).toBe('2 tool calls');
    });

    it('counts a failed tool call', () => {
        const a = withResult(toolUse('Bash', 't1'), true);
        const rows = focusViewRows([user('do it'), assistant([a]), assistant([text('sorry')])], options);
        const fold = (rows[1] as Extract<FocusRow, { kind: 'fold' }>).fold;
        expect(fold.errorCount).toBe(1);
        expect(foldLabel(fold)).toBe('1 tool call · 1 failed');
        expect(foldDotState(fold, false)).toBe('failure');
    });

    it('skips a hidden tool, so a turn of only hidden tools folds to nothing', () => {
        const rows = focusViewRows([user('hi'), assistant([withResult(toolUse('TodoRead', 't1'))])], options);
        expect(rows.map((r) => r.kind)).toEqual(['message']);
    });

    it('labels a thinking-only fold, and says Thinking while it streams', () => {
        const rows = focusViewRows([user('hi'), assistant([thinking()]), assistant([text('ok')])], options);
        const fold = (rows[1] as Extract<FocusRow, { kind: 'fold' }>).fold;
        expect(fold.thinkingOnly).toBe(true);
        expect(fold.toolCallCount).toBe(0);
        // Forge never receives a thinking duration, so the label stays "Thinking".
        expect(fold.thinkingMillis).toBeNull();
        expect(foldLabel(fold)).toBe('Thinking');
    });

    it('marks the running turn live and names the tool it waits on', () => {
        const pending = toolUse('Bash', 't1');
        const rows = focusViewRows([user('do it'), assistant([pending])], { ...options, busy: true });
        const fold = (rows[1] as Extract<FocusRow, { kind: 'fold' }>).fold;
        expect(fold.progress).toBe('live');
        expect(fold.pendingToolName).toBe('Bash');
        expect(foldRunningLabel(fold, false)).toBe('Running Bash…');
        expect(foldRunningLabel(fold, true)).toBe('Waiting for permission…');
        expect(foldDotState(fold, false)).toBe('progress');
    });

    it('says "Waiting for your answer…" for AskUserQuestion', () => {
        const pending = toolUse('AskUserQuestion', 't1');
        const rows = focusViewRows([user('do it'), assistant([pending])], { ...options, busy: true });
        const fold = (rows[1] as Extract<FocusRow, { kind: 'fold' }>).fold;
        expect(foldRunningLabel(fold, false)).toBe('Waiting for your answer…');
    });

    it('does not keep an earlier turn live once a later prompt exists', () => {
        const messages = [
            user('first'),
            assistant([withResult(toolUse('Bash', 't1'))]),
            user('second'),
            assistant([withResult(toolUse('Read', 't2'))]),
        ];
        const rows = focusViewRows(messages, { ...options, busy: true });
        const folds = rows.filter((r): r is Extract<FocusRow, { kind: 'fold' }> => r.kind === 'fold');
        expect(folds).toHaveLength(2);
        expect(folds[0].fold.progress).toBe('settled');
    });

    it('starts a new fold after a visible reply, rather than one fold per turn', () => {
        const messages = [
            user('do it'),
            assistant([withResult(toolUse('Bash', 't1'))]),
            assistant([text('halfway')]),
            assistant([withResult(toolUse('Read', 't2'))]),
            assistant([text('done')]),
        ];
        expect(focusViewRows(messages, options).map((r) => r.kind)).toEqual([
            'message',
            'fold',
            'message',
            'fold',
            'message',
        ]);
    });

    it('lifts the last TodoWrite list out of its fold onto a row of its own', () => {
        const todo = withResult(toolUse('TodoWrite', 't1', { todos: [{ content: 'a', status: 'pending' }] }));
        const rows = focusViewRows(
            [user('plan it'), assistant([withResult(toolUse('Bash', 't0'))]), assistant([todo]), assistant([text('ok')])],
            options
        );
        expect(rows.map((r) => r.kind)).toEqual(['message', 'fold', 'todo', 'message']);
        expect((rows[2] as Extract<FocusRow, { kind: 'todo' }>).content).toBe(todo);
    });

    it('gives every fold a distinct key', () => {
        const messages = [
            user('do it'),
            assistant([withResult(toolUse('Bash', 't1'))]),
            assistant([text('a')]),
            assistant([withResult(toolUse('Read', 't2'))]),
            assistant([text('b')]),
        ];
        const keys = focusViewRows(messages, options)
            .filter((r): r is Extract<FocusRow, { kind: 'fold' }> => r.kind === 'fold')
            .map((r) => r.fold.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('treats a superseded attempt`s dangling call as failed, not as pending', () => {
        // `K` in the official: the call belongs to an earlier API message than
        // the one that finally spoke, so it was abandoned. It counts as failed
        // (`b0===void 0&&(!X||K(…))`) and, crucially, it does **not** become the
        // pending tool -- the row must not read "Running Bash…" forever.
        const messages = [
            user('do it'),
            assistant([toolUse('Bash', 't1')], 'msg-1'),
            assistant([text('done')], 'msg-2'),
        ];
        const rows = focusViewRows(messages, { ...options, busy: true });
        const fold = (rows[1] as Extract<FocusRow, { kind: 'fold' }>).fold;
        expect(fold.errorCount).toBe(1);
        expect(fold.pendingToolName).toBeUndefined();
    });

    it('a dangling call from the current attempt is pending, not failed', () => {
        const messages = [user('do it'), assistant([toolUse('Bash', 't1')], 'msg-1')];
        const rows = focusViewRows(messages, { ...options, busy: true });
        const fold = (rows[1] as Extract<FocusRow, { kind: 'fold' }>).fold;
        expect(fold.errorCount).toBe(0);
        expect(fold.pendingToolName).toBe('Bash');
    });

    it('a dangling call with nothing running is a failure', () => {
        const messages = [user('do it'), assistant([toolUse('Bash', 't1')], 'msg-1')];
        const rows = focusViewRows(messages, { ...options, busy: false });
        const fold = (rows[1] as Extract<FocusRow, { kind: 'fold' }>).fold;
        expect(fold.errorCount).toBe(1);
        expect(fold.progress).toBe('settled');
    });
});

// ---------------------------------------------------------------------------
// Which folds open themselves
// ---------------------------------------------------------------------------

const foldOf = (key: string, progress: FocusFold['progress']): FocusRow => ({
    kind: 'fold',
    fold: {
        key,
        messages: [],
        toolCallCount: 1,
        errorCount: 0,
        hiddenRenderableCount: 1,
        thinkingOnly: false,
        thinkingMillis: null,
        thinkingStreaming: false,
        progress,
        firstIdx: 0,
    },
});

describe('autoExpandedFolds (the official `ML1`)', () => {
    it('opens a live fold once, then remembers it as settled', () => {
        const settled = new Set<string>();
        expect([...autoExpandedFolds([foldOf('a', 'live')], settled)]).toEqual(['a']);
        expect([...autoExpandedFolds([foldOf('a', 'settled')], settled)]).toEqual([]);
        expect(settled.has('a')).toBe(true);
        // Once settled, going live again does not re-open it.
        expect([...autoExpandedFolds([foldOf('a', 'live')], settled)]).toEqual([]);
    });

    it('opens a provisionallySettled fold too', () => {
        expect([...autoExpandedFolds([foldOf('b', 'provisionallySettled')], new Set())]).toEqual(['b']);
    });

    it('returns nothing without rows', () => {
        expect([...autoExpandedFolds(null, new Set())]).toEqual([]);
    });
});

describe('reconcileExpanded (the official `jL1`)', () => {
    it('forgets everything when focus view is toggled', () => {
        expect([...reconcileExpanded(new Set(['a', 'b']), true, [])]).toEqual([]);
    });

    it('is the same set when nothing changed', () => {
        const set = new Set(['a']);
        expect(reconcileExpanded(set, false, [])).toBe(set);
        expect(reconcileExpanded(set, false, ['b'])).toBe(set);
    });

    it('drops a key that stopped auto-opening', () => {
        expect([...reconcileExpanded(new Set(['a', 'b']), false, ['a'])]).toEqual(['b']);
    });
});

describe('pruneSettled (the official `wL1`)', () => {
    it('forgets folds that left the transcript', () => {
        const settled = new Set(['a', 'b']);
        pruneSettled(settled, [foldOf('a', 'settled')]);
        expect([...settled]).toEqual(['a']);
    });

    it('does nothing when focus view is off', () => {
        const settled = new Set(['a']);
        pruneSettled(settled, null);
        expect([...settled]).toEqual(['a']);
    });
});

describe('foldLabel for hidden steps', () => {
    it('falls back to a hidden-step count', () => {
        const fold = (foldOf('x', 'settled') as Extract<FocusRow, { kind: 'fold' }>).fold;
        expect(foldLabel({ ...fold, toolCallCount: 0, hiddenRenderableCount: 3 })).toBe('3 hidden steps');
        expect(foldLabel({ ...fold, toolCallCount: 0, hiddenRenderableCount: 1 })).toBe('1 hidden step');
        expect(foldLabel({ ...fold, toolCallCount: 0, hiddenRenderableCount: 0 })).toBe('1 hidden step');
    });

    it('pluralises tool calls', () => {
        const fold = (foldOf('x', 'settled') as Extract<FocusRow, { kind: 'fold' }>).fold;
        expect(foldLabel({ ...fold, toolCallCount: 1 })).toBe('1 tool call');
    });
});
