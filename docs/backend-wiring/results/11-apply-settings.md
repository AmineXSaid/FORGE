# Step 11: `apply_settings` whitelist and precedence

Group 4's first step. `apply_settings` had no existence in Forge at all — no
type, no transport method, no dispatcher case, no handler — so this is the whole
request, wired the six ways B2 requires, with the official `tu$` whitelist and
the `applySettings` / `writeUserSettingsAndPush` behaviour ported from
`extension.js`.

The precedence question `CLAUDE.md` B6 asks about turned out to be a real bug in
Forge, not a hypothetical. It is written up in full in
[settings-precedence.md](../settings-precedence.md).

## What the official actually does

```js
// tu$ -- the whitelist, with a layer and a value check per key
var tu$ = {
  effortLevel:            {layer:"userSettings",  value: $ => typeof $ === "string"},
  ultracode:              {layer:"flags",         value: $ => $ === null || typeof $ === "boolean"},
  switchModelsOnFlag:     {layer:"userSettings",  value: $ => typeof $ === "boolean"},
  outputStyle:            {layer:"localSettings", value: $ => typeof $ === "string"},
  remoteControlAtStartup: {layer:"userSettings",  value: $ => typeof $ === "boolean"},
};
```

`applySettings` resolves a target layer —
`flagsOnly ? "flags" : scope === "localSettings" ? "localSettings" : "userSettings"`
— then refuses any key that is not on the list, **or whose declared layer is not
the target**, or whose value fails the check. Only then does it write.

`writeUserSettingsAndPush` merges into `~/.claude/settings.json`
(`JSON.stringify(x, null, 2) + "\n"`, `null` deletes a key) and afterwards calls
`await query.applyFlagSettings(settings)`.

Forge's whitelist carries `effortLevel` only. `outputStyle` arrives in step 29;
`ultracode`, `switchModelsOnFlag` and `remoteControlAtStartup` are out of scope
per `CLAUDE.md`, so they are absent and therefore rejected by the same code path
as any other unknown key.

## Results

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| (no UI yet — the effort control lands in step 13) | — | — | — | n/a |
| accept | `{type:"apply_settings", settings:{effortLevel:"high"}}` | `apply_settings_response`; merged into `~/.claude/settings.json`, then `query.applyFlagSettings` on the live session | none yet | works |
| accept | `{settings:{effortLevel:"low"}}` / `{"xhigh"}` | `apply_settings_response` | none yet | works |
| accept | `{settings:{}}` (empty patch) | `apply_settings_response` | none yet | works |
| reject | `{settings:{effortLevel:"high", ultracode:true}}` | `error` naming `ultracode`; **nothing written** | none | works |
| accept | `{settings:{effortLevel:null}}` | `apply_settings_response`; the key is deleted, not set to null | none yet | works |
| reject | `{settings:{ultracode:true}}` | `error`: `… "ultracode" cannot be written from the webview …` | none | works |
| reject | `{settings:{switchModelsOnFlag:true}}` | `error`, same shape | none | works |
| reject | `{settings:{remoteControlAtStartup:true}}` | `error`, same shape | none | works |
| reject | `{settings:{outputStyle:"explanatory"}}` | `error`, same shape (until step 29) | none | works |
| reject | `{settings:{apiKeyHelper:"x"}}` | `error`, same shape | none | works |
| reject | `{settings:{effortLevel:42}}` | `error`: `… unexpected value or target for "effortLevel"` | none | works |
| reject | `{settings:{effortLevel:"high"}, flagsOnly:true}` | `error`: same — a userSettings key cannot be aimed at the flag layer | none | works |
| reject | `{settings:{effortLevel:"high"}, scope:"localSettings"}` | `error`: same | none | works |
| reject | `{settings:{}, flagsOnly:true, scope:"localSettings"}` | `error`: `flagsOnly and localSettings scope are exclusive` | none | works |

All 15 payloads were driven through the harness against the mock host, which
enforces the same whitelist. The mock-host log shows **only the 5 accepted**
requests arriving; the 10 rejections never reached a write.

**Counts:** works 15 · partial 0 · broken 0 · left out 4 (`ultracode`,
`switchModelsOnFlag`, `remoteControlAtStartup` out of scope; `outputStyle`
deferred to step 29)

Step 11 deliberately ships no UI. The step file says so — *"(The UI that uses it
arrives in step 13.)"* — and B4 says a row appears only when its backend works,
so nothing was added to the composer or either menu.

## B6: the precedence bug this step found and fixed

Forge launches the CLI with `--settings ~/.claude/forge.json`, which is the
**flag layer — the highest priority** ("Flag settings sit above
user/project/local", `sdk.d.ts` L2729).

`ConfigurationService.syncProfileToForge()` copied the **entire** active profile
into that file. A profile containing `effortLevel` therefore outranked
`~/.claude/settings.json`, which is exactly where `apply_settings` writes. The
user's choice would have been silently ignored on every launch while the label
still changed — the B7 failure mode.

**The decision, matching how the official layers resolve:** strip the keys
`apply_settings` owns from the forge.json sync, so the flag layer stays a
live-apply channel and never a store. `FLAG_SETTINGS_RESERVED_KEYS` is derived
from `WEBVIEW_WRITABLE_SETTINGS`, so adding `outputStyle` in step 29 cannot
reintroduce the bug. Full reasoning and the rejected alternative:
[settings-precedence.md](../settings-precedence.md).

| When | Where `effortLevel` resolves from | Before | After |
| --- | --- | --- | --- |
| live session | `applyFlagSettings` (session-scoped) | never called | the user's value |
| next launch | forge.json vs `settings.json` | the profile's value won | forge.json no longer pins it; the user's value wins |

Everything else a profile carries (`model`, `env`, `permissions`, `mcpServers`, …)
still overlays through forge.json exactly as before.

## SDK calls used (0.3.274)

| Call | `sdk.d.ts` | Why |
| --- | --- | --- |
| `Query.applyFlagSettings(settings)` | L2749 | live-apply to the running session; session-scoped, writes no file |
| `Query.updateSettings('localSettings', settings)` | L2762 | the CLI's own writer for `.claude/settings.local.json`; the only source it accepts |
| `Settings.effortLevel` | L8472 | `'low' \| 'medium' \| 'high' \| 'xhigh'` — the persisted type, which **excludes** `'max'` |
| `EffortLevel` | L623 | `… \| 'max'`; `'max'` is session-only and never written to a settings file |

## Gates

- `pnpm test`: `Test Files 13 passed (13) · Tests 212 passed (212)`
- `pnpm run typecheck:all`: `tsc --noEmit` and `vue-tsc -p src/webview/tsconfig.json --noEmit`, both silent
- `pnpm run build`: `✓ built in 17m 58s`, exit 0 (two independent runs, both exit 0).
  Lint gates: `Forge brand guardrail: clean (298 files scanned)` ·
  `Forge token check: clean (235 tokens used, 382 defined)` ·
  `Forge command check: clean (20 commands, 13 references)`

## Oracle

Step 11 adds no markup and no CSS, so the four parity baselines are unchanged
from the step 10 measurement, re-confirmed on this build:

| Window (root selector) | Structural diffs | Colour diffs (expected, brand) |
| --- | --- | --- |
| `.fg-composer__inputWrapper` | **0** — 29/29 clean | link and blockquote only |
| `.fg-menu__menuPopup` (Modes menu open) | **0** — 41/41 clean | as above |
| `.fg-shell__header` | **0** — 15/15 clean | as above |
| `.fg-markdown__root` | **1** — 29/30 clean (the known `codeBlockWrapper pre` font-family harness artifact) | as above |
| `.fg-commandmenu__menuPopup` (**model** menu open, effort slider on screen) | **0** — 51/51 clean | as above |

**Correction to the step's instruction.** The brief said to "measure
`.fg-menu__menuPopup` with the model menu open". Those are two different windows:
`.fg-menu__menuPopup` is the **Modes** menu, and the model menu renders into
`.fg-commandmenu__menuPopup` with a `.fg-modelmenu__listbox` inside it. Both were
measured, and both are clean.

## Specs added

`test/applySettings.spec.ts` — 24 cases:

- the whitelist holds exactly `effortLevel`, on the `userSettings` layer;
- every effort level the CLI takes is accepted, and `null` clears the key;
- each out-of-scope key (`ultracode`, `switchModelsOnFlag`,
  `remoteControlAtStartup`), `outputStyle`, and a spread of dangerous keys
  (`apiKeyHelper`, `permissions`, `env`, `hooks`, `awsAuthRefresh`, `model`) are
  rejected with the official message;
- prototype-chain keys (`toString`, `constructor`, `__proto__`,
  `hasOwnProperty`) are rejected, because `Object.hasOwn` is what guards the
  lookup;
- wrong value types rejected; a patch with one bad key rejects entirely, so
  nothing is written;
- layer targeting: `effortLevel` refused under `flagsOnly` and under
  `scope:"localSettings"`; `flagsOnly` + `localSettings` refused as contradictory;
- the file merge keeps unrelated keys, adds new ones, deletes on `null`, and does
  not mutate its input;
- B6: `stripFlagReservedKeys` removes `effortLevel` and leaves `model`, `env`,
  `permissions`, `mcpServers` alone, and `FLAG_SETTINGS_RESERVED_KEYS` stays in
  lockstep with the whitelist.

## Deviations from the step file, and one observation

1. The step file points at `ClaudeSdkService.ts` "~L201–230, ~L363" for the
   forge.json launch. Those lines moved in step 07; the current sites are
   `ClaudeSdkService.ts:213` and `:367`. Corrected in the step file.
2. `BaseTransport.applySettings(settings, opts, channelId)` takes `channelId`
   last; the official's is `applySettings(channelId, settings, opts)`. The **wire
   payload is identical** — confirmed in the built bundle:
   `applySettings(e,t,n){return this.sendRequest({type:\`apply_settings\`,settings:e,flagsOnly:t?.flagsOnly,scope:t?.scope},n)}`
   — the argument order just follows Forge's other transport methods, where
   `channelId` is an optional trailing parameter.
3. The step file expects the handler in `handlers/handlers.ts`. It is on
   `ClaudeAgentService` instead, because the live-apply half needs the channel's
   `Query`, which `HandlerContext` does not carry — the same place
   `set_thinking_level`, `set_model` and `set_permission_mode` already live. The
   pure whitelist is in `settingsWhitelist.ts` so it stays testable.
4. **Observation, not changed:** the official's value check for `effortLevel` is
   `typeof $ === "string"`, so the official host will write *any* string into
   `~/.claude/settings.json`, including one `Settings.effortLevel` cannot hold.
   Ported literally per the step file's "port `tu$` … literally". If a tighter
   enum check is wanted, it is a one-line change to
   `WEBVIEW_WRITABLE_SETTINGS.effortLevel.value` — but it would be a divergence,
   so it was not made unilaterally.

## Pre-existing issues found, not fixed

Carried forward from the group 3 report, both still open:

1. `handleGetAssetUris` derives `extensionPath` from `process.cwd()`, which is
   not the extension root. `IClaudeSdkService.asAbsolutePath` (added in step 09)
   would fix it.
2. The harness mock host acks unknown requests without a `success` field.
3. **Relevant to step 13:** the ported effort slider renders a visible
   `fg-effortslider__notchUltracode` notch (`display: block`, `opacity: 1`,
   4px wide). Ultracode is explicitly out of scope in `CLAUDE.md` and
   `out-of-scope.md`, so that notch should not be on screen. Not touched here —
   it is pre-existing, and the effort control is step 13's subject.

## Rows deliberately left out and why

Unchanged from `out-of-scope.md`; see
[results/03-dispatcher.md](03-dispatcher.md) for the full table. The ones that
bear on this step specifically:

| Feature | Official key | Reason |
| --- | --- | --- |
| Ultracode | `ultracode` (flags layer) | out of scope; not in Forge's whitelist |
| Switch models when flagged | `switchModelsOnFlag` (userSettings) | gated by Anthropic experiment flags Forge never receives |
| Remote Control at startup | `remoteControlAtStartup` (userSettings) | out of scope: account and cloud |
| Output styles | `outputStyle` (localSettings) | in scope, but step 29 — not added early |

## VS Code checklist for the user — **unverified**

The harness proves the webview↔host contract. None of this was observed against
real VS Code or the real CLI.

1. Note the current contents of `~/.claude/settings.json`, especially keys other
   than `effortLevel` (`env`, `permissions`, …).
2. With a session running, send from the webview devtools console:
   `{type:"apply_settings", settings:{effortLevel:"high"}}`.
   **Expected:** `apply_settings_response`; `~/.claude/settings.json` now has
   `"effortLevel": "high"`, two-space indented with a trailing newline, and every
   other key from step 1 is untouched.
3. Send `{type:"apply_settings", settings:{effortLevel:null}}`.
   **Expected:** the `effortLevel` key is **removed** from the file, not set to
   `null`.
4. Send `{type:"apply_settings", settings:{ultracode:true}}`.
   **Expected:** an error response naming `ultracode`, and **no change to any
   settings file**.
5. Send `{type:"apply_settings", settings:{effortLevel:"high"}, flagsOnly:true}`.
   **Expected:** an error response, because `effortLevel` belongs to
   `userSettings`; no file changes.
6. **The B6 case.** Create a profile, put `"effortLevel": "low"` in
   `~/.claude/settings.<profile>.json`, and switch to it.
   **Expected:** `~/.claude/forge.json` does **not** contain `effortLevel`, while
   the profile's other keys (e.g. `model`) are still there.
7. With that profile still active, repeat step 2 to set `high`, then restart VS
   Code. **Expected:** effort is still `high` — the profile does not win.
8. After step 13 adds the control: change effort in the model menu and confirm
   with `claude` that the running session reports the new effort (B7 — the value
   must change behaviour, not just the label).
