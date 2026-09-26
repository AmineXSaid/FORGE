/**
 * Recover tool calls a model wrote as text instead of as a tool call.
 *
 * When the serving stack does not parse tool calls -- vLLM started without
 * `--enable-auto-tool-choice --tool-call-parser`, llama.cpp without `--jinja`,
 * a chat template that does not match the model -- the model's tool call
 * arrives as ordinary content in its native markup. The CLI sees a text reply,
 * runs nothing, and the turn ends with the model "saying" what it would do.
 * With a small model that is the usual way a task silently stops.
 *
 * The formats handled are the ones open-weight models actually emit:
 *
 *   Hermes / Qwen2.5 / Qwen3   <tool_call>{"name":…,"arguments":{…}}</tool_call>
 *   Qwen3-Coder (XML)          <function=NAME><parameter=KEY>value</parameter></function>
 *   gpt-oss (Harmony leak)     to=functions.NAME {…}
 *   Mistral                    [TOOL_CALLS][{"name":…,"arguments":{…}}]  or  [TOOL_CALLS]NAME[ARGS]{…}
 *   Llama 3.x                  <|python_tag|>{"name":…,"parameters":{…}}
 *   DeepSeek (raw)             <｜tool▁call▁begin｜>function<｜tool▁sep｜>NAME\n```json\n{…}\n```
 *   whole-reply fenced JSON    ```json\n{"name":…,"arguments":{…}}\n```
 *
 * Only calls whose name resolves to a tool in the request are recovered, so
 * prose that merely *talks about* a tool call is left as prose.
 *
 * alphacode recovers the gpt-oss form only (`agent/response_recovery.rs`
 * `parse_text_wrapped_tool_call`); the others are new here.
 */
import { resolveToolName, type ToolSpec } from './toolRepair';

/** A tool call recovered from text: resolved name and raw argument JSON. */
export interface RecoveredCall {
  name: string;
  arguments: string;
}

/** Text that starts a tool call in one of the handled formats. */
export const TOOL_CALL_MARKERS = [
  '<tool_call>',
  '<function=',
  'to=functions.',
  '[TOOL_CALLS]',
  '<|python_tag|>',
  '<｜tool▁calls▁begin｜>',
  '<｜tool▁call▁begin｜>',
] as const;

/** Longest marker, so a streaming caller knows how much tail to hold back. */
export const MAX_MARKER_LENGTH = Math.max(...TOOL_CALL_MARKERS.map((m) => m.length));

/** Index of the first marker in `text`, or -1. */
export function findMarker(text: string): number {
  let best = -1;
  for (const m of TOOL_CALL_MARKERS) {
    const i = text.indexOf(m);
    if (i !== -1 && (best === -1 || i < best)) best = i;
  }
  return best;
}

/**
 * How many trailing characters of `text` could be the start of a marker, and
 * so must not be flushed yet: `...<tool_c` might become `<tool_call>`.
 */
export function partialMarkerTail(text: string): number {
  for (let n = Math.min(MAX_MARKER_LENGTH - 1, text.length); n > 0; n--) {
    const tail = text.slice(-n);
    if (TOOL_CALL_MARKERS.some((m) => m.startsWith(tail))) return n;
  }
  return 0;
}

/** Does this reply open with a fenced JSON block (the whole-reply form)? */
export function opensWithJsonFence(text: string): boolean {
  return /^\s*```(json)?\s*\n?\s*\{/i.test(text) || /^\s*```(json)?\s*$/i.test(text) || /^\s*`{1,3}$/.test(text);
}

/**
 * Extract the balanced JSON object or array starting at `start`, respecting
 * strings, or undefined when it never closes.
 */
export function balancedJson(text: string, start: number): string | undefined {
  const open = text[start];
  if (open !== '{' && open !== '[') return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

function tryJson(text: string | undefined): any {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** `{name, arguments|parameters|input}` -> a call, if the name is offered. */
function fromNameArgs(obj: any, tools: readonly ToolSpec[]): RecoveredCall | undefined {
  if (!obj || typeof obj !== 'object' || typeof obj.name !== 'string') return undefined;
  const name = resolveToolName(obj.name, tools);
  if (!name) return undefined;
  const args = obj.arguments ?? obj.parameters ?? obj.input ?? obj.args ?? {};
  return { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) };
}

/** Value of an XML `<parameter=KEY>` body: JSON when it parses, else a string. */
function xmlValue(raw: string): unknown {
  const trimmed = raw.replace(/^\n/, '').replace(/\n$/, '');
  const parsed = tryJson(trimmed.trim());
  return parsed !== undefined && typeof parsed !== 'string' ? parsed : trimmed;
}

/**
 * Every tool call in `text`, in order, with the prose around them.
 *
 * @returns the calls and the text with their markup removed, or undefined when
 *   no call in the text names a tool the request offers.
 */
export function recoverToolCalls(
  text: string,
  tools: readonly ToolSpec[],
): { calls: RecoveredCall[]; remainingText: string } | undefined {
  if (!tools.length || !text) return undefined;
  const calls: RecoveredCall[] = [];
  let remaining = text;

  /**
   * Replace each match of `pattern` with the text `extract` says to keep,
   * collecting the calls it found. A match that yields no call is left as it
   * was, so prose that only mentions a tool survives untouched.
   */
  const take = (
    pattern: RegExp,
    extract: (m: string[]) => { calls: RecoveredCall[]; keep?: string },
  ): void => {
    remaining = remaining.replace(pattern, (...args: unknown[]) => {
      // replace() passes (match, ...groups, offset, input).
      const m = args.slice(0, -2) as string[];
      const found = extract(m);
      if (!found.calls.length) return m[0];
      calls.push(...found.calls);
      return found.keep ?? '';
    });
  };

  /** A balanced object at the start of `rest`, plus whatever follows it. */
  const objectAndRest = (rest: string): { json?: string; after: string } => {
    const at = rest.indexOf('{');
    const json = at === -1 ? undefined : balancedJson(rest, at);
    return { json, after: json ? rest.slice(at + json.length) : rest };
  };

  // Hermes / Qwen: the closing tag is optional at the very end of the reply.
  take(/<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/g, (m) => {
    const { json, after } = objectAndRest(m[1]);
    const call = fromNameArgs(tryJson(json), tools);
    return { calls: call ? [call] : [], keep: after.trim() };
  });

  // Qwen3-Coder XML.
  take(/<function=([\w.:-]+)>([\s\S]*?)(?:<\/function>|$)/g, (m) => {
    const name = resolveToolName(m[1], tools);
    if (!name) return { calls: [] };
    const body = m[2].trim();
    if (body.startsWith('{')) {
      const json = balancedJson(body, 0);
      if (json && tryJson(json) !== undefined) return { calls: [{ name, arguments: json }] };
    }
    const args: Record<string, unknown> = {};
    for (const p of body.matchAll(/<parameter=([\w.-]+)>([\s\S]*?)(?:<\/parameter>|(?=<parameter=)|$)/g)) {
      args[p[1]] = xmlValue(p[2]);
    }
    return { calls: [{ name, arguments: JSON.stringify(args) }] };
  });

  // gpt-oss: `to=functions.NAME`, maybe a channel tag, then an object.
  take(/to=functions\.([\w.-]+)([^{]{0,80}?\{[\s\S]*)/g, (m) => {
    const name = resolveToolName(m[1], tools);
    const { json, after } = objectAndRest(m[2]);
    if (!name || !json || tryJson(json) === undefined) return { calls: [] };
    return { calls: [{ name, arguments: json }], keep: after };
  });

  // Mistral: an array of calls, or NAME[ARGS]{...}.
  take(/\[TOOL_CALLS\]\s*([\s\S]*)/g, (m) => {
    const body = m[1].trim();
    if (body.startsWith('[')) {
      const arrText = balancedJson(body, 0);
      const arr = tryJson(arrText);
      const found = Array.isArray(arr)
        ? arr.map((o) => fromNameArgs(o, tools)).filter((c): c is RecoveredCall => !!c)
        : [];
      return { calls: found, keep: arrText ? body.slice(arrText.length) : '' };
    }
    const named = /^([\w.-]+)\[ARGS\]\s*([\s\S]*)/.exec(body);
    if (!named) return { calls: [] };
    const name = resolveToolName(named[1], tools);
    const { json, after } = objectAndRest(named[2]);
    return name && json ? { calls: [{ name, arguments: json }], keep: after } : { calls: [] };
  });

  // Llama 3.x.
  take(/<\|python_tag\|>\s*([\s\S]*)/g, (m) => {
    const { json, after } = objectAndRest(m[1]);
    const call = fromNameArgs(tryJson(json), tools);
    return { calls: call ? [call] : [], keep: after };
  });

  // DeepSeek raw template tokens.
  take(/<｜tool▁call▁begin｜>\s*\w*\s*<｜tool▁sep｜>\s*([\w.-]+)\s*(?:```(?:json)?)?\s*(\{[\s\S]*?\})\s*(?:```)?\s*<｜tool▁call▁end｜>/g, (m) => {
    const name = resolveToolName(m[1], tools);
    return name && tryJson(m[2]) !== undefined ? { calls: [{ name, arguments: m[2] }] } : { calls: [] };
  });

  // A reply that is nothing but one fenced JSON call.
  if (!calls.length) {
    const fenced = /^\s*```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$/i.exec(text);
    const call = fenced ? fromNameArgs(tryJson(fenced[1].trim()), tools) : undefined;
    if (call) return { calls: [call], remainingText: '' };
  }

  if (!calls.length) return undefined;
  const cleaned = remaining
    .replace(/<\/?tool_calls?>|<｜tool▁calls▁(begin|end)｜>|<｜tool▁call▁end｜>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { calls, remainingText: cleaned };
}
