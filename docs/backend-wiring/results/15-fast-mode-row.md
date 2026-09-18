# Step 15: "Toggle fast mode" row

Group 4, fifth step. The official "/" menu has a "Toggle fast mode" row for
models that support fast mode; Forge had none (its `menuCommands` comment listed
fast mode among rows it could not serve). Step 12 exposed
`currentModelSupportsFastMode` and step 09 re-enabled `open_claude_in_terminal`,
so the row now exists, gated like the official's.

## What the official actually does

```js
// index.js, the "/" registry
if (!$.currentModelSupportsFastMode.value) { J.commandRegistry.unregisterAction("fast"); return }
J.commandRegistry.registerAction({id:"fast", label:"Toggle fast mode",
  description:"Toggle fast mode for faster responses (Opus only)"}, "Model",
  () => { J.openClaudeInTerminal("/fast", [], "bottom") })
// currentModelSupportsFastMode = currentModelInfo.value?.supportsFastMode ?? false
// Model-section order: ["model","effort-level","toggle-thinking","switch-models-on-flag","account-usage"], then the rest
```

No `keepMenuOpen`, so the menu closes. The request is step 09's, whose host
validator (`JI0`) accepts a bare slash command and an empty argument list.

## Results

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| "/" on Sonnet (`supportsFastMode: false`) | — | — | **no** "Toggle fast mode" row | works |
| "/" on Haiku (no `supportsFastMode`) | — | — | no row (and no Effort row) | works |
| "/" on Opus (`supportsFastMode: true`) | — | — | row after Thinking; tooltip "Toggle fast mode for faster responses (Opus only)"; no trailing control | works |
| click "Toggle fast mode" | `{type:"open_claude_in_terminal", prompt:"/fast", args:[], location:"bottom"}` | `open_claude_in_terminal_response` (mock, with the host's `JI0` check); the host validator accepts it (spec) | menu **closes** | works |

**Counts:** works 4 · partial 0 · broken 0 · left out 0

## Every SDK field on the objects this step touched

| Field | Surfaced? | Where / why not |
| --- | --- | --- |
| `ModelInfo.supportsFastMode` | yes | gates the row (`currentModelSupportsFastMode`, matched by value, `[1m]`-stripped value, then `resolvedModel`) |
| `Settings.fastMode` (L8508) | via the CLI | `/fast` in the terminal is what the official uses to toggle it; the webview has no direct control |
| `Settings.fastModePerSessionOptIn` (L8512) | via the CLI | no official webview control |
| `SDKControlInitializeResponse.fast_mode_state` / `fast_mode_disabled_reason` (L4309), `SDKSystemMessage.fast_mode_state` | no | the official shows them only in the composer's spark legend (`U85`: "Fast mode enabled" / "cooling down") and the fieldset's `data-spark`; `00-index.md` forbids bringing that legend back |

## Changes

- `src/webview/src/components/forge/fastMode.ts` (new): the registry entry,
  the launch it sends, and the gate.
- `ButtonArea.vue`: the row after Thinking when `supportsFastMode`; its handler
  sends the official launch through `transport.openClaudeInTerminal`; the stale
  comment that listed fast mode as unserved is corrected.
- `ChatInputBox.vue` / `ChatPage.vue`: pass `currentModelSupportsFastMode` down.

No host or mock-host change: step 09 already wired and validates the request.

## Gates

- `pnpm test`: `Test Files 17 passed (17) · Tests 337 passed (337)`
- `pnpm run typecheck:all`: `tsc --noEmit` and `vue-tsc -p src/webview/tsconfig.json --noEmit`, both silent
- `pnpm run build`: `✓ built in 6m 16s`, exit 0. `Forge brand guardrail: clean (303 files scanned)` ·
  `Forge token check: clean (235 tokens used, 382 defined)` · `Forge command check: clean (20 commands, 13 references)`

## Oracle

| Window (root selector) | Structural diffs | Note |
| --- | --- | --- |
| `.fg-commandmenu__menuPopup` — "/" menu on Opus, with the fast-mode row | **0** — 85/85 clean | |
| `.fg-commandmenu__menuPopup` — model menu on Opus | **0** — 53/53 clean | = step 13 |
| `.fg-composer__inputWrapper` (idle) | **0** — 29/29 clean | = baseline |
| `.fg-menu__menuPopup` (Modes menu) | **0** — 41/41 clean | = baseline |
| `.fg-shell__header` | **0** — 15/15 clean | = baseline |
| `.fg-markdown__root` (one-code-block message) | **1** — 9/10 clean | the known `codeBlockWrapper pre` font-family artifact |

## Specs added

`test/fastModeRow.spec.ts` — 8 cases: the registry entry's id, label,
description and section; no `keepMenuOpen` / trailing / filter-only; present only
when supported; a copy is handed out; the launch is exactly
`("/fast", [], "bottom")`; it passes the host validator and names a known
location; it reaches the shell as `/fast`; the gate per model through the real
`Session` (Opus, its full id and `[1m]` variant yes; Default, Haiku, a custom
model and no selection no).

## Pre-existing issues found, not fixed here

1. Carried forward: `handleGetAssetUris` derives `extensionPath` from `process.cwd()`.
2. Carried forward: the mock host acks unknown requests without a `success` field.

## Rows deliberately left out

None for this step. The composer's fast-mode spark legend stays out
(`00-index.md`), as above.

## VS Code checklist for the user — **unverified**

1. Select a model that supports fast mode (Opus on an account that has it),
   open "/". **Expected:** "Toggle fast mode" under Model, after Thinking.
2. Click it. **Expected:** the menu closes and a terminal in the bottom panel
   runs `claude /fast` (the native binary Forge bundles, not a `claude` on PATH).
3. Select Sonnet or Haiku, open "/". **Expected:** no "Toggle fast mode" row.
