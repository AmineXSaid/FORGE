/**
 * Sweeping an endpoint: list its models, ask each one to serve, store what did.
 *
 * The record itself and every rule that reads it live in `healthStore.ts`,
 * which is pure. This file is the part that needs `vscode`, the DI container
 * and the network, and it is re-exported through here so callers have one
 * import to reach for.
 */
import * as vscode from 'vscode';
import { createDecorator } from '../../di/instantiation';
import { ILogService } from '../logService';
import { IEndpointService } from './endpointService';
import { PROBE_CONNECT_TIMEOUT_MS, keepServable, type ServableResult } from './check';
import type { EndpointProfile } from './profile';
import type { EndpointHealth } from '../../shared/messages';
import {
    DEFAULT_SYNC_INTERVAL_MINUTES,
    EndpointHealthStore,
    MAX_DETAIL_CHARS,
    MAX_STORED_MODELS,
    SWEEP_PARALLELISM,
    SYNC_INTERVAL_SETTING,
    fingerprintOf,
    inParallel,
    isSweepDue,
    probeTimeoutFor,
    type EndpointHealthMemento,
    type StoredEndpointHealth,
} from './healthStore';

/**
 * Everything the store knows, re-exported.
 *
 * Callers should not have to know which half of the feature a symbol lives in,
 * and the split exists for a module-cycle reason, not a conceptual one.
 */
export * from './healthStore';

/** Parallel probes. A background sweep is gentler than one the user asked for. */
export const BACKGROUND_CONCURRENCY = 2;
export const INTERACTIVE_CONCURRENCY = 4;

/** `keepServable`'s own default: past this, a model is treated as unusable. */
export const PROBE_TIMEOUT_MS = 20_000;

export interface SyncOptions {
    /** Gentler concurrency and no user waiting on it. */
    background?: boolean;
    /** Overrides `DEFAULT_CANDIDATE_CAP`. */
    candidateCap?: number;
    concurrency?: number;
    timeoutMs?: number;
    /** Cancels this sweep. A second sync for the same profile cancels the first. */
    signal?: AbortSignal;
}

export const IEndpointHealthService = createDecorator<IEndpointHealthService>('endpointHealthService');

export interface IEndpointHealthService {
    readonly _serviceBrand: undefined;

    /** A pure read of the stored verdicts. No I/O, safe on the handshake path. */
    getHealth(profileName?: string): EndpointHealth | undefined;

    /** Every profile that currently exists, whether or not it has been swept. */
    getAllHealth(): EndpointHealth[];

    /** List, probe, store. Never throws for a sweep that failed -- see `error`. */
    syncProfile(profileName: string, options?: SyncOptions): Promise<EndpointHealth>;

    /** Every profile in turn. */
    syncAll(options?: SyncOptions): Promise<EndpointHealth[]>;

    /** Stop the sweep for one profile, or every sweep when no name is given. */
    cancelSync(profileName?: string): void;

    /** Fires on every stored change and on sweep progress. */
    readonly onDidChangeHealth: vscode.Event<void>;

    /** Start the interval timer and the settings watchers. */
    activate(): vscode.Disposable;
}

export class EndpointHealthService implements IEndpointHealthService {
    readonly _serviceBrand: undefined;

    private readonly store: EndpointHealthStore;
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChangeHealth = this.changed.event;

    /** Sweeps in flight, by profile name. One per profile, ever. */
    private readonly running = new Map<
        string,
        { controller: AbortController; checked: number; total: number; done: Promise<unknown> }
    >();

    private timer?: ReturnType<typeof setInterval>;

    constructor(
        private readonly context: vscode.ExtensionContext | undefined,
        @ILogService private readonly logService: ILogService,
        @IEndpointService private readonly endpointService: IEndpointService,
    ) {
        this.store = new EndpointHealthStore(
            context?.globalState ?? new MemoryMemento(),
        );
    }

    private profile(profileName: string): EndpointProfile | undefined {
        return this.endpointService.listProfiles().profiles.find((p) => p.name === profileName);
    }

    getHealth(profileName?: string): EndpointHealth | undefined {
        const name = profileName?.trim();
        if (!name) return undefined;
        const profile = this.profile(name);
        // No such profile: nothing to report, rather than a record for a name
        // the rest of the UI cannot show.
        if (!profile) return undefined;
        return this.decorate(this.store.get(name, fingerprintOf(profile)) ?? blank(name));
    }

    getAllHealth(): EndpointHealth[] {
        const { profiles } = this.endpointService.listProfiles();
        return profiles.map((profile) =>
            this.decorate(this.store.get(profile.name, fingerprintOf(profile)) ?? blank(profile.name)),
        );
    }

    /** The stored record plus the two things only the live host knows. */
    private decorate(entry: EndpointHealth): EndpointHealth {
        const active = this.endpointService.getStatus().profile?.name === entry.profileName;
        return this.withProgress(active ? { ...entry, active: true } : entry);
    }

    /** Overlay the live sweep counters, which are runtime state and never stored. */
    private withProgress(entry: EndpointHealth): EndpointHealth {
        const live = this.running.get(entry.profileName);
        if (!live) return entry;
        return { ...entry, syncing: true, checked: live.checked, total: live.total };
    }

    cancelSync(profileName?: string): void {
        for (const [name, live] of this.running) {
            if (profileName && name !== profileName) continue;
            this.logService.info(`[health] cancelling the sweep for "${name}"`);
            live.controller.abort();
        }
    }

    async syncProfile(profileName: string, options: SyncOptions = {}): Promise<EndpointHealth> {
        const name = profileName?.trim();
        const profile = name ? this.profile(name) : undefined;
        // B3: an unknown name is rejected, not coerced. This is the last gate
        // before a name chosen upstream reaches a transport.
        if (!profile) throw new Error(`Unknown endpoint profile: ${String(profileName)}`);

        // One sweep per profile at a time, and a second one wins: the user
        // pressing Sync after changing something means the run already going is
        // measuring the old thing.
        const existing = this.running.get(profile.name);
        if (existing) {
            existing.controller.abort();
            await existing.done.catch(() => {});
        }

        const controller = new AbortController();
        if (options.signal) {
            if (options.signal.aborted) controller.abort();
            else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
        }

        const run = this.sweep(profile, controller, options);
        this.running.set(profile.name, { controller, checked: 0, total: 0, done: run });
        this.changed.fire();
        try {
            return await run;
        } finally {
            if (this.running.get(profile.name)?.controller === controller) {
                this.running.delete(profile.name);
            }
            this.changed.fire();
        }
    }

    /**
     * The sweep itself. It does not reject: every failure becomes an `error`
     * on the record beside whatever verdicts were already there.
     */
    private async sweep(
        profile: EndpointProfile,
        controller: AbortController,
        options: SyncOptions,
    ): Promise<EndpointHealth> {
        const fingerprint = fingerprintOf(profile);
        const previous = this.store.get(profile.name, fingerprint);
        const started = Date.now();

        const fail = async (error: string): Promise<EndpointHealth> => {
            // Previous verdicts stay. A transient DNS failure must not empty
            // the picker, and "I could not ask" is a different statement from
            // "I asked and nothing answered".
            this.logService.warn(`[health] sweep of "${profile.name}" could not run: ${error}`);
            const entry: StoredEndpointHealth = {
                ...(previous ?? blank(profile.name)),
                profileName: profile.name,
                fingerprint,
                error,
            };
            await this.persist(entry);
            return entry;
        };

        let secrets: (key: string) => string | undefined;
        try {
            secrets = await this.endpointService.secretsFor(profile);
        } catch (e) {
            return fail(message(e));
        }

        // An endpoint and its model are one entry (2026-09-23), so the sweep
        // asks one question: does *this* model answer here? It used to list
        // the gateway and probe up to 60 ids per profile -- sixty completions
        // an hour, per endpoint, to rank models nobody picks from any more.
        // One tiny request per endpoint now, and no listing.
        if (controller.signal.aborted) return this.cancelled(profile, fingerprint, previous);
        const candidates = [profile.model];
        const listed = 1;

        const live = this.running.get(profile.name);
        if (live) { live.total = candidates.length; live.checked = 0; }
        this.changed.fire();

        this.logService.info(
            `[health] sweeping "${profile.name}": probing ${candidates.length} of ${listed} listed id(s)`,
        );

        let results: ServableResult[];
        try {
            results = await keepServable(profile, candidates, secrets, {
                concurrency:
                    options.concurrency ??
                    (options.background ? BACKGROUND_CONCURRENCY : INTERACTIVE_CONCURRENCY),
                timeoutMs: options.timeoutMs ?? probeTimeoutFor(profile.baseUrl, !!options.background),
                connectTimeoutMs: PROBE_CONNECT_TIMEOUT_MS,
                signal: controller.signal,
                onResult: () => {
                    const entry = this.running.get(profile.name);
                    if (entry?.controller === controller) {
                        entry.checked += 1;
                        this.changed.fire();
                    }
                },
            });
        } catch (e) {
            return fail(message(e));
        }

        if (controller.signal.aborted) {
            return this.cancelled(profile, fingerprint, previous, results);
        }

        // `keepServable`'s auth-failure path answers one identical, instant
        // verdict per candidate rather than sending anything. Nothing reached
        // the network, so this is a sweep that failed -- recording it as "every
        // model is dead" would let one expired token empty the picker.
        if (results.length > 0 && results.every((r) => !r.servable && r.ms === 0)) {
            return fail(results[0].detail ?? 'the endpoint refused every request');
        }

        const checkedAt = Date.now();
        const entry: StoredEndpointHealth = {
            profileName: profile.name,
            fingerprint,
            lastSyncedAt: checkedAt,
            listed,
            models: results.map((r) => ({
                id: r.id,
                servable: r.servable,
                ms: r.ms,
                checkedAt,
                ...(r.detail ? { detail: r.detail.slice(0, MAX_DETAIL_CHARS) } : {}),
            })),
        };

        const healthy = entry.models.filter((m) => m.servable).length;
        this.logService.info(
            `[health] "${profile.name}": ${healthy} of ${entry.models.length} probed id(s) answered ` +
            `(${listed} listed) in ${Date.now() - started}ms`,
        );
        await this.persist(entry);
        return entry;
    }

    /**
     * A cancelled sweep keeps what it had, and keeps what it learned.
     *
     * Two halves. The verdicts it never reached survive untouched, because a
     * cancelled sweep is not a verdict about them -- storing the partial pass
     * as a complete one would delete them and shrink the model picker, which is
     * the opposite of what Cancel should do.
     *
     * But the ids it *did* probe were genuinely measured, and `keepServable`
     * returns them for exactly this reason: "a cancelled sweep that answered
     * for forty ids knows forty things, and throwing them away would make
     * Cancel cost the user those completions twice". They are billable
     * completions already spent. So they are merged over the previous record,
     * newest winning per id.
     *
     * `lastSyncedAt` stays at the previous sweep's time on purpose. This is not
     * a completed pass, and dating it now would make the next `syncDue` skip
     * this profile for a whole interval on the strength of a sweep the user
     * stopped.
     */
    private async cancelled(
        profile: EndpointProfile,
        fingerprint: string,
        previous: StoredEndpointHealth | undefined,
        partial: readonly ServableResult[] = [],
    ): Promise<EndpointHealth> {
        const base = previous ?? { ...blank(profile.name), fingerprint };
        const measured = partial.filter((r) => r.ms > 0 || r.servable);
        this.logService.info(
            `[health] sweep of "${profile.name}" was cancelled` +
            (measured.length ? `, keeping ${measured.length} verdict(s) it had already measured` : ''),
        );
        if (measured.length === 0) return base;

        const checkedAt = Date.now();
        const byId = new Map(base.models.map((m) => [m.id, m]));
        for (const r of measured) {
            byId.set(r.id, {
                id: r.id,
                servable: r.servable,
                ms: r.ms,
                checkedAt,
                ...(r.detail ? { detail: r.detail.slice(0, MAX_DETAIL_CHARS) } : {}),
            });
        }
        const entry: StoredEndpointHealth = {
            ...base,
            fingerprint,
            models: [...byId.values()].slice(0, MAX_STORED_MODELS),
        };
        await this.persist(entry);
        return entry;
    }

    private async persist(entry: StoredEndpointHealth): Promise<void> {
        try {
            await this.store.write(entry);
            await this.store.prune(this.endpointService.listProfiles().profiles.map((p) => p.name));
        } catch (e) {
            // Storage failing is not worth taking a sweep down over; the
            // verdicts are still returned to whoever asked for them.
            this.logService.warn(`[health] could not store the verdicts: ${message(e)}`);
        }
        this.changed.fire();
    }

    async syncAll(options: SyncOptions = {}): Promise<EndpointHealth[]> {
        const { profiles } = this.endpointService.listProfiles();
        // Side by side, so the check takes as long as the slowest endpoint
        // rather than all of them in a row. Running them one at a time made
        // sense when a sweep probed up to sixty ids and parallel sweeps
        // multiplied the spend; a sweep is one four-token request now, so
        // the order changes only how long the user waits. Each endpoint's
        // verdict is pushed as it lands: the first one that answers lifts the
        // welcome page without waiting on the rest.
        const out = await inParallel(profiles, SWEEP_PARALLELISM, async (profile) => {
            if (options.signal?.aborted) return undefined;
            try {
                return await this.syncProfile(profile.name, options);
            } catch (e) {
                this.logService.warn(`[health] could not sweep "${profile.name}": ${message(e)}`);
                return undefined;
            }
        });
        return out.filter((entry): entry is EndpointHealth => entry !== undefined);
    }

    // ------------------------------------------------------------------------
    // Part C: the timer
    // ------------------------------------------------------------------------

    private get intervalMinutes(): number {
        const raw = vscode.workspace
            .getConfiguration('forge')
            .get<number>(SYNC_INTERVAL_SETTING, DEFAULT_SYNC_INTERVAL_MINUTES);
        return Number.isFinite(raw) && raw! >= 0 ? Number(raw) : DEFAULT_SYNC_INTERVAL_MINUTES;
    }

    /**
     * Sweep the profiles whose last sweep is older than the interval.
     *
     * Never on a schedule of its own at activation: startup must stay fast, and
     * the welcome gate reads the *stored* verdict rather than waiting on a live
     * probe, so there is nothing for activation to block on.
     */
    /** The sweep `syncDue` is running, and whether another was asked for meanwhile. */
    private dueRun?: Promise<void>;
    private dueAgain = false;

    /**
     * One scheduled pass at a time. The setup flow writes two settings a
     * moment apart, and each change asked for a pass: the second aborted the
     * first mid-probe and started over, which billed the same completions
     * twice. A request that arrives during a pass now runs once, after it.
     */
    private syncDue(): Promise<void> {
        if (this.dueRun) {
            this.dueAgain = true;
            return this.dueRun;
        }
        this.dueRun = (async () => {
            try {
                do {
                    this.dueAgain = false;
                    await this.syncDueOnce();
                } while (this.dueAgain);
            } finally {
                this.dueRun = undefined;
            }
        })();
        return this.dueRun;
    }

    private async syncDueOnce(): Promise<void> {
        const minutes = this.intervalMinutes;
        if (minutes <= 0) return;
        const { profiles } = this.endpointService.listProfiles();
        const now = Date.now();
        const due = profiles.filter((profile) =>
            isSweepDue(this.store.get(profile.name, fingerprintOf(profile))?.lastSyncedAt, now, minutes),
        );
        // Side by side, as `syncAll`: a new endpoint the user just set up is
        // checked here, and the welcome page is waiting on it.
        await inParallel(due, SWEEP_PARALLELISM, async (profile) => {
            try {
                await this.syncProfile(profile.name, { background: true });
            } catch (e) {
                this.logService.warn(`[health] scheduled sweep of "${profile.name}" failed: ${message(e)}`);
            }
        });
    }

    activate(): vscode.Disposable {
        const restartTimer = (): void => {
            if (this.timer) clearInterval(this.timer);
            this.timer = undefined;
            const minutes = this.intervalMinutes;
            if (minutes <= 0) {
                this.logService.info('[health] periodic sweeps are off (syncIntervalMinutes: 0)');
                return;
            }
            this.timer = setInterval(() => void this.syncDue(), minutes * 60_000);
        };

        restartTimer();
        // Not awaited: activation never waits on the network.
        void this.syncDue();

        const watcher = vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration(`forge.${SYNC_INTERVAL_SETTING}`)) {
                restartTimer();
                return;
            }
            // A profile that changed may point somewhere else entirely, and the
            // fingerprint has already invalidated its verdicts -- so re-measure
            // rather than leave the table blank until the next tick.
            // Only the profiles themselves: choosing which one is in use
            // changes no fingerprint, so there is nothing new to measure.
            if (e.affectsConfiguration('forge.endpoints')) {
                this.logService.info('[health] endpoint settings changed; re-sweeping');
                void this.syncDue();
            }
        });

        return {
            dispose: () => {
                if (this.timer) clearInterval(this.timer);
                this.timer = undefined;
                this.cancelSync();
                watcher.dispose();
                this.changed.dispose();
            },
        };
    }
}

/** A profile with no record yet: known, never measured. */
function blank(profileName: string): StoredEndpointHealth {
    return { profileName, fingerprint: '', listed: 0, models: [] };
}

function message(e: unknown): string {
    return (e instanceof Error ? e.message : String(e)).slice(0, MAX_DETAIL_CHARS);
}

/** For the handful of code paths that build the service without an extension context. */
class MemoryMemento implements EndpointHealthMemento {
    private readonly entries = new Map<string, unknown>();
    get<T>(key: string): T | undefined {
        return this.entries.get(key) as T | undefined;
    }
    async update(key: string, value: unknown): Promise<void> {
        this.entries.set(key, value);
    }
}
