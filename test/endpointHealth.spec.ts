/**
 * Endpoint health: what the gateway's models do when asked to serve.
 *
 * The defect this covers, stated once: `/v1/models` is a listing, not a
 * promise. Of 101 ids one NVIDIA account listed, 28 answered, 60 returned 404,
 * 10 accepted the request and never replied, and 3 errored -- and every one of
 * those 101 used to appear in Forge's model picker, so two picks in three
 * landed in a chat where nothing came back.
 *
 * `keepServable` in `check.ts` has always been able to tell the difference.
 * What was missing was a memory, a filter that reads it, and a gate that does
 * not call a hundred dead models "100 models".
 *
 * The one promise the whole feature makes: **a model in the picker replies when
 * you type to it.** Nearly every test below is a way for that to be false.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
    EndpointHealthStore,
    MAX_DETAIL_CHARS,
    MAX_STORED_MODELS,
    checkedProfileCount,
    commonestFailure,
    fingerprintOf,
    healthyModelCount,
    keepHealthy,
    medianPing,
    orderCandidates,
    type StoredEndpointHealth,
} from '../src/services/endpoints/healthStore';
import { parseProfile } from '../src/services/endpoints/profile';
import {
    endpointWelcomeState,
    skipStillApplies,
} from '../src/webview/src/utils/endpointWelcome';

// The sweep's two network calls are stubbed: this suite is about what Forge
// does with the answers, and `endpointE2E.spec.ts` is where real sockets live.
vi.mock('../src/services/endpoints/check', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/services/endpoints/check')>();
    return {
        ...actual,
        listModels: vi.fn(),
        keepServable: vi.fn(),
    };
});

import { listModels, keepServable } from '../src/services/endpoints/check';
import { EndpointHealthService } from '../src/services/endpoints/health';
import { handleGetClaudeState, handleGetEndpointHealth } from '../src/services/claude/handlers/handlers';
import type { EndpointProfile } from '../src/services/endpoints/profile';

const listModelsMock = vi.mocked(listModels);
const keepServableMock = vi.mocked(keepServable);

/** A gateway that lists far more than it serves -- the shape being defended against. */
const GATEWAY = parseProfile(
    {
        name: 'nvidia-nim',
        wire: 'openai',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        model: 'meta/llama-3.3-70b-instruct',
        auth: { kind: 'none' },
    },
    'test',
);

/** A profile that names the handful of models it wants, out of hundreds. */
const DECLARED = parseProfile(
    {
        name: 'company-llama',
        wire: 'openai',
        baseUrl: 'https://llm.internal.example/v1',
        model: 'llama-3.3-70b',
        auth: { kind: 'none' },
        models: [{ id: 'llama-3.3-70b' }, { id: 'llama-3.1-8b' }],
    },
    'test',
);

/** A `Memento` that is just a Map, as `archiveSession.spec.ts` drives its store. */
function memento(): { get<T>(k: string): T | undefined; update(k: string, v: unknown): Promise<void>; raw: Map<string, unknown> } {
    const raw = new Map<string, unknown>();
    return {
        raw,
        get: <T,>(k: string) => raw.get(k) as T | undefined,
        update: async (k: string, v: unknown) => void raw.set(k, v),
    };
}

function entry(over: Partial<StoredEndpointHealth> = {}): StoredEndpointHealth {
    return {
        profileName: GATEWAY.name,
        fingerprint: fingerprintOf(GATEWAY),
        lastSyncedAt: 1_700_000_000_000,
        listed: 101,
        models: [
            { id: 'a', servable: true, ms: 420, checkedAt: 1_700_000_000_000 },
            { id: 'b', servable: false, ms: 90, detail: 'HTTP 404', checkedAt: 1_700_000_000_000 },
        ],
        ...over,
    };
}

// ---------------------------------------------------------------------------
// Part A: the store
// ---------------------------------------------------------------------------

describe('the health store', () => {
    it('round-trips a record', async () => {
        const m = memento();
        const store = new EndpointHealthStore(m);
        await store.write(entry());

        const read = store.get(GATEWAY.name, fingerprintOf(GATEWAY));
        expect(read?.listed).toBe(101);
        expect(read?.models.map((x) => x.id)).toEqual(['a', 'b']);
        expect(read?.models[1].detail).toBe('HTTP 404');
    });

    it('keeps one entry per profile and leaves the others alone', async () => {
        const store = new EndpointHealthStore(memento());
        await store.write(entry());
        await store.write(entry({ profileName: 'other', fingerprint: 'x', listed: 3 }));
        await store.write(entry({ listed: 7 }));

        expect(store.all()).toHaveLength(2);
        expect(store.get(GATEWAY.name, fingerprintOf(GATEWAY))?.listed).toBe(7);
        expect(store.get('other', 'x')?.listed).toBe(3);
    });

    it('forgets a profile that no longer exists', async () => {
        // A record naming nothing is a settings-table row for an endpoint the
        // user cannot see anywhere else.
        const store = new EndpointHealthStore(memento());
        await store.write(entry());
        await store.write(entry({ profileName: 'deleted', fingerprint: 'x' }));

        await store.prune([GATEWAY.name]);
        expect(store.all().map((e) => e.profileName)).toEqual([GATEWAY.name]);
    });

    it('survives junk in globalState rather than throwing on read', async () => {
        const m = memento();
        m.raw.set('forge.endpointHealth', [null, 'nonsense', { profileName: 5 }, entry()]);
        expect(new EndpointHealthStore(m).all().map((e) => e.profileName)).toEqual([GATEWAY.name]);
    });

    it('bounds what it stores: the model cap and the detail length', async () => {
        const m = memento();
        const store = new EndpointHealthStore(m);
        await store.write(
            entry({
                models: Array.from({ length: MAX_STORED_MODELS + 50 }, (_, i) => ({
                    id: `m${i}`,
                    servable: false,
                    ms: 1,
                    detail: 'x'.repeat(400),
                    checkedAt: 1,
                })),
            }),
        );

        const read = store.get(GATEWAY.name, fingerprintOf(GATEWAY))!;
        expect(read.models).toHaveLength(MAX_STORED_MODELS);
        expect(read.models[0].detail!.length).toBe(MAX_DETAIL_CHARS);
    });
});

describe('the fingerprint', () => {
    it('invalidates the verdicts when the profile is pointed somewhere else', async () => {
        const store = new EndpointHealthStore(memento());
        await store.write(entry());

        const moved = parseProfile(
            { ...GATEWAY, baseUrl: 'https://somewhere.else/v1' } as any,
            'test',
        );
        // Same name, different gateway: inheriting the old verdicts would claim
        // to have measured something never measured.
        expect(store.get(moved.name, fingerprintOf(moved))).toBeUndefined();
        expect(store.get(GATEWAY.name, fingerprintOf(GATEWAY))).toBeDefined();
    });

    it('covers baseUrl, wire, model and chatPath, and nothing cosmetic', () => {
        const base = fingerprintOf(GATEWAY);
        expect(fingerprintOf(parseProfile({ ...GATEWAY, baseUrl: 'https://x/v1' } as any, 't'))).not.toBe(base);
        expect(fingerprintOf(parseProfile({ ...GATEWAY, wire: 'anthropic' } as any, 't'))).not.toBe(base);
        expect(fingerprintOf(parseProfile({ ...GATEWAY, model: 'other' } as any, 't'))).not.toBe(base);
        expect(fingerprintOf(parseProfile({ ...GATEWAY, chatPath: '/v2/messages' } as any, 't'))).not.toBe(base);
        // A description is not an identity.
        expect(fingerprintOf(parseProfile({ ...GATEWAY, description: 'renamed' } as any, 't'))).toBe(base);
    });
});

// ---------------------------------------------------------------------------
// Part B: the filter -- the point of the whole feature
// ---------------------------------------------------------------------------

describe('which models reach the picker', () => {
    const swept = entry({
        models: [
            { id: 'good', servable: true, ms: 300, checkedAt: 1 },
            { id: 'dead', servable: false, ms: 80, detail: 'HTTP 404', checkedAt: 1 },
        ],
    });

    it('offers only what answered, once a sweep has measured the listing', () => {
        const { ids } = keepHealthy(['good', 'dead', 'unprobed'], swept);
        // `unprobed` sat beyond the candidate cap. It is not evidence of
        // anything, and offering it would break the one promise this makes.
        expect(ids).toEqual(['good']);
    });

    it('never empties a list because health is unknown', () => {
        // The failure the endpoints line already fixed once: an empty picker
        // reading as "the model list didn't load".
        const { ids } = keepHealthy(['a', 'b', 'c'], undefined);
        expect(ids).toEqual(['a', 'b', 'c']);

        const errored = entry({ lastSyncedAt: undefined, error: 'getaddrinfo ENOTFOUND' });
        expect(keepHealthy(['a', 'b'], errored).ids).toEqual(['a', 'b']);
    });

    it('keeps a declared model that was never probed, and drops one that failed', () => {
        // A declaration is the user naming what they want. Only evidence
        // against it wins; the absence of evidence does not.
        const { ids } = keepHealthy(['good', 'dead', 'unprobed'], swept, { declared: true });
        expect(ids).toEqual(['good', 'unprobed']);
    });

    it('says which path it took, so the log can be read after the fact', () => {
        expect(keepHealthy(['a'], undefined).reason).toContain('never swept');
        expect(keepHealthy(['good'], swept).reason).toContain('answered a real request');
        expect(keepHealthy(['good'], swept, { declared: true }).reason).toContain('declared block');
    });

    it('returns an empty list when a sweep measured everything and nothing answered', () => {
        // Honest, and it is what raises the welcome page's state C.
        const allDead = entry({
            models: [
                { id: 'a', servable: false, ms: 5, detail: 'HTTP 404', checkedAt: 1 },
                { id: 'b', servable: false, ms: 5, detail: 'HTTP 404', checkedAt: 1 },
            ],
        });
        expect(keepHealthy(['a', 'b'], allDead).ids).toEqual([]);
    });
});

describe('which candidates get probed', () => {
    it('probes the ids the profile names first, so the cap only cuts the tail', () => {
        const listed = Array.from({ length: 100 }, (_, i) => `model-${i}`);
        listed.push(DECLARED.model, 'llama-3.1-8b');

        const ordered = orderCandidates(DECLARED, listed, 5);
        expect(ordered.slice(0, 2)).toEqual([DECLARED.model, 'llama-3.1-8b']);
        expect(ordered).toHaveLength(5);
    });

    it('honours the cap, because each candidate is a billable completion', () => {
        const listed = Array.from({ length: 500 }, (_, i) => `m${i}`);
        expect(orderCandidates(GATEWAY, listed, 60)).toHaveLength(60);
        expect(orderCandidates(GATEWAY, listed)).toHaveLength(60);
    });

    it('probes a named model the gateway does not list, which is the telling case', () => {
        expect(orderCandidates(DECLARED, ['something-else'], 10)).toContain('llama-3.1-8b');
    });
});

describe('the numbers the tables report', () => {
    it('counts healthy models and checked profiles across every endpoint', () => {
        const rows = [
            entry(),
            entry({ profileName: 'never', lastSyncedAt: undefined, models: [] }),
        ];
        expect(healthyModelCount(rows)).toBe(1);
        expect(checkedProfileCount(rows)).toBe(1);
    });

    it('takes the median over the models that answered, not over the failures', () => {
        const row = entry({
            models: [
                { id: 'a', servable: true, ms: 100, checkedAt: 1 },
                { id: 'b', servable: true, ms: 300, checkedAt: 1 },
                { id: 'c', servable: false, ms: 20_000, detail: 'timeout', checkedAt: 1 },
            ],
        });
        // A timeout's 20s is not a ping; including it would report the endpoint
        // as slower the *deader* it gets.
        expect(medianPing(row)).toBe(200);
        expect(medianPing(entry({ models: [] }))).toBeUndefined();
    });

    it('names the failure most models gave, which is the cause rather than the symptom', () => {
        const row = entry({
            models: [
                { id: 'a', servable: false, ms: 5, detail: 'HTTP 404', checkedAt: 1 },
                { id: 'b', servable: false, ms: 5, detail: 'HTTP 404', checkedAt: 1 },
                { id: 'c', servable: false, ms: 5, detail: 'Invalid API key', checkedAt: 1 },
            ],
        });
        expect(commonestFailure(row)).toBe('HTTP 404');
    });
});

// ---------------------------------------------------------------------------
// Part B: the sweep
// ---------------------------------------------------------------------------

describe('a sweep', () => {
    beforeEach(() => {
        listModelsMock.mockReset();
        keepServableMock.mockReset();
    });
    afterEach(() => vi.useRealTimers());

    function service(profiles = [GATEWAY]) {
        const m = memento();
        const logService = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
        const endpointService = {
            listProfiles: () => ({ profiles, errors: [] }),
            getStatus: () => ({ profile: profiles[0], report: [], errors: [], available: profiles }),
            secretsFor: async () => () => undefined,
        } as any;
        const svc = new EndpointHealthService(
            { globalState: m } as any,
            logService,
            endpointService,
        );
        return { svc, store: new EndpointHealthStore(m), logService, memento: m };
    }

    it('probes the endpoint`s one model, without listing, and stores the verdict', async () => {
        // An endpoint and its model are one entry, so one question: does this
        // model answer here? No listing, and no other ids.
        keepServableMock.mockResolvedValue([{ id: GATEWAY.model, servable: true, ms: 310 }]);

        const { svc, store } = service();
        const result = await svc.syncProfile(GATEWAY.name);

        expect(listModelsMock).not.toHaveBeenCalled();
        expect(keepServableMock.mock.calls[0][1]).toEqual([GATEWAY.model]);
        expect(result.listed).toBe(1);
        expect(result.models.filter((m) => m.servable).map((m) => m.id)).toEqual([GATEWAY.model]);
        expect(store.get(GATEWAY.name, fingerprintOf(GATEWAY))?.models).toHaveLength(1);
    });

    it('rejects a profile name it does not know, rather than coercing it (B3)', async () => {
        const { svc } = service();
        await expect(svc.syncProfile('../../etc/passwd')).rejects.toThrow(/Unknown endpoint profile/);
        await expect(svc.syncProfile('')).rejects.toThrow(/Unknown endpoint profile/);
        expect(listModelsMock).not.toHaveBeenCalled();
    });

    it('leaves the previous verdicts in place when it cannot start at all', async () => {
        const { svc, store, memento: m } = service();
        await new EndpointHealthStore(m).write(entry());

        keepServableMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
        const result = await svc.syncProfile(GATEWAY.name);

        // A transient DNS failure must not wipe what was measured before.
        expect(result.error).toContain('ENOTFOUND');
        expect(result.models.map((x) => x.id)).toEqual(['a', 'b']);
        expect(store.get(GATEWAY.name, fingerprintOf(GATEWAY))?.lastSyncedAt).toBe(1_700_000_000_000);
    });

    it('treats an auth failure as a failed sweep, not as every model being dead', async () => {
        const { svc, store, memento: m } = service();
        await new EndpointHealthStore(m).write(entry());

        listModelsMock.mockResolvedValue({ models: [{ id: 'a' }, { id: 'b' }], listed: 2 } as any);
        // `keepServable`'s auth path: one identical, instant verdict per
        // candidate, with nothing sent. One expired token would otherwise empty
        // the picker and raise the welcome gate over a password.
        keepServableMock.mockResolvedValue([
            { id: 'a', servable: false, ms: 0, detail: 'Invalid API key' },
            { id: 'b', servable: false, ms: 0, detail: 'Invalid API key' },
        ]);

        const result = await svc.syncProfile(GATEWAY.name);
        expect(result.error).toBe('Invalid API key');
        expect(result.models.find((x) => x.id === 'a')?.servable).toBe(true);
        expect(store.get(GATEWAY.name, fingerprintOf(GATEWAY))?.lastSyncedAt).toBe(1_700_000_000_000);
    });

    it('costs one completion per endpoint, however many models the gateway serves', async () => {
        // It used to list and probe up to 60 ids per endpoint, every hour.
        listModelsMock.mockResolvedValue({ models: Array.from({ length: 300 }, (_, i) => ({ id: `m${i}` })), listed: 300 } as any);
        keepServableMock.mockImplementation(async (_p, ids) => ids.map((id) => ({ id, servable: true, ms: 10 })));

        const { svc } = service();
        const result = await svc.syncProfile(GATEWAY.name, { candidateCap: 12 });

        expect(keepServableMock).toHaveBeenCalledTimes(1);
        expect(keepServableMock.mock.calls[0][1]).toEqual([GATEWAY.model]);
        expect(result.models).toHaveLength(1);
    });

    it('is cancellable, and cancelling keeps the verdicts already there', async () => {
        const { svc, memento: m } = service();
        await new EndpointHealthStore(m).write(entry());

        listModelsMock.mockResolvedValue({ models: [{ id: 'a' }], listed: 1 } as any);
        keepServableMock.mockImplementation(
            (_p, _ids, _s, options: any) =>
                new Promise((resolve) => {
                    options.signal.addEventListener('abort', () => resolve([]));
                }),
        );

        const inFlight = svc.syncProfile(GATEWAY.name);
        await Promise.resolve();
        svc.cancelSync(GATEWAY.name);

        const result = await inFlight;
        expect(result.models.map((x) => x.id)).toEqual(['a', 'b']);
        expect(result.lastSyncedAt).toBe(1_700_000_000_000);
    });

    it('cancelling keeps the verdicts it had already measured, too', async () => {
        // `keepServable` returns what it managed before the abort on purpose:
        // those are billable completions already spent, and discarding them
        // makes Cancel cost the user the same probes twice. They merge over the
        // stored record rather than replacing it, so the ids the sweep never
        // reached survive and the picker does not shrink.
        const { svc, memento: m } = service();
        await new EndpointHealthStore(m).write(entry());

        listModelsMock.mockResolvedValue({ models: [{ id: 'a' }, { id: 'c' }], listed: 2 } as any);

        // Cancel only once probing has actually started, or the sweep aborts at
        // the earlier checkpoint and there is nothing measured to keep.
        let probing: () => void;
        const started = new Promise<void>((resolve) => { probing = resolve; });
        keepServableMock.mockImplementation(
            (_p, _ids, _s, options: any) =>
                new Promise((resolve) => {
                    probing();
                    options.signal.addEventListener('abort', () =>
                        // 'a' answered before the user pressed Cancel; 'c' never ran.
                        resolve([{ id: 'a', servable: false, ms: 42, detail: 'HTTP 404' }]),
                    );
                }),
        );

        const inFlight = svc.syncProfile(GATEWAY.name);
        await started;
        svc.cancelSync(GATEWAY.name);
        const result = await inFlight;

        // 'b' was never probed by this sweep and keeps its stored verdict.
        expect(result.models.map((x) => x.id).sort()).toEqual(['a', 'b']);
        // 'a' takes the fresh verdict, because it was genuinely measured.
        expect(result.models.find((x) => x.id === 'a')).toMatchObject({
            servable: false,
            detail: 'HTTP 404',
        });
        // Still not a completed pass, so `syncDue` must not treat it as one.
        expect(result.lastSyncedAt).toBe(1_700_000_000_000);
    });

    it('lets a second sweep cancel the first rather than running beside it', async () => {
        const { svc } = service();
        listModelsMock.mockResolvedValue({ models: [{ id: 'a' }], listed: 1 } as any);

        let aborted = false;
        keepServableMock.mockImplementationOnce(
            (_p, _ids, _s, options: any) =>
                new Promise((resolve) => {
                    options.signal.addEventListener('abort', () => { aborted = true; resolve([]); });
                }),
        );
        keepServableMock.mockImplementationOnce(async () => [{ id: 'a', servable: true, ms: 12 }]);

        const first = svc.syncProfile(GATEWAY.name);
        // Wait for the first sweep to actually be probing. Aborting it before
        // it gets that far would prove nothing -- and would quietly leave the
        // hanging stub for the *second* sweep to consume.
        await vi.waitFor(() => expect(keepServableMock).toHaveBeenCalledTimes(1));
        const second = svc.syncProfile(GATEWAY.name);

        await Promise.all([first, second]);
        expect(aborted).toBe(true);
        expect((await second).models).toEqual([
            expect.objectContaining({ id: 'a', servable: true }),
        ]);
    });

    it('reports progress while it runs, and stops claiming to when it stops', async () => {
        const { svc } = service();

        let release: (() => void) | undefined;
        keepServableMock.mockImplementation(async (_p, ids, _s, options: any) => {
            options.onResult?.({ id: GATEWAY.model, servable: true, ms: 5 });
            await new Promise<void>((r) => { release = r; });
            return ids.map((id) => ({ id, servable: true, ms: 5 }));
        });

        const inFlight = svc.syncProfile(GATEWAY.name);
        await vi.waitFor(() => expect(svc.getHealth(GATEWAY.name)?.checked).toBe(1));

        const mid = svc.getHealth(GATEWAY.name)!;
        expect(mid.syncing).toBe(true);
        expect(mid.checked).toBe(1);
        expect(mid.total).toBe(1);

        release!();
        await inFlight;
        expect(svc.getHealth(GATEWAY.name)?.syncing).toBeUndefined();
    });

    it('fires a change event, so open webviews do not have to poll', async () => {
        const { svc } = service();
        listModelsMock.mockResolvedValue({ models: [{ id: 'a' }], listed: 1 } as any);
        keepServableMock.mockResolvedValue([{ id: 'a', servable: true, ms: 9 }]);

        let fired = 0;
        svc.onDidChangeHealth(() => { fired += 1; });
        await svc.syncProfile(GATEWAY.name);
        expect(fired).toBeGreaterThan(0);
    });

    it('reads without probing: getHealth never touches the network', () => {
        const { svc } = service();
        expect(svc.getHealth(GATEWAY.name)?.lastSyncedAt).toBeUndefined();
        expect(svc.getAllHealth()).toHaveLength(1);
        expect(listModelsMock).not.toHaveBeenCalled();
        expect(keepServableMock).not.toHaveBeenCalled();
    });

    it('marks the active profile, and does not store that it did', async () => {
        listModelsMock.mockResolvedValue({ models: [{ id: 'a' }], listed: 1 } as any);
        keepServableMock.mockResolvedValue([{ id: 'a', servable: true, ms: 9 }]);
        const { svc, store } = service();

        await svc.syncProfile(GATEWAY.name);
        expect(svc.getAllHealth()[0].active).toBe(true);
        // Which profile is active is a setting, not something a sweep measured.
        expect(store.get(GATEWAY.name, fingerprintOf(GATEWAY))).not.toHaveProperty('active');
    });

    it('reports nothing for a profile that has gone away', () => {
        const { svc } = service();
        expect(svc.getHealth('deleted')).toBeUndefined();
    });

    it('runs one scheduled pass at a time, and a request made during one runs once after it', async () => {
        // The setup flow writes two settings a moment apart; each change asked
        // for a pass, and the second aborted the first mid-probe and paid for
        // the same completions again.
        const { svc } = service();
        let release: (() => void) | undefined;
        keepServableMock.mockImplementation(async (_p, ids) => {
            await new Promise<void>((r) => { release = r; });
            return ids.map((id) => ({ id, servable: true, ms: 5 }));
        });

        const first = (svc as any).syncDue();
        await vi.waitFor(() => expect(keepServableMock).toHaveBeenCalledTimes(1));
        const second = (svc as any).syncDue();
        const third = (svc as any).syncDue();
        // Still one probe in flight: nothing was aborted, nothing doubled.
        expect(keepServableMock).toHaveBeenCalledTimes(1);

        release!();
        await Promise.all([first, second, third]);
        // The follow-up pass found the endpoint freshly measured and skipped it.
        expect(keepServableMock).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// The protocol (B2) -- validation at the host boundary
// ---------------------------------------------------------------------------

describe('the host handlers', () => {
    /** A `HandlerContext` with just the two services these handlers read. */
    function context(profiles: EndpointProfile[], options: { noService?: boolean } = {}) {
        const endpointService = {
            listProfiles: () => ({ profiles, errors: [] }),
            getStatus: () => ({ profile: profiles[0], report: [], errors: [], available: profiles }),
            secretsFor: async () => () => undefined,
        } as any;
        return {
            logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
            endpointService,
            endpointHealthService: options.noService
                ? undefined
                : new EndpointHealthService(
                    { globalState: memento() } as any,
                    { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
                    endpointService,
                ),
        } as any;
    }

    it('reject a profile name the host does not know', async () => {
        await expect(
            handleGetEndpointHealth({ type: 'get_endpoint_health', profileName: 'nope' } as any, context([GATEWAY])),
        ).rejects.toThrow(/Unknown endpoint profile/);
    });

    it('answer for every profile when no name is given', async () => {
        const response = await handleGetEndpointHealth(
            { type: 'get_endpoint_health' } as any,
            context([GATEWAY, DECLARED]),
        );
        expect(response.health.map((h) => h.profileName)).toEqual([GATEWAY.name, DECLARED.name]);
    });

    it('answer emptily rather than throwing when the host has no health service', async () => {
        const response = await handleGetEndpointHealth(
            { type: 'get_endpoint_health' } as any,
            context([GATEWAY], { noService: true }),
        );
        expect(response.health).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Part E: the gate
// ---------------------------------------------------------------------------

describe('the welcome gate', () => {
    const known = { modelCount: 3, healthyModelCount: 3, checkedProfileCount: 1 };

    it('A — no profiles at all', () => {
        expect(
            endpointWelcomeState({ ...known, hasEndpoints: false, modelCount: 0, healthyModelCount: 0, checkedProfileCount: 0 }),
        ).toBe('no-profiles');
    });

    it('B — profiles exist, nothing to offer, and no sweep to explain why', () => {
        expect(
            endpointWelcomeState({ hasEndpoints: true, modelCount: 0, healthyModelCount: 0, checkedProfileCount: 0 }),
        ).toBe('unchecked');
    });

    it('C — measured, and nothing answered', () => {
        expect(
            endpointWelcomeState({ hasEndpoints: true, modelCount: 0, healthyModelCount: 0, checkedProfileCount: 2 }),
        ).toBe('none-healthy');
    });

    it('stays out of the way when models answer', () => {
        expect(endpointWelcomeState({ ...known, hasEndpoints: true })).toBeUndefined();
    });

    it('does not flash before the handshake answers', () => {
        // `undefined` is "not known yet", and is deliberately not zero.
        expect(
            endpointWelcomeState({
                hasEndpoints: undefined,
                modelCount: undefined,
                healthyModelCount: undefined,
                checkedProfileCount: undefined,
            }),
        ).toBeUndefined();
    });

    it('prefers the measured verdict over the bare model count', () => {
        // Both conditions hold; C is the more specific answer and carries the
        // extra way out, so B must not win.
        expect(
            endpointWelcomeState({ hasEndpoints: true, modelCount: 0, healthyModelCount: 0, checkedProfileCount: 1 }),
        ).toBe('none-healthy');
    });

    it('holds the surface for an endpoint that serves 101 models and answers none', () => {
        // The whole feature in one assertion: this used to be `undefined`.
        expect(
            endpointWelcomeState({ hasEndpoints: true, modelCount: 0, healthyModelCount: 0, checkedProfileCount: 1 }),
        ).toBe('none-healthy');
    });
});

describe('“Skip to chat”', () => {
    it('keeps applying while nothing answers', () => {
        expect(skipStillApplies({ hasEndpoints: true, healthyModelCount: 0 })).toBe(true);
    });

    it('lapses as soon as a later sweep finds something healthy', () => {
        // Otherwise a skip would hide the page from someone whose endpoints
        // broke *after* they skipped.
        expect(skipStillApplies({ hasEndpoints: true, healthyModelCount: 4 })).toBe(false);
    });

    it('lapses when the profiles go away, because that is a different question', () => {
        expect(skipStillApplies({ hasEndpoints: false, healthyModelCount: 0 })).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Part 5: the picker filter, through the handler the picker actually reads
// ---------------------------------------------------------------------------

describe('the model picker, end to end', () => {
    /**
     * `handleGetClaudeState` with a CLI that answers instantly and a health
     * service that answers from a Map. Each profile is one row: the endpoint
     * with its one model, annotated with what the last check measured of that
     * model. The CLI's own table (Anthropic tiers) is never served.
     */
    function context(options: { profiles: EndpointProfile[]; health?: StoredEndpointHealth[] }) {
        const m = memento();
        if (options.health) m.raw.set('forge.endpointHealth', options.health);
        const logService = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
        const endpointService = {
            listProfiles: () => ({ profiles: options.profiles, errors: [] }),
            resolveActiveProfile: () => options.profiles[0],
            getStatus: () => ({ profile: options.profiles[0], report: [], errors: [], available: options.profiles }),
            secretsFor: async () => () => undefined,
        } as any;
        return {
            logService,
            endpointService,
            endpointHealthService: new EndpointHealthService({ globalState: m } as any, logService, endpointService),
            workspaceService: { getDefaultWorkspaceFolder: () => undefined },
            agentService: { noteClaudeSettings: vi.fn() },
            sdkService: {
                query: async () => ({
                    initializationResult: async () => ({ models: [{ value: 'opus', displayName: 'Opus', description: 'Opus' }] }),
                    supportedCommands: async () => [],
                    accountInfo: async () => null,
                    return: async () => {},
                }),
            },
        } as any;
    }

    const config = async (ctx: any) =>
        (await handleGetClaudeState({ type: 'get_claude_state' } as any, ctx)).config;
    const models = async (ctx: any) => (await config(ctx)).models;

    it('offers one row per endpoint, named by the model it runs', async () => {
        const rows = await models(context({ profiles: [GATEWAY, DECLARED] }));
        expect(rows.map((r: any) => [r.value, r.displayName])).toEqual([
            [GATEWAY.name, GATEWAY.model],
            [DECLARED.name, DECLARED.model],
        ]);
        expect(rows.map((r: any) => r.value)).not.toContain('opus');
    });

    it('carries how long the pair took to answer, for the ping beside the model', async () => {
        const health = entry({ models: [{ id: GATEWAY.model, servable: true, ms: 2300, checkedAt: 1 }] });
        const [row] = await models(context({ profiles: [GATEWAY], health: [health] }));
        expect(row.check).toEqual({ state: 'answered', ms: 2300, checkedAt: 1 });
        // The ping is the chip; the description names where the model runs.
        expect(row.description).toBe(`${GATEWAY.name} · integrate.api.nvidia.com`);
    });

    it('lists only the pairs that answered: one that did not is a greyed unavailable row, with the reason', async () => {
        // The user's request (2026-09-25): the list shows what answers. The
        // dead pair moves to the official `unavailable_models`, which the chat
        // picker shows only while that pair is the one in use.
        const health = entry({ models: [{ id: GATEWAY.model, servable: false, ms: 60, detail: 'HTTP 404', checkedAt: 1 }] });
        const answered = entry({
            profileName: DECLARED.name,
            fingerprint: fingerprintOf(DECLARED),
            models: [{ id: DECLARED.model, servable: true, ms: 800, checkedAt: 1 }],
        });
        const got = await config(context({ profiles: [GATEWAY, DECLARED], health: [health, answered] }));
        expect(got.models.map((r: any) => r.value)).toEqual([DECLARED.name]);
        expect(got.unavailable_models?.map((r: any) => r.value)).toEqual([GATEWAY.name]);
        const [dead] = got.unavailable_models!;
        expect(dead).toMatchObject({ disabled: true, check: { state: 'failed', detail: 'HTTP 404' } });
        expect(dead.description).toContain('did not answer: HTTP 404');
    });

    it('treats a check that could not be sent as not answering, whatever the pair answered before', async () => {
        const refused = entry({ error: 'HTTP 401 invalid key', models: [{ id: GATEWAY.model, servable: true, ms: 300, checkedAt: 1 }] });
        const got = await config(context({ profiles: [GATEWAY], health: [refused] }));
        expect(got.models).toEqual([]);
        expect(got.unavailable_models?.[0].description).toContain('could not be checked: HTTP 401 invalid key');
    });

    it('omits unavailable_models when every pair answers, as the CLI omits the key', async () => {
        const health = entry({ models: [{ id: GATEWAY.model, servable: true, ms: 300, checkedAt: 1 }] });
        const got = await config(context({ profiles: [GATEWAY], health: [health] }));
        expect(got).not.toHaveProperty('unavailable_models');
    });

    it('keeps a pair that has never been checked: not measured is not dead', async () => {
        const [row] = await models(context({ profiles: [GATEWAY] }));
        expect(row.value).toBe(GATEWAY.name);
        expect(row.check).toEqual({ state: 'unchecked' });
        expect(row.description).toContain('not checked yet');
    });

    it('reads nothing into verdicts about other models of the same gateway', async () => {
        const health = entry({ models: [{ id: 'some-other-model', servable: false, ms: 5, detail: 'HTTP 404', checkedAt: 1 }] });
        const [row] = await models(context({ profiles: [GATEWAY], health: [health] }));
        expect(row.description).not.toContain('did not answer');
    });

    it('ignores verdicts measured against a different gateway under the same name', async () => {
        const moved = parseProfile({ ...GATEWAY, baseUrl: 'https://moved.example/v1' } as any, 'test');
        const stale = entry({ models: [{ id: GATEWAY.model, servable: false, ms: 5, detail: 'HTTP 404', checkedAt: 1 }] });
        // The fingerprint no longer matches, so the old verdict says nothing.
        const [row] = await models(context({ profiles: [moved], health: [stale] }));
        expect(row.description).not.toContain('did not answer');
    });
});
