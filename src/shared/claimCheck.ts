/**
 * Claim checker: verify what the final message claims against what actually ran.
 *
 * "Never claim success without evidence" becomes a runtime check rather than a
 * hope. The model's closing summary is parsed for factual claims -- files
 * edited, tests run -- and each is checked against the session's own tool
 * history.
 *
 * This is the port that gains the most from the endpoint work. A 32B model
 * claims completion it did not achieve far more often than Claude does, and on
 * a self-hosted gateway that is the failure mode most likely to waste an hour.
 *
 * Two rules shape the whole design, and both push toward doing *less*:
 *
 *   - **Only cheap, high-signal claims.** Files written and tests run, not
 *     general NLP over prose. A checker that tries to understand every sentence
 *     will be wrong often enough that nobody trusts the ones it gets right.
 *   - **A false "unverified" is worse than no badge at all.** It trains the
 *     reader to ignore the badge, which costs more than never having shown one.
 *     So extraction is conservative, matching is lenient, and the wording says
 *     "no matching tool call" rather than accusing the model of lying.
 */

/** One tool call the session actually made. */
export interface ToolCallRecord {
  name: string;
  input: Record<string, unknown>;
}

export type ClaimKind = 'file-edit' | 'tests-run';

export interface Claim {
  kind: ClaimKind;
  /** What the model said, trimmed, for the tooltip. */
  text: string;
  /** The file path, for a file claim. */
  target?: string;
}

export interface ClaimVerdict {
  claim: Claim;
  verified: boolean;
  /** Which tool call backs it up, when one does. */
  evidence?: string;
}

/** Tools that actually change a file on disk. */
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'str_replace_editor']);

/** Verbs that assert a file was changed. Past tense only: a plan is not a claim. */
const EDIT_VERBS = /\b(?:added|created|wrote|updated|modified|changed|edited|fixed|removed|deleted|renamed|refactored)\b/i;

/**
 * Phrases that mean the model is *not* asserting it did something.
 *
 * Checked before anything else, because "I could not update config.ts" and
 * "I should update config.ts" both contain a path and an edit verb, and
 * flagging either as an unverified claim would be wrong in the worst way --
 * the model was being honest and the badge calls it a liar.
 */
const NOT_A_CLAIM = /\b(?:could not|couldn't|cannot|can't|did not|didn't|was unable|unable to|failed to|will|would|should|could|might|plan to|planning to|going to|next step|todo|to do|if you|you can|you could|consider|recommend|suggest|try)\b/i;

/** Test-runner shapes, in the report and in a command. */
const TEST_CLAIM = /\b(?:tests?|test suite|specs?)\b[^.]{0,60}\b(?:pass(?:ed|ing)?|green|succeed(?:ed)?|ran|run)\b|\b(?:ran|running)\b[^.]{0,20}\b(?:the )?(?:tests?|test suite|specs?)\b/i;
const TEST_COMMAND = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test|\bvitest\b|\bjest\b|\bpytest\b|\bgo test\b|\bcargo test\b|\bmvn test\b|\bgradle test\b|\bmake test\b|\bphpunit\b|\brspec\b|\btox\b/i;

/**
 * A path-looking token.
 *
 * Requires an extension or a separator, so ordinary words are not mistaken for
 * files. Backticked paths are the strongest signal and are preferred.
 */
const PATH_TOKEN = /(?:[\w.@~-]+\/)*[\w.@-]+\.[A-Za-z][\w]{0,9}/g;

function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^www\./i.test(value);
}

/** Normalise for comparison: forward slashes, no leading ./ */
function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

/**
 * Do two paths refer to the same file?
 *
 * Lenient by design: the model routinely writes a repo-relative path where the
 * tool used an absolute one, and treating that as a mismatch would produce a
 * stream of false "unverified" flags. Suffix matching on a full path segment
 * is the honest middle -- `src/a.ts` matches `/home/u/proj/src/a.ts`, but
 * `a.ts` does not match `schema.ts`.
 */
export function pathsMatch(claimed: string, actual: string): boolean {
  const c = normalizePath(claimed);
  const a = normalizePath(actual);
  if (c === a) return true;
  return a.endsWith(`/${c}`) || c.endsWith(`/${a}`);
}

/** Pull path-like tokens out of one line, preferring backticked ones. */
function pathsIn(line: string): string[] {
  const backticked = [...line.matchAll(/`([^`]+)`/g)]
    .map((m) => m[1].trim())
    .filter((t) => !looksLikeUrl(t) && /\.[A-Za-z][\w]{0,9}$/.test(t));
  if (backticked.length) return backticked;

  const bare = line.match(PATH_TOKEN) ?? [];
  return bare
    .map((t) => t.replace(/[.,;:)]+$/, ''))
    .filter((t) => !looksLikeUrl(t))
    // A bare token needs a separator to count: "index.ts" in prose is usually
    // a file, but so is "e.g" and "Node.js", and guessing wrong is the cost.
    .filter((t) => t.includes('/'));
}

/**
 * Extract the claims worth checking from a final message.
 *
 * Works line by line, because a claim and its evidence live in one sentence and
 * spanning lines would only add ways to be wrong.
 */
export function extractClaims(report: string): Claim[] {
  const claims: Claim[] = [];
  const seenPaths = new Set<string>();
  let sawTestClaim = false;
  let inFence = false;

  for (const raw of report.split(/\r?\n/)) {
    const line = raw.trim();

    // Fence state has to be tracked, not just the delimiter skipped: the
    // claims are on the lines *between* the fences, and a code sample or a
    // pasted diff is not the model asserting anything.
    if (/^(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    if (!line) continue;

    // Quoted output is someone else speaking.
    if (line.startsWith('>')) continue;

    if (NOT_A_CLAIM.test(line)) continue;

    if (EDIT_VERBS.test(line)) {
      for (const target of pathsIn(line)) {
        const key = normalizePath(target);
        if (seenPaths.has(key)) continue;
        seenPaths.add(key);
        claims.push({ kind: 'file-edit', text: line, target });
      }
    }

    if (!sawTestClaim && TEST_CLAIM.test(line)) {
      sawTestClaim = true;
      claims.push({ kind: 'tests-run', text: line });
    }
  }

  return claims;
}

/** Every file path a tool call touched. */
function editedPaths(history: ToolCallRecord[]): { path: string; tool: string }[] {
  const out: { path: string; tool: string }[] = [];
  for (const call of history) {
    if (!EDIT_TOOLS.has(call.name)) continue;
    for (const key of ['file_path', 'notebook_path', 'path']) {
      const value = call.input?.[key];
      if (typeof value === 'string' && value) out.push({ path: value, tool: call.name });
    }
  }
  return out;
}

function ranTests(history: ToolCallRecord[]): string | undefined {
  for (const call of history) {
    if (call.name !== 'Bash' && call.name !== 'BashOutput') continue;
    const command = call.input?.command;
    if (typeof command === 'string' && TEST_COMMAND.test(command)) return command;
  }
  return undefined;
}

/** Check each claim against what the session actually did. */
export function verifyClaims(claims: Claim[], history: ToolCallRecord[]): ClaimVerdict[] {
  const edits = editedPaths(history);
  const testCommand = ranTests(history);

  return claims.map((claim) => {
    if (claim.kind === 'tests-run') {
      return testCommand
        ? { claim, verified: true, evidence: `Bash: ${testCommand}` }
        : { claim, verified: false };
    }

    const hit = edits.find((e) => claim.target && pathsMatch(claim.target, e.path));
    return hit
      ? { claim, verified: true, evidence: `${hit.tool}: ${hit.path}` }
      : { claim, verified: false };
  });
}

export interface ClaimSummary {
  claimed: number;
  verified: number;
  verdicts: ClaimVerdict[];
  /** The one-line badge label. */
  label: string;
  /** True when something claimed has no matching tool call. */
  hasUnverified: boolean;
}

/**
 * Summarise for the badge.
 *
 * Returns undefined when there is nothing worth saying -- no claims at all, or
 * every claim verified. A badge that appears on every message is decoration;
 * one that appears only when something does not line up is information.
 */
export function summariseClaims(
  report: string,
  history: ToolCallRecord[],
): ClaimSummary | undefined {
  const claims = extractClaims(report);
  if (!claims.length) return undefined;

  const verdicts = verifyClaims(claims, history);
  const verified = verdicts.filter((v) => v.verified).length;
  const hasUnverified = verified < verdicts.length;
  if (!hasUnverified) return undefined;

  const noun = verdicts.length === 1 ? 'claim' : 'claims';
  return {
    claimed: verdicts.length,
    verified,
    verdicts,
    label: `${verified} of ${verdicts.length} ${noun} verified`,
    hasUnverified,
  };
}

/** Tool calls from a list of assistant message content blocks. */
export function toolCallsFrom(blocks: unknown[]): ToolCallRecord[] {
  const out: ToolCallRecord[] = [];
  for (const block of blocks) {
    const b = block as { type?: string; name?: unknown; input?: unknown };
    if (b?.type !== 'tool_use') continue;
    if (typeof b.name !== 'string') continue;
    out.push({
      name: b.name,
      input: (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>,
    });
  }
  return out;
}
