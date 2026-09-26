/**
 * What the welcome page says about the endpoints once there are some.
 *
 * The page (2026-09-26, the "C · Summary" design the user chose on the design
 * canvas) replaces the old per-endpoint table with one large count, a bar and a
 * chip per endpoint. This is that summary, worked out from the host's health
 * rows, so the rules have a spec and the component only draws them.
 *
 * Every number comes from the rows: before the first check a profile has no
 * model count at all (`health.ts` reports `listed: 0, models: []`), so the
 * page counts endpoints, not models, until a check has run.
 */
import type { EndpointHealth } from '../../../shared/messages';

/** How a count, a bar segment or a chip reads. */
export type WelcomeTone = 'plain' | 'live' | 'dead' | 'ok';

export interface WelcomeCount {
    /** The large figure. */
    value: string;
    /** Set beside it, dimmer: " of 15", " endpoints". */
    unit: string;
    /** The line under it: "models answered". */
    label: string;
    tone: WelcomeTone;
}

export interface WelcomeSegment {
    /** Relative width: the endpoint's share of the models. */
    weight: number;
    /** 0..1: how much of it is checked, or answered. */
    fill: number;
    /** `hollow` is an endpoint nobody has checked yet. */
    kind: 'hollow' | 'live' | 'answered';
    /**
     * One tick per model, as the design draws it, or 0 for a continuous bar:
     * past `TICK_LIMIT` models in all, ticks are too thin to read.
     */
    ticks: number;
}

/** The most models the bar draws one tick each for (a 380px bar, 3px gaps). */
export const TICK_LIMIT = 40;

export interface WelcomeChip {
    name: string;
    status: string;
    tone: WelcomeTone;
    /** The reason, when a check could not reach the endpoint at all. */
    detail?: string;
}

export interface WelcomeSummary {
    count: WelcomeCount;
    segments: WelcomeSegment[];
    chips: WelcomeChip[];
}

/** Models on this endpoint that answered their probe. */
export function answering(row: EndpointHealth): number {
    return row.models.filter((m) => m.servable).length;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

function chipFor(row: EndpointHealth): WelcomeChip {
    const name = row.profileName;
    if (row.syncing) {
        return {
            name,
            status: row.total ? `checking ${row.checked ?? 0} of ${row.total}` : 'checking',
            tone: 'live',
        };
    }
    if (row.error) return { name, status: 'could not connect', tone: 'dead', detail: row.error };
    if (!row.lastSyncedAt) return { name, status: 'not checked', tone: 'plain' };
    const ok = answering(row);
    return { name, status: `${ok} of ${row.models.length}`, tone: ok > 0 ? 'ok' : 'dead' };
}

export function welcomeSummary(rows: readonly EndpointHealth[]): WelcomeSummary {
    const chips = rows.map(chipFor);
    const endpoints = ` ${plural(rows.length, 'endpoint', 'endpoints')}`;

    if (rows.some((row) => row.syncing)) {
        // A sweep in progress. Rows it has finished count as done, so the total
        // only grows as the host reports each profile's plan.
        let checked = 0;
        let total = 0;
        const plan = rows.map((row) => {
            const rowTotal = row.syncing ? row.total ?? 0 : row.models.length;
            const rowChecked = row.syncing ? Math.min(row.checked ?? 0, rowTotal) : rowTotal;
            checked += rowChecked;
            total += rowTotal;
            return { rowTotal, rowChecked };
        });
        const ticked = total <= TICK_LIMIT;
        const segments = plan.map(({ rowTotal, rowChecked }): WelcomeSegment => ({
            weight: Math.max(rowTotal, 1),
            fill: rowTotal ? rowChecked / rowTotal : 0,
            kind: 'live',
            ticks: ticked ? rowTotal : 0,
        }));
        const count: WelcomeCount = total > 0
            ? { value: String(checked), unit: ` of ${total}`, label: `${plural(total, 'model', 'models')} checked`, tone: 'live' }
            : { value: String(rows.length), unit: endpoints, label: 'being checked', tone: 'live' };
        return { count, segments, chips };
    }

    if (rows.every((row) => !row.lastSyncedAt)) {
        return {
            count: { value: String(rows.length), unit: endpoints, label: 'not checked yet', tone: 'plain' },
            segments: rows.map(() => ({ weight: 1, fill: 0, kind: 'hollow', ticks: 0 })),
            chips,
        };
    }

    let ok = 0;
    let probed = 0;
    for (const row of rows) {
        if (!row.lastSyncedAt) continue;
        ok += answering(row);
        probed += row.models.length;
    }
    const ticked = probed <= TICK_LIMIT;
    const segments = rows.map((row): WelcomeSegment => {
        if (!row.lastSyncedAt) return { weight: 1, fill: 0, kind: 'hollow', ticks: 0 };
        const n = row.models.length;
        return {
            weight: Math.max(n, 1),
            fill: n ? answering(row) / n : 0,
            kind: 'answered',
            ticks: ticked ? n : 0,
        };
    });
    return {
        count: {
            value: String(ok),
            unit: probed ? ` of ${probed}` : '',
            label: `${plural(probed, 'model', 'models')} answered`,
            tone: ok > 0 ? 'ok' : 'dead',
        },
        segments,
        chips,
    };
}
