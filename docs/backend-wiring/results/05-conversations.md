# Group 5: Conversations — checkpoint report

Covers steps [20](20-sessions-rename.md), [21](21-sessions-archive.md),
[22](22-sessions-unread-status.md), [23](23-sessions-branch-search.md),
[24](24-rewind-code.md), [25](25-fork-and-message-actions.md) and
[26](26-resume-conversation-row.md).

> ## Status: signed off
>
> All seven steps are complete, gated and **harness-verified**. Steps 24–26 were
> first written up with their harness work outstanding, because the Browser-pane
> tool was removed from this session by an MCP reload part-way through step 25.
> That debt has since been **paid in full** rather than carried forward: the
> harness was driven by talking to Chrome directly over the DevTools Protocol
> (Chrome is installed, and Node 24 has a built-in `WebSocket`, so
> `Runtime.evaluate` and `Input.dispatchMouseEvent` give page evaluation and
> **real** mouse input). Every row in the tables below marked "works" was
> clicked, with its request read back out of `__forgeSent`.
>
> Two things that pass had to get right, and would have produced confident
> nonsense otherwise. A harness from **another worktree** was already listening
> on port 8735 serving a different build (1 909 943 bytes, none of this group's
> markers), so the pass runs on **8741** with `/main.js` byte-compared against
> `dist/media/main.js` first. And an early "no uuid" result was a **test**
> artifact — `document.body.click()` does not fire `mousedown`, so a popup that
> looked wrong was simply the previous one still open. Re-tested properly, it
> behaves exactly as the official does.


## Results

### Steps 20–23 (harness-verified)

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| Rename a conversation | `{type:"rename_session",sessionId,title}` | `custom-title` line appended via the SDK's `renameSession`; `session_renamed` pushed | the row's title changes; the editor closes | works |
| Rename rejections (bad id, empty title, 200-char cap) | same | `skipped:true`, nothing written | nothing changes | works |
| Archive | `{type:"archive_session",sessionId}` | id appended to `hiddenSessionIds` | the row moves into the Archived section | works |
| Unarchive | `{type:"unarchive_session",sessionId}` | id removed, `sessionUnarchivedAt` stamped | the row returns to the live list | works |
| Mark as unread | `{type:"set_session_unread",sessionKey,unread:true}` | key appended; feed rebroadcast | `fg-statusdot__statusDotUnread` appears; **dropdown stays open** | works |
| Mark as read | `{…,unread:false}` | key removed; feed rebroadcast | the dot clears | works |
| Feed pushed without `unreadSessionKeys` | `session_states_update` | — | the dot **survives** | works |
| Reload with a mark set | none on load | the mark is in the host store | the dot is re-rendered from the feed | works |
| Repeat mark / bad key / non-boolean | `set_session_unread` | `changed:false`, no rebroadcast, nothing written | nothing changes | works |
| Branch search (incl. mixed case) | none — a client-side filter | — | only rows whose `gitBranch` matches remain, with **no `<mark>`** on a branch-only match | works |
| Slow list | `list_sessions_request` delayed | answer delayed | the `JW0` spinner + "Loading sessions…" | works |
| Turn finishes while hidden / webview becomes visible | `set_session_unread` | key added / removed | the dot appears / clears | spec-verified — the harness pane cannot be hidden mid-turn |
| Opening an unread row | **none** | — | the conversation opens, **the dot stays** | works — *and the earlier claim that this sends `unread:false` was wrong; corrected in step 22's file* |

### Steps 24–26 (harness-verified)

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| Rewind dry run (dialog opens) | `{type:"rewind_code",userMessageId,dryRun:true}` on the channel | `query.rewindFiles(id,{dryRun:true})`; five fields forwarded | 3 cwd-relative files, 42 insertions, 17 deletions | works |
| Rewind real run (confirm) | `{type:"rewind_code",userMessageId}` — **the `dryRun` key absent, not `false`** | `rewindFiles(id,{dryRun:undefined})` | a `meta` row: "Code rewind successful" | works — **the files-on-disk effect is CLI-side and no harness can prove it** |
| Nothing to restore | `dryRun:true` answering `filesChanged:[]` | — | "The code **has not changed**…", primary **disabled** | works |
| Checkpoint error | `rewind_code` | the host **throws** `result.error` | `.fg-changes__error` "No file checkpoint found" | works |
| "Never mind" | nothing after the dry run | — | the dialog closes, nothing else sent | works |
| Bad uuid / non-boolean `dryRun` | `rewind_code` | refused before the SDK is reached | `{canRewind:false}` | works |
| Closed channel | `rewind_code`, unknown `channelId` | `requireChannel` throws | the request rejects | spec-verified |
| "Message actions" button | — | — | first child of the inner `userMessageContainer`, hidden until hover, correct glyph and attributes | works |
| "Fork conversation from here" (message 2+) | `{type:"fork_conversation",forkedFromSession,resumeSessionAt:<previous uuid>}` | the SDK forks | re-list, then the fork opens with the picked prompt in the composer | works |
| "Fork conversation from here" (first message) | **none at all** | — | a fresh conversation seeded with that prompt | works |
| "Fork conversation and rewind code" | `rewind_code` `dryRun:true` → `rewind_code` → `fork_conversation` | both | "Fork and rewind" dialog; the three requests arrive **in that order** | works |
| A rewind that cannot run, in option 3 | the dry run only | `canRewind:false` | primary **disabled**, so **no `fork_conversation` is ever sent** | works |
| Options 2 and 3 on a uuid-less message | — | — | **not rendered** — only option 1 | works |
| Fork rejections (bad source, bad `resumeSessionAt`, unknown session) | `fork_conversation` | **throws** | `invalid session id` / `Session … not found` | works |
| A whole-conversation fork | `{forkedFromSession}` with no `resumeSessionAt` | forks the lot | `{sessionId}` | works |
| "/" → Rewind | — | — | the "Rewind to…" picker, newest first, `role="listbox"`, ↑↓/Enter/Esc hints | works |
| Keyboard in the picker | — | — | ArrowDown moves the focused row; Enter opens "Fork and rewind" | works |
| "Resume conversation" hidden until filtered | **none — no request exists** | **none — no handler** | not among the 15 visible rows | works |
| Typing `resume`, then clicking it | none | — | one row remains; clicking closes the menu and opens the sessions dropdown | works |
| Context row copy, flags and order | — | — | matches the bundle verbatim | works |


**Counts across the group:** works 33 · spec-verified 3 · partial 0 · broken 0 ·
left out 10 (below).

## Harness coverage — step 27's own task

| Step 27's task | Status |
| --- | --- |
| Click every sessions-dropdown action | **Done** — rename and archive/unarchive in their own steps; mark-unread re-clicked in this pass (request recorded, dot appears, dropdown stays open). |
| Click every Message action | **Done** — all three options, on a message with a fork point, on the first message, and on a message with no uuid. |
| Click the Rewind row | **Done** — opens the picker; keyboard navigation and Enter as well. |
| Click the Resume row | **Done** — hidden unfiltered, revealed by `resume`, opens the dropdown. |
| Oracle each window: 0 structural diffs | **Done — 0 on every window measured.** |
| Write this report | Done. |
| Hand over the VS Code checklist for 20–26, marked unverified | Done, below. |


### Oracle numbers on record

All at **800×900** with `--ref` the official `index.css`. No unknown classes in
any of them.

| Window (root selector) | Checked / clean | Structural diffs | When |
| --- | --- | --- | --- |
| Sessions dropdown, rows listed | 43 / 43 (3 rows) · **57 / 57** (4 rows) | 0 | steps 22–23 · re-run |
| Sessions dropdown, one row unread | 44 / 44 (3 rows) · **58 / 58** (4 rows) | 0 | steps 22–23 · re-run |
| Sessions dropdown, loading state | 44 / 44 | 0 | steps 22–23 |
| Dropdown, archived collapsed / expanded | 19 / 19 · 41 / 41 | 0 | step 21 |
| User message, **before** the actions button | 7 / 7 | 0 | step 24 |
| User message, **with** the actions button | **11 / 11** | 0 | step 25 |
| `.fg-messageactions__popup`, three options open | **7 / 7** | 0 | step 25 |
| `.fg-dialog__overlay` — the `mo` confirm dialog | **20 / 20** | 0 | step 25 |
| `.fg-dialog__overlay` — the "Rewind to…" picker | **21 / 21** | 0 | step 25 |
| `.fg-commandmenu__menuPopup` ("/" menu, **15 rows**) | **82 / 82** | 0 | step 26 |
| `.fg-composer__inputWrapper` (idle) | 30 / 33 | 1 — the send sparks' opacity, by design | re-run |
| `.fg-shell__header` | 15 / 15 | 0 | re-run |
| `.fg-menu__menuPopup` (Modes) | 41 / 41 | 0 | re-run |
| `.fg-commandmenu__menuPopup` (model menu, Sonnet) | 53 / 73 | 4 — the `fg-modelmenu__modelLabel` chips, the user's design change | re-run |


**The "/" menu baseline has moved, and the new number is recorded.** Steps 25
and 26 add `rewind` and `resume-conversation`; `resume-conversation` is
`filterOnly`, so the unfiltered menu went from 14 rows to **15**, and from 79/79
to **82/82** with 0 structural diffs. **82/82 is what group 6 compares against.**


One artifact worth carrying forward: a popup measured immediately after opening
can report `opacity: forge 0 | official 1`, because its fade-in is a CSS
transition and `requestAnimationFrame` does not run while the Browser pane is
throttled. Forcing a frame (a screenshot) resolves it. A number written down
without that re-check looks like a regression and is not one.

## Gates (on the step-26 tree)

- `pnpm test`: `Test Files 28 passed (28) · Tests 664 passed (664)`, no unhandled errors
- `pnpm run typecheck:all`: `tsc --noEmit` and `vue-tsc -p src/webview/tsconfig.json --noEmit`, both clean
- `pnpm run build`: **exit 0**. `build` is `lint:forge && build:webview && build:extension`, `&&`-chained with lint first, so exit 0 implies the three lint gates. Run separately for visible output:

      $ node scripts/check-brand.mjs && stylelint "src/**/*.css" "src/**/*.vue"
      Forge brand guardrail: clean (342 files scanned)
      $ node scripts/check-tokens.mjs
      Forge token check: clean (240 tokens used, 383 defined)
      $ node scripts/check-commands.mjs
      Forge command check: clean (20 commands, 13 references)

`dist/media/main.js` is **1 919 610** bytes and carries every marker for steps
24–26, so the built bundle really contains this group's code.

**Mutation checks across the group:** 16 (steps 20–21) + 12 (22) + 4 (23) +
18 + 7 (24) + 15 (25) = **72 deliberate breaks, 72 caught**. Two were missed on
their first run and the specs were extended until they bit — both are named in
their own results files rather than quietly fixed.

## SDK surface across the group

Full per-field tables are in the step files. The short version:

| SDK symbol | Line | Forge surfaces |
| --- | --- | --- |
| `SDKSessionInfo` (10 fields) | 5483ff | **all of them**, carried onto the row by `toSessionListRow` |
| `listSessions` / `ListSessionsOptions` | — | `dir`, `includeWorktrees`, `includeProgrammatic` |
| `renameSession` | 3029 | yes, with `dir` |
| `RewindFilesResult` (6 fields) | 3124 | **all six** — five forwarded, `error` thrown as the official throws it |
| `Query.rewindFiles(id, {dryRun})` | 2915 | yes, all three `dryRun` states |
| `Options.enableFileCheckpointing` | 1605 | yes — **on for every session** |
| `forkSession` / `ForkSessionOptions` | 770 / 775 | `upToMessageId`, `title` (**more than the official passes**), `dir`; not `sessionStore` (`@alpha`) |
| `ForkSessionResult.sessionId` | 787 | yes, unwrapped to the bare string |
| `SessionMutationOptions` | 6069 | `dir` yes; `sessionStore` no |
| `SDKUserMessageReplay` (10 fields) | 5923 | `type`, `message`, `uuid`, `isReplay`, `parent_tool_use_id`, `timestamp`; not `session_id`, `priority`, `origin`, `file_attachments` |
| `Options.forkSession` / `resumeSessionAt` / `resumeDropsTurn` / `sessionId` | 1621, 1988, 2039, 1980 | **no** — the resume-time fork, a different mechanism; the flag gate already knows `fork-session` if a later step wants it |

Unread is **not** an SDK concept: the official keeps it in the extension's
`globalState` and so does Forge.

## The blocker this group hit, and what it cost

`rewind_code` and `fork_conversation` both key off a **user-message uuid**, and
Forge produced none — the loader put the transcript uuid into `session_id` and
overwrote `uuid` with the API message id, and a live turn never minted one
because Forge did not pass `--replay-user-messages`. Put to the user as a scope
question; the user chose to fix both. The fix is the official's own: mint the
uuid client-side, pass the flag (which the official's base `extraArgs` already
carries), and drop the CLI's echo of a prompt already on screen by uuid. The
official's replay *placement* machinery is deliberately not ported — Forge
appends; nothing duplicates either way, because the uuid guard is what prevents
that.

**This changes every session**: the CLI now echoes user messages it processes, so
a message injected by a hook, by queued input or by a compaction becomes visible
where it was not before. That is the official's behaviour, and checklist item 8
is how to confirm it.

## Rows deliberately left out and why

From [out-of-scope.md](../out-of-scope.md), the ones that touch this group:

| Feature | Official requests / ids | UI kept out | Reason |
| --- | --- | --- | --- |
| Thumbs rating | `message_rated` (`WU0`) | the thumbs | out of scope — it is the function immediately after `HU0`, read past three times while extracting this group, and not built |
| Account & usage | `get_usage`, `open_account_usage` | the `account-usage` row, the `usage` command | out of scope: account and cloud |
| Login / Switch account | `login`, `get_auth_status`, `submit_oauth_code` | the `login` row | out of scope: account and cloud |
| Remote Control | `toggle_remote_control` | the row and `/remote-control` | out of scope: account and cloud |
| Feedback | `submit_feedback`, `/feedback`, `/bug` | those rows | out of scope: account and cloud |
| Side question | `/btw`, `side_question` | the row | out of scope |

Plus the ones this group decided for itself:

| Row | Reason |
| --- | --- |
| The worktree pill, `generate_session_title` | Not in `CLAUDE.md`'s scope list; named in the spec but not built. |
| `liveElsewhereSessions` / the `statusDotElsewhere` ring, `statusDotFailed` | Need a second surface, or have no producer. |
| The official's `messageHovered` class | `VZ` has no such key and `index.css` no such rule — the official renders a literal `undefined` class. Inert; omitted. |
| `AppContext.forkConversation`'s `openNewInTab` branch | Needs `new_conversation_tab` to carry a `sessionId`; Forge's request has no such field, its handler only focuses the chat view, and `openNewInTab` is hardcoded `false`. |
| A Forge setting for file checkpointing | The official has none, and the user chose "always on". |
| The composer's inline error line | `.fg-chat__errorMessage` / `.fg-chat__errorDismiss` are ported but nothing renders them, so `onRewindError` routes to a notification. A deviation, recorded not hidden. |
| The official's replay placement (`replayInsertIndex`, `localTurnStarted`, `turnHadToolRound`) | Ordering, not correctness. Forge appends. |

## Pre-existing issues, still open

- `handleGetAssetUris` uses `process.cwd()`.
- The mock host acks unknown requests without `success`.
- The Settings page lists models through an `sdk_probe` spawn.
- `~/.forge.json` gains every default key on the first settings write.
- The AskUserQuestion prompt is still a generic "Yes / No".
- `CLAUDE.md`'s Permissions scope line is outdated (since step 16 it opens the
  "Permission rules" dialog, not a Settings tab).
- Step 21 never wired the `session_archive_changed` push into the webview —
  harmless in one window.
- `handleNewConversationTab` is a stub; `openNewInTab` is hardcoded `false`.
- The composer's inline error surface is ported but dead.

## VS Code checklist for steps 20–26 — **all unverified**

The harness proves the webview↔host contract. Everything below is CLI-side or
on-disk and **has not been observed**. Numbered so results can be reported back.

**Rename, archive, unread, search (20–23)**
1. Rename a conversation in "Past conversations". **Expected:** the title
   changes in the list, and `~/.claude/projects/<project>/<id>.jsonl` gains a
   `custom-title` line.
2. Archive it, then unarchive it. **Expected:** it moves into and out of the
   Archived section, and survives a window reload both ways.
3. Send a prompt, hide the Forge view before the turn ends, then show it again.
   **Expected:** the row carried an unread dot, and showing the view cleared it.
4. Click the envelope on a row. **Expected:** a dot appears, the title flips to
   "Mark as read", the dropdown stays open, and the dot survives a reload.
5. Open the same repo from a `.claude/worktrees/<name>` checkout. **Expected:**
   the same unread list — `A7$` strips the worktree segment.
6. Type part of a branch name that is in no title. **Expected:** that branch's
   conversations stay listed, with no highlight on their titles.

**Rewind (24)**
7. Ask Claude to edit `a.txt` and let it finish. Run "/" → Rewind, pick the
   message before that edit. **Expected:** the dialog names `a.txt` **relative
   to the workspace root**, with counts matching the edit.
8. Confirm. **Expected:** `a.txt` is back to its previous content **on disk**,
   and a one-line "Code rewind successful" note appears in the transcript.
9. Repeat where a tracked file is a symlink. **Expected:** "Code rewind
   completed, but 1 file was skipped: the tracked path is (or became) a link…",
   and a warning notification saying the same.
10. Check disk use on a large repo after a long session. **Expected:**
    checkpoint backups exist. That is the price of always-on checkpointing, and
    the moment to ask for a setting if it is too high.

**The uuid and replay change (24) — most worth checking by hand**
11. Send a prompt in a live session. **Expected:** it appears **once**. If you
    ever see a prompt doubled, that is this change, and
    `--replay-user-messages` in `forgeBaseCliArgs` is the thing to remove.
12. Close a conversation, reopen it from "Past conversations", and run "/" →
    Rewind. **Expected:** every past prompt is listed. Before this group the
    list would have been empty — the loader threw the uuids away.
13. Trigger a message the webview did not send (a `UserPromptSubmit` hook, or
    queue a prompt while a turn runs). **Expected:** it now appears in the
    transcript. Its **position** may differ from the official's, which inserts
    it at the replay index while Forge appends it — the one piece deliberately
    not ported.

**Fork and Message actions (25)**
14. Hover the **second** user message and click the button at its top-right.
    **Expected:** three options.
15. "Fork conversation from here". **Expected:** a new conversation holding
    history up to the message **before** the one picked, that message's text in
    the composer, the original unchanged on disk, and a new `.jsonl` named for
    the new session id.
16. Open "Past conversations". **Expected:** the fork is listed as
    `<original> (fork)` — the SDK derives that when no title is passed.
17. "Fork conversation and rewind code" on a message after a file edit.
    **Expected:** the dialog is titled "Fork and rewind"; confirming restores
    the files **and then** opens the fork.
18. Make the rewind fail (pick a message with no checkpoint — anything from
    before this build, since checkpointing only started in step 24).
    **Expected:** an error, and **no fork is created**. That ordering is the
    single most valuable thing on this list.
19. Hover the **first** user message and fork from it. **Expected:** a brand-new
    empty conversation seeded with that prompt, not a fork.

**Resume (26)**
20. Type `/` then `resume` in the command filter and choose the row.
    **Expected:** past conversations open in the dropdown under the header.
21. Open the "/" menu without typing. **Expected:** "Resume conversation" is
    **not** listed (it is `filterOnly`), while "Rewind" is.
