/**
 * Step 56: endpoint & model health.
 *
 * The rule under test is one sentence: **if a model is offered in the picker,
 * typing to it must produce a reply.** Everything here is a way of failing that
 * sentence -- a stale verdict, an unprobed id, a sweep that broke halfway, a
 * profile repointed at a different gateway -- and the assertions say what the
 * code does instead.
 *
 * Host: `healthStore.ts` (pure), `health.ts` (the sweep), `check.ts` (the
 * probe), `endpointService.servedModels`, the two handlers and their
 * validation. Webview: the gate in `utils/endpointWelcome.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  DETAIL_MAX,
  ENDPOINT_HEALTH_KEY,
  HealthStore,
  MODELS_MAX,
  commonestFailure,
  fingerprintOf,
  healthyModels,
  keepHealthy,
  medianPing,
  mergeSweep,
  recordSweep,
  recordSweepFailure,
  statusOf,
  type EndpointHealth,
  type HealthMemento,
} from '../src/services/endpoints/healthStore';
import { orderCandidates, CANDIDATE_CAP } from '../src/services/endpoints/health';
import { candidateIds, profileModelRows, answeredIn } from '../src/services/endpoints/models';
import {
  endpointWelcomeState,
  skipStillApplies,
  SKIPPED_WELCOME_KEY,
} from '../src/webview/src/utils/endpointWelcome';
import type { EndpointProfile } from '../src/services/endpoints/profile';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function memento(initial: Record<string, unknown> = {}): HealthMemento & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    store,
    get<T>(key: string): T | undefined {
      return store.get(key) as T | undefined;
    },
    async update(key: string, value: unknown): Promise<void> {
      store.set(key, value);
    },
  };
}

function profile(over: Partial<EndpointProfile> = {}): EndpointProfile {
  return {
    name: 'nvidia-nim',
    wire: 'openai',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'meta/llama-3.1-8b-instruct',
    auth: { kind: 'none' },
    capabilities: {
      streaming: true,
      tools: true,
      toolChoice: true,
      vision: false,
      systemRole: 'message',
      contextWindow: 32000,
      maxOutputTokens: 4096,
      tokenCounting: 'heuristic',
      maxImageBytes: 1_500_000,
      parallelToolCalls: false,
      promptCaching: 'none',
      cacheTtl: '5m',
      parallelToolExecution: true,
      fim: false,
    },
    ...over,
  } as EndpointProfile;
}

function health(over: Partial<EndpointHealth> = {}): EndpointHealth {
  return {
    profileName: 'nvidia-nim',
    fingerprint: fingerprintOf(profile()),
    listed: 101,
    lastSyncedAt: 1_000,
    models: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

describe('the health store', () => {
  it('round-trips a record', async () => {
    const m = memento();
    const store = new HealthStore(m);
    const record = health({ models: [{ id: 'a', servable: true, ms: 120, checkedAt: 1_000 }] });

    await store.put(record);

    expect(store.get('nvidia-nim')).toEqual(record);
    expect(m.store.get(ENDPOINT_HEALTH_KEY)).toHaveLength(1);
  });

  it('replaces a profile rather than appending to it', async () => {
    const store = new HealthStore(memento());
    await store.put(health({ listed: 1 }));
    await store.put(health({ listed: 2 }));

    expect(store.all()).toHaveLength(1);
    expect(store.get('nvidia-nim')?.listed).toBe(2);
  });

  it('ignores junk instead of throwing', () => {
    const store = new HealthStore(
      memento({
        [ENDPOINT_HEALTH_KEY]: [
          null,
          'nonsense',
          { profileName: '' },
          { profileName: 'ok', models: [{ id: 'a', servable: true, ms: 5, checkedAt: 1 }, { nope: true }] },
        ],
      }),
    );

    const all = store.all();
    expect(all).toHaveLength(1);
    expect(all[0].profileName).toBe('ok');
    expect(all[0].models).toHaveLength(1);
  });

  it('is not an unbounded list: models are capped on write and on read', async () => {
    const many = Array.from({ length: MODELS_MAX + 50 }, (_, i) => ({
      id: `m${i}`,
      servable: true,
      ms: 1,
      checkedAt: 1,
    }));
    const store = new HealthStore(memento());
    await store.put(health({ models: many }));

    expect(store.get('nvidia-nim')?.models).toHaveLength(MODELS_MAX);
  });

  it('truncates a detail a misbehaving gateway made enormous', () => {
    const store = new HealthStore(
      memento({
        [ENDPOINT_HEALTH_KEY]: [
          { profileName: 'p', listed: 1, fingerprint: '', models: [{ id: 'a', servable: false, ms: 1, checkedAt: 1, detail: 'x'.repeat(5_000) }] },
        ],
      }),
    );

    expect(store.all()[0].models[0].detail).toHaveLength(DETAIL_MAX);
  });
});

describe('fingerprint invalidation', () => {
  it('changes when the gateway changes', () => {
    const before = fingerprintOf(profile());
    const after = fingerprintOf(profile({ baseUrl: 'https://elsewhere.example.com/v1' }));
    expect(after).not.toBe(before);
  });

  it('does not change for fields that cannot affect what is served', () => {
    const before = fingerprintOf(profile());
    const after = fingerprintOf(profile({ description: 'new words', timeoutMs: 999 }));
    expect(after).toBe(before);
  });

  it('discards verdicts for a profile repointed at a different gateway', async () => {
    const store = new HealthStore(memento());
    await store.put(health({ models: [{ id: 'a', servable: true, ms: 1, checkedAt: 1 }] }));

    const moved = profile({ baseUrl: 'https://elsewhere.example.com/v1' });
    const kept = await store.reconcile([moved]);

    expect(kept).toEqual([]);
    expect(store.get('nvidia-nim')).toBeUndefined();
  });

  it('forgets a profile that no longer exists', async () => {
    const store = new HealthStore(memento());
    await store.put(health());

    expect(await store.reconcile([])).toEqual([]);
  });

  it('keeps a profile that is unchanged', async () => {
    const store = new HealthStore(memento());
    await store.put(health());

    expect(await store.reconcile([profile()])).toHaveLength(1);
  });
});

describe('a sweep that fails', () => {
  it('keeps the previous verdicts rather than emptying the picker', () => {
    const previous = health({
      models: [{ id: 'good', servable: true, ms: 100, checkedAt: 1_000 }],
    });

    const after = recordSweepFailure(previous, {
      profileName: 'nvidia-nim',
      fingerprint: previous.fingerprint,
      error: '401 Unauthorized',
    });

    expect(after.models).toEqual(previous.models);
    expect(after.error).toBe('401 Unauthorized');
    // The last *successful* sweep time survives, so the row does not claim to
    // have been checked just now.
    expect(after.lastSyncedAt).toBe(1_000);
    // And the picker still offers the model it knows answers.
    expect(keepHealthy(['good'], after, 'listing')).toEqual(['good']);
  });

  it('records a first-ever failure without inventing a sweep time', () => {
    const after = recordSweepFailure(undefined, {
      profileName: 'p',
      fingerprint: 'f',
      error: 'getaddrinfo ENOTFOUND',
    });

    expect(after.lastSyncedAt).toBeUndefined();
    expect(statusOf(after)).toBe('never-checked');
  });
});

describe('a sweep the user cancelled', () => {
  const previous = health({
    lastSyncedAt: 1_000,
    models: [
      { id: 'a', servable: true, ms: 100, checkedAt: 1_000 },
      { id: 'b', servable: true, ms: 200, checkedAt: 1_000 },
      { id: 'c', servable: false, ms: 20_000, checkedAt: 1_000, detail: 'HTTP 404' },
    ],
  });

  const partial = recordSweep({
    profileName: 'nvidia-nim',
    fingerprint: previous.fingerprint,
    listed: 101,
    at: 9_000,
    // Cancel landed after one id.
    results: [{ id: 'a', servable: false, ms: 55, detail: 'HTTP 404' }],
  });

  it('keeps the verdicts it never reached, instead of deleting them', () => {
    const merged = mergeSweep(previous, partial);
    const ids = merged.models.map((m) => m.id).sort();

    expect(ids).toEqual(['a', 'b', 'c']);
    // Pressing Cancel must not shrink the picker.
    expect(keepHealthy(['a', 'b', 'c'], merged, 'listing')).toEqual(['b']);
  });

  it('lets the fresh verdict win where it has one', () => {
    const merged = mergeSweep(previous, partial);
    expect(merged.models.find((m) => m.id === 'a')).toMatchObject({
      servable: false,
      detail: 'HTTP 404',
      checkedAt: 9_000,
    });
  });

  it('does not date itself as a completed pass', () => {
    // Otherwise the next `syncDue` would skip this profile for a whole
    // interval on the strength of a sweep the user stopped.
    expect(mergeSweep(previous, partial).lastSyncedAt).toBe(1_000);
  });

  it('a cancelled first-ever sweep is still "never checked"', () => {
    expect(mergeSweep(undefined, partial).lastSyncedAt).toBeUndefined();
    expect(statusOf(mergeSweep(undefined, partial))).toBe('never-checked');
  });
});

describe('recording a sweep', () => {
  it('stamps every verdict with the sweep time', () => {
    const record = recordSweep({
      profileName: 'p',
      fingerprint: 'f',
      listed: 101,
      at: 5_000,
      results: [
        { id: 'a', servable: true, ms: 200 },
        { id: 'b', servable: false, ms: 20_000, detail: 'listed, but accepted the request and never answered' },
      ],
    });

    expect(record.lastSyncedAt).toBe(5_000);
    expect(record.models.every((m) => m.checkedAt === 5_000)).toBe(true);
    expect(record.listed).toBe(101);
  });

  it('keeps the listed count separate from the probed count', () => {
    const record = recordSweep({
      profileName: 'p',
      fingerprint: 'f',
      listed: 101,
      at: 1,
      results: Array.from({ length: 60 }, (_, i) => ({ id: `m${i}`, servable: i < 28, ms: 10 })),
    });

    expect(record.listed).toBe(101);
    expect(record.models).toHaveLength(60);
    expect(healthyModels(record)).toHaveLength(28);
  });
});

describe('reporting', () => {
  it('reads status off the verdicts', () => {
    expect(statusOf(undefined)).toBe('never-checked');
    expect(statusOf(health({ lastSyncedAt: undefined }))).toBe('never-checked');
    expect(statusOf(health({ models: [{ id: 'a', servable: false, ms: 1, checkedAt: 1 }] }))).toBe('unreachable');
    expect(statusOf(health({ models: [{ id: 'a', servable: true, ms: 1, checkedAt: 1 }] }))).toBe('alive');
  });

  it('takes the median over the models that answered, not all of them', () => {
    const record = health({
      models: [
        { id: 'a', servable: true, ms: 100, checkedAt: 1 },
        { id: 'b', servable: true, ms: 300, checkedAt: 1 },
        // A 20s timeout would drag a naive mean to nonsense.
        { id: 'c', servable: false, ms: 20_000, checkedAt: 1 },
      ],
    });

    expect(medianPing(record)).toBe(200);
  });

  it('has no median when nothing answered', () => {
    expect(medianPing(health({ models: [{ id: 'a', servable: false, ms: 5, checkedAt: 1 }] }))).toBeUndefined();
  });

  it('names the commonest failure, because sixty rows say less than one reason', () => {
    const record = health({
      models: [
        { id: 'a', servable: false, ms: 1, checkedAt: 1, detail: 'HTTP 404' },
        { id: 'b', servable: false, ms: 1, checkedAt: 1, detail: 'HTTP 404' },
        { id: 'c', servable: false, ms: 1, checkedAt: 1, detail: 'listed, but accepted the request and never answered' },
      ],
    });

    expect(commonestFailure(record)).toBe('HTTP 404');
  });
});

// ---------------------------------------------------------------------------
// The filter: the point of the whole feature
// ---------------------------------------------------------------------------

describe('keepHealthy', () => {
  const swept = health({
    models: [
      { id: 'answered', servable: true, ms: 100, checkedAt: 1 },
      { id: 'four-oh-four', servable: false, ms: 20, checkedAt: 1, detail: 'HTTP 404' },
    ],
  });

  it('keeps only what answered, for a gateway listing', () => {
    // `unprobed` fell beyond the candidate cap. Not evidence, so not offered.
    expect(keepHealthy(['answered', 'four-oh-four', 'unprobed'], swept, 'listing')).toEqual(['answered']);
  });

  it('loses only what failed, for a declared models block', () => {
    // The declaration is the user naming what they want; absence of evidence
    // must not overrule them.
    expect(keepHealthy(['answered', 'four-oh-four', 'unprobed'], swept, 'declared')).toEqual([
      'answered',
      'unprobed',
    ]);
  });

  it('never empties a list because health is unknown', () => {
    const ids = ['a', 'b'];
    expect(keepHealthy(ids, undefined, 'listing')).toEqual(ids);
    expect(keepHealthy(ids, health({ lastSyncedAt: undefined }), 'listing')).toEqual(ids);
    expect(keepHealthy(ids, health({ models: [] }), 'listing')).toEqual(ids);
  });

  it('is the never-swept fallback the empty picker bug needed', () => {
    // The regression this guards: an empty model picker with no way to tell
    // whether the gateway was dead or simply unmeasured.
    expect(keepHealthy(['only-model'], health({ lastSyncedAt: undefined }), 'listing')).toEqual(['only-model']);
  });
});

describe('candidate selection', () => {
  it('prefers a declared models block over the gateway listing', () => {
    const p = profile({ models: [{ id: 'mine' }] });
    expect(candidateIds(p, [{ id: 'theirs' }])).toEqual({ ids: ['mine'], source: 'declared' });
  });

  it('falls back to the listing, then to the single named model', () => {
    expect(candidateIds(profile(), [{ id: 'theirs' }])).toEqual({ ids: ['theirs'], source: 'listing' });
    expect(candidateIds(profile(), [])).toEqual({
      ids: ['meta/llama-3.1-8b-instruct'],
      source: 'declared',
    });
  });

  it('probes the models the profile names first, so the cap cannot skip them', () => {
    const p = profile({ model: 'mine', models: [{ id: 'mine' }, { id: 'also-mine' }] });
    const listed = Array.from({ length: 100 }, (_, i) => `other-${i}`);
    listed.splice(50, 0, 'also-mine');

    const ordered = orderCandidates(p, listed);

    expect(ordered.slice(0, 2).sort()).toEqual(['also-mine', 'mine']);
    // And the cap therefore keeps them.
    expect(ordered.slice(0, CANDIDATE_CAP)).toContain('mine');
  });

  it('still probes a named model the gateway never listed', () => {
    const p = profile({ model: 'unlisted' });
    expect(orderCandidates(p, ['a', 'b'])).toContain('unlisted');
  });
});

describe('picker rows', () => {
  it('says how fast each model answered', () => {
    const rows = profileModelRows(profile(), ['fast'], new Map([['fast', 340]]));
    expect(rows[0].description).toContain('answered in 340ms');
  });

  it('switches to seconds once a model is slow enough to care about', () => {
    expect(answeredIn(2_300)).toBe('answered in 2.3s');
    expect(answeredIn(999)).toBe('answered in 999ms');
  });

  it('reports effort and fast mode false rather than undefined', () => {
    // `undefined` reads as "not known yet" in the webview and leaves the
    // control waiting forever.
    const [row] = profileModelRows(profile(), ['a']);
    expect(row.supportsEffort).toBe(false);
    expect(row.supportsFastMode).toBe(false);
    expect(row.supportsAutoMode).toBe(false);
  });

  it('uses the declared display name when there is one', () => {
    const p = profile({ models: [{ id: 'raw/id', displayName: 'Nice Name' }] });
    expect(profileModelRows(p, ['raw/id'])[0].displayName).toBe('Nice Name');
  });
});

// ---------------------------------------------------------------------------
// Validation (B3)
// ---------------------------------------------------------------------------

describe('the webview cannot aim a sweep at something the host did not offer', () => {
  function service(profiles: EndpointProfile[]) {
    // The real service, with only the two collaborators the sweep path uses.
    const logService = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const endpoints = { listProfiles: () => ({ profiles, errors: [] }) };
    return { logService, endpoints };
  }

  it('rejects an unknown profile name instead of coercing it', async () => {
    const { EndpointHealthService } = await import('../src/services/endpoints/health');
    const { logService, endpoints } = service([profile()]);
    const svc = new EndpointHealthService(
      { globalState: memento() },
      logService as never,
      endpoints as never,
    );

    await expect(svc.syncProfile('not-a-profile')).rejects.toThrow(/No endpoint profile named/);
  });

  it('rejects a name that differs only by whitespace padding it cannot trim away', async () => {
    const { EndpointHealthService } = await import('../src/services/endpoints/health');
    const { logService, endpoints } = service([profile()]);
    const svc = new EndpointHealthService(
      { globalState: memento() },
      logService as never,
      endpoints as never,
    );

    await expect(svc.syncProfile('nvidia-nim-x')).rejects.toThrow(/No endpoint profile named/);
  });

  it('reads back nothing for a profile that no longer exists', async () => {
    const { EndpointHealthService } = await import('../src/services/endpoints/health');
    const { logService, endpoints } = service([]);
    const m = memento({ [ENDPOINT_HEALTH_KEY]: [health()] });
    const svc = new EndpointHealthService({ globalState: m }, logService as never, endpoints as never);

    expect(svc.getAllHealth()).toEqual([]);
  });

  it('hides a stored record whose fingerprint moved, before any sweep prunes it', async () => {
    const { EndpointHealthService } = await import('../src/services/endpoints/health');
    const moved = profile({ baseUrl: 'https://elsewhere.example.com/v1' });
    const { logService, endpoints } = service([moved]);
    const m = memento({ [ENDPOINT_HEALTH_KEY]: [health()] });
    const svc = new EndpointHealthService({ globalState: m }, logService as never, endpoints as never);

    expect(svc.getAllHealth()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

describe('the welcome gate', () => {
  const unknown = {
    hasEndpoints: undefined,
    modelCount: undefined,
    healthyModelCount: undefined,
    checkedProfileCount: undefined,
  };

  it('draws nothing while the handshake is still out', () => {
    // `undefined` is "not known yet", and it is deliberately the same answer as
    // "nothing is up": the page must not flash a gate on launch.
    expect(endpointWelcomeState(unknown)).toBeUndefined();
  });

  it('draws nothing when the picker has rows', () => {
    expect(
      endpointWelcomeState({ ...unknown, hasEndpoints: true, modelCount: 4, healthyModelCount: 4, checkedProfileCount: 1 }),
    ).toBeUndefined();
  });

  it('state A: no profiles at all', () => {
    expect(endpointWelcomeState({ ...unknown, hasEndpoints: false })).toBe('no-profiles');
  });

  it('state B: profiles with nothing to offer and no sweep to explain it', () => {
    expect(
      endpointWelcomeState({ ...unknown, hasEndpoints: true, modelCount: 0, checkedProfileCount: 0 }),
    ).toBe('unchecked');
  });

  it('state C: measured, and nothing answered', () => {
    expect(
      endpointWelcomeState({ ...unknown, hasEndpoints: true, modelCount: 0, healthyModelCount: 0, checkedProfileCount: 2 }),
    ).toBe('none-healthy');
  });

  it('prefers the measured verdict over the model count', () => {
    // Testing the count first would show "check them" to someone whose
    // endpoints have just been checked, and hide the only way past.
    expect(
      endpointWelcomeState({ ...unknown, hasEndpoints: true, modelCount: 0, healthyModelCount: 0, checkedProfileCount: 1 }),
    ).toBe('none-healthy');
  });

  it('is the defect it replaces: 101 listed models that answer nothing is not 101 models', () => {
    // The old gate read `claudeConfig.models.length` and saw 101, so the user
    // landed in a chat where nothing replied. The picker is now built from the
    // answered models, so the same endpoint reports 0 and gates.
    expect(
      endpointWelcomeState({ ...unknown, hasEndpoints: true, modelCount: 0, healthyModelCount: 0, checkedProfileCount: 1 }),
    ).toBe('none-healthy');
  });
});

describe('the skip', () => {
  it('is keyed where the webview can find it again', () => {
    expect(SKIPPED_WELCOME_KEY).toBe('forge.endpointWelcomeSkipped');
  });

  it('lapses when a later sweep finds a healthy model', () => {
    expect(skipStillApplies({ hasEndpoints: true, healthyModelCount: 0 })).toBe(true);
    expect(skipStillApplies({ hasEndpoints: true, healthyModelCount: 3 })).toBe(false);
  });

  it('lapses when the profiles go away', () => {
    expect(skipStillApplies({ hasEndpoints: false, healthyModelCount: 0 })).toBe(false);
  });

  it('holds while health is simply unknown, rather than re-gating on a blank', () => {
    expect(skipStillApplies({ hasEndpoints: true, healthyModelCount: undefined })).toBe(true);
  });
});
