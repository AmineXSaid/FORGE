/**
 * Minimal shell tokenizer, tuned for risk analysis rather than execution.
 *
 * This deliberately does not implement POSIX shell. It implements just enough
 * to answer "which words are the targets of a destructive command", and it is
 * written to **fail loud rather than quiet**: when it cannot understand
 * something, the caller escalates instead of assuming safety.
 *
 * A regex over the raw string cannot do this job. `rm -rf a && rm -rf b` is two
 * commands; `sh -c "rm -rf ~"` hides one inside a quoted argument; `echo x >
 * important.txt` destroys a file with no destructive verb anywhere in it.
 * Splitting into segments is what makes each of those visible, and chaining
 * would otherwise be a one-character bypass.
 */

export interface Token {
  text: string;
  /**
   * This segment's stdin comes from a pipe, so some of its operands are
   * supplied at runtime by the previous command and cannot be seen here.
   */
  receivesPipe: boolean;
  /** A `>` or `>|` destination, which is truncated when opened. */
  isTruncatingRedirectTarget: boolean;
  /** A control operator like `&&`, which is never a path target. */
  isOperator: boolean;
}

function word(text: string): Token {
  return {
    text,
    receivesPipe: false,
    isTruncatingRedirectTarget: false,
    isOperator: false,
  };
}

/** The command name without its directory, so `/bin/rm` matches `rm`. */
export function basename(token: Token): string {
  const parts = token.text.split('/');
  return parts[parts.length - 1] || token.text;
}

export function isFlag(token: Token): boolean {
  return token.text.startsWith('-') && token.text.length > 1;
}

/** Whether this flag requests recursion, including bundles like `-rf`. */
export function isRecursiveFlag(token: Token): boolean {
  if (!isFlag(token)) return false;
  if (token.text.startsWith('--')) return token.text === '--recursive';
  return token.text.includes('r') || token.text.includes('R');
}

/** Whether this flag forces, including bundles like `-rf`. */
export function isForceFlag(token: Token): boolean {
  if (!isFlag(token)) return false;
  if (token.text.startsWith('--')) return token.text === '--force';
  return token.text.includes('f');
}

const SEGMENT_SEPARATORS = new Set(['&&', '||', ';', '|', '\n']);

/**
 * Tokenize a command line, resolving quotes so `rm "$HOME"` and `rm $HOME`
 * produce the same target text.
 *
 * Note the deliberate asymmetry with a real shell: `$VAR` is kept intact rather
 * than expanded, and the path layer treats an unexpanded variable as
 * unknown-and-therefore-risky. Guessing at an expansion would be worse than
 * admitting the value is not known.
 */
export function tokenize(command: string): Token[] {
  const tokens: Token[] = [];
  let current = '';
  let hasContent = false;
  let pendingRedirect = false;

  const flush = (): void => {
    if (!hasContent) return;
    const token = word(current);
    current = '';
    if (pendingRedirect) {
      token.isTruncatingRedirectTarget = true;
      pendingRedirect = false;
    }
    hasContent = false;
    tokens.push(token);
  };

  const pushOperator = (text: string): void => {
    const op = word(text);
    op.isOperator = true;
    tokens.push(op);
  };

  for (let i = 0; i < command.length; i++) {
    const c = command[i];

    if (c === "'") {
      hasContent = true;
      i += 1;
      while (i < command.length && command[i] !== "'") {
        current += command[i];
        i += 1;
      }
      continue;
    }

    if (c === '"') {
      hasContent = true;
      i += 1;
      while (i < command.length && command[i] !== '"') {
        if (command[i] === '\\' && '"\\$`'.includes(command[i + 1] ?? '')) {
          current += command[i + 1];
          i += 2;
          continue;
        }
        current += command[i];
        i += 1;
      }
      continue;
    }

    if (c === '\\') {
      if (i + 1 < command.length) {
        hasContent = true;
        current += command[i + 1];
        i += 1;
      }
      continue;
    }

    if (c === ' ' || c === '\t') {
      flush();
      continue;
    }

    if (c === '\n' || c === ';') {
      flush();
      pushOperator(c);
      continue;
    }

    if (c === '&' || c === '|') {
      flush();
      let text = c;
      if (command[i + 1] === c) {
        text += c;
        i += 1;
      }
      pushOperator(text);
      continue;
    }

    if (c === '>') {
      flush();
      // `>>` appends and does not truncate, so it is far less destructive;
      // only a single `>` clobbers.
      if (command[i + 1] === '>') {
        i += 1;
      } else {
        if (command[i + 1] === '|') i += 1;
        pendingRedirect = true;
      }
      continue;
    }

    if (c === '<') {
      flush();
      continue;
    }

    hasContent = true;
    current += c;
  }

  flush();
  return tokens;
}

/**
 * Split a command line into command segments, each tokenized.
 *
 * `rm -rf a && rm -rf b` yields two segments so both are assessed. Without
 * this, chaining is a trivial bypass.
 */
export function splitSegments(command: string): Token[][] {
  const segments: Token[][] = [];
  let current: Token[] = [];
  let nextReceivesPipe = false;

  for (const token of tokenize(command)) {
    if (token.isOperator && SEGMENT_SEPARATORS.has(token.text)) {
      if (current.length) {
        segments.push(current);
        current = [];
      }
      // The command after `|` consumes the previous one's output as operands,
      // which this parser cannot see.
      nextReceivesPipe = token.text === '|';
      continue;
    }
    current.push({ ...token, receivesPipe: nextReceivesPipe });
  }

  if (current.length) segments.push(current);
  return segments;
}
