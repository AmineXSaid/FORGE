/**
 * Repair the JSON a small model writes for tool arguments.
 *
 * Deliberately small, and deliberately not a general-purpose repair library:
 * it fixes the handful of mistakes open-weight models actually make in tool
 * arguments, and anything it cannot make valid is reported as unrepairable so
 * the caller can fall back to `{}` and let the tool name the missing field.
 *
 *   single-quoted strings            {'file_path': 'a.ts'}
 *   trailing commas                  {"a": 1,}
 *   a cut-off ending                 {"file_path": "a.ts"           (closed)
 *   Python literals                  True / False / None
 *   unquoted keys and bare words     {file_path: "a.ts"}
 *   raw newlines and tabs in strings "line one
 *                                     line two"
 *   comments                         // …  and  /* … *\/
 *
 * `repairJsonDetailed` is the variant tool arguments go through. It never
 * emits a value the model was cut off in the middle of: when the input ends
 * inside a value, only the complete top-level key/value pairs are kept and the
 * result says `cutOff`, so a required field that was cut is absent and the
 * CLI refuses the call instead of running a prefix of it. This is AlphaCode's
 * `try_recover_truncated_object` / `complete_value_end`
 * (`alphacode_message_types/mod.rs`). `repairJson` keeps closing what was cut.
 *
 * Written in-house rather than taken from `jsonrepair` because adding a
 * dependency here would mean re-resolving the lockfile, and pnpm on another
 * platform re-resolves unrelated peer versions with it. The cases are the ones
 * claude-code-router's `toolArgumentsParser.ts` relies on `jsonrepair` for.
 */

/** What one pass over the input found, beyond the repaired text. */
interface Scan {
  /** The repaired text, before the cut-off ending is closed. */
  out: string;
  /** Containers still open at the end of the input. */
  stack: ('{' | '[')[];
  /** The kind of the first container, when the input starts with one. */
  root: '{' | '[' | undefined;
  /** The root container closed. */
  rootClosed: boolean;
  /** The input ended inside a string. */
  inString: boolean;
  /** `out` up to the end of the last complete top-level pair of a root object. */
  safe: string;
  /** The root object's current pair is complete (a key, a colon and a whole value). */
  tailComplete: boolean;
}

function scan(input: string): Scan {
  let out = '';
  const stack: ('{' | '[')[] = [];
  let i = 0;
  const n = input.length;
  let root: '{' | '[' | undefined;
  let rootClosed = false;
  let inString = false;
  let safe = '';
  let tailComplete = false;
  let sawColon = false;
  let inNumber = false;

  /** Directly inside an unclosed root object. */
  const atRootObject = (): boolean => stack.length === 1 && stack[0] === '{' && !rootClosed;
  /** Drop a comma the output ends with (ignoring whitespace). */
  const dropTrailingComma = (): void => {
    out = out.replace(/,\s*$/, '');
  };

  while (i < n) {
    const c = input[i];
    if (inNumber && !/[-+0-9.eE]/.test(c)) {
      inNumber = false;
      if (atRootObject()) tailComplete = true;
    }

    // --- strings, in either quote --------------------------------------------
    if (c === '"' || c === "'") {
      const quote = c;
      let value = '';
      i++;
      let closed = false;
      while (i < n) {
        const ch = input[i];
        if (ch === '\\' && i + 1 < n) {
          const next = input[i + 1];
          // `\'` is only meaningful inside a single-quoted string; JSON has no such escape.
          value += next === "'" ? "'" : ch + next;
          i += 2;
          continue;
        }
        if (ch === quote) {
          closed = true;
          i++;
          break;
        }
        if (ch === '"') value += '\\"';
        else if (ch === '\n') value += '\\n';
        else if (ch === '\r') value += '\\r';
        else if (ch === '\t') value += '\\t';
        else value += ch;
        i++;
      }
      out += `"${value}"`;
      if (!closed) {
        inString = true;
        break; // cut off mid-string: closed above, containers closed below
      }
      if (atRootObject()) tailComplete = sawColon;
      continue;
    }

    // --- comments ------------------------------------------------------------
    if (c === '/' && input[i + 1] === '/') {
      while (i < n && input[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && input[i + 1] === '*') {
      const end = input.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }

    // --- structure -----------------------------------------------------------
    if (c === '{' || c === '[') {
      if (atRootObject()) tailComplete = false;
      stack.push(c);
      out += c;
      i++;
      if (!root && stack.length === 1) {
        root = c;
        safe = out;
      }
      continue;
    }
    if (c === '}' || c === ']') {
      dropTrailingComma();
      // A closer that matches nothing open is dropped rather than failing.
      if (stack.length && stack[stack.length - 1] === (c === '}' ? '{' : '[')) {
        stack.pop();
        out += c;
        if (stack.length === 0 && root) rootClosed = true;
        else if (atRootObject()) tailComplete = sawColon;
      }
      i++;
      continue;
    }
    if (atRootObject() && c === ':') {
      sawColon = true;
      tailComplete = false;
    } else if (atRootObject() && c === ',') {
      if (tailComplete) safe = out;
      sawColon = false;
      tailComplete = false;
    } else if (atRootObject() && /[-0-9.]/.test(c)) {
      inNumber = true;
      tailComplete = false;
    }

    // --- bare words: literals, Python literals, unquoted keys ------------------
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$.\-]/.test(input[j])) j++;
      const word = input.slice(i, j);
      let k = j;
      while (k < n && /\s/.test(input[k])) k++;
      const isKey = input[k] === ':';
      if (isKey) out += JSON.stringify(word);
      else if (word === 'true' || word === 'True') out += 'true';
      else if (word === 'false' || word === 'False') out += 'false';
      else if (word === 'null' || word === 'None' || word === 'undefined') out += 'null';
      else out += JSON.stringify(word);
      // A word running to the end of the input may itself be cut off.
      if (atRootObject()) tailComplete = !isKey && sawColon && j < n;
      i = j;
      continue;
    }

    out += c;
    i++;
  }
  // A number that ran to the end of the input may be cut off: `tailComplete` stays false.

  return { out, stack, root, rootClosed, inString, safe, tailComplete };
}

/** Close what a cut-off ending left open, and check the result parses. */
function finish(text: string, stack: readonly ('{' | '[')[]): string {
  let out = text.replace(/,\s*$/, '');
  if (/:\s*$/.test(out)) out += 'null';
  for (let k = stack.length - 1; k >= 0; k--) out += stack[k] === '{' ? '}' : ']';
  JSON.parse(out); // throws when the result is still not JSON
  return out;
}

/**
 * Return valid JSON text for `input`, or throw when it cannot be repaired.
 * A cut-off ending is closed, keeping the partial value.
 */
export function repairJson(input: string): string {
  const s = scan(input);
  return finish(s.out, s.stack);
}

export interface DetailedRepair {
  /** Valid JSON text. */
  json: string;
  /**
   * The input ended before it was complete: inside a value, or with the root
   * container still open. Partial values were dropped, not closed.
   */
  cutOff: boolean;
  /** Complete top-level pairs kept, when the root is an object. */
  keptFields?: number;
}

/**
 * Repair `input` like `repairJson`, but never keep a value the input was cut
 * off in. When the root object never closed, only its complete top-level
 * key/value pairs are kept; a root array that never closed becomes `[]`. A
 * root object whose pairs are all complete is kept whole and marked `cutOff`.
 *
 * @throws when the input cannot be made valid.
 */
export function repairJsonDetailed(input: string): DetailedRepair {
  const s = scan(input);
  const cutOff = s.inString || (s.root !== undefined && !s.rootClosed);
  if (!cutOff || s.root === undefined) {
    // Nothing was cut, or the root is a bare value (e.g. a cut-off string,
    // whose content the caller parses again and trims there).
    return { json: finish(s.out, s.stack), cutOff };
  }
  if (s.root === '[') return { json: '[]', cutOff };
  const json = s.tailComplete && !s.inString && s.stack.length === 1 ? finish(s.out, s.stack) : finish(s.safe, ['{']);
  return { json, cutOff, keptFields: Object.keys(JSON.parse(json) as object).length };
}
