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

## Corrections found while implementing (step 13, 2026-09-18)

What was built follows the bundle; see [results/13-effort.md](results/13-effort.md).

1. **`setEffortLevel` does more than `applySettings({effortLevel})`.** It first
   clears Ultracode (`{ultracode:null}, {flagsOnly:true}`) when it is or may be
   on, and every settings write goes through one queue (`queueSettingsApply`),
   so writes land in order.
2. **"Respect `maxEffortLevel`" is the CLI's job.** The official webview never
   reads `maxEffortLevel` (0 matches in `index.js`). The CLI clamps, and reports
   the result as `applied.effort` from its `get_settings` control request; the
   webview adopts that (`adoptAppliedEffort`) from `set_model_response.applied`,
   from `get_applied_settings`, and seeds from the config probe's
   `claudeSettings.applied`. `Query.getSettings()` is in `sdk.mjs` but not in
   the published `.d.ts`.
3. **Effort does not go through `--effort` or `Options.effort`.** The official
   passes neither: the level lives in `~/.claude/settings.json` (read at launch)
   and reaches a running CLI through `applyFlagSettings`. `'max'` is sent like
   any level; the CLI keeps it for the session and drops it from the file on the
   next launch (its schema is `low|medium|high|xhigh`, `.catch(void 0)`).
4. **Levels:** `supportedEffortLevels ?? ["low","medium","high"]` (the official
   fallback), read with `bK` on the selected model.
5. **The model menu's effort row is `QF1`**: the "effort-level" command's own
   label, suffix and slider, and nothing else. Forge's copy had a divider and an
   effort icon that the official model menu does not have; both are gone.
6. **The official Modes menu has an effort row too** (`$H0`, `effortRow`, with
   the `iV0` icon), shown for any model with effort. Forge's `ModeSelect.vue`
   leaves it out on purpose ("Effort lives in the model menu"), and this step's
   brief puts the control in the model menu, so it was **not** added. Raised
   with the user.
7. **The official `apply_settings` also checks the request shape** (`settings`
   a non-array object, `flagsOnly` boolean, `scope` user/local) and has **no
   null bypass**: `effortLevel: null` is refused by `typeof $ === "string"`.
   Step 11 had neither; both were ported here, because this is the step that
   first calls `apply_settings`.
