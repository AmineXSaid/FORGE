# Production audit, Phase 6: the four unfinished items

Four items, each through Phases 2 (specs), 3 (the harness) and 4 (end to end):

1. Bypass permissions in Pajamas deep red.
2. The Expert row.
3. The left window as the official session manager (`KW0`).
4. The failed `@browser` attach, diagnosed, with its reason in the chat.

Commits on `claude/endpoint-model-health-ebc111`: `746e99a` (items 1–2),
`3cc6070` (item 3), `1b1a3d7` (item 4), and this report.

Where it was run: linux-x64, code-server 4.105.1 (VS Code 1.105.1) in headless
Chromium as the Windows stand-in, the bundled CLI 2.1.274, the stub gateway.
**Real Windows VS Code and the user's gateway (`localhost:20128`) were not
reachable from this container: everything below is unverified there**, and
the checklist at the end is what to run.

## B9 table

`request`: what the row sends. `host result`: the real handler's answer, from
the specs and (end to end) the real host. `UI effect`: what was measured in the
harness or in VS Code. Harness rows are `drive-all.mjs`; e2e rows are
`e2e/launch.mjs` scenarios.

### Item 1: bypass permissions in deep red

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| Mode menu: Bypass permissions (harness) | `set_permission_mode {bypassPermissions}` | answered | send button fill `rgb(129,39,19)` (red-800); glyph, working indicator and focus ring `rgb(163,44,18)` (red-700) | works |
| Scenario 20: the confirmation (e2e) | the host's modal, then `forge.allowDangerouslySkipPermissions` | written to `Machine/settings.json` (code-server's machine scope) | "Allow bypass permissions?" answered; footer "Bypass permissions"; the same two computed colours in VS Code | works |
| Scenario 20: runs with no prompt (e2e) | a turn with `run :: touch …` | the CLI **refuses** bypass as root ("--dangerously-skip-permissions cannot be used with root/sudo privileges") and exits 1 | the chat now says so: "Claude Code stopped unexpectedly (exit code 1): --dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons." | partial (root host; Windows has no such check) |

### Item 2: the Expert row

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| Mode menu: Expert (harness) | `set_expert_mode {channelId, enabled:true}` | `applyFlagSettings({outputStyle:'forge:Expert'})`, `set_expert_mode_response` | first row, mortarboard in gold `rgb(193,125,16)`; footer "Expert"; menu 51 elements, 0 structural | works |
| Mode menu: Manual after Expert (harness) | `set_expert_mode {enabled:false}` then `set_permission_mode {default}` | `applyFlagSettings({outputStyle:null})` | footer "Manual" | works |
| Shift+Tab cycle (harness) | as above | — | Expert → Manual → Edit automatically → Plan → Bypass permissions | works |
| Scenario 21: on mid-conversation (e2e) | `set_expert_mode` | the session flag layer | the next request carries `# Output Style: forge:Expert` and its text; no settings file changed | works |
| Scenario 21: relaunch (e2e) | the CLI SIGKILLed, then a message | Expert re-applied on the new process before the turn | the next request still carries the style | works |
| Scenario 21: off (e2e) | `set_expert_mode {enabled:false}` | `outputStyle:null` | the next request ends with the CLI's "The output style was reset to the default" (it keeps its memoized system prompt and sends the change as a notice, `gTt(null)`) | works |

### Item 3: the session manager

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| list | `list_sessions`, `get_session_groups`, `get_collapsed_panel_sections` | groups (archived ids left out), section state, panel sections | the official KW0 markup: 53 elements, 0 structural | works |
| Collapse / expand session manager | `update_collapsed_panel_sections {toggle:{section:'sessions',collapsed}}` | `Lf$` / `Df$`, stored in `collapsedPanelSections` | body collapsed / open; seeded into the page on reload (no flash) | works |
| New session | `reveal_chat {newConversation:true, fromView:true}` | the chat's new conversation | hand-off to the chat | works |
| Search sessions | — | — | box folds out, "tidy" → Session B, Escape folds it away | works |
| New group (named inline) | `update_session_groups` ×2 | `VG` normalised, archived pruned | "Refactor"; 63 elements, 0 structural | works |
| Row menu (`mH0`) | — | — | Resume session / New group from session / Add to group › / Mark as unread / Archive session; 10 elements, 0 structural | works |
| Add to group ▸ | `update_session_groups` | stored | the group holds the row | works |
| Collapse a group | `update_session_groups` (`collapsed:true`) | stored | group folded | works |
| Group menu (`_W0`) | — | — | Start new session in this group / New group / Rename group / Delete group; 0 structural | works |
| Rename group | `update_session_groups` | stored | "Cleanup" | works |
| Start new session in this group | `reveal_chat {newConversation:true, groupId}` | the pending group, given to the first fresh session the CLI names, then `session_groups_changed` | harness: the request; **e2e (scenario 22): after a message, the group reads 2** | works |
| Multi-select, "New group from 2 sessions" | `update_session_groups` | stored | Ctrl+click selects two; new group holds both | works |
| Remove from group | `update_session_groups` | stored | back to Ungrouped | works |
| Drag a row onto a group | `update_session_groups` | stored | the group holds it (a synthetic DragEvent: CDP cannot drive native drag) | works |
| Mark as unread | `set_session_unread {unread:true}` | stored, feed rebroadcast | the unread dot | works |
| Active · N | — | — | only the unread row shows | works |
| Filter by status | — | — | Status / Tabs sections with counts; a check keeps the menu open; 16 elements, 0 structural | works |
| Archive session (menu) | `archive_session` | stored | "Archived sessions 1" | works |
| Expand Archived sessions | `update_session_section_collapse_state {patch:{archivedCollapsed:false}}` | `M7$`, stored | archived rows shown | works |
| Archived row menu (`cH0`) → Unarchive | `unarchive_session` | stored, **pruned from every group** (the official `tY`) | row back, ungrouped | works |
| Rename session (pencil) | `rename_session` | `custom-title` | title changed | works |
| Delete group | `update_session_groups` | stored | group gone | works |
| Open a conversation | `reveal_chat {sessionId}` | the chat opens it | hand-off | works |
| Groups after a reload | `get_session_groups` | stored | the same groups | works |
| No endpoint | `run_endpoint_action {action:'add'}` | the setup flow | the endpoint setup stands in the view, no list | works |
| Empty / list error | `list_sessions` | empty / failure | "No sessions yet" (the official has no error state) | works |
| Scenario 9 (e2e) | rename and archive in the dropdown; unread in the manager | written | all three hold after a reload | works |
| Scenario 22 (e2e) | groups, "Start new session in this group", the section | written | the group reads 2; the section stays collapsed after a reload; delete works | works |
| Dropdown (`QW0`), harness | `list_sessions`, `rename_session`, `archive_session`, `get_session` | — | search by title and branch; no dot and no unread row, as QW0; 48 elements, 0 structural | works |

### Item 4: the `@browser` attach

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| `@browser:new_tab` attaches (harness) | `ensure_chrome_mcp_enabled`, `create_new_browser_tab`, `io_message` | a tab | the turn carries `<browser tabGroupId=… tabId=…>` | works |
| `@browser` refused (harness) | `ensure_chrome_mcp_enabled`, `create_new_browser_tab` → error | "Failed to create new tab: Browser extension is not connected…" | banner "Couldn't attach a browser tab: …"; the text back in the composer; nothing sent; banner 0 structural | works |
| Scenario 16 (e2e, real CLI, no Chrome extension) | as above | the real server's words (no longer `SyntaxError: Unexpected token 'B'`) | "Couldn't attach a browser tab: Browser extension is not connected. Please ensure the Claude browser extension is installed and running (https://claude.ai/chrome), and tha…"; the text back in the composer | works |
| A successful attach with Claude in Chrome | — | — | not reachable here | **unverified** |

**Counts (Phase 6 rows):** item 1: 2 works, 1 partial; item 2: 6 works;
item 3: 28 works; item 4: 3 works, 1 unverified. **39 works · 1 partial ·
1 unverified · 0 broken.**

### What the end-to-end runs found and fixed

1. **A launch that fails says why.** The SDK appends the CLI's stderr to its
   exit error; Forge now shows the last line that is not debug log
   (`stderrReason`), so "exit code 1" becomes the CLI's own sentence (a refused
   bypass, an unknown `forge.cliArgs` flag).
2. **Expert off is a notice, not a new system prompt.** Not a Forge defect:
   CLI 2.1.274 memoizes its system prompt sections and sends a changed output
   style as an attachment. Scenario 21 now checks for that notice.
3. **The `@browser` attach** (item 4): an unawaited prompt, the server's words
   instead of a JSON error, and the reason in the chat.
4. **The unread dot and row belonged to the session manager**, not the
   dropdown: QW0 passes no status feeds.

### Rows left out, and why

| Row | Why |
| --- | --- |
| The session manager's "Account & usage" section (`f95`) | account & usage is out of scope (`CLAUDE.md`) |
| The Local / Web switch, the remote list, reconnect | claude.ai accounts only; Forge has local sessions only |
| The worktree pill ("Open … in new window") and "create worktree" | Forge's host does not open a folder in a new window |
| "Toggle fast mode" in the harness model | not registered for that model, as the official |

## Divergences recorded

`docs/forge-design.md`, 2026-09-24, Phase 6: #49 the bypass colour, #50 the
Expert row, #51 the left window, #52 the dropdown as `QW0`, #53 a failed
`@browser` attach.

## The harness

`drive-all.mjs`, full run on the final build (served `main.js` byte-compared
with `dist/media/main.js`): **109 pass · 0 fail · 1 left out** ("Toggle fast
mode", above). `probe-oracle.js` on 23 windows, `--ref` the official
`index.css`: every window matches its baseline; the six new windows (the
session manager twice, the row, group and status filter menus, the browser
attach error) have **0 structural diffs** and are now in
`baselines/oracle.json`. The welcome, composer and model-menu diffs are the
recorded divergences (#20, #21, #26), unchanged.

## End to end

(Filled in below from the full run.)

## Gates

- `pnpm test`: 2524 passed, 8 skipped. Phase 6 specs: `sessionGroups` 50,
  `expertMode` 13, `bypassColour` 6, `browserIntegration` 51, `chatErrors` 25.
- `pnpm run typecheck:all`: clean. `pnpm run build` (which runs `lint` and
  `lint:forge`): passes.

## Checklist for Windows VS Code (unverified)

With `omniroute` running (any key in an environment variable, never in the
chat), in the isolated VS Code the kit launches
(`node .claude/skills/ui-parity/e2e/launch.mjs --code <Code.exe> --gateway http://localhost:20128/v1 --model auto/best-fast`):

1. Scenario 20: after "Allow bypass permissions", `forge.allowDangerouslySkipPermissions`
   is `true` in `User/settings.json`, and `run :: touch …` (with `--stub`)
   creates the file with no permission prompt. Expected: **pass**, not partial
   (Windows has no root check).
2. Scenario 21: Expert on after a plain turn; the gateway sees the Expert
   text; after the CLI is killed the next turn still has it; Manual sends the
   reset notice.
3. Scenario 22: the session manager in the activity bar: "New group", "Add to
   group", "Start new session in this group" (the group count goes to 2 after
   one message), the section collapsed after a reload.
4. Scenario 9: the unread dot, set in the session manager, survives a reload.
5. `@browser`: with the Claude in Chrome extension installed and Chrome
   running, "Browse the web" → the `@` list → "New tab" → send: the turn
   attaches a tab. Without the extension (or, per the CLI's message, without a
   claude.ai login on the same account): the chat shows the reason and keeps
   the text. **Open question:** Forge's sessions run on endpoints, often with
   no claude.ai login, so a successful attach may not be possible for them.
6. The session manager with no endpoint profile: the endpoint setup, and
   "Set up an endpoint" opens the setup flow.
7. `pnpm run release:check` on a clean checkout: eight passes.
