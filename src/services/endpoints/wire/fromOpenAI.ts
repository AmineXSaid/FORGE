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

import { repairArguments, resolveToolName, type ToolSpec } from './toolRepair';
import { RepetitionDetector } from './repetition';
import {
  findMarker,
  opensWithJsonFence,
  partialMarkerTail,
  recoverToolCalls,
  type RecoveredCall,
} from './textToolCalls';

export interface StreamUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
}

export interface FromOpenAiOptions {
  /** Model id to report in `message_start`, i.e. the one the CLI asked for. */
  model: string;
  /**
   * The request's tool definitions. When present, tool names are resolved
   * against them, arguments are repaired against their schemas, and tool calls
   * written as text are recovered. See `toolRepair.ts`, `textToolCalls.ts`.
   */
  tools?: readonly ToolSpec[];
  /** Told about every repair, one line each, for the output channel. */
  onRepair?: (note: string) => void;
  /**
   * Stop the reply once its text starts repeating itself (`repetition.ts`).
   * The relay then stops reading from the gateway, which on most servers also
   * stops the generation.
   */
  stopRepetition?: boolean;
  /**
   * Forced tool mode's exit tool (`toOpenAI.ts` EXIT_TOOL_NAME). A call to it
   * is not a tool call: its `response` is the reply's text.
   */
  exitTool?: string;
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

/**
 * One tool call being assembled from its fragments.
 *
 * Nothing about a call is emitted until the model's message closes, and that
 * is deliberate: the name has to be resolved against the request's tools and
 * the arguments repaired as a whole, and neither can be done to half a call.
 * The CLI only runs a tool once its block has closed anyway, so holding the
 * fragments costs nothing a user can see.
 */
interface ToolSlot {
  /** The OpenAI tool index it arrived on, for the fallback id. */
  toolIndex: number;
  id: string;
  name: string;
  args: string;
}

/** One `delta.tool_calls[]` entry, as loosely as gateways send it. */
interface OpenAiToolCallDelta {
  index?: number;
  id?: unknown;
  function?: { name?: unknown; arguments?: unknown };
}

/** Hold back this much text while it could still become a tool-call marker. */
const FENCE_DECISION_CHARS = 12;

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
  /** Calls still receiving fragments, keyed by OpenAI tool index. */
  private readonly openSlots = new Map<number, ToolSlot>();
  /** Every call in arrival order, including one displaced by index reuse. */
  private readonly slots: ToolSlot[] = [];
  /** Fallback ids for calls that arrived without one. */
  private toolCounter = 0;
  /** Text not yet written, because it may still become a tool-call marker. */
  private pendingText = '';
  /** Text from a tool-call marker on, parsed when the message closes. */
  private heldText: string | null = null;
  /** Whether any text has gone out yet; decides the whole-reply fence case. */
  private wroteText = false;
  private readonly repetition: RepetitionDetector | undefined;
  private stoppedRepeating = false;
  private sawToolCalls = false;
  private usage: StreamUsage = { input_tokens: 0, output_tokens: 0 };
  private sawUsage = false;
  private messageId = `msg_${Math.random().toString(36).slice(2, 14)}`;

  constructor(private readonly options: FromOpenAiOptions) {
    this.repetition = options.stopRepetition ? new RepetitionDetector() : undefined;
  }

  /** True once the reply was cut off for repeating itself; the relay stops reading. */
  get repeating(): boolean {
    return this.stoppedRepeating;
  }

  /** True once `message_stop` has been emitted, so the relay can stop early. */
  get done(): boolean {
    return this.finished;
  }

  /**
   * Prompt tokens the gateway itself reported, or undefined if it reported
   * none. Never the fallback estimate: the truncation check compares the two,
   * and comparing the estimate with itself would prove nothing.
   */
  get reportedInputTokens(): number | undefined {
    return this.sawUsage ? this.usage.input_tokens : undefined;
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
          // Text held only as marker look-ahead belongs before the thinking.
          if (this.heldText === null && this.pendingText) {
            out.push(...this.writeText(this.pendingText));
            this.pendingText = '';
          }
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
        out.push(...this.acceptText(delta.content));
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
        // A gateway that said tool_calls but produced no usable call must not
        // leave the CLI waiting on a tool_use that has no block.
        stop_reason: stopReason(
          !this.sawToolCalls && /^(tool_calls|function_call)$/.test(this.pendingStopReason ?? '')
            ? 'stop'
            : this.pendingStopReason,
          this.sawToolCalls,
        ),
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

  /**
   * Take one text delta, holding back only what could still be a tool call.
   *
   * Without `tools` there is nothing to recover into, so text is written as it
   * arrives. With them, a short tail that might be the start of a marker waits
   * for the next chunk; once a marker appears, everything from it on is held
   * until the message closes and `recoverToolCalls` decides what it was. A
   * reply that *opens* with a JSON fence is held whole, since that is the one
   * format with no marker of its own.
   */
  private acceptText(text: string): string[] {
    if (!this.options.tools?.length) return this.writeText(text);
    if (this.heldText !== null) {
      this.heldText += text;
      return [];
    }
    this.pendingText += text;

    if (!this.wroteText && this.pendingText.trimStart().startsWith('`')) {
      if (this.pendingText.trimStart().length < FENCE_DECISION_CHARS) return [];
      if (opensWithJsonFence(this.pendingText)) {
        this.heldText = this.pendingText;
        this.pendingText = '';
        return [];
      }
    }

    const at = findMarker(this.pendingText);
    if (at !== -1) {
      const before = this.pendingText.slice(0, at);
      this.heldText = this.pendingText.slice(at);
      this.pendingText = '';
      return before ? this.writeText(before) : [];
    }
    const keep = partialMarkerTail(this.pendingText);
    const flush = this.pendingText.slice(0, this.pendingText.length - keep);
    this.pendingText = this.pendingText.slice(this.pendingText.length - keep);
    return flush ? this.writeText(flush) : [];
  }

  /** Write text into the open text block, opening one if needed. */
  private writeText(text: string): string[] {
    if (!text || this.stoppedRepeating) return [];
    if (this.repetition?.push(text)) {
      this.stoppedRepeating = true;
      this.note('stopped a reply that kept repeating the same text');
      text += '\n\n[Forge stopped this reply because it kept repeating the same text.]';
    }
    const out: string[] = [];
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
      delta: { type: 'text_delta', text },
    }));
    this.wroteText = true;
    return out;
  }

  /**
   * Resolve whatever text is still held: recovered tool calls, or plain text.
   * Recovery only runs when the model made no native call this message.
   */
  private finishText(): string[] {
    const held = this.heldText;
    const pending = this.pendingText;
    this.heldText = null;
    this.pendingText = '';
    if (held === null) return this.writeText(pending);

    const whole = held + pending;
    const native = this.slots.some((s) => s.name);
    const recovered = native ? undefined : recoverToolCalls(whole, this.options.tools ?? []);
    if (!recovered) return this.writeText(whole);

    this.note(
      `recovered ${recovered.calls.length} tool call(s) the model wrote as text: ` +
      recovered.calls.map((c: RecoveredCall) => c.name).join(', '),
    );
    for (const call of recovered.calls) {
      this.slots.push({ toolIndex: this.slots.length, id: '', name: call.name, args: call.arguments });
    }
    this.sawToolCalls = true;
    return this.writeText(recovered.remainingText);
  }

  private pushToolCall(call: OpenAiToolCallDelta): string[] {
    // `index` is the OpenAI tool index. A gateway that omits it on a single
    // tool call means index 0.
    const toolIndex = typeof call.index === 'number' ? call.index : 0;
    const id = call.id ? String(call.id) : '';
    let slot = this.openSlots.get(toolIndex);

    // Some gateways send parallel calls all on index 0, and the only sign of
    // the second one is a new id. Appending it to the first would merge two
    // calls' arguments into one object that matches neither.
    if (slot && id && slot.id && id !== slot.id) slot = undefined;
    if (!slot) {
      slot = { toolIndex, id: '', name: '', args: '' };
      this.openSlots.set(toolIndex, slot);
      this.slots.push(slot);
    }
    if (id && !slot.id) slot.id = id;

    // The spec sends the name once. Some gateways split it across chunks and
    // others repeat it in every chunk; append a fragment, ignore a repeat.
    const name = call.function?.name;
    if (typeof name === 'string' && name && name !== slot.name) slot.name += name;

    const args = call.function?.arguments;
    if (typeof args === 'string') slot.args += args;
    else if (args && typeof args === 'object') slot.args += JSON.stringify(args);

    if (slot.name) this.sawToolCalls = true;
    return [];
  }

  /**
   * Emit every assembled call as a complete tool_use block.
   *
   * Names are resolved and arguments repaired against the request's tools
   * here, once each call is whole. A call with no name at all is dropped: no
   * tool can run it, and a nameless tool_use block breaks the CLI's parser.
   */
  private emitToolCalls(): string[] {
    const out: string[] = [];
    const tools = this.options.tools ?? [];
    let emitted = 0;
    for (const slot of this.slots) {
      if (!slot.name) {
        this.note(`dropped a tool call with no name (arguments: ${slot.args.slice(0, 80)})`);
        continue;
      }
      const resolved = tools.length ? resolveToolName(slot.name, tools) : undefined;
      if (resolved && resolved !== slot.name) this.note(`tool name "${slot.name}" -> "${resolved}"`);
      const name = resolved ?? slot.name;

      let json = slot.args;
      if (tools.length) {
        const repaired = repairArguments(slot.args, tools.find((t) => t.name === name)?.input_schema);
        for (const n of repaired.notes) this.note(`${name}: ${n}`);
        json = repaired.json;
      }

      const index = this.nextBlockIndex++;
      out.push(frame('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: {
          type: 'tool_use',
          id: slot.id || `toolu_${this.messageId}_${this.toolCounter++}`,
          name,
          input: {},
        },
      }));
      if (json) {
        out.push(frame('content_block_delta', {
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: json },
        }));
      }
      out.push(frame('content_block_stop', { type: 'content_block_stop', index }));
      emitted++;
    }
    this.slots.length = 0;
    this.openSlots.clear();
    this.sawToolCalls = emitted > 0;
    return out;
  }

  /**
   * Remove forced tool mode's exit calls from the assembled calls, returning
   * the answer each one carried. What is left is emitted as real tool calls.
   */
  private takeExitCalls(): string[] {
    const exit = this.options.exitTool;
    if (!exit) return [];
    const texts: string[] = [];
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const slot = this.slots[i];
      if (slot.name !== exit && resolveToolName(slot.name, [{ name: exit }]) !== exit) continue;
      const args = JSON.parse(repairArguments(slot.args).json) as { response?: unknown };
      texts.unshift(typeof args.response === 'string' ? args.response : JSON.stringify(args.response ?? ''));
      this.slots.splice(i, 1);
    }
    return texts;
  }

  private note(message: string): void {
    this.options.onRepair?.(message);
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
    const exits = this.takeExitCalls();
    out.push(...this.finishText());
    for (const text of exits) out.push(...this.writeText(text));
    out.push(...this.closeTextBlock());
    out.push(...this.closeThinkingBlock());
    out.push(...this.emitToolCalls());
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
