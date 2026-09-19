/**
 * Reading what the CLI says it applied: its `get_settings` control request.
 *
 * The official host calls `query.getSettings()` after every settings write and
 * on the config probe, and hands the webview two things from it: `applied`
 * (the model, effort and ultracode the next request will actually use) and
 * `effective` (the merged settings). That is how the effort control shows the
 * effort the CLI runs at -- after `maxEffortLevel` caps and model downgrades --
 * rather than the one that was asked for (CLAUDE.md B7).
 *
 * `Query.getSettings()` is in the SDK runtime (`sdk.mjs`:
 * `async getSettings(){return(await this.request({subtype:"get_settings"})).response}`)
 * but not in its published typings, so it is reached through a narrow type and
 * everything it returns is checked before use. Kept free of `vscode` so the specs
 * can import it.
 */
import type { AppliedSettings, ClaudeSettingsSnapshot } from '../../shared/messages';

const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

/** A `Query` as far as `get_settings` goes. */
interface QueryWithSettings {
  getSettings?: () => Promise<unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The `applied` block, keeping only fields of the expected type. */
export function toAppliedSettings(raw: unknown): AppliedSettings | undefined {
  if (!isRecord(raw)) return undefined;
  const applied: AppliedSettings = {};
  if (typeof raw.model === 'string') applied.model = raw.model;
  if (raw.effort === null) applied.effort = null;
  else if (typeof raw.effort === 'string' && EFFORT_LEVELS.has(raw.effort)) {
    applied.effort = raw.effort as AppliedSettings['effort'];
  }
  if (typeof raw.advisor === 'string' || raw.advisor === null) applied.advisor = raw.advisor;
  if (typeof raw.ultracode === 'boolean') applied.ultracode = raw.ultracode;
  return applied;
}

/** The fields of a `get_settings` response the webview reads (the official `claudeSettings`). */
export function toClaudeSettingsSnapshot(raw: unknown): ClaudeSettingsSnapshot | undefined {
  if (!isRecord(raw)) return undefined;
  const effective = isRecord(raw.effective) ? raw.effective : {};
  const snapshot: ClaudeSettingsSnapshot = { effective: {} };
  if (typeof effective.disableWorkflows === 'boolean') snapshot.effective.disableWorkflows = effective.disableWorkflows;
  if (typeof effective.ultracode === 'boolean') snapshot.effective.ultracode = effective.ultracode;
  if (typeof effective.effortLevel === 'string') {
    snapshot.effective.effortLevel = effective.effortLevel as ClaudeSettingsSnapshot['effective']['effortLevel'];
  }
  // Whether a settings layer (a managed policy, typically) turns bypass off: a
  // stored bypass is then neither kept nor restored (step 18).
  if (isRecord(effective.permissions) && effective.permissions.disableBypassPermissionsMode === 'disable') {
    snapshot.effective.permissions = { disableBypassPermissionsMode: 'disable' };
  }
  const applied = toAppliedSettings(raw.applied);
  if (applied) snapshot.applied = applied;
  return snapshot;
}

/** `query.getSettings()`; throws if the CLI cannot answer, as the SDK does. */
export async function readClaudeSettings(query: unknown): Promise<unknown> {
  const getSettings = (query as QueryWithSettings | null)?.getSettings;
  if (typeof getSettings !== 'function') throw new Error('getSettings is not available on this SDK');
  return getSettings.call(query);
}
