/**
 * The official streaming assembler, ported from REF/webview/index.js: `y51` (one
 * assembler per parent tool use), `pR1` (one message at a time), `Bj0` (apply a
 * delta) and `Kj0` (parse a tool's streamed input JSON).
 *
 * With `includePartialMessages`, the CLI sends `stream_event`s ahead of each final
 * `assistant` message. Every `content_block_start` becomes its own assistant row
 * holding one partial wrapper, deltas grow that wrapper's content in place, and
 * `content_block_stop` completes it. The final assistant message then replaces
 * the row (`processAndAttachMessage`, the official `ZM`).
 */

import type { ContentBlockType } from './ContentBlock';
import { ContentBlockWrapper } from './ContentBlockWrapper';
import type { Message } from './Message';

/** Creates and appends the row a streamed block goes into (the official `createMessage`). */
export type CreateStreamRow = (betaMessageId: string, parentToolUseId: string | null) => Message;

/**
 * Block types that get a row while streaming. The official skips only `fallback`;
 * Forge renders a narrower set from the final message (`parseMessageContent` drops
 * `redacted_thinking` and shows other types as JSON text), so any other type waits
 * for its final message instead of streaming in as a row the final one can't replace.
 */
const STREAMED_ROW_TYPES = new Set(['text', 'thinking', 'tool_use']);

const PARTIAL_JSON = Symbol('partialJson');

export class StreamAssembler {
  private readonly assemblers = new Map<string, MessageAssembler>();

  constructor(
    private readonly createMessage: CreateStreamRow,
    private readonly onMessageStart?: (betaMessageId: string) => void
  ) {}

  processStreamEvent(event: any, parentToolUseId: string | null): void {
    const key = parentToolUseId ?? 'root';
    let assembler = this.assemblers.get(key);
    if (!assembler) {
      assembler = new MessageAssembler(
        this.createMessage,
        parentToolUseId,
        parentToolUseId === null ? this.onMessageStart : undefined
      );
      this.assemblers.set(key, assembler);
    }
    assembler.processStreamEvent(event);
  }
}

class MessageAssembler {
  private currentMessage: { id: string; content: any[] } | undefined;
  private contentBlocks: ContentBlockWrapper[] = [];

  constructor(
    private readonly createMessage: CreateStreamRow,
    private readonly parentToolUseId: string | null,
    private readonly onMessageStart?: (betaMessageId: string) => void
  ) {}

  private addContentBlock(block: any): void {
    const wrapper = new ContentBlockWrapper(block as ContentBlockType, true);
    this.contentBlocks.push(wrapper);
    if (!this.currentMessage || !STREAMED_ROW_TYPES.has(block?.type)) return;
    const content = this.createMessage(this.currentMessage.id, this.parentToolUseId).message.content;
    if (Array.isArray(content)) content.push(wrapper);
  }

  processStreamEvent(event: any): void {
    switch (event?.type) {
      case 'message_start':
        this.onMessageStart?.(event.message?.id);
        this.currentMessage = { ...event.message, content: [] };
        this.contentBlocks = [];
        break;
      // `message_delta` only carries stop reason and usage; Forge takes usage from
      // the final assistant message, so it is not tracked here.
      case 'content_block_start':
        if (!this.currentMessage) return;
        this.currentMessage.content.push(event.content_block);
        this.addContentBlock(event.content_block);
        break;
      case 'content_block_delta': {
        if (!this.currentMessage) return;
        const wrapper = this.contentBlocks[event.index];
        if (!wrapper) return;
        applyDelta(wrapper.content, event.delta);
        wrapper.updated();
        break;
      }
      case 'content_block_stop': {
        if (!this.currentMessage) return;
        const block = this.currentMessage.content[event.index];
        if (!block) return;
        this.contentBlocks[event.index]?.complete();
        if (block.type === 'tool_use' || block.type === 'server_tool_use') finishToolInput(block);
        break;
      }
      case 'message_stop':
        if (!this.currentMessage) return;
        this.currentMessage = undefined;
        this.contentBlocks = [];
        break;
    }
  }
}

/**
 * The official `Bj0`. It throws on a delta whose type does not match its block;
 * Forge ignores that delta instead, so one malformed event can't end the stream loop.
 */
export function applyDelta(block: any, delta: any): void {
  switch (delta?.type) {
    case 'text_delta':
      if (block.type === 'text') block.text += delta.text;
      break;
    case 'citations_delta':
      if (block.type === 'text') (block.citations ??= []).push(delta.citation);
      break;
    case 'input_json_delta':
      if (block.type === 'tool_use' || block.type === 'server_tool_use') {
        block[PARTIAL_JSON] = (block[PARTIAL_JSON] ?? '') + delta.partial_json;
      }
      break;
    case 'thinking_delta':
      if (block.type === 'thinking') block.thinking += delta.thinking;
      break;
    case 'signature_delta':
      if (block.type === 'thinking') block.signature = delta.signature;
      break;
  }
}

/** The official `Kj0`: parse the streamed input JSON into `input`, or keep the raw text. */
export function finishToolInput(block: any): string | undefined {
  const json = block[PARTIAL_JSON];
  delete block[PARTIAL_JSON];
  if (json === undefined) return 'Tool use block ended without receiving any input JSON data.';
  try {
    block.input = JSON.parse(json);
  } catch (error) {
    block.input = json;
    return `Tool input was not valid JSON and failed to parse with the error: ${error}`;
  }
  return undefined;
}

/**
 * The official partial-text rule `wL0`: while a text block is still streaming,
 * drop its last paragraph, which may end inside an unclosed fence or table.
 */
export function stablePartialText(text: string): string {
  const parts = text.split(/\n\n+/);
  if (parts.length <= 1) return text;
  parts.pop();
  return parts.join('\n\n');
}
