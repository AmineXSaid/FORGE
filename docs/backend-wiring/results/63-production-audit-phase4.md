# Production audit, Phase 4: the extension end to end

The kit is `.claude/skills/ui-parity/e2e/` (see its `README.md`). It
installs a VSIX into an isolated VS Code and drives it over the Chrome
DevTools Protocol with real mouse and key input: the real bundled Claude Code
CLI (2.1.274), Forge's relay, and a gateway. Each scenario checks its evidence
where it lands (settings files, the session `.jsonl`, files on disk, the
gateway's request log, CLI processes), not only in the UI.

**Where it ran.** This container has no Windows, no VS Code desktop and no
route to the user's gateway (`localhost:20128`). So the run here is:

- code-server 4.105.1, which is VS Code 1.105.1 (workbench, extension host,
  webviews) served to headless Chromium, on **linux-x64**;
- the Linux VSIX (`vsce package --target linux-x64`, the same sources as the
  Windows one);
- the kit's stub gateway (OpenAI wire, `qwen3-coder`), not omniroute.

It proves behaviour on Linux against a stub. Every Windows or real-gateway
claim is in the checklist below, marked unverified until the user runs it.

The host starts with an environment rebuilt from system variables only. The
first exploratory run inherited this container's own credentials, and the CLI
used them to reach api.anthropic.com. From the kit's first real run on, no
credential reaches the CLI except the one named by `--auth-env`.

## Results (run 4, fresh install, final build)

**pass 18 · partial 1 · fail 0 · unverified 0 · skipped 0**

The official request-level columns (row | request | host result | UI effect) are Phase 3's table; here each row is a scenario and its evidence.

| # | Scenario | Evidence | Verdict |
| --- | --- | --- | --- |
| 1 | Install and activate: Forge never writes ~/.claude/settings.json | chat opened (webview d60eb861-ffe5-47af-939d-5f605201c538); ~/.claude/settings.json absent after activation; Forge's own flag layer present: ~/.claude/forge.json (attribution, skipWebFetchPreflight, env) | pass |
| 2 | First message: a streamed reply from the endpoint, recorded in the session .jsonl | sent "hello from e2e 1790270987239"; assistant row shows the stub reply; gateway saw 1 request(s), model ids: qwen3-coder, streamed: true; session file: .claude/projects/-tmp-fe2e10-workspace/31c4ebf4-6630-4bf1-b52f-1f6b06169b57.jsonl; ~/.claude/settings.json still absent after the first turn | pass |
| 3 | History and resume: a second conversation, the list, reopening the first, continuing it in the same file | new session, replied: "second conversation 1790270989266"; history lists 2 conversation(s), both present; reopened the first conversation from the list: its transcript is shown; the follow-up was appended to the same file (31c4ebf4-6630-4bf1-b52f-1f6b06169b57.jsonl); the gateway got the resumed history: 6 messages in the last request | pass |
| 4 | The slash list: the real CLI's commands in the "/" menu, and one run end to end | 40 slash commands from the CLI (e.g. /__remote-workflow /agents /auto-mode-setup /autocompact /batch /claude-api); no out-of-scope row (/feedback /bug /btw /remote-control /login /logout); "/compact" + Enter picks /compact (exact name ranks first); sent "/compact"; the CLI wrote a compact_boundary to 771c9874-c328-4c85-8440-87f95010c4a6.jsonl; "/claude-api" keeps the product name: "Reference for the Claude API / Anthropic SDK — mod" | pass |
| 5 | Editor selection: <ide_selection> reaches the CLI and the session .jsonl | composer shows: "qwen3-coder High 1 line selected Manual"; 3cd8104e-2b17-40b6-9abe-70234183f2a6.jsonl holds <ide_selection> with "line two"; the gateway received the selected text | pass |
| 6 | Permission prompt option 2 writes its rule; Plan mode presents the plan and approving it leaves Plan | prompt options: 1 Yes \| 2 Yes, allow touch /tmp/fe2e10… for this project (just you) \| 3 No; .claude/settings.local.json permissions.allow: ["Bash(touch /tmp/fe2e10/workspace/e2e-perm-1790271003100.txt)"]; the command ran: e2e-perm-1790271003100.txt exists; plan prompt: 1 Yes, and auto-accept \| 2 Yes, and manually approve edits \| 3 No, keep planning; approved: mode is now "Edit automatically" | pass |
| 7 | Effort and thinking: saved where the official saves them, and each reaches the gateway | effort "high", thinking on: the gateway got reasoning_effort "high"; the transcript shows the thinking block; thinking off: the gateway got reasoning_effort "low" (was "high"); ~/.claude/settings.json effortLevel: "low" (the official userSettings layer); effort "low": the gateway got reasoning_effort "low" | pass |
| 8 | Rewind changes files on disk; fork continues in a new session file | the model wrote rewind-1790271025405.txt ("v1"); dry-run dialog: "1 line will be removed and 0 lines will be added across 1 file: rewind-1790271025405.txt Rewinding does not affect files"; rewound: rewind-1790271025405.txt is gone from disk; fork: the composer holds the forked message ("write /tmp/fe2e10/workspace/rewind-1790271025405.t…"); forked: "after fork 1790271030558" went to a new file 10841fe0-2f77-4506-a971-9892420f9d88.jsonl; the original is untouched | pass |
| 9 | Rename, archive, mark unread: written where the official writes them, and still so after a reload | renamed: 9dd216f5-0d57-4712-bea4-c6ad97c0b5ba.jsonl gained a "custom-title" entry "E2E renamed 1790271036676"; marked unread: the row's status dot is "unread"; archived: the row left the list; after a window reload: the new title, the archive and the unread dot all held | pass |
| 10 | A message sent mid-turn, then Stop: the turn ends and the interrupt is recorded | the mid-turn message is shown while the turn runs; Stop: the turn ended 657 ms after the click; 3f3fb2e3-5844-4715-a844-f980fed1e912.jsonl records the interrupt; the mid-turn message was sent to the gateway after the stop | pass |
| 11 | Output styles, forge:Expert included: saved to the local layer and applied to the system prompt | chose Explanatory: .claude/settings.local.json outputStyle = "Explanatory"; the gateway's system prompt carries the Explanatory text ("Insight"); chose forge:Expert: .claude/settings.local.json outputStyle = "forge:Expert"; the gateway's system prompt carries the forge:Expert text ("master teacher") | pass |
| 12 | Settings page: each layer writes its own file | User: language "e2e-user-1790271063616" -> home/.claude/settings.json; Workspace: language "e2e-workspace-1790271063616" -> workspace/.claude/settings.json; Local: language "e2e-local-1790271063616" -> workspace/.claude/settings.local.json; each layer kept its own value (no write crossed layers) | pass |
| 13 | Keybindings: Ctrl+Esc focus and blur, Alt+K mention, Ctrl+Shift+Esc new tab, Shift+Tab mode cycle | Ctrl+Esc in the editor: the Forge composer has focus; Ctrl+Esc in Forge: focus is back in the editor; Alt+K with line 2 selected: the composer got "@readme.txt"; Shift+Tab in the composer: "Manual" -> "Edit automatically"; Ctrl+Shift+Esc: a Forge chat opened in an editor tab | pass |
| 14 | Reload: effort, thinking, output style and history survive a window reload | model and effort: "qwen3-coder Low" before and after; thinking: on before and after; history: all 13 saved conversations listed before and after (13 -> 14 rows) | pass |
| 15 | Restricted Mode: Forge stays off until the workspace is trusted, then activates | status bar: Restricted Mode; palette: no Forge command in Restricted Mode (untrustedWorkspaces.supported: false); no Forge webview in Restricted Mode; trusted through the Workspace Trust editor (real click); palette: Forge commands present once trusted | pass |
| 16 | Open in Terminal runs the CLI through the endpoint; the "+" menu and @browser | a terminal named "Forge" opened; the terminal runs the bundled CLI (pid 7554, ANTHROPIC_BASE_URL http://127.0.0.1:46069); "+" menu: Upload from computer / Add context / Browse the web; "Browse the web" is offered (the CLI resolves); the attach itself is unverified here: no Claude in Chrome | partial |
| 17 | Errors: the gateway down, then back; the CLI binary missing | gateway down: after 205s the chat shows "Error: 502 [e2e] could not reach http://127.0.0.1:11434/v1: read ECONNRESET. This is a server-side issue, usually tempor" and the turn is over; gateway back: the next message is answered in the same conversation; binary missing: the banner reads "Forge runs on Windows x64 only. This VS Code is linux-x64, and this build has no Claude Code binary for it. View output logs · Troubleshooti"; binary restored: a new conversation works again | pass |
| 18 | Soak: 20 turns in one conversation | 20/20 turns answered; latency p50 889 ms, max 902 ms (first 898 ms, last 887 ms); the transcript holds all 20 user messages; no [error] line in the Forge output channel during the soak | pass |
| 19 | Soak: open and close Forge tabs and conversations without leaking CLI processes | 6 tabs opened, each answered a message, then closed; CLI processes 4 -> 4 | pass |

Also re-run on the final build: the Phase 3 harness pass (`drive-all.mjs`):
**PASS 81 · FAIL 0 · LEFT OUT 2**, all 17 oracle windows match the baseline;
`drive-health.mjs` 22/22. The mock's seeded transcript now ends each turn with
its `result`, as the CLI does: without it the last turn stayed running and the
transcript window was measured busy or idle depending on load.

## Found by the end-to-end run, and fixed

Each is a real defect in Forge, reproduced in the run, fixed at the source,
pinned by a spec, and re-checked by the scenario.

| # | Defect (how it showed) | Cause | Fix | Spec |
| --- | --- | --- | --- | --- |
| 1 | The first message typed after the chat opened vanished: composer cleared, nothing sent (scenario 2) | The composer works before the first session exists; `handleSubmit` returned early without one | `SessionStore.ensureActiveSession()`, shared by the runtime's first session and a submit that comes first | `firstMessage` |
| 2 | Effort never reached an OpenAI-wire endpoint: no `reasoning_effort` at any level (scenario 7) | CLI 2.1.x sends effort as `output_config.effort` and thinking as `{type:'adaptive'}` or not at all; the relay read only a top-level `effort` or a budget (captured against an Anthropic-shaped server) | Read `output_config.effort`; a named effort without `thinking` is thinking off, which sends the weakest rung, so the Thinking toggle changes the wire | `wireReasoning` |
| 3 | Every closed Forge tab left its CLI running (scenario 19: 6 tabs, 6 processes) | The dispose hook only settled prompts; the official shuts the webview's host down (`closeAllChannels`) | Close the channels the disposed webview opened (`channelOwners`) | `hostRobustness` |
| 4 | Alt+K and "Insert @-Mention Reference" did nothing (scenario 13) | Nothing in the webview subscribed to the mention event | The chat inserts it (the official `insertAtMention(n,false)`: the mention and a space, skipped while a permission prompt is up); a mention sent to a hidden chat is held 15 s (the official `pendingAtMentions`, `JF`) | `channelControl` |
| 5 | Ctrl+Esc in the chat did not return to the editor (scenario 13) | `forge.blur` only blurred the input, and its binding also required `forge.sideBarActive` | The official: `workbench.action.focusFirstEditorGroup`, `when: !editorTextFocus` | `contextKeysAndSettings` |
| 6 | Every conversation left open 6 minutes got "This turn has produced no output" | The watchdog timed a channel's whole life, not its turns | `idle` after a result, `turnStarted` on each message; a notice cancelled by a reload is not an error | `sessionWatchdog` |
| 7 | "/compact" + Enter ran "/autocompact" (scenario 4) | The composer's "/" completion kept the CLI's alphabetical order | The official ranking (`o65`): exact name, prefix, the rest | `slashCompletion` |
| 8 | On Windows x64, a missing binary would read "Unsupported platform: win32-x64" (scenario 17) | The binary resolver's error is `unsupported_platform`; on the supported platform nothing mapped it | "The Claude Code binary is missing from this Forge install. Reinstall the Forge extension." | `chatErrors` |
| 9 | "/claude-api" read "Reference for the **Forge** API" | `forgeVoice` renamed every "Claude" | Only "Claude Code" becomes Forge; Anthropic's products and the model family stay | `forgeVoice` |
| 10 | "Forge: New Conversation Ctrl+N" drawn as text over the chat header | Three `view/title` entries without icons; the official contributes none | Removed; any title-bar entry must have an icon | `packagingTarget` |
| 11 | The activation warning said "this build has no Claude Code binary" in a build that had one | One message for two cases | Activation says the platform is untested; only a failed launch says the binary is missing | `packagingTarget` |

## Observed, not changed

- With the gateway down, the CLI retries the relay's 502 ten times (the
  relay retries each three times), about 3.5 minutes. The chat shows
  "Endpoint error 502. Retrying n/10…" throughout, then the error. The same
  retry policy applies to api.anthropic.com in the official.
- A message sent mid-turn is sent after Stop.
- The slash list carries `/__remote-workflow`: the CLI reports it and the
  official does not filter it either.
- "Bypass permissions" is in the mode menu without the setting: a recorded
  divergence (it asks, then turns the setting on).
- After a `keepMenuOpen` row (a toggle), Escape does not close the "/" menu:
  focus has left the filter, in the official too (`KZ`).

## Harness limits (not Forge)

- code-server in headless Chromium: after Ctrl+Esc is pressed inside any
  webview, the next page reload hangs the renderer. VS Code's own Markdown
  preview does the same (bisected: Ctrl+Esc typed in the editor, F1 or a
  letter typed in the webview, and the palette's blur do not). The
  keybindings scenario runs last.
- The viewport can come back from a reload at another size; the kit
  re-applies it.

## Checklist for the user (Windows, VS Code, omniroute): unverified here

Run the kit: `node .claude/skills/ui-parity/e2e/launch.mjs --code
"%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe" --gateway
http://localhost:20128/v1 --model auto/best-fast [--auth-env OMNIROUTE_KEY]`,
then the same with `--stub` for the scripted scenarios. Expected:

1. Scenario 15: the status bar says Restricted Mode, no "Forge:" command in
   the palette; after Trust, the commands appear.
2. Scenario 1: `<root>\home\.claude\settings.json` does not exist after
   activation; `<root>\home\.claude\forge.json` does.
3. Scenario 2 (omniroute): a reply arrives; omniroute's log shows model
   `auto/best-fast`, never a `claude-*` id; a `.jsonl` under
   `<root>\home\.claude\projects\` holds the prompt.
4. Scenario 7 (`--stub`): `effortLevel` in `settings.json` is the chosen
   level and the stub log's last request has `reasoning_effort` equal to it;
   with Thinking off, `low`.
5. Scenario 8 (`--stub`): the file the model wrote disappears from disk after
   "Rewind code to here".
6. Scenario 13: Ctrl+Esc moves focus editor -> chat -> editor; Alt+K with a
   line selected puts `@readme.txt#L2-2` in the composer; Ctrl+Shift+Esc opens
   a Forge tab.
7. Scenario 16: the "Forge" terminal runs `claude.exe` with
   `ANTHROPIC_BASE_URL` on `127.0.0.1`.
8. Scenario 17 (`--stub`): with the binary renamed, the banner reads "The
   Claude Code binary is missing from this Forge install…".
9. Scenario 19 (`--stub`): the number of `claude.exe` processes after the six
   tabs close is at most one more than before.
10. The window titled `forge-e2e-<id>` closes at the end, and no other VS Code
    window does.
11. `@browser` (Phase 6 item 4): with Claude in Chrome installed, "Browse the
    web" attaches; without it, the reason shows in the chat.

## Gates

- `pnpm test`: 2438 passed, 8 skipped. `pnpm run typecheck:all`: clean.
  `pnpm run lint`: 0 errors, 390 warnings (cap 390). `pnpm run lint:forge`:
  clean. `pnpm run build`: passes.
- Specs added or extended for the fixes: `firstMessage`, `forgeVoice`,
  `slashCompletion` (new); `wireReasoning`, `hostRobustness`,
  `channelControl`, `sessionWatchdog`, `contextKeysAndSettings`,
  `chatErrors`, `packagingTarget`.
