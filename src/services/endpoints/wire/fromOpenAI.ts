/**
 * OpenAI `chat/completions` SSE -> Anthropic `/v1/messages` SSE.
 *
 * This is the half of the bridge that is easy to get subtly wrong, so it is
 * written as an explicit state machine rather than a chain of maps.
 *
 * Two shapes have to be reconciled:
 *
 *   OpenAI            one `choices[0].delta` per chunk; tool arguments arrive
 *                     as fragmented strings keyed by a *tool* index that counts
 *                     only tool calls; `finish_reason` on the last chunk.
 *
 *   Anthropic         an explicitly opened and closed block per piece of
 *                     content, keyed by a *block* index that counts every
 *                     block - text, thinking and tool_use alike - and a
 *                     `message_delta` frame carrying `stop_reason` and `usage`.
 *
 * So the two index spaces are different, and translating one to the other is
 * the job. OpenAI tool index 0 is usually Anthropic block index 1, because a
 * text block took index 0 first - but not if the turn produced no text.
 *
 * Two details carry more weight than their size suggests:
 *
 *   - `finish_reason: "tool_calls"` must become `stop_reason: "tool_use"`.
 *     Anything else and the CLI treats the turn as finished and never runs the
 *     tools the model just asked for, which looks like the model giving up.
 *
 *   - `usage` must reach `message_delta`. The CLI decides when to compact from
 *     those counts; zeros mean compaction never fires and a long session ends
 *     on a context-overflow 400 rather than compacting cleanly.
 */

export interface StreamUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
}

export interface FromOpenAiOptions {
  /** Model id to report in `message_start`, i.e. the one the CLI asked for. */
  model: string;
  /** Which delta field carries reasoning, from `capabilities.reasoningField`. */
  reasoningField?: 'reasoning_content' | 'reasoning' | 'none';
  /**
   * Used when the endpoint reports no usage at all. Compaction needs a number
   * that grows with the conversation far more than it needs an exact one.
   */
  fallbackUsage?: () => StreamUsage;
}

/** One Anthropic SSE frame, ready to write. */
function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * `finish_reason` -> `stop_reason`.
 *
 * `content_filter` has no Anthropic equivalent; `end_turn` is the honest
 * mapping, because the turn did end and the refusal text is the content.
 */
function stopReason(finish: string | null | undefined, sawToolCalls: boolean): string {
  // Checked before the switch: some gateways report `stop` on a turn that did
  // emit tool calls, and trusting that verbatim would strand the tool call.
  // What the model actually did outranks what the gateway said about it.
  if (sawToolCalls) return 'tool_use';
  switch (finish) {
    case 'tool_calls':
    case 'function_call': return 'tool_use';
    case 'length': return 'max_tokens';
    case 'stop': return 'end_turn';
    case 'content_filter': return 'end_turn';
    default: return 'end_turn';
  }
}

interface ToolSlot {
  /** Anthropic block index, which is not the OpenAI tool index. */
  blockIndex: number;
  id: string;
  name: string;
  /** True once `content_block_start` has gone out for this slot. */
  started: boolean;
  /** Buffered argument fragments, so a slot can open late without losing them. */
  buffered: string;
}

/**
 * Stateful translator. Feed it parsed OpenAI chunks; collect Anthropic SSE.
 *
 * Kept as a class because the translation is genuinely stateful - which blocks
 * are open, which index each tool call landed on, whether the message has
 * started - and hiding that in closures made it harder to test, not easier.
 */
export class OpenAiToAnthropicStream {
  private started = false;
  private finished = false;
  /**
   * Set by `finish_reason`; held until the stream really ends.
   *
   * The final `message_delta` cannot go out as soon as `finish_reason` arrives,
   * because the usage frame comes *after* it. That is not an edge case - it is
   * the ordinary OpenAI shape, and what a real gateway sends:
   *
   *     {"choices":[{"delta":{},"finish_reason":"stop"}]}
   *     {"choices":[],"usage":{"prompt_tokens":60,"completion_tokens":31}}
   *     [DONE]
   *
   * Emitting on `finish_reason` therefore reported zero tokens for every
   * streamed turn, which is precisely the failure that stops compaction from
   * ever firing. So the content blocks close immediately and the message frames
   * wait for `end()`.
   */
  private pendingStopReason: string | null = null;
  private nextBlockIndex = 0;
  private textBlock: number | null = null;
  private thinkingBlock: number | null = null;
  private readonly tools = new Map<number, ToolSlot>();
  private sawToolCalls = false;
  private usage: StreamUsage = { input_tokens: 0, output_tokens: 0 };
  private sawUsage = false;
  private messageId = `msg_${Math.random().toString(36).slice(2, 14)}`;

  constructor(private readonly options: FromOpenAiOptions) {}

  /** True once `message_stop` has been emitted, so the relay can stop early. */
  get done(): boolean {
    return this.finished;
  }

  /** Translate one OpenAI chunk into zero or more Anthropic SSE frames. */
  push(chunk: any): string[] {
    if (this.finished) return [];
    const out: string[] = [];

    if (chunk?.id && !this.started) this.messageId = String(chunk.id);

    // Usage is read unconditionally and before the delta branch. The spec-shaped
    // final frame carries `usage` with an empty `choices`, but OpenRouter and
    // others attach it to the last *content* frame instead; a guard that only
    // looked at usage-only frames dropped the counts on those gateways.
    if (chunk?.usage) {
      const u = chunk.usage;
      const input = u.prompt_tokens ?? 0;
      const output = u.completion_tokens ?? 0;
      if (input || output || u.total_tokens) {
        this.sawUsage = true;
        this.usage = {
          input_tokens: input,
          // `total_tokens` is authoritative where it is reported, because it can
          // include reasoning tokens the two components leave out.
          output_tokens: u.total_tokens ? Math.max(0, u.total_tokens - input) : output,
          cache_read_input_tokens: u.prompt_tokens_details?.cached_tokens,
        };
      }
    }

    const choice = chunk?.choices?.[0];
    const delta = choice?.delta;

    // Content is already closed; this frame can only be carrying trailing
    // usage, which was read above.
    if (this.pendingStopReason !== null) return out;

    if (delta) {
      if (!this.started) out.push(...this.start());

      // --- reasoning ------------------------------------------------------
      const field = this.options.reasoningField ?? 'none';
      const reasoning = field !== 'none' ? delta[field] : undefined;
      if (typeof reasoning === 'string' && reasoning) {
        if (this.thinkingBlock === null) {
          out.push(...this.closeTextBlock());
          this.thinkingBlock = this.nextBlockIndex++;
          out.push(frame('content_block_start', {
            type: 'content_block_start',
            index: this.thinkingBlock,
            content_block: { type: 'thinking', thinking: '' },
          }));
        }
        out.push(frame('content_block_delta', {
          type: 'content_block_delta',
          index: this.thinkingBlock,
          delta: { type: 'thinking_delta', thinking: reasoning },
        }));
      }

      // --- text -----------------------------------------------------------
      if (typeof delta.content === 'string' && delta.content) {
        out.push(...this.closeThinkingBlock());
        if (this.textBlock === null) {
          this.textBlock = this.nextBlockIndex++;
          out.push(frame('content_block_start', {
            type: 'content_block_start',
            index: this.textBlock,
            content_block: { type: 'text', text: '' },
          }));
        }
        out.push(frame('content_block_delta', {
          type: 'content_block_delta',
          index: this.textBlock,
          delta: { type: 'text_delta', text: delta.content },
        }));
      }

      // --- tool calls -----------------------------------------------------
      for (const call of delta.tool_calls ?? []) {
        out.push(...this.pushToolCall(call));
      }
    }

    if (choice?.finish_reason) {
      out.push(...this.closeContent(choice.finish_reason));
    }

    return out;
  }

  /**
   * Close out the message.
   *
   * Called when the upstream stream ends. Normally `finish_reason` has already
   * done this; this covers a gateway that simply closes the connection, which
   * would otherwise leave the CLI waiting for a `message_stop` that never came.
   */
  end(): string[] {
    if (this.finished) return [];
    const out: string[] = [];
    if (!this.started) out.push(...this.start());
    if (this.pendingStopReason === null) {
      // No `finish_reason` ever arrived - the gateway just closed. Close the
      // content now so the message is still well-formed.
      out.push(...this.closeContent(this.sawToolCalls ? 'tool_calls' : 'stop'));
    }

    // An endpoint that reports nothing still has to produce a growing number,
    // or the CLI never compacts.
    if (!this.sawUsage && this.options.fallbackUsage) {
      this.usage = this.options.fallbackUsage();
    }

    out.push(frame('message_delta', {
      type: 'message_delta',
      delta: {
        stop_reason: stopReason(this.pendingStopReason, this.sawToolCalls),
        stop_sequence: null,
      },
      usage: this.usage,
    }));
    out.push(frame('message_stop', { type: 'message_stop' }));
    this.finished = true;
    return out;
  }

  private start(): string[] {
    this.started = true;
    return [frame('message_start', {
      type: 'message_start',
      message: {
        id: this.messageId,
        type: 'message',
        role: 'assistant',
        model: this.options.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        // Real counts are not known yet - OpenAI reports usage at the end - so
        // these are placeholders and `message_delta` carries the truth.
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    })];
  }

  private pushToolCall(call: any): string[] {
    const out: string[] = [];
    // `index` is the OpenAI tool index. A gateway that omits it on a single
    // tool call means index 0.
    const toolIndex = typeof call.index === 'number' ? call.index : 0;
    let slot = this.tools.get(toolIndex);

    if (!slot) {
      slot = { blockIndex: -1, id: '', name: '', started: false, buffered: '' };
      this.tools.set(toolIndex, slot);
    }
    if (call.id) slot.id = String(call.id);
    if (call.function?.name) slot.name += String(call.function.name);

    // The block cannot open until the name is known, because Anthropic puts the
    // name in `content_block_start`. Arguments that arrive first are buffered
    // rather than dropped.
    if (!slot.started && slot.name) {
      out.push(...this.closeTextBlock());
      out.push(...this.closeThinkingBlock());
      this.sawToolCalls = true;
      slot.blockIndex = this.nextBlockIndex++;
      slot.started = true;
      out.push(frame('content_block_start', {
        type: 'content_block_start',
        index: slot.blockIndex,
        content_block: {
          type: 'tool_use',
          id: slot.id || `toolu_${this.messageId}_${toolIndex}`,
          name: slot.name,
          input: {},
        },
      }));
      if (slot.buffered) {
        out.push(this.argumentDelta(slot, slot.buffered));
        slot.buffered = '';
      }
    }

    const args = call.function?.arguments;
    if (typeof args === 'string' && args) {
      if (slot.started) out.push(this.argumentDelta(slot, args));
      else slot.buffered += args;
    }
    return out;
  }

  private argumentDelta(slot: ToolSlot, partial: string): string {
    return frame('content_block_delta', {
      type: 'content_block_delta',
      index: slot.blockIndex,
      delta: { type: 'input_json_delta', partial_json: partial },
    });
  }

  private closeTextBlock(): string[] {
    if (this.textBlock === null) return [];
    const index = this.textBlock;
    this.textBlock = null;
    return [frame('content_block_stop', { type: 'content_block_stop', index })];
  }

  private closeThinkingBlock(): string[] {
    if (this.thinkingBlock === null) return [];
    const index = this.thinkingBlock;
    this.thinkingBlock = null;
    // Anthropic signs thinking blocks and the CLI echoes the signature back on
    // the next turn. Nothing here can produce a real signature, so a
    // placeholder goes out to keep the block well-formed; the inbound half
    // strips it again before it reaches the gateway.
    return [
      frame('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'signature_delta', signature: 'forge-bridge-unsigned' },
      }),
      frame('content_block_stop', { type: 'content_block_stop', index }),
    ];
  }

  /**
   * Close every open content block and remember why the turn ended.
   *
   * Deliberately stops short of `message_delta`: see `pendingStopReason`.
   */
  private closeContent(finishReason: string): string[] {
    const out: string[] = [];
    out.push(...this.closeTextBlock());
    out.push(...this.closeThinkingBlock());
    for (const slot of this.tools.values()) {
      if (slot.started) {
        out.push(frame('content_block_stop', { type: 'content_block_stop', index: slot.blockIndex }));
      }
    }
    this.tools.clear();
    this.pendingStopReason = finishReason;
    return out;
  }
}

/**
 * Split an SSE byte stream into `data:` payloads.
 *
 * Written as a pull parser over a running buffer because chunk boundaries fall
 * wherever the network put them - routinely mid-JSON, and on a slow gateway
 * mid-`data:` prefix. Parsing per network chunk instead of per SSE frame is the
 * classic way to lose the last tool call of a turn.
 */
export class SseDecoder {
  private buffer = '';

  /** Feed raw text; get back the complete `data:` payloads it contained. */
  push(text: string): string[] {
    this.buffer += text;
    const payloads: string[] = [];
    // Frames are separated by a blank line; tolerate CRLF from proxies.
    let boundary = this.buffer.search(/\r?\n\r?\n/);
    while (boundary !== -1) {
      const rawEvent = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + this.buffer.slice(boundary).match(/^\r?\n\r?\n/)![0].length);
      const data = rawEvent
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('');
      if (data) payloads.push(data);
      boundary = this.buffer.search(/\r?\n\r?\n/);
    }
    return payloads;
  }
}
