/**
 * Tool calls whose arguments were cut off before they finished arriving.
 *
 * The relay drops the partial value of a cut-off call (`repairJsonDetailed`),
 * so the required field that was cut is absent and the CLI refuses the call
 * with its own `InputValidationError`; nothing is written or run. This
 * registry remembers which `tool_use` ids that happened to, so the hint on
 * that validation error can say why (`errorHints.ts`) instead of listing the
 * parameters as if the model had forgotten one.
 *
 * Module-level and bounded, like the hint cache in `errorHints.ts`: the call
 * is emitted in one request and its result comes back in a later one.
 */

export interface CutOffCall {
  /** The tool name, as sent to the CLI. */
  tool: string;
  /** `file_path`, `notebook_path`, or the first 80 characters of `command`; '' when none survived. */
  target: string;
  /** The upstream `finish_reason` of the reply that carried the call. */
  finishReason: string;
}

const registry = new Map<string, CutOffCall>();
const LIMIT = 2000;

/** The target a cut-off call names, from the fields that survived the cut. */
export function cutOffTarget(input: Record<string, unknown>): string {
  for (const key of ['file_path', 'notebook_path'] as const) {
    if (typeof input[key] === 'string' && input[key]) return input[key];
  }
  return typeof input.command === 'string' ? input.command.slice(0, 80) : '';
}

export function recordCutOff(toolUseId: string, call: CutOffCall): void {
  registry.delete(toolUseId);
  registry.set(toolUseId, call);
  while (registry.size > LIMIT) {
    const oldest = registry.keys().next();
    if (oldest.done) break;
    registry.delete(oldest.value);
  }
}

export function cutOffCall(toolUseId: string): CutOffCall | undefined {
  return registry.get(toolUseId);
}

/** Test seam. */
export function clearCutOffCalls(): void {
  registry.clear();
}
