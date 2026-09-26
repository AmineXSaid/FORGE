/**
 * Tool failures that name their own fix.
 *
 * A small model that gets a bare error back tends to try the same thing again,
 * or a random variation of it. One line saying what to do next -- and saying
 * it more firmly each time the same kind of failure repeats in a turn -- is
 * the cheapest correction there is. The table and the escalation are
 * alphacode's (`alphacode_app_core/failures.rs`, `tool/mod.rs`
 * `agent_facing_error`), which alphacode itself never wired up; the path
 * suggestions are its `tool/read.rs` "Did you mean".
 *
 * These run in PostToolUseFailure, so they only cover failures that hook is
 * told about. Measured against CLI 2.1.283: a failing Bash command and a Read
 * of a missing file reach it; an unknown tool name, an InputValidationError
 * and an Edit whose old_string is not in the file do not, and are hinted in
 * the relay instead (`endpoints/wire/errorHints.ts`).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { closestNames } from '../../shared/similarity';

type Kind = 'missing-path' | 'command-not-found' | 'bash-exit' | 'permission' | 'timeout' | 'network';

interface Classified {
  kind: Kind;
  hint: string;
}

/** Longest a hint may be; it rides on every failed result. */
const MAX_HINT = 400;

export class FailureHints {
  /** Per session: how often each kind has failed this turn. */
  private readonly counts = new Map<string, Map<Kind, number>>();

  beginTurn(sessionId: string): void {
    this.counts.delete(sessionId);
  }

  clearSession(sessionId: string): void {
    this.counts.delete(sessionId);
  }

  /**
   * The hint for one failure, or undefined when there is nothing useful to add.
   *
   * @param cwd the session's working directory, for resolving relative paths.
   */
  hintFor(sessionId: string, toolName: string, input: unknown, error: string, cwd?: string): string | undefined {
    const classified = classify(toolName, input, error, cwd);
    if (!classified) return undefined;
    let perSession = this.counts.get(sessionId);
    if (!perSession) {
      perSession = new Map();
      this.counts.set(sessionId, perSession);
    }
    const n = (perSession.get(classified.kind) ?? 0) + 1;
    perSession.set(classified.kind, n);
    return (classified.hint + escalation(n)).slice(0, MAX_HINT);
  }
}

/** alphacode failures.rs escalation, verbatim in spirit. */
function escalation(n: number): string {
  if (n <= 1) return '';
  if (n === 2) return ` [${n}x this turn]`;
  if (n === 3) return ` [${n}x this turn — try a different approach]`;
  return ` [${n}x this turn — you MUST try a completely different approach]`;
}

function classify(toolName: string, input: unknown, error: string, cwd?: string): Classified | undefined {
  const lower = error.toLowerCase();
  const rawPath = (input as { file_path?: unknown } | null | undefined)?.file_path;
  const filePath = typeof rawPath === 'string' ? rawPath : undefined;

  if (/file does not exist|no such file or directory|enoent|cannot access/i.test(error)) {
    const missing = filePath ?? /cannot access '([^']+)'/.exec(error)?.[1] ?? /ENOENT[^']*'([^']+)'/.exec(error)?.[1];
    return { kind: 'missing-path', hint: missingPathHint(missing, cwd) };
  }
  if (/command not found|not recognized as an internal or external command/i.test(error)) {
    return {
      kind: 'command-not-found',
      hint: 'Hint: that program is not installed or not on PATH here. Check with `command -v <name>`, ' +
        'or do it another way instead of retrying.',
    };
  }
  if (/permission denied|eacces|eperm|operation not permitted/i.test(lower)) {
    return {
      kind: 'permission',
      hint: 'Hint: permission denied — retrying will not help. Use a path inside the workspace, or ask the user.',
    };
  }
  if (/timed out|timeout|etimedout/i.test(lower)) {
    return {
      kind: 'timeout',
      hint: 'Hint: this timed out. Retry at most once; then report it and continue with other work.',
    };
  }
  if (/econnrefused|enotfound|eai_again|fetch failed|network/i.test(lower)) {
    return {
      kind: 'network',
      hint: 'Hint: the network request failed. Check the URL; retry at most once, then report it and continue.',
    };
  }
  if (toolName === 'Bash' && /exit code \d+/i.test(error)) {
    return {
      kind: 'bash-exit',
      hint: "Hint: read the command's error output above and fix the cause; do not re-run the same command unchanged.",
    };
  }
  return undefined;
}

/**
 * "Did you mean" for a path that does not exist: the closest names in its
 * directory, or, when the directory itself is missing, the nearest one that
 * does exist.
 */
export function missingPathHint(missing: string | undefined, cwd?: string): string {
  const generic = 'Hint: that path does not exist. List the parent directory (Glob, or `ls`) and use an exact name from it; do not guess another path.';
  if (!missing) return generic;
  const absolute = path.isAbsolute(missing) ? missing : cwd ? path.resolve(cwd, missing) : undefined;
  if (!absolute) return generic;

  let dir = path.dirname(absolute);
  try {
    if (fs.statSync(dir).isDirectory()) {
      const names = fs.readdirSync(dir).slice(0, 5000);
      const near = closestNames(path.basename(absolute), names);
      if (near.length) {
        return `Hint: ${missing} does not exist. Did you mean: ${near.map((n) => path.join(dir, n)).join(', ')}?`;
      }
      return `${generic.replace('that path does not exist.', `${missing} does not exist, and nothing in ${dir} has a similar name.`)}`;
    }
  } catch {
    // Fall through to the nearest existing ancestor.
  }
  for (let i = 0; i < 20 && dir !== path.dirname(dir); i++) {
    dir = path.dirname(dir);
    try {
      if (fs.statSync(dir).isDirectory()) {
        return `Hint: ${missing} does not exist; the nearest existing directory is ${dir}. List it before choosing a path.`;
      }
    } catch {
      // keep walking up
    }
  }
  return generic;
}

/** The hints the extension host uses. */
export const failureHints = new FailureHints();
