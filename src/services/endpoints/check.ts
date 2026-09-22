/**
 * What a gateway lists, and what it will actually serve.
 *
 * Two questions, deliberately separate, because the answers differ far more
 * than anyone expects. `listModels` asks the gateway to name its models;
 * `keepServable` sends each one a real request and keeps the ones that answer.
 *
 * TRANSPORT RULE applies here as everywhere in this folder: every request goes
 * through the undici Dispatcher `buildTransport` builds, so the profile's CA
 * bundle, client certificate and proxy are honoured. Global fetch is forbidden.
 */
import { request } from 'undici';
import type { Dispatcher } from 'undici';
import type { EndpointProfile } from './profile';
import { buildTransport } from './transport';
import { applyAuth } from './auth';

/**
 * One model a gateway says it has.
 *
 * Everything but `id` is a hint the gateway volunteered. Hints are recorded and
 * shown; they are never treated as proof, which is what `keepServable` is for.
 */
export interface ListedModel {
  id: string;
  /** Context window, when the gateway reports one. */
  contextWindow?: number;
  maxOutputTokens?: number;
  tools?: boolean;
  reasoning?: boolean;
  vision?: boolean;
}

export interface ModelListResult {
  models: ListedModel[];
  /** How many ids the gateway listed, before any servability filtering. */
  listed: number;
  /** Set when the list could not be fetched at all. */
  error?: string;
}

/** Where this gateway's `/models` route lives. */
function modelsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  let pathname = base;
  try {
    pathname = new URL(base).pathname;
  } catch {
    // A malformed base is reported by the request itself.
  }
  return /\/v\d+[a-z]*\/?$/i.test(pathname) ? `${base}/models` : `${base}/v1/models`;
}

/**
 * Ask the gateway which models it serves.
 *
 * Typing a model id by hand is the most expensive mistake a profile allows. A
 * wrong id does not fail cleanly: on aggregating gateways it either 404s with a
 * message about the *route*, which sends you looking at baseUrl, or, worse, is
 * listed and still not servable, in which case the request simply hangs until
 * the timeout. Offering the gateway's own list turns a guess into a pick.
 *
 * Errors are returned rather than thrown. A gateway with no `/models` route is
 * a normal thing to meet, and `model` stays free text for that case.
 */
export async function listModels(
  profile: EndpointProfile,
  secrets: (key: string) => string | undefined,
): Promise<ModelListResult> {
  const transport = buildTransport(profile);
  try {
    const auth = await applyAuth(profile, transport.dispatcher, secrets);
    const headers = { ...(profile.headers ?? {}), ...auth.headers };
    const res = await request(modelsUrl(profile.baseUrl), {
      method: 'GET',
      dispatcher: transport.dispatcher,
      headers: { accept: 'application/json', ...headers },
      headersTimeout: 15_000,
      bodyTimeout: 15_000,
    });
    const text = await res.body.text();
    if (res.statusCode >= 400) {
      return { models: [], listed: 0, error: `The gateway returned ${res.statusCode} for /models.` };
    }

    const doc = JSON.parse(text);
    const raw: unknown[] = doc?.data ?? doc?.models ?? [];
    const seen = new Set<string>();
    const models: ListedModel[] = [];
    for (const entry of raw) {
      const record = entry as Record<string, any> | string;
      const id = typeof record === 'string' ? record : record?.id;
      if (typeof id !== 'string' || !id || seen.has(id)) continue;
      seen.add(id);
      const caps = (typeof record === 'string' ? undefined : record?.capabilities) ?? {};
      models.push({
        id,
        contextWindow:
          typeof record === 'string'
            ? undefined
            : record?.context_length ?? record?.max_input_tokens ?? undefined,
        maxOutputTokens: typeof record === 'string' ? undefined : record?.max_output_tokens ?? undefined,
        tools: caps.tool_calling ?? caps.tools ?? undefined,
        reasoning: caps.reasoning ?? caps.thinking ?? undefined,
        vision: caps.vision ?? undefined,
      });
    }
    models.sort((a, b) => a.id.localeCompare(b.id));
    return { models, listed: models.length };
  } catch (e: any) {
    return { models: [], listed: 0, error: e?.message ?? String(e) };
  } finally {
    await transport.dispatcher.close().catch(() => {});
  }
}

export interface ServableResult {
  id: string;
  servable: boolean;
  /** Why not, when it is not. Truncated to 160 chars. */
  detail?: string;
  ms: number;
}

/** The longest `detail` this module will ever produce. */
export const DETAIL_MAX = 160;

/**
 * Keep only the ids the gateway will actually serve.
 *
 * Listing alone is not an answer, and the gap is not small. One NVIDIA account
 * measured here returned 101 ids from `/v1/models`: 28 answered, 60 returned
 * 404, 10 accepted the request and never replied, and 3 errored. The same shape
 * shows up on any aggregating gateway -- a model is listed because the
 * aggregator knows the *name*, not because the provider behind it is reachable
 * from this machine, on this account, today.
 *
 * A picker built on the raw list is therefore worse than a free-text field,
 * because it looks authoritative while being wrong most of the time. The
 * hanging ids are the cruellest: each costs a full timeout to discover by hand.
 *
 * So every candidate gets one real, tiny request. A model too slow to answer
 * four tokens is treated as unusable rather than waited on.
 *
 * @param ids candidates to check. **Cap this.** Verifying hundreds of ids means
 *   hundreds of billable completions, and the caller decides what that is worth.
 * @param options.signal stops the sweep between probes and aborts the one in
 *   flight. Results gathered before the abort are still returned: a cancelled
 *   sweep that answered for forty ids knows forty things, and discarding them
 *   would make Cancel cost the user those completions twice.
 */
export async function keepServable(
  profile: EndpointProfile,
  ids: string[],
  secrets: (key: string) => string | undefined,
  options: {
    concurrency?: number;
    timeoutMs?: number;
    onResult?: (r: ServableResult) => void;
    signal?: AbortSignal;
  } = {},
): Promise<ServableResult[]> {
  const { concurrency = 4, timeoutMs = 20_000, onResult, signal } = options;
  const transport = buildTransport(profile);
  const results: ServableResult[] = [];

  try {
    const auth = await applyAuth(profile, transport.dispatcher, secrets);
    const headers = { ...(profile.headers ?? {}), ...auth.headers };
    const queue = [...ids];

    const worker = async (): Promise<void> => {
      for (;;) {
        if (signal?.aborted) return;
        const id = queue.shift();
        if (!id) return;
        const result = await probeOne(profile, id, headers, transport.dispatcher, timeoutMs, signal);
        // An abort arriving mid-probe produces a failure verdict about the
        // abort, not about the model. Recording it would mark a healthy id dead
        // because the user pressed Cancel.
        if (signal?.aborted && !result.servable) return;
        results.push(result);
        onResult?.(result);
      }
    };

    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  } catch (e: any) {
    // Auth failed before any probe ran. Nothing is servable, and saying so once
    // beats one identical failure per candidate.
    const detail = String(e?.message ?? e).slice(0, DETAIL_MAX);
    return ids.map((id) => ({ id, servable: false, detail, ms: 0 }));
  } finally {
    await transport.dispatcher.close().catch(() => {});
  }

  results.sort((a, b) => a.id.localeCompare(b.id));
  return results;
}

/** The chat route for a profile, matching the wire it declares. */
function chatUrl(profile: EndpointProfile): string {
  const base = profile.baseUrl.replace(/\/+$/, '');
  if (profile.wire === 'anthropic') return `${base}${profile.chatPath ?? '/messages'}`;
  if (profile.chatPath) return `${base}${profile.chatPath}`;
  return /\/v\d+[a-z]*$/i.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

/**
 * One model, one real completion, four tokens.
 *
 * Exported so the sweep and any interactive check cannot drift into asking two
 * different questions and disagreeing about the answer.
 */
export async function probeOne(
  profile: EndpointProfile,
  id: string,
  headers: Record<string, string>,
  dispatcher: Dispatcher,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ServableResult> {
  const started = Date.now();
  const body: Record<string, unknown> = {
    model: id,
    max_tokens: 4,
    messages: [{ role: 'user', content: 'hi' }],
  };
  // The Anthropic wire wants its version header; a gateway speaking it without
  // one answers 400 and the model gets blamed for the profile's omission.
  const wireHeaders =
    profile.wire === 'anthropic' ? { 'anthropic-version': '2023-06-01' } : {};

  try {
    const res = await request(chatUrl(profile), {
      method: 'POST',
      dispatcher,
      headers: { ...wireHeaders, ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      signal,
    });
    const text = await res.body.text();
    const ms = Date.now() - started;
    if (res.statusCode >= 400) {
      let message: string = `HTTP ${res.statusCode}`;
      try {
        const json = JSON.parse(text);
        message = json?.error?.message ?? json?.message ?? message;
      } catch {
        // Keep the status.
      }
      return { id, servable: false, detail: String(message).slice(0, DETAIL_MAX), ms };
    }
    return { id, servable: true, ms };
  } catch (e: any) {
    const timedOut =
      e?.code === 'UND_ERR_HEADERS_TIMEOUT' || e?.code === 'UND_ERR_BODY_TIMEOUT';
    return {
      id,
      servable: false,
      // The timeout is the case worth naming: the id is listed, accepts the
      // request, and never answers. Nothing else tells the user that.
      detail: timedOut
        ? 'listed, but accepted the request and never answered'
        : String(e?.message ?? e).slice(0, DETAIL_MAX),
      ms: Date.now() - started,
    };
  }
}
