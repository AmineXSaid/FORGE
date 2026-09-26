/**
 * The welcome page's summary: one count, a bar and a chip per endpoint.
 *
 * The page (2026-09-26, the "C · Summary" design the user chose) replaced the
 * per-endpoint table. Everything it says comes from the host's health rows,
 * and before the first check a profile has no model count at all
 * (`health.ts`: `listed: 0, models: []`), so it counts endpoints until then.
 */
import { describe, expect, it } from 'vitest';
import type { EndpointHealth, ModelHealth } from '../src/shared/messages';
import { answering, TICK_LIMIT, welcomeSummary } from '../src/webview/src/utils/welcomeSummary';

const model = (id: string, servable: boolean): ModelHealth => ({ id, servable, ms: 120, checkedAt: 1 });
const models = (n: number, ok = 0): ModelHealth[] =>
    Array.from({ length: n }, (_, i) => model(`m${i}`, i < ok));

const unchecked = (profileName: string): EndpointHealth => ({ profileName, listed: 0, models: [] });
const checked = (profileName: string, n: number, ok = 0): EndpointHealth => ({
    profileName,
    lastSyncedAt: 1_000,
    listed: n,
    models: models(n, ok),
});

describe('before any check', () => {
    it('counts endpoints, not models, and draws them hollow', () => {
        const s = welcomeSummary([unchecked('TE-GW'), unchecked('Local Ollama')]);
        expect(s.count).toEqual({ value: '2', unit: ' endpoints', label: 'not checked yet', tone: 'plain' });
        expect(s.segments).toEqual([
            { weight: 1, fill: 0, kind: 'hollow', ticks: 0 },
            { weight: 1, fill: 0, kind: 'hollow', ticks: 0 },
        ]);
        expect(s.chips).toEqual([
            { name: 'TE-GW', status: 'not checked', tone: 'plain' },
            { name: 'Local Ollama', status: 'not checked', tone: 'plain' },
        ]);
    });

    it('says endpoint, singular, for one', () => {
        expect(welcomeSummary([unchecked('TE-GW')]).count.unit).toBe(' endpoint');
    });
});

describe('while a check runs', () => {
    it('shows live progress from the host, summed across endpoints', () => {
        const s = welcomeSummary([
            { ...unchecked('TE-GW'), syncing: true, checked: 4, total: 12 },
            { ...unchecked('Local Ollama'), syncing: true, checked: 3, total: 3 },
        ]);
        expect(s.count).toEqual({ value: '7', unit: ' of 15', label: 'models checked', tone: 'live' });
        expect(s.segments).toEqual([
            { weight: 12, fill: 4 / 12, kind: 'live', ticks: 12 },
            { weight: 3, fill: 1, kind: 'live', ticks: 3 },
        ]);
        expect(s.chips.map((c) => c.status)).toEqual(['checking 4 of 12', 'checking 3 of 3']);
        expect(s.chips.every((c) => c.tone === 'live')).toBe(true);
    });

    it('counts endpoints until the host has planned its probes', () => {
        const s = welcomeSummary([{ ...unchecked('TE-GW'), syncing: true }]);
        expect(s.count).toEqual({ value: '1', unit: ' endpoint', label: 'being checked', tone: 'live' });
        expect(s.chips[0]).toEqual({ name: 'TE-GW', status: 'checking', tone: 'live' });
    });

    it('counts an endpoint that already finished as done', () => {
        const s = welcomeSummary([
            checked('TE-GW', 12),
            { ...unchecked('Local Ollama'), syncing: true, checked: 1, total: 3 },
        ]);
        expect(s.count.value).toBe('13');
        expect(s.count.unit).toBe(' of 15');
    });

    it('never reports more checked than planned', () => {
        const s = welcomeSummary([{ ...unchecked('TE-GW'), syncing: true, checked: 9, total: 4 }]);
        expect(s.count.value).toBe('4');
        expect(s.segments[0]!.fill).toBe(1);
    });
});

describe('after a check', () => {
    it('counts answering models out of the ones probed', () => {
        const s = welcomeSummary([checked('TE-GW', 12), checked('Local Ollama', 3)]);
        expect(s.count).toEqual({ value: '0', unit: ' of 15', label: 'models answered', tone: 'dead' });
        expect(s.segments).toEqual([
            { weight: 12, fill: 0, kind: 'answered', ticks: 12 },
            { weight: 3, fill: 0, kind: 'answered', ticks: 3 },
        ]);
        expect(s.chips).toEqual([
            { name: 'TE-GW', status: '0 of 12', tone: 'dead' },
            { name: 'Local Ollama', status: '0 of 3', tone: 'dead' },
        ]);
    });

    it('turns to ok once any model answers', () => {
        const s = welcomeSummary([checked('TE-GW', 12, 5), checked('Local Ollama', 3)]);
        expect(s.count).toMatchObject({ value: '5', unit: ' of 15', tone: 'ok' });
        expect(s.segments[0]).toEqual({ weight: 12, fill: 5 / 12, kind: 'answered', ticks: 12 });
        expect(s.chips[0]).toEqual({ name: 'TE-GW', status: '5 of 12', tone: 'ok' });
    });

    it('names an endpoint it could not reach, with the reason on hover', () => {
        const s = welcomeSummary([{ ...checked('TE-GW', 0), error: 'getaddrinfo ENOTFOUND gpt.example' }]);
        expect(s.chips[0]).toEqual({
            name: 'TE-GW',
            status: 'could not connect',
            tone: 'dead',
            detail: 'getaddrinfo ENOTFOUND gpt.example',
        });
        // Nothing probed: no " of 0".
        expect(s.count).toEqual({ value: '0', unit: '', label: 'models answered', tone: 'dead' });
    });

    it('keeps an endpoint added since the check hollow and out of the count', () => {
        const s = welcomeSummary([checked('TE-GW', 12), unchecked('New one')]);
        expect(s.count.unit).toBe(' of 12');
        expect(s.segments[1]).toEqual({ weight: 1, fill: 0, kind: 'hollow', ticks: 0 });
        expect(s.chips[1]).toEqual({ name: 'New one', status: 'not checked', tone: 'plain' });
    });

    it('says model, singular, for one', () => {
        expect(welcomeSummary([checked('Solo', 1, 1)]).count.label).toBe('model answered');
    });
});

describe('the bar', () => {
    it('draws one tick per model up to the limit', () => {
        const s = welcomeSummary([checked('A', TICK_LIMIT - 10), checked('B', 10)]);
        expect(s.segments.map((seg) => seg.ticks)).toEqual([TICK_LIMIT - 10, 10]);
    });

    it('draws continuous bars past it, for every endpoint alike', () => {
        const s = welcomeSummary([checked('A', TICK_LIMIT), checked('B', 1, 1)]);
        expect(s.segments.map((seg) => seg.ticks)).toEqual([0, 0]);
        expect(s.segments[1]!.fill).toBe(1);
    });

    it('applies the same limit to a check in progress', () => {
        const s = welcomeSummary([{ ...unchecked('A'), syncing: true, checked: 0, total: TICK_LIMIT + 1 }]);
        expect(s.segments[0]!.ticks).toBe(0);
    });
});

describe('answering', () => {
    it('counts servable models only', () => {
        expect(answering(checked('TE-GW', 4, 3))).toBe(3);
    });
});
