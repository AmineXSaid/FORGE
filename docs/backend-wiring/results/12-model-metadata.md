# Step 12: Model metadata

Group 4, second step. The model picker now shows the CLI's own model list —
`claudeConfig.models` and `claudeConfig.unavailable_models` from the initialize
response, in the CLI's order, with every field the CLI sends. The pill, the
tick and the "/" menu's "Switch model…" text are computed by functions ported
literally from the official webview. `set_model` is the official host's.

## What the official actually does

**Webview** (`index.js`):

```js
function IH($){return[...$?.models??[],...$?.unavailable_models??[]]}          // every row
function PK1($){ /* rows whose name/description say "alias(es)" go last */ }
function bK($,J){ /* row by value, else by resolvedModel (never Default) */ }
currentModelInfo = /* by value, then without [1m], then by resolvedModel */
function Xz0($,J){ /* the ticked row: a full id ticks the alias row covering it */ }
function wC($,J,Z){ /* the selected name, or the served model if another family */ }
// footer: d = own-name row ? displayName : Mo(row, lastServedModel) ?? wC(...) ?? OR(selection,"Model")
// aV0 rows: H75 — unavailable rows get unavailableModelItem, aria-disabled, and NO onClick
// V75: promoListPrice struck through (<s style="opacity:.7">) before the first "$X/$Y per Mtok"
setModel($,J){return this.sendRequest({type:"set_model",model:J},$)}          // J is the picked row
```

**Host** (`extension.js`):

```js
async setModel($,Q){
  if(typeof Q!=="object"||Q===null||typeof Q.value!=="string") throw Error("set_model: malformed request");
  let X=await this.writeUserSettingsAndPush($,{model:Q.value==="default"?null:Q.value});
  return {type:"set_model_response",...X!==void 0&&{applied:X}}
}
// writeUserSettingsAndPush: withChannel → merge into ~/.claude/settings.json → query.applyFlagSettings(patch)
```

**CLI 2.1.274** (read out of the native binary): `unavailable_models` is sent
only when `CLAUDE_CODE_ENTRYPOINT` is in `UNAVAILABLE_MODELS_HOST_ENTRYPOINTS`
= `["claude-vscode"]`, and only for first-party auth with the default base URL;
the key is omitted when empty. `apply_flag_settings {model}` performs a real
session model switch (`mainLoopModelForSession`; `null`/`"default"` → default model).

## Results

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| model list | `get_claude_state` (existing; now reads `initializationResult()`) | `config.models` (5) + `config.unavailable_models` (1), every `ModelInfo` field kept | 6 rows in the CLI's order: Default, Sonnet, Fable, Opus, Haiku, then the greyed Opus (1M context) | works |
| greyed row "Opus (1M context)" | click → **nothing sent** | — | `unavailableModelItem`, opacity 0.5, `cursor:default`, `aria-disabled="true"`; menu stays open | works |
| promo row "Opus" | — | — | `$5/$25` struck through (`<s>`) before `$2.50/$12.50 per Mtok` | works |
| pick "Opus" | `{type:"set_model", model:{value:"opus", resolvedModel, displayName, description, promoListPrice, supportsEffort, supportedEffortLevels, supportsAdaptiveThinking, supportsFastMode, supportsAutoMode}}` | `{type:"set_model_response"}`; host writes `"model":"opus"` to `~/.claude/settings.json`, then `applyFlagSettings({model:"opus"})` (spec) | menu closes; pill **Opus 5**; tick on Opus next time it opens | works |
| pick "Default" | `set_model` with the Default row | `set_model_response`; host clears `model` (`null`) | pill **Sonnet 5** (`resolvedModel`), not "Default" | works |
| served-model pill (`wC`/`Mo`) | assistant frame with `model:"claude-opus-5"` while Default is selected | — | pill **Opus 5**; "/" → "Switch model…" trails **Opus 5** | works |
| reject | `set_model {model:"opus"}` | `error: set_model: malformed request` | — | works |
| reject | `set_model {model:null}` | same | — | works |
| reject | `set_model {model:{displayName:"Opus"}}` | same | — | works |
| reject | `set_model {model:{value:42}}` | same | — | works |
| accept | `set_model {model:{value:"claude-opus-5[1m]"}}` / `{value:"my-custom-model"}` | `set_model_response` (the official does not check the list) | — | works |
| failure revert | host error on `set_model` | — | selection and served model restored, `Failed to set model: …` notification (spec; the harness mock cannot fail a well-formed row) | works (spec only) |

The rejections were sent straight at the mock host, which mirrors the host
check; the real host's check is `parseSetModelRequest` in
`src/services/claude/setModel.ts`, covered by the spec.

**Counts:** works 12 · partial 0 · broken 0 · left out 0

## Every SDK field on the objects this step touched

### `ModelInfo` (`sdk.d.ts` L1313, plus the CLI's two `@internal` fields)

| Field | Surfaced? | Where / why not |
| --- | --- | --- |
| `value` | yes | row key, `set_model` payload, tick (`Xz0`) |
| `resolvedModel` | yes | `bK`, `currentModelInfo`, `Xz0`, the pill (`Mo` → "Sonnet 5") |
| `displayName` | yes | row label; pill for rows with a name of their own |
| `description` | yes | row description |
| `supportsEffort` | yes (state) | `Session.currentModelSupportsEffort`; gates both effort rows in step 13 |
| `supportedEffortLevels` | yes (state) | read off `currentModelInfo`; the slider's levels and `ultracodeAvailable` in step 13 |
| `supportsAdaptiveThinking` | yes (state) | `Session.currentModelSupportsAdaptiveThinking`. The official webview never reads it (0 matches in `index.js`), so there is no official control to port; step 14 records whether the Thinking toggle should use it |
| `supportsFastMode` | yes (state) | `Session.currentModelSupportsFastMode`; gates "Toggle fast mode" in step 15 |
| `supportsAutoMode` | yes (state) | `Session.currentModelSupportsAutoMode` (`undefined` while unknown, as the official keeps it). **Not rendered:** it gates the Auto row of the mode menu, and Auto mode is not in `CLAUDE.md`'s scope list (`docs/sdk-upgrade.md`: "needs a scope decision") |
| `disabled` (`@internal`) | yes | arrives only in `unavailable_models`; greyed row |
| `promoListPrice` (`@internal`) | yes | struck-through list price (`V75`) |

### `SDKControlInitializeResponse` (L4282) — the model part

| Field | Surfaced? | Where / why not |
| --- | --- | --- |
| `models` | yes | `claudeConfig.models` |
| `unavailable_models` (`@internal`) | yes | `claudeConfig.unavailable_models`; needed the entrypoint fix below |
| `fast_mode_state`, `fast_mode_disabled_reason` | not here | step 15's subject |
| `commands`, `output_style`, `available_output_styles`, `account`, … | not here | steps 02 / 29 / out of scope |

### `Query` model methods

| Method | Used? | Why |
| --- | --- | --- |
| `initializationResult()` L2769 | yes | `loadConfig` reads both model lists from it, as the official does |
| `supportedModels()` L2807 | picker: no longer; Settings page: still | it is `models` alone, so it loses the greyed rows. `SettingsStore` / `SettingsTabModels.vue` still probe it (unchanged, not part of this step) |
| `applyFlagSettings({model})` L2749 | yes | the official live switch, via `writeUserSettingsAndPush` |
| `setModel(model?)` L2703 | no longer | the official host does not call it; Forge used it before this step |

### `Settings` (L6279) — the model keys

| Key | Surfaced? | Why |
| --- | --- | --- |
| `model` | yes | written by `set_model` (Default clears it) |
| `availableModels`, `enforceAvailableModels`, `modelPicker` | applied by the CLI | the CLI filters and orders the list it sends, so their effect *is* the rows shown; the official webview has no control for them (0 matches) |
| `fallbackModel`, `modelOverrides`, `modelPricing`, `advisorModel` | no | no official webview control (0 matches; `fallbackModel` hits in `index.js` are the refusal-fallback feature, out of scope) |

## Changes

- `src/webview/src/components/forge/modelCatalog.ts` (new): literal ports of
  `IH`, `PK1`, `bK`, `currentModelInfo`, `Xz0`, `X01`/`eF0`/`tF0`/`V01`, `QA0`,
  `H01`, `kH`, `mj`, `wC`, `OR`, `Mo`, `Yz0`, `V75`, and the `lastServedModel` rule.
- `ModelSelect.vue`: rows from `claudeConfig`, SDK order with alias rows last,
  Forge custom models after them, unavailable rows last and greyed; the
  "Loading models…" / "No models available" states; the pill and "Switch
  model…" labels from the ports; the picked **row** is emitted (official
  `onModelSelected`, including keeping a persisted full id). The pill `title`
  is now the official `"Switch model"` (the footer never passes `ownRow`).
  The `sdk_probe` spawn in the picker is gone.
- `Session.ts` / `useSession.ts`: `lastServedModel`, `modelRows`,
  `currentModelInfo` and the four `currentModelSupports*` computeds; `setModel`
  follows the official (optimistic, clears `lastServedModel`, reverts and
  notifies on an error response instead of reading a `success` field).
- `messages.ts`: `CliModelInfo`, `ClaudeConfig.unavailable_models`,
  `ModelOption` is the row shape, `SetModelResponse` has no `success`.
- Host: `set_model` ports the official check and `writeUserSettingsAndPush`
  (`setModel.ts` + `ClaudeAgentService.setModel`); `loadConfig` reads
  `initializationResult()`.
- `cliLaunch.ts` / `ClaudeSdkService.ts`: **the entrypoint fix.** Forge set
  `process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-vscode'` *after* building the
  launch env, so the first CLI of every window reported the SDK default
  `sdk-ts` — and a CLI that isn't `claude-vscode` never sends
  `unavailable_models`. `withOfficialEntrypoint` now stamps it last on the env,
  as the official `l3` does.
- Mock host: SDK-shaped rows (one without effort, one unavailable, one with
  fast mode, one on a promo) and the official `set_model` answer and check.
- `probe-oracle.js` (skill fix, see below).

## B6: does `model` in user settings get beaten by forge.json?

For the live session, no: `applyFlagSettings` sets the flag layer itself. On
the next launch Forge passes the model explicitly (`Options.model` from the
session's selection or `modelSetting`), which outranks every settings layer.
A profile that sets `model` still decides what `modelSetting` reads back on a
fresh window — that is what a profile is for — and `model` is not added to
`FLAG_SETTINGS_RESERVED_KEYS`, because `set_model` is not `apply_settings`.

## Gates

- `pnpm test`: `Test Files 14 passed (14) · Tests 258 passed (258)`
- `pnpm run typecheck:all`: `tsc --noEmit` and `vue-tsc -p src/webview/tsconfig.json --noEmit`, both silent
- `pnpm run build`: `✓ built in 14m 51s`, exit 0. `Forge brand guardrail: clean (300 files scanned)` ·
  `Forge token check: clean (235 tokens used, 382 defined)` · `Forge command check: clean (20 commands, 13 references)`

## Oracle

| Window (root selector) | Structural diffs | Note |
| --- | --- | --- |
| `.fg-commandmenu__menuPopup` (**model** menu open, 6 rows incl. greyed + promo) | **0** — 57/57 clean | baseline 51/51; the extra elements are the new rows and the `<s>` |
| `.fg-composer__inputWrapper` (idle) | **0** — 29/29 clean | = baseline |
| `.fg-menu__menuPopup` (Modes menu open) | **0** — 41/41 clean | = baseline, after the probe fix |
| `.fg-shell__header` | **0** — 15/15 clean | = baseline |
| `.fg-markdown__root` (one-code-block message) | **1** — 9/10 clean | the known `codeBlockWrapper pre` font-family harness artifact; a smaller message than the baseline's 30 elements |

### Skill fix: `probe-oracle.js` reported a false opacity diff with the pane hidden

The Modes menu first measured 40/41 with `opacity: forge 1 | official 0` on the
popup, three runs in a row. Isolated with no Forge code at all: while the Browser
pane is hidden, Chromium does not advance animation clocks — a bare
`@keyframes` element read `currentTime 0` / opacity 0 after 400 ms (main
document *and* iframe) and only reached 1 around 2.4 s. The probe's fixed
400 ms wait assumed a visible pane. It now also calls `finish()` on every
animation **in its clone iframe** before comparing; the live page is never
touched. With that, 41/41.

## Specs added

`test/modelMetadata.spec.ts` — 46 cases:

- `IH` keeps the CLI order and every field, incl. `disabled` / `promoListPrice`; either list may be absent;
- `PK1` keeps an alias-free list as is, moves "alias"/"aliases" rows last, ignores "aliasing";
- `bK` / `currentModelInfo`: Default for no selection, full id → alias row (never Default), `[1m]` stripped, unknown → `undefined`, capability fields read off the row;
- `Xz0`: full id ticks its alias row; an uncovered id (custom model) stays ticked;
- `wC`: row name; served model of another family; same family keeps the name; Bedrock inference-profile id; unknown family keeps the name; codename masking; "The previous model";
- the pill: Default → resolved model, → served model; minor versions; newer served model of the same family; 1M; own-name rows; unlisted full id; "Model";
- `V75`: split around the first price; no promo / no price → plain;
- `lastServedModel`: top-level only, not sub-agent, not `<synthetic>`, not non-assistant;
- host `set_model`: accepts a row and a bare `{value}`, `[1m]` and custom ids; **rejects** `undefined`, `null`, a string, a number, `{}`, `[]`, `{value:42}`, `{value:null}`, `{displayName}` with the official message; Default → `{model:null}`;
- entrypoint: stamped `claude-vscode`, wins over a user variable, does not mutate;
- `Session` end to end: capability computeds per model, `lastServedModel` recording, `setModel` sends the row and clears the served model, and **reverts + notifies** on a host error.

## Pre-existing issues found, not fixed here

1. **The pill has no space between the model and the effort.** The official
   markup is `[labelSpan, " ", effortSpan]`; Forge's space sits *inside* the
   effort span, where Vue's whitespace condensing drops it — the pill's text is
   `Opus 5Medium`, gap 4 px (margin only) instead of a space + 4 px. The
   oracle can't see text nodes. The effort span is step 13's subject, so it is
   fixed there with the official markup.
2. Carried forward: `handleGetAssetUris` derives `extensionPath` from `process.cwd()`.
3. Carried forward: the mock host acks unknown requests without a `success` field.
4. The Settings page (`SettingsStore`, `SettingsTabModels.vue`) still lists
   models via an `sdk_probe` CLI spawn and drops greyed rows. Not part of the
   composer picker; left as is.

## Rows deliberately left out and why

None in this step. Out-of-scope features are unchanged from
[out-of-scope.md](../out-of-scope.md) (Ultracode moved into scope on
2026-09-18, built in step 13). Specific to the model picker:

| Feature | Official | Reason |
| --- | --- | --- |
| Refusal fallback notice / "Switch models when flagged" | `applyRefusalFallback`, `switchModelsOnFlag` | out of scope (gated by experiment flags Forge never receives) |
| Auto mode row | `currentModelSupportsAutoMode` → mode menu | state is exposed; the row is not in `CLAUDE.md`'s scope |

## VS Code checklist for the user — **unverified**

1. Open the model picker. **Expected:** the same models, order and descriptions
   as Claude Code's picker for the same account.
2. On an account with a model excluded by your org's data-retention setting,
   open the picker. **Expected:** that model is listed last, greyed, and
   clicking it does nothing. (Needs first-party auth and no custom
   `ANTHROPIC_BASE_URL`; the CLI sends no greyed rows otherwise.)
3. Pick Opus. **Expected:** `~/.claude/settings.json` has `"model": "opus"`
   (other keys untouched), and the next turn is answered by Opus
   (the assistant message's `model` is `claude-opus-…`; the pill reads "Opus 5").
4. Pick Default. **Expected:** the `model` key is **removed** from
   `~/.claude/settings.json`, and the pill names the default model ("Sonnet 5"),
   not "Default".
5. Reload the window. **Expected:** the picker ticks the model from step 3/4.
6. Pick Default, send a turn that gets served by another model family (e.g. via
   a fallback). **Expected:** the pill and "/" → "Switch model…" name the model
   that actually answered.
