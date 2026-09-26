/**
 * The model picker lists only what answers, with its ping, checked every five
 * minutes, and refreshable from the picker (the user's request, 2026-09-25).
 *
 * The rule itself (`shared/pairHealth.ts`) is shared by the host, which builds
 * the rows and the welcome gate's count, and the webview, which draws the ping
 * and the refresh. So it is specced here once, then through the handlers the
 * picker and Settings actually read, then through the timer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    FAST_PING_MS,
    SLOW_PING_MS,
    answeringModelCount,
    isOffered,
    pairCheck,
    pairStatusText,
    pingText,
    pingTone,
} from '../src/shared/pairHealth';
import {
    DEFAULT_SYNC_INTERVAL_MINUTES,
    SYNC_DUE_SLACK_MS,
    fingerprintOf,
    isSweepDue,
} from '../src/services/endpoints/healthStore';
import { parseProfile } from '../src/services/endpoints/profile';

vi.mock('../src/services/endpoints/check', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/services/endpoints/check')>();
    return { ...actual, listModels: vi.fn(), keepServable: vi.fn() };
});

import { keepServable } from '../src/services/endpoints/check';
import { EndpointHealthService } from '../src/services/endpoints/health';
import { handleGetClaudeState, handleInit, handleSdkProbe } from '../src/services/claude/handlers/handlers';

const keepServableMock = vi.mocked(keepServable);

const OMNIROUTE = parseProfile(
    { name: 'omniroute', wire: 'openai', baseUrl: 'http://localhost:20128/v1', model: 'auto', auth: { kind: 'none' } },
    'test',
);
const OLLAMA = parseProfile(
    { name: 'ollama-qwen', wire: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen3-coder', auth: { kind: 'none' } },
    'test',
);
const GATEWAY = parseProfile(
    { name: 'gateway', wire: 'openai', baseUrl: 'https://llm.example/v1', model: 'opus-5', auth: { kind: 'none' } },
    'test',
);

const answered = (id: string, ms: number) => ({ error: undefined, models: [{ id, servable: true, ms, checkedAt: 7 }] });
const failed = (id: string, detail: string) => ({ models: [{ id, servable: false, ms: 20_000, detail, checkedAt: 7 }] });

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

describe('whether a pair answers', () => {
    it('reads the verdict for the pair`s own model', () => {
        expect(pairCheck('auto', answered('auto', 850))).toEqual({ state: 'answered', ms: 850, checkedAt: 7 });
        expect(pairCheck('auto', failed('auto', 'timeout'))).toEqual({ state: 'failed', detail: 'timeout', checkedAt: 7 });
    });

    it('reads nothing into a verdict about another model', () => {
        expect(pairCheck('auto', answered('other', 850))).toEqual({ state: 'unchecked' });
    });

    it('lets a check that could not be sent win over an older answer', () => {
        // `error` is set by the most recent attempt; a completed check clears it.
        expect(pairCheck('auto', { ...answered('auto', 850), error: 'HTTP 401' }))
            .toEqual({ state: 'unreachable', detail: 'HTTP 401' });
    });

    it('says a first check is running, and keeps the previous verdict while a re-check runs', () => {
        expect(pairCheck('auto', { models: [], syncing: true })).toEqual({ state: 'checking', syncing: true });
        expect(pairCheck('auto', { ...answered('auto', 850), syncing: true }))
            .toEqual({ state: 'answered', ms: 850, checkedAt: 7, syncing: true });
    });

    it('treats never checked as unchecked, not as dead', () => {
        expect(pairCheck('auto', undefined)).toEqual({ state: 'unchecked' });
        expect(pairCheck('auto', { models: [] })).toEqual({ state: 'unchecked' });
    });

    it('offers what answered and what has not been measured, never what failed', () => {
        expect(isOffered({ state: 'answered', ms: 1 })).toBe(true);
        expect(isOffered({ state: 'unchecked' })).toBe(true);
        expect(isOffered({ state: 'checking' })).toBe(true);
        expect(isOffered({ state: 'failed', detail: 'x' })).toBe(false);
        expect(isOffered({ state: 'unreachable', detail: 'x' })).toBe(false);
    });

    it('writes the reason for every state but answered, whose ping is the chip', () => {
        expect(pairStatusText({ state: 'answered', ms: 1 })).toBe('');
        expect(pairStatusText({ state: 'failed', detail: 'HTTP 404' })).toBe('did not answer: HTTP 404');
        expect(pairStatusText({ state: 'unreachable', detail: 'ECONNREFUSED' })).toBe('could not be checked: ECONNREFUSED');
        expect(pairStatusText({ state: 'checking' })).toBe('checking…');
        expect(pairStatusText({ state: 'unchecked' })).toBe('not checked yet');
    });

    it('counts, for the welcome gate, only models on endpoints whose last check was sent', () => {
        expect(answeringModelCount([
            { ...answered('a', 1) },
            { ...answered('b', 1), error: 'HTTP 401' },
            failed('c', 'timeout'),
        ])).toBe(1);
    });
});

describe('the ping', () => {
    it('reads in ms below a second and in seconds above', () => {
        expect(pingText(820)).toBe('820ms');
        expect(pingText(999)).toBe('999ms');
        expect(pingText(1000)).toBe('1.0s');
        expect(pingText(1400)).toBe('1.4s');
        expect(pingText(12_345)).toBe('12.3s');
    });

    it('is coloured as a Pajamas badge: success under a second, neutral under three, warning above', () => {
        expect(pingTone(FAST_PING_MS - 1)).toBe('fast');
        expect(pingTone(FAST_PING_MS)).toBe('fair');
        expect(pingTone(SLOW_PING_MS - 1)).toBe('fair');
        expect(pingTone(SLOW_PING_MS)).toBe('slow');
        expect(pingTone(60_000)).toBe('slow');
    });
});

// ---------------------------------------------------------------------------
// Every five minutes
// ---------------------------------------------------------------------------

describe('the check schedule', () => {
    it('defaults to five minutes, in the code and in the setting the user sees', () => {
        expect(DEFAULT_SYNC_INTERVAL_MINUTES).toBe(5);
        const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
        const setting = manifest.contributes.configuration.properties?.['forge.endpointHealth.syncIntervalMinutes']
            ?? [].concat(manifest.contributes.configuration)
                .map((c: any) => c.properties?.['forge.endpointHealth.syncIntervalMinutes'])
                .find(Boolean);
        expect(setting.default).toBe(DEFAULT_SYNC_INTERVAL_MINUTES);
        expect(setting.markdownDescription).toContain('5 minutes');
    });

    it('is due for a pair never checked, and never when the schedule is off', () => {
        expect(isSweepDue(undefined, 0, 5)).toBe(true);
        expect(isSweepDue(undefined, 0, 0)).toBe(false);
        expect(isSweepDue(0, 10 * 60_000, 0)).toBe(false);
    });

    it('is due a few seconds short of one interval, because a check is dated when it finishes', () => {
        const checked = 1_000_000;
        // 15 s of probing after the tick: the next tick sees 4 min 45 s.
        expect(isSweepDue(checked, checked + 5 * 60_000 - 15_000, 5)).toBe(true);
        expect(isSweepDue(checked, checked + 5 * 60_000 - SYNC_DUE_SLACK_MS - 1, 5)).toBe(false);
        expect(isSweepDue(checked, checked + 60_000, 5)).toBe(false);
    });

    it('caps the slack at half a short interval, so a 1-minute schedule still waits', () => {
        expect(isSweepDue(0, 29_000, 1)).toBe(false);
        expect(isSweepDue(0, 30_000, 1)).toBe(true);
    });

    describe('the timer', () => {
        beforeEach(() => { keepServableMock.mockReset(); });
        afterEach(() => vi.useRealTimers());

        it('checks every five minutes, not every ten, even though each check takes a while', async () => {
            vi.useFakeTimers({ now: 1_800_000_000_000 });
            const raw = new Map<string, unknown>();
            const logService = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
            const endpointService = {
                listProfiles: () => ({ profiles: [OMNIROUTE], errors: [] }),
                getStatus: () => ({ profile: OMNIROUTE, report: [], errors: [], available: [OMNIROUTE] }),
                secretsFor: async () => () => undefined,
            } as any;
            // Each check takes 15 s: the probe answers after the tick that
            // started it, which is what made every other tick skip.
            keepServableMock.mockImplementation(async (_p, ids) => {
                await new Promise((r) => setTimeout(r, 15_000));
                return ids.map((id) => ({ id, servable: true, ms: 900 }));
            });
            const svc = new EndpointHealthService(
                { globalState: { get: (k: string) => raw.get(k), update: async (k: string, v: unknown) => void raw.set(k, v) } } as any,
                logService,
                endpointService,
            );
            const running = svc.activate();
            await vi.advanceTimersByTimeAsync(15_000);
            expect(keepServableMock).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(5 * 60_000);
            expect(keepServableMock).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(5 * 60_000);
            expect(keepServableMock).toHaveBeenCalledTimes(3);
            expect(svc.getHealth(OMNIROUTE.name)?.models[0]).toMatchObject({ id: 'auto', servable: true, ms: 900 });
            running.dispose();
        });
    });
});

// ---------------------------------------------------------------------------
// Through the handlers the picker, Settings and the welcome gate read
// ---------------------------------------------------------------------------

function context(health: Record<string, any>, profiles = [OMNIROUTE, OLLAMA, GATEWAY]) {
    return {
        logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
        configService: { getSetting: async () => 'default', getExtensionConfig: async () => ({}) },
        workspaceService: { getDefaultWorkspaceFolder: () => undefined },
        agentService: { noteClaudeSettings: vi.fn(), schedulePushStateUpdate: vi.fn(), sendSessionStates: vi.fn() },
        endpointService: {
            listProfiles: () => ({ profiles, errors: [] }),
            resolveActiveProfile: () => profiles[0],
            getStatus: () => ({ profile: profiles[0], report: [], errors: [], available: profiles }),
        },
        endpointHealthService: {
            getHealth: (name: string) => health[name],
            getAllHealth: () => profiles.map((p) => ({ profileName: p.name, listed: 1, models: [], ...health[p.name] })),
        },
        sdkService: {
            getThinkingLevel: () => 'default_on',
            getAllowDangerouslySkipPermissions: () => false,
            isBrowserIntegrationSupported: () => false,
            query: async () => ({
                initializationResult: async () => ({ models: [] }),
                supportedCommands: async () => [],
                accountInfo: async () => null,
                return: async () => {},
            }),
            probe: async () => ({ data: { supportedModels: [], supportedCommands: [] }, errors: {} }),
        },
    } as any;
}

describe('the rows the host serves', () => {
    const health = {
        omniroute: { ...answered('auto', 1400), lastSyncedAt: 7 },
        'ollama-qwen': { ...failed('qwen3-coder', 'no reply in 20s'), lastSyncedAt: 7 },
    };

    it('offers the answering and the unmeasured pairs, and greys the dead one', async () => {
        const { config } = await handleGetClaudeState({ type: 'get_claude_state' } as any, context(health));
        expect(config.models.map((r) => [r.value, r.check?.state])).toEqual([
            ['omniroute', 'answered'],
            ['gateway', 'unchecked'],
        ]);
        expect(config.models[0].check?.ms).toBe(1400);
        expect(config.unavailable_models?.map((r) => [r.value, r.disabled, r.check?.state])).toEqual([
            ['ollama-qwen', true, 'failed'],
        ]);
    });

    it('marks the pair in use, wherever it lands', async () => {
        const inUse = { ...health, omniroute: failed('auto', 'HTTP 503') };
        const { config } = await handleGetClaudeState({ type: 'get_claude_state' } as any, context(inUse));
        expect(config.unavailable_models?.find((r) => r.value === 'omniroute')).toMatchObject({ active: true, disabled: true });
    });

    it('gives Settings every pair, in profile order, because it manages them all', async () => {
        const probe = await handleSdkProbe({ type: 'sdk_probe', capabilities: ['supportedModels'] } as any, context(health));
        expect(probe.data.supportedModels.map((r: any) => r.value)).toEqual(['omniroute', 'ollama-qwen', 'gateway']);
    });

    it('counts, for the welcome gate, nothing on an endpoint whose key was refused', async () => {
        const refused = {
            omniroute: { ...answered('auto', 1400), error: 'HTTP 401', lastSyncedAt: 7 },
            'ollama-qwen': { ...answered('qwen3-coder', 300), lastSyncedAt: 7 },
        };
        const init = await handleInit({ type: 'init' } as any, context(refused));
        expect(init.state.endpointHealthyModelCount).toBe(1);
    });

    it('does not trust a stored verdict measured against another gateway', () => {
        // The fingerprint: the host's `getHealth` answers nothing for it, so
        // the row reads as unchecked, not as the old gateway's answer.
        const moved = parseProfile({ ...OMNIROUTE, baseUrl: 'http://elsewhere:1/v1' } as any, 'test');
        expect(fingerprintOf(moved)).not.toBe(fingerprintOf(OMNIROUTE));
    });
});
