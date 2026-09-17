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
