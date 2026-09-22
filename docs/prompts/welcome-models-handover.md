# Handover: the welcome page that never appears, the picker stuck on "Loading
# models…", and the hand-off nobody has seen work

You are picking up Forge (VS Code extension cloning the real Claude Code
extension's UI). Read `CLAUDE.md` first — its rules are not optional, in
particular **rule 1** (if the code exists, read it, never guess), **rule 5**
(a repeated correction means stop and change approach) and **B8** (definition
of done).

Repo state you are inheriting:

- worktree `C:\Users\med-a\Music\Forge\.claude\worktrees\backend-wiring-06-08-34ffbb`
- branch `claude/forge-menu-endpoints-bugs-4b9011`, HEAD `6f5a05b`
  ("Step 50: the welcome gate follows the model list, and the history hands off")
- `pnpm test` 1404 passing, `typecheck:all` and `lint:forge` clean
- `forge-0.1.0.vsix` built at 11:16 from `6f5a05b`

**Do this before anything else.** The three bug reports below came from
screenshots taken at 09:54, from a VSIX built *before* `6f5a05b`. Reinstall the
11:16 VSIX, reload the window, and re-check all three. Symptom 3 in particular
may already be fixed and unverified. Do not debug a build you have not
confirmed is running — this project has already lost a full cycle to exactly
that mistake, and there is a memory note about it. Report which of the three
survive the reinstall before you write a line of code.

---

## Symptom 1 and 2 are the same bug. Treat them as one.

Reported separately, but they cannot occur independently:

> "the initial welcome page didn't appear"
> "the model selection appears loading when a mounted model already exists"

Screenshot evidence: the composer is up, the model picker reads
"Loading models…", and a Forge notification says
`"auto/coding:free" answered in 2741ms. Set it as "model" in forge.endpoints.omni-routing.`
So a reachable endpoint exists and answers in under 3 seconds, and the UI still
shows neither models nor the welcome gate.

### The chain, verified by reading

| # | Where | What it does |
| --- | --- | --- |
| 1 | `src/webview/src/transport/BaseTransport.ts:143` | `await sendRequest({type:"get_claude_state"})`, then `this.claudeConfig(claudeState.config)` and `this.state("connected")` |
| 2 | `src/webview/src/core/Session.ts:193` | `claudeConfig` = `connection.claudeConfig()` |
| 3 | `src/webview/src/components/ModelSelect.vue:61` | `v-if="models === undefined"` → renders **"Loading models…"** |
| 4 | `src/webview/src/pages/ChatPage.vue:545` | `modelCount = claudeConfig?.models?.length` |
| 5 | `src/webview/src/pages/ChatPage.vue:548` | `showEndpointWelcome = modelCount === 0` |

If `claudeConfig` is `undefined`, step 3 shows "Loading models…" **and** step 4
yields `undefined`, which is `!== 0`, so step 5 is false and the welcome page
never mounts. One undefined value produces both symptoms exactly as reported.

`undefined` is deliberately not treated as zero (so the page does not flash on
every launch) — that decision is sound, keep it. The bug is upstream: the value
never arrives.

### Leading hypothesis — confirm it, do not assume it

`handleGetClaudeState` in `src/services/claude/handlers/handlers.ts:214` picks
one of two paths:

```ts
const rows = await endpointModelRows(context);
const config = rows
    ? await loadConfigBounded(context, CONFIG_PROBE_BUDGET_MS)  // 8s ceiling
    : await loadConfig(context);                                // NO ceiling
```

`endpointModelRows` (line 191) returns `undefined` when
`context.endpointService.getStatus().profile` is falsy. So **whenever no
profile is active, the unbounded `loadConfig` runs** — and if the CLI never
completes its initialize against this gateway, that promise never settles,
`get_claude_state` never answers, `claudeConfig` stays `undefined` forever, and
`state` never reaches `"connected"`. That matches the screenshot exactly.

The notification text is the tell: it asks the user to *set* `model` in
`forge.endpoints.omni-routing`, which suggests the profile is incomplete and
may not be counted as active by `getStatus()` at the moment the handler runs.

**Confirm which of these is true before fixing** — instrument, do not guess:

1. Does `get_claude_state` ever return? Log entry/exit around
   `handleGetClaudeState` with timestamps, in the Forge output channel.
2. Is `getStatus().profile` truthy at that moment? Log it.
3. If a profile *is* active: does `servedModels()` resolve, and how long does
   `loadConfigBounded` actually take? The 8s ceiling should cap it — verify it
   fires, and that the `[endpoints] the CLI config probe did not answer` warning
   appears.
4. Is there a race? `endpointService` may not have loaded profiles yet when the
   webview handshake runs. Check activation order.

Attach the log lines to your report. Rule 6: no claim of a cause without a
measurement.

### What the fix must satisfy

- **`get_claude_state` must always answer, on every path.** An unbounded wait
  inside a handshake the whole webview blocks on is the defect, independent of
  which gateway is configured. The bounded path already exists and is already
  justified in its own doc comment — extend that reasoning to the no-profile
  path rather than inventing a second mechanism.
- **A reachable endpoint with models must populate the picker.** The toast
  proves the gateway answers in ~2.7s, so "slow gateway" is not the excuse here.
- **A genuinely empty model list must reach the webview as `0`, not
  `undefined`**, or the welcome page can never appear. This is the bit that is
  actually broken for the user's headline complaint.
- **Do not make `undefined` mean zero in `ChatPage.vue`.** That would put the
  welcome page up on every cold start before the config lands, which is the
  flash the current code exists to avoid. Fix the producer.
- If you add a timeout, decide and state what the user sees when it fires: an
  empty picker plus the welcome page is a defensible answer; a permanent
  "Loading models…" is not.

---

## Symptom 3: "no smooth transition after clicking new conversation"

Already implemented at `6f5a05b`, **never seen working in real VS Code.**

What exists: the sessions view is its own activity-bar container, so
"New conversation" reveals the chat in the secondary side bar and the host then
closes the primary one. `handleRevealChat`
(`src/services/claude/handlers/handlers.ts:1232`) runs
`forge.newConversation`, waits `SIDEBAR_HANDOFF_MS` (190ms), then
`workbench.action.closeSidebar` — guarded by `chatLivesInSecondarySideBar()` so
it never closes the panel the chat is in. The leaving panel animates itself via
`.app-wrapper.forge-handoff` in
`src/webview/src/styles/forge-design.css`: opacity linear to 0, transform
`translate3d(10px,0,0) scale(0.994)` on `cubic-bezier(0.32,0.72,0,1)`, with a
`prefers-reduced-motion` opt-out. Measured in a browser harness:

```
 50ms  opacity=0.65  x=8.9px
 95ms  opacity=0.39  x=9.8px
145ms  opacity=0.12  x=10.0px
190ms  opacity=0     x=10.0px   ← panel closes here
```

Rationale is in `docs/forge-design.md` under "2026-09-21: the side-bar
hand-off"; specs are in `test/openConfigHelp.spec.ts`.

### What you must check

1. **Reinstall first** (see the top). The screenshots predate this code.
2. **Which surface did the user click?** The hand-off only runs on the
   `reveal_chat` path, which fires from the standalone sessions view:
   `SessionsPage.vue:28` (`+`, `createNewSession`) and the "Start a new one"
   link (`startNewChat`) → `App.vue` `handleSwitchToChat` → `isSessionsView` →
   `transport.revealChat()`. One screenshot shows a tooltip for the
   **`Forge: New Conversation` (Ctrl+N)** command. If the user triggers
   `forge.newConversation` from the palette, a title-bar button or the
   keybinding, `handleRevealChat` is never involved — no animation, no close.
   **Establish which one they actually pressed before changing anything.** If
   it is the command, the hand-off needs to move to where both paths meet.
3. If the hand-off does run but reads wrong, the numbers above are measurements
   from a synthetic harness, not from VS Code. Re-measure in the real webview
   before re-tuning; do not adjust curves by feel and call it done.

---

## Ground rules for this work

- **`pnpm run package` takes ~8 minutes.** Batch your changes; do not rebuild
  per edit. Use the `ui-parity` harness for webview-only checks.
- **B8 applies:** a vitest spec per handler change including rejection cases,
  then `pnpm test`, `pnpm run typecheck:all`, `pnpm run build` all green.
- **B9:** report as a table — row | request | host result | UI effect | verdict
  — with counts, and say plainly which steps you could not verify against real
  VS Code. The agent cannot observe VS Code; hand the user a numbered checklist
  with exact expected results instead of claiming behaviour you have not seen.
- Colour goes through `src/webview/src/styles/forge-tokens.css` only; creative
  divergences from the official UI go in `forge-design.css` and get an entry in
  `docs/forge-design.md`.

## Definition of done for this handover

1. Reinstall confirmed, and you have stated which of the three symptoms
   survived it.
2. Logs attached showing why `claudeConfig` was `undefined`.
3. With a working endpoint: picker lists its models, no "Loading models…".
4. With no endpoint or an endpoint serving nothing: the welcome page appears.
5. Neither state flashes the welcome page during a normal cold start.
6. The hand-off verified in real VS Code, or explicitly reported as unverified
   with the reason.
