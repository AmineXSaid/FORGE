/**
 * The host's message loop, and where its answers go.
 *
 * Reported on a fresh install in a Linux dev container: "Set up an endpoint"
 * did nothing, the sessions list said "Loading conversations…" forever, and a
 * closed-and-reopened panel showed the chat page with no endpoint configured.
 *
 * One cause. The loop awaited `launch_claude` inline inside a single
 * try/catch, and the CLI launch threw (no binary for linux-x64 in a win32
 * build). The loop ended, and from then on no webview message was answered:
 * not the button's `run_endpoint_action`, not the list's
 * `list_sessions_request`, not the reopened panel's `init`.
 */
import { describe, expect, it, vi } from 'vitest';
import { ClaudeAgentService } from '../src/services/claude/ClaudeAgentService';
import { isStatePush } from '../src/services/webViewService';
import { createSessionStoreWatcher } from '../src/services/claude/sessionStoreWatcher';

const tick = () => new Promise((r) => setTimeout(r, 0));
const until = async (check: () => boolean, ms = 1000) => {
    const started = Date.now();
    while (!check()) {
        if (Date.now() - started > ms) throw new Error('timed out waiting');
        await new Promise((r) => setTimeout(r, 2));
    }
};

function host() {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const s = new (ClaudeAgentService as any)(
        log,
        {},
        { getDefaultWorkspaceFolder: () => undefined },
        {},
        {},
        {},
        {},
        { getThinkingLevel: () => 'off' },
        {},
        {},
        { getStatus: () => ({}) },
        { onDidChangeHealth: () => ({ dispose() {} }) }
    );
    const sent: any[] = [];
    s.setTransport({ send: (m: any) => sent.push(m), onMessage: () => {} });
    s.getShowThinkingSummaries = async () => undefined;
    // Isolate the loop from the handlers: every request answers with its type.
    s.processRequest = async (m: any) => ({ type: `${m.request.type}_response` });
    void s.readFromClient();
    const post = (m: any) => s.fromClient(m);
    const responses = () => sent.filter((m) => m.type === 'response');
    return { s, sent, post, responses, log };
}

describe('the message loop survives a failed launch', () => {
    it('answers requests after a launch that throws', async () => {
        const { s, post, responses, sent } = host();
        s.spawnClaude = async () => {
            throw new Error('Unsupported platform: linux-x64. No compatible Claude Code binary found.');
        };
        post({ type: 'launch_claude', channelId: 'c1', webviewId: 'sidebar:chat:forge.chatView' });
        post({ type: 'request', requestId: 'r1', request: { type: 'run_endpoint_action', action: 'add' } });
        post({ type: 'request', requestId: 'r2', request: { type: 'list_sessions_request' } });
        post({ type: 'request', requestId: 'r3', request: { type: 'init' } });
        await until(() => responses().length === 3);
        expect(responses().map((r) => r.requestId).sort()).toEqual(['r1', 'r2', 'r3']);
        // And the webview heard why the channel died, on the channel's own owner.
        const closed = sent.find((m) => m.type === 'close_channel');
        expect(closed).toMatchObject({ channelId: 'c1', webviewId: 'sidebar:chat:forge.chatView' });
        expect(closed.error).toContain('Unsupported platform');
    });

    it('survives input for a channel that never launched', async () => {
        const { post, responses, log } = host();
        post({ type: 'io_message', channelId: 'ghost', message: { type: 'user' }, done: false });
        post({ type: 'request', requestId: 'r1', request: { type: 'init' } });
        await until(() => responses().length === 1);
        expect(log.error).toHaveBeenCalled();
    });

    it('does not hold other requests behind a slow launch', async () => {
        const { s, post, responses } = host();
        let release!: () => void;
        s.spawnClaude = () => new Promise((resolve) => { release = () => resolve({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) }); });
        post({ type: 'launch_claude', channelId: 'c1' });
        post({ type: 'request', requestId: 'r1', request: { type: 'init' } });
        await until(() => responses().length === 1);
        release();
    });

    it('keeps one channel in order: input waits for its launch', async () => {
        const { s, post } = host();
        const order: string[] = [];
        let release!: () => void;
        s.launchClaude = (channelId: string) =>
            new Promise<void>((resolve) => {
                release = () => {
                    order.push(`launched ${channelId}`);
                    s.channels.set(channelId, { in: { enqueue: () => order.push('input'), done() {} } });
                    resolve();
                };
            });
        post({ type: 'launch_claude', channelId: 'c1' });
        post({ type: 'io_message', channelId: 'c1', message: { type: 'user' }, done: false });
        await tick();
        expect(order).toEqual([]);
        release();
        await until(() => order.length === 2);
        expect(order).toEqual(['launched c1', 'input']);
    });

    it('starts a channel-scoped request only after that channel\'s launch', async () => {
        const { s, post, responses } = host();
        let release!: () => void;
        s.launchClaude = () => new Promise<void>((resolve) => { release = resolve; });
        post({ type: 'launch_claude', channelId: 'c1' });
        post({ type: 'request', requestId: 'r1', channelId: 'c1', request: { type: 'set_model' } });
        await tick();
        expect(responses()).toEqual([]);
        release();
        await until(() => responses().length === 1);
    });
});

describe('answers go back to the webview that asked', () => {
    it('stamps the channel owner on io, close and permission traffic', async () => {
        const { s, post, sent } = host();
        s.launchClaude = async () => {};
        post({ type: 'launch_claude', channelId: 'c1', webviewId: 'editor:chat:chat-3' });
        await tick();
        s.sendToClient({ type: 'io_message', channelId: 'c1', message: {}, done: false });
        s.sendToClient({ type: 'request', channelId: 'c1', requestId: 'x', request: { type: 'tool_permission_request' } });
        expect(sent.map((m) => m.webviewId)).toEqual(['editor:chat:chat-3', 'editor:chat:chat-3']);
        s.closeChannel('c1', true);
        expect(sent.at(-1)).toMatchObject({ type: 'close_channel', webviewId: 'editor:chat:chat-3' });
        // Forgotten once closed, so nothing later is misrouted to a dead tab.
        s.sendToClient({ type: 'io_message', channelId: 'c1', message: {}, done: false });
        expect(sent.at(-1).webviewId).toBeUndefined();
    });

    it('leaves a message with no channel untargeted', async () => {
        const { s, sent } = host();
        s.sendToClient({ type: 'request', channelId: '', requestId: 'x', request: { type: 'session_states_update' } });
        expect(sent[0].webviewId).toBeUndefined();
    });
});

describe('which pushes reach every page', () => {
    const push = (type: string) => ({ type: 'request', channelId: '', requestId: 'p', request: { type } });

    it('state pushes go everywhere', () => {
        for (const type of [
            'update_state',
            'session_states_update',
            'session_store_changed',
            'session_renamed',
            'endpoint_health_update',
            'extension_config_changed',
        ]) {
            expect(isStatePush(push(type))).toBe(true);
        }
    });

    it('commands and conversation traffic do not', () => {
        for (const type of ['ui_command', 'insert_at_mention', 'tool_permission_request']) {
            expect(isStatePush(push(type))).toBe(false);
        }
        expect(isStatePush({ type: 'io_message', channelId: 'c1' })).toBe(false);
        expect(isStatePush({ type: 'response', requestId: 'r' })).toBe(false);
    });
});

describe('the pushes the host sends', () => {
    it('session_store_changed is the bare official request', () => {
        const { s, sent } = host();
        s.sendSessionStoreChanged();
        expect(sent[0]).toMatchObject({ type: 'request', channelId: '', request: { type: 'session_store_changed' } });
    });

    it('a finished turn tells the lists to re-read', async () => {
        const { s, sent } = host();
        const messages = [{ type: 'system', subtype: 'init', session_id: 'aaaaaaaa-0000-4000-8000-000000000001' }, { type: 'result', subtype: 'success' }];
        s.spawnClaude = async () => ({
            async *[Symbol.asyncIterator]() {
                for (const m of messages) yield m;
                await new Promise(() => {});
            },
        });
        s.fromClient({ type: 'launch_claude', channelId: 'c1' });
        await until(() => sent.some((m) => m.request?.type === 'session_store_changed'));
    });

    it('coalesces a burst of endpoint writes into one update_state', async () => {
        vi.useFakeTimers();
        try {
            const { s } = host();
            const pushed = vi.fn(async () => {});
            s.pushStateUpdate = pushed;
            s.schedulePushStateUpdate();
            s.schedulePushStateUpdate();
            s.schedulePushStateUpdate();
            await vi.advanceTimersByTimeAsync(500);
            expect(pushed).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('the session store watcher', () => {
    function fakeWatch() {
        const watchers: Array<{ dir: string; listener: (e: string, f: string | null) => void; closed: boolean; onError?: () => void }> = [];
        let exists = false;
        const watch = (dir: string, listener: any) => {
            if (!exists) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
            const w = { dir, listener, closed: false, onError: undefined as undefined | (() => void) };
            watchers.push(w);
            return {
                close: () => { w.closed = true; },
                on: (_event: string, fn: () => void) => { w.onError = fn; return undefined as any; },
            };
        };
        return { watchers, watch, create: () => { exists = true; } };
    }

    it('fires for a transcript created or deleted, not for one being written', async () => {
        vi.useFakeTimers();
        try {
            const fs = fakeWatch();
            fs.create();
            const onChange = vi.fn();
            createSessionStoreWatcher('/p', onChange, { watch: fs.watch as any, debounceMs: 10 });
            const w = fs.watchers[0];
            w.listener('change', 'a.jsonl');
            await vi.advanceTimersByTimeAsync(20);
            expect(onChange).not.toHaveBeenCalled();
            w.listener('rename', 'a.jsonl');
            w.listener('rename', 'b.jsonl');
            await vi.advanceTimersByTimeAsync(20);
            expect(onChange).toHaveBeenCalledTimes(1);
            w.listener('rename', 'notes.txt');
            await vi.advanceTimersByTimeAsync(20);
            expect(onChange).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('on a fresh install attaches once the directory exists', () => {
        const fs = fakeWatch();
        const watcher = createSessionStoreWatcher('/p', () => {}, { watch: fs.watch as any });
        expect(fs.watchers).toHaveLength(0);
        watcher.refresh();
        expect(fs.watchers).toHaveLength(0);
        fs.create();
        watcher.refresh();
        watcher.refresh();
        expect(fs.watchers).toHaveLength(1);
        watcher.dispose();
        expect(fs.watchers[0].closed).toBe(true);
    });
});

describe('an endpoint set up after the chat launched', () => {
    it('recycles every channel that is not mid-turn, and leaves a turn alone', () => {
        const { s, sent } = host();
        const done = vi.fn();
        s.channels = new Map([
            ['idle', { in: { done, enqueue() {} }, query: { return() {} } }],
            // A conversation between turns: closed now, resumed on the new
            // endpoint by its next message (the switch the user chose).
            ['between', { in: { done() {}, enqueue() {} }, query: { return() {} }, used: true }],
            ['busy', { in: { done() {}, enqueue() {} }, query: { return() {} }, used: true, turnOpen: true }],
        ]);
        s.recycleIdleChannels();
        expect([...s.channels.keys()]).toEqual(['busy']);
        expect(done).toHaveBeenCalled();
        expect(sent.filter((m: any) => m.type === 'close_channel').map((m: any) => m.channelId)).toEqual(['idle', 'between']);
    });

    it('marks a channel used, and its turn open, once a user message goes in', () => {
        const { s } = host();
        s.channels = new Map([['c', { in: { enqueue() {}, done() {} }, query: {} }]]);
        s.transportMessage('c', { type: 'user' }, false);
        expect(s.channels.get('c').used).toBe(true);
        expect(s.channels.get('c').turnOpen).toBe(true);
    });

    it('retires a channel that finished its turn on the previous endpoint', async () => {
        const { s, sent } = host();
        let push!: (m: any) => void;
        const queue: any[] = [];
        let wake: (() => void) | undefined;
        s.spawnClaude = async () => ({
            [Symbol.asyncIterator]: () => ({
                next: async () => {
                    while (!queue.length) await new Promise<void>((r) => { wake = r; });
                    return { value: queue.shift(), done: false };
                },
            }),
            return() {},
        });
        push = (m) => { queue.push(m); wake?.(); };
        await s.launchClaude('c3', null, '/repo', null, 'default', null);
        s.transportMessage('c3', { type: 'user' }, false);
        // The pair changes mid-turn: the turn is left to finish...
        s.endpointGeneration++;
        s.recycleIdleChannels();
        expect(s.channels.has('c3')).toBe(true);
        // ...and the channel goes when it does.
        push({ type: 'result', subtype: 'success' });
        await tick();
        await tick();
        expect(s.channels.has('c3')).toBe(false);
        expect(sent.find((m: any) => m.type === 'close_channel' && m.channelId === 'c3')).toBeTruthy();
    });
});

describe('a launch that races an endpoint change', () => {
    it('is replaced when settings changed while it was spawning', async () => {
        const { s, sent } = host();
        let release!: (q: any) => void;
        s.spawnClaude = () => new Promise((r) => { release = r; });
        const launching = s.launchClaude('c1', null, '/repo', null, 'default', null);
        await tick();
        s.endpointGeneration++;
        release({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }), return() {} });
        await launching;
        expect(s.channels.has('c1')).toBe(false);
        expect(sent.find((m: any) => m.type === 'close_channel')).toMatchObject({ channelId: 'c1' });
    });

    it('is kept when nothing changed', async () => {
        const { s } = host();
        s.spawnClaude = async () => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }), return() {} });
        await s.launchClaude('c2', null, '/repo', null, 'default', null);
        expect(s.channels.has('c2')).toBe(true);
    });
});

describe('update_state after an endpoint change', () => {
    it('sends the state at once, before the slow model config', async () => {
        const { s, sent } = host();
        s.handlerContext = {
            ...s.handlerContext,
            configService: { getSetting: async () => 'default', getExtensionConfig: async () => ({}) },
            workspaceService: { getDefaultWorkspaceFolder: () => undefined },
            sdkService: { getThinkingLevel: () => 'off', getAllowDangerouslySkipPermissions: () => false, isBrowserIntegrationSupported: () => false },
            // No profile: the config read would launch the CLI and wait on it.
            endpointService: { listProfiles: () => ({ profiles: [] }), resolveActiveProfile: () => undefined, getStatus: () => ({}) },
            endpointHealthService: { getAllHealth: () => [] },
            logService: { info() {}, warn() {}, error() {} },
        };
        void s.pushStateUpdate();
        await until(() => sent.some((m: any) => m.request?.type === 'update_state'));
        const first = sent.find((m: any) => m.request?.type === 'update_state');
        expect(first.request.state.endpointProfileCount).toBe(0);
        expect(first.request.config).toBeUndefined();
    });
});
