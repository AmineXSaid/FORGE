# Step 13: Effort end to end, and Ultracode

Group 4, third step. Effort was a label on top of the thinking level:
`handleEffortSelect` called `setThinkingLevel(level)`, which changed nothing
the CLI does with effort and could switch thinking off (B7). It is now its own
setting, wired the official way through step 11's `apply_settings`, with the
model's own levels, and the label follows what the CLI reports it applied.

**Scope change:** Ultracode was out of scope when this batch started. You
moved it into scope on 2026-09-18 ("bring it to the scope"), and it's built
here the official way. `CLAUDE.md` and `out-of-scope.md` record the move
(commit `775dba3`).

## What the official actually does

**Webview** (`index.js`, the session class):

```js
async setEffortLevel($){ this.ultracodeSeeded=!0;
  let Z=this.ultracodeEnabled.value||this.ultracodeFlagMayBeSet;
  if(this.effortLevel.value===$&&!Z&&!this.shownLevelUnpicked)return;
  this.effortChangeCount++, this.effortLevel.value=$, this.ultracodeEnabled.value=!1, ...;
  await this.queueSettingsApply(async()=>{ if(Z) await this.applySettings({ultracode:null},{flagsOnly:!0});
                                           await this.applySettings({effortLevel:$}) }) }
async enableUltracode(){ ...; this.effortLevel.value="xhigh", this.ultracodeEnabled.value=!0, ...;
  await this.queueSettingsApply(async()=>{ await this.applySettings({effortLevel:"xhigh"});
                                           await this.applySettings({ultracode:!0},{flagsOnly:!0}) }) }
adoptAppliedEffort($){ /* show applied.effort (after caps and downgrades) and applied.ultracode */ }
ultracodeAvailable = claudeSettings && effective.disableWorkflows!==true && currentModelInfo.supportedEffortLevels.includes("xhigh")
// footer / registry: bK(rows, selection)?.supportsEffort ? levels = supportedEffortLevels ?? ["low","medium","high"] : unregister "effort-level"
// pill Xq0: no effort → nothing; ultracode → "Ultracode"; level → kK(level)
// "/" row: label "Effort", suffix (ultracode ? "Ultracode - xhigh + workflows" : kK(level)), slider ko, keepMenuOpen, click cycles
```

**Host** (`extension.js`): `tu$` has `ultracode: {layer:"flags", value: $ => $===null || typeof $==="boolean"}`;
`applySettings` refuses a malformed request, then runs each key's own check (no
null bypass); `writeUserSettingsAndPush` merges into `~/.claude/settings.json`
unless `flagsOnly`, then `query.applyFlagSettings(patch)`; `setModel` answers
with `applied` from `query.getSettings()`; `get_applied_settings` returns
`getSettings().applied`.

**CLI 2.1.274** (`get_settings`): `applied: {model, effort, advisor, ultracode}`,
where `effort` is what the next request sends — after env overrides, session
state, org caps (`maxEffortLevel`) and model downgrades.

## Results

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| startup seed | — (reads `claudeConfig.claudeSettings.applied.effort` from the config probe) | `get_claude_state` carries `claudeSettings` from `getSettings()` | pill **Sonnet 5 Medium**; nothing written | works |
| model menu, Sonnet: slider "High" (real click) | `{type:"apply_settings", settings:{effortLevel:"high"}}` — **only** that; no `set_thinking_level` | `apply_settings_response`; host writes `~/.claude/settings.json`, then `applyFlagSettings` (spec, step 11) | pill **Sonnet 5 High**, row **Effort(High)**; menu **stays open** | works |
| model menu, Sonnet: row click (cycle) | `apply_settings {effortLevel:"low"}` | `apply_settings_response` | High → **Low** (wraps within Sonnet's 3 levels); menu stays open | works |
| model menu, Sonnet: notches | — | — | **3 notches, no Ultracode notch** (Sonnet has no `xhigh`) — the step 11 defect is gone | works |
| model menu, Opus: notches | — | — | **6 notches**, the last `notchUltracode` (Opus lists `xhigh`, workflows on) | works |
| model menu, Opus: slider "Max" | `apply_settings {effortLevel:"max"}` | `apply_settings_response` | pill **Opus 5 Max** (red heat tint) | works |
| model menu, Opus: Ultracode notch (real click) | `apply_settings {effortLevel:"xhigh"}` **then** `apply_settings {ultracode:true}, flagsOnly:true` | both answered, in order | pill **Opus 5 Ultracode**, row **Effort(Ultracode - xhigh + workflows)**, `fillUltracode`; menu stays open | works |
| leave Ultracode (row cycle) | `apply_settings {ultracode:null}, flagsOnly:true` **then** `{effortLevel:"low"}` | both answered | pill **Opus 5 Low**, fill back to plain | works |
| model switch downgrade (B7) | Opus at Max → pick Default: `set_model` | `set_model_response` with `applied:{effort:"high"}` (stub CLI: Sonnet has no Max) | pill **Sonnet 5 High** — the CLI's effort, not "Max"; nothing extra written | works |
| Haiku (no effort) | pick Haiku | — | pill **Haiku 4.5** (no effort span); model menu has **no effort section**; "/" menu has **no Effort row**; Thinking row still there | works |
| "/" menu, Opus: Effort row | row click from Max | `apply_settings {effortLevel:"xhigh"}` + `{ultracode:true}, flagsOnly:true` | Max → **Ultracode**; 6 notches incl. Ultracode; menu stays open | works |
| slash command reread | composer sends `/effort low` (real click on Send); stub CLI switched to low; `result` | `get_applied_settings` → `applied:{effort:"low", ultracode:false}` | pill **Opus 5 Low** (Ultracode off) | works |
| welcome card "Meet Ultracode", Sonnet | — | — | card shown **without** "Try Ultracode" (B4: not offered here) | works |
| welcome card, Opus: "Try Ultracode" | `apply_settings {effortLevel:"xhigh"}` + `{ultracode:true}, flagsOnly:true` | both answered | pill **Opus 5 Ultracode**; card retired | works |
| accept | `{settings:{ultracode:true}, flagsOnly:true}` / `{ultracode:null}` | `apply_settings_response` | — | works |
| reject | `{settings:{ultracode:true}}` (to user settings) | `error: unexpected value or target for "ultracode"` | — | works |
| reject | `{settings:{ultracode:"true"}, flagsOnly:true}` | same | — | works |
| reject | `{settings:{effortLevel:null}}` | `error: unexpected value or target for "effortLevel"` (official: no null bypass) | — | works |
| reject | `{settings:{effortLevel:"xhigh", ultracode:true}}` | `error: … "ultracode"` (two layers in one patch) | — | works |
| reject | `{settings:[]}` / `{settings:null}` / `flagsOnly:"yes"` / `scope:"flags"` | `error: apply_settings: malformed request` | — | works |
| reject | `{settings:{effortLevel:"high"}, flagsOnly:true, scope:"localSettings"}` | `error: … "effortLevel"` (key check first, as the official) | — | works |
| reject | `{settings:{}, flagsOnly:true, scope:"localSettings"}` | `error: flagsOnly and localSettings scope are exclusive` | — | works |
| `get_applied_settings` | `{type:"get_applied_settings"}` | `{type:"get_applied_settings_response", applied:{model, effort, advisor, ultracode}}` | — | works |

The raw accept/reject payloads were sent straight at the mock host, which runs
the same checks as `settingsWhitelist.ts`; the real validator is covered by
`test/applySettings.spec.ts`.

**Counts:** works 23 · partial 0 · broken 0 · left out 1 (the Modes menu's effort row, see below)

## Every SDK field on the objects this step touched

### `EffortLevel` (L623) and `Settings` (L6279) — effort, Ultracode

| Field | Surfaced? | Where / why not |
| --- | --- | --- |
| `EffortLevel` `low…max` | yes | the slider shows the model's own list; `max` is sent like any level |
| `Settings.effortLevel` (L8472, excludes `max`) | yes | written by `apply_settings` to user settings. `"max"` lands there too, as in the official; the CLI's schema drops it on the next launch (`.catch(void 0)`, read from the CLI binary) while the running session keeps it |
| `Settings.ultracode` (L8496) | yes | flag layer only (`applyFlagSettings`), never a file; stripped from forge.json profile sync |
| `Settings.maxEffortLevel` (L8476) | via the CLI | the official webview never reads it (0 matches); the CLI clamps and reports `applied.effort`, which the label adopts |
| `Settings.modelSettings.<model>.effortLevel / maxEffortLevel` (L8480) | via the CLI | same: applied by the CLI, visible as `applied.effort`; no official control |
| `Settings.disableWorkflows` (L6797) | yes | gates Ultracode (`claudeSettings.effective.disableWorkflows`) |
| `ModelInfo.supportsEffort` / `supportedEffortLevels` | yes | gate the pill effort, the model menu row, the "/" row; the slider's levels |

### What the CLI reports

| Source | Surfaced? | Where / why not |
| --- | --- | --- |
| `get_settings` → `applied.effort` / `applied.ultracode` / `applied.model` | yes | seed (config probe), `set_model_response.applied`, `get_applied_settings` after a slash-command turn |
| `get_settings` → `applied.advisor` | typed, not shown | no official control for the advisor model (`advisorModel`: 0 matches in `index.js`) |
| `get_settings` → `effective` | 3 keys | `disableWorkflows`, `ultracode`, `effortLevel` — the ones the official webview reads for effort; the rest of the merged settings are not sent to the webview |
| `SDKSystemMessage.effort` (L5598) | no | "Present on Remote Control bridge init frames … absent on hosts that do not publish it" — a local session never carries it; `get_settings` is the local equivalent |
| `BaseHookInput.effort.level` (L191) | output channel | logged on Forge's existing `PreToolUse` / `PostToolUse` hook lines, so the real-CLI checklist has a place to read the effort a turn actually ran at |

### `Query` / `Options`

| API | Used? | Why |
| --- | --- | --- |
| `applyFlagSettings` (L2749) | yes | live effort (userSettings writes) and Ultracode (flags writes) |
| `getSettings()` | yes | in `sdk.mjs`, **not** in the published `.d.ts`; reached through `claudeSettings.ts` with every field type-checked |
| `Options.effort` (L1807) / `--effort` | no | the official passes neither; the level lives in user settings |
| `updateSettings('localSettings', …)` (L2762) | no | its allowlist is `outputStyle` only (step 29) |

## Changes

- `settingsWhitelist.ts`: `ultracode` on the `flags` layer; the official
  request-shape check; each key's own value check with **no null bypass**; the
  flagsOnly/localSettings clash checked after the keys. (Scope note below.)
- `claudeSettings.ts` (new): `readClaudeSettings`, `toAppliedSettings`,
  `toClaudeSettingsSnapshot`.
- Host: `get_claude_state` carries `claudeSettings` from the config probe;
  `set_model_response` carries `applied`; new `get_applied_settings` (all six B2
  places); a flags write with no session throws `Channel not found`, as the
  official `withChannel` does; the hook log lines carry `effort.level`.
- `effort.ts`: rewritten as ports of `V25`, `kK`, `Xq0`, `Io`, the row cycle and
  `ultracodeAvailable`. **No `ultracode` level and no fixed scale** any more.
- `EffortSlider.vue`: a port of `ko` — `showUltracode` adds the extra notch; the
  Ultracode notch and fill classes appear only then.
- `Session.ts`: `effortLevel`, `ultracodeEnabled`, `effortState`,
  `ultracodeAvailable`; literal `setEffortLevel`, `enableUltracode`,
  `adoptAppliedEffort`, `queueSettingsApply`, `rereadAppliedSettings`,
  `adoptCliReportedModel`; the seeding effect; the slash-command reread.
- `ModelSelect.vue`: the pill is the official `HF1` (`label`, `" "`, effort — the
  space was missing before, see step 12's report); the effort section is shown
  only with `supportsEffort` and is the official `QF1` (the divider and the effort
  icon Forge had added are gone); the effort row is in the popup's keyboard order.
- `ButtonArea.vue` / `CommandMenu.vue`: the "/" Effort row only with
  `supportsEffort`, with the model's levels, the Ultracode notch and the official
  cycle.
- `ChatPage.vue`: effort goes to `setEffortLevel`, never `setThinkingLevel`;
  failures are reported; the Ultracode welcome card's link is shown only where
  Ultracode is offered, and its copy no longer claims "one step past Max".
- Mock host: `ultracode` in its whitelist and the official shape check; a stub CLI
  state that answers `applied` like the real one (downgrade, no effort on Haiku,
  Ultracode needs xhigh); `get_applied_settings`; `applied` on `set_model_response`.

## Scope notes (changes outside the step, revertable)

1. **`apply_settings` validation (step 11) now matches the official.** Step 11
   had no request-shape check (`settings: []` passed as an empty patch,
   `flagsOnly: "yes"` counted as true) and let `null` through for every key; the
   official refuses `effortLevel: null` because its value check is
   `typeof $ === "string"`. This step is the first real caller and adds
   `ultracode`, whose own check is the one that allows `null`, so the loop was
   ported literally. Its spec cases changed accordingly (34 now).
2. **The model menu's effort row lost its divider and icon**, which the official
   model menu does not have (`aV0` puts `QF1` straight into `effortSection`).
   Measured: 50/50 clean on Sonnet, 53/53 on Opus.

## B6

`ultracode` joins `FLAG_SETTINGS_RESERVED_KEYS` automatically (derived from the
whitelist), so profile sync strips it from forge.json — otherwise a profile
could pin Ultracode on and the slider could never turn it off. Written up in
[settings-precedence.md](../settings-precedence.md).

## Gates

- `pnpm test`: `Test Files 15 passed (15) · Tests 305 passed (305)`
- `pnpm run typecheck:all`: `tsc --noEmit` and `vue-tsc -p src/webview/tsconfig.json --noEmit`, both silent
- `pnpm run build`: `✓ built in 5m 46s`, exit 0. `Forge brand guardrail: clean (301 files scanned)` ·
  `Forge token check: clean (235 tokens used, 382 defined)` · `Forge command check: clean (20 commands, 13 references)`

## Oracle

| Window (root selector) | Structural diffs | Note |
| --- | --- | --- |
| `.fg-commandmenu__menuPopup` — **model** menu, Sonnet (3 notches) | **0** — 50/50 clean | divider and icon gone |
| `.fg-commandmenu__menuPopup` — **model** menu, Opus (6 notches incl. Ultracode) | **0** — 53/53 clean | |
| `.fg-commandmenu__menuPopup` — **model** menu, Haiku (no effort section) | **0** — 38/38 clean | |
| `.fg-commandmenu__menuPopup` — **"/"** menu, Opus, Ultracode on | **0** — 82/82 clean | |
| `.fg-composer__inputWrapper` (idle) | **0** — 29/29 clean | = baseline |
| `.fg-menu__menuPopup` (Modes menu) | **0** — 41/41 clean | = baseline |
| `.fg-shell__header` | **0** — 15/15 clean | = baseline |
| `.fg-markdown__root` (one-code-block message) | **1** — 9/10 clean | the known `codeBlockWrapper pre` font-family artifact |

Colour diffs are the brand only (purple focus ring and send button).

## Specs added / changed

- `test/effort.spec.ts` (new) — 37 cases: labels (`V25`, `kK`, `Xq0`, `Io`); heat
  tint; the row cycle (from nothing, wrapping, reaching and leaving Ultracode,
  never when unavailable); `ultracodeAvailable` (no settings, workflows off, no
  xhigh); host parsing of `applied` / `get_settings` incl. malformed input and a
  missing `getSettings`; the session: a pick sends only `apply_settings` and
  leaves thinking alone, no resend of the same level, `max` sent as is, Ultracode
  on/off order, the queue keeps concurrent writes in order, levels per model,
  `NO_EFFORT` for Haiku, the low/medium/high fallback, seeding from `applied`,
  seeding Ultracode, adopting a model-switch downgrade, adopting a cap and still
  writing a re-pick, ignoring a non-string effort, the slash-command reread
  (effort **and** model), no reread after an ordinary turn.
- `test/applySettings.spec.ts` — 24 → 34: `ultracode` on the flag layer only,
  `null` allowed for it, non-booleans refused, refused to files; `effortLevel:
  null` refused; the request-shape check (settings, `flagsOnly`, `scope`); key
  check before the flagsOnly/localSettings clash; `ultracode` stripped from
  profiles.

## Rows deliberately left out and why

| Row | Official | Why left out |
| --- | --- | --- |
| **Effort row in the Modes menu** | `$H0` `effortRow` (icon `iV0`, "Effort (Level)", slider, click to cycle), shown for any model with effort | Forge's `ModeSelect.vue` omits it on purpose ("Effort lives in the model menu"), and this batch's brief says "the effort control is in the model menu, not the mode menu". **Needs your decision**; `EffortIcon.vue` (the official `iV0`) is kept for it |
| Composer spark legend (effort dots, fast-mode spark) | `sparkLegend`, `q85`, `U85` | `00-index.md`: "Don't bring back the composer's star/effort legend" |
| Advisor model | `applied.advisor` | no official control |

Out-of-scope features are unchanged from [out-of-scope.md](../out-of-scope.md).

## Pre-existing issues found, not fixed here

1. Carried forward: `handleGetAssetUris` derives `extensionPath` from `process.cwd()`.
2. Carried forward: the mock host acks unknown requests without a `success` field.
3. Forge does not pass `--replay-user-messages`, so the slash-command reread
   fires on the next `result` after any `/…` send, rather than on the CLI's
   replay of that exact message (the official's trigger). Adding a stream flag
   goes through `cliArgs.ts` and is outside this step.
4. During the harness run a `/effort high` message appeared in the transcript
   that no Forge code path builds (only the composer's Send and the "/" slash
   rows create user messages, and the draft was empty) — most likely typed into
   the shared Browser pane. It is not counted in any row above; every result in
   the table was captured before it.

## VS Code checklist for the user — **unverified**

1. With Sonnet selected, open the model menu. **Expected:** the Effort row has 3
   notches and no Ultracode notch.
2. Pick **Low**. **Expected:** `~/.claude/settings.json` has `"effortLevel": "low"`
   (other keys untouched); the next tool call's output-channel line reads
   `[Hook] PreToolUse: … (effort: low)`; `/status` in a terminal session shows low.
3. Reload the window. **Expected:** the pill still shows Low.
4. Select Opus, pick **Max**, send a turn. **Expected:** the hook line shows
   `effort: max`. `~/.claude/settings.json` has `"effortLevel": "max"`; after a
   window reload the pill shows the model's default effort (the CLI ignores `max`
   in the file) — same as Claude Code.
5. With Opus, pick the last notch (Ultracode). **Expected:** the pill reads
   "Opus 5 Ultracode"; `~/.claude/settings.json` has `"effortLevel": "xhigh"`
   and **no** `ultracode` key (it is session-only); the hook line shows `effort: xhigh`.
6. Pick **High**. **Expected:** Ultracode is off (pill "Opus 5 High").
7. Put `"maxEffortLevel": "medium"` and `"effortLevel": "high"` in
   `~/.claude/settings.json` and reload. **Expected:** the pill seeds from the
   CLI's applied effort and shows **Medium**; the hook line shows `effort: medium`.
   Then pick High: the label shows High (as in Claude Code, nothing re-reads
   until a model switch, a slash command or a reload) while the hook line still
   shows `effort: medium` — the CLI's cap.
8. Set `"disableWorkflows": true`, reload, select Opus. **Expected:** no Ultracode notch.
9. Type `/effort low` in the composer and send. **Expected:** when the turn ends
   the pill shows Low.
10. Select Haiku. **Expected:** no effort in the pill, no Effort row in either menu.
11. Toggle Thinking in "/" at any effort. **Expected:** the effort label does not
    change (step 14 checks the reverse).
