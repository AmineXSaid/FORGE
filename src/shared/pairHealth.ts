/**
 * Whether an endpoint's model answers, as the model picker reads it.
 *
 * One rule, shared by the host (which builds the picker's rows and the welcome
 * gate's counts) and the webview (which draws the ping and the refresh), so
 * the two can never disagree about which pairs are offered.
 *
 * The picker offers what answers (the user's request, 2026-09-25): a pair
 * whose model failed its last check, or whose last check could not even be
 * sent, is left out of the list. The one exception is the pair in use, which
 * stays as a greyed row with the reason, so the user can see why their chat
 * fails and refresh.
 *
 * A pair that has never been checked stays in the list. "Not measured" is not
 * "did not answer": right after an endpoint is added, or with the periodic
 * check turned off, hiding unmeasured pairs would empty the picker.
 */
import type { EndpointHealth } from './messages';

/**
 * The state of one pair's last check.
 *
 * - `answered`: the model replied to a real request, in `ms`.
 * - `failed`: the request was sent and the model did not reply (`detail` says why).
 * - `unreachable`: the last check could not be sent at all (auth, DNS, TLS).
 *   Treated like `failed`: a model the host cannot reach cannot answer a chat either.
 * - `checking`: the first check is running now.
 * - `unchecked`: never measured.
 */
export type PairCheckState = 'answered' | 'failed' | 'unreachable' | 'checking' | 'unchecked';

/** What a picker row carries about its pair's last check. */
export interface PairCheck {
    state: PairCheckState;
    /** Round-trip of the check, ms. Only when `answered`. */
    ms?: number;
    /** Epoch ms of the verdict. Absent for `checking`, `unchecked` and `unreachable`. */
    checkedAt?: number;
    /** Why not. For `failed` and `unreachable`. */
    detail?: string;
    /** A check is running right now; the verdict above is the previous one. */
    syncing?: boolean;
}

/** The part of a health record the rule reads. */
export type PairHealthInput = Pick<EndpointHealth, 'error' | 'models'> & Partial<Pick<EndpointHealth, 'syncing'>>;

/**
 * The state of `model`'s last check on one endpoint.
 *
 * `error` wins over a stored verdict: it is set by the most recent attempt
 * (a completed check clears it), so a model that answered an hour ago but
 * whose key has since been refused does not answer now.
 */
export function pairCheck(model: string, health: PairHealthInput | undefined): PairCheck {
    const syncing = health?.syncing ? { syncing: true } : {};
    if (health?.error) return { state: 'unreachable', detail: health.error, ...syncing };
    const verdict = health?.models.find((m) => m.id === model);
    if (verdict?.servable) return { state: 'answered', ms: verdict.ms, checkedAt: verdict.checkedAt, ...syncing };
    if (verdict) {
        return { state: 'failed', detail: verdict.detail ?? 'no reply', checkedAt: verdict.checkedAt, ...syncing };
    }
    return health?.syncing ? { state: 'checking', syncing: true } : { state: 'unchecked' };
}

/** Whether the picker offers the pair: it answered, or it has not been measured yet. */
export function isOffered(check: PairCheck): boolean {
    return check.state === 'answered' || check.state === 'checking' || check.state === 'unchecked';
}

/**
 * How many models answered their last check, across every endpoint.
 *
 * The welcome gate's "anything healthy?" count. An endpoint whose last check
 * could not be sent contributes nothing, whatever it answered before, which
 * is the same rule `pairCheck` applies to the picker.
 */
export function answeringModelCount(health: readonly PairHealthInput[]): number {
    return health.reduce(
        (total, entry) => total + (entry.error ? 0 : entry.models.filter((m) => m.servable).length),
        0,
    );
}

/** "820ms", "1.4s": the ping as the picker shows it. */
export function pingText(ms: number): string {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.max(0, Math.round(ms))}ms`;
}

/**
 * How the ping chip is coloured, as Pajamas badge variants: `fast` is the
 * success badge, `fair` the neutral one, `slow` the warning one. A pair that
 * answers is never shown in the danger red, however slow: red is for failure,
 * and a failed pair is not in the list.
 */
export type PingTone = 'fast' | 'fair' | 'slow';
export const FAST_PING_MS = 1000;
export const SLOW_PING_MS = 3000;

export function pingTone(ms: number): PingTone {
    if (ms < FAST_PING_MS) return 'fast';
    if (ms < SLOW_PING_MS) return 'fair';
    return 'slow';
}

/** The status the picker writes after the endpoint and host, or nothing when it answered. */
export function pairStatusText(check: PairCheck): string {
    switch (check.state) {
        case 'answered':
            return '';
        case 'failed':
            return `did not answer: ${check.detail}`;
        case 'unreachable':
            return `could not be checked: ${check.detail}`;
        case 'checking':
            return 'checking…';
        case 'unchecked':
            return 'not checked yet';
    }
}
