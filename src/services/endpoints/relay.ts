/**
 * Local relay that puts the endpoint transport in front of the Claude CLI.
 *
 * Forge's backend is the real `claude` binary, spawned by the Agent SDK. That
 * binary talks to whatever `ANTHROPIC_BASE_URL` points at using plain Node fetch:
 * it has no client-certificate story, it will not read a custom CA bundle, it
 * cannot tunnel through an authenticating proxy, and it cannot reshape a request
 * for a gateway that is not quite Anthropic-shaped.
 *
 * The endpoint layer ported from Genesis can do all of those, but only for
 * requests made in *this* process. So we run it as a loopback HTTP server and
 * point the binary at that:
 *
 *     claude  ──plain http──▶  relay (this file)  ──undici dispatcher──▶  gateway
 *                                                   mTLS, custom CA, proxy,
 *                                                   auth, request transforms
 *
 * The relay also translates, when the profile asks it to. `wire: anthropic`
 * forwards bytes; `wire: openai` goes through `wire/anthropicServer.ts`, which
 * answers the Anthropic routes the CLI emits and speaks chat/completions
 * upstream. The CLI itself needs no modification either way: its effort ladder,
 * thinking, workflows and compaction are all client-side, so they keep working
 * against any endpoint the relay can reach.
 *
 * Security properties, because this is a process that forwards traffic using the
 * user's corporate client certificate:
 *
 *   - binds to 127.0.0.1 only, on an ephemeral port;
 *   - every request must carry a per-session bearer token generated here, so
 *     another local process cannot borrow the credential by guessing the port;
 *   - the inbound credential is *dropped*, never forwarded -- the upstream
 *     credential comes from the profile's auth spec;
 *   - the upstream origin is fixed by the profile, so a caller cannot use the
 *     relay to reach an arbitrary host.
 */
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { request as undiciRequest, type Dispatcher } from 'undici';
import type { EndpointProfile } from './profile';
import { buildTransport } from './transport';
import { applyAuth } from './auth';
import { loadTransform, type Transform } from './transform';
import { serveAnthropic } from './wire/anthropicServer';
import { keepsCacheControl, stripCacheControl } from './wire/caching';
import { anthropicMessagesUrl, anthropicUrl } from './urls';

export interface RelayOptions {
  profile: EndpointProfile;
  /** Resolves `${secret:key}` references in the profile's auth spec. */
  secrets: (key: string) => string | undefined;
  /** Root used to resolve a relative `transform:` module path. */
  workspaceRoot: string;
  log: (message: string) => void;
}

export interface RunningRelay {
  /** What to set ANTHROPIC_BASE_URL to. */
  baseUrl: string;
  /** What to set ANTHROPIC_AUTH_TOKEN to. */
  token: string;
  /** Lines describing how the transport was built, for the output channel. */
  report: string[];
  close(): Promise<void>;
}

/** Hop-by-hop headers that must not be forwarded between connections. */
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
]);

/**
 * Credentials the CLI attaches for its own sake. They are meaningful only
 * between the CLI and the relay; the upstream credential is the profile's.
 */
const INBOUND_AUTH = new Set(['authorization', 'x-api-key', 'proxy-authorization']);

/**
 * The upstream URL for a path the CLI asked for.
 *
 * A profile that pins `chatPath` knows where its gateway takes *messages*, so
 * that wins for the messages route -- and only for it: `count_tokens` and any
 * other route keep their own path (pinning used to send them all to the chat
 * route). Every join goes through `anthropicUrl`, which the probes use too.
 */
export function joinUrl(baseUrl: string, incomingPath: string, chatPath?: string): string {
  const [pathOnly, query] = incomingPath.split(/\?(.*)/s, 2);
  const isMessages = /^\/?(v\d+[a-z]*\/)?messages\/?$/i.test(pathOnly);
  const url = chatPath && isMessages ? anthropicMessagesUrl(baseUrl, chatPath) : anthropicUrl(baseUrl, pathOnly);
  return query ? `${url}?${query}` : url;
}

export async function startRelay(options: RelayOptions): Promise<RunningRelay> {
  const { profile, secrets, workspaceRoot, log } = options;

  const built = buildTransport(profile);
  const auth = await applyAuth(profile, built.dispatcher, secrets);
  const report = [...built.report, ...auth.report];

  let transform: Transform | undefined;
  if (profile.transform) {
    transform = loadTransform(profile.transform, workspaceRoot);
    report.push(`Loaded request/response transform from ${profile.transform}.`);
  }

  const token = crypto.randomBytes(32).toString('hex');

  /**
   * Log each distinct model id the CLI asks for, once.
   *
   * The CLI does not only send the model the user picked: conversation titles,
   * memory and subagent chores go to a small model chosen from its own built-in
   * table, and those ids mean nothing to a private gateway. Rather than guess
   * which ones they are, this reports exactly what arrived, so `modelMap` can
   * be filled in from evidence instead of from a list that drifts every CLI
   * release. Unmapped ids are called out, because an unmapped id is the thing
   * that will 404 later.
   */
  const seenModels = new Set<string>();
  const onModelSeen = (id: string): void => {
    if (seenModels.has(id)) return;
    seenModels.add(id);
    const mapped = profile.modelMap?.[id];
    log(
      mapped
        ? `[relay] ${profile.name}: model "${id}" -> "${mapped}" (via modelMap)`
        : `[relay] ${profile.name}: model "${id}" sent through unmapped` +
          ` -- add it to modelMap if this endpoint rejects it`,
    );
  };

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      log(`[relay] request failed: ${message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' });
      }
      // Shaped like an Anthropic error so the CLI renders it rather than
      // reporting an unparseable response.
      res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message } }));
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Constant-time compare: the token is the only thing standing between another
    // local process and the user's upstream credential.
    const presented = String(req.headers['authorization'] ?? '').replace(/^Bearer\s+/i, '')
      || String(req.headers['x-api-key'] ?? '');
    const expected = Buffer.from(token);
    const actual = Buffer.from(presented);
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'Forge relay: bad token' } }));
      return;
    }

    // An OpenAI-wire profile needs translating, not forwarding: the CLI speaks
    // only Anthropic and the gateway speaks only chat/completions. Branch
    // before the body is read, because the bridge parses it itself.
    if (profile.wire === 'openai') {
      await serveAnthropic(req, res, {
        profile,
        dispatcher: built.dispatcher,
        headers: { ...(profile.headers ?? {}), ...auth.headers },
        log,
        onModelSeen,
      });
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    let body: Buffer | string = Buffer.concat(chunks);

    let streaming = false;
    if (body.length) {
      try {
        const parsed = JSON.parse(body.toString('utf8'));
        streaming = parsed?.stream === true;
        if (parsed?.model) onModelSeen(parsed.model);

        // The CLI emits `cache_control` breakpoints unconditionally. A gateway
        // that has never heard of the field rejects the whole request because
        // of it, so they come off unless the profile says this endpoint acts
        // on them. "prefix" endpoints cache by matching the token stream and
        // need no directive at all.
        let shapedBody = parsed;
        // `modelMap` applies on this wire too; the log line above said it did,
        // but the body went out unchanged.
        const mappedModel = parsed?.model ? profile.modelMap?.[parsed.model] : undefined;
        if (mappedModel) shapedBody = { ...shapedBody, model: mappedModel };
        if (!keepsCacheControl(profile.capabilities)) {
          const stripped = stripCacheControl(parsed);
          if (stripped.removed) {
            log(
              `[relay] ${profile.name}: removed ${stripped.removed} cache_control marker(s) ` +
              `(promptCaching: ${profile.capabilities.promptCaching})`,
            );
          }
          shapedBody = stripped.value;
        }

        const merged = profile.extraBody ? { ...shapedBody, ...profile.extraBody } : shapedBody;
        const shaped = transform?.transformRequest ? transform.transformRequest(merged, profile) : merged;
        body = JSON.stringify(shaped);
      } catch {
        // Not JSON. Forward untouched rather than guessing at it.
      }
    }

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const key = k.toLowerCase();
      if (HOP_BY_HOP.has(key) || INBOUND_AUTH.has(key) || v === undefined) continue;
      headers[key] = Array.isArray(v) ? v.join(', ') : String(v);
    }
    Object.assign(headers, profile.headers ?? {}, auth.headers);

    const url = new URL(joinUrl(profile.baseUrl, req.url ?? '/v1/messages', profile.chatPath));
    for (const [k, v] of Object.entries(profile.query ?? {})) url.searchParams.set(k, v);

    const upstream = await undiciRequest(url, {
      method: (req.method ?? 'POST') as Dispatcher.HttpMethod,
      headers,
      body: body.length ? body : undefined,
      dispatcher: built.dispatcher,
      headersTimeout: profile.timeoutMs ?? 120_000,
      bodyTimeout: profile.timeoutMs ?? 120_000,
    });

    const outHeaders: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(upstream.headers)) {
      if (HOP_BY_HOP.has(k.toLowerCase()) || v === undefined) continue;
      outHeaders[k] = v as string | string[];
    }

    // A streaming body is SSE: pipe it straight through. Buffering it to run a
    // JSON transform would defeat streaming, so response transforms apply only
    // to whole-body replies.
    if (streaming || !transform?.transformResponse) {
      res.writeHead(upstream.statusCode, outHeaders);
      await new Promise<void>((resolve, reject) => {
        Readable.from(upstream.body).pipe(res).on('finish', resolve).on('error', reject);
      });
      return;
    }

    const text = await upstream.body.text();
    let out = text;
    try {
      out = JSON.stringify(transform.transformResponse(JSON.parse(text), profile));
    } catch {
      // Leave a non-JSON body alone.
    }
    delete outHeaders['content-length'];
    res.writeHead(upstream.statusCode, { ...outHeaders, 'content-length': Buffer.byteLength(out) });
    res.end(out);
  }

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('Relay did not bind to a TCP port.'));
    });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  report.push(`Relay listening on ${baseUrl}, forwarding to ${profile.baseUrl}.`);
  log(`[relay] ${profile.name}: ${baseUrl} -> ${profile.baseUrl}`);

  return {
    baseUrl,
    token,
    report,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
