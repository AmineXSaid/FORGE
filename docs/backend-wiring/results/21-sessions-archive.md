# Step 21: Archive / Unarchive — results

**Branch:** `claude/backend-wiring-steps-20-23-0780e0` (on top of step 20)

## What was built

`archive_session` and `unarchive_session` in all six B2 places, the official
`hiddenSessionIds` / `sessionUnarchivedAt` store, the `archived` flag on every
list row, the two row actions, and the "Archived sessions" group header.

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| "Archive session" (`H21`) on a live row | `{type:"archive_session", sessionId:"bbbb…0002"}` | `{type:"archive_session_response"}`; id appended to `hiddenSessionIds` | the row leaves the live list and appears under a new **collapsed** "Archived sessions 1" header; the dropdown stays open | works |
| "Archived sessions" header, click | none | — | expands; chevron rotates 90° (`matrix(0,1,-1,0,0,0)`); title flips `Expand …` → `Collapse …` | works |
| "Unarchive session" (`B21`) on an archived row | `{type:"unarchive_session", sessionId:"bbbb…0002"}` | `{type:"unarchive_session_response"}`; id removed from `hiddenSessionIds`, `sessionUnarchivedAt` stamped | the row returns to the live list and the header disappears | works |
| Archiving the **open** conversation | `archive_session` | as above | the open conversation moves to the remaining live one; the shell header went from "Session B: tidy the docs" to "New Conversation" | works |
| Search while a row is archived | none | — | the archived row matches, the section is force-expanded, the chevron shows expanded, and the header's title drops to bare "Archived sessions" | works |
| Header click **while searching** | none | — | nothing happens (the official passes `onToggleCollapsed: undefined` while `V1` is set) | works |
| Reload | `list_sessions_request` | rows carry `archived` | the archived row is still archived, and the section is collapsed again (`zF.archivedCollapsed = !0`) | works |
| Row body click (regression) | `get_session_request` | — | still opens the conversation | works |

**Counts:** works 8 · partial 0 · broken 0 · left out 4 (below)

### Rejections driven through the host

14 payloads (7 ids × both requests) posted straight at the host. Every one
answered the bare response and left `hiddenSessionIds` byte-identical:

`../../etc/passwd` · `not-an-id` · `""` · `42` · `null` ·
`aaaa…0001/../x` · `CON`.

> These exercise the **mock host's** id check. The real host's are covered by
> `test/archiveSession.spec.ts`, which drives both handlers and both dispatcher
> cases with 9 bad ids each.

## A real bug this step's harness pass caught

The chevron was bound to `archivedCollapsed` instead of the official's `n`
(`!V1 && k1.archivedCollapsed`). With a search active the section expands but
the chevron still read "collapsed". Fixed, rebuilt, and re-measured:
`expandedClass: true`, `transform: matrix(0, 1, -1, 0, 0, 0)` while searching,
back to `none` when the query clears.

## Corrections to the step file (the bundle wins)

| The step file said | The bundle says |
| --- | --- |
| "Row actions: `H21` and `B21` icons" (implying `extract-icons.mjs`) | Both are heroicons-style wrappers (`H21 = k0(Ww0)`), not the inline-`<svg>` form the extractor reads — it reports "no drawable children found". Copied out by hand instead, attribute for attribute. `H21` is a **trash** glyph; `B21` is **arrow-uturn-left**. |
| "Read its position and collapse behaviour" (left open) | The header is last in the list, **starts collapsed** (`zF={ungroupedCollapsed:!1,archivedCollapsed:!0}`), and is **not collapsible while searching** (`onToggleCollapsed: V1 ? void 0 : …`; `n = !V1 && k1.archivedCollapsed`). |
| (not mentioned) | Both responses are **bare** — no `success`, no error. `if(y0($)===null) return {type:"…_response"}`. |
| (not mentioned) | `unarchiveSession` also writes `sessionUnarchivedAt`, pruned to 14 days (`uA0=14`, `Hf$=86400000`), even when the id was never archived. |

The step file has been updated with these.

## SDK surface

This step touches no new SDK API. `archived` is the **host's** flag, not an
`SDKSessionInfo` field — the official derives it the same way
(`z=new Set(this.settings.getArchivedSessionIds())`, then `archived: z.has(id)`).
The SDK's `deleteSession` (sdk.d.ts, `iXt`) exists and is **deliberately not
used**: archiving hides a conversation, it does not delete the transcript, and
the official never calls delete from this row.

Step 20's `SDKSessionInfo` table is unchanged — all 10 fields still carried.

## Gates

`pnpm test`
```
 Test Files  23 passed (23)
      Tests  524 passed (524)
   Duration  3.79s
```

`pnpm run typecheck:all`
```
$ tsc --noEmit
$ vue-tsc -p src/webview/tsconfig.json --noEmit
```
(no output = clean)

`pnpm run build` (runs `lint:brand`, `lint:tokens`, `lint:commands`) — run twice,
the second time with the chevron fix:
```
$ tsx esbuild.ts --production
[watch] build started
[watch] build finished
exit=0
```

## Oracle (800×900, `--ref` the official `index.css`)

| Window (root selector) | Checked | Clean | Structural diffs |
| --- | --- | --- | --- |
| dropdown, archived section **collapsed** (header + 1 live row) | 19 | 19 | **0** |
| dropdown, archived section **expanded** (header + rows) | 41 | 41 | **0** |
| the dropdown panel (`.fg-sessionsdropdown__dropdown`) | 42 | 42 | **0** |

No unknown classes in any of them. Measured on the post-fix build.

### Parity baselines re-measured (unchanged)

| Root | Baseline | Measured now |
| --- | --- | --- |
| `.fg-composer__inputWrapper` (idle) | 30/33 | **30/33** |
| `.fg-menu__menuPopup` (Modes) | 41/41 | **41/41** |
| `.fg-commandmenu__menuPopup` (model, Sonnet) | 53/73 | **53/73** |
| `.fg-commandmenu__menuPopup` ("/", Sonnet) | 79/79 | **79/79** |
| `.fg-shell__header` | 15/15 | **15/15** |
| sessions dropdown with rows, no archived section | 30/30 (step 20) | **30/30** |

## Specs added

`test/archiveSession.spec.ts`, 24 cases:

- **`archivedSessions.ts`** — the official key; non-string ids ignored; an absent
  or non-array entry reads empty; append semantics and the no-op second archive;
  batch dedupe; unarchive stamping and removal; unarchiving something never
  archived; `Zf$` pruning at exactly 14 days plus junk/NaN/Infinity; a junk
  `sessionUnarchivedAt` entry.
- **both handlers** — happy paths; 9 bad ids each writing nothing and still
  answering; a store that throws being logged rather than surfaced;
  `list_sessions` handing the archived set to the lister.
- **the dispatcher** — both cases reach their handlers.
- **`BaseTransport`** — both official payloads, with no channel.
- **`SessionStore`** — optimistic flag and rollback on throw; a session with no
  id is dropped instead of written; archiving the open conversation moves to the
  next live one; archiving the last live one starts a new conversation;
  archiving a background conversation does **not** steal focus (tested with three
  rows and the open one last, so the guard is the only thing that can keep it);
  a list arriving mid-write does not overwrite the local flag; a later list
  follows the host.

**Each spec was proved to bite**: 13 mutations, one per guard, each applied
alone — the store's type filter, dedupe, prune, removal and junk handling; both
handler id checks; the archived set reaching the lister; the rollback; the
no-id path; the replacement filter; the focus guard; and the in-flight guard.
All 13 failed the suite.

## Rows deliberately left out and why

| Feature | Official id | Reason |
| --- | --- | --- |
| Auto-archive | `archiveInactiveSessions`, `qf$`, `Nf$`, `sweepInactiveSessions` | not in `CLAUDE.md`'s scope list — user decision, taken at the start of this step |
| Session groups | `get_session_groups`, `update_session_groups`, `tY(…)` in `unarchiveSession` | not in the scope list; so unarchive has no group to prune the id out of |
| `session_archive_changed` push | `broadcastSessionArchiveChanged` | it fans out **only to other webviews** (`if(!J.isChatSurface && J.comms!==$)`). Forge has one webview and no auto-archive sweep, so nothing would produce it. Shipping the receiver alone would be dead code (B4). |
| Multi-select archive | `archiveSelection` in the row context menu | the dropdown has no selection model and the context menu is not in scope |
| Delete a session | SDK `deleteSession` | the official's archive row never deletes a transcript |
| Worktree pill, `generate_session_title` | — | `out-of-scope.md` |

## Scope notes and pre-existing issues

- **Scope note (revertible):** the archived section's collapse state lives in
  component state, not in `update_session_section_collapse_state`. That request
  is not in scope, and it is the official's own fallback path
  (`D0: if(_&&T) T(X1); else s5(…)` — local state when the host does not offer
  the request). Consequence: collapsing the section does not survive a reload.
  The official behaves identically when its host does not supply the state.
- `SessionStore.replaceActiveSessionIfArchived` picks the first live row.
  The official's `v_1` additionally skips rows open in another tab and remote
  copies; Forge has neither.
- **Pre-existing, still open** (not touched): as listed in
  `results/20-sessions-rename.md`.
- **Harness note:** the row action buttons were clicked programmatically, for
  the same reason as step 20 — `.fg-sessions__sessionActions` is
  `visibility: hidden` until the row is hovered, and a hidden element is not
  hit-testable until the hover repaints, which the throttled pane does not do.
  The header was clicked programmatically too. Search input changes used real
  `input` events.

## VS Code checklist for the user (unverified until you run it)

1. Open the sessions dropdown, hover a row, click the trash icon.
   **Expected:** the row disappears from the live list and reappears under a
   collapsed "Archived sessions" header with the right count.
2. Reload the window and reopen the dropdown.
   **Expected:** it is still archived, and the section is collapsed again.
   In the extension host's `globalState`, `hiddenSessionIds` contains the id.
3. Expand the section and click the arrow icon on the archived row.
   **Expected:** the row returns to the live list, the header disappears, and
   `globalState.sessionUnarchivedAt` has an entry for that id with the current time.
4. Archive the conversation that is currently open.
   **Expected:** Forge switches to another conversation (or opens a new one when
   there is no other live conversation).
5. With a session archived, type part of its title into the search box.
   **Expected:** it is listed, the section shows as expanded, and clicking the
   header does nothing while the search box has text.
6. Confirm nothing was deleted: the session's `.jsonl` is still in
   `~/.claude/projects/<project>/`, untouched.
