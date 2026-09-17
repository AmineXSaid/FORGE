# Group 1 report: frontend defects (steps 01–05)

Checkpoint (step 06), 2026-09-17. No code changed. Everything below was
re-measured on **one build** of `forge/backend-wiring` at `a74df01`. That tip
contains steps 01–05 **and** the user's merge `fe6833f` of
`claude/ui-parity-code-chat-91c368` (the official transcript and tool rows, the
Pajamas shell terminal). So this is also the first check that the merge didn't
break steps 03–04.

Harness: `node .claude/skills/ui-parity/scripts/harness.mjs --port 8735 --ref …/webview/index.css`,
started after the build. Checked: `Array.isArray(window.__forgeSent)` is true;
stylesheets `[1, 5, 9691]` after 3s (9819 before the merge); the served `/main.js`
contains `content_block_start` (step 03), `dotProgress` (step 04), `Unsupported
content type` and `Thought for ` (from the merge). The viewport was 460×900 unless a row says otherwise.
Each busy turn began with a real composer send (the `Message input` ref, typed,
Enter). Stream and transcript messages were posted as
`{type:'from-extension', message:{type:'io_message', channelId: __forgeChannelId(), message}}`,
and a `result` ended each turn. The harness was stopped afterwards, and port 8735 was confirmed free.

## Results

No request is added or changed in group 1, so the "request" column shows what
the webview sent (`window.__forgeSent`) or the message the harness pushed in.

### Step 01: app fills the webview

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| `#app` width, chat, 1024px | none | — | body 1024, `#app` 1024 | works |
| `#app` width, chat, 460px | none | — | body 460, `#app` 460 | works |
| `#app` width, chat, 320px | none | — | body 320, `#app` 320 | works |
| Rule removed live at 460px, then restored | none | — | `#app { flex: 1 1 0%; min-width: 0px; max-width: 100%; display: flex }`: removed **382.59**, restored **460** | works (the rule is what fixes it) |
| `?page=sessions`, 460px | `list_sessions_request` | mock `sessions: []` | `#app` 460, `scrollWidth` 460 (no horizontal overflow) | works |
| `?page=settings`, 460px | `get_settings` | mock `{}` | `#app` 460, `scrollWidth` 460 | works (the "General" heading overlap is still there, see issues) |
| Sessions dropdown, 460px | none | — | `top: 38px; right: 16px`, x 44 → 444, width 400 | works |
| Sessions dropdown, 320px | none | — | `top: 38px; right: 16px`, x 16 → 304, width 288, no overhang | works |
| Oracle `.fg-shell__header` | — | — | 15 checked, 15 clean, **0 structural** (460 and 320) | works |
| Oracle `.fg-chat__inputContainer` | — | — | 31 checked, **3 structural**, the same 3 rows as in results/01 | issue that already existed (not from group 1) |

### Step 02: Slash Commands section

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| T1 "/" with no filter | none | — | sections Context, Model, Customize, Settings, Support; no Slash Commands | works |
| T2 filter `/` | none | — | Slash Commands added (between Settings and Support): `/compact`, `/init`, `/review`, `/security-review`, `/team-tools:review` | works |
| T3 filter `/comp` | none | — | `/compact`, `/security-review` | works |
| T8 filter `usage` / `context` | none | — | `usage`: no rows; `context`: `MCP servers`, `/compact` (description matches); never `/usage` or `/context` | works |
| T8b filter `review` | none | — | `/review`, `/security-review`, `/team-tools:review` | works |
| T4 click `/compact`, draft "hello draft" (real typing) | `io_message` user `[{type:"text",text:"/compact"}]` | accepted | menu closes; draft still "hello draft"; turn busy | works |
| Enter on `/security-review` **while busy** | none | — | menu closes, nothing sent | issue that already existed (ChatPage drops sends while busy) |
| T6 Enter on `/security-review` (after `result`) | `io_message` `/security-review` | accepted | menu closes | works |
| T7 click `/team-tools:review` | `io_message` `/team-tools:review` | accepted | menu closes | works |
| T5 Tab on `/init` (typed `init`) | none | — | draft `"/init "`, composer focused, menu closes | works |
| T5b Tab on `/compact`, draft "draft to replace" | none | — | draft `"/compact "`, collapsed caret at character 9 of 9 | works |
| R1 Tab on "Switch model…" | none | — | command menu closes, model picker opens (Default, Sonnet, Fable, Opus, Haiku) | works |
| R2 click "Thinking" | `set_thinking_level {thinkingLevel:"off"}` | ack | menu **stays open** | works |
| R3 Enter on "View help docs" | `open_url {url:"https://code.claude.com/docs/en/vs-code"}` | ack | menu closes | works |
| R4 Shift+Tab in the filter | `set_permission_mode {mode:"acceptEdits"}` | mock ack **without `success`** | menu stays open; the mode label stays "Manual" | partial: the request goes out, but the label reverts because `BaseTransport.setPermissionMode` returns `!!response.success` and the mock host's generic ack has no `success`. The real dispatcher returns `success: true` (`ClaudeAgentService.ts` ~L706–715). A harness gap; the capture-phase keybinding issue is unchanged |

### Step 03: streamed partial text

| Row | Request / event | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| R1 composer send | `io_message` user "Show me a code block and a table" | accepted | 1 turn, Stop button, spinner row filled | works |
| T1 `content_block_start` (empty text) | `stream_event` | — | 0 assistant rows | works |
| T2 "Here is a code block:" | `text_delta` | — | `<p>Here is a code block:</p>` | works |
| T3 unclosed ```` ```ts ```` fence | `text_delta` | — | text still "Here is a code block:", `pre` 0 | works |
| T4 fence closed, "And a table:" plus a half table | `text_delta` ×2 | — | `pre` 1, "And a table:" shown, `table` 0 | works |
| T5 last row plus `content_block_stop` | `stream_event` | — | `pre` 1, `table` 1, cells Name/Value/a/1/b/2; no dot class | works |
| T6 final `assistant` (same `msg_A`) | `io_message` | — | 1 assistant row, 2 transcript rows (replaced, not duplicated) | works |
| T7 thinking stream | `thinking_delta` ×2, `signature_delta`, stop, final | — | "Thinking..." and content grows (48 chars) → after stop **"Thinking"** (`details.fg-thinking__thinkingV2`); the final message doesn't add a row | works. The label changed: results/03 had "Thought process"; the merge ported the official `rf1`, which says "Thinking" when there is no duration |
| T8 `tool_use` stream, `input_json_delta` split mid-string | `stream_event` | — | partial: hidden (still 2 rows); stop: row "Read forge-tokens.css", `dotProgress`; final message: still 3 rows; `tool_result`: `dotSuccess` | works |
| T9 abandoned stream (`msg_B`, then `message_start msg_C`) | `stream_event` | — | "STUCK attempt" shown, then removed; "Retry text" once after the final message | works |
| T10 subagent stream (`parent_tool_use_id: toolu_task`) | `stream_event` | — | 1 row with "Subagent says hi" while streaming and after the final message | works |
| T11 pinned at bottom, 40 paragraphs | `text_delta` ×40, final | — | gap to bottom 40 (before the first delta), then 0, 0, 0, 0, 0, 0, 0 | works |
| T12 scrolled up mid-stream (`scrollTop` 200 after the row exists), 20 paragraphs | `text_delta` ×20, final | — | `scrollTop` 200 at every sample and after the final message; no `scrollIntoView` after the scroll | works |
| T12 variant: scrolled to 200 **before** `message_start` | `stream_event` | — | held at 200 for 7 paragraphs, then jumped to the bottom. Traced: `scrollIntoView({block:'end'})` from ChatPage's row-count watcher (in a delayed `requestAnimationFrame`), then the 50px pin rule follows | issue that already existed (results/03: "the count watcher … scrolls on every new row") |
| R2 `__forgeSeedTranscript` | `io_message` ×2 | — | +2 transcript rows | works |
| R3 copy button on a code block | none | — | not run (`navigator.clipboard` is denied in the pane, per results/03) | not verifiable |

### Step 04: status dot `p85`

A real send ("Run the build and read two files"), then `assistant` and `user`
(`tool_result`) messages, then `result`.

| Row | Seeded message | Busy class (animation) | Idle class after `result` | Verdict |
| --- | --- | --- | --- | --- |
| D1 | text only | none (`none`, grey `rgb(157,157,157)`) | none | works |
| D2 | `Bash` tool_use, no result | `dotProgress` (`blink`) | `dotFailure` | works |
| D3 | `Read` + `is_error` result | `dotFailure` (red `rgb(236,89,65)`) | `dotFailure` | works |
| D4 | `Read` + ok result | `dotSuccess` (green `rgb(45,161,96)`) | `dotSuccess` | works |
| D5 | `Read`, then its result | `dotProgress` → `dotSuccess` | `dotSuccess` | works (reactive) |
| D6 | text + pending `Bash` + ok `Read` | `dotProgress` (first tool decides) | `dotFailure` | works |
| D7 | the turn ends (`result`) | — | all animations `none`; Stop button gone | works |
| D8 | streamed text row | none while streaming, after stop, after the final message | none | works |
| D9 | streamed `tool_use`: partial → stop → final → result → turn end | hidden → `dotProgress` → `dotProgress` → `dotSuccess` | `dotSuccess` | works |

Dot geometry (D1): `position: absolute`, `left 9px`, **`top 15px`**, 7×7, `border-radius 50%`.
results/04 had `top 7px`. The official rule is
`.timelineMessage:before { top: calc(var(--message-padding-top, 8px) + 7px) }`, with
`--message-padding-top: 0px` only on `.message:first-child`. Since the merge, rows sit
unwrapped inside `div.turn`, as the official lays them out, so only a turn's first row
gets 7px. D1 isn't first (the user row is), so **15px is the official value**.

### Step 05: header glyphs (no code, re-measured)

| Row | Check | 460px | 320px | Verdict |
| --- | --- | --- | --- | --- |
| H1 | Icon-button order | New session, Session history (the title button "New Conversation" comes first, as before) | same | works |
| H2 | New session box | x 394–422, 28×28 | x 254–282, 28×28 | works (same as the record) |
| H3 | Session history box | x 426–454, 28×28 | x 286–314, 28×28 | works (same as the record) |
| H4 | Glyph paths | `M12 3H5a2 2 0 0 0-2 2v14a2 2…`, `M18.375 2.625a1 1 0 0 1 3 3l…`; `M3 12a9 9 0 1 0 9-9 9.75 9.7…`, `M3 3v5h5`, `M12 7v5l4 2` | same DOM | works |
| H5 | Oracle `.fg-shell__header` | 15/15 clean, 0 structural | 15/15 clean, 0 structural | works |
| H6 | Sessions dropdown | `top 38px; right 16px`, 44–444 | 16–304, width 288 | works |
| H7 | Oracle `.fg-sessionsdropdown__dropdown` (empty list) | 15/15 clean, **0 structural**, no unknown classes (not run at 460px before) | 15/15 clean, 0 structural | works |
| H8 | Click Session history again | dropdown closes | — | works |

**Counts:** works 54 (01: 9 · 02: 14 · 03: 14 · 04: 9 · 05: 8) · partial 1 (step 02 R4, a mock-host gap) · broken 0 ·
not verifiable 1 (step 03 R3, not run) · issues that already existed, reproduced 3 (composer oracle, busy send dropped,
T12 count-watcher variant) · rows left out 0.

## Gates (output tails)
- `pnpm test`:
  ```
  Test Files  7 passed (7)
       Tests  80 passed (80)
  ```
  cliArgs 11, di 2, messageStatus 10, services 2, slashCommands 11, streamingPartialText 33, terminalRendering 11 (the last one came with the merge).
- `pnpm run typecheck:all`: `tsc --noEmit` and `vue-tsc -p src/webview/tsconfig.json --noEmit`, no output, exit 0.
- `pnpm run build`: exit 0.
  ```
  Forge brand guardrail: clean (282 files scanned)
  Forge token check: clean (222 tokens used, 374 defined)
  Forge command check: clean (20 commands, 13 references)
  dist/media/style.css   568.48 kB │ gzip:  93.25 kB
  dist/media/main.js   1,818.45 kB │ gzip: 495.57 kB
  ✓ built in 6m 32s
  $ tsx esbuild.ts --production
  [watch] build finished
  ```

## Oracle
| Window (root selector) | Checked | Structural diffs | Colour rows (brand) |
| --- | --- | --- | --- |
| `.fg-shell__header` (460, 320) | 15 | **0** | 0 |
| `.fg-sessionsdropdown__dropdown` (460, 320) | 15 | **0** | 4 |
| `.fg-chat__inputContainer` | 31 | 3 (already existed, results/01) | — |
| whole chat page, empty state | 174 | 10 (the 3 above, plus the 6 empty-state rows from results/01, plus `div.fg-chat__emptyState` `opacity`) | — |
| `.fg-commandmenu__menuPopup`, no filter | 82 | **0** | — |
| `.fg-commandmenu__menuPopup`, filter `/` (Slash Commands) | 100 | **0** | 3 |
| model picker (`.fg-commandmenu__menuPopup` opened by R1) | 51 | **0** | — |
| streamed assistant message (code block + table) | 23 | 1: `pre` font-family `"Forge Mono", ui-monospace` vs `monospace` (brand rule, as in results/03) | — |
| D1 text row / D8 streamed text row | 3 / 4 | **0** / **0** | — |
| D3 `Read` error row / D4 `Read` ok row | 8 / 8 | **0** / **0** (results/04 had 8 rows; the merge's official tool rows fixed them) | — |
| D2 `Bash` row / D6 mixed row | 17 / 26 | 9 / 9, all inside `fg-tool__toolBody` / `fg-bashtool__inputRow` (the merge's Pajamas shell terminal: Forge Mono 12px, flex input row). **Identical for none / `dotProgress` / `dotSuccess` / `dotFailure`** (class swapped and re-run), so not from the dot | — |

## Specs added
None. Step 06 changes no code. The group's specs are unchanged and pass:
`test/slashCommands.spec.ts` (11), `test/streamingPartialText.spec.ts` (33), `test/messageStatus.spec.ts` (10).

## Rows deliberately left out and why
Group 1 leaves no row out. It hides `/context` and `/usage` from Slash Commands (out of scope, see below).
The out-of-scope list, copied from `out-of-scope.md`:

| Feature | Official requests / ids | UI to keep out | Reason |
| --- | --- | --- | --- |
| Microphone / speech-to-text | `start_speech_to_text`, `stop_speech_to_text`, the `resources/audio-capture` binary | the mic button (ported `micButton` classes stay unused) | out of scope: account and cloud |
| Login / Switch account | `login`, `get_auth_status`, `submit_oauth_code` (stay commented out) | the `login` row | out of scope: account and cloud |
| Account & usage | `get_usage`, `open_account_usage` | the `account-usage` row; the `usage` slash command (its official action is `account-usage`) | out of scope: account and cloud |
| Usage / context meter | `get_context_usage`, `request_usage_update` | the footer `YH0` / `usageButtonV2`; the `context` slash command (its official action opens the context view) | out of scope: account and cloud |
| Remote Control | `toggle_remote_control`, `remoteControlAtStartup`, `/remote-control` | the `remote-control-at-startup` row and the `/remote-control` row | out of scope: account and cloud |
| Feedback | `submit_feedback`, `/feedback`, `/bug`, "Report a problem" | those rows; the live "Report a problem" button is **removed** in step 33, and the version text stays | out of scope: account and cloud |
| Thumbs rating | `message_rated` (`WU0`) | the thumbs | out of scope |
| Switch models when flagged | `switchModelsOnFlag` (`NM1`) | the `switch-models-on-flag` row | gated by Anthropic experiment flags Forge never receives |
| Side question | `/btw`, `side_question` | the `/btw` row | out of scope |
| Ultracode | `ultracode` flag, the `xhigh`+flag mode | any Ultracode option; `ultracode` isn't in Forge's settings whitelist | out of scope |

## Issues that already existed, collected from results 01–05 (not fixed)
From results/01:
1. Composer oracle, 3 structural rows: `div.fg-composer__messageInput` `overflow-x` hidden vs auto;
   `.fg-footer__footerButton span` `display` flex vs block; `.fg-footer__footerButton > svg`
   `min-width`/`min-height` auto vs 0px. **Re-measured: still there.**
2. Whole-page oracle, empty state: logo size (Forge wordmark), `fg-tip__container svg`
   `flex-shrink`, `fg-emptystate__terminalBannerContainer` position/z-index. **Still there**, plus a new
   `div.fg-chat__emptyState` `opacity` row.
3. `?page=settings` at 460px: the "General" heading overlaps the User / Workspace / Local tabs. **Still there** (screenshot).
4. `?page=sessions`: the relative time shows "刚刚" instead of the official `now`. **Still there.**

From results/02:

5. A send while a turn is running is dropped (`ChatPage` returns when busy, with no `queueMessage`). **Reproduced.**
6. Shift+Tab in the "/" filter cycles the permission mode through ChatPage's capture-phase keybinding. **Reproduced** (R4).
7. The filter ranking is Forge's own; the official uses Fuse (`o65`).
8. The composer's inline `/` completion is a separate Forge dropdown; the official reuses `TV0` with `hasSlashQuery`.

From results/03:

9. ~~ThinkingBlock labels~~: **resolved by the merge** (`rf1` port: "Thinking...", "Thinking", "Thought for Ns").
10. The empty state still carries Ultracode (`utils/announcements.ts`, `welcome/WelcomeCard.vue`), and
    `forge/effort.ts` `EFFORT_LEVELS` still ends in `ultracode` (the slider notch). Ultracode is out of scope.
11. ChatPage's row-count watcher scrolls to the bottom on every new row, even when the user has scrolled up
    (the official only does that within 50px). **Reproduced** (T12 variant, traced to `scrollIntoView({block:'end'})`).
12. ~~The dot stayed `dotProgress` after stop~~: fixed in step 04.

From results/04:

13. Tool rows inside assistant messages: `Read` rows are now **0 structural** (merge). `Bash` rows have 9
    structural rows from the Pajamas shell terminal (`term`, `fg-bashtool__inputRow`). That looks like
    intended Forge styling from the merge, but `CLAUDE.md` rule 4 would flag it; the user should decide.
14. `h3.fg-chat__screenReaderTurnHeading` differs in a whole-turn oracle (visually hidden vs static). Not re-run.

From results/05:

15. `CLAUDE.md` rule 4 still says header icons must be the official glyphs; the user's `d496deb` glyphs need
    an exception written down.
16. The glyphs match Lucide's `history` and `square-pen` (ISC licence: keep the notice).
17. The sessions dropdown was only measured with an empty session list.

New in this checkpoint:

18. **Mock-host gap:** `set_permission_mode` is answered by the generic ack (no `success`), so the webview
    reverts the mode label in the harness. The real dispatcher returns `success: true`. B2 says the mock
    should answer with the real response shape; that belongs with step 18 (`persist_session_permission_mode`) or a harness fix.
19. **Prompt vs repo:** the batch prompt says `CLAUDE.md`, `pnpm-lock.yaml` and `.claude\` are gitignored and
    live under `…\Music\Claudix\…`. Since `a74df01` they are tracked on `forge/backend-wiring`, and the
    Claudix path doesn't exist (the checkout is `…\Music\Forge\`). Nothing was copied; the tracked files were used.

## VS Code checklist for the user (unverified: the agent can't observe VS Code)
Step 01:
1. Open Forge in the sidebar at about 460px wide. **Expected:** the chat fills the whole panel width, with no empty band on the right.
2. Open past conversations (the clock icon) at ~460px and at ~320px. **Expected:** the dropdown sits under the header, 16px from both edges, fully visible.

Step 02:

3. Open "/" without typing. **Expected:** no "Slash Commands" section.
4. Type `/`. **Expected:** a "Slash Commands" section with your CLI's commands in alphabetical order, without `/context` or `/usage`.
5. Click `/init`. **Expected:** the menu closes, `/init` is sent and runs in the transcript, and your draft stays in the composer.
6. Open "/", type `init`, press Tab. **Expected:** nothing is sent; the composer holds `/init ` with the caret at the end.
7. If two plugins define the same command name. **Expected:** one row shows as `/<plugin>:<name>`.

Step 03:

8. Ask for a long answer with a code block and a table. **Expected:** text streams paragraph by paragraph; no half-written fence or table appears; the full block and table render once they finish.
9. While it streams, stay at the bottom. **Expected:** the view follows. Scroll up mid-stream. **Expected:** the view stays put. (Known issue 11: if you scroll up *before* the reply's first row appears, it can still jump down.)
10. Ask something that reads a file. **Expected:** the Read row appears only once its input is complete, then shows its result.
11. With thinking on, send a prompt. **Expected:** "Thinking..." while it streams, then a collapsed "Thought for Ns" or "Thinking" row.
12. Reload the conversation from history. **Expected:** the same transcript, with no duplicated or missing rows.

Step 04:

13. Ask Claude to run a shell command. **Expected:** the Bash row's dot blinks while it runs, then turns green.
14. Ask it to read a file that doesn't exist. **Expected:** that row's dot is red.
15. Ask a plain question with no tools. **Expected:** the grey dot, with no colour and no blink.
16. Start a tool that needs permission and stop the turn. **Expected:** after the turn ends, that row's dot is red, not blinking.
17. Reopen an older conversation. **Expected:** completed tools are green or red, text replies grey; nothing blinks.

Step 05:

18. Look at the panel header. **Expected:** New session (pen in a square), then Session history (clock).
