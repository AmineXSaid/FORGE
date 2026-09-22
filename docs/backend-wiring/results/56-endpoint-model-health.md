# Endpoint & model health

**What changed in one line:** the model picker now offers models that *answered
a real request*, not models a gateway *listed*. When none of them do, the
welcome page says so instead of reporting "101 models".

## What this branch did not have

This step was specified against the endpoints line, and `claude/endpoint-model-health-ebc111`
is master plus steps 21-23. Every file the prompt's §0 names as "already on
disk, read it before writing a line" was absent here except `profile.ts`,
`endpointService.ts` (four methods: `listProfiles`, `getEnvironment`,
`getStatus`, `reset`) and `archivedSessions.ts`. There was no `check.ts`, no
`models.ts`, no `servedModels`, no `endpointModelRows`, no Settings ▸ Endpoints
tab, no welcome gate, no `runHostAction`, and `src/shared/messages.ts` contained
zero occurrences of "endpoint".

So this commit is the prerequisites **and** step 56. The prerequisites were
written against this branch's own APIs where its schema differs (its
`Capabilities` has no `effort` / `effortLevels` / `fastMode`, so the picker rows
report those `false` rather than intersecting claims that cannot be made here).
The welcome page is not adapted: the official `Eg8KCQ` port, its stylesheet and
its art were taken across whole from `claude/endpoint-model-health-fc28aa`, at
the user's instruction that this branch carry every detail.

## The defect

`probeOne` can tell the difference: one `max_tokens: 4` completion per id, with
a timeout reported distinctly as *"listed, but accepted the request and never
answered"*. The measurement it carries: of 101 ids one NVIDIA account listed,
**28 answered, 60 returned 404, 10 hung and 3 errored**.

Three things would have stopped that reaching the user, and all three are now
closed:

1. `servedModels` would hand the raw listing straight to the picker. It now runs
   the candidates through `keepHealthy` before returning them.
2. Probe results were not kept, so nothing could be shown, filtered on or
   refreshed. They now live in `globalState` under `forge.endpointHealth`.
3. The gate would count listed models. It now counts models that answered.

## B1: no official counterpart

The official extension has no endpoint concept: `extension.js` has no
`case"get_endpoint_health"`, no sweep, no model-servability notion at all. There
is nothing to copy, so B1 does not apply to the two new requests. They follow
the shape of Forge's own endpoint surfaces instead, where the webview names a
profile from a set the host already knows, never a URL, a header or a command.

## B9: row by row

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| Settings ▸ Endpoints ▸ **Sync all** | `sync_endpoint_health {}` | `syncAll()`: list, probe, store, per profile | table fills in; the button becomes **Cancel** | works (specs + harness) |
| Settings ▸ Endpoints ▸ row **Sync** | `sync_endpoint_health {profileName}` | `syncProfile(name)` after validating the name | that row only; `checked / total` counts up | works (specs + harness) |
| Settings ▸ Endpoints ▸ **Cancel** | `sync_endpoint_health {profileName, cancel:true}` | `cancelSync` aborts the in-flight probe | progress stops; prior verdicts kept | works (spec: a cancelled sweep keeps what it learned) |
| Settings ▸ Endpoints ▸ row disclosure | none (local) | none | per-model table: id, ✓/✗, ping, `detail` | works (harness) |
| Settings ▸ Endpoints, on open | `get_endpoint_health {}` | pure read of `globalState` | one row per profile: status, `n / m`, median ping, relative time | works (harness) |
| Welcome ▸ **Check health** | `sync_endpoint_health {}` | `syncAll()` | the gate lifts itself from the push alone | works (harness) |
| Welcome ▸ **Skip to chat** | none (webview state) | none | gate closes, composer appears, skip remembered | works (harness: `forge.endpointWelcomeSkipped`) |
| Welcome ▸ **Set up an endpoint** | `open_config_file {configType:"endpoints"}` | creates the profiles dir, opens an untitled YAML template | the template opens in an editor | **unverified against real VS Code** (checklist 1) |
| Welcome table | `get_endpoint_health {}` | pure read | endpoint, status dot, `0 of 5` in danger colour | works (harness) |
| Welcome ▸ terminal line | `open_claude_in_terminal` | existing handler | a terminal opens | pre-existing, unchanged |
| Empty state ▸ setup card | `open_config_file {configType:"endpoints"}` | as above | card appears only while no profile exists | works (spec on `nextWelcomeCard`) |
| Model picker | `get_claude_state` | `endpointModelRows` filters through the verdicts | only models that answered; each annotated `answered in 2.3s` | works (specs); **unverified against a real gateway** |
| Host push | `endpoint_health_update` | `onDidChangeHealth` → `notifyClient`, coalesced 400ms | a sweep in Settings updates the welcome page | works (harness) |
| Timer | none | `syncDue()` on activation and on endpoint config change | none directly | **unverified against real VS Code** (checklist 7) |

**Counts:** 2 new requests + 1 new push, six places each (B2); 3 new settings
registered in `package.json`; 1 new Settings tab; 43 new specs in
`test/endpointHealth.spec.ts`.

### Deliberately left out

- **Ranking or auto-selecting by ping.** §7. The number is reported; the user picks.
- **Cost, tier or quota detection.** §7. Forge cannot see a price list; "free vs
  paid" is only ever inferred here from *did it answer*.
- **Probing `api.anthropic.com` with no profile active.** §7. No relay, nothing
  to sweep, and the CLI's own model list is correct in that case.
- **Streaming health.** §7. One non-streaming 4-token completion is the check.
- **A sweep on every activation.** §3. Only when the last one is older than the
  interval, because every probe is a billable completion.
- **A guided "add endpoint" flow.** Not in this branch and not in scope. The
  button opens a filled-in profile template for the folder the loader reads,
  which is a thing that works rather than a row wired to nothing (B4).

## Decisions §3 asked to be made out loud

**Buttons in state C.** All three: *Set up an endpoint*, *Check health*,
*Skip to chat*.

**What happens when the user skips and then types.** The composer stays live and
the send goes through the normal path. A stored verdict can be wrong, and a
model marked dead may well answer; if it does not, the failure surfaces through
the same error path as any other send. A disabled composer would block someone
whose verdict is merely out of date, which is the failure mode this feature was
meant to remove, not add.

**How long the skip persists.** Per workspace (`localStorage`, following
`firstRun.ts`), and it **lapses automatically** when a later sweep finds a
healthy model or the profiles go away (`skipStillApplies`). So it silences a
verdict the user already overruled without silencing a real one that arrives
later.

**Health is per (profile, model).** Keyed on profile name, with a fingerprint of
`{baseUrl, wire, model, chatPath}`. Editing a profile to point at a different
gateway discards its verdicts rather than inheriting them. Editing its
description or timeout does not, because neither changes what is served.

**`servedModelCache` vs the store.** The cache holds the *listing* for one relay
lifetime; the store holds the *verdicts* and outlives every relay. They cannot
disagree because neither overrules the other: membership comes from the live
listing (a model the gateway stopped listing is gone whatever a stale healthy
verdict says), exclusion comes from the store, and the filter is re-applied on
every call rather than baked into the cached value.

**One filter, two answers.** `keepHealthy` in `healthStore.ts` is the only place
that applies verdicts, and it answers its two callers differently on purpose:

- a **gateway listing** keeps only what answered, because an unprobed id from
  beyond the candidate cap is not evidence;
- a **declared `models` block** loses only ids that were probed *and failed*,
  because a declaration is the user naming what they want and absence of
  evidence must not overrule them.

Neither ever empties a list because health is *unknown*.

**The module split.** `endpointService` must read verdicts and the health
service must read profiles. Everything pure lives in `healthStore.ts`, which
neither side imports *from*; `health.ts` re-exports it so callers see one
module, and `servedModels` takes the record as an argument rather than reaching
for the service. A cycle through a file holding a `createDecorator` call fails
at import time as `decorator is not a function`.

**`ClaudeAgentService` gained two constructor dependencies.** Seven existing
specs construct it positionally and broke. They were updated to pass a health
stub rather than making the subscription defensive, because a guard there would
hide a real DI failure in production.

## Definition of done (B8)

| Gate | Result |
| --- | --- |
| `pnpm test` | **619 passed**, 26 files (43 of them new) |
| `pnpm run typecheck:all` | clean (host + webview) |
| `pnpm run lint:forge` | brand clean, tokens clean, commands clean |
| `pnpm run build` | clean |
| Harness | **22/22 checks**, `drive-health.mjs` |
| `probe-oracle.js` | **0 structural rows on every official element** (see below) |

### Harness (B8.3)

`node .claude/skills/ui-parity/harness/drive-health.mjs --port <p>` drives the
real built webview against the stub host. All 22 pass: the three welcome states
and their button sets, the report table's headings and `n of m` counts, the
danger colour on a zero with its status dot, both action icons in the right
position, the gate lifting itself from the push alone, "Skip to chat" revealing
the composer and persisting, a rejected sweep raising a notification through
`runHostAction`, the Settings table's six columns and one row per endpoint,
expanding a row to show each model's reason including the never-answered
wording, the commonest failure named, and the per-row Sync naming its own
profile.

Three of those checks failed on the first run and the failures were in the
tooling, not the UI:

- the drive script queried `.fg-welcome__fullWidthButton` for all three
  actions, but only the primary carries that class by design (divergence #8),
  so it reported every state as offering one button;
- its "is the icon leading?" test used `firstElementChild`, which skips text
  nodes and therefore answered "leading" for a trailing icon;
- the stub had no central `__forgeRejectRequests` gate and no
  `show_notification` recorder, so the failure path could not be driven at all.

All three are fixed in the harness. Worth saying plainly: the same drive script
exists on `claude/endpoint-model-health-fc28aa`, where its report claims 18/18.
Those three checks cannot have passed there either.

### probe-oracle (`.fg-welcome__container`, 900x1000)

| What was measured | Result |
| --- | --- |
| Every **official** element, Forge-only ones removed from the DOM | **10/10 clean, 0 structural rows** |
| The page as it ships | 35 checked, 7 clean, **17 structural rows**, 7 colour |

Every one of the 17 is a Forge-only element: the report table and its cells, the
two `forge-welcome__action` buttons with their SVGs, and the `$ forge` chip.
The official page has no element in those positions. Three further rows name an
official element and differ in `height` only, which is those additions taking up
space; removing them returns all three to clean, which is the control.

**`welcome` was missing from `MODULES` in `scripts/port-official-css.mjs`.**
Without it the harness serves no `fg-welcome__* -> *_Eg8KCQ` mapping, so the
oracle compares the page against browser defaults and reports 23 structural rows
with *nothing* clean. That number is meaningless and the first measurement here
produced it. The module is now registered (hash `Eg8KCQ`), and the control that
proves the wiring is the shell header, which measures 15/15 clean exactly as
`docs/forge-design.md` records.

## VS Code checklist (B8.4): **none of these steps has been run**

The agent cannot observe real VS Code or a real gateway. Every step below is
unverified; the specs and the harness cover the logic and the UI, not the wire.

1. **Set up an endpoint.** With no profile configured, open a new conversation.
   → **Expect:** the welcome page with **Set up an endpoint** only. Press it.
   An untitled YAML template opens naming `~/.forge/endpoints`, and that folder
   now exists. Save it there as `nvidia.yaml`, filling in a real `baseUrl` and
   `${env:...}` token, and set `forge.endpointProfile` to its `name`. Reload.
2. **A gateway that lists more than it serves.** Open Settings ▸ Endpoints.
   → **Expect:** the profile listed, status *never checked*, Healthy blank.
3. **Sync.** Press **Sync** on that row.
   → **Expect:** `checked / total` counts up to at most 60; then Healthy reads
   `n / m` with `m` the full listing (e.g. `28 / 101`) and a median ping in ms.
   The Forge output channel logs
   `[health] sweeping "<name>": probing 60 of 101 listed id(s)`.
4. **The picker only offers what answered.** Open the model picker in the chat.
   → **Expect:** exactly the `n` models the table calls healthy, each described
   `… · answered in <time>`. No 404ing id appears.
5. **Type to every offered model.** Pick each in turn and send "hi".
   → **Expect:** every one replies. This is B7: the proof is the reply, not the
   table.
6. **A 404 is visible with its reason.** Expand the row in Settings.
   → **Expect:** the failed ids listed with `✗` and their `detail`; at least one
   reading `listed, but accepted the request and never answered` if the gateway
   has a hanging id.
7. **Kill the gateway and re-sync.** Stop it, press **Sync all**.
   → **Expect:** Healthy `0 / …`, status *unreachable*, the loud row naming the
   commonest failure; the model picker empties; a new conversation shows the
   welcome page with all three buttons. Press **Skip to chat** → the composer
   appears. Send a message → it fails with a real error rather than silently.
8. **Bring it back.** Start the gateway, press **Check health** on the welcome
   page.
   → **Expect:** the page disappears on its own as soon as a model answers, with
   no reload, and the skip flag clears.
9. **The interval.** Set `forge.endpointHealth.syncIntervalMinutes` to `0`,
   reload.
   → **Expect:** the output channel logs `[health] periodic sweeps are off
   (syncIntervalMinutes: 0)` and no sweep happens until a button is pressed.
   Set it back to `60`, reload within the hour → **expect** no sweep on
   activation (`lastSyncedAt` is recent); reload after the hour → one sweep.
10. **A profile pointed somewhere else.** Edit its `baseUrl` and reload.
    → **Expect:** its verdicts are discarded, status back to *never checked*,
    rather than inherited from the old gateway.
11. **A bad token.** Break `auth.value` and press **Sync**.
    → **Expect:** the row keeps its previous healthy models and shows
    *Last sweep could not run. <message>*; the picker does **not** empty.
