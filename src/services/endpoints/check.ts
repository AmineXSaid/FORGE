/**
 * Endpoint connection checks: the model list, and the diagnostics ladder.
 *
 * The ladder itself lives in `../diagnostics/ladder.ts`; this file is the entry
 * point that owns the transport for a run and hands back a summary.
 */
import { request } from 'undici';
import type { Dispatcher } from 'undici';
import type { EndpointProfile } from './profile';
import { buildTransport } from './transport';
import { applyAuth } from './auth';
import { runLadder, summarise, type Rung } from '../diagnostics/ladder';

export interface CheckOutcome {
  rungs: Rung[];
  ok: boolean;
  summary: string;
}

/**
 * Run the full ladder against a profile.
 *
 * @param emit fires per rung so a panel can fill in live rather than sitting
 *   blank for the length of the whole run.
 */
export async function checkEndpoint(
  profile: EndpointProfile,
  secrets: (key: string) => string | undefined,
  emit?: (rung: Rung) => void,
  signal?: AbortSignal,
): Promise<CheckOutcome> {
  const rungs = await runLadder({ profile, secrets, emit, signal });
  return { rungs, ...summarise(rungs) };
}

export interface ModelInfo {
  id: string;
  /** Context window, when the gateway reports one. */
  contextWindow?: number;
  maxOutputTokens?: number;
  /** Capability hints the gateway advertises. Hints, not proof. */
  tools?: boolean;
  reasoning?: boolean;
  vision?: boolean;
}

export interface ModelListResult {
  models: ModelInfo[];
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
 * message about the *route* — which sends you looking at baseUrl — or, worse,
 * is listed and still not servable, in which case the request simply hangs
 * until the timeout. Offering the gateway's own list turns a guess into a pick.
 *
 * Errors are returned rather than thrown. A gateway with no `/models` route is
 * a normal thing to meet, and the model field stays free text for that case.
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
    const raw: any[] = doc?.data ?? doc?.models ?? [];
    const seen = new Set<string>();
    const models: ModelInfo[] = [];
    for (const entry of raw) {
      const id = typeof entry === 'string' ? entry : entry?.id;
      if (typeof id !== 'string' || !id || seen.has(id)) continue;
      seen.add(id);
      const caps = entry?.capabilities ?? {};
      models.push({
        id,
        contextWindow: entry?.context_length ?? entry?.max_input_tokens ?? undefined,
        maxOutputTokens: entry?.max_output_tokens ?? undefined,
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
    await transport.dispatcher.close().catch(() => { });
  }
}

export interface ServableResult {
  id: string;
  servable: boolean;
  /** Why not, when it is not. */
  detail?: string;
  ms: number;
}

/**
 * Keep only the ids the gateway will actually serve.
 *
 * Listing alone is not an answer, and the gap is not small. Genesis measured
 * one NVIDIA account: of 101 ids returned by `/v1/models`, 28 answered, 60
 * returned 404, 10 accepted the request and never replied, and 3 errored. The
 * same shape shows up on any aggregating gateway — a model is listed because
 * the aggregator knows the *name*, not because the provider behind it is
 * reachable from here.
 *
 * A picker built on the raw list is therefore worse than a free-text field,
 * because it looks authoritative while being wrong most of the time. The
 * hanging ids are the cruellest: each costs a full timeout to discover by hand.
 *
 * So every candidate gets one real, tiny request. A slow model is treated as
 * unusable rather than waited on — one that cannot answer four tokens promptly
 * is not one to pick blind.
 *
 * @param ids  candidates to check. Cap this: verifying hundreds of ids means
 *   hundreds of completions, and the caller decides what that is worth.
 * @param options.signal  stops the sweep between probes and aborts the one in
 *   flight. The results gathered before the abort are still returned, because
 *   a cancelled sweep that answered for forty ids knows forty things, and
 *   throwing them away would make Cancel cost the user those completions twice.
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
        // abort, not about the model. Recording it would mark a healthy id
        // dead because the user pressed Cancel.
        if (signal?.aborted && !result.servable) return;
        results.push(result);
        onResult?.(result);
      }
    };

    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  } catch (e: any) {
    // Auth failed: nothing is servable, and saying so once beats one identical
    // failure per candidate.
    return ids.map((id) => ({ id, servable: false, detail: e?.message ?? String(e), ms: 0 }));
  } finally {
    await transport.dispatcher.close().catch(() => { });
  }

  results.sort((a, b) => a.id.localeCompare(b.id));
  return results;
}

async function probeOne(
  profile: EndpointProfile,
  id: string,
  headers: Record<string, string>,
  dispatcher: Dispatcher,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ServableResult> {
  const started = Date.now();
  const isOpenAi = profile.wire !== 'anthropic';
  const base = profile.baseUrl.replace(/\/+$/, '');
  const url = isOpenAi
    ? (/\/v\d+[a-z]*$/i.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`)
    : `${base}${profile.chatPath ?? '/messages'}`;

  const body = isOpenAi
    ? { model: id, max_tokens: 4, messages: [{ role: 'user', content: 'hi' }] }
    : { model: id, max_tokens: 4, messages: [{ role: 'user', content: 'hi' }] };

  try {
    const res = await request(url, {
      method: 'POST',
      dispatcher,
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      signal,
    });
    const text = await res.body.text();
    const ms = Date.now() - started;
    if (res.statusCode >= 400) {
      let message = `HTTP ${res.statusCode}`;
      try {
        const json = JSON.parse(text);
        message = json?.error?.message ?? json?.message ?? message;
      } catch {
        // Keep the status.
      }
      return { id, servable: false, detail: String(message).slice(0, 160), ms };
    }
    return { id, servable: true, ms };
  } catch (e: any) {
    return {
      id,
      servable: false,
      // A timeout here is the case worth naming: the id is listed, accepts the
      // request and never answers.
      detail: e?.code === 'UND_ERR_HEADERS_TIMEOUT' || e?.code === 'UND_ERR_BODY_TIMEOUT'
        ? 'listed, but accepted the request and never answered'
        : (e?.message ?? String(e)).slice(0, 160),
      ms: Date.now() - started,
    };
  }
}
