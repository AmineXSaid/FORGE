/**
 * Smart stream: filter high-volume tool output down to high-signal lines.
 *
 * Raw command output -- build logs, fuzzer runs, large greps -- floods the
 * context with thousands of lines of noise. On Anthropic's 200k window that is
 * wasteful; on a 32k self-hosted model it ends the session.
 *
 * Which is why **the threshold is derived from `capabilities.contextWindow`
 * rather than hardcoded**. A 32k model needs aggressive filtering where a 200k
 * one needs almost none, and a single constant would be wrong for both. This is
 * the cleanest example of capability-driven behaviour in the endpoint work.
 *
 * Two rules the filter holds to:
 *
 *   - **Nothing is silently dropped.** Every elision is replaced by a line
 *     saying what went and how much of it, because a model that cannot see the
 *     output at least needs to know it was abridged, and a user reading the
 *     transcript needs the same.
 *   - **The full text is kept host-side.** The filter truncates only what goes
 *     to the model and to the DOM. A4's claim checker verifies claims against
 *     tool history, and filtering away the evidence it checks would make the
 *     checker report failures that did not happen.
 */

export interface FilterBudget {
  /** Characters the filtered text may occupy. */
  maxChars: number;
  /** Lines the filtered text may contain. */
  maxLines: number;
}

/**
 * Derive a filter budget from the model's context window.
 *
 * One tool result may use about a tenth of the window. That leaves room for the
 * system prompt, the tool definitions, the conversation so far, and the several
 * more tool calls a turn usually makes -- a single result taking a quarter of
 * the window is how a turn runs out of room three calls later.
 *
 * Four characters per token is the usual English approximation, and tool output
 * is denser than prose, so this errs toward filtering slightly more than
 * strictly necessary.
 */
export function budgetFor(contextWindow: number): FilterBudget {
  const window = Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : 32_000;
  const tokenBudget = Math.floor(window * 0.1);
  return {
    maxChars: Math.max(2_000, tokenBudget * 4),
    // Roughly proportional, and floored so even a tiny window keeps enough
    // lines to be useful rather than degenerating into a summary.
    maxLines: Math.max(60, Math.floor(window / 160)),
  };
}

/** Lines worth keeping even when almost everything else goes. */
const HIGH_SIGNAL = [
  /\berror\b/i,
  /\bfatal\b/i,
  /\bpanic\b/i,
  /\bfail(ed|ure|s)?\b/i,
  /\bdenied\b/i,
  /\bwarning\b/i,
  /\bdeprecated\b/i,
  /\bcritical\b/i,
  /\bexception\b/i,
  /\btraceback\b/i,
  /\bassert(ion)?\b/i,
  /\bcannot\b/i,
  /\bunable to\b/i,
  /\bnot found\b/i,
  /\bpermission\b/i,
  /^\s*[-+]{3}\s/,          // diff headers
  /^\s*@@ /,                // hunk headers
  /\b\d+ (passed|failed|skipped|errors?)\b/i,
  /\bexit (code|status) \d+/i,
];

export function isHighSignal(line: string): boolean {
  return HIGH_SIGNAL.some((re) => re.test(line));
}

/**
 * A key that collapses lines differing only by a counter, timestamp or address.
 *
 * This is what makes dedup useful on real logs: ten thousand lines of
 * `[00:12:43] processed item 8231` are one fact repeated, not ten thousand
 * facts. Exact-match dedup would keep every one of them.
 */
export function similarityKey(line: string): string {
  return line
    .replace(/0x[0-9a-f]+/gi, '0x#')
    .replace(/\b[0-9a-f]{8,}\b/gi, '#hash')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface FilterStats {
  originalLines: number;
  originalChars: number;
  keptLines: number;
  /** Lines removed because an earlier line said the same thing. */
  duplicateLines: number;
  /** Lines removed to fit the budget. */
  elidedLines: number;
}

export interface FilterResult {
  /** What the model and the transcript see. */
  text: string;
  /** False when the output was small enough to pass through untouched. */
  filtered: boolean;
  stats: FilterStats;
}

/**
 * Filter one tool's output to fit a budget.
 *
 * Output under budget is returned byte-identical: most tool calls are small,
 * and rewriting them would be pure risk for no gain.
 */
export function filterToolOutput(text: string, budget: FilterBudget): FilterResult {
  const originalChars = text.length;
  const lines = text.split(/\r?\n/);
  const originalLines = lines.length;

  const unfiltered = (): FilterResult => ({
    text,
    filtered: false,
    stats: {
      originalLines, originalChars, keptLines: originalLines,
      duplicateLines: 0, elidedLines: 0,
    },
  });

  if (originalChars <= budget.maxChars && originalLines <= budget.maxLines) {
    return unfiltered();
  }

  // ── 1. collapse runs of blank lines and near-duplicate lines ────────────
  interface Kept { text: string; index: number; signal: boolean; repeats: number; }
  const kept: Kept[] = [];
  const seen = new Map<string, Kept>();
  let blankRun = 0;
  let duplicateLines = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      blankRun += 1;
      if (blankRun > 2) continue;
      kept.push({ text: line, index: i, signal: false, repeats: 1 });
      continue;
    }
    blankRun = 0;

    const signal = isHighSignal(line);
    // Error lines are never deduplicated: the same assertion failing in twenty
    // places is twenty facts, and collapsing them hides nineteen.
    if (signal) {
      kept.push({ text: line, index: i, signal: true, repeats: 1 });
      continue;
    }

    const key = similarityKey(line);
    const prior = seen.get(key);
    if (prior) {
      prior.repeats += 1;
      duplicateLines += 1;
      continue;
    }
    const entry: Kept = { text: line, index: i, signal: false, repeats: 1 };
    seen.set(key, entry);
    kept.push(entry);
  }

  const render = (entry: Kept): string =>
    entry.repeats > 1
      ? `${entry.text}    … and ${entry.repeats - 1} similar line(s)`
      : entry.text;

  // ── 2. if dedup was enough, stop here ───────────────────────────────────
  let body = kept.map(render);
  if (body.length <= budget.maxLines && body.join('\n').length <= budget.maxChars) {
    return {
      text: withNotice(body.join('\n'), { originalLines, duplicateLines, elidedLines: 0 }),
      filtered: true,
      stats: {
        originalLines, originalChars, keptLines: body.length, duplicateLines, elidedLines: 0,
      },
    };
  }

  // ── 3. keep the head, the tail, and every high-signal line between ──────
  // Head and tail because a log's beginning says what ran and its end says how
  // it finished; both are where a reader looks first.
  const headCount = Math.floor(budget.maxLines * 0.3);
  const tailCount = Math.floor(budget.maxLines * 0.3);
  const middleAllowance = Math.max(0, budget.maxLines - headCount - tailCount);

  const head = kept.slice(0, headCount);
  const tail = kept.slice(Math.max(headCount, kept.length - tailCount));
  const middle = kept.slice(head.length, kept.length - tail.length);
  const middleSignal = middle.filter((e) => e.signal).slice(0, middleAllowance);

  const elidedLines = middle.length - middleSignal.length;

  const parts: string[] = [...head.map(render)];
  if (elidedLines > 0 || middleSignal.length) {
    parts.push(
      middleSignal.length
        ? `… ${elidedLines} line(s) hidden; the ${middleSignal.length} error/warning line(s) among them follow …`
        : `… ${elidedLines} line(s) hidden …`,
    );
    parts.push(...middleSignal.map(render));
    if (middleSignal.length) parts.push('… end of preserved error/warning lines …');
  }
  parts.push(...tail.map(render));

  body = parts;
  let out = body.join('\n');

  // ── 4. hard character cap, applied last ─────────────────────────────────
  if (out.length > budget.maxChars) {
    const half = Math.floor((budget.maxChars - 120) / 2);
    out = `${out.slice(0, half)}\n… ${out.length - budget.maxChars} character(s) cut to fit the context budget …\n${out.slice(-half)}`;
  }

  return {
    text: withNotice(out, { originalLines, duplicateLines, elidedLines }),
    filtered: true,
    stats: {
      originalLines, originalChars, keptLines: body.length, duplicateLines, elidedLines,
    },
  };
}

/**
 * Say what was done, at the top, always.
 *
 * A model reading abridged output without knowing it is abridged will answer
 * confidently about lines it never saw.
 */
function withNotice(
  body: string,
  counts: { originalLines: number; duplicateLines: number; elidedLines: number },
): string {
  const bits = [`${counts.originalLines} lines of output`];
  if (counts.duplicateLines) bits.push(`${counts.duplicateLines} repeated`);
  if (counts.elidedLines) bits.push(`${counts.elidedLines} hidden`);
  return `[Forge abridged this output: ${bits.join(', ')}. Errors and warnings were kept.]\n${body}`;
}

/**
 * Filter a whole `tool_response`, whatever shape the tool returned.
 *
 * The shape is not uniform, and assuming it was is a bug this had in its first
 * form: measured against the real CLI, Bash returns
 * `{stdout, stderr, interrupted, isImage}` rather than a string -- so a filter
 * that only handled strings silently skipped the single tool most likely to
 * emit ten thousand lines.
 *
 * Returns `undefined` when nothing needed changing, so the caller can leave the
 * response alone rather than rewriting it into an identical copy.
 */
export function filterToolResponse(
  response: unknown,
  budget: FilterBudget,
): { response: unknown; stats: FilterStats } | undefined {
  if (typeof response === 'string') {
    const result = filterToolOutput(response, budget);
    return result.filtered ? { response: result.text, stats: result.stats } : undefined;
  }

  if (!response || typeof response !== 'object') return undefined;

  const source = response as Record<string, unknown>;
  // The fields that actually carry bulk output. `stderr` is filtered too --
  // a failing build puts its ten thousand lines there, not in stdout.
  const TEXT_FIELDS = ['stdout', 'stderr', 'output', 'content', 'text', 'result'];

  let changed = false;
  const out: Record<string, unknown> = { ...source };
  const total: FilterStats = {
    originalLines: 0, originalChars: 0, keptLines: 0, duplicateLines: 0, elidedLines: 0,
  };

  for (const field of TEXT_FIELDS) {
    const value = source[field];
    if (typeof value !== 'string' || !value) continue;
    const result = filterToolOutput(value, budget);
    if (!result.filtered) continue;
    changed = true;
    out[field] = result.text;
    total.originalLines += result.stats.originalLines;
    total.originalChars += result.stats.originalChars;
    total.keptLines += result.stats.keptLines;
    total.duplicateLines += result.stats.duplicateLines;
    total.elidedLines += result.stats.elidedLines;
  }

  return changed ? { response: out, stats: total } : undefined;
}

/** The full text of a tool response, for the host-side copy. */
export function toolResponseText(response: unknown): string {
  if (typeof response === 'string') return response;
  if (!response || typeof response !== 'object') return '';
  const source = response as Record<string, unknown>;
  return ['stdout', 'stderr', 'output', 'content', 'text', 'result']
    .map((f) => (typeof source[f] === 'string' ? (source[f] as string) : ''))
    .filter(Boolean)
    .join('\n');
}

/**
 * The unabridged text, kept for whoever needs the evidence rather than the
 * summary -- A4's claim checker in particular.
 *
 * Bounded, and by total characters rather than entry count: one 40 MB build log
 * is the case that matters, not a thousand small ones.
 */
export class FullOutputStore {
  private readonly entries = new Map<string, string>();
  private chars = 0;

  constructor(private readonly maxChars = 8_000_000) {}

  set(toolUseId: string, text: string): void {
    this.delete(toolUseId);
    this.entries.set(toolUseId, text);
    this.chars += text.length;
    while (this.chars > this.maxChars && this.entries.size > 1) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.delete(oldest.value);
    }
  }

  get(toolUseId: string): string | undefined {
    return this.entries.get(toolUseId);
  }

  delete(toolUseId: string): void {
    const existing = this.entries.get(toolUseId);
    if (existing === undefined) return;
    this.chars -= existing.length;
    this.entries.delete(toolUseId);
  }

  clear(): void {
    this.entries.clear();
    this.chars = 0;
  }

  get size(): number {
    return this.entries.size;
  }
}

export const fullOutputStore = new FullOutputStore();
