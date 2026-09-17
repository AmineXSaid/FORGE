/**
 * Syntax colouring for the command line of a Bash or PowerShell tool call.
 *
 * Not from the official webview: its tool rows print the command as plain text.
 * This is Forge's terminal treatment, so it is deliberately small -- a single
 * pass that tells commands, flags, strings, variables, operators, keywords and
 * comments apart well enough to read at a glance, not a shell parser.
 */

export type ShellKind = 'bash' | 'powershell';

export type TokenKind =
  | 'command'
  | 'keyword'
  | 'flag'
  | 'string'
  | 'variable'
  | 'operator'
  | 'comment'
  | 'number'
  | 'text';

export interface ShellToken {
  kind: TokenKind;
  text: string;
}

const BASH_KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done', 'while', 'until',
  'case', 'esac', 'function', 'select', 'time', 'return', 'export', 'local',
]);

/** Words that run another command: the word after them is a command too. */
const BASH_PREFIXES = new Set(['sudo', 'env', 'nohup', 'exec', 'xargs', 'command', 'builtin', 'time', 'watch']);

const PS_KEYWORDS = new Set([
  'if', 'else', 'elseif', 'foreach', 'for', 'while', 'do', 'until', 'switch', 'function',
  'filter', 'param', 'return', 'try', 'catch', 'finally', 'throw', 'break', 'continue',
  'in', 'begin', 'process', 'end', 'trap', 'exit',
]);

const PS_OPERATOR_WORDS = /^-(eq|ne|gt|ge|lt|le|like|notlike|match|notmatch|contains|notcontains|in|notin|replace|split|join|and|or|not|xor|is|isnot|as|f)$/i;

const NUMBER = /^\d+(\.\d+)?$/;

/** Read a quoted string starting at `start`; returns the index after its closing quote. */
function readQuoted(line: string, start: number): number {
  const quote = line[start];
  let i = start + 1;
  while (i < line.length) {
    if (line[i] === '\\' && quote === '"') {
      i += 2;
      continue;
    }
    // PowerShell escapes with a backtick inside double quotes.
    if (line[i] === '`' && quote === '"') {
      i += 2;
      continue;
    }
    if (line[i] === quote) return i + 1;
    i++;
  }
  return line.length;
}

function push(tokens: ShellToken[], kind: TokenKind, text: string): void {
  if (!text) return;
  const last = tokens[tokens.length - 1];
  if (last && last.kind === kind) last.text += text;
  else tokens.push({ kind, text });
}

/** Keywords that name a loop variable next (`for f in ...`), rather than a command. */
const BASH_LOOP_KEYWORDS = new Set(['for', 'select']);

function tokenizeBash(source: string): ShellToken[] {
  const tokens: ShellToken[] = [];
  let commandPosition = true;
  /** 0: no loop header; 1: the loop variable is next; 2: `in` is next. */
  let loopHeader = 0;
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (ch === '\n') {
      push(tokens, 'text', ch);
      commandPosition = true;
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      push(tokens, 'text', ch);
      i++;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(source[i - 1]))) {
      const end = source.indexOf('\n', i);
      push(tokens, 'comment', source.slice(i, end === -1 ? source.length : end));
      i = end === -1 ? source.length : end;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = readQuoted(source, i);
      push(tokens, 'string', source.slice(i, end));
      commandPosition = false;
      i = end;
      continue;
    }
    if (ch === '$') {
      if (source[i + 1] === '(') {
        push(tokens, 'operator', '$(');
        commandPosition = true;
        i += 2;
        continue;
      }
      if (source[i + 1] === '{') {
        const end = source.indexOf('}', i);
        const stop = end === -1 ? source.length : end + 1;
        push(tokens, 'variable', source.slice(i, stop));
        i = stop;
        continue;
      }
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*|[0-9@#?$!*-])/.exec(source.slice(i));
      if (m) {
        push(tokens, 'variable', m[0]);
        commandPosition = false;
        i += m[0].length;
        continue;
      }
    }
    const op = /^(2>&1|&>|&&|\|\||>>|<<|\|&|[|;&<>()])/.exec(source.slice(i));
    if (op) {
      push(tokens, 'operator', op[0]);
      if (op[0] !== '>' && op[0] !== '>>' && op[0] !== '<' && op[0] !== '<<' && op[0] !== '2>&1' && op[0] !== '&>' && op[0] !== ')') {
        commandPosition = true;
      }
      i += op[0].length;
      continue;
    }
    if (ch === '\\' && source[i + 1] === '\n') {
      push(tokens, 'operator', '\\');
      i++;
      continue;
    }

    // A bare word, up to whitespace, a quote or an operator.
    const word = /^[^\s"'|;&<>()$]+/.exec(source.slice(i))?.[0] ?? ch;
    const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(word);
    if (loopHeader === 1) {
      push(tokens, 'variable', word);
      loopHeader = 2;
      commandPosition = false;
    } else if (loopHeader === 2 && word === 'in') {
      push(tokens, 'keyword', word);
      loopHeader = 0;
    } else if (commandPosition && assignment) {
      push(tokens, 'variable', assignment[1]);
      push(tokens, 'operator', '=');
      push(tokens, 'text', word.slice(assignment[0].length));
    } else if (commandPosition) {
      if (BASH_KEYWORDS.has(word)) {
        push(tokens, 'keyword', word);
        if (BASH_LOOP_KEYWORDS.has(word)) loopHeader = 1;
      } else {
        push(tokens, 'command', word);
        commandPosition = BASH_PREFIXES.has(word);
      }
    } else if (word.startsWith('-')) {
      push(tokens, 'flag', word);
    } else if (NUMBER.test(word)) {
      push(tokens, 'number', word);
    } else {
      push(tokens, 'text', word);
    }
    i += word.length;
  }
  return tokens;
}

function tokenizePowerShell(source: string): ShellToken[] {
  const tokens: ShellToken[] = [];
  let commandPosition = true;
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (ch === '\n') {
      push(tokens, 'text', ch);
      commandPosition = true;
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      push(tokens, 'text', ch);
      i++;
      continue;
    }
    if (ch === '<' && source[i + 1] === '#') {
      const end = source.indexOf('#>', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      push(tokens, 'comment', source.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === '#') {
      const end = source.indexOf('\n', i);
      push(tokens, 'comment', source.slice(i, end === -1 ? source.length : end));
      i = end === -1 ? source.length : end;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = readQuoted(source, i);
      push(tokens, 'string', source.slice(i, end));
      commandPosition = false;
      i = end;
      continue;
    }
    if (ch === '$') {
      const m = /^\$(\{[^}]*\}|[A-Za-z_][A-Za-z0-9_]*(:[A-Za-z_][A-Za-z0-9_]*)?|[?_$^])/.exec(source.slice(i));
      if (m) {
        push(tokens, 'variable', m[0]);
        commandPosition = false;
        i += m[0].length;
        continue;
      }
      if (source[i + 1] === '(') {
        push(tokens, 'operator', '$(');
        commandPosition = true;
        i += 2;
        continue;
      }
    }
    if (ch === '[') {
      const m = /^\[[A-Za-z_][A-Za-z0-9_.]*(\[\])?\]/.exec(source.slice(i));
      if (m) {
        push(tokens, 'keyword', m[0]);
        i += m[0].length;
        continue;
      }
    }
    const op = /^(2>&1|\*>&1|&&|\|\||>>|@\(|@\{|[|;&<>(){},=])/.exec(source.slice(i));
    if (op) {
      push(tokens, 'operator', op[0]);
      if (['|', ';', '&&', '||', '(', '{', '@(', '$(', '&'].includes(op[0])) commandPosition = true;
      i += op[0].length;
      continue;
    }

    const word = /^[^\s"'|;&<>(){},=$]+/.exec(source.slice(i))?.[0] ?? ch;
    if (word.startsWith('-') && word.length > 1 && !NUMBER.test(word.slice(1))) {
      push(tokens, PS_OPERATOR_WORDS.test(word) ? 'operator' : 'flag', word);
    } else if (commandPosition && PS_KEYWORDS.has(word.toLowerCase())) {
      push(tokens, 'keyword', word);
    } else if (commandPosition) {
      push(tokens, 'command', word);
      commandPosition = false;
    } else if (NUMBER.test(word)) {
      push(tokens, 'number', word);
    } else {
      push(tokens, 'text', word);
    }
    i += word.length;
  }
  return tokens;
}

export function tokenizeShell(source: string, shell: ShellKind): ShellToken[] {
  return shell === 'powershell' ? tokenizePowerShell(source) : tokenizeBash(source);
}
