# Step 13: Effort end to end

**Group:** 4  **Depends on:** 11, 12

## Problem
`ChatPage.handleEffortSelect` calls `session.setThinkingLevel(level)`, and
`getMaxThinkingTokens` (~L939) returns `0` or `31999`. Effort changes nothing (B7).

## Official
- `setEffortLevel(level)` calls `applySettings({effortLevel: level})`.
- The CLI reads the `effortLevel` setting, `--effort` or the SDK option
  (low | medium | high | xhigh), optionally capped by `maxEffortLevel`.
- Levels come from `model.supportedEffortLevels`. Without effort support, the
  `effort-level` row is unregistered, and so is the picker's `QF1` effort row.

## Tasks
- [ ] Check the level list against `REF/claude-code-settings.schema.json` and the
      upgraded SDK types. `components/forge/effort.ts` has `max`; remove it
      unless the schema or SDK has it.
- [ ] Webview: add an `effortLevel` state, separate from `thinkingLevel`. It
      starts from settings. Selecting a level sends `apply_settings {effortLevel}` (step 11).
- [ ] Host: effort reaches new queries and the running one through the real SDK
      mechanism in `docs/sdk-upgrade.md`. Any flag goes through `cliArgs.ts`.
      Thinking tokens no longer depend on effort.
- [ ] Respect `maxEffortLevel`.
- [ ] Hide both effort rows when `supportsEffort` is false. Use `supportedEffortLevels` for the slider.
- [ ] Ultracode, **in scope since 2026-09-18** (it was out when this file was
      written). Build it as the official does: `ultracode` joins the whitelist
      on the `flags` layer (`$ === null || typeof $ === "boolean"`);
      `enableUltracode()` sends `apply_settings {effortLevel:"xhigh"}` then
      `apply_settings {ultracode:true}, {flagsOnly:true}`; `setEffortLevel`
      clears it with `{ultracode:null}, {flagsOnly:true}` first. The slider's
      extra notch, the pill's "Ultracode" and the row suffix
      "Ultracode - xhigh + workflows" appear only when `ultracodeAvailable`: the
      model's `supportedEffortLevels` include `xhigh` and `disableWorkflows` is
      not `true`.
- [ ] Specs: effort handling, and the mapping to the SDK option or flag.

## Validate
- [ ] Gates pass.
- [ ] Harness: "/" effort slider. `apply_settings` is sent, the menu **stays open**,
      and the label updates. Same in the model picker's effort row.
- [ ] Harness: a no-effort model shows neither row. Oracle: 0 structural diffs.

## VS Code checklist for the user
1. Set effort to low and send a turn. **Expected:** `~/.claude/settings.json`
   has `"effortLevel":"low"`, and the CLI reports low effort (its debug log or
   `/status` in the session).
2. Reload the window. **Expected:** effort is still low.
