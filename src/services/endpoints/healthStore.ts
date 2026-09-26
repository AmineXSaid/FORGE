/**
 * The endpoint health record, and the rules that read it.
 *
 * Split from `health.ts`, which owns the sweeping, for one concrete reason:
 * `endpointService.ts` has to read verdicts (`servedModels` filters the
 * gateway's listing through them) and `health.ts` has to read profiles and
 * secrets from `endpointService.ts`. Importing both ways closes a cycle, and a
 * cycle through a file with a DI decorator in it does not fail politely -- the
 * decorator evaluates as `undefined` and every spec that touches the endpoint
 * layer dies with "decorator is not a function". So everything pure lives here,
 * where both sides can import it and neither imports the other.
 *
 * Nothing in this file touches the network, `vscode`, or the DI container.
 *
 * Endpoint health: what this machine measured, per profile, per model.
 *
 * `check.ts` already knows how to ask the question -- `keepServable` sends one
 * real `max_tokens: 4` completion per candidate and reports what came back.
 * Until now nothing kept the answer, so it was asked interactively, read once
 * and thrown away, while the model picker went on trusting `/v1/models`.
 *
 * That gap is not small. Of 101 ids one NVIDIA account listed, 28 answered, 60
 * returned 404, 10 accepted the request and never replied, and 3 errored -- so
 * a picker built on the listing is worse than a free-text field, because it
 * looks authoritative while being wrong two times in three. This file is the
 * memory that turns those measurements into something the picker, the settings
 * table and the welcome gate can all read.
 *
 * Three rules shape everything here:
 *
 * 1. **One prober.** Nothing in this file sends a completion of its own; it
 *    calls `keepServable`. The `endpointModelRows` comment in `handlers.ts` is
 *    about exactly this class of bug -- two copies of a rule drift, and the
 *    interactive "List models" command and the background sweep disagreeing
 *    about what "servable" means would be unfalsifiable from the UI.
 * 2. **A sweep costs real money.** Every probe is a billable completion on a
 *    paid endpoint. Hence the candidate cap, the default interval, the
 *    "only if it is due" check on activation, and the fact that the setting
 *    says all of this out loud.
 * 3. **A failed sweep must not strand the user.** A sweep that cannot start
 *    records why and leaves the previous verdicts alone. Blanking them on a
 *    DNS blip would empty the picker, which is the failure the endpoints line
 *    already fixed once.
 */
import type { EndpointProfile } from './profile';
import { isLoopback } from './urls';
import type { EndpointHealth, ModelHealth } from '../../shared/messages';

export type { EndpointHealth, ModelHealth };

/** `globalState` key, in the `forge.` namespace the rest of Forge's state uses. */
export const ENDPOINT_HEALTH_KEY = 'forge.endpointHealth';

/**
 * How many model verdicts are kept per profile.
 *
 * A bound rather than a budget: an aggregating gateway can list thousands of
 * ids, and `globalState` is a JSON blob rewritten whole on every update.
 */
export const MAX_STORED_MODELS = 500;

/** `probeOne` already truncates to this; the store refuses to grow it back. */
export const MAX_DETAIL_CHARS = 160;

/**
 * How many ids one sweep probes.
 *
 * `keepServable`'s own doc says to cap this, and the reason is money: 101 ids
 * is 101 completions. Sixty is about a minute at the background concurrency and
 * covers every endpoint that serves a human-sized menu; the ids the profile
 * actually names are probed first, so raising it never changes whether the
 * model you use is verified, only how much of the long tail is.
 */
export const DEFAULT_CANDIDATE_CAP = 60;

/** Parallel probes. A background sweep is gentler than one the user asked for. */
export const BACKGROUND_CONCURRENCY = 2;
export const INTERACTIVE_CONCURRENCY = 4;

/** `keepServable`'s own default: past this, a model is treated as unusable. */
export const PROBE_TIMEOUT_MS = 20_000;

/**
 * How long a check the user is waiting on gives a remote model to answer.
 *
 * "The check must be fast for UX" (the user, 2026-09-26): the welcome page and
 * the Settings table sit on "Checking…" until every probe has an answer, and a
 * model that is listed but never replies used to hold them there for the full
 * 20s. A remote model that cannot return four tokens in 10s is not one to
 * pick. Scheduled checks keep 20s, since nobody is waiting on them.
 */
export const INTERACTIVE_PROBE_TIMEOUT_MS = 10_000;

/**
 * How many endpoints are checked at once.
 *
 * Each check is one four-token request, so running them side by side costs
 * nothing extra; it only stops one slow endpoint from making the user wait
 * for all the others behind it. The cap bounds open sockets, not spend.
 */
export const SWEEP_PARALLELISM = 6;

/**
 * The answer deadline for one probe.
 *
 * A local runtime is the exception to the short deadline: it loads the model
 * from disk on the first request, which can take longer than 10s for a large
 * one, and it refuses at once when it is not running, so waiting costs nothing
 * when it is down.
 */
export function probeTimeoutFor(baseUrl: string, background: boolean): number {
    return background || isLoopback(baseUrl) ? PROBE_TIMEOUT_MS : INTERACTIVE_PROBE_TIMEOUT_MS;
}

/**
 * `run` over `items`, at most `limit` at a time, results in input order.
 * One item failing does not stop the others: `run` is expected not to throw.
 */
export async function inParallel<T, R>(
    items: readonly T[],
    limit: number,
    run: (item: T) => Promise<R>,
): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    const worker = async (): Promise<void> => {
        while (next < items.length) {
            const index = next++;
            out[index] = await run(items[index]!);
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
    return out;
}

/**
 * The setting, and its default. `0` disables the timer entirely.
 *
 * Five minutes (the user's request, 2026-09-25): the model picker lists only
 * the pairs that answered, so a verdict an hour old is an hour in which a dead
 * model stays offered or a recovered one stays hidden. One check is one
 * `max_tokens: 4` completion per endpoint, so this is twelve tiny requests an
 * hour per endpoint.
 */
export const SYNC_INTERVAL_SETTING = 'endpointHealth.syncIntervalMinutes';
export const DEFAULT_SYNC_INTERVAL_MINUTES = 5;

/**
 * How early a check counts as due. A check is dated when it *finishes*, a few
 * seconds after the tick that started it (up to `PROBE_TIMEOUT_MS`), so on
 * the next tick it is a few seconds short of one interval old. Without this
 * slack every other tick skipped it, and a 5-minute setting checked every 10.
 */
export const SYNC_DUE_SLACK_MS = PROBE_TIMEOUT_MS + 10_000;

/**
 * Whether a profile last checked at `lastSyncedAt` is due at `now`, with the
 * timer set to `minutes`. Never checked is always due; `0` minutes is never
 * due (the timer is off). The slack is capped at half the interval, so a very
 * short interval still waits between checks.
 */
export function isSweepDue(lastSyncedAt: number | undefined, now: number, minutes: number): boolean {
    if (!(minutes > 0)) return false;
    if (lastSyncedAt === undefined) return true;
    const interval = minutes * 60_000;
    return now - lastSyncedAt >= interval - Math.min(SYNC_DUE_SLACK_MS, interval / 2);
}

/**
 * What a profile has to keep pointing at for its verdicts to still apply.
 *
 * Keyed on name, because that is what the user selects and what every other
 * surface says. But a name is not an identity: editing `baseUrl` under the same
 * name points the profile at a different gateway, and inheriting the old one's
 * verdicts would claim to have measured something never measured. Cheap on
 * purpose -- it is compared, never parsed.
 */
export function fingerprintOf(profile: EndpointProfile): string {
    return JSON.stringify([profile.baseUrl, profile.wire, profile.model, profile.chatPath ?? '']);
}

/** The stored shape: the wire record plus the fingerprint it was measured under. */
export interface StoredEndpointHealth extends EndpointHealth {
    fingerprint: string;
}

/** The `Memento` surface this store needs, as `archivedSessions.ts` does it. */
export interface EndpointHealthMemento {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

/** Keep only what belongs in storage, and within the bounds. */
function sanitise(entry: StoredEndpointHealth): StoredEndpointHealth {
    const models: ModelHealth[] = [];
    for (const model of entry.models ?? []) {
        if (typeof model?.id !== 'string' || !model.id) continue;
        if (models.length >= MAX_STORED_MODELS) break;
        models.push({
            id: model.id,
            servable: model.servable === true,
            ms: Number.isFinite(model.ms) ? model.ms : 0,
            checkedAt: Number.isFinite(model.checkedAt) ? model.checkedAt : Date.now(),
            ...(model.detail ? { detail: String(model.detail).slice(0, MAX_DETAIL_CHARS) } : {}),
        });
    }
    return {
        profileName: entry.profileName,
        fingerprint: entry.fingerprint,
        listed: Number.isFinite(entry.listed) ? entry.listed : models.length,
        models,
        ...(entry.lastSyncedAt !== undefined ? { lastSyncedAt: entry.lastSyncedAt } : {}),
        ...(entry.error ? { error: String(entry.error).slice(0, MAX_DETAIL_CHARS) } : {}),
    };
}

/**
 * The persisted verdicts.
 *
 * Free of `vscode` so the specs drive it with a Map, and free of I/O so
 * `servedModels` and the picker can read it on the handshake path without
 * costing anything. `globalState` rather than a synced key on purpose: a health
 * verdict is a statement about reachability *from this machine*, and carrying
 * "nothing answered" from a laptop behind a corporate proxy to a desktop that
 * can reach the gateway fine would be worse than having no record at all.
 */
export class EndpointHealthStore {
    constructor(private readonly memento: EndpointHealthMemento) {}

    private read(): StoredEndpointHealth[] {
        const stored = this.memento.get<unknown>(ENDPOINT_HEALTH_KEY);
        if (!Array.isArray(stored)) return [];
        return stored
            .filter(
                (entry): entry is StoredEndpointHealth =>
                    !!entry &&
                    typeof entry === 'object' &&
                    typeof (entry as StoredEndpointHealth).profileName === 'string' &&
                    Array.isArray((entry as StoredEndpointHealth).models),
            )
            .map(sanitise);
    }

    /** Every entry, whatever profile it names. */
    all(): StoredEndpointHealth[] {
        return this.read();
    }

    /**
     * One profile's verdicts.
     *
     * `fingerprint` is the invalidation: pass the current profile's and an
     * entry measured against a different gateway answers `undefined`, exactly
     * as a profile that was never swept does.
     */
    get(profileName: string, fingerprint?: string): StoredEndpointHealth | undefined {
        const entry = this.read().find((e) => e.profileName === profileName);
        if (!entry) return undefined;
        if (fingerprint !== undefined && entry.fingerprint !== fingerprint) return undefined;
        return entry;
    }

    /** Replace one profile's entry, leaving the others untouched. */
    async write(entry: StoredEndpointHealth): Promise<void> {
        const rest = this.read().filter((e) => e.profileName !== entry.profileName);
        await this.memento.update(ENDPOINT_HEALTH_KEY, [...rest, sanitise(entry)]);
    }

    /**
     * Drop entries for profiles that no longer exist.
     *
     * A renamed or deleted profile leaves a record naming nothing, and a record
     * naming nothing is a row in the settings table for an endpoint the user
     * cannot see anywhere else.
     */
    async prune(knownNames: readonly string[]): Promise<void> {
        const known = new Set(knownNames);
        const current = this.read();
        const kept = current.filter((e) => known.has(e.profileName));
        if (kept.length === current.length) return;
        await this.memento.update(ENDPOINT_HEALTH_KEY, kept);
    }
}

/**
 * Which ids survive the stored verdicts. **The one filter rule.**
 *
 * Both callers -- `servedModels`, which turns the gateway's listing into
 * candidates, and `endpointModelRows`, which turns candidates into picker rows
 * -- come through here, so there is exactly one answer to "is this model
 * offered" no matter which path reached the question.
 *
 * The two modes differ because the inputs mean different things:
 *
 * - **A gateway listing** is a claim by an aggregator that it knows the name.
 *   Once a sweep has measured it, only what answered is offered; an unprobed
 *   id from beyond the candidate cap is not evidence of anything, and offering
 *   it would break the one promise this feature makes -- that a model in the
 *   picker replies when you type to it. The profile's own ids are probed first,
 *   so the cap never silently drops the model the user actually uses.
 * - **A declared `models` block** is the user naming what they want, often a
 *   handful out of hundreds. That stays authoritative: only an id that was
 *   probed *and failed* is dropped. Overruling a declaration on the strength of
 *   an id the sweep never reached would be the picker second-guessing the user.
 *
 * Neither mode ever empties a list because health is *unknown*: with no
 * completed sweep behind it, every candidate is returned untouched.
 */
export function keepHealthy(
    ids: readonly string[],
    health: EndpointHealth | undefined,
    options: { declared?: boolean } = {},
): { ids: string[]; reason: string } {
    if (!health?.lastSyncedAt) {
        return { ids: [...ids], reason: 'never swept, so the gateway listing is taken as-is' };
    }
    const verdicts = new Map(health.models.map((m) => [m.id, m]));
    if (options.declared) {
        const kept = ids.filter((id) => verdicts.get(id)?.servable !== false);
        return {
            ids: kept,
            reason: `declared block: ${ids.length - kept.length} of ${ids.length} dropped for failing a probe`,
        };
    }
    const kept = ids.filter((id) => verdicts.get(id)?.servable === true);
    return { ids: kept, reason: `swept: ${kept.length} of ${ids.length} answered a real request` };
}

/**
 * Which candidates to probe, and in what order.
 *
 * The ids the profile names come first -- its `model` field and any declared
 * `models` block -- so the cap can only ever cut into the long tail. A user
 * whose one model sits at position 300 of an alphabetical listing would
 * otherwise get a sweep that verified three hundred models they will never
 * pick and not the one they will.
 */
export function orderCandidates(
    profile: EndpointProfile,
    listed: readonly string[],
    cap: number = DEFAULT_CANDIDATE_CAP,
): string[] {
    const named = new Set<string>();
    if (profile.model) named.add(profile.model);
    for (const model of profile.models ?? []) named.add(model.id);

    const first = listed.filter((id) => named.has(id));
    // A profile naming a model the gateway does not list is still worth
    // probing: that is precisely the case where the listing is wrong.
    for (const id of named) if (!first.includes(id)) first.push(id);
    const rest = listed.filter((id) => !named.has(id));
    return [...first, ...rest].slice(0, Math.max(1, cap));
}

/** How many models answered, across every profile. What the welcome gate counts. */
export function healthyModelCount(health: readonly EndpointHealth[]): number {
    return health.reduce((total, entry) => total + entry.models.filter((m) => m.servable).length, 0);
}

/** How many profiles have a completed sweep behind them. */
export function checkedProfileCount(health: readonly EndpointHealth[]): number {
    return health.filter((entry) => entry.lastSyncedAt !== undefined).length;
}

/** Median round-trip over the servable models, for the settings table. */
export function medianPing(entry: EndpointHealth): number | undefined {
    const times = entry.models.filter((m) => m.servable).map((m) => m.ms).sort((a, b) => a - b);
    if (!times.length) return undefined;
    const mid = Math.floor(times.length / 2);
    return times.length % 2 ? times[mid] : Math.round((times[mid - 1] + times[mid]) / 2);
}

/**
 * The failure `detail` that came back most often.
 *
 * The loud empty state names it, because "0 of 101 healthy" is a symptom and
 * "Invalid API key" is the cause, and the cause is what the user can act on.
 */
export function commonestFailure(entry: EndpointHealth): string | undefined {
    const counts = new Map<string, number>();
    for (const model of entry.models) {
        if (model.servable || !model.detail) continue;
        counts.set(model.detail, (counts.get(model.detail) ?? 0) + 1);
    }
    let best: string | undefined;
    let bestCount = 0;
    for (const [detail, count] of counts) {
        if (count > bestCount) { best = detail; bestCount = count; }
    }
    return best;
}

