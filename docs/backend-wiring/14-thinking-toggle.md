# Step 14: Thinking toggle, separate from effort

**Group:** 4  **Depends on:** 13

## Official
- Webview: `setThinkingLevel(on ? "off" : "default_on")` sends `{type:"set_thinking_level", thinkingLevel}`.
- Host `setThinkingLevel`: computes the budget and display from settings
  (`getShowThinkingSummariesSetting`), calls
  `query.setMaxThinkingTokens(budget, display)` or `0`, and persists the level.
  Copy the budget values, the display values and the storage location from `extension.js`.

## Tasks
- [ ] Accept only the official `thinkingLevel` values.
- [ ] Replace `getMaxThinkingTokens` with the official computation. Use the
      upgraded SDK's `setMaxThinkingTokens` signature.
- [ ] Persist and restore where the official does.
- [ ] Add the thinking-summaries setting source, matching the official.
- [ ] `test/thinkingLevel.spec.ts`: accepted values, rejected values, budget
      and display mapping.

## Validate
- [ ] Gates pass.
- [ ] Harness: "/" → Thinking toggle. `set_thinking_level` is sent, the switch
      flips, the menu **stays open**, and effort is unchanged.

## VS Code checklist for the user
1. Turn Thinking off and send a turn. **Expected:** no thinking block. Turn it on. **Expected:** a thinking block appears.
2. Reload. **Expected:** the toggle state is kept.

## Corrections found while implementing (step 14, 2026-09-18)

What was built follows the bundle; see [results/14-thinking-toggle.md](results/14-thinking-toggle.md).

1. **The official host does not validate `thinkingLevel`.** `m$$` treats every
   value but `"off"` as on, and the value is persisted as is. Forge refuses
   anything but `"off"` / `"default_on"` (this file's first task, and B3: the
   level is stored and handed back to every window). The only difference is
   that a value the webview never sends is an error instead of "on".
2. **The values to copy:** budget `u$$ = 31999`; display `"summarized"` when
   `showThinkingSummaries ?? thinkingSummariesDefaultOn()` is true, else none;
   `thinkingSummariesDefaultOn()` is `false` in the VS Code host; storage is
   `globalState["thinkingLevel"]`, default `"default_on"`. The live call is
   `setMaxThinkingTokens(budget, display ?? null)` or `setMaxThinkingTokens(0)`,
   and the level is persisted **after** it, inside `withChannel` (an unknown
   channel persists nothing).
3. **`showThinkingSummaries` source:** the official reads the CLI's merged
   `effective` settings, then the user settings file. Forge reads its
   configuration service, which merges the same files (user, project, local,
   forge.json, managed).
4. **The webview's level is `override ?? config.thinkingLevel ?? "off"`.** Forge
   kept its own `'default_on'` default and never adopted the persisted level.
5. **`supportsAdaptiveThinking` is not used by the official.** `m$$` always
   sends a fixed budget; on adaptive models the CLI treats it as on/off
   (`docs/sdk-upgrade.md` #9).
6. The launch uses `Options.thinking` (L1794), not the deprecated
   `maxThinkingTokens` (L1816), and the config probe launches with thinking
   disabled, as the official `spawnConfigProbe` does.

