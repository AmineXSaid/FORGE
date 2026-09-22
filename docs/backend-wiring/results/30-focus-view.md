# Step 30 results: Focus view

## Results

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| "/" → Focus view (on) | `{type:"set_focus_view", enabled:true}` | `set_focus_view_response`; `focusView:true` written to the extension config, `applyFlagSettings({viewMode:"focus"})` sent to every open channel, `extension_config_changed` broadcast back | the toggle turns on, **the menu stays open** (`keepMenuOpen`), and the transcript collapses to prompts, replies and one fold row per hidden run | works |
| "/" → Focus view (off) | `{type:"set_focus_view", enabled:false}` | same, with `applyFlagSettings({viewMode:null})` | the toggle turns off, the menu stays open, the full transcript comes back | works |
| fold row (click / Enter / Space) | — (webview state) | — | expands in place: the folded messages appear, with a "Collapse" row under them | works |
| "Collapse" row | — | — | collapses back to the summary | works |
| repeat toggle with the same value | `{type:"set_focus_view", enabled:true}` twice | the second one persists and broadcasts but sends **no** `applyFlagSettings` (`lastAppliedFocusView`) | none | works |
| a non-boolean `enabled` | `{type:"set_focus_view", enabled:"true"}` | `set_focus_view: enabled must be a boolean`, thrown before anything is written | none | works |

**Counts:** works 6 · partial 0 · broken 0 · left out 0

Measured in the harness with a seeded run (a thinking block, `Read`, a failing
`Bash`, then a reply): the fold read **"2 tool calls · 1 failed"** with the
failure dot, and expanding it showed the three hidden messages plus the
`aria-label="Collapse 2 tool calls · 1 failed"` end row.

### Not reproduced in the harness

The **live** fold state (`Running Bash…`, `Waiting for permission…`,
`Waiting for your answer…`, the pulsing label and the progress dot) needs a
session that is still working. The mock host answers every composer send with
`result: success` immediately, so `busy` is already false by the time a
transcript can be seeded — there is no way to hold the harness in that state.
Those paths are covered by `test/focusView.spec.ts` instead, and are marked
unverified against the real CLI in the checklist below.

## Gates

- `pnpm test`: `Test Files 31 passed (31) · Tests 791 passed (791)`
- `pnpm run typecheck:all`: clean
- `pnpm run lint:forge`: `brand: clean (355 files)`, `tokens: clean (240 used, 383 defined)`, `commands: clean (20 commands, 13 references)`
- `pnpm run build`: clean

## Oracle

Harness on `127.0.0.1:8791`, stylesheets parsed (`[1, 5, 9879]`).

| Window (root selector) | Structural diffs | Notes |
| --- | --- | --- |
| focus view transcript, `.fg-chat__messagesContainer`, collapsed (35 elements) | **0** | `classesNotInOfficialCss: []`, `missingTwin: 0` |
| fold header row, `[data-testid="focus-fold-row"]` (4) | **0** | |
| collapse row, `[data-testid="focus-fold-end-row"]` (4) | **0** | |
| focus view transcript, expanded (72 elements) | 11 rows | **none of them a `fg-focusfold__*` element** — every one is inside the expanded Bash tool body (`fg-tool__toolBody` and its IN/OUT grid, and the copy button), a pre-existing tool-rendering difference this step does not touch |

The last row is reported rather than rounded away: expanding a fold shows the
ordinary tool blocks, so it inherits whatever those already differ by.

## What was ported

- CSS: `focusfold` (`29QDkQ`, 9 rules), plus the `focusFoldPulse` keyframe —
  which the official references but never defines, exactly like `blink`, so
  `scripts/port-official-css.mjs` supplies it and says so.
- `core/focusView.ts`: the official `DL1` and its helpers, `EK1` / `Cq0` /
  `L25` (the labels and the dot), `ML1` / `jL1` / `wL1` (which folds open
  themselves and how that is reconciled).
- `forge/FocusFoldRow.vue`: `gq0` and `mq0`.
- `ChatPage.vue`: the second render path. Focus view off runs the same code as
  before, unchanged — the folded list is built and rendered only when it is on.
- Host: `ClaudeAgentService.setFocusView` + `syncFocusViewToChannels`, the
  `focusView` key in `ExtensionConfig`, and `focusViewEnabled` on the init state.

### Deliberately not ported, with the reason

The official `DL1` threads four things through the same algorithm that Forge's
transcript model has no field for. Inventing them would be guessing (backend
parity rule 3), so they are left out and named here:

| Official | Why not |
| --- | --- |
| subagent spans (`uj0`, `PL1`, `Xv`) and the subagent rows (`IK1`, module `mpBgEA`) | `Message` has no `parentToolUseId` / `sdkParentToolUseId`, and Forge has no `subagentTasks` feed |
| synthetic messages (`isSynthetic`) and origin-based user filtering (`FL1`, `AL1`) | `Message` carries neither `isSynthetic` nor `origin`; the user-side test is `!isEmpty`, which is already the official `_Z.isEmpty` |
| teleported messages (`teleportedMessageCount`) and the branch banner | no such concept in Forge |
| `thinkingMillis` → "Thought for 4s" | `ContentBlock` never passes `durationMillis` to `ThinkingBlock`, so the field stays null and the label reads "Thinking" |
| `redacted_thinking` blocks | not a member of Forge's `ContentBlock` union |

Everything else is the official's: the run grouping, the retried-attempt test via
`betaMessageId`, live / provisionallySettled / settled, the counts, the pending
tool name, the TodoWrite lift-out and the fold key.

## Specs added

`test/focusView.spec.ts` (33 cases):

- **the host**: persists `focusView`, pushes `{viewMode:"focus"}` to every
  channel and `{viewMode:null}` when switched off, does not re-push a value the
  channels already have, broadcasts `extension_config_changed`, refuses any
  non-boolean **before** writing, and survives a channel whose push throws;
- **the filter**: which messages survive (prompt, reply, meta) and which fold
  (tool-only turn, thinking-only turn, tool-result row, blank-text turn);
- **the folds**: counting tool calls and failures, skipping hidden tools, the
  thinking-only label, the live label and pending tool name, `AskUserQuestion`'s
  own wording, a new fold after each visible reply, distinct fold keys, the
  TodoWrite lift-out, and the three dangling-call cases (superseded attempt =
  failed and not pending; current attempt while busy = pending; nothing running
  = failed);
- **the expand rules**: a live fold opens once and never again after it settles,
  toggling focus view forgets what was open, a key that stopped auto-opening is
  dropped, and keys for folds that left the transcript are pruned.

## Rows deliberately left out and why

None for this step: the row is registered unconditionally, as the official
registers it.

## VS Code checklist for the user (unverified until the user runs it)

1. "/" → **Focus view**. **Expected:** the toggle turns on and the menu stays
   open; the transcript immediately shows only your prompts and Forge's replies,
   with a row like "3 tool calls" where the work was.
2. Close and reopen the panel (or reload the window). **Expected:** focus view
   is still on, and `focusView: true` is in Forge's extension config file.
3. With focus view on, ask for something that runs a tool. **Expected:** while
   it runs, the fold row reads "Running `<Tool>`…" in a pulsing label with a
   progress dot and is **open** so you can watch it; when it finishes it
   collapses to the summary. *(This is the state the harness could not hold —
   please check it.)*
4. Trigger a permission prompt with focus view on. **Expected:** the fold
   holding that tool call is forced open, and the row reads
   "Waiting for permission…".
5. Click a fold row, then the "Collapse" row beneath it. **Expected:** it
   expands and collapses.
6. Turn focus view off. **Expected:** the whole transcript returns, and
   `focusView: false` is written.
7. With a session running, check what the CLI itself reports.
   **Expected:** the `viewMode` flag setting is `focus` while the toggle is on
   and cleared when it is off — this is a real CLI setting
   (`'default' | 'verbose' | 'focus'`, `sdk.d.ts` L8167), not only a webview
   filter. *(Unverified — the agent cannot observe the real CLI.)*
