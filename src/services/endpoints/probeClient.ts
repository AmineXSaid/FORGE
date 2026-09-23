/**
 * A minimal completion client, for diagnostics and capability probes.
 *
 * Deliberately not a second implementation of the wire: it runs the request
 * through the same `toOpenAI` the relay uses, so a probe result describes the
 * path the CLI will actually take rather than an idealised one. A probe that
 * passed while the relay failed would be worse than no probe.
 *
 * It does not stand up an HTTP server. The relay exists because the spawned
 * `claude` binary cannot be given a dispatcher; this code is in-process and can,
 * so it talks to the transport directly.
 */
import { request as undiciRequest, type Dispatcher } from 'undici';
import type { EndpointProfile } from './profile';
import { toOpenAI, type AnthropicRequest } from './wire/toOpenAI';
import { SseDecoder } from './wire/fromOpenAI';
import { chatUrl } from './wire/anthropicServer';
import { extractMessage } from './wire/errors';
import { ANTHROPIC_VERSION, anthropicMessagesUrl } from './urls';

export interface ProbeToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ProbeOutcome {
  /** Visible answer text, concatenated. */
  text: string;
  /** Text that arrived on a separate reasoning channel, if any. */
  reasoning: string;
  /** Which delta field carried that reasoning. */
  reasoningField?: 'reasoning_content' | 'reasoning';
  toolCalls: ProbeToolCall[];
  /** How many incremental text chunks arrived. One frame is not streaming. */
  chunks: number;
  usage: { input: number; output: number; reasoningTokens?: number };
  /** Milliseconds from request to final frame. */
  ms: number;
}

export class ProbeError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export interface ProbeRequest extends AnthropicRequest {
  /** Sent verbatim on the OpenAI wire, for probes of specific fields. */
  extraFields?: Record<string, unknown>;
}

/**
 * Run one completion against the endpoint and report what came back.
 *
 * Errors are thrown rather than swallowed, because the caller decides what a
 * failure means: for a probe a failure is usually the answer "no", but for the
 * diagnostics ladder it is a rung that failed and needs a fix.
 */
export async function probeComplete(
  profile: EndpointProfile,
  dispatcher: Dispatcher,
  headers: Record<string, string>,
  request: ProbeRequest,
  signal?: AbortSignal,
): Promise<ProbeOutcome> {
  const started = Date.now();
  const { extraFields, ...anthropic } = request;

  const outcome: ProbeOutcome = {
    text: '',
    reasoning: '',
    toolCalls: [],
    chunks: 0,
    usage: { input: 0, output: 0 },
    ms: 0,
  };

  const isOpenAi = profile.wire !== 'anthropic';
  const url = isOpenAi
    ? new URL(chatUrl(profile))
    : new URL(anthropicMessagesUrl(profile.baseUrl, profile.chatPath));
  for (const [k, v] of Object.entries(profile.query ?? {})) url.searchParams.set(k, v);

  const body = isOpenAi
    ? { ...toOpenAI(anthropic, profile).body, ...(extraFields ?? {}) }
    : { ...anthropic, model: anthropic.model ?? profile.model, ...(extraFields ?? {}) };

  const response = await undiciRequest(url, {
    method: 'POST',
    headers: {
      // Anthropic's Messages API refuses a request without its version header.
      ...(isOpenAi ? {} : { 'anthropic-version': ANTHROPIC_VERSION }),
      ...headers,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    dispatcher,
    signal,
    headersTimeout: profile.timeoutMs ?? 120_000,
    bodyTimeout: profile.timeoutMs ?? 120_000,
  });

  if (response.statusCode >= 400) {
    const text = await response.body.text();
    throw new ProbeError(extractMessage(text, response.statusCode), response.statusCode);
  }

  if (!request.stream) {
    const json: any = await response.body.json();
    collectWhole(json, isOpenAi, outcome);
    outcome.ms = Date.now() - started;
    return outcome;
  }

  const decoder = new SseDecoder();
  const pending = new Map<number, ProbeToolCall>();
  for await (const chunk of response.body) {
    for (const payload of decoder.push(String(chunk))) {
      if (payload === '[DONE]') continue;
      let parsed: any;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }
      if (isOpenAi) collectOpenAiDelta(parsed, outcome, pending);
      else collectAnthropicFrame(parsed, outcome, pending);
    }
  }
  outcome.toolCalls.push(...pending.values());
  outcome.ms = Date.now() - started;
  return outcome;
}

function readUsage(usage: any, outcome: ProbeOutcome): void {
  if (!usage) return;
  const input = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const output = usage.completion_tokens ?? usage.output_tokens ?? 0;
  if (input || output || usage.total_tokens) {
    outcome.usage = {
      input,
      output: usage.total_tokens ? Math.max(0, usage.total_tokens - input) : output,
      // The single most useful number for the effort probe: whether asking for
      // more effort actually bought any more thinking.
      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
    };
  }
}

function collectWhole(json: any, isOpenAi: boolean, outcome: ProbeOutcome): void {
  readUsage(json.usage, outcome);
  if (isOpenAi) {
    const message = json.choices?.[0]?.message ?? {};
    if (typeof message.content === 'string') outcome.text += message.content;
    for (const field of ['reasoning_content', 'reasoning'] as const) {
      if (typeof message[field] === 'string' && message[field]) {
        outcome.reasoning += message[field];
        outcome.reasoningField ??= field;
      }
    }
    for (const call of message.tool_calls ?? []) {
      outcome.toolCalls.push({
        id: call.id ?? '',
        name: call.function?.name ?? '',
        arguments: call.function?.arguments ?? '',
      });
    }
    return;
  }
  for (const block of json.content ?? []) {
    if (block.type === 'text') outcome.text += block.text ?? '';
    if (block.type === 'thinking') outcome.reasoning += block.thinking ?? '';
    if (block.type === 'tool_use') {
      outcome.toolCalls.push({
        id: block.id ?? '',
        name: block.name ?? '',
        arguments: JSON.stringify(block.input ?? {}),
      });
    }
  }
}

function collectOpenAiDelta(
  json: any,
  outcome: ProbeOutcome,
  pending: Map<number, ProbeToolCall>,
): void {
  readUsage(json.usage, outcome);
  const delta = json.choices?.[0]?.delta;
  if (!delta) return;

  if (typeof delta.content === 'string' && delta.content) {
    outcome.text += delta.content;
    outcome.chunks += 1;
  }
  // Probed rather than configured: which field carries reasoning varies by
  // gateway, and guessing wrong renders a reasoning turn as an empty reply.
  for (const field of ['reasoning_content', 'reasoning'] as const) {
    if (typeof delta[field] === 'string' && delta[field]) {
      outcome.reasoning += delta[field];
      outcome.reasoningField ??= field;
    }
  }
  for (const call of delta.tool_calls ?? []) {
    const index = typeof call.index === 'number' ? call.index : 0;
    const slot = pending.get(index) ?? { id: '', name: '', arguments: '' };
    if (call.id) slot.id = String(call.id);
    if (call.function?.name) slot.name += String(call.function.name);
    if (call.function?.arguments) slot.arguments += String(call.function.arguments);
    pending.set(index, slot);
  }
}

function collectAnthropicFrame(
  json: any,
  outcome: ProbeOutcome,
  pending: Map<number, ProbeToolCall>,
): void {
  switch (json.type) {
    case 'content_block_start':
      if (json.content_block?.type === 'tool_use') {
        pending.set(json.index, {
          id: json.content_block.id ?? '',
          name: json.content_block.name ?? '',
          arguments: '',
        });
      }
      break;
    case 'content_block_delta':
      if (json.delta?.type === 'text_delta') {
        outcome.text += json.delta.text ?? '';
        outcome.chunks += 1;
      }
      if (json.delta?.type === 'thinking_delta') outcome.reasoning += json.delta.thinking ?? '';
      if (json.delta?.type === 'input_json_delta') {
        const slot = pending.get(json.index);
        if (slot) slot.arguments += json.delta.partial_json ?? '';
      }
      break;
    case 'message_delta':
      readUsage(json.usage, outcome);
      break;
    case 'message_start':
      readUsage(json.message?.usage, outcome);
      break;
  }
}
