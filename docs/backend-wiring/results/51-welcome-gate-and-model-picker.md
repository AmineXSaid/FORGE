# Step 51 — the welcome gate, the stuck model picker, and the unseen hand-off

Three symptoms were reported from a real install:

1. the initial welcome page didn't appear;
2. the model selection sits on "Loading models…" when a mounted model exists;
3. no smooth transition after clicking new conversation.

One of them was never in the build being tested. The other two are the same
bug, and it had three causes rather than the one the handover identified.

## First: which build was actually running

The handover said a VSIX was built at 11:16 from `6f5a05b` and asked for a
reinstall before anything else. It had not happened. Content-grepping the
installed extension against the source settled it — function names are mangled
by the minifier, so only string literals that survive it are evidence:

| Literal | Source | Installed `msaid.forge-0.1.0` | Fresh 11:16 build |
| --- | --- | --- | --- |
| `workbench.action.closeSidebar` | `handlers.ts:1255` | **0** | 1 |
| `forge-handoff` (`main.js`) | `App.vue:4` | **0** | 1 |
| `forge-handoff` (`style.css`) | `forge-design.css:422` | **0** | 7 |
| `forge.welcome` | `forgeCommands.ts:136` | 4 | 4 |
| `show_welcome` | `ChatPage.vue` | 1 | 1 |
| `reveal_chat` | step 49 | 3 | 3 |
| `the CLI config probe did not answer` | `handlers.ts` | 1 | 1 |

The installed `dist/extension.cjs` is dated **11:14:56**; the packaged VSIX is
**11:16:43**. So the installed build is an earlier compile that has step 50's
welcome gate but **not** its side-bar hand-off.

**Symptom 3 was therefore untestable, not broken.** The code it describes was
absent from the binary under test. Symptoms 1 and 2 are real: every line
involved in them *was* installed.

## Symptoms 1 and 2 are one value

`BaseTransport.initialize` blocks the entire handshake on one request:

```ts
const claudeState = await this.sendRequest({ type: "get_claude_state" });
this.claudeConfig(claudeState.config);   // never runs if the await doesn't return
this.state("connected");                 // nor this
```

`claudeConfig` left `undefined` is read by two surfaces, and neither can tell
"not known yet" from "nothing there":

| Surface | Code | `undefined` renders as |
| --- | --- | --- |
| Model picker | `ModelSelect.vue:61` — `v-if="models === undefined"` | "Loading models…", permanently |
| Welcome gate | `ChatPage.vue:548` — `modelCount === 0`, and `undefined !== 0` | nothing at all |

One unanswered request, both reports. `undefined` is deliberately not treated
as zero so the page cannot flash during a cold start; that decision is sound
and was left alone. The producer was fixed instead.

## Three ways it failed to answer, not one

The handover named the second. Reading the path found three.

| # | Where | Why it never answers |
| --- | --- | --- |
| 1 | `endpointModelRows` → `servedModels` → `listModels` | A network GET to the gateway with **15s** header/body timeouts of its own, awaited **outside** every budget. The bounded load below could not start for that long. |
| 2 | `loadConfig` on the no-profile path | `await query.initializationResult()` with no ceiling at all. A CLI that never completes initialize hangs this forever. |
| 3 | Either of the above rejecting | Nothing caught it. The handler rejected → the dispatcher sent `{type:"error"}` → `sendRequest` rejected → `initialize()` rejected. Nothing re-runs it, so the UI stayed dead until reload. |

Cause 1 is the one that fits the report: the screenshot's toast asks the user to
set `model` in `forge.endpoints.omni-routing`, i.e. a profile that exists but
declares no `models` block — which is exactly the branch that calls
`servedModels()`.

## The fix

`handleGetClaudeState` now delegates to `claudeStateConfig`, which cannot hang
and cannot throw:

- every wait goes through one `bounded()` helper — timeout **and** rejection
  both fall back, and the rejection handler is attached before the race so a
  probe given up on cannot raise an unhandled rejection in the host;
- the gateway listing gets its own budget (`MODEL_LIST_BUDGET_MS`, 6s), well
  inside `listModels`' own 15s;
- the CLI probe keeps `CONFIG_PROBE_BUDGET_MS` (8s) when a profile supplies the
  rows, and gets a longer `CLI_CONFIG_BUDGET_MS` (15s) when it does not —
  without a profile the CLI's table *is* the model list, and giving up early
  shows the welcome page to someone whose CLI was merely slow;
- `config.models` is forced to an array last thing, because `[]` and
  `undefined` are the two states the picker distinguishes and this is the final
  place to get it right;
- `loadConfigBounded` was re-expressed over `bounded` so the rule lives once.
  Its own copy of the race was why the handshake could be "bounded" while still
  having two unbounded waits either side of it.

### Giving up is no longer wasteful

Bounding alone would have traded a hang for a wrong answer: a slow-but-healthy
CLI would show the welcome page, and that page is a *gate* — `showEndpointWelcome`
is a computed on the model count, so dismissing it does not help. That would be
a new bug, not a fix.

So the probe is not cancelled when the budget runs out. `configProbe` keeps it
and caches its result (`CONFIG_CACHE_TTL_MS`, 30s), keyed on the
`HandlerContext` in a `WeakMap` — one per extension host in production, one per
spec in tests, so nothing bleeds between them. The response carries
`provisional: true` to say the answer was cut short rather than complete, and
the webview's `refreshClaudeState` asks again 4s later (3 attempts). The second
ask is served from cache instantly, so an empty picker becomes the real one
without the user ever having waited on it.

`initialize()` is also now guarded: on failure it sets an empty config and
still reaches `connected`, so the picker says "No models available" and the
welcome page offers to set an endpoint up — instead of both surfaces dying.

## Symptom 3: why there was no transition, and why one path still has none

Two findings.

1. **The hand-off was not in the installed binary.** See the table above.
2. **Ctrl+N and the palette never run it, by design.** `reveal_chat` →
   `handleRevealChat` plays the hand-off; `forge.newConversation`
   (`forgeCommands.ts:302`) does `revealSidebar()` + `ui('new_conversation')`
   and nothing else. The screenshot shows the tooltip for **Forge: New
   Conversation (Ctrl+N)**, so this may be the path that was actually used.

The asymmetry should stay. The hand-off closes the primary side bar, which is
only right when the primary side bar is the Forge history that launched the
chat — the `reveal_chat` case. Invoked from the palette the primary side bar
may be holding Explorer or Source Control, and closing *that* would be a
surprise, not a transition. The hand-off belongs to "I came from the history",
not to "new conversation" in general.

## B9 report

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| Model picker, healthy CLI | `get_claude_state` | CLI table, `provisional` absent | Models listed | **Works** (spec) |
| Model picker, profile active | `get_claude_state` | Profile rows, `unavailable_models` dropped | Gateway's models listed | **Works** (spec) |
| Model picker, CLI never answers | `get_claude_state` | `models: []`, `provisional: true` after 15s | "No models available" + welcome page, then retried | **Works** (spec) |
| Model picker, gateway won't list | `get_claude_state` | Bounded at 6s, falls back | Answers instead of stalling | **Works** (spec) |
| Model picker, CLI throws | `get_claude_state` | Resolves, does not reject | UI reaches `connected` | **Works** (spec) |
| Welcome gate, no models | `get_claude_state` | `models: []` | Welcome page mounts | **Works** (spec) |
| Welcome gate, cold start | `get_claude_state` | `undefined` until answered | No flash | **Unchanged, by design** |
| Slow probe recovery | `get_claude_state` ×2 | 2nd served from cache | Empty picker becomes real | **Works** (spec) |
| Concurrent handshakes | `get_claude_state` ×2 | CLI launched once | — | **Works** (spec) |
| Side-bar hand-off, sessions view | `reveal_chat` | 190ms, then `closeSidebar` | Fade + 10px drift | **Unverified in real VS Code** |
| Side-bar hand-off, Ctrl+N | none | n/a | No transition | **Correct as-is** (see above) |

Counts: 10 new specs, all failing against the old code (6 directly, 3 of those
by hanging — measured by temporarily restoring the unbounded calls). Suite
**1414 passed, 8 skipped, 0 failed** across three consecutive full runs, up from
1404. `typecheck:all`, `lint:brand`, `lint:tokens`, `lint:commands` clean.

Deliberately left out: no new request type — `provisional` is a field on an
existing response, so the retry needed no protocol. The hand-off was not moved
onto `forge.newConversation`, for the reason above.

## Checklist for VS Code (B8.4 — none of this was observed by the agent)

The agent cannot see VS Code. Every step below is unverified.

1. **Install the new build.** From this worktree:
   `code --install-extension forge-0.1.0.vsix --force`, then
   **Developer: Reload Window**. This is the step that was missed last cycle.
2. **Confirm the build is the new one.** In the Forge output channel you should
   now see a line `[handleGetClaudeState] answered in <N>ms with <M> model
   row(s)` on every panel open. If that line is absent, the old build is still
   loaded — stop and reinstall.
3. **With omniroute running** (`omniroute` in a terminal) and the profile
   active: open Forge. Expected — the picker lists the gateway's models, never
   "Loading models…". The log line from step 2 should report `M` > 0 and a time
   under ~3s.
4. **With omniroute stopped**, reload the window. Expected — the handshake still
   answers (step 2's line appears, `M = 0`, time ≈ 6s not ∞), the picker says
   "No models available", and the **welcome page appears**. A warning
   `[endpoints] the gateway's model listing did not answer in 6000ms` should be
   in the log.
5. **Restart omniroute while that welcome page is up**, and wait ~5s. Expected —
   the picker fills in on its own from `refreshClaudeState`, without a reload.
6. **Cold start with a normal Anthropic CLI** (no endpoint profile): the welcome
   page must **not** flash before the models land.
7. **Hand-off, the path that has one:** open **Forge: Past Conversations** in
   the primary side bar, click **+** or **Start a new one**. Expected — the
   history fades and drifts ~10px right over ~190ms, then closes, and the chat
   is up in the secondary side bar. This is the one that could not be tested
   before, because it was not in the installed build.
8. **Hand-off, the path that has none:** press **Ctrl+N**. Expected — the chat
   opens with no animation and the primary side bar is left alone. That is
   correct behaviour, not a regression.
