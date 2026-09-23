/**
 * The fresh-install fixes, webview and host pieces that do not need a host
 * loop to test:
 *
 * - "Set up an endpoint" opens its picker at once, busy while it probes;
 * - the gate shows the welcome, not the chat, until an endpoint is known;
 * - `update_state` carries the endpoint counts the gate reads;
 * - the sessions list re-reads on `session_store_changed`, drops deleted rows,
 *   and turns a failed or unanswered read into an error instead of a spinner;
 * - the line under the hammer changes with every new conversation.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { signal } from 'alien-signals';
import { LOCAL_RUNTIMES, boundedProbe, discoverLocalRuntimes } from '../src/services/endpoints/discover';
import { pickEndpointStart, startItems, startPlaceholder, type QuickPickLike, type StartItem } from '../src/services/endpoints/startPicker';
import { resolveHasEndpoints } from '../src/webview/src/utils/endpointWelcome';
import { pickDifferent } from '../src/webview/src/utils/tipRotation';
import { BaseTransport } from '../src/webview/src/transport/BaseTransport';
import { EventEmitter } from '../src/webview/src/utils/events';
import { SessionStore, LIST_SESSIONS_TIMEOUT_MS } from '../src/webview/src/core/SessionStore';
import { Session } from '../src/webview/src/core/Session';

beforeAll(() => {
    (globalThis as any).window ??= {
        location: new URL('http://localhost/index.html'),
        history: { replaceState: () => {} },
    };
});

// ---------------------------------------------------------------------------
// The add-endpoint picker
// ---------------------------------------------------------------------------

function fakeQuickPick() {
    const accept = new Set<() => void>();
    const hide = new Set<() => void>();
    const qp: QuickPickLike<StartItem> & { shown: boolean; disposed: boolean; select(i: number): void; dismiss(): void } = {
        title: undefined,
        placeholder: undefined,
        items: [],
        busy: false,
        ignoreFocusOut: false,
        selectedItems: [],
        shown: false,
        disposed: false,
        onDidAccept: (l) => (accept.add(l), { dispose: () => accept.delete(l) }),
        onDidHide: (l) => (hide.add(l), { dispose: () => hide.delete(l) }),
        show() { this.shown = true; },
        hide() { for (const l of [...hide]) l(); },
        dispose() { this.disposed = true; },
        select(i: number) { (this as any).selectedItems = [this.items[i]]; for (const l of [...accept]) l(); },
        dismiss() { for (const l of [...hide]) l(); },
    };
    return qp;
}

describe('the add-endpoint picker opens on the click', () => {
    it('is on screen and busy before any probe has answered', () => {
        const qp = fakeQuickPick();
        void pickEndpointStart(qp, () => new Promise(() => {}));
        expect(qp.shown).toBe(true);
        expect(qp.busy).toBe(true);
        expect(qp.items.filter((i) => i.description === 'checking…')).toHaveLength(LOCAL_RUNTIMES.length);
        expect(qp.items.some((i) => i.action === 'edit')).toBe(true);
    });

    it('fills in as runtimes answer, and settles when the last one has', async () => {
        const qp = fakeQuickPick();
        let releaseOllama!: (v: string[]) => void;
        void pickEndpointStart(qp, (url) =>
            url.includes('11434') ? new Promise((r) => { releaseOllama = r; }) : Promise.resolve(undefined));
        await new Promise((r) => setTimeout(r, 0));
        expect(qp.busy).toBe(true);
        releaseOllama(['llama3.2', 'qwen3']);
        await new Promise((r) => setTimeout(r, 0));
        expect(qp.busy).toBe(false);
        expect(qp.items[0]).toMatchObject({ description: 'running now', detail: '2 models on http://localhost:11434/v1' });
        expect(qp.placeholder).toBe('Found 1 model server running here');
    });

    it('resolves with the pick, or undefined when dismissed', async () => {
        const picked = fakeQuickPick();
        const chosen = pickEndpointStart(picked, async () => undefined);
        picked.select(picked.items.length - 2);
        expect((await chosen)?.label).toContain('gateway');
        expect(picked.disposed).toBe(true);

        const dismissed = fakeQuickPick();
        const none = pickEndpointStart(dismissed, async () => undefined);
        dismissed.dismiss();
        expect(await none).toBeUndefined();
    });

    it('a probe that hangs is a runtime that is not there, within its budget', async () => {
        vi.useFakeTimers();
        try {
            const settled: string[] = [];
            const found = discoverLocalRuntimes(boundedProbe(() => new Promise(() => {}), 1500), (r) => settled.push(r.id));
            await vi.advanceTimersByTimeAsync(1600);
            expect(await found).toEqual([]);
            expect(settled.sort()).toEqual(LOCAL_RUNTIMES.map((r) => r.id).sort());
        } finally {
            vi.useRealTimers();
        }
    });

    it('says what it is doing in the placeholder', () => {
        expect(startPlaceholder(false, 0)).toMatch(/Looking/);
        expect(startPlaceholder(true, 0)).toMatch(/Nothing running/);
        expect(startPlaceholder(true, 2)).toBe('Found 2 model servers running here');
        expect(startItems(new Map(), new Map()).at(-1)?.action).toBe('edit');
    });
});

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

describe('the welcome gate while the handshake is in flight', () => {
    it('a fresh install sees the welcome, not the chat', () => {
        expect(resolveHasEndpoints(undefined, undefined)).toBe(false);
    });

    it('someone with an endpoint sees the chat at once, from the last answer', () => {
        expect(resolveHasEndpoints(undefined, true)).toBe(true);
    });

    it('the live answer always wins', () => {
        expect(resolveHasEndpoints(false, true)).toBe(false);
        expect(resolveHasEndpoints(true, false)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// The transport
// ---------------------------------------------------------------------------

class TestTransport extends BaseTransport {
    sent: any[] = [];
    protected send(message: any): void { this.sent.push(message); }
    push(request: any) { this.fromHost.enqueue({ type: 'request', channelId: '', requestId: 'p', request } as any); }
}

describe('host pushes', () => {
    it('update_state carries every init field, the endpoint counts included', async () => {
        const t = new TestTransport(new EventEmitter(), new EventEmitter());
        t.push({
            type: 'update_state',
            state: { defaultCwd: '/r', platform: 'win32', endpointProfileCount: 1, endpointHealthyModelCount: 3, endpointHealthCheckedProfileCount: 1 },
            config: { commands: [], models: [{ value: 'm' }] },
        });
        await new Promise((r) => setTimeout(r, 0));
        expect(t.config()).toMatchObject({ endpointProfileCount: 1, endpointHealthyModelCount: 3, openNewInTab: false });
        expect(t.claudeConfig()?.models).toHaveLength(1);
    });

    it('update_state without a config keeps the one it has', async () => {
        const t = new TestTransport(new EventEmitter(), new EventEmitter());
        t.claudeConfig({ commands: [], models: [{ value: 'kept' }] } as any);
        t.push({ type: 'update_state', state: { endpointProfileCount: 0 } });
        await new Promise((r) => setTimeout(r, 0));
        expect(t.claudeConfig()?.models[0].value).toBe('kept');
    });

    it('session_store_changed bumps the counter the store watches', async () => {
        const t = new TestTransport(new EventEmitter(), new EventEmitter());
        t.push({ type: 'session_store_changed' });
        t.push({ type: 'session_store_changed' });
        await new Promise((r) => setTimeout(r, 0));
        expect(t.sessionStoreChanges()).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// The sessions list
// ---------------------------------------------------------------------------

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const context = { currentSelection: signal(undefined), commandRegistry: { registerAction: () => {} }, fileOpener: {}, renameTab: () => {} } as any;
const row = (id: string) => ({ id, lastModified: 1, summary: id, isCurrentWorkspace: true });

function store(listSessions: () => Promise<any>) {
    const connection = {
        listSessions,
        launchClaude: () => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) }),
        permissionRequested: { add: () => () => {} },
        getSession: async () => ({ type: 'get_session_response', messages: [] }),
        sessionRenamedEvents: new EventEmitter(),
        config: () => ({}),
        claudeConfig: () => undefined,
    } as any;
    const s = new SessionStore({ state: () => 'connected', connection: () => undefined } as any, context);
    (s as any).getConnection = async () => connection;
    return { s, connection };
}

describe('the sessions list', () => {
    it('no history is an empty list', async () => {
        const { s } = store(async () => ({ type: 'list_sessions_response', sessions: [] }));
        await s.listSessions();
        expect(s.sessions()).toEqual([]);
    });

    it('a failed read is an error, and does not wipe the rows on screen', async () => {
        let answer: any = { type: 'list_sessions_response', sessions: [row(A), row(B)] };
        const { s } = store(async () => answer);
        await s.listSessions();
        answer = { type: 'list_sessions_response', sessions: [], error: 'EACCES' };
        await expect(s.listSessions()).rejects.toThrow('EACCES');
        expect(s.sessions().map((x) => x.sessionId())).toEqual([A, B]);
    });

    it('a conversation deleted on disk leaves the list', async () => {
        let sessions = [row(A), row(B)];
        const { s } = store(async () => ({ type: 'list_sessions_response', sessions }));
        await s.listSessions();
        sessions = [row(A)];
        await s.listSessions();
        expect(s.sessions().map((x) => x.sessionId())).toEqual([A]);
    });

    it('the open conversation stays even if its file went', async () => {
        let sessions = [row(A)];
        const { s } = store(async () => ({ type: 'list_sessions_response', sessions }));
        await s.listSessions();
        s.activeSession(s.sessions()[0]);
        sessions = [];
        await s.listSessions();
        expect(s.sessions()).toHaveLength(1);
    });

    it('a row started in this panel is never pruned by a listing', async () => {
        const { s } = store(async () => ({ type: 'list_sessions_response', sessions: [] }));
        const local = new Session(async () => ({}) as any, context, {});
        local.sessionId(B);
        s.sessions([local]);
        await s.listSessions();
        expect(s.sessions()).toContain(local);
    });

    it('an unanswered read becomes an error, and frees the next attempt', async () => {
        vi.useFakeTimers();
        try {
            let calls = 0;
            const { s } = store(() => (++calls === 1 ? new Promise(() => {}) : Promise.resolve({ sessions: [row(A)] })));
            const first = s.listSessions();
            const caught = first.catch((e) => e);
            await vi.advanceTimersByTimeAsync(LIST_SESSIONS_TIMEOUT_MS + 10);
            expect(String(await caught)).toMatch(/did not answer/);
            await s.listSessions();
            expect(s.sessions().map((x) => x.sessionId())).toEqual([A]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('a change reported mid-read is read again afterwards', async () => {
        let release!: () => void;
        let calls = 0;
        const { s } = store(() => {
            calls++;
            return calls === 1
                ? new Promise((r) => { release = () => r({ sessions: [] }); })
                : Promise.resolve({ sessions: [row(A)] });
        });
        const first = s.listSessions();
        const again = s.listSessionsAfterInFlight();
        await new Promise((r) => setTimeout(r, 0));
        release();
        await first;
        await again;
        expect(calls).toBe(2);
        expect(s.sessions().map((x) => x.sessionId())).toEqual([A]);
    });
});

// ---------------------------------------------------------------------------
// The line under the hammer
// ---------------------------------------------------------------------------

describe('the tip rotation', () => {
    it('never repeats the tip just shown', () => {
        const keys = ['a', 'b', 'c'];
        for (let i = 0; i < 50; i++) {
            const pick = pickDifferent(keys, 'b', Math.random);
            expect(keys[pick]).not.toBe('b');
        }
    });

    it('treats two copies of the same words as one tip', () => {
        expect(pickDifferent(['model', 'x', 'model'], 'model', () => 0.99)).toBe(1);
    });

    it('draws from the whole list', () => {
        const keys = ['a', 'b', 'c', 'd'];
        const seen = new Set<number>();
        for (let i = 0; i < 400; i++) seen.add(pickDifferent(keys, undefined));
        expect(seen.size).toBe(4);
    });
});

// ---------------------------------------------------------------------------
// A refused localhost is a failure, even when Node says nothing about it
// ---------------------------------------------------------------------------

import { describeRequestError, listModels } from '../src/services/endpoints/check';
import { parseProfile } from '../src/services/endpoints/profile';
import * as net from 'node:net';

describe('local discovery on a machine running nothing', () => {
    it('an AggregateError with an empty message still reads as an error', () => {
        const refused = new AggregateError([
            Object.assign(new Error('connect ECONNREFUSED ::1:11434'), { code: 'ECONNREFUSED' }),
            Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' }),
        ], '');
        expect(refused.message).toBe('');
        expect(describeRequestError(refused)).toMatch(/ECONNREFUSED/);
        expect(describeRequestError({})).toBe('the request failed');
    });

    it('a closed port reports an error, not zero models', async () => {
        // Take a port, then free it, so nothing is listening on it.
        const port = await new Promise<number>((resolve) => {
            const srv = net.createServer().listen(0, '127.0.0.1', () => {
                const p = (srv.address() as net.AddressInfo).port;
                srv.close(() => resolve(p));
            });
        });
        const probe = parseProfile(
            { name: 'probe', wire: 'openai', baseUrl: `http://localhost:${port}/v1`, model: 'probe', auth: { kind: 'none' }, proxy: { useEnvironment: false } },
            'test',
        );
        const result = await listModels(probe, () => undefined, { timeoutMs: 1500 });
        expect(result.error).toBeTruthy();
        expect(result.models).toEqual([]);
    });
});
