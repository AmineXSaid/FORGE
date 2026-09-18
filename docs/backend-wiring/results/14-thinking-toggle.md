# Step 14: Thinking toggle, separate from effort

Group 4, fourth step. Forge already had `set_thinking_level` wired, but with its
own numbers: `getMaxThinkingTokens` returned 0 or 31999, the live call passed
no display, nothing was persisted (`init` always said `default_on`), and the
webview never adopted a stored level. Step 13 already cut effort loose from
thinking; this step ports the official thinking computation, persistence and
live call, and proves the two are independent both ways.

## What the official actually does

```js
// extension.js
var u$$ = 31999;
function m$$($,Q,X){ if($==="off") return {type:"disabled"};
  return {type:"enabled", budgetTokens:u$$, display: Q??X ? "summarized" : void 0} }
async setThinkingLevel($,Q){ let X = m$$(Q, this.getShowThinkingSummariesSetting(), this.thinkingSummariesDefaultOn());
  return this.withChannel($, async (J) => {
    if (X.type==="enabled") await J.query.setMaxThinkingTokens(X.budgetTokens ?? u$$, X.display ?? null);
    else await J.query.setMaxThinkingTokens(0);
    return await this.settings.setThinkingLevel(Q), {type:"set_thinking_level_response"} }) }
getShowThinkingSummariesSetting(){ let $ = cachedClaudeSettings?.effective?.showThinkingSummaries ?? cachedUserSettings?.showThinkingSummaries;
  return typeof $==="boolean" ? $ : void 0 }
thinkingSummariesDefaultOn(){ return !1 }
getThinkingLevel(){ let $ = this.context.globalState.get("thinkingLevel"); return $ ? $ : "default_on" }
setThinkingLevel($){ this.context.globalState.update("thinkingLevel",$) }
// launch: spawnClaude(..., thinking: m$$(level, ...))    config probe: thinking {type:"disabled"}

// index.js
setThinkingLevel($,J){ let Z=this.config.value; if(Z) this.config.value={...Z,thinkingLevel:J};
  await this.sendRequest({type:"set_thinking_level",thinkingLevel:J},$) }
thinkingLevel = thinkingLevelOverride ?? config.thinkingLevel ?? "off"
registerAction({id:"toggle-thinking", label:"Thinking", description:"Toggle extended thinking mode",
  trailingComponent: Xj({isOn}), keepMenuOpen:!0}, "Model", () => setThinkingLevel(isOn ? "off" : "default_on"))
```

## Results

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| launch | `launch_claude {thinkingLevel:"default_on"}` (the level from `init`) | `Options.thinking = {type:"enabled", budgetTokens:31999}` (SDK: `--max-thinking-tokens 31999`) | — | works (spec + log) |
| "/" → Thinking (on → off) | `{type:"set_thinking_level", thinkingLevel:"off"}` — the official payload, channel on the envelope | `set_thinking_level_response`; host: `setMaxThinkingTokens(0)`, then `globalState.thinkingLevel = "off"` (spec) | switch off (`trackOn` gone); menu **stays open**; Effort row still **(Medium)**, thumb unmoved, pill still **Sonnet 5 Medium** | works |
| "/" → Thinking (off → on) | `set_thinking_level {thinkingLevel:"default_on"}` | host: `setMaxThinkingTokens(31999, null)`, then persisted (spec) | switch on; effort unchanged | works |
| effort pick while thinking **off** | `apply_settings {effortLevel:"high"}` only | — | thinking **stays off** | works |
| effort pick while thinking **on** | `apply_settings {effortLevel:"low"}` only | — | thinking **stays on** | works |
| summaries on | (`showThinkingSummaries: true` in settings) | `setMaxThinkingTokens(31999, "summarized")` | — | works (spec only) |
| reject | `set_thinking_level {thinkingLevel:"high"}` | `error: set_thinking_level: unexpected thinking level "high"`; nothing applied or stored | — | works |
| reject | `{thinkingLevel:"ultracode"}` / `true` / missing | same error shape | — | works |
| reject | unknown channel | `Channel not found: …`; nothing stored (the official `withChannel`) | — | works (spec) |
| reload | `init` | `thinkingLevel` = `globalState.thinkingLevel` (default `"default_on"`) | the toggle shows the stored level (spec: `off` stays off) | works (spec; real reload is checklist item 2) |

**Counts:** works 10 · partial 0 · broken 0 · left out 0

## Every SDK field on the objects this step touched

| API / field | Surfaced? | Where / why not |
| --- | --- | --- |
| `Options.thinking` (L1794) — `ThinkingEnabled {budgetTokens, display}` | yes | every launch, from `m$$` |
| `ThinkingDisabled` (L9132) | yes | "off", and the config probe |
| `ThinkingAdaptive` (L9119) | no | the official never sends it: `m$$` only makes enabled/disabled |
| `ThinkingEnabled.display: 'omitted'` | no | the official only ever asks for `"summarized"` or nothing |
| `Options.maxThinkingTokens` (L1816, deprecated) | no longer | replaced by `thinking` |
| `Query.setMaxThinkingTokens(budget, display)` (L2726) | yes | `(31999, "summarized" \| null)` / `(0)` |
| `Settings.showThinkingSummaries` (L8655) | yes | read from Forge's merged settings; decides `display` |
| `Settings.alwaysThinkingEnabled` (L8468) | via the CLI | the official has no control for it; the CLI applies it itself |
| `ModelInfo.supportsAdaptiveThinking` | state only (step 12) | the official never reads it (0 matches); `m$$` sends a fixed budget for every model |

## Changes

- `src/services/claude/thinkingLevel.ts` (new): `m$$` (`thinkingConfigFor`),
  the level check, the live call (`applyThinkingConfig`), and the globalState
  read/write.
- `ClaudeAgentService`: launches pass `thinking` from the requested or stored
  level; `setThinkingLevel` checks the level, needs the channel, applies, then
  persists; `showThinkingSummaries` comes from the configuration service.
  `getMaxThinkingTokens` and the instance-level `thinkingLevel` are gone.
- `ClaudeSdkService`: `SdkQueryParams.thinking` replaces `maxThinkingTokens`;
  the probe launches with thinking disabled; `getThinkingLevel` /
  `setThinkingLevel` on `globalState["thinkingLevel"]`.
- `handleInit` reports the stored level; `loadConfig` launches with thinking disabled.
- `messages.ts` / `BaseTransport`: the payload is `{type, thinkingLevel}` (no
  body `channelId`), and the transport notes the level in its config, as the official does.
- `Session`: `thinkingLevelOverride` plus the official computed
  `thinkingLevel = override ?? config.thinkingLevel ?? "off"`.
- Mock host: the official `set_thinking_level` answer, with the host's check.
- `docs/sdk-upgrade.md` #9 marked done.

The "/" Thinking row itself (`toggle-thinking`, label, description, toggle,
`keepMenuOpen`, `off`/`default_on`) was already the official row; measured, not changed.

## Gates

- `pnpm test`: `Test Files 16 passed (16) · Tests 329 passed (329)`
- `pnpm run typecheck:all`: `tsc --noEmit` and `vue-tsc -p src/webview/tsconfig.json --noEmit`, both silent
- `pnpm run build`: `✓ built in 6m 12s`, exit 0. `Forge brand guardrail: clean (302 files scanned)` ·
  `Forge token check: clean (235 tokens used, 382 defined)` · `Forge command check: clean (20 commands, 13 references)`

## Oracle

| Window (root selector) | Structural diffs | Note |
| --- | --- | --- |
| `.fg-commandmenu__menuPopup` — "/" menu (Sonnet) | **0** — 79/79 clean | |
| `.fg-commandmenu__menuPopup` — model menu (Sonnet) | **0** — 50/50 clean | = step 13 |
| `.fg-composer__inputWrapper` (idle) | **0** — 29/29 clean | = baseline |
| `.fg-menu__menuPopup` (Modes menu) | **0** — 41/41 clean | = baseline |
| `.fg-shell__header` | **0** — 15/15 clean | = baseline |
| `.fg-markdown__root` (one-code-block message) | **1** — 9/10 clean | the known `codeBlockWrapper pre` font-family artifact |

## Specs added

`test/thinkingLevel.spec.ts` — 24 cases:

- `m$$`: off → disabled (summaries or not); on → 31999 with no display, or
  `"summarized"` when the setting says so; the setting overrides a host default
  both ways; any non-"off" value is on;
- the level check accepts `off` / `default_on` and **rejects** `undefined`,
  `null`, `""`, `"on"`, `"OFF"`, `"high"`, `"ultracode"`, `"medium"`, numbers,
  booleans, objects, arrays;
- the live call: `(31999, null)`, `(31999, "summarized")`, and `(0)` with no
  second argument;
- globalState: default `default_on`, the official key, write then read;
- `ClaudeAgentService.setThinkingLevel`: apply **then** persist; off → `0`;
  summaries from settings; a non-boolean setting ignored; a bad level and an
  unknown channel refused with nothing applied or stored; the dispatcher answers
  `{type:"set_thinking_level_response"}`; it never calls `applyFlagSettings`;
- the session: the stored level from `init`, `"off"` when there is none;
  toggling sends only `set_thinking_level` and leaves effort alone; effort picks
  send only `apply_settings` and leave thinking alone, starting from on **and** off.

## Deviation from the official, deliberate

The official host takes any `thinkingLevel` and treats everything but `"off"`
as on. Forge accepts only `"off"` and `"default_on"` — the only values either
webview sends — because the value is persisted and handed back to every window
(this step's first task, and B3). Nothing legitimate changes.

## Pre-existing issues found, not fixed here

1. Carried forward: `handleGetAssetUris` derives `extensionPath` from `process.cwd()`.
2. Carried forward: the mock host acks unknown requests without a `success` field.

## Rows deliberately left out

None. Out-of-scope features are unchanged from [out-of-scope.md](../out-of-scope.md).

## VS Code checklist for the user — **unverified**

1. "/" → Thinking **off**, send a turn. **Expected:** no thinking block in the
   answer; the output channel's launch/`[setThinkingLevel]` line shows
   `{"type":"disabled"}` / `off`.
2. Reload the window. **Expected:** "/" → Thinking is still off (stored in the
   extension's globalState, not in any settings file).
3. Turn Thinking **on**, send a turn on a thinking-capable model. **Expected:**
   a thinking block appears.
4. Add `"showThinkingSummaries": true` to `~/.claude/settings.json`, reload,
   send a turn. **Expected:** thinking is shown summarized.
5. With Thinking off, pick each effort level. **Expected:** Thinking stays off.
   With Thinking on, pick each level. **Expected:** it stays on.
6. Toggle Thinking at any effort. **Expected:** the effort label and
   `~/.claude/settings.json`'s `effortLevel` do not change.
