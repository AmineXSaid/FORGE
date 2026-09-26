/**
 * Repair the tool calls small models get slightly wrong.
 *
 * This has to happen in the relay. The CLI checks a tool call *before* any
 * hook sees it: an unknown name comes straight back as `No such tool
 * available: X`, and arguments that do not parse or do not match the schema
 * come back as `InputValidationError`. Each is a wasted round trip, and a
 * small model that gets one often repeats it, so the cheapest fix is to never
 * let the near-miss reach the CLI.
 *
 * Two rules keep the repair honest:
 *
 *   - A name is only ever rewritten to a tool that exists in *this request's*
 *     `tools[]`. Nothing is guessed: a name that matches nothing is left alone,
 *     and the CLI's own error tells the model it was wrong.
 *   - Arguments are only coerced where the tool's own `input_schema` says what
 *     the value should be. A key or type the schema does not mention is left
 *     as the model wrote it.
 *
 * Ported from, and cross-checked against:
 *   - alphacode `alphacode_tool_types` `resolve_tool_name`, `tool/mod.rs`
 *     `resolve_tool_call` (aliases, `functions.` prefix, `X.intent`);
 *   - alphacode `alphacode_message_types` `normalize_input_to_object` and
 *     `tool/serde_coerce.rs` (unwrap double-encoded JSON and `[obj]`, string to
 *     number and boolean);
 *   - claude-code-router (`musistudio/llms`) `utils/toolArgumentsParser.ts`
 *     (JSON, then a lenient repair, then `{}`; the repair is `jsonRepair.ts`);
 *   - OpenCode `session/llm.ts` `experimental_repairToolCall` (case repair).
 */
import { repairJson } from './jsonRepair';

/** The part of an Anthropic tool definition the repair needs. */
export interface ToolSpec {
  name: string;
  input_schema?: unknown;
}

/**
 * Names small models use for Claude Code's tools, from their training on other
 * agents. Keys are normalised (lowercase, alphanumerics only); values are the
 * candidates in preference order, and the first one present in the request
 * wins -- `Agent` and `Task` are both listed because the CLI has used both.
 */
const ALIASES: Record<string, string[]> = {
  bash: ['Bash'], shell: ['Bash'], shellexec: ['Bash'], runshellcommand: ['Bash'],
  executecommand: ['Bash'], runcommand: ['Bash'], terminal: ['Bash'], exec: ['Bash'],
  read: ['Read'], readfile: ['Read'], fileread: ['Read'], view: ['Read'], cat: ['Read'], openfile: ['Read'],
  write: ['Write'], writefile: ['Write'], filewrite: ['Write'], createfile: ['Write'], writetofile: ['Write'],
  edit: ['Edit'], editfile: ['Edit'], fileedit: ['Edit'], strreplace: ['Edit'], replaceinfile: ['Edit'],
  strreplaceeditor: ['Edit'], applyedit: ['Edit'],
  multiedit: ['MultiEdit'],
  grep: ['Grep'], search: ['Grep'], filegrep: ['Grep'], searchfiles: ['Grep'], ripgrep: ['Grep'],
  rg: ['Grep'], searchcode: ['Grep'], agentgrep: ['Grep'],
  glob: ['Glob'], findfiles: ['Glob'], listfiles: ['Glob'], filesearch: ['Glob'],
  todo: ['TodoWrite'], todowrite: ['TodoWrite'], todos: ['TodoWrite'], updatetodos: ['TodoWrite'],
  task: ['Agent', 'Task'], agent: ['Agent', 'Task'], subagent: ['Agent', 'Task'], dispatchagent: ['Agent', 'Task'],
  webfetch: ['WebFetch'], fetch: ['WebFetch'], fetchurl: ['WebFetch'], browse: ['WebFetch'],
  websearch: ['WebSearch'], searchweb: ['WebSearch'],
  notebookedit: ['NotebookEdit'], editnotebook: ['NotebookEdit'],
};

function normalise(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Resolve a model-emitted tool name to one this request actually offers.
 *
 * @returns the exact name to use, or undefined when nothing matches -- in
 *   which case the caller must pass the original through unchanged.
 */
export function resolveToolName(raw: string, tools: readonly ToolSpec[]): string | undefined {
  if (!raw || !tools.length) return undefined;
  const names = tools.map((t) => t.name);
  if (names.includes(raw)) return raw;

  const attempt = (candidate: string): string | undefined => {
    if (!candidate) return undefined;
    if (names.includes(candidate)) return candidate;
    const lower = candidate.toLowerCase();
    const byCase = names.find((n) => n.toLowerCase() === lower);
    if (byCase) return byCase;
    const key = normalise(candidate);
    const byShape = names.find((n) => normalise(n) === key);
    if (byShape) return byShape;
    for (const target of ALIASES[key] ?? []) if (names.includes(target)) return target;
    // An MCP tool whose `mcp__server__` prefix the model dropped, when exactly
    // one offered tool ends with that name.
    const suffixed = names.filter((n) => n.startsWith('mcp__') && normalise(n.split('__').pop() ?? '') === key);
    if (suffixed.length === 1) return suffixed[0];
    return undefined;
  };

  // `functions.Bash`, `tools.Read`: an OpenAI-ism that leaks into the name.
  const unprefixed = raw.trim().replace(/^(functions|function|tools|tool)[.:]/i, '');
  const direct = attempt(unprefixed);
  if (direct) return direct;

  // `Bash.intent`, `read.file`: a trailing segment glued on. Longest head first.
  const dotted = unprefixed.split('.');
  for (let i = dotted.length - 1; i >= 1; i--) {
    const hit = attempt(dotted.slice(0, i).join('.'));
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Other spellings of a schema property, for when the model uses a name from a
 * different agent's version of the same tool. Keyed by the schema's name.
 */
const PROPERTY_ALIASES: Record<string, string[]> = {
  file_path: ['path', 'file', 'filename', 'filepath', 'file_name', 'target_file', 'absolute_path'],
  command: ['cmd', 'script', 'shell_command'],
  pattern: ['query', 'regex', 'search', 'glob_pattern'],
  content: ['text', 'body', 'data', 'file_content', 'contents'],
  old_string: ['old_str', 'old', 'search', 'find', 'old_text'],
  new_string: ['new_str', 'new', 'replace', 'replacement', 'new_text'],
  url: ['link', 'uri', 'href'],
  prompt: ['question', 'instruction'],
};

export interface RepairedArguments {
  /** The arguments, always a JSON object, ready to send as `partial_json`. */
  json: string;
  /** One line per change made, for the output channel. Empty when untouched. */
  notes: string[];
}

/** Parse, leniently: JSON first, then a structural repair. */
function parseLenient(text: string): { value: unknown; repaired: boolean } | undefined {
  try {
    return { value: JSON.parse(text), repaired: false };
  } catch {
    try {
      return { value: JSON.parse(repairJson(text)), repaired: true };
    } catch {
      return undefined;
    }
  }
}

/**
 * Turn whatever the model sent as a tool's arguments into a JSON object that
 * matches the tool's schema as far as the schema can say.
 */
export function repairArguments(raw: string | undefined, schema?: unknown): RepairedArguments {
  const notes: string[] = [];
  const text = (raw ?? '').trim();
  if (!text || text === 'null') {
    return { json: '{}', notes: text === 'null' ? ['arguments were null; sent {}'] : [] };
  }

  const parsed = parseLenient(text);
  if (!parsed) return { json: '{}', notes: ['arguments could not be parsed or repaired; sent {}'] };
  if (parsed.repaired) notes.push('repaired malformed JSON arguments');
  let value = parsed.value;

  // Double-encoded: a JSON string whose content is the real object.
  for (let depth = 0; depth < 3 && typeof value === 'string'; depth++) {
    const inner = parseLenient(value);
    if (!inner) break;
    value = inner.value;
    notes.push('unwrapped double-encoded JSON arguments');
  }
  // `[{...}]` for a single call.
  if (Array.isArray(value) && value.length === 1 && isPlainObject(value[0])) {
    value = value[0];
    notes.push('unwrapped a one-element array around the arguments');
  }
  if (!isPlainObject(value)) {
    return { json: '{}', notes: [...notes, 'arguments were not an object; sent {}'] };
  }

  const args: Record<string, unknown> = { ...value };
  const properties = schemaProperties(schema);
  if (properties) {
    renameToSchema(args, properties, notes);
    coerceToSchema(args, properties, notes);
  }
  return { json: JSON.stringify(args), notes };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function schemaProperties(schema: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(schema)) return undefined;
  const props = schema.properties;
  return isPlainObject(props) ? props : undefined;
}

/**
 * Move a value to the key the schema expects, when the schema's key is absent
 * and the model used an unknown key that is plainly the same thing: the same
 * name in another case or separator style (`filePath`), or a known alias.
 */
function renameToSchema(args: Record<string, unknown>, properties: Record<string, unknown>, notes: string[]): void {
  const known = new Set(Object.keys(properties));
  for (const target of known) {
    if (target in args) continue;
    const targetKey = normalise(target);
    const aliases = new Set((PROPERTY_ALIASES[target] ?? []).map(normalise));
    const source = Object.keys(args).find((k) => !known.has(k) && (normalise(k) === targetKey || aliases.has(normalise(k))));
    if (source === undefined) continue;
    args[target] = args[source];
    delete args[source];
    notes.push(`renamed argument "${source}" to "${target}"`);
  }
}

/** Coerce top-level values to the scalar type the schema declares. */
function coerceToSchema(args: Record<string, unknown>, properties: Record<string, unknown>, notes: string[]): void {
  for (const [key, spec] of Object.entries(properties)) {
    if (!(key in args) || !isPlainObject(spec)) continue;
    const types = ([] as unknown[]).concat(spec.type ?? []);
    const value = args[key];
    const coerced = coerceValue(value, types);
    if (coerced !== undefined && coerced !== value) {
      args[key] = coerced;
      notes.push(`coerced "${key}" to ${types.join('|')}`);
    }
  }
}

function coerceValue(value: unknown, types: unknown[]): unknown {
  if (!types.length || types.includes(typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'number') : typeof value)) {
    return undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((types.includes('integer') || types.includes('number')) && /^-?\d+(\.\d+)?$/.test(trimmed)) {
      const n = Number(trimmed);
      if (types.includes('number') || Number.isInteger(n)) return n;
    }
    if (types.includes('boolean')) {
      if (/^(true|yes|1)$/i.test(trimmed)) return true;
      if (/^(false|no|0)$/i.test(trimmed)) return false;
    }
    if ((types.includes('array') && trimmed.startsWith('[')) || (types.includes('object') && trimmed.startsWith('{'))) {
      const inner = parseLenient(trimmed);
      if (inner && (Array.isArray(inner.value) ? types.includes('array') : isPlainObject(inner.value))) return inner.value;
    }
    return undefined;
  }
  if (types.includes('string') && (typeof value === 'number' || typeof value === 'boolean')) return String(value);
  return undefined;
}
