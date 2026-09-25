# The model picker lists what answers

The user's request (2026-09-25): "be sure that model selection works fine and
shows me in the list only responsive models with ping; sync every 5 min; a
refresh icon so the user, when facing an issue with a model already selected,
can refresh the model selection window to see what's available", and, mid-way,
"respect the Pajamas colour palette and the Anthropic design system for the
button and text".

The official picker has none of this: its rows are the CLI's Claude tiers, and
its greyed `unavailable_models` rows come from the CLI. So this is Forge's own,
built on the official markup (`aV0`, modules G8AMvA / G_S7FQ), the official bare
icon button (`fg-iconbutton`, YKLzCw), and the existing `sync_endpoint_health`
request. No new request type: the refresh is the same sweep **Settings →
Endpoints → Sync** sends. Design record: `docs/forge-design.md` #54.

Where it was run: linux-x64; the harness (`drive-all.mjs`, headless Chromium,
stub host); code-server 4.105.1 with the bundled CLI 2.1.274 and the stub
gateway for the e2e scenario. **Real VS Code on Windows and the user's gateway
(`localhost:20128`) were not reachable from this container**: the checklist at
the end is what to run there.

## What changed

| Piece | Before | Now | Where |
| --- | --- | --- | --- |
| Which pairs are listed | every endpoint, a dead one with "did not answer: …" in its description | the ones whose model answered its last check, plus the ones not checked yet ("not measured" is not "dead": right after adding an endpoint, or with the check off, hiding them would empty the picker). A pair that did not answer, or whose check could not be sent (refused key, DNS), goes to `unavailable_models` (`disabled`, the reason in the description); the chat picker shows that row only while it is the model in use | `shared/pairHealth.ts`, `handlers.ts` `endpointModelRows`, `ModelSelect.vue` |
| Ping | "answered in 1.4s" at the end of the description | a chip after the name, as a Pajamas badge: success under 1 s, neutral under 3 s, warning above; tabular figures; tooltip "Answered a check in 1.4s 2 min ago" | `ModelSelect.vue`, `forge-design.css`, `forge-tokens.css` (`--forge-badge-*`) |
| Refresh | none in the picker | the official bare icon button with Heroicons `16/solid/arrow-path`, beside "Select a model"; sends `sync_endpoint_health` (every endpoint), spins while checking (`aria-busy`), keeps the menu open, the rows re-render from the host's `update_state` push | `ModelSelect.vue`, `forge/icons/RefreshIcon.vue` |
| Check interval | 60 min default, and a bug: a check is dated when it finishes, so on the next tick it was a few seconds short of one interval and was skipped; the real interval was twice the setting | 5 min default; a check is due `min(30 s, interval / 2)` early (`isSweepDue`) | `healthStore.ts`, `health.ts`, `package.json` |
| Welcome gate's "healthy" count | counted old answers of an endpoint whose last check could not be sent | the picker's rule (`answeringModelCount`) | `handlers.ts` (`handleInit`), `ChatPage.vue` |
| Settings → Models | every pair | still every pair (`sdk_probe`), in profile order | `handlers.ts` `allEndpointModelRows` |

Design system, per the user's second message:

- **Button**: the official webview's own bare icon button, unchanged (24px box, 4px padding, 4px radius, `--app-secondary-foreground`, ghost hover). Measured 24x24, 16px glyph, 4px radius, centred on the header (±0.0px).
- **Glyph**: the official icons are Heroicons micro (16px solid, `data-slot="icon"`); its search-clear glyph is byte-identical to Heroicons `16/solid/x-mark`. So the refresh is Heroicons 2.2.0 `16/solid/arrow-path`, copied from the npm package (jsDelivr was blocked by this container's egress policy; the npm registry was not).
- **Colour**: Pajamas badge tokens, read from `@gitlab/ui` 137.2.2 `src/tokens/build/css/tokens.css`: `--gl-badge-success-*` green-100 fill and green-700 text, `--gl-badge-warning-*` orange-100 / orange-700, `--gl-badge-neutral-*` neutral-100 / neutral-700. That file ships light values only, so dark uses a 22% fill of the 500 stop with the 200 stop as text, and high contrast the host foreground. The spinner tints `--forge-brand` (Pajamas purple). No raw colour anywhere (`lint:brand`, `lint:tokens` clean).
- **Text**: the header, row name and description are the official classes, untouched; the chip text is Anthropic Sans at the chips' 0.78em, `tabular-nums`.

## B9 table

`request`: what the row sends. `host result`: the real handler's answer (specs,
and the real host in the e2e scenario). `UI effect`: measured in the harness or
in code-server.

### Harness (`drive-all.mjs`, stub host, dark theme)

The stub host serves the rows exactly as the real host now does: three
answering pairs (820ms, 1.4s, 3.2s) and one that did not answer
(`vllm-llama`, "connect ECONNREFUSED") in `unavailable_models`. Its
`sync_endpoint_health` marks every row checking, then the dead pair answers
(640ms) and the host pushes `update_state`.

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| Model picker: rows | — | `get_claude_state`: 3 in `models`, 1 in `unavailable_models` | 3 pairs listed (auto, claude-opus-5, qwen3-coder); llama-3.3-70b not listed | works |
| Model picker: ping chips | — | `check: {state:'answered', ms}` on each row | 820ms fast `rgb(145,212,168)` (green-200) on a 22% green-500 fill; 1.4s fair `rgb(220,219,217)` on 10% neutral; 3.2s slow `rgb(233,190,116)` (orange-200) on 22% orange-500; `tabular-nums`; tooltip "Answered a check in …" | works |
| Model picker: refresh button | — | — | 24x24 box, 16px Heroicons glyph (`data-slot="icon"`), 4px radius, centred on "Select a model" ±0.0px; header 676px = list 676px (the float does not narrow the official header); label "Check which models answer" | works |
| Model picker: refresh (click) | `sync_endpoint_health {}` (every endpoint, not cancel) | answered; `update_state` pushed | `aria-busy` true while checking, then false; menu stayed open; llama-3.3-70b appears with 640ms; no `set_model` | works |
| Model picker: pick each of the 3 pairs | `set_model` | answered | the pill names the pair | works (3 rows) |
| Model in use, not answering (`?modelInUse=vllm-llama`) | — | the in-use pair is in `unavailable_models`, `active` | pill "llama-3.3-70b"; its row greyed (opacity .5, `aria-disabled`, `aria-selected`): "vllm-llama · gpu-box:8000 · did not answer: connect ECONNREFUSED"; the only greyed row | works |
| … click the greyed row | nothing | — | nothing sent, menu stays open | works |
| … Enter on the focused refresh | `sync_endpoint_health {}` | answered | checks again, no `set_model`; the row is no longer greyed and shows 640ms | works |
| "/" menu: Toggle fast mode (claude-opus-5) | `open_claude_in_terminal` | answered | still found by name with the ping chip beside it (the drive now reads the label's own text node) | works |

Oracle (`probe-oracle.js`), with Forge's chips and refresh taken out of the DOM
while it measures:

| Window | Checked | Clean | Structural | Verdict |
| --- | --- | --- | --- | --- |
| model menu | 39 | 38 | 1: the current model's name at weight 600 (Forge's existing rule for the ticked row, unchanged) | 0 new vs baseline |
| model menu (in use, not answering) | 28 | 27 | 1: the same | new window, baselined |

Whole harness run: **115 pass, 0 fail, 1 left out** (Toggle fast mode for a
model without it, as the official), every oracle window at its baseline.

### End to end (`e2e/launch.mjs`, scenario 24, code-server 4.105.1, the real host, CLI 2.1.274, stub gateway)

A second profile, `e2e-dead`, whose model (`retired-model`) the stub does not
serve, is written to the machine settings (`Machine/settings.json`, where
code-server reads machine-scoped settings). The kit keeps the periodic check off
(`syncIntervalMinutes: 0`), so every check below is the refresh.

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| Picker before any check | `update_state` push after the settings change | both pairs `unchecked` | both offered: qwen3-coder, retired-model, each "not checked yet" | works |
| Pick retired-model | `set_model` | the endpoint selected | the pill names retired-model | works |
| Refresh, with retired-model in use | `sync_endpoint_health {}` | the gateway's log: one `max_tokens: 4` probe per endpoint, qwen3-coder 200, retired-model 404 | `aria-busy` true while checking (the stub held replies 1.5s); menu stayed open; qwen3-coder with ping 1.5s (fair); retired-model greyed: "e2e-dead · 127.0.0.1:11434 · did not answer: model retired-model not found"; the pill still names it | works |
| Pick qwen3-coder, reopen | `set_model` | — | only qwen3-coder listed; retired-model gone from the list | works |
| 5-minute schedule | — | not observable in the kit (check off, and an 11-minute wait) | — | unverified here; proven by the fake-clock spec; checklist step 7 |

## Specs

`test/modelPickerHealth.spec.ts` (20): the pair rule (`pairCheck` for each state,
`error` over an older answer, a verdict about another model ignored, `syncing`),
`isOffered`, the status text, the gate count, the ping text and tones, the
5-minute default in code and in `package.json`, `isSweepDue` (never checked,
off, a few seconds early, the slack capped for a 1-minute interval), the timer
itself (fake clock, 15 s checks: checks at 0, 5 and 10 minutes; it fails
without the fix, checked by reverting it), and through the handlers:
`get_claude_state` rows and `unavailable_models`, the in-use mark on a dead
pair, `sdk_probe` listing every pair in order, `handleInit`'s healthy count.
`test/endpointHealth.spec.ts` and `test/endpointModelList.spec.ts`: the older
tests that asserted a dead pair stays listed now assert the new rule.

Gates: `pnpm test` 2557 passed (8 skipped), `typecheck:all`, `lint` (0 errors), `lint:forge` (brand, tokens, commands), `build`, and `pnpm run package` (all of the above, then the universal VSIX: `check-dist --universal` clean, `forge.vsix` 208 MB).

## Checklist (VS Code on Windows, your gateway) — unverified here

1. Settings → `forge.endpointHealth.syncIntervalMinutes`: the default reads 5,
   and the description says twelve 4-token requests an hour per endpoint.
2. With omniroute running, open the model picker: every endpoint whose model
   answers is listed with a ping chip after its name (green under 1 s, grey
   under 3 s, orange above). Hover it: "Answered a check in … N min ago".
3. Add a second endpoint whose model does not exist on the gateway (or stop a
   local server one points at). Within 5 minutes, or at once with the refresh,
   it leaves the picker. **Settings → Models** still lists it.
4. Click the refresh (the circular arrows beside "Select a model"): it spins,
   the menu stays open, and the list updates when the check ends. The
   **Forge** output channel shows `[sync_endpoint_health] sweeping every
   profile` and one `[health] sweeping "<name>"` line per endpoint.
5. Select an endpoint, then make it fail (stop omniroute). Refresh: the pill
   still names the model; the picker shows it greyed with "did not answer: …"
   and it cannot be clicked. Start omniroute, refresh: it is listed again with
   its ping.
6. Tab to the refresh and press Enter: it checks again and does not pick the
   highlighted model.
7. Leave VS Code open 11 minutes with the Forge output channel visible: a
   `[health] sweeping` line about every 5 minutes, not every 10.
8. Dark, light and high-contrast themes: the ping chips and the refresh stay
   legible (the slow chip is Pajamas orange; high contrast draws all three in
   the theme's foreground).
