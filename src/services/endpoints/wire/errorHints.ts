/**
 * Add the fix to a tool error the CLI reports without one.
 *
 * Three errors come back from the CLI *without any hook seeing them* --
 * measured against CLI 2.1.283, none of them fires PreToolUse or
 * PostToolUseFailure:
 *
 *   `No such tool available: X`        a tool name the CLI does not know
 *   `InputValidationError: …`           arguments that fail the tool's schema
 *   `String to replace not found …`     an Edit whose old_string is not in the file
 *
 * They are exactly the errors a small model repeats, because none of them says
 * what to do instead. The relay sees every earlier tool result each time the
 * CLI sends the conversation, so it appends one line of fix to each such
 * result on the way to the model. The lesson from alphacode #104 is kept: a
 * bare "did you mean" leaves the model nothing to fall back on when the guess
 * is wrong, so the full tool list goes with it.
 *
 * Hints are cached per tool_use id. The conversation is re-sent every turn and
 * a hint that changed between sends (a file edited since) would break the
 * gateway's prefix cache and contradict what the model saw before.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { closestNames, diceSimilarity } from '../../../shared/similarity';
import type { ToolSpec } from './toolRepair';

/** Hints already computed, by tool_use id. Bounded; oldest dropped first. */
const cache = new Map<string, string | null>();
const CACHE_LIMIT = 4000;

/** Most tool names listed in an unknown-tool hint. */
const MAX_LISTED_TOOLS = 40;

/** Files larger than this are not read for a nearest-line hint. */
const MAX_HINT_FILE_BYTES = 2_000_000;

interface ToolUse {
  name: string;
  input: { file_path?: unknown; old_string?: unknown } | undefined;
}

/** The part of a JSON Schema the validation hint reads. */
interface ObjectSchema {
  properties?: Record<string, { type?: string | string[] }>;
  required?: unknown;
}

/**
 * One request's worth of hinting.
 *
 * Built from the whole message list, because a tool result only carries the
 * id of the call it answers; the call's name and input are in an earlier
 * assistant message.
 */
export class ErrorHinter {
  private readonly uses = new Map<string, ToolUse>();
  private readonly unknownSeen = new Map<string, number>();

  constructor(private readonly tools: readonly ToolSpec[], messages: readonly unknown[]) {
    for (const msg of messages as { role?: string; content?: unknown }[]) {
      if (msg?.role !== 'assistant' || !Array.isArray(msg.content)) continue;
      for (const block of msg.content as { type?: string; id?: unknown; name?: unknown; input?: unknown }[]) {
        if (block?.type === 'tool_use' && typeof block.id === 'string') {
          this.uses.set(block.id, { name: String(block.name ?? ''), input: block.input as ToolUse['input'] });
        }
      }
    }
  }

  /**
   * The hint to append to one tool result, or undefined.
   *
   * Must be called for results in conversation order: an unknown name's
   * escalation counts how many times it has already failed.
   */
  hintFor(toolUseId: string, text: string): string | undefined {
    const unknown = /No such tool available: ([^\s<]+?)(?:[.,]|\s|<|$)/.exec(text);
    if (unknown) {
      const count = (this.unknownSeen.get(unknown[1]) ?? 0) + 1;
      this.unknownSeen.set(unknown[1], count);
    }
    if (cache.has(toolUseId)) return cache.get(toolUseId) ?? undefined;

    let hint: string | undefined;
    if (unknown) hint = this.unknownToolHint(unknown[1]);
    else if (/InputValidationError/.test(text)) hint = this.validationHint(toolUseId, text);
    else if (/String to replace not found|String not found in file/.test(text)) hint = this.editHint(toolUseId);

    cache.set(toolUseId, hint ?? null);
    while (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
    return hint;
  }

  private unknownToolHint(name: string): string {
    const names = this.tools.map((t) => t.name);
    const suggestions = closestNames(name, names);
    const listed = names.slice(0, MAX_LISTED_TOOLS).join(', ') + (names.length > MAX_LISTED_TOOLS ? ', …' : '');
    const count = this.unknownSeen.get(name) ?? 1;
    return (
      `Hint: "${name}" is not a tool in this session.` +
      (suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : '') +
      ` Available tools: ${listed}.` +
      (count >= 2
        ? ` This name has now failed ${count} times; it cannot start working. Stop calling it and use one of the tools above.`
        : '')
    );
  }

  private validationHint(toolUseId: string, text: string): string | undefined {
    const use = this.uses.get(toolUseId);
    const tool = use ? this.tools.find((t) => t.name === use.name) : undefined;
    const schema = tool?.input_schema as ObjectSchema | undefined;
    const props = schema?.properties ?? {};
    const names = Object.keys(props);
    if (!tool || !schema || !names.length) return undefined;

    const required: string[] = Array.isArray(schema.required)
      ? schema.required.filter((r): r is string => typeof r === 'string')
      : [];
    const describe = (k: string) => `${k} (${([] as string[]).concat(props[k]?.type ?? 'any').join('|')})`;
    const parts = [
      `Hint: ${tool.name} takes ${required.length ? `required ${required.map(describe).join(', ')}` : 'no required parameters'}` +
        (names.length > required.length
          ? `; optional ${names.filter((k) => !required.includes(k)).slice(0, 8).map(describe).join(', ')}`
          : '') + '.',
    ];
    for (const m of text.matchAll(/unexpected parameter `([^`]+)`/g)) {
      const near = closestNames(m[1], names, 1);
      if (near.length) parts.push(`\`${m[1]}\` is not a parameter; did you mean \`${near[0]}\`?`);
    }
    return parts.join(' ');
  }

  private editHint(toolUseId: string): string {
    const generic =
      'Hint: old_string must match the file exactly, including whitespace and indentation. ' +
      'Read that part of the file again and copy the text from it.';
    const input = this.uses.get(toolUseId)?.input;
    const file = typeof input?.file_path === 'string' ? input.file_path : undefined;
    const oldString = typeof input?.old_string === 'string' ? input.old_string : undefined;
    if (!file || !oldString || !path.isAbsolute(file)) return generic;
    let content: string;
    try {
      if (fs.statSync(file).size > MAX_HINT_FILE_BYTES) return generic;
      content = fs.readFileSync(file, 'utf8');
    } catch {
      return generic;
    }
    const near = nearestMatch(content, oldString);
    return near ? `${generic} ${near}` : generic;
  }
}

/**
 * Where the text the model meant most probably is, as one sentence.
 *
 * The strategies of alphacode `tool/edit.rs` `try_flexible_match`, in order:
 * the same text once whitespace is trimmed; the same first line with different
 * indentation; otherwise the line most similar to the longest line of
 * old_string, if it is similar enough to be worth naming.
 */
export function nearestMatch(content: string, oldString: string): string | undefined {
  const lines = content.split(/\r?\n/);
  const lineOf = (index: number) => content.slice(0, index).split(/\r?\n/).length;

  const trimmed = oldString.trim();
  if (trimmed && trimmed !== oldString) {
    const at = content.indexOf(trimmed);
    if (at !== -1) return `The text exists with different surrounding whitespace near line ${lineOf(at)}.`;
  }

  const wanted = oldString.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (wanted.length) {
    const first = lines.findIndex((l) => l.trim() === wanted[0]);
    if (first !== -1) {
      return `Its first line is at line ${first + 1} with different indentation: "${clip(lines[first])}".`;
    }
  }

  const longest = wanted.reduce((a, b) => (b.length > a.length ? b : a), '');
  if (longest.length < 12) return undefined;
  let best = { score: 0, index: -1 };
  lines.forEach((line, index) => {
    const score = diceSimilarity(line.trim(), longest);
    if (score > best.score) best = { score, index };
  });
  if (best.score < 0.6) return undefined;
  return `The closest line is ${best.index + 1} (${Math.round(best.score * 100)}% similar): "${clip(lines[best.index])}".`;
}

function clip(text: string): string {
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

/** Test seam: forget cached hints. */
export function clearHintCache(): void {
  cache.clear();
}
