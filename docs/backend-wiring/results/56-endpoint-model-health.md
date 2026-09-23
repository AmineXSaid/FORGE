# Endpoint & model health

**What changed in one line:** the model picker now offers models that *answered
a real request*, not models a gateway *listed*. When none of them do, the
welcome page says so instead of reporting "101 models".

## The defect

`probeOne` in `src/services/endpoints/check.ts` has always been able to tell the
difference: one `max_tokens: 4` completion per id, with a timeout reported
distinctly as *"listed, but accepted the request and never answered"*. Its own
docstring carries the measurement: of 101 ids one NVIDIA account listed, **28
answered, 60 returned 404, 10 hung and 3 errored**.

Three things stopped that reaching the user:

1. `servedModels` called `listModels` and handed the raw ids straight to the
   picker.
2. `keepServable` ran only from the interactive commands, and nothing kept the
   result, so nothing could be shown, filtered on or refreshed.
3. `showEndpointWelcome` was `modelCount === 0` over the *raw* list, so a
   profile serving 101 unreachable ids read as "101 models, all good".

## B1: no official counterpart

The official extension has no endpoint concept: `extension.js` has no
`case"get_endpoint_health"`, no sweep, no model-servability notion at all. There
is nothing to copy, so B1 does not apply to the two new requests. They follow
the shape of Forge's existing `run_endpoint_action` instead, where the webview names
a profile from a set the host already knows, never a URL, a header or a command.

## B9: row by row

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| Settings → Endpoints → **Sync all** | `sync_endpoint_health {}` | `syncAll()` → list, probe, store, per profile | table fills in; button becomes **Cancel** while it runs | works (harness + specs) |
| Settings → Endpoints → row **Sync** | `sync_endpoint_health {profileName}` | `syncProfile(name)` after validating the name | that row only; `checked / total` counts up | works (harness: `{"profileName":"nvidia-nim","cancel":false}`) |
| Settings → Endpoints → **Cancel** | `sync_endpoint_health {profileName, cancel:true}` | `cancelSync` aborts the in-flight probe | progress stops; prior verdicts kept | works (spec: cancellation keeps prior verdicts) |
| Settings → Endpoints → row disclosure | none (local) | none | per-model table: id, verdict mark, ping, `detail` | works (harness: 5 rows, incl. the never-answered text) |
| Settings → Endpoints, on open | `get_endpoint_health {}` | pure read of `globalState` | one row per profile: status, `n / m`, median ping, relative time | works (harness: columns + 2 rows) |
| Welcome → **Check health** | `sync_endpoint_health {}` | `syncAll()` | gate lifts itself when a model answers, from the push alone | works (harness) |
| Welcome → **Skip to chat** | none (webview state) | none | gate closes, composer appears, skip remembered | works (harness: `forge.endpointWelcomeSkipped = 1`) |
| Welcome → **Set up an endpoint** | `run_endpoint_action {add}` | unchanged | unchanged | unchanged |
| Welcome table | `get_endpoint_health {}` | pure read | a real table: endpoint, status dot, `0 of 5` in danger colour | works (harness) |
| Model picker | `get_claude_state` / `sdk_probe` | `endpointModelRows` filters through the verdicts | only models that answered; each annotated `answered in 2.3s` | works (specs) |
| Host push | `endpoint_health_update` | `onDidChangeHealth` → `notifyClient`, coalesced 400ms | a sweep in Settings updates the welcome page | works (harness) |
| Timer | none | `syncDue()` on activation and every `syncIntervalMinutes` | none directly | **unverified against real VS Code** (see checklist 7) |

**Counts:** 2 new requests + 1 new push, 6 places each (B2); 1 new setting; 52
specs in `test/endpointHealth.spec.ts`; **22 harness checks**, all passing (the
figure of 18 this line used to carry is corrected at the end of the file).

### Deliberately left out

- **Ranking or auto-selecting by ping.** §7. The number is reported; the user picks.
- **Cost, tier or quota detection.** §7. Forge cannot see a price list; "free vs
  paid" is only ever inferred here from *did it answer*.
- **Probing `api.anthropic.com` with no profile active.** §7. No relay, nothing to sweep.
- **Streaming health.** §7. One non-streaming 4-token completion is the check.
- **A sweep on every activation.** §3. Only when the last one is older than the
  interval, because every probe is a billable completion.

## Decisions §3 asked to be made out loud

**Buttons in state C.** All three (*Set up an endpoint*, *Check health*, *Skip
to chat*), confirmed with the user before building, against the two readings in
the prompt.

**What happens when the user skips and then types.** The composer stays live and
the send goes through the normal path. A stored verdict can be wrong, and a
model marked dead may well answer; if it does not, the failure surfaces through
the same error path as any other send. The alternative, a disabled composer,
blocks someone whose verdict is simply out of date, which is the failure mode
this feature was supposed to remove, not add.

**How long the skip persists.** Per workspace (webview storage), and it **lapses
automatically** when a later sweep finds a healthy model or the profiles go
away. So it silences a verdict the user already overruled without silencing a
real one that arrives later. `welcomeRequested` (palette → *show welcome*) still
opens the page deliberately at any time.

**Health is per (profile, model).** Keyed on profile name, with a fingerprint of
`{baseUrl, wire, model, chatPath}`. Editing a profile to point at a different
gateway discards its verdicts rather than inheriting them.

**`servedModelCache` vs the store.** The cache holds the *listing* for one relay
lifetime; the store holds the *verdicts* and outlives every relay. They cannot
disagree because neither overrules the other: membership comes from the live
listing (a model the gateway stopped listing is gone whatever a stale healthy
verdict says), exclusion comes from the store, and the filter is re-applied on
every call rather than baked into the cached value.

**Why the filter is not *inside* `servedModels` alone.** It is in both places,
through one function, `keepHealthy` in `healthStore.ts`. The two callers ask
different questions and get different answers, deliberately:

- a **gateway listing** keeps only what answered, because an unprobed id from
  beyond the candidate cap is not evidence;
- a **declared `models` block** loses only ids that were probed *and failed*,
  because a declaration is the user naming what they want and absence of
  evidence must not overrule them.

Neither ever empties a list because health is *unknown*.

**A module split that was forced.** `endpointService` must read verdicts and the
health service must read profiles and secrets. Importing both ways closes a
cycle, and a cycle through a file holding a DI decorator fails as
`decorator is not a function` across every endpoint spec, which is exactly what
happened on the first cut. Everything pure now lives in `healthStore.ts`, which
neither side imports *from*; `health.ts` re-exports it so callers see one module.

## Definition of done (B8)

| Gate | Result |
| --- | --- |
| `pnpm test` | **1727 passed**, 8 skipped, 64 files |
| `pnpm run typecheck:all` | clean (host + webview) |
| `pnpm run build` | clean |
| `pnpm run lint:forge` | brand clean (390 files), tokens clean, commands clean |
| Harness | **22/22 checks**; `drive-health.mjs` (see the correction below) |
| `probe-oracle.js` | see below |

### probe-oracle

Measured on this tree, `.fg-welcome__container` at 900x1000:

| What was measured | Result |
| --- | --- |
| The page as it ships (`?endpoints=2&health=none`) | 37 checked, 6 clean, **19 structural rows**, 7 colour |
| Forge-only elements removed from the DOM | 12 checked, 8 clean, **3 structural rows** |
| Control: `.fg-shell__header` | **15/15 clean, 0 structural** |

Of the 19, **14** are Forge-only elements: the report table with its
`thead`/`tbody`/`tr`/`th`/`td`/`span`/`code`, the `forge-welcome__actions` row
with its buttons, SVGs and paths, and the `$ forge` chip with its sigil. The
official page has no element in any of those positions, so every property of
them reads as a diff by construction.

The other **5** name an official element. `fg-welcome__methodSelection` and
`fg-welcome__terminalNote` differ in `height` only and go clean once the
Forge-only elements are removed. The 3 that survive the control are divergence
#17 in `docs/forge-design.md`: the welcome art is a light/dark pair of `<img>`
with one hidden, the official stylesheet shows both, and the container measures
two images tall on the official side. No ported `fg-welcome__*` rule differs.

This section previously read "35 checked, 17 structural" and "10/10 clean" with
Forge-only elements removed. Neither reproduces on this tree (re-measured
2026-09-23); the figures above are the ones that do.

The earlier figure in this section (6 structural rows, and a note about an
`860px | 845px` artifact on the container) was taken before `welcome` was
registered in `MODULES`. Without that entry the harness serves no
`fg-welcome__* -> *_Eg8KCQ` mapping, the oracle compares the page against
browser defaults, and the numbers mean nothing. The control that proves the
wiring now is the shell header, which measures 15/15 clean exactly as
`docs/forge-design.md` records.

## VS Code checklist (B8.4): **none of these steps has been run**

The agent cannot observe real VS Code or a real gateway. Every step below is
unverified; the specs and the harness cover the logic and the UI, not the wire.

1. **A gateway that lists more than it serves.** Point `forge.endpoints` at an
   aggregating gateway (the NVIDIA account in the docstring, or omniroute on
   `localhost:20128`), select it with `forge.endpointProfile`, reload.
   → **Expect:** Settings → Endpoints shows the profile, status *never checked*,
   Healthy blank.
2. **Sync.** Press **Sync** on that row.
   → **Expect:** `checked / total` counts up to at most 60; then Healthy reads
   `n / m` with `m` the full listing (e.g. `28 / 101`) and a median ping in ms.
   The Forge output channel logs
   `[health] sweeping "<name>": probing 60 of 101 listed id(s)`.
3. **The picker only offers what answered.** Open the model picker in the chat.
   → **Expect:** exactly the `n` models the table calls healthy, each described
   `… · answered in <time>`. No 404ing id appears.
4. **Type to every offered model.** Pick each in turn and send "hi".
   → **Expect:** every one replies. This is B7: the proof is the reply, not the
   table.
5. **A 404 is visible with its reason.** Expand the row in Settings.
   → **Expect:** the failed ids listed with `✗` and their `detail`; at least one
   reading `listed, but accepted the request and never answered` if the gateway
   has a hanging id.
6. **Kill the gateway and re-sync.** Stop it, press **Sync all**.
   → **Expect:** Healthy `0 / …`, status *unreachable*, the loud panel naming
   the commonest failure; the model picker empties; a new conversation shows the
   welcome page with **Set up an endpoint**, **Check health** and **Skip to
   chat**. Press **Skip to chat** → the composer appears. Send a message →
   it fails with a real error rather than silently.
7. **Bring it back.** Start the gateway, press **Check health** on the welcome
   page.
   → **Expect:** the page disappears on its own as soon as a model answers, with
   no reload, and the skip flag clears.
8. **The interval.** Set `forge.endpointHealth.syncIntervalMinutes` to `0`.
   → **Expect:** the Forge output channel logs `[health] periodic sweeps are off
   (syncIntervalMinutes: 0)` and no sweep happens until a button is pressed.
   Set it back to `60`, reload within the hour → **expect** no sweep on
   activation (`lastSyncedAt` is recent); reload after the hour → one sweep.
9. **A profile pointed somewhere else.** Edit its `baseUrl` and reload.
   → **Expect:** its verdicts are discarded, status back to *never checked*,
   rather than inherited from the old gateway.
10. **A bad token.** Break `auth.value` and press **Sync**.
    → **Expect:** the row keeps its previous healthy models and shows
    *Last sweep could not run. <message>*; the picker does **not** empty.


---

## Correction, 2026-09-22: the harness figure above was wrong

This report originally recorded **18/18** harness checks. That number could not
have been produced by the script in this repository. Re-running
`drive-health.mjs` against a fresh build found three failures, and all three
were defects in the measuring tools rather than in the UI:

1. **The button list used one selector.** `WELCOME_BUTTONS` queried only
   `.fg-welcome__fullWidthButton`, but the three welcome actions deliberately do
   not share a class: the primary keeps the official one and the two Forge-only
   actions sit on `.forge-welcome__action` so no ported rule is overridden. The
   script therefore reported welcome states B and C as offering a single button,
   when both render the full set.
2. **The icon-position check could not fail correctly.** It used
   `b.firstElementChild`, which skips text nodes, so a button whose icon *trails*
   its label answered "leading". "Skip to chat" was passing for the wrong reason
   and would have kept passing if the icon moved.
3. **The failure path was undrivable.** The stub had no central
   `__forgeRejectRequests` gate and did not record `show_notification`, so the
   check that `runHostAction` reports a rejected sweep had nothing to read and
   returned `undefined`.

All three are fixed. The current figure is **22/22**, measured on the build in
this commit, and it now includes the Settings table (six columns, one row per
endpoint, row expansion showing each model's reason, the commonest failure
named, and the per-row Sync naming its own profile), which the earlier count did
not reach at all.

**Why this matters more than the number.** A harness that cannot fail is worse
than no harness: every one of these checks was reported green while measuring
either nothing or the wrong thing. The verdicts in the table above are only
worth what the tool that produced them is worth, which is why the failures are
written down here rather than quietly fixed.

## Addition, 2026-09-22: a cancelled sweep keeps what it measured

`cancelled()` returned the previous record and persisted nothing, so the ids the
sweep *had* probed before the user pressed Cancel were discarded. Those are
billable completions already spent, and `keepServable`'s own doc returns them
for exactly this reason: "a cancelled sweep that answered for forty ids knows
forty things, and throwing them away would make Cancel cost the user those
completions twice".

They are now merged over the stored record, newest winning per id, while the ids
the sweep never reached keep their existing verdicts, so Cancel still cannot
shrink the model picker. `lastSyncedAt` deliberately stays at the previous
sweep's time: this is not a completed pass, and dating it now would make the
next `syncDue` skip the profile for a whole interval on the strength of a sweep
the user stopped. Covered by *"cancelling keeps the verdicts it had already
measured, too"*.
