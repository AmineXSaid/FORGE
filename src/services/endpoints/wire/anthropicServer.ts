/**
 * The Anthropic-shaped face the CLI talks to when a profile is `wire: openai`.
 *
 * The CLI only ever emits Anthropic routes, so the bridge has to answer them:
 *
 *   POST /v1/messages               translated to and from chat/completions
 *   POST /v1/messages/count_tokens  answered locally -- OpenAI has no route
 *                                   for it, and the CLI needs the number
 *
 * `count_tokens` being answered locally is not a shortcut. The CLI asks for it
 * to decide whether the next turn fits, and a 404 there makes it behave as if
 * the context were unbounded. An estimate that is roughly right keeps the
 * decision roughly right; an error makes it certainly wrong.
 */
import type * as http from 'node:http';
import { request as undiciRequest, type Dispatcher } from 'undici';
import type { EndpointProfile } from '../profile';
import { toOpenAI, type AnthropicRequest } from './toOpenAI';
import { OpenAiToAnthropicStream, SseDecoder, type StreamUsage } from './fromOpenAI';
import { isRetryableTransportError, transportError, upstreamError } from './errors';
import { detectTruncation, type TruncationFinding } from './truncation';
import { repairArguments, resolveToolName, type ToolSpec } from './toolRepair';
import { recoverToolCalls } from './textToolCalls';

export interface BridgeContext {
  profile: EndpointProfile;
  dispatcher: Dispatcher;
  /** Profile headers plus resolved auth. Never logged. */
  headers: Record<string, string>;
  log: (message: string) => void;
  /** Called with every model id the CLI asks for, so the map can be filled in. */
  onModelSeen?: (id: string) => void;
  /**
   * Called when the gateway reports far fewer prompt tokens than were sent,
   * i.e. it silently dropped the start of the prompt. See `truncation.ts`.
   */
  onTruncation?: (finding: TruncationFinding, model: string) => void;
}

/** Run the truncation check against what the gateway reported, if anything. */
function checkTruncation(ctx: BridgeContext, request: AnthropicRequest, reported: number | undefined): void {
  if (!ctx.onTruncation) return;
  const finding = detectTruncation(reported, estimateTextTokens(request));
  if (finding) ctx.onTruncation(finding, request.model ?? ctx.profile.model);
}

/** Where the OpenAI chat route lives for this profile. */
export function chatUrl(profile: EndpointProfile): string {
  const base = profile.baseUrl.replace(/\/+$/, '');
  if (profile.chatPath) {
    return base + (profile.chatPath.startsWith('/') ? '' : '/') + profile.chatPath;
  }
  // A baseUrl that already carries a version segment takes the bare route;
  // a bare origin gets the conventional `/v1` as well. Both spellings of
  // baseUrl are common and neither is wrong, so both are accepted.
  return /\/v\d+[a-z]*$/i.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

/**
 * Estimate the token count of an Anthropic request.
 *
 * Deliberately crude, and calibrated to fail in the safe direction. Four
 * characters per token is the usual English approximation; tool schemas are
 * counted because they are part of the prompt and are frequently the largest
 * part of it; an image is charged a flat ~1,400 because its cost comes from
 * its pixels rather than its bytes.
 *
 * Over-estimating makes the CLI compact slightly early, which costs a little
 * context. Under-estimating makes it compact too late, which costs the turn.
 */
export function estimateTokens(request: AnthropicRequest): number {
  const { chars, images } = measure(request);
  return Math.ceil(chars / 4) + images * 1400;
}

/**
 * The same estimate without the flat per-image charge.
 *
 * For the truncation check, which must not fire on a gateway that simply
 * prices a small image below 1,400 tokens: text is the only part whose size
 * the relay knows well enough to accuse the gateway of dropping it.
 */
export function estimateTextTokens(request: AnthropicRequest): number {
  return Math.ceil(measure(request).chars / 4);
}

function measure(request: AnthropicRequest): { chars: number; images: number } {
  let chars = 0;
  let images = 0;

  const walk = (value: unknown): void => {
    if (typeof value === 'string') { chars += value.length; return; }
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (value && typeof value === 'object') {
      const block = value as Record<string, unknown>;
      if (block.type === 'image') { images += 1; return; }
      for (const v of Object.values(block)) walk(v);
    }
  };

  walk(request.system);
  walk(request.messages);
  walk(request.tools);

  return { chars, images };
}

/** Read a request body to completion. */
async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Whether this path is the CLI asking for a token count. */
export function isCountTokensPath(path: string): boolean {
  return /\/messages\/count_tokens\/?$/.test(path.split('?')[0]);
}

/**
 * Turn a whole (non-streamed) OpenAI response into an Anthropic message.
 *
 * With `tools`, the same repairs as the streamed path apply: names resolved,
 * arguments repaired against their schemas, and tool calls written as text
 * recovered when the model made no native call.
 */
export function toAnthropicMessage(
  json: any,
  model: string,
  options: { tools?: readonly ToolSpec[]; onRepair?: (note: string) => void } = {},
): Record<string, unknown> {
  const choice = json?.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const content: unknown[] = [];
  const tools = options.tools ?? [];
  const note = (m: string): void => options.onRepair?.(m);

  if (typeof message.reasoning_content === 'string' && message.reasoning_content) {
    content.push({
      type: 'thinking',
      thinking: message.reasoning_content,
      signature: 'forge-bridge-unsigned',
    });
  }

  let text = typeof message.content === 'string' ? message.content : '';
  const calls: { id?: string; name: string; args: string }[] = (message.tool_calls ?? [])
    .map((call: { id?: string; function?: { name?: unknown; arguments?: unknown } }) => ({
      id: call.id,
      name: String(call.function?.name ?? ''),
      args: typeof call.function?.arguments === 'string'
        ? call.function.arguments
        : JSON.stringify(call.function?.arguments ?? {}),
    }));

  if (!calls.length && tools.length && text) {
    const recovered = recoverToolCalls(text, tools);
    if (recovered) {
      note(`recovered ${recovered.calls.length} tool call(s) the model wrote as text: ` +
        recovered.calls.map((c) => c.name).join(', '));
      text = recovered.remainingText;
      calls.push(...recovered.calls.map((c) => ({ name: c.name, args: c.arguments })));
    }
  }
  if (text) content.push({ type: 'text', text });

  let counter = 0;
  for (const call of calls) {
    if (tools.length) {
      if (!call.name) { note('dropped a tool call with no name'); continue; }
      const resolved = resolveToolName(call.name, tools);
      if (resolved && resolved !== call.name) note(`tool name "${call.name}" -> "${resolved}"`);
      const name = resolved ?? call.name;
      const repaired = repairArguments(call.args, tools.find((t) => t.name === name)?.input_schema);
      for (const n of repaired.notes) note(`${name}: ${n}`);
      content.push({
        type: 'tool_use',
        id: call.id ?? `toolu_${json?.id ?? 'msg'}_${counter++}`,
        name,
        input: JSON.parse(repaired.json),
      });
      continue;
    }
    let input: unknown = {};
    try {
      input = JSON.parse(call.args || '{}');
    } catch {
      // Without the request's tools there is no schema to repair against;
      // keeping the raw string lets the model see and correct it, where
      // dropping the call would just look like the tool never ran.
      input = { _raw: call.args };
    }
    content.push({ type: 'tool_use', id: call.id, name: call.name, input });
  }
  const hasToolUse = content.some((b) => (b as { type?: string }).type === 'tool_use');

  const usage = json?.usage ?? {};
  const input_tokens = usage.prompt_tokens ?? 0;

  return {
    id: json?.id ?? `msg_${Math.random().toString(36).slice(2, 14)}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: hasToolUse
      ? 'tool_use'
      : choice.finish_reason === 'length' ? 'max_tokens' : 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens,
      output_tokens: usage.total_tokens
        ? Math.max(0, usage.total_tokens - input_tokens)
        : usage.completion_tokens ?? 0,
      ...(usage.prompt_tokens_details?.cached_tokens
        ? { cache_read_input_tokens: usage.prompt_tokens_details.cached_tokens }
        : {}),
    },
  };
}

/**
 * Handle one CLI request against an OpenAI-wire endpoint.
 *
 * @returns true when the request was handled here.
 */
export async function serveAnthropic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: BridgeContext,
): Promise<void> {
  const { profile } = ctx;
  const raw = await readBody(req);

  let request: AnthropicRequest;
  try {
    request = JSON.parse(raw.toString('utf8') || '{}');
  } catch {
    sendJson(res, 400, {
      type: 'error',
      error: { type: 'invalid_request_error', message: 'Forge relay: request body was not JSON.' },
    });
    return;
  }

  if (request.model) ctx.onModelSeen?.(request.model);

  // --- count_tokens: answered here, because OpenAI has no such route --------
  if (isCountTokensPath(req.url ?? '')) {
    sendJson(res, 200, { input_tokens: estimateTokens(request) });
    return;
  }

  const { body, warnings } = toOpenAI(request, profile);
  for (const w of warnings) ctx.log(`[relay] ${profile.name}: ${w}`);

  const url = new URL(chatUrl(profile));
  for (const [k, v] of Object.entries(profile.query ?? {})) url.searchParams.set(k, v);

  const payload = JSON.stringify(body);
  const timeout = profile.timeoutMs ?? 120_000;

  // Connection-level retries only. Every HTTP status is passed through to the
  // CLI untouched, because the CLI does its own 429/529 backoff and retrying
  // here as well would multiply the two.
  const attempts = Math.max(1, (profile.retries ?? 2) + 1);
  let upstream: Dispatcher.ResponseData | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      upstream = await undiciRequest(url, {
        method: 'POST',
        headers: { ...ctx.headers, 'content-type': 'application/json' },
        body: payload,
        dispatcher: ctx.dispatcher,
        headersTimeout: timeout,
        bodyTimeout: timeout,
      });
      break;
    } catch (e) {
      lastError = e;
      if (attempt >= attempts || !isRetryableTransportError(e)) break;
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000);
      ctx.log(
        `[relay] ${profile.name}: ${(e as NodeJS.ErrnoException)?.code ?? 'transport error'} ` +
        `on attempt ${attempt}/${attempts}, retrying in ${backoff}ms`,
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  if (!upstream) {
    sendJson(res, 502, transportError(lastError, profile.name, profile.baseUrl));
    return;
  }

  if (upstream.statusCode >= 400) {
    const text = await upstream.body.text();
    ctx.log(`[relay] ${profile.name}: upstream HTTP ${upstream.statusCode}`);
    // Status preserved exactly, so the CLI's own backoff still sees the 429.
    sendJson(res, upstream.statusCode, upstreamError(upstream.statusCode, text, profile.name));
    return;
  }

  // --- non-streaming -------------------------------------------------------
  if (!request.stream) {
    const text = await upstream.body.text();
    let json: { usage?: { prompt_tokens?: number } } | undefined;
    try {
      json = JSON.parse(text);
    } catch {
      sendJson(res, 502, upstreamError(502, text, profile.name));
      return;
    }
    sendJson(res, 200, toAnthropicMessage(json, request.model ?? profile.model, {
      tools: request.tools,
      onRepair: (note) => ctx.log(`[relay] ${profile.name}: ${note}`),
    }));
    checkTruncation(ctx, request, json?.usage?.prompt_tokens);
    return;
  }

  // --- streaming -----------------------------------------------------------
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  const stream = new OpenAiToAnthropicStream({
    model: request.model ?? profile.model,
    reasoningField: profile.capabilities.reasoningField,
    tools: request.tools,
    onRepair: (note) => ctx.log(`[relay] ${profile.name}: ${note}`),
    stopRepetition: profile.guards !== 'off',
    // Only used when the endpoint reports no usage of its own. `heuristic`
    // profiles always estimate, because a gateway that reports zeros is
    // indistinguishable from one that reports nothing.
    fallbackUsage: (): StreamUsage => ({
      input_tokens: estimateTokens(request),
      output_tokens: 0,
    }),
  });

  const decoder = new SseDecoder();
  try {
    outer: for await (const chunk of upstream.body) {
      for (const payloadText of decoder.push(String(chunk))) {
        // `[DONE]` really is the end. Everything before it may still carry
        // usage, so the loop does not stop at `finish_reason`.
        if (payloadText === '[DONE]') break outer;
        let parsed: unknown;
        try {
          parsed = JSON.parse(payloadText);
        } catch {
          continue; // A keep-alive or a partial frame; not fatal.
        }
        for (const out of stream.push(parsed)) res.write(out);
        // Leaving the loop closes the upstream body, so the gateway stops
        // generating the rest of a reply that was only repeating itself.
        if (stream.repeating) break outer;
      }
    }
  } catch (e) {
    ctx.log(`[relay] ${profile.name}: stream ended early: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Always terminate the message. A gateway that simply drops the connection
  // would otherwise leave the CLI waiting for a message_stop that never comes.
  for (const out of stream.end()) res.write(out);
  res.end();
  checkTruncation(ctx, request, stream.reportedInputTokens);
}
