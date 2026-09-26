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
 * Written in-house rather than taken from `jsonrepair` because adding a
 * dependency here would mean re-resolving the lockfile, and pnpm on another
 * platform re-resolves unrelated peer versions with it. The cases are the ones
 * claude-code-router's `toolArgumentsParser.ts` relies on `jsonrepair` for.
 */

/**
 * Return valid JSON text for `input`, or throw when it cannot be repaired.
 */
export function repairJson(input: string): string {
  let out = '';
  const stack: ('{' | '[')[] = [];
  let i = 0;
  const n = input.length;

  /** Drop a comma the output ends with (ignoring whitespace). */
  const dropTrailingComma = (): void => {
    out = out.replace(/,\s*$/, '');
  };

  while (i < n) {
    const c = input[i];

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
      if (!closed) break; // cut off mid-string: closed above, containers closed below
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
      stack.push(c);
      out += c;
      i++;
      continue;
    }
    if (c === '}' || c === ']') {
      dropTrailingComma();
      // A closer that matches nothing open is dropped rather than failing.
      if (stack.length && stack[stack.length - 1] === (c === '}' ? '{' : '[')) {
        stack.pop();
        out += c;
      }
      i++;
      continue;
    }

    // --- bare words: literals, Python literals, unquoted keys ------------------
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$.\-]/.test(input[j])) j++;
      const word = input.slice(i, j);
      let k = j;
      while (k < n && /\s/.test(input[k])) k++;
      if (input[k] === ':') out += JSON.stringify(word);
      else if (word === 'true' || word === 'True') out += 'true';
      else if (word === 'false' || word === 'False') out += 'false';
      else if (word === 'null' || word === 'None' || word === 'undefined') out += 'null';
      else out += JSON.stringify(word);
      i = j;
      continue;
    }

    out += c;
    i++;
  }

  // --- a cut-off ending --------------------------------------------------------
  dropTrailingComma();
  if (/:\s*$/.test(out)) out += 'null';
  while (stack.length) out += stack.pop() === '{' ? '}' : ']';

  JSON.parse(out); // throws when the result is still not JSON
  return out;
}
