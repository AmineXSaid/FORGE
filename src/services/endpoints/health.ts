/**
 * Endpoint health: sweep the gateway, keep what answered.
 *
 * `check.ts` can already tell a listed model from a servable one. Nothing kept
 * the answer, so nothing could be shown, filtered on or refreshed, and the
 * picker went on offering every id the gateway named. This service is the
 * missing middle: it runs the sweep, stores the verdicts, and tells anyone
 * watching that they changed.
 *
 * The pure half lives in `healthStore.ts` and is re-exported here, so callers
 * see one module while the import graph stays acyclic. See that file for why.
 */
import * as vscode from 'vscode';
import { createDecorator } from '../../di/instantiation';
import { ILogService } from '../logService';
import { IEndpointService } from './endpointService';
import { listModels, keepServable, type ServableResult } from './check';
import type { EndpointProfile } from './profile';
import {
  HealthStore,
  fingerprintOf,
  mergeSweep,
  recordSweep,
  recordSweepFailure,
  type EndpointHealth,
  type HealthMemento,
} from './healthStore';

export * from './healthStore';

export const IEndpointHealthService =
  createDecorator<IEndpointHealthService>('endpointHealthService');

/**
 * How many listed ids one sweep will probe.
 *
 * Every probe is a billable completion, so this is a spending limit as much as
 * a time limit. Sixty is the measured shape of the problem: the NVIDIA account
 * in `keepServable`'s docstring listed 101 and served 28, and a cap below the
 * listing is why the UI reports `checked / listed` rather than pretending the
 * two are the same number.
 */
export const CANDIDATE_CAP = 60;

/** A background sweep is gentler than one the user is watching. */
export const BACKGROUND_CONCURRENCY = 2;
export const INTERACTIVE_CONCURRENCY = 4;

export interface SyncOptions {
  /** Cancels between probes and aborts the one in flight. */
  signal?: AbortSignal;
  /** Defaults to the background value; a button press passes the interactive one. */
  concurrency?: number;
  timeoutMs?: number;
  candidateCap?: number;
  /** Fires as each verdict lands, so a table can fill in rather than jump. */
  onProgress?: (progress: { profileName: string; checked: number; total: number }) => void;
}

export interface IEndpointHealthService {
  readonly _serviceBrand: undefined;

  /** Pure read, no I/O. Undefined when that profile has never been swept. */
  getHealth(profileName?: string): EndpointHealth | undefined;

  /** Every stored record, reconciled against the profiles that still exist. */
  getAllHealth(): EndpointHealth[];

  /** List, probe, store. Rejects a name no profile claims. */
  syncProfile(name: string, options?: SyncOptions): Promise<EndpointHealth>;

  syncAll(options?: SyncOptions): Promise<EndpointHealth[]>;

  /** Stop an in-flight sweep. All of them when no name is given. */
  cancelSync(profileName?: string): void;

  /** Sweep only the profiles whose last sweep has aged past the interval. */
  syncDue(): Promise<void>;

  /** Fires after any stored verdict changes, so open webviews can re-read. */
  readonly onDidChangeHealth: vscode.Event<void>;
}

/** The minimum of `ExtensionContext` this service needs, so specs can fake it. */
export interface HealthContext {
  globalState: HealthMemento;
}

export class EndpointHealthService implements IEndpointHealthService {
  readonly _serviceBrand: undefined;

  private readonly store: HealthStore;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeHealth = this.changed.event;

  /** One sweep per profile at a time; a second cancels the first. */
  private readonly running = new Map<string, AbortController>();

  constructor(
    context: HealthContext,
    @ILogService private readonly logService: ILogService,
    @IEndpointService private readonly endpoints: IEndpointService,
  ) {
    this.store = new HealthStore(context.globalState);
  }

  /** `forge.endpointHealth.syncIntervalMinutes`, 0 meaning "manual only". */
  private get intervalMinutes(): number {
    const raw = vscode.workspace
      .getConfiguration('forge')
      .get<number>('endpointHealth.syncIntervalMinutes', 60);
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : 60;
  }

  private get activeName(): string {
    return vscode.workspace.getConfiguration('forge').get<string>('endpointProfile', '')?.trim() ?? '';
  }

  /**
   * Secrets resolve from the environment, exactly as the relay resolves them.
   * A probe that authenticated differently from the real request would be
   * measuring something the user never sends.
   */
  private readonly secrets = (key: string): string | undefined => process.env[key];

  getHealth(profileName?: string): EndpointHealth | undefined {
    const name = profileName?.trim() || this.activeName;
    if (!name) return undefined;
    return this.store.get(name);
  }

  getAllHealth(): EndpointHealth[] {
    const { profiles } = this.endpoints.listProfiles();
    const live = new Map(profiles.map((p) => [p.name, fingerprintOf(p)]));
    // Read-side filtering as well as the write-side `reconcile`, so a stale
    // entry can never reach the UI even before the next sweep prunes it.
    return this.store.all().filter((h) => live.get(h.profileName) === h.fingerprint);
  }

  /**
   * B3: the webview names a profile, so the name is checked against the set the
   * host already knows before it reaches a transport. An unknown name is
   * rejected, never coerced into the active profile.
   */
  private resolve(name: string): EndpointProfile {
    const { profiles } = this.endpoints.listProfiles();
    const profile = profiles.find((p) => p.name === name);
    if (!profile) {
      throw new Error(`No endpoint profile named "${name}".`);
    }
    return profile;
  }

  async syncProfile(name: string, options: SyncOptions = {}): Promise<EndpointHealth> {
    const profile = this.resolve(name.trim());
    return this.sweep(profile, options);
  }

  async syncAll(options: SyncOptions = {}): Promise<EndpointHealth[]> {
    const { profiles } = this.endpoints.listProfiles();
    await this.store.reconcile(profiles);
    const out: EndpointHealth[] = [];
    // Serially across profiles: two gateways probed at once doubles the load on
    // a laptop's uplink and makes every ping in the table wrong.
    for (const profile of profiles) {
      if (options.signal?.aborted) break;
      out.push(await this.sweep(profile, options));
    }
    return out;
  }

  cancelSync(profileName?: string): void {
    const names = profileName ? [profileName] : [...this.running.keys()];
    for (const name of names) {
      this.running.get(name)?.abort();
      this.running.delete(name);
    }
  }

  async syncDue(): Promise<void> {
    const minutes = this.intervalMinutes;
    if (minutes === 0) {
      this.logService.info('[health] periodic sweeps are off (syncIntervalMinutes: 0)');
      return;
    }
    const cutoff = Date.now() - minutes * 60_000;
    const { profiles } = this.endpoints.listProfiles();
    await this.store.reconcile(profiles);
    for (const profile of profiles) {
      const stored = this.store.get(profile.name);
      if (stored?.lastSyncedAt !== undefined && stored.lastSyncedAt > cutoff) continue;
      await this.sweep(profile, {});
    }
  }

  private async sweep(profile: EndpointProfile, options: SyncOptions): Promise<EndpointHealth> {
    // A second sweep cancels the first rather than running beside it. Two
    // sweeps of one gateway race each other into the store and each makes the
    // other's pings meaningless.
    this.running.get(profile.name)?.abort();
    const controller = new AbortController();
    this.running.set(profile.name, controller);
    const signal = options.signal
      ? anySignal([options.signal, controller.signal])
      : controller.signal;

    const fingerprint = fingerprintOf(profile);
    const previous = this.store.get(profile.name);

    try {
      const listing = await listModels(profile, this.secrets);
      if (listing.error && listing.models.length === 0) {
        // No listing is not the same as no models: a gateway with no /models
        // route still serves the one the profile names.
        const fallback = profile.models?.length
          ? profile.models.map((m) => m.id)
          : [profile.model];
        return await this.probeAndStore(profile, fingerprint, {
          ids: fallback,
          listed: fallback.length,
          options,
          signal,
        });
      }

      const cap = options.candidateCap ?? CANDIDATE_CAP;
      const ids = orderCandidates(profile, listing.models.map((m) => m.id)).slice(0, cap);
      if (ids.length < listing.listed) {
        this.logService.info(
          `[health] sweeping "${profile.name}": probing ${ids.length} of ${listing.listed} listed id(s)`,
        );
      } else {
        this.logService.info(`[health] sweeping "${profile.name}": probing ${ids.length} id(s)`);
      }
      return await this.probeAndStore(profile, fingerprint, {
        ids,
        listed: listing.listed,
        options,
        signal,
      });
    } catch (e: any) {
      // The sweep never got off the ground. Keep the previous verdicts: a
      // transient failure must not empty the picker.
      const error = String(e?.message ?? e);
      this.logService.warn(`[health] sweep failed for "${profile.name}": ${error}`);
      const record = recordSweepFailure(previous, {
        profileName: profile.name,
        fingerprint,
        error,
      });
      await this.store.put(record);
      this.changed.fire();
      return record;
    } finally {
      if (this.running.get(profile.name) === controller) this.running.delete(profile.name);
    }
  }

  private async probeAndStore(
    profile: EndpointProfile,
    fingerprint: string,
    args: { ids: string[]; listed: number; options: SyncOptions; signal: AbortSignal },
  ): Promise<EndpointHealth> {
    const { ids, listed, options, signal } = args;
    let checked = 0;
    const results: ServableResult[] = await keepServable(profile, ids, this.secrets, {
      concurrency: options.concurrency ?? BACKGROUND_CONCURRENCY,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      signal,
      onResult: () => {
        checked += 1;
        options.onProgress?.({ profileName: profile.name, checked, total: ids.length });
      },
    });

    const swept = recordSweep({
      profileName: profile.name,
      fingerprint,
      listed,
      results,
      at: Date.now(),
    });
    // A cancelled sweep measured fewer ids than it planned to. Storing it as a
    // complete pass would delete the verdicts it never reached, so pressing
    // Cancel would shrink the picker.
    const record = signal.aborted
      ? mergeSweep(this.store.get(profile.name), swept)
      : swept;
    await this.store.put(record);
    const healthy = results.filter((r) => r.servable).length;
    this.logService.info(
      `[health] "${profile.name}": ${healthy} of ${results.length} probed answered (${listed} listed)`,
    );
    this.changed.fire();
    return record;
  }

  dispose(): void {
    this.cancelSync();
    this.changed.dispose();
  }
}

/**
 * Probe the ids the profile cares about first.
 *
 * With a cap in play the order decides what gets measured, and the model the
 * profile actually names must never be the one left unprobed.
 */
export function orderCandidates(profile: EndpointProfile, listed: readonly string[]): string[] {
  const named = new Set<string>([
    ...(profile.models ?? []).map((m) => m.id),
    ...(profile.model ? [profile.model] : []),
  ]);
  const first = listed.filter((id) => named.has(id));
  const rest = listed.filter((id) => !named.has(id));
  // A named model the gateway never listed is still worth probing: the listing
  // may be incomplete, and the user asked for it by name.
  const unlisted = [...named].filter((id) => !listed.includes(id));
  return [...first, ...unlisted, ...rest];
}

/** `AbortSignal.any`, spelled out for the Node versions that lack it. */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof any === 'function') return any(signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}
