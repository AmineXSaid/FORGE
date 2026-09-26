# Production audit, Phase 3: every surface and row, clicked in the harness

`node .claude/skills/ui-parity/scripts/drive-all.mjs --port 8771` drives the
real built webview (`dist/media`, byte-compared with what the harness served)
against the stub host, in headless Chromium, with real mouse and key input.
For each row it reads what was sent (`__forgeSent`), whether the stub answered
with a real handler or its empty fallback (`__forgeFallbacks`, new), and what
the page did. Each window is measured with `probe-oracle.js` against the
official `index.css` (2.1.270), and its structural rows are compared with
`.claude/skills/ui-parity/baselines/oracle.json`; a new row fails the run.
`drive-health.mjs` runs beside it.

This proves the webview <-> host contract. Nothing here reached a real CLI.

## Rows

| Surface | Row | Sent | Host answer | UI effect | Verdict |
| --- | --- | --- | --- | --- | --- |
| "/" menu | rows and sections | — |  | 18 rows; sections Context, Model, Customize, Settings, Support | PASS |
| "/" menu | Attach file… | (none) | real | file chooser opened; menu closes | PASS |
| "/" menu | Mention file from this project… | list_files_request | real | "@" inserted in the composer; menu closes | PASS |
| "/" menu | Rewind | (none) | real | rewind picker open; menu closes | PASS |
| "/" menu | Clear conversation | launch_claude | real | empty state (in place); menu closes | PASS |
| "/" menu | Switch model… | (none) | real | model menu open; menu stays open | PASS |
| "/" menu | Effort | apply_settings | real | menu stays open | PASS |
| "/" menu | Thinking | set_thinking_level | real | menu stays open | PASS |
| "/" menu | Toggle fast mode |  |  | not registered for this model (as the official) | LEFT OUT |
| "/" menu | Output styles | get_output_style | real | output style picker open; menu closes | PASS |
| "/" menu | MCP servers | open_forge_settings{tab:mcp-servers} | real | menu closes | PASS |
| "/" menu | Hooks | open_forge_settings{tab:hooks} | real | menu closes | PASS |
| "/" menu | Permissions | list_permission_rules | real | permission rules dialog open; menu closes | PASS |
| "/" menu | Endpoints | open_forge_settings{tab:endpoints} | real | menu closes | PASS |
| "/" menu | Slash commands | open_forge_settings{tab:slash-commands} | real | menu closes | PASS |
| "/" menu | Manage plugins | open_forge_settings{tab:plugins} | real | menu closes | PASS |
| "/" menu | Open Forge in Terminal | open_claude_in_terminal | real | menu closes | PASS |
| "/" menu | Focus view | set_focus_view | real | menu stays open | PASS |
| "/" menu | General config… | open_config | real | menu closes | PASS |
| "/" menu | View help docs | open_help | real | menu closes | PASS |
| "/" menu | New conversation (filter only) | launch_claude | real | side bar: starts over in place, no new tab; hidden until typed: yes | PASS |
| "/" menu | Resume conversation (filter only) | list_sessions_request | real | past conversations dropdown open; hidden until typed: yes | PASS |
| "/" menu | CLI command /compact | io_message |  | sent as a message | PASS |
| "+" menu | Upload from computer | (none) | real | file chooser opened; menu closes | PASS |
| "+" menu | Add context | list_files_request | real | "@" inserted; menu closes | PASS |
| "+" menu | Browse the web | list_files_request | real | "@browser:" inserted; menu closes | PASS |
| "+" menu | rows | — |  | Upload from computer / Add context / Browse the web | PASS |
| "+" menu | Browse the web without browser support | — |  | Upload from computer / Add context | PASS |
| mode menu | rows | — |  | Manual / Edit automatically / Plan / Bypass permissions | PASS |
| mode menu | Manual | set_permission_mode{mode:default} | real | footer shows "Manual" | PASS |
| mode menu | Edit automatically | set_permission_mode{mode:acceptEdits} | real | footer shows "Edit automatically" | PASS |
| mode menu | Plan | set_permission_mode{mode:plan} | real | footer shows "Plan" | PASS |
| mode menu | Bypass permissions | enable_bypass_permissions | real | footer shows "Bypass permissions" | PASS |
| model menu | rows | — |  | 4 pairs: auto / claude-opus-5MaxUltracodeFast / qwen3-coder / llama-3.3-70b | PASS |
| model menu | auto | set_model | real | pill shows "auto" | PASS |
| model menu | claude-opus-5MaxUltracodeFast | set_model | real | pill shows "claude-opus-5" | PASS |
| model menu | qwen3-coder | set_model | real | pill shows "qwen3-coder" | PASS |
| "/" menu | Toggle fast mode (claude-opus-5) | open_claude_in_terminal | real | claude /fast in the bottom terminal | PASS |
| sessions dropdown | list | list_sessions_request |  | 4 conversations | PASS |
| sessions dropdown | search "tidy" | — |  | Session B: tidy the docs | PASS |
| sessions dropdown | search "docs/tidy" | — |  | Session B: tidy the docs | PASS |
| sessions dropdown | Mark as | set_session_unread | real |  | PASS |
| sessions dropdown | Archive session | archive_session | real |  | PASS |
| sessions dropdown | Rename session | rename_session | real | title "Renamed by the harness" | PASS |
| sessions dropdown | open a conversation | get_session_request, launch_claude | real | 1 turn(s) shown; dropdown closed | PASS |
| message actions | options | — |  | Fork conversation from here / Rewind code to here / Fork conversation and rewind code | PASS |
| message actions | Fork conversation from here | fork_conversation, list_sessions_request, get_session_request, launch_claude | real | the fork opens | PASS |
| message actions | Rewind code to here | rewind_code, rewind_code | real | dry run, confirm, rewind; confirmation answered; dryRun true,false | PASS |
| message actions | Fork conversation and rewind code | rewind_code, rewind_code, fork_conversation, list_sessions_request, get_session_request, launch_claude | real | dry run, confirm, rewind, then fork; confirmation answered; dryRun true,false | PASS |
| message actions | Rewind with no code changes | rewind_code |  | 1Rewind disabled: "The code has not changed, so no code will be restored. Rewinding does not affect" | PASS |
| message actions | Fork from the first message | launch_claude |  | new conversation, composer: "Is this the same chatbox as the Claude C" | PASS |
| permission prompt | option 1 (Yes) | response:tool_permission_response | allow | buttons: 1 Yes \| 2 Yes, allow pnpm run build for this project (just you) \| 3 No; prompt closed | PASS |
| permission prompt | option 2 (Yes, and don’t ask again…) | response:tool_permission_response | allow + 1 rule(s) | buttons: 1 Yes \| 2 Yes, allow pnpm run build for this project (just you) \| 3 No; prompt closed | PASS |
| permission prompt | option 3 (No) | response:tool_permission_response | deny | buttons: 1 Yes \| 2 Yes, allow pnpm run build for this project (just you) \| 3 No; prompt closed | PASS |
| chat | error banner: View output logs | open_output_panel | real | banner shown on close_channel {error} | PASS |
| chat | error banner: dismiss | — |  | dismissed | PASS |
| chat | header, composer and transcript render | — |  | 2 turns | PASS |
| welcome | no endpoint | — |  | welcome with Set up an endpoint | PASS |
| welcome | endpoints never checked | — |  | welcome with Set up an endpoint / Check health | PASS |
| welcome | nothing answered | — |  | welcome with Set up an endpoint / Check health / Skip to chat | PASS |
| welcome | some answered | — |  | chat (no welcome) | PASS |
| sessions page | list | list_sessions_request |  | 2 rows; groups: Today2 | PASS |
| sessions page | search |  |  | this page has no search box yet (the official KW0 list is Phase 6); search is the dropdown's rows above | LEFT OUT |
| sessions page | open a conversation | reveal_chat | real | reveal_chat {sessionId:aaaaaaaa…, fromView:true} | PASS |
| sessions page | empty | list_sessions_request |  | No conversations yet | PASS |
| sessions page | list error | list_sessions_request |  | Couldn’t load conversations. EACCES: permission denied Retry | PASS |
| sessions page | list error: Retry | list_sessions_request |  | retried | PASS |
| settings | general | get_settings, sdk_probe, get_extension_config | real | General | PASS |
| settings | models | get_settings, sdk_probe, get_extension_config | real | Models | PASS |
| settings | profiles | get_settings, sdk_probe | real | Profiles | PASS |
| settings | plugins | get_settings, sdk_probe, list_plugins, list_marketplaces | real | Plugins | PASS |
| settings | environments | get_settings, sdk_probe | real | Environments | PASS |
| settings | memory-and-rules | get_settings, sdk_probe | real | Memory and Rules | PASS |
| settings | permissions | get_settings, sdk_probe | real | Permissions | PASS |
| settings | sandbox | get_settings, sdk_probe | real | Sandbox | PASS |
| settings | network | get_settings, sdk_probe | real | Network | PASS |
| settings | hooks | get_settings, sdk_probe | real | Hooks | PASS |
| settings | skills | get_settings, sdk_probe, list_forge_items | real | Skills | PASS |
| settings | agents | get_settings, sdk_probe, list_forge_items | real | Agents | PASS |
| settings | mcp-servers | get_settings, sdk_probe | real | MCP Servers | PASS |
| settings | slash-commands | get_settings, sdk_probe, list_forge_items | real | Slash Commands | PASS |
| settings | endpoints | get_settings, sdk_probe, get_endpoint_health | real | Endpoints | PASS |
| plan preview | page | — |  | probe-planpreview: {"checked":29,"clean":29,"structural":0} | PASS |

**Counts:** PASS 81 · FAIL 0 · LEFT OUT 2

`drive-health.mjs`: **22/22** (it was 18/22: four clicks landed below the
fold of a 1000px page; the script now scrolls its targets into view).

**Left out, with reasons:** "Toggle fast mode" for the models without fast mode
(the official registers it only for those; it passes for `claude-opus-5`), and
search on the side-bar "Past conversations" page, which has no search box yet
(the official `KW0` list is Phase 6; search is proven on the dropdown).

## Windows (probe-oracle)

| Window | Root | Checked | Clean | Structural | New vs baseline | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| "/" menu (open) | `.fg-commandmenu__menuPopup` | 93 | 93 | 0 | — | PASS |
| "+" menu | `.fg-addmenu__menuPopup` | 16 | 16 | 0 | — | PASS |
| mode menu | `.fg-menu__menuPopup` | 41 | 41 | 0 | — | PASS |
| model menu (chips set aside) | `.fg-commandmenu__menuPopup` | 50 | 42 | 4 | — | PASS |
| sessions dropdown | `.fg-sessionsdropdown__dropdown` | 57 | 57 | 0 | — | PASS |
| message actions | `.fg-messageactions__popup` | 7 | 7 | 0 | — | PASS |
| rewind dialog (Rewind code to here) | `.fg-dialog__overlay` | 20 | 20 | 0 | — | PASS |
| rewind dialog (Fork conversation and rewind code) | `.fg-dialog__overlay` | 16 | 16 | 0 | — | PASS |
| permission prompt (input shown) | `.fg-permission__permissionRequestContainer` | 30 | 30 | 0 | — | PASS |
| error banner | `.fg-chat__errorBanner` | 6 | 6 | 0 | — | PASS |
| header | `.fg-shell__header` | 15 | 15 | 0 | — | PASS |
| composer (idle) | `.fg-composer__inputWrapper` | 42 | 39 | 1 | — | PASS |
| transcript | `.fg-chat__messagesContainer` | 48 | 34 | 8 | — | PASS |
| welcome: no endpoint | `.fg-welcome__container` | 43 | 8 | 26 | — | PASS |
| welcome: endpoints never checked | `.fg-welcome__container` | 49 | 8 | 30 | — | PASS |
| welcome: nothing answered | `.fg-welcome__container` | 52 | 8 | 30 | — | PASS |
| sessions page (list) | `.fg-sessions__root` | 39 | 39 | 0 | — | PASS |

Every structural row left is a documented divergence, and the baseline holds
exactly these:

- **model menu (4):** the chips (set aside, but their spans travel with the
  clone) and the current model's name at weight 600, as the 2026-09-19 baseline
  records.
- **composer (1):** the send icon at 0.35 opacity while Send is disabled
  (2026-09-19 baseline).
- **transcript (8):** the working indicator, the voxel cube (`ForgeCube.vue`),
  in place of the official glyph: its canvas and hidden colour probes, and a
  spinner row 24.6px tall where the official's is 31px. Recorded now as #46 in
  `docs/forge-design.md`; **the row height is a question for you** (it moves
  the transcript's last line by 6.4px).
- **welcome (26 / 30 / 30):** the page's Forge-only hierarchy (#17, #20, #36);
  the no-endpoint state matches the 2026-09-24 measurement (43 checked, 26
  structural against 27 then).

## Found and fixed in this pass

1. **A fork from the first message lost its prompt.** The chat consumed
   `initialPrompt` in a `watch` that read the alien-signals signal directly,
   which Vue cannot track, so a prompt set after the new session went active
   never reached the composer. It now reads `useSession`'s ref
   (`test/initialPrompt.spec.ts`; the row passes).
2. **The sessions dropdown held an identity transform** after its entrance
   (`animation-fill-mode: both`): a structural diff, and a containing block
   for anything fixed inside it. `backwards` plays the same entrance and ends
   on `transform: none`; the dropdown is now 57/57 clean.
3. **The harness itself:** `cdp-driver.mjs` finds Chromium on Linux
   (`FORGE_CHROME`, Playwright's browsers) and runs as root; `drive-health.mjs`
   scrolls before it clicks; the mock host records fallback answers, takes
   `?editorTab` for a chat in an editor tab (`?tab` was already the Settings
   tab), and the permission prompt is measured with its input shown (inside a
   closed `<details>` the `<pre>` measures 0px live and its width in the
   oracle's clone, a measuring difference, not a style one: open, 30/30 clean).

## probe-coverage

| State (probe-coverage) | Official classes rendered | Not rendered in this state |
| --- | --- | --- |
| chat with a transcript | 58 | 478 |
| "/" menu open | 80 | 456 |
| permission prompt up | 73 | 463 |

Informational: most of the official classes belong to states these three do not
reach (settings dialogs, onboarding, the out-of-scope account and usage
surfaces).
