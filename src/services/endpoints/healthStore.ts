/**
 * What answered, and what did not: the stored half of endpoint health.
 *
 * Everything here is pure, and nothing here imports `endpointService` or
 * `health`. That is not tidiness, it is a load-order constraint. The endpoint
 * service must read verdicts and the health service must read profiles, so the
 * two import each other; a cycle that passes through a file holding a
 * `createDecorator` call fails at import time as `decorator is not a function`,
 * taking every endpoint spec with it. The shared half lives here, which neither
 * side imports *from*, and `health.ts` re-exports it so callers see one module.
 *
 * Kept free of `vscode` so the specs can drive it with a Map, the same shape
 * `archivedSessions.ts` uses.
 */
import type { EndpointProfile } from './profile';
import type { ServableResult } from './check';

/** One model's verdict on one endpoint. */
export interface ModelHealth {
  id: string;
  servable: boolean;
  /** Round-trip of the probe completion, ms. */
  ms: number;
  /** Why not, when not. Already produced and truncated by `probeOne`. */
  detail?: string;
  /** Epoch ms of the probe that produced this. */
  checkedAt: number;
}

/** One endpoint's verdicts, plus what the last sweep managed to do. */
export interface EndpointHealth {
  profileName: string;
  /** Epoch ms of the last completed sweep. Undefined means never swept. */
  lastSyncedAt?: number;
  /** Set when the sweep could not start at all: auth, DNS, TLS, no route. */
  error?: string;
  /** How many ids the gateway listed, before probing. */
  listed: number;
  /**
   * A digest of the profile fields that decide what "this endpoint" means.
   * When it changes the verdicts are discarded rather than inherited.
   */
  fingerprint: string;
  models: ModelHealth[];
}

/** The `Memento` surface this store needs. */
export interface HealthMemento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

/**
 * Per machine, not synced. A health verdict is about *this* machine's
 * reachability -- its CA bundle, its proxy, its client certificate -- and must
 * not travel to another one that cannot reach the same gateway.
 */
export const ENDPOINT_HEALTH_KEY = 'forge.endpointHealth';

/**
 * How many model verdicts one profile may keep.
 *
 * An aggregating gateway can list thousands. The cap is on the *store*, not the
 * sweep, so a listing that grows past it cannot turn `globalState` into a
 * slowly growing file nobody ever looks at.
 */
export const MODELS_MAX = 500;

/** The longest `detail` the store will keep, matching `probeOne`. */
export const DETAIL_MAX = 160;

/**
 * What makes this endpoint *this* endpoint.
 *
 * Deliberately not the whole profile: editing a description or a timeout does
 * not change what the gateway will serve, and discarding a sweep over that
 * would cost the user a sweep's worth of completions for nothing.
 */
export function fingerprintOf(profile: EndpointProfile): string {
  return JSON.stringify([
    profile.baseUrl ?? '',
    profile.wire ?? '',
    profile.model ?? '',
    profile.chatPath ?? '',
  ]);
}

/** Drop junk from a stored record; anything malformed is treated as absent. */
function readOne(value: unknown): EndpointHealth | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.profileName !== 'string' || !raw.profileName) return undefined;
  const models: ModelHealth[] = Array.isArray(raw.models)
    ? raw.models.flatMap((m) => {
        if (!m || typeof m !== 'object') return [];
        const r = m as Record<string, unknown>;
        if (typeof r.id !== 'string' || !r.id) return [];
        return [
          {
            id: r.id,
            servable: r.servable === true,
            ms: typeof r.ms === 'number' && Number.isFinite(r.ms) ? r.ms : 0,
            ...(typeof r.detail === 'string' ? { detail: r.detail.slice(0, DETAIL_MAX) } : {}),
            checkedAt:
              typeof r.checkedAt === 'number' && Number.isFinite(r.checkedAt) ? r.checkedAt : 0,
          },
        ];
      })
    : [];
  return {
    profileName: raw.profileName,
    ...(typeof raw.lastSyncedAt === 'number' && Number.isFinite(raw.lastSyncedAt)
      ? { lastSyncedAt: raw.lastSyncedAt }
      : {}),
    ...(typeof raw.error === 'string' && raw.error ? { error: raw.error } : {}),
    listed: typeof raw.listed === 'number' && Number.isFinite(raw.listed) ? raw.listed : 0,
    fingerprint: typeof raw.fingerprint === 'string' ? raw.fingerprint : '',
    models: models.slice(0, MODELS_MAX),
  };
}

export class HealthStore {
  constructor(private readonly memento: HealthMemento) {}

  /** Every stored record, junk ignored. */
  all(): EndpointHealth[] {
    const stored = this.memento.get<unknown>(ENDPOINT_HEALTH_KEY);
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((entry) => {
      const one = readOne(entry);
      return one ? [one] : [];
    });
  }

  get(profileName: string): EndpointHealth | undefined {
    return this.all().find((h) => h.profileName === profileName);
  }

  async put(health: EndpointHealth): Promise<void> {
    const rest = this.all().filter((h) => h.profileName !== health.profileName);
    await this.memento.update(ENDPOINT_HEALTH_KEY, [
      ...rest,
      { ...health, models: health.models.slice(0, MODELS_MAX) },
    ]);
  }

  /**
   * Forget profiles that no longer exist, and profiles whose fingerprint moved.
   *
   * A profile repointed at a different gateway under the same name must not
   * inherit the old one's verdicts: the ids may be identical and the answers
   * completely different.
   */
  async reconcile(profiles: readonly EndpointProfile[]): Promise<EndpointHealth[]> {
    const live = new Map(profiles.map((p) => [p.name, fingerprintOf(p)]));
    const before = this.all();
    const after = before.filter((h) => live.get(h.profileName) === h.fingerprint);
    if (after.length !== before.length) await this.memento.update(ENDPOINT_HEALTH_KEY, after);
    return after;
  }
}

/** Fold a completed sweep into a record. */
export function recordSweep(args: {
  profileName: string;
  fingerprint: string;
  listed: number;
  results: readonly ServableResult[];
  at: number;
}): EndpointHealth {
  const { profileName, fingerprint, listed, results, at } = args;
  return {
    profileName,
    fingerprint,
    listed,
    lastSyncedAt: at,
    models: results.slice(0, MODELS_MAX).map((r) => ({
      id: r.id,
      servable: r.servable,
      ms: r.ms,
      ...(r.detail ? { detail: r.detail.slice(0, DETAIL_MAX) } : {}),
      checkedAt: at,
    })),
  };
}

/**
 * Fold a *partial* sweep into what was already known.
 *
 * A cancelled sweep is not a failed one: the ids it reached were genuinely
 * measured and are worth keeping, which is why `keepServable` returns them.
 * But it is not a complete picture either, and storing it as one would silently
 * delete the verdicts for every id the sweep never got to -- so pressing Cancel
 * would shrink the model picker. The fresh verdicts win where they exist; the
 * rest of the previous record survives underneath them.
 *
 * `lastSyncedAt` deliberately stays at the previous sweep's time. This record
 * does not describe a completed pass, and dating it now would make the next
 * `syncDue` skip the profile for a full interval on the strength of a sweep the
 * user stopped.
 */
export function mergeSweep(
  previous: EndpointHealth | undefined,
  partial: EndpointHealth,
): EndpointHealth {
  if (!previous) return { ...partial, lastSyncedAt: undefined };
  const byId = new Map(previous.models.map((m) => [m.id, m]));
  for (const model of partial.models) byId.set(model.id, model);
  return {
    ...previous,
    listed: partial.listed || previous.listed,
    models: [...byId.values()].slice(0, MODELS_MAX),
  };
}

/**
 * Record a sweep that never got off the ground.
 *
 * The previous verdicts survive on purpose. A transient DNS failure, an expired
 * token or a laptop on the wrong network must not empty the picker -- that
 * turns one broken minute into "Forge lost all my models".
 */
export function recordSweepFailure(
  previous: EndpointHealth | undefined,
  args: { profileName: string; fingerprint: string; error: string },
): EndpointHealth {
  return {
    profileName: args.profileName,
    fingerprint: args.fingerprint,
    listed: previous?.listed ?? 0,
    ...(previous?.lastSyncedAt !== undefined ? { lastSyncedAt: previous.lastSyncedAt } : {}),
    error: args.error.slice(0, DETAIL_MAX),
    models: previous?.models ?? [],
  };
}

export type HealthStatus = 'never-checked' | 'alive' | 'unreachable';

export function statusOf(health: EndpointHealth | undefined): HealthStatus {
  if (!health || health.lastSyncedAt === undefined) return 'never-checked';
  return health.models.some((m) => m.servable) ? 'alive' : 'unreachable';
}

export function healthyModels(health: EndpointHealth | undefined): ModelHealth[] {
  return (health?.models ?? []).filter((m) => m.servable);
}

/** Median round-trip over the models that answered. Undefined when none did. */
export function medianPing(health: EndpointHealth | undefined): number | undefined {
  const times = healthyModels(health)
    .map((m) => m.ms)
    .sort((a, b) => a - b);
  if (times.length === 0) return undefined;
  const mid = times.length >> 1;
  return times.length % 2 ? times[mid] : Math.round((times[mid - 1] + times[mid]) / 2);
}

/**
 * The failure the user should read first.
 *
 * With sixty ids down for the same reason, listing sixty rows says less than
 * naming the reason once. Ties break on the first seen, so the answer is stable
 * across renders rather than flickering between equally common messages.
 */
export function commonestFailure(health: EndpointHealth | undefined): string | undefined {
  const counts = new Map<string, number>();
  for (const m of health?.models ?? []) {
    if (m.servable || !m.detail) continue;
    counts.set(m.detail, (counts.get(m.detail) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [detail, count] of counts) {
    if (count > bestCount) {
      best = detail;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Apply verdicts to a candidate list.
 *
 * One function, because two copies of this rule would drift. Two answers,
 * because the callers are asking different questions:
 *
 * - `source: 'listing'` -- the ids came from the gateway's own `/models`. Keep
 *   only what answered. An id that was never probed, because it fell beyond the
 *   candidate cap, is not evidence of anything and offering it is the defect
 *   this whole feature exists to remove.
 * - `source: 'declared'` -- the ids came from the profile's own `models` block.
 *   Lose only what was probed *and failed*. A declaration is the user naming
 *   what they want, and absence of evidence must not overrule them.
 *
 * Neither ever empties a list because health is *unknown*: with no sweep on
 * record the candidates are returned untouched. An empty picker is a worse
 * failure than an optimistic one, because the user cannot even try.
 */
export function keepHealthy(
  ids: readonly string[],
  health: EndpointHealth | undefined,
  source: 'listing' | 'declared',
): string[] {
  if (!health || health.lastSyncedAt === undefined || health.models.length === 0) {
    return [...ids];
  }
  const verdict = new Map(health.models.map((m) => [m.id, m.servable]));
  if (source === 'declared') return ids.filter((id) => verdict.get(id) !== false);
  return ids.filter((id) => verdict.get(id) === true);
}
