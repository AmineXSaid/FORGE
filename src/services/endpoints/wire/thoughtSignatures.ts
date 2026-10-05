/**
 * Gemini thought signatures, carried across the CLI's round trip.
 *
 * Gemini 3 signs its reasoning. Every function call it makes comes back with
 * an opaque signature, and the next request has to send that signature back
 * on the same call, or the request fails:
 *
 *     400 Function call is missing a thought_signature in functionCall parts.
 *
 * Gateways spell it differently:
 *
 *   Google's OpenAI endpoint  tool_calls[].extra_content.google.thought_signature
 *   LiteLLM                   tool_calls[].provider_specific_fields.thought_signature
 *                             (it also folds it into the call id, which survives
 *                             the round trip on its own)
 *   OpenRouter                message.reasoning_details[] (`reasoning.encrypted`,
 *                             `id` = the tool call id), echoed on the assistant
 *                             message as `reasoning_details`
 *
 * The CLI speaks Anthropic and has no field for any of these. It does echo tool
 * call ids verbatim, so the relay keeps each signature keyed by its call id and
 * puts it back on the way out (`toOpenAI.ts`).
 *
 * A call whose signature was never seen (a session resumed after a restart, a
 * call recovered from text, history from another model) gets Google's
 * documented bypass value instead, on Gemini 3 models only.
 */

/** Google's documented value for a call whose real signature is unavailable. */
export const SKIP_SIGNATURE = 'skip_thought_signature_validator';

/** What one assistant turn left behind for the next request. */
export interface TurnSignatures {
  /** Per tool call id. Gemini signs only the first of parallel calls. */
  signatures: Map<string, string>;
  /** OpenRouter's `reasoning_details`, echoed whole on the assistant message. */
  reasoningDetails?: unknown[];
}

/** Read a signature from one `tool_calls[]` entry, whichever gateway sent it. */
export function signatureOfCall(call: unknown): string | undefined {
  const c = call as {
    extra_content?: { google?: { thought_signature?: unknown } };
    provider_specific_fields?: { thought_signature?: unknown };
    thought_signature?: unknown;
  } | null;
  const sig = c?.extra_content?.google?.thought_signature
    ?? c?.provider_specific_fields?.thought_signature
    ?? c?.thought_signature;
  return typeof sig === 'string' && sig ? sig : undefined;
}

/** Gemini 3 or later: the models that reject an unsigned function call. */
export function requiresSignatures(model: string | undefined): boolean {
  const m = /gemini[-_ ]?(\d+)/i.exec(model ?? '');
  return !!m && Number(m[1]) >= 3;
}

/** Any Gemini: the models that write thoughts as `<thought>` tags. */
export function isGemini(model: string | undefined): boolean {
  return /gemini/i.test(model ?? '');
}

/**
 * Merge streamed `reasoning_details` fragments. OpenRouter streams text
 * details in pieces that share an `index`; encrypted ones arrive whole.
 */
export function mergeReasoningDetails(into: unknown[], fragments: unknown): void {
  if (!Array.isArray(fragments)) return;
  for (const raw of fragments) {
    if (!raw || typeof raw !== 'object') continue;
    const frag = raw as Record<string, unknown>;
    const last = into.at(-1) as Record<string, unknown> | undefined;
    if (last && frag.index !== undefined && last.index === frag.index && last.type === frag.type) {
      for (const key of ['text', 'summary', 'data'] as const) {
        if (typeof frag[key] === 'string') last[key] = String(last[key] ?? '') + frag[key];
      }
      for (const [key, value] of Object.entries(frag)) {
        if (!(key in last)) last[key] = value;
      }
      continue;
    }
    into.push({ ...frag });
  }
}

/**
 * Signatures by tool call id, bounded so a long-lived relay cannot grow
 * without limit. Old entries go first; a session only ever replays its own
 * recent turns' calls with live signatures, and anything older falls back to
 * the bypass value.
 */
export class ThoughtSignatureStore {
  private readonly bySignature = new Map<string, string>();
  private readonly byDetails = new Map<string, unknown[]>();

  constructor(private readonly limit = 4000) {}

  /** Remember what one assistant turn produced, keyed by its tool call ids. */
  remember(callIds: readonly string[], turn: TurnSignatures): void {
    for (const [id, sig] of turn.signatures) this.put(this.bySignature, id, sig);
    if (turn.reasoningDetails?.length) {
      // Keyed by every call of the turn, so whichever survives a compaction
      // still finds them; `detailsFor` dedupes per message.
      for (const id of callIds) this.put(this.byDetails, id, turn.reasoningDetails);
    }
  }

  signatureFor(callId: string | undefined): string | undefined {
    return callId ? this.bySignature.get(callId) : undefined;
  }

  detailsFor(callIds: readonly (string | undefined)[]): unknown[] | undefined {
    for (const id of callIds) {
      const details = id ? this.byDetails.get(id) : undefined;
      if (details) return details;
    }
    return undefined;
  }

  get size(): number {
    return this.bySignature.size;
  }

  private put<T>(map: Map<string, T>, key: string, value: T): void {
    map.delete(key);
    map.set(key, value);
    while (map.size > this.limit) map.delete(map.keys().next().value as string);
  }
}

/** One per extension host; tool call ids are unique across relays. */
export const sharedThoughtSignatures = new ThoughtSignatureStore();

const OPEN = '<thought>';
const CLOSE = '</thought>';

/** How many trailing chars of `text` could be the start of `tag`. */
function partialTail(text: string, tag: string): number {
  for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) {
    if (tag.startsWith(text.slice(-n))) return n;
  }
  return 0;
}

export interface Segment {
  kind: 'thinking' | 'text';
  text: string;
}

/**
 * Splits Gemini's `<thought>…</thought>` content into thinking and text,
 * across chunk boundaries. Google's OpenAI endpoint returns thoughts this way
 * when `include_thoughts` is on; left alone they show up as the reply's text.
 */
export class ThoughtTagSplitter {
  private inThought = false;
  private pending = '';
  /** A tag just closed; the newline after it may arrive in the next chunk. */
  private afterClose = false;

  push(text: string): Segment[] {
    const out: Segment[] = [];
    let buf = this.pending + text;
    this.pending = '';
    if (this.afterClose && buf) {
      // The newline after a closing tag belongs to neither side.
      buf = buf.replace(/^\r?\n/, '');
      this.afterClose = buf === '\r';
    }
    for (;;) {
      const tag = this.inThought ? CLOSE : OPEN;
      const at = buf.indexOf(tag);
      if (at === -1) {
        const keep = partialTail(buf, tag);
        this.emit(out, buf.slice(0, buf.length - keep));
        this.pending = buf.slice(buf.length - keep);
        return out;
      }
      this.emit(out, buf.slice(0, at));
      buf = buf.slice(at + tag.length);
      this.inThought = !this.inThought;
      if (!this.inThought) {
        buf = buf.replace(/^\r?\n/, '');
        this.afterClose = buf === '' || buf === '\r';
      }
    }
  }

  /** Whatever is still held: a partial tag is just text after all. */
  flush(): Segment[] {
    const out: Segment[] = [];
    this.emit(out, this.pending);
    this.pending = '';
    this.afterClose = false;
    return out;
  }

  private emit(out: Segment[], text: string): void {
    if (!text) return;
    const kind = this.inThought ? 'thinking' : 'text';
    const last = out.at(-1);
    if (last?.kind === kind) last.text += text;
    else out.push({ kind, text });
  }
}

/** The non-streamed form: split a whole content string. */
export function splitThoughtTags(text: string): { thinking: string; text: string } {
  const splitter = new ThoughtTagSplitter();
  const segments = [...splitter.push(text), ...splitter.flush()];
  return {
    thinking: segments.filter((s) => s.kind === 'thinking').map((s) => s.text).join(''),
    text: segments.filter((s) => s.kind === 'text').map((s) => s.text).join(''),
  };
}
