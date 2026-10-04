# Group 6 report: browser and views, and the live rows to finish (steps 28–33)

Checkpoint (step 34), 2026-10-03, on top of `15381c7`. Covers
[28](../28-browser-integration.md) (@browser tabs), [29](../29-output-styles.md) (output styles),
[30](../30-focus-view.md) (Focus view), [31](../31-settings-tabs.md) (Settings tabs),
[32](../32-typed-open-config-help.md) (typed `open_config` / `open_help`) and
[33](../33-remove-report-a-problem.md) (no "Report a problem"). Per-step detail is in the
`28`–`32` files in this folder.

## What this checkpoint could and could not run

Run today, on a linux-x64 cloud container (Node 22.22.0, pnpm 10.28.0, Chromium 1194 driven over
CDP): `pnpm test`, `pnpm run typecheck:all`, `pnpm run build`, and `drive-all.mjs` against the real
built webview and the stub host. The harness was started with `harness.mjs --port 8771`, and the
served `/main.js` was byte-compared with `dist/media/main.js` first (identical, 2,255,618 bytes).

**Not run today, and why:**

| Not run | Why | What it means |
| --- | --- | --- |
| The oracle (`probe-oracle.js`), all 23 windows | It needs the official `webview/index.css`. `../Real_Claude_Code_VSCODE_extension_files/` is not in this container. I tried the two public download hosts once each (`marketplace.visualstudio.com`, `open-vsx.org`); both answered 403 to CONNECT under this session's egress policy, and I did not try to route around that. | **"0 structural diffs" is not claimed for today's tree.** The table below gives the last recorded numbers, dated, and says whether the markup has changed since. |
| 7 specs that read the official bundle (`OFFICIAL_DIR`): `browserIntegration` (1), `chatErrors` (1), `pluginHandlers` (1), `stubsWired` (4) | Same missing bundle. They skip themselves. | The one in this group is the check that Forge's `Oj0` instruction text equals the official text byte for byte. It passed when step 28 ran it; it did not run today. |
| `drive-all.mjs` steps "plan preview" and "coverage" | They read the official bundle's template and stylesheet. | Not part of group 6. |
| 20 live tests (`cliGuardsE2E`, `hermesAgentE2E`, `endpointE2E`, `hookRewriteProbe`) | They need a real CLI (`FORGE_CLI_E2E=1`) or a real gateway (`FORGE_E2E_BASE_URL`, `FORGE_E2E_API_KEY`). | Not part of group 6. |
| Real VS Code, the real CLI against an account, a real Chrome with the Claude in Chrome extension | Not available here. | Everything under "VS Code checklist" is **unverified**. |

## Three things found and changed while running it

None is feature code. Each is a test or harness defect.

1. **`test/bypassGate.spec.ts` failed in this container** (1 of 3,091 tests). This container sets
   `IS_SANDBOX=1` and runs as root. The code under test correctly ports the CLI's rule that root is
   allowed inside a recognised sandbox, and the spec's own first block asserts exactly that. But the case
   "is ignored as root" never controlled the environment, so it passed only where `IS_SANDBOX` was unset.
   Anyone running `pnpm test` in a Dev Container, a CI sandbox or a cloud agent would see the failure.
   **Change:** the describe block now stubs `IS_SANDBOX` and `CLAUDE_CODE_BUBBLEWRAP` out of `process.env`
   in `beforeEach` and restores them in `afterEach` (`vi.stubEnv` / `vi.unstubAllEnvs`). The source is
   unchanged. **Checked:** the spec passes with `IS_SANDBOX=1`, with `IS_SANDBOX=1 CLAUDE_CODE_BUBBLEWRAP=1`,
   and with both unset; it passes next to another spec file (the env is restored); and a negative control
   (`uid === 0` changed to `uid === 99999` in `bypassGate.ts`, then restored with `git checkout`) made 3
   tests fail.
2. **`drive-all.mjs` could not run without the official stylesheet.** The oracle probe throws inside the page
   and the script has no catch, so the whole step that called it, "/" menu included, is abandoned at its first
   oracle call, before any row is clicked. **Change:** by default the script now refuses to start and says
   why (exit 2) when the harness is not serving `/oracle/official.css`. A new explicit `--no-oracle` flag clicks
   every row anyway and reports each oracle window `NOT RUN`, never `PASS`. `--no-oracle` with
   `--write-baseline` is refused, so it cannot overwrite `baselines/oracle.json`. Both refusals were run.
3. **`drive-all.mjs` expected the pre-pause behaviour for the two terminal rows.** On 2026-09-28 (`a846d08`)
   the user paused "Open Forge in Terminal" and "Toggle fast mode": greyed, "(soon)", `aria-disabled`, and
   choosing them does nothing. That commit updated `drive-health.mjs` and the e2e scenarios but not
   `drive-all.mjs`, which still expected a request and a closed menu. Before the fix: `PASS 112 · FAIL 2 ·
   LEFT OUT 1`, the two FAILs being exactly those rows. **Change:** the drive reads each row's `aria-disabled`
   (the signal the e2e scenario uses). A paused row must be greyed, show "(soon)", send nothing and leave the
   menu open, and is then reported `LEFT OUT`, never `PASS`; a live row must launch in the bottom panel.
   After the fix: `PASS 112 · FAIL 0 · LEFT OUT 3`.

## Where the step reports no longer match the code

These are statements in the step files that later commits changed. They are carried below, marked.

| Step report says | Now | Commit |
| --- | --- | --- |
| 32: `open_help` opens `https://code.claude.com/docs/en/vs-code` with `env.openExternal`; checklist item 2 expects the browser | `open_help` opens Forge Settings on the **Guide** tab (`FORGE_HELP_TAB`); `FORGE_HELP_URL` is gone; nothing leaves the machine. `test/openConfigHelp.spec.ts` asserts this and passes today. The row's label is still "View help docs". | `0004b2b`, 2026-09-27 |
| 31: 13 Settings tab ids | 16 ids in `FORGE_SETTINGS_TABS` (adds `agents`, `endpoints`, `guide`). `openForgeSettings.spec.ts` still asserts that the list, the `switch` and the files agree, and passes. | endpoints line, `0004b2b` |
| 32-33: "/" menu has 81 elements, version row alone | The menu now has 18 rows plus two filter-only rows. Up to two rows ("Open Forge in Terminal", and "Toggle fast mode" on a fast-capable model) carry a Forge-only "(soon)" element. | `a846d08` |
| 28, 31, 32: counts "20 commands, 13 references"; "355 files" | 31 commands, 11 references; 469 files scanned (final build, below) | various |

## Results

### A. Clicked today (`drive-all.mjs`, stub host, `--no-oracle`)

"Host result" here is the stub host's answer: a handler of the stub, and for every row that checks it,
not the stub's empty fallback (`__forgeFallbacks`). It is not the real extension host; the real handlers
are covered by the specs in section B and "Specs".

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| "/" → rows and sections | — | — | 18 rows; sections Context, Model, Customize, Settings, Support | works |
| "/" → Attach file… | none | — | file chooser opened; menu closes | works |
| "/" → Mention file from this project… | `list_files_request` | stub answered | "@" inserted in the composer; menu closes | works |
| "/" → Rewind | none | — | rewind picker open; menu closes | works |
| "/" → Clear conversation | `launch_claude` | stub answered | empty state, in place; menu closes | works |
| "/" → Switch model… | none | — | model menu open; menu stays open | works |
| "/" → Effort | `apply_settings` | stub answered | menu stays open | works |
| "/" → Thinking | `set_thinking_level` | stub answered | menu stays open | works |
| "/" → Toggle fast mode (default stub model) | — | — | not registered for this model, as the official | left out (by model) |
| "/" → Toggle fast mode (`claude-opus-5`) | none | — | paused: greyed, "(soon)", `aria-disabled`, sends nothing | paused (left out) |
| "/" → Output styles | `get_output_style` | stub answered | output style picker opens; menu closes | works |
| "/" → MCP servers | `open_forge_settings {tab:"mcp-servers"}` | stub answered | menu closes | works |
| "/" → Hooks | `open_forge_settings {tab:"hooks"}` | stub answered | menu closes | works |
| "/" → Permissions | `list_permission_rules` | stub answered | "Permission rules" dialog opens; menu closes | works |
| "/" → Endpoints | `open_forge_settings {tab:"endpoints"}` | stub answered | menu closes | works |
| "/" → Slash commands | `open_forge_settings {tab:"slash-commands"}` | stub answered | menu closes | works |
| "/" → Manage plugins | `open_forge_settings {tab:"plugins"}` | stub answered | menu closes | works |
| "/" → Open Forge in Terminal | none | — | paused: greyed, "(soon)", `aria-disabled`, sends nothing; menu stays open | paused (left out) |
| "/" → Focus view | `set_focus_view` | stub answered | menu stays open | works |
| "/" → General config… | `open_config` | stub answered | menu closes | works |
| "/" → View help docs | `open_help` | stub answered | menu closes. The Guide tab it lands on is not driven in the harness. | works (request and menu); landing not driven |
| "/" → New conversation (filter only) | `launch_claude` | stub answered | starts over in place, no new tab; hidden until typed | works |
| "/" → Resume conversation (filter only) | `list_sessions_request` | stub answered | past conversations dropdown opens; hidden until typed | works |
| "/" → CLI command `/compact` (Slash Commands, filter only) | `io_message` | — | sent as a message | works |
| "+" → rows | — | — | Upload from computer / Add context / Browse the web | works |
| "+" → Upload from computer | none | — | file chooser opened; menu closes | works |
| "+" → Add context | `list_files_request` | stub answered | "@" inserted; menu closes | works |
| "+" → Browse the web | `list_files_request` | stub answered | "@browser:" inserted; menu closes | works |
| "+" → `@browser:new_tab` attaches a tab | `ensure_chrome_mcp_enabled`, `create_new_browser_tab`, `io_message` | stub answered | the turn carries `<browser tabGroupId=… tabId=…>` | works |
| "+" → attach refused | `ensure_chrome_mcp_enabled`, `create_new_browser_tab` (refused) | the server's reason | banner "Couldn't attach a browser tab: Browser extension is not connected…"; the composer keeps the text; no turn sent | works |
| "+" → without browser support | — | — | rows Upload from computer / Add context only | works |

**Counts, A:** works 28 · paused 2 · left out by model 1 · partial 0 · broken 0.
The whole drive (14 steps, every surface it covers): `PASS 112 · FAIL 0 · LEFT OUT 3`, exit 0.

### B. Carried from the step reports (measured when each step ran, not re-measured today)

The step results were merged into this branch together in `3d7f381` (2026-09-22), so git does not date
the measurements. "Also today" marks a row that section A re-clicked.

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| 28 · "+" with and without browser support | — | — | 3 rows / 2 rows | works (also today) |
| 28 · "+" → Browse the web, tab list | `list_files_request {pattern:"browser:"}` | tabs only, fetched live | `@` dropdown lists `browser:<Title>` rows and `browser:new_tab` | works (insertion also today; the list is carried) |
| 28 · picking a tab | — | — | draft becomes `@browser:<group>:<id>:<url> ` | works |
| 28 · send a fully specified mention, first time | `ensure_chrome_mcp_enabled` → `{wasDisabled:true}` | `setMcpServers` adds `claude-in-chrome` (stdio, `<binary> --claude-in-chrome-mcp`) | instruction block, `<browser …>`, prompt; no tab created | works |
| 28 · send `@browser:new_tab`, already connected | `ensure_chrome_mcp_enabled` → `{wasDisabled:false}`, `create_new_browser_tab` | `tabs_context_mcp {createIfEmpty:true}` | `<browser tabGroupId tabId>`, prompt; no second instruction block | works (also today) |
| 28 · a prompt with no mention; a typed mention while unsupported | none | — | prompt alone; plain text, nothing sent | works (2 rows) |
| 28 · `@` list ordering | `list_files_request` | files first, cached tabs appended; tabs first when typing towards `browser:` | ordering as the official | works / spec-verified |
| 28 · `disable_chrome_mcp` connected / disconnected | `disable_chrome_mcp` | only `claude-in-chrome` removed; the notice enqueued only when it was connected | no UI row | spec-verified (2 rows) |
| 28 · `channelId is required` ×2, unopened channel, `setMcpServers` errors | `ensure_chrome_mcp_enabled` / `disable_chrome_mcp` | rejected | rejected promise | spec-verified (4 rows) |
| 29 · "/" → Output styles | `get_output_style` | `{outputStyle?, availableStyles?}` | picker, tick on the current style | works (opening also today) |
| 29 · picker row | `apply_settings {settings:{outputStyle}, scope:"localSettings"}` | whitelist accepts `outputStyle` only at `localSettings` | tick moves; survives a re-open | works |
| 29 · "Build a custom style ›" | `get_output_style_locations` | `{project, user}` | wizard, "Step 1 of 4" | works |
| 29 · wizard Save / name exists / Replace / CLI cannot reload | `create_output_style` | `{kind:"saved"}` / `{kind:"exists"}` (nothing overwritten) / saved via temp file / saved with no style list | dialog closes / button becomes **Replace** / closes / "Saved. The style will appear … in new sessions." | works (4 rows) |
| 30 · "/" → Focus view on / off | `set_focus_view {enabled}` | config written; `applyFlagSettings({viewMode:"focus"})` or `{viewMode:null}` to every open channel | toggle; **menu stays open**; transcript folds / unfolds | works (the click also today; the folding is carried) |
| 30 · fold row, "Collapse" row | — | — | expands in place / collapses | works (2 rows) |
| 30 · same value twice; non-boolean | `set_focus_view` | second sends no `applyFlagSettings`; `enabled must be a boolean` | none | works (2 rows) |
| 31 · "/" → MCP servers, Hooks, Manage plugins, Slash commands | `open_forge_settings {tab}` | `{tab}`; `openEditorPage('settings', …, {tab})` | menu closes; Settings on that tab | works (4 rows, also today) |
| 31 · unknown tab (`"nope"`, `"command:forge.openSettings"`, `"../../etc/passwd"`, `42`); no tab | `open_forge_settings` | `{tab:"general"}`, one warning for an unknown tab, **only** `openEditorPage` runs | Settings on General | works (2 rows) |
| 31 · Settings already open | — | `select_settings_tab` pushed | the page switches tab in place | works |
| 32 · "/" → General config… | `open_config` | `focusFirstEditorGroup`, then `openSettings "forge"` | VS Code settings, filtered to `forge` | works (request also today) |
| 32 · "/" → View help docs | `open_help` | **At the time:** `env.openExternal(docs URL)`. **Now:** Settings on the Guide tab (`0004b2b`). | menu closes | superseded (the host side is spec-verified today) |
| 32 · search string accepted; non-string refused; 201 characters refused | `open_config` | `openSettings` with it / `searchString must be a string` / `longer than 200 characters` | — | works (3 rows) |
| 32 · `open_config_file {configType:"command:…"}` ×2 | `open_config_file` | `Not a config file: command:…` | — | works (2 rows) |
| 32/33 · Settings → Endpoints, the seven buttons | `run_endpoint_action {select, add, edit, status, diagnostics, capabilities, models}` | the mapped `forge.*` command; unknown action (`forge.runDoctor`, `__proto__`) rejected | picker, guided flow, settings.json, ladder report, probe, model list, output channel | works (7 rows) |

**Counts, B (as recorded):** works 42 · spec-verified 7 · superseded 1 (`open_help`) · partial 0 · broken 0.
Per step: 28 works 9 · spec-verified 7; 29 works 7; 30 works 6; 31 works 7; 32 works 6 · superseded 1;
32/33 works 7.

## Gates

The final run, on the tree containing this checkpoint's changes:

- `pnpm test`: `Test Files 129 passed | 4 skipped (133)`, `Tests 3064 passed | 27 skipped (3091)`, exit 0.
  The 27 skipped are the 20 live tests and the 7 official-bundle tests listed above.
  The first run in this container, before the `bypassGate` spec change, was `1 failed | 3063 passed | 27 skipped`.
- `pnpm run typecheck:all`: `tsc --noEmit` and `vue-tsc -p src/webview/tsconfig.json --noEmit`, exit 0.
- `pnpm run build`: exit 0.
  - `eslint src --max-warnings 390`: `✖ 389 problems (0 errors, 389 warnings)`. One warning of budget remains.
  - `Forge brand guardrail: clean (469 files scanned)`
  - `Forge token check: clean (344 tokens used, 479 defined)`
  - `Forge command check: clean (31 commands, 11 references)`
  - webview: `✓ 4200 modules transformed`, `✓ built in 7.05s`; extension: `[watch] build finished`.

## Oracle

**Today: NOT RUN** (see the first table). The last recorded numbers, and whether the markup under each has
changed since, from `git log`:

| Window (root selector) | Last recorded structural diffs | Source | Component changed since? |
| --- | --- | --- | --- |
| `.fg-commandmenu__menuPopup`, the "/" menu | 0 (the two step 32 files say 85 and 81 elements, measured on different branches; the baseline file's last commit is `ada0d7e`, 2026-09-26, and its "/" entry is `[]`) | step 32; `baselines/oracle.json` | **Yes.** `a846d08` (2026-09-28) added a Forge-only `(soon)` element and `aria-disabled` to two rows, after the last baseline write. Whether the oracle still reports 0 is unmeasured. |
| `.fg-addmenu__menuPopup`, 3 rows / 2 rows | 0 (16/16, 11/11) | step 28; baseline `[]` | `AddMenu.vue` last changed 2026-09-23, before the baseline writes of 09-24 and 09-26. Not re-measured. |
| `.fg-outputstyle__menuPopup` (24), wizard steps 1, 3, 4 (15, 20, 30) | 0 on all four | step 29 | `OutputStylePicker.vue`, `OutputStyleWizard.vue`: no change since the merge (09-22). Ported CSS (`port-official-css.mjs`) changed on 09-23 and 09-24. Not re-measured. |
| `.fg-chat__messagesContainer`, Focus view collapsed (35); fold row (4); collapse row (4) | 0 / 0 / 0 | step 30 | `FocusFoldRow.vue`: no change since 09-22. Not re-measured. |
| Focus view, expanded (72) | 11 rows, none in a `fg-focusfold__*` element (all inside the ordinary Bash tool body) | step 30 | pre-existing tool-rendering difference, unchanged by this group |
| the version row alone | 0 | step 32 | inside the "/" menu; see its row |

## Specs

Counts are today's, from `vitest --reporter=json`. The case lists are the step files'.

- `test/browserIntegration.spec.ts`: 51 tests (50 passed, 1 skipped: instruction text vs the official bundle).
  `claudeCommandLine`, `chromeMcpServerConfig`, `browserProfileRoots`, `findChromeExtension` (including
  `ProfileX` and `System Profile` not matching), the MCP client parsers, `browserTabEntries` with a round trip,
  `handleListFiles`, the `ClaudeAgentService` cases (add-only `setMcpServers`, `wasDisabled` both ways, joined
  error, channel not found, a missing `channelId` through `processRequest`, install prompt, remove-only), `handleInit`,
  and `browserMentionBlocks` (bare `@browser:` does **not** match; `@browsers` is not a mention).
- `test/outputStyles.spec.ts`: 47 passed. Name, description and file-name checks, front matter, folder safety
  (`O_EXCL`, `O_NOFOLLOW`, a symlinked `.claude` refused), the three requests with every rejection, and a table
  run through both the webview's and the host's checks.
- `test/focusView.spec.ts`: 33 passed. Persist, push to every channel, no re-push, non-boolean refused before
  writing, the filter, the folds, the expand rules.
- `test/openForgeSettings.spec.ts`: 11 passed. Every tab id accepted, everything else rejected, the three tab
  lists agreeing.
- `test/openConfigHelp.spec.ts`: 59 passed (12 at step 32; the rest came with the endpoint-action and Guide work).
  `open_config` ordering and caps, `open_help` opening the Guide tab and calling `openExternal` zero times (also
  with a hostile payload), `command:` config types refused, the closed `run_endpoint_action` set.
- `test/terminalPaused.spec.ts`: 3 passed. The two "/" rows and the welcome and empty-chat entry points.
- `test/bypassGate.spec.ts`: 7 passed, after this checkpoint's change.

## Rows deliberately left out and why

From `out-of-scope.md` (unchanged): microphone / speech-to-text; login and "Switch account"; "Account &
usage…" and the usage/context meter; Remote Control; feedback (`submit_feedback`, `/feedback`, `/bug`,
"Report a problem", removed in step 33); thumbs rating; "Switch models when a message is flagged"; `/btw`.
Not built, and in neither scope list: the worktree pill and `generate_session_title`.

Left out by this group:

| Left out | Why |
| --- | --- |
| A browser status pill and disconnect control | The surface the official's `chromeMcpState` UI lives on is not in scope. `disable_chrome_mcp` is wired and spec-verified, with no row. |
| `@terminal:` mentions | A parallel official branch behind an env flag; not named by step 28. |
| "Browse the web" on a build with no Claude binary | B4: the backend cannot work, so the row is not registered. Proved with `?noBrowser`. |
| "/" → Permissions as a Settings tab | Step 16 (the user's decision, 2026-09-18) made it open the "Permission rules" dialog. `CLAUDE.md`'s scope line still says Settings tab and is out of date. |
| `forge.newConversation`, `forge.showLogs` as webview-triggered commands | Dropped with the `command:` branch (step 32). `forge.showLogs` remains a command-palette command. |
| "Report a problem" | Out of scope; the version text stays. |
| Not ported from the official Focus view `DL1`: subagent spans, synthetic and origin-filtered messages, teleported messages, "Thought for Ns", `redacted_thinking` | Forge's transcript model has no field for them; inventing one would be guessing. |
| **Paused 2026-09-28:** "Open Forge in Terminal", "Toggle fast mode" (which runs `claude /fast` in a terminal) | The user's decision (`a846d08`). One switch, `TERMINAL_AVAILABLE`, brings them back. The host request still works and is spec-verified. |
| "Toggle fast mode" for a model without fast mode | As the official. Not registered. |

## VS Code checklist for the user (unverified until you run it)

The harness proves the webview↔host contract against a stub. Nothing here was observed in real VS Code,
against the real CLI, or with a real Chrome. Steps 1–8 need Chrome with the Claude in Chrome extension.

**@browser tabs (step 28)**
1. Open Forge in a workspace. **Expected:** "+" shows three rows, the third "Browse the web" with a globe icon.
2. Click it with **no** Claude in Chrome extension installed. **Expected:** a VS Code notification, *"Claude in
   Chrome: Install the browser extension to control Chrome from Claude Code"*, with **Install Extension** and
   **Don't Show Again**. Install Extension opens `https://claude.ai/chrome`.
3. Click **Don't Show Again**, then repeat step 2. **Expected:** no notification the second time
   (`globalState["chromeExtensionNotificationDismissed"]`).
4. With the extension installed and Chrome running, click "+" → Browse the web. **Expected:** the `@` dropdown
   lists your real open tabs as `browser:<Tab_Title>` plus a `browser:new_tab` row.
5. Pick a tab, type "summarise this page" and send. **Expected:** the CLI gains the `mcp__claude-in-chrome__*`
   tools, and Claude reads that tab.
6. Send `@browser:new_tab open example.com`. **Expected:** a **new Chrome tab** opens and Claude navigates it.
7. Check the Forge output channel for `Chrome MCP: Connecting to server with command: <claude binary>
   --claude-in-chrome-mcp` and `Chrome MCP: Successfully connected to server`. **Expected:** both lines, and the
   binary path is the one Forge launches sessions with.
8. If step 5 or 6 fails with a handshake error, the `forge-vscode-chrome-mcp-client` `clientInfo` is the thing to
   change back to the official's (step 28's scope table). **Expected:** no handshake error.

**Output styles (step 29)**
9. Open a conversation, press "/", choose **Output styles**. **Expected:** the menu closes and a popup opens above
   the composer listing the styles the CLI knows (at least `default`), with a tick on the current one.
10. Pick a style other than the current one. **Expected:** `.claude/settings.local.json` in the project gains
    `"outputStyle": "<name>"`, and the next reply follows that style.
11. Re-open "/" → Output styles. **Expected:** the tick is on the style picked in step 10.
12. "/" → Output styles → **Build a custom style ›**, name it `Diagrams first`, leave the description blank, give it
    one line of instructions, keep "Include the coding instructions" on, choose **Project**, keep "Switch to this
    style now" on, press **Save**. **Expected:** `.claude/output-styles/Diagrams first.md` exists with front matter
    `name: Diagrams first` and `keep-coding-instructions: true`; `.claude/settings.local.json` now says
    `"outputStyle": "Diagrams first"`; and the style appears in the picker.
13. Repeat step 12 with the same name. **Expected:** "A style file named Diagrams first.md already exists here."
    and the button reads **Replace**. Press **Replace**: the file's instructions are the new ones, and no `.tmp`
    file is left in the folder.
14. Try to name a style `../escape` or `a/b`. **Expected:** "A name can't contain / \ : * ? " < > | or ---",
    **Next** does not advance, and nothing is written anywhere.

**Focus view (step 30)**
15. "/" → **Focus view**. **Expected:** the toggle turns on and the menu stays open; the transcript immediately shows
    only your prompts and Forge's replies, with a row like "3 tool calls" where the work was.
16. Close and reopen the panel (or reload the window). **Expected:** focus view is still on, and `focusView: true`
    is in Forge's extension config file.
17. With focus view on, ask for something that runs a tool. **Expected:** while it runs, the fold row reads
    "Running `<Tool>`…" in a pulsing label with a progress dot and is **open** so you can watch it; when it finishes
    it collapses to the summary. *(The harness could not hold this state; please check it.)*
18. Trigger a permission prompt with focus view on. **Expected:** the fold holding that tool call is forced open, and
    the row reads "Waiting for permission…".
19. Click a fold row, then the "Collapse" row beneath it. **Expected:** it expands and collapses.
20. Turn focus view off. **Expected:** the whole transcript returns, and `focusView: false` is written.
21. With a session running, check what the CLI itself reports. **Expected:** the `viewMode` flag setting is `focus`
    while the toggle is on and cleared when it is off (`'default' | 'verbose' | 'focus'`, `sdk.d.ts` L8167).

**Settings tabs (step 31)**
22. "/" → **MCP servers**. **Expected:** the menu closes and Forge Settings opens on the **MCP Servers** tab.
23. Without closing Settings, go back to the chat and run "/" → **Hooks**. **Expected:** the *same* Settings tab is
    revealed and switches to **Hooks**, not a second panel.
24. Repeat with **Manage plugins** and **Slash commands**. **Expected:** Plugins and Slash Commands respectively.
25. "/" → **Permissions**. **Expected:** the "Permission rules" dialog, not Settings (step 16's behaviour).
26. From the command palette, run **Forge: Open Settings**. **Expected:** Settings opens on **General**.

**Typed config and help (steps 32, 33)**
27. "/" → **General config…**. **Expected:** the menu closes and VS Code's Settings open, filtered to `forge`, in the
    first editor group.
28. "/" → **View help docs**. **Expected (current behaviour, replacing step 32's):** the menu closes and **Forge
    Settings opens on the Guide tab**. No browser opens and nothing leaves the machine.
29. Open "/" and look at the bottom row. **Expected:** the version (`v0.1.x`) and nothing else, with no "Report a
    problem".
30. Command palette → **Forge: Show Logs**. **Expected:** the Forge output channel opens.
31. Settings → Endpoints, click each of the seven buttons. **Expected:** Select… a picker; Add… the five questions;
    Open settings.json at `forge.endpoints`; Run the diagnostics ladder; Probe the capability sweep; List the model
    picker; Show the output channel.
32. Settings → MCP Servers → the global and project config buttons. **Expected:** they still open their JSON files.

**Paused rows**
33. "/" → **Open Forge in Terminal** and **Toggle fast mode** (on a model with fast mode). **Expected:** both are
    greyed with "(soon)", choosing either does nothing, and no terminal opens. This replaces the old checklist
    items for opening a terminal; they apply again only after `TERMINAL_AVAILABLE` is set to `true`.
