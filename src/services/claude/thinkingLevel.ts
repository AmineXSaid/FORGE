/**
 * The thinking level: on or off, and nothing to do with effort.
 *
 * Ported from the official host (`extension.js`):
 *
 *   function m$$($,Q,X){ if($==="off") return {type:"disabled"};
 *     return {type:"enabled", budgetTokens:u$$, display: Q??X ? "summarized" : void 0} }   // u$$ = 31999
 *   async setThinkingLevel($,Q){ let X = m$$(Q, this.getShowThinkingSummariesSetting(), this.thinkingSummariesDefaultOn());
 *     return this.withChannel($, async (J) => {
 *       if (X.type==="enabled") await J.query.setMaxThinkingTokens(X.budgetTokens ?? u$$, X.display ?? null);
 *       else await J.query.setMaxThinkingTokens(0);
 *       return await this.settings.setThinkingLevel(Q), {type:"set_thinking_level_response"} }) }
 *   getThinkingLevel(){ let $ = this.context.globalState.get("thinkingLevel"); return $ ? $ : "default_on" }
 *   thinkingSummariesDefaultOn(){ return !1 }   // the VS Code host
 *
 * The same config is the launch's `Options.thinking` (`sdk.d.ts` L1794), which
 * the SDK turns into `--max-thinking-tokens 31999` [+ `--thinking-display`] or
 * `--thinking disabled`. Kept free of `vscode` so the specs can import it.
 */
import type { Query, ThinkingConfig } from '@anthropic-ai/claude-agent-sdk';

/** `u$$`: the budget the official gives every "on" level. */
export const THINKING_BUDGET_TOKENS = 31999;

/** The two levels the official webview sends. */
export type ThinkingLevel = 'off' | 'default_on';

/** The official default, when nothing is persisted. */
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'default_on';

/** The official `globalState` key. */
export const THINKING_LEVEL_STATE_KEY = 'thinkingLevel';

/** The official VS Code host never shows thinking summaries by default. */
export const THINKING_SUMMARIES_DEFAULT_ON = false;

export const invalidThinkingLevelMessage = (level: unknown): string =>
  `set_thinking_level: unexpected thinking level ${JSON.stringify(level)}`;

/**
 * Only the two levels the official webview ever sends are accepted. The
 * official host takes any value and treats everything but "off" as on; Forge is
 * stricter because the value is persisted and handed back to every window (B3).
 */
export function parseThinkingLevel(level: unknown): ThinkingLevel {
  if (level === 'off' || level === 'default_on') return level;
  throw new Error(invalidThinkingLevelMessage(level));
}

/**
 * `m$$`: the thinking config for a level. `showThinkingSummaries` is the
 * setting of that name (`Settings.showThinkingSummaries`, L8655) or undefined.
 */
export function thinkingConfigFor(
  level: string,
  showThinkingSummaries: boolean | undefined,
  summariesDefaultOn: boolean = THINKING_SUMMARIES_DEFAULT_ON
): ThinkingConfig {
  if (level === 'off') return { type: 'disabled' };
  return {
    type: 'enabled',
    budgetTokens: THINKING_BUDGET_TOKENS,
    display: (showThinkingSummaries ?? summariesDefaultOn) ? 'summarized' : undefined,
  };
}

/**
 * The official live switch: a budget (and the display, or `null` to clear it)
 * for "on", and `0` for "off" (`Query.setMaxThinkingTokens`, L2726).
 */
export async function applyThinkingConfig(
  query: Pick<Query, 'setMaxThinkingTokens'>,
  config: ThinkingConfig
): Promise<void> {
  if (config.type === 'enabled') {
    await query.setMaxThinkingTokens(config.budgetTokens ?? THINKING_BUDGET_TOKENS, config.display ?? null);
  } else {
    await query.setMaxThinkingTokens(0);
  }
}

/** Anything with VS Code `Memento`'s get/update (globalState). */
export interface ThinkingLevelStore {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

/** The official `getThinkingLevel`: the stored level, or "default_on". */
export function readThinkingLevel(store: ThinkingLevelStore): string {
  const stored = store.get(THINKING_LEVEL_STATE_KEY);
  return typeof stored === 'string' && stored ? stored : DEFAULT_THINKING_LEVEL;
}

/** The official `setThinkingLevel` on the settings store. */
export async function writeThinkingLevel(store: ThinkingLevelStore, level: ThinkingLevel): Promise<void> {
  await store.update(THINKING_LEVEL_STATE_KEY, level);
}
