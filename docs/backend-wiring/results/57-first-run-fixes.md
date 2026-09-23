# 57: first run, the welcome gate, the sessions list and the "/" menu

Reported from a fresh install in a Linux dev container (screenshots on
2026-09-23): "Set up an endpoint" did nothing, closing and reopening the panel
showed the chat with no endpoint, "Past conversations" said "Loading
conversations…" forever, the line under the hammer never changed, and the "/"
menu's rows did nothing. Then, in the same session: the welcome page redesigned
in the Pajamas palette on the Anthropic design language, transitions on
everything that opens and closes, the composer controls and Settings made
premium, and creating skills, agents and MCP servers made simple.

## Root causes, one line each

| # | Symptom | Root cause | Fix |
| --- | --- | --- | --- |
| 1 | "Set up an endpoint" does nothing; sessions load forever; a reopened panel shows the chat | The host's message loop awaited `launch_claude` inside one try/catch, so the first failed CLI launch (no linux-x64 binary in a win32 build) ended the loop and no request from any webview was ever answered again | `readFromClient` dispatches every message in its own try/catch; per-channel work runs on its own queue (`onChannel`), so one channel never blocks another or a request |
| 2 | The chat shows with no endpoint whenever the handshake is late | The gate read the endpoint count through the active session, and read "not known" as "no gate" | It reads the transport's `config` directly, and "not known" falls back to the last live answer, else no endpoint (`resolveHasEndpoints`) |
| 3 | After setup the page stays on the welcome until a reload | Nothing told the webview; `init` was the only carrier of `endpointProfileCount`, and the webview's `update_state` receiver copied nine fields by hand, dropping it | The host pushes `update_state` (the official `pushStateUpdate`) on any endpoint-setting change, state first and model config after; the receiver spreads the whole state |
| 4 | The first message after setup says "Not logged in" | The chat pre-launches its CLI at mount, before any endpoint exists, and that process kept its original environment | Endpoint changes close channels that never carried a message; a launch that raced a change is replaced when it lands (`endpointGeneration`) |
| 5 | The add flow looks dead for seconds after the click | It probed five local ports behind a status-bar spinner before showing anything, with a 15s timeout the probe profile's 1.5s never reached | The picker opens on the click, busy, and fills in per runtime (`startPicker.ts`); probes go straight to loopback, bounded to 1.5s |
| 6 | All five runtimes listed as "running now, 0 models" on a machine running none | Node's happy-eyeballs `localhost` connect throws an `AggregateError` whose `message` is `""`; stored as `error: ''` it read as success | `describeRequestError` never returns empty; the probe tests `error !== undefined` |
| 7 | Pushes never reach editor tabs or the sessions view | Untargeted messages went to the side-bar chat only, including a channel's own stream | Channel traffic is stamped with the webview that launched it; state pushes go to every page (`isStatePush`) |
| 8 | Replies to a re-resolved side-bar view get lost | Disposing the old webview deleted the routing id the new one had just registered, and primary/secondary chat shared one id | `removeWebview` deletes only its own mapping; side-bar ids include the view type |
| 9 | "Past conversations" lists an unsaved draft as "New Conversation · now" | Every runtime created a draft session, including the standalone sessions view's, which also launched a CLI for it | The sessions view starts no draft; the list shows only conversations with an id or content |
| 10 | A failed list read looks like "no conversations" | The host answered a failure with an empty list | It answers `{ sessions: [], error }`; the list shows "Couldn't load conversations." with Retry; an unanswered read times out after 15s |
| 11 | New or deleted conversations do not appear | Nothing re-read the list | The official `session_store_changed` push, sent when a transcript appears or disappears in the project store and after each turn; the store re-lists (`listSessionsAfterInFlight`) and drops rows whose file went |
| 12 | The line under the hammer never changes | The first-run rule held the opening tip until a message had ever been sent, and there is no send without an endpoint | New Conversation rotates the existing tips and cards regardless of first run, never repeating the last |
| 13 | New Conversation keeps the old draft | Only the conversation was replaced | `createNew` clears the input and attachments and bumps the empty-state key on every path |
| 14 | "/" menu rows appear dead | Every host-backed row sat behind the stopped loop (#1) | Fixed by #1; every row clicked in the harness and the host-backed ones in real VS Code |
| 15 | "/" rows that open Settings stay on the first tab | The host posted `select_settings_tab` without the `from-extension` envelope, so the webview dropped it (the spec asserted the bare shape) | Posted in the envelope; the spec now requires it |
| 16 | Settings crowd text against controls | `SettingsCell`'s gap was commented out | 24px column gap, a 62ch measure for prose, controls centred; premium buttons and accent switches; an icon rail below 600px |

## Report

Harness on the final build (`?endpoints=1&health=mixed` unless noted), and
real VS Code 1.138 on an isolated, freshly installed profile (empty
globalState, SecretStorage and `~/.claude`), driven over CDP. The stub model
server on :11434 stands in for Ollama.

| row | request | host result | UI effect | verdict |
| --- | --- | --- | --- | --- |
| Set up an endpoint (fresh install) | `run_endpoint_action add` | picker on screen in 47-78ms, busy, runtimes fill in | button "Setting up your endpoint…" + hint | works (real VS Code) |
| Only the running runtime is detected | local probes | "Found 1 model server running here" | stub listed, four "not detected" | works (real VS Code) |
| Save endpoint | config write | `update_state` pushed | welcome → chat without reload | works (real VS Code) |
| First message after setup | `launch_claude` + `io_message` | idle channels recycled, relaunch on the relay | "Hello from the stub." | works (real VS Code) |
| Reload with no endpoint | `init` | `endpointProfileCount: 0` | welcome | works (real VS Code) |
| Reload with an endpoint | `init` | `endpointProfileCount: 1` | chat, no welcome flash | works (real VS Code) |
| Remove the endpoint by hand | config change | state pushed at once, config after | welcome returns | works (real VS Code) |
| Past conversations, no history | `list_sessions_request` | `sessions: []` | "No conversations yet" + Start a conversation | works (real VS Code) |
| Past conversations, a new conversation | `session_store_changed` | re-list after the turn | row appears in 3s | works (real VS Code) |
| Past conversations, read fails | `list_sessions_request` | `{ sessions: [], error }` | error + Retry; Retry recovers | works (harness) |
| Past conversations, file deleted | `session_store_changed` | re-list | row leaves | works (harness; watcher in spec) |
| New Conversation × 4 | none | none | tip / card changes each time, input cleared | works (real VS Code) |
| "/" Attach file… | none | none | file picker, menu closes | works (harness) |
| "/" Mention file… | `list_files_request` | files | `@` inserted, mention menu open | works (harness; ↑↓ Enter too) |
| "/" Rewind | none | none | Rewind dialog | works (harness) |
| "/" Clear conversation | none | none | new empty state, new tip, input cleared | works (harness) |
| "/" New conversation (filter) | `new_conversation_tab` | answered | new tab | works (harness) |
| "/" Resume conversation (filter) | `list_sessions_request` | list | sessions dropdown | works (harness) |
| "/" Switch model… | none | none | model menu | works (harness) |
| "/" Effort | `apply_settings {effortLevel}` | applied | pill updates, menu stays open | works (harness) |
| "/" Thinking | `set_thinking_level` | `off -> {"type":"disabled"}` on the channel | toggle flips, menu stays open | works (real VS Code host log + harness) |
| "/" Toggle fast mode (Opus) | `open_claude_in_terminal /fast @bottom` | answered | terminal | works (harness) |
| "/" Output styles | `get_output_style` | styles | picker | works (harness) |
| "/" MCP servers, Hooks, Manage plugins, Endpoints, Slash commands | `open_forge_settings(tab)` | panel opened / tab pushed | the named tab, every time | works (real VS Code) |
| "/" Permissions | `list_permission_rules` | rules | Permission rules dialog | works (harness) |
| "/" Open Forge in Terminal | `open_claude_in_terminal @bottom` | terminal "Forge" | terminal | works (real VS Code) |
| "/" Focus view | `set_focus_view` | persisted | toggle, menu stays open | works (harness) |
| "/" General config… | `open_config` | settings editor filtered to `forge` | editor | works (real VS Code) |
| "/" View help docs | `open_help` | URL opened | none | works (harness) |
| "/" Slash command `/compact` | `io_message` | sent | menu closes | works (harness) |
| Settings Skills: Create skill | `run_forge_action create-skill` | three prompts, `.claude/skills/release-notes/SKILL.md` written and opened | list refreshes with a Project row | works (real VS Code) |
| Settings Agents: Create agent | `run_forge_action create-agent` | four prompts, `.claude/agents/code-reviewer.md` with `tools: Read, Grep, Glob` | list refreshes | works (real VS Code) |
| Settings MCP: Add server | `run_forge_action add-mcp-server` | four prompts, `.mcp.json` gains `mcpServers.memory` (project scope; the private scopes go through `claude mcp add-json`, spec only) | status re-probed | works (real VS Code, project scope) |

Also verified in the isolated VS Code: Settings rows switch an already-open
panel's tab every time; the sessions view's + opens a new conversation in the
chat; Settings folds its sidebar to an icon rail below 600px.

Parity (`probe-oracle.js`, harness): `.fg-commandmenu__menuPopup` 93/93 clean,
0 structural; `.fg-shell__header` 15/15 clean; `.fg-footer__inputFooter` 23/26
clean with 1 structural row, the send icon's spark opacity (existing divergence,
2026-09-19). The welcome page is a documented redesign (#20).

Left out, as the official leaves out what its host cannot serve: Account &
usage, Switch account, Remote Control, Report a problem, flagged-message model
switching (all out of scope in `CLAUDE.md`).

## Checklist for your VS Code

Unverified by the agent unless marked. Install the VSIX from this commit.

1. Fresh profile, no endpoint: open Forge. **Expect** the welcome page (verified in an isolated VS Code).
2. Click **Set up an endpoint**. **Expect** the "Add endpoint" picker at once, "checking…" rows, the button reading "Setting up your endpoint…" (verified).
3. Finish the flow and choose **Use it now**. **Expect** the chat page without a reload, and a first message answered by your endpoint (verified with a stub on :11434).
4. In the Linux dev container: open Forge there. **Expect** the welcome page's button, the sessions list and a reopened panel all to answer even though the CLI cannot launch there; a message then shows the launch error instead of nothing (unverified: needs the container; the loop behaviour is covered by `hostMessageLoop.spec.ts`).
5. Settings → Skills → **Create skill**, name `release-notes`, one sentence, This project. **Expect** `.claude/skills/release-notes/SKILL.md` created and opened, and the row in the list (verified in an isolated VS Code).
6. Settings → Agents → **Create agent**, Read-only, This project. **Expect** `.claude/agents/<name>.md` with a `tools: Read, Grep, Glob` line (verified in an isolated VS Code).
7. Settings → MCP Servers → **Add server**, Local command, `npx -y @modelcontextprotocol/server-memory`, This project, shared. **Expect** `.mcp.json` with `mcpServers.memory` (verified in an isolated VS Code). Then repeat with **Just me** or **All my projects**. **Expect** the server in `claude mcp list` (unverified: that path runs the CLI's `mcp add-json`).
8. Close the Forge panel and reopen it, then reload the window, with and without an endpoint. **Expect** welcome without, chat with (reload verified).
9. Welcome page, click **$ forge** in the card. **Expect** a terminal named Forge running the CLI (verified in an isolated VS Code).
