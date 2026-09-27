/**
 * Tell the model when its edit broke the file, using the editor's own
 * language servers.
 *
 * SWE-agent refuses an edit that adds syntax errors and Aider re-prompts with
 * lint and test failures, up to three times. The official Claude Code
 * extension gets the same effect from the CLI itself: after each edit the CLI
 * asks the IDE's `getDiagnostics` and injects `<new-diagnostics>`. Measured
 * against CLI 2.1.283, that path does not run for an in-process SDK MCP server
 * named `ide`: the server connects and its tool is offered to the model, but
 * the CLI's tracker never calls it. So Forge does it in its own hooks:
 *
 *   PreToolUse  (Edit/Write/MultiEdit)  snapshot the file's errors
 *   PostToolUse (same)                  wait briefly for the language server,
 *                                       then report errors that are new
 *
 * The edit follower (`editor/followEdits.ts`) opens each edited file beside
 * the chat, which is what makes a language server produce diagnostics for it.
 * A file that was not open before the edit has no baseline, so its errors are
 * reported as "after your edit" rather than claimed as caused by it.
 *
 * Only errors, never warnings: a model told about every lint warning spends
 * its turns on style instead of the task.
 */

/** One diagnostic, reduced to what the report needs. */
export interface EditorDiagnostic {
  message: string;
  /** 0-based line. */
  line: number;
  source?: string;
  code?: string;
}

/** Where diagnostics come from: VS Code in the extension, a fake in tests. */
export interface DiagnosticsSource {
  /** Current errors for the file, or undefined when the editor has no view of it. */
  errors(file: string): EditorDiagnostic[] | undefined;
  /** Resolve once the file's diagnostics change, or after `ms`, whichever is first. */
  settle(file: string, ms: number): Promise<void>;
}

/** Longest the PostToolUse hook waits for the language server. */
export const SETTLE_MS = 2000;

/** Most errors listed in one report. */
const MAX_LISTED = 10;

export class EditDiagnostics {
  private readonly baselines = new Map<string, EditorDiagnostic[] | undefined>();

  constructor(private readonly source: DiagnosticsSource) {}

  /** PreToolUse: remember the file's errors before the edit runs. */
  before(toolUseId: string, file: string): void {
    this.baselines.set(toolUseId, this.source.errors(file));
    if (this.baselines.size > 256) {
      const oldest = this.baselines.keys().next();
      if (!oldest.done) this.baselines.delete(oldest.value);
    }
  }

  /**
   * PostToolUse: the report for the model, or undefined when the edit left no
   * new error behind (or the editor could not say).
   */
  async after(toolUseId: string, file: string, ms = SETTLE_MS): Promise<string | undefined> {
    const baseline = this.baselines.get(toolUseId);
    this.baselines.delete(toolUseId);
    await this.source.settle(file, ms);
    const now = this.source.errors(file);
    if (!now?.length) return undefined;

    const fresh = baseline ? newErrors(baseline, now) : now;
    if (!fresh.length) return undefined;
    const listed = fresh.slice(0, MAX_LISTED).map((d) =>
      `- line ${d.line + 1}: ${d.message}${d.source ? ` (${d.source}${d.code ? ` ${d.code}` : ''})` : ''}`);
    const more = fresh.length > MAX_LISTED ? `\n- …and ${fresh.length - MAX_LISTED} more` : '';
    const head = baseline
      ? `Your edit to ${file} introduced ${fresh.length} new error(s), reported by the editor:`
      : `The editor reports ${fresh.length} error(s) in ${file} after your edit:`;
    return `${head}\n${listed.join('\n')}${more}\nFix them before moving on.`;
  }
}

/**
 * Errors in `after` that were not in `before`, compared as a multiset on the
 * message, source and code. Positions are ignored: an edit above an old error
 * moves it, and that is not a new error.
 */
export function newErrors(before: EditorDiagnostic[], after: EditorDiagnostic[]): EditorDiagnostic[] {
  const key = (d: EditorDiagnostic) => `${d.source ?? ''}\u0000${d.code ?? ''}\u0000${d.message}`;
  const remaining = new Map<string, number>();
  for (const d of before) remaining.set(key(d), (remaining.get(key(d)) ?? 0) + 1);
  const fresh: EditorDiagnostic[] = [];
  for (const d of after) {
    const n = remaining.get(key(d)) ?? 0;
    if (n > 0) remaining.set(key(d), n - 1);
    else fresh.push(d);
  }
  return fresh;
}
