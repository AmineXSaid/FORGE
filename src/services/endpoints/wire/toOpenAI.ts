/**
 * Anthropic `/v1/messages` request -> OpenAI `/chat/completions` request.
 *
 * The CLI only ever speaks Anthropic. When a profile declares `wire: openai`
 * the relay translates here on the way out, and `fromOpenAI.ts` translates the
 * stream on the way back. Everything in this file is a pure function of the
 * request body and the profile, so the awkward cases can be pinned down with
 * fixtures rather than against a live gateway.
 *
 * Reference for the shapes: Genesis's own outbound packer,
 * `kryptonite/src/providers/client.ts` (`packOpenAiMessages`, `toOpenAiMessage`).
 * This is the same mapping, driven from a parsed Anthropic body instead of
 * Genesis's internal message type.
 */
import type { Capabilities, EndpointProfile } from '../profile';
import { reasoningFor } from './reasoning';
import { prefixStabilityWarnings } from './caching';

/** A block inside an Anthropic message's `content` array. */
interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  source?: { type?: string; media_type?: string; data?: string; url?: string };
  thinking?: string;
  signature?: string;
  cache_control?: unknown;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicBlock[];
}

export interface AnthropicRequest {
  model?: string;
  max_tokens?: number;
  system?: string | AnthropicBlock[];
  messages?: AnthropicMessage[];
  tools?: { name: string; description?: string; input_schema?: unknown }[];
  tool_choice?: { type: string; name?: string; disable_parallel_tool_use?: boolean };
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  /**
   * The CLI's effort rung for this turn (`sdk.d.ts:1807`). A name, or an
   * integer budget on models that take one.
   */
  effort?: string | number;
  /**
   * Where CLI 2.1.x actually puts the rung: `output_config: {effort}` on every
   * request once an effort is set (captured from 2.1.274, 2026-09-24).
   */
  output_config?: { effort?: string | number; [key: string]: unknown };
  /**
   * `{type:'enabled', budget_tokens}` on models with a budget; CLI 2.1.x sends
   * `{type:'adaptive'}` (no budget) for a model outside its catalog, and omits
   * the field entirely when thinking is off.
   */
  thinking?: { type?: string; budget_tokens?: number };
  metadata?: unknown;
  [key: string]: unknown;
}

export interface TranslatedRequest {
  body: Record<string, unknown>;
  /** The model id as the CLI asked for it, before `modelMap` was applied. */
  requestedModel?: string;
  /** Non-fatal things the translation had to do, for the output channel. */
  warnings: string[];
}

/** Flatten an Anthropic content value to plain text. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b: AnthropicBlock) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: AnthropicBlock) => b.text)
    .join('');
}

/** Pull image blocks out of an Anthropic content value. */
function imagesOf(content: unknown): AnthropicBlock[] {
  if (!Array.isArray(content)) return [];
  return content.filter((b: AnthropicBlock) => b?.type === 'image' && b.source?.data);
}

function imageUrl(block: AnthropicBlock): { type: 'image_url'; image_url: { url: string } } {
  const src = block.source ?? {};
  // A URL source passes through; a base64 source becomes a data URL, which is
  // the only image form the chat-completions wire accepts.
  const url = src.type === 'url' && src.url
    ? src.url
    : `data:${src.media_type ?? 'image/png'};base64,${src.data ?? ''}`;
  return { type: 'image_url', image_url: { url } };
}

/** Anthropic content -> OpenAI `content`, as a string when it can be one. */
function toOpenAiContent(content: string | AnthropicBlock[], caps: Capabilities): unknown {
  if (typeof content === 'string') return content;

  const parts: unknown[] = [];
  for (const block of content) {
    if (block.type === 'text' && block.text) {
      parts.push({ type: 'text', text: block.text });
    } else if (block.type === 'image') {
      // A profile that says the model cannot see is telling the truth about a
      // 400 waiting to happen, so describe the image instead of sending it.
      if (caps.vision) parts.push(imageUrl(block));
      else parts.push({ type: 'text', text: '[image omitted: this endpoint does not accept images]' });
    }
    // `thinking` blocks from a previous assistant turn are dropped: they carry
    // an Anthropic signature that means nothing here, and replaying them as
    // text would put the model's private working into its own prompt.
  }

  if (!parts.length) return '';
  // Collapse to a plain string when there is nothing but text. Some gateways
  // reject the array form on a system message, and it is what the CLI sent.
  if (parts.every((p: any) => p.type === 'text')) {
    return parts.map((p: any) => p.text).join('');
  }
  return parts;
}

/**
 * Translate one Anthropic message into the one-or-more OpenAI messages it needs.
 *
 * The fan-out is real and not an optimisation detail:
 *   - a user turn carrying N `tool_result` blocks becomes N `role: "tool"`
 *     messages, because OpenAI carries one result per message;
 *   - an image *inside* a tool result has to follow in a separate user message,
 *     because a `tool` message's content is a string and nothing else. Putting
 *     the pixels in the tool message is a 400; dropping them silently loses the
 *     screenshot the model just asked to look at.
 */
function translateMessage(msg: AnthropicMessage, caps: Capabilities): unknown[] {
  const out: unknown[] = [];
  const content = msg.content;

  if (typeof content === 'string') {
    return [{ role: msg.role, content }];
  }

  const blocks = Array.isArray(content) ? content : [];
  const toolResults = blocks.filter((b) => b.type === 'tool_result');
  const toolUses = blocks.filter((b) => b.type === 'tool_use');

  // A user turn is either tool results or ordinary content.
  if (msg.role === 'user' && toolResults.length) {
    for (const result of toolResults) {
      const resultText = textOf(result.content) || (typeof result.content === 'string' ? result.content : '');
      out.push({
        role: 'tool',
        tool_call_id: result.tool_use_id,
        content: result.is_error && !resultText ? 'Error' : resultText,
      });
      const images = imagesOf(result.content);
      if (images.length && caps.vision) {
        out.push({
          role: 'user',
          content: [
            { type: 'text', text: 'Image returned by the tool call above:' },
            ...images.map(imageUrl),
          ],
        });
      }
    }
    // Anything that was not a tool result still has to be said.
    const rest = blocks.filter((b) => b.type !== 'tool_result');
    if (rest.length) {
      const restContent = toOpenAiContent(rest, caps);
      if (restContent) out.push({ role: 'user', content: restContent });
    }
    return out;
  }

  if (msg.role === 'assistant' && toolUses.length) {
    out.push({
      role: 'assistant',
      // OpenAI wants null, not "", when an assistant turn is only tool calls.
      content: toOpenAiContent(blocks.filter((b) => b.type !== 'tool_use'), caps) || null,
      tool_calls: toolUses.map((u) => ({
        id: u.id,
        type: 'function',
        function: { name: u.name, arguments: JSON.stringify(u.input ?? {}) },
      })),
    });
    return out;
  }

  const translated = toOpenAiContent(blocks, caps);
  // An empty assistant turn would be rejected by several gateways; skip it.
  if (translated === '' && msg.role === 'assistant') return [];
  out.push({ role: msg.role, content: translated });
  return out;
}

/** Anthropic `tool_choice` -> OpenAI `tool_choice`. */
function translateToolChoice(choice: AnthropicRequest['tool_choice']): unknown {
  if (!choice) return undefined;
  switch (choice.type) {
    case 'auto': return 'auto';
    case 'any': return 'required';
    case 'none': return 'none';
    case 'tool': return { type: 'function', function: { name: choice.name } };
    default: return undefined;
  }
}

/**
 * Translate an Anthropic request body into an OpenAI chat-completions body.
 */
export function toOpenAI(request: AnthropicRequest, profile: EndpointProfile): TranslatedRequest {
  const caps = profile.capabilities;
  const warnings: string[] = [];
  const messages: unknown[] = [];

  // --- system -------------------------------------------------------------
  const systemText = typeof request.system === 'string'
    ? request.system
    : textOf(request.system ?? []);

  if (systemText && caps.systemRole === 'message') {
    messages.push({ role: 'system', content: systemText });
  }

  // --- conversation -------------------------------------------------------
  for (const msg of request.messages ?? []) {
    messages.push(...translateMessage(msg, caps));
  }

  if (systemText && caps.systemRole === 'prepend-user') {
    const firstUser = messages.findIndex((m: any) => m.role === 'user');
    const prefix = `${systemText}\n\n`;
    if (firstUser === -1) {
      messages.unshift({ role: 'user', content: systemText });
    } else {
      const target = messages[firstUser] as any;
      target.content = typeof target.content === 'string'
        ? prefix + target.content
        : [{ type: 'text', text: prefix }, ...(target.content ?? [])];
    }
  }

  // --- model --------------------------------------------------------------
  const requestedModel = request.model;
  const mapped = requestedModel ? profile.modelMap?.[requestedModel] : undefined;
  // The profile's `model` is the fallback, not an override: a request that
  // names a model the map does not mention is passed through, because after
  // Phase 5 the picker carries real gateway ids and those are already correct.
  const model = mapped ?? requestedModel ?? profile.model;

  const body: Record<string, unknown> = {
    model,
    messages,
  };

  if (systemText && caps.systemRole === 'top-level') body.system = systemText;

  // --- tools --------------------------------------------------------------
  if (request.tools?.length) {
    if (caps.tools) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          // `input_schema` and `parameters` are the same JSON Schema under
          // different names.
          parameters: t.input_schema ?? { type: 'object', properties: {} },
        },
      }));
      const choice = caps.toolChoice ? translateToolChoice(request.tool_choice) : undefined;
      if (choice !== undefined) body.tool_choice = choice;
      if (request.tool_choice?.disable_parallel_tool_use) body.parallel_tool_calls = false;
      else if (caps.parallelToolCalls) body.parallel_tool_calls = true;
    } else {
      warnings.push(
        `dropped ${request.tools.length} tool definition(s): capabilities.tools is false for "${profile.name}"`,
      );
    }
  }

  // --- sampling -----------------------------------------------------------
  if (typeof request.max_tokens === 'number') {
    // Clamp to what the profile says the endpoint will accept, rather than
    // letting the CLI's Anthropic-sized default become a 400.
    body.max_tokens = Math.min(request.max_tokens, caps.maxOutputTokens);
    if (request.max_tokens > caps.maxOutputTokens) {
      warnings.push(
        `max_tokens ${request.max_tokens} clamped to capabilities.maxOutputTokens ${caps.maxOutputTokens}`,
      );
    }
  }
  if (typeof request.temperature === 'number') body.temperature = request.temperature;
  if (typeof request.top_p === 'number') body.top_p = request.top_p;
  if (request.stop_sequences?.length) body.stop = request.stop_sequences;

  // --- streaming ----------------------------------------------------------
  if (request.stream) {
    body.stream = true;
    // Without this, most OpenAI-compatible servers send no `usage` at all on a
    // streamed turn. The CLI reads those counts to decide when to compact, so
    // omitting it means compaction never fires and a long session eventually
    // dies on a context-overflow 400 instead.
    body.stream_options = { include_usage: true };
  }

  // --- reasoning ----------------------------------------------------------
  // The CLI's effort ladder keeps working client-side whatever the endpoint
  // does; this only decides what reaches the wire. An endpoint that declares
  // no effort support gets no field, and the UI hides the rows to match (B4).
  //
  // CLI 2.1.274, captured against an Anthropic-shaped server for an endpoint
  // model: thinking on sends `thinking:{type:'adaptive'}` + `output_config:
  // {effort}`; thinking off sends the same effort and no `thinking` at all.
  // Reading only a top-level `effort` meant no rung ever reached the gateway
  // (found by the end-to-end run, 2026-09-24), so the effort is read from
  // `output_config` too, and a named effort without `thinking` is thinking off.
  const effort = request.effort ?? request.output_config?.effort;
  const thinking = request.thinking ?? (request.output_config?.effort !== undefined ? { type: 'disabled' } : undefined);
  const reasoning = reasoningFor(effort, thinking, caps);
  if (reasoning.effort) body.reasoning_effort = reasoning.effort;
  warnings.push(...reasoning.warnings);

  // --- profile extras -----------------------------------------------------
  // Merged last so a profile can override anything above, including the
  // reasoning field name on a gateway that spells it differently.
  Object.assign(body, profile.extraBody ?? {});

  // `cache_control` never reaches here: the translation reads only the fields
  // it knows, so the CLI's breakpoints are dropped on the way through. That is
  // required rather than incidental -- an OpenAI-shaped gateway that has never
  // heard of the field rejects the whole request because of it.
  if (caps.promptCaching === 'prefix') {
    warnings.push(...prefixStabilityWarnings(body));
  }

  return { body, requestedModel, warnings };
}
