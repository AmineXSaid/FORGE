# Forge test plan: every button, every feature

A plan to test everything Forge ships: each VS Code contribution, each control
in the chat, the session manager and the Settings page, each request the
webview can send, and each host feature behind them. Every item has an ID, the
evidence that proves it, what covers it today, and what is still missing.

This document is a plan. Nothing in it has been run except the baseline in
Section 1, which says what was measured and where.

It builds on what already exists: 133 vitest specs, the harness
(`.claude/skills/ui-parity/scripts/drive-all.mjs`), the end-to-end kit
(`.claude/skills/ui-parity/e2e/`), the release QA prompt
(`docs/prompts/launch-gate-qa.md`) and the six production-audit reports
(`docs/backend-wiring/results/60`–`66`). Where those already prove a row, this
plan points at them. It does not repeat them.

---

## 0. How to read and run this plan

**IDs.** Every testable item has an ID (`SL-08`, `ST-HK-03`, `REQ-41`...). A test
run reports every ID once, with a verdict and its evidence.

**Verdicts** (from `CLAUDE.md` B9; a partial result is never rounded up):

| Verdict | Meaning |
| --- | --- |
| PASS | the expected effect was observed, with the evidence named in the row |
| FAIL | the effect was not observed, or something else happened |
| PARTIAL | part of the effect was observed; the row says which part is missing |
| UNVERIFIED | not observable in this environment; it has a step in Section 12 |
| LEFT OUT | deliberately absent (out of scope, or unsupported for this model or host), with the reason |

**Evidence is the effect, not the label** (B7). A row passes on one of:
- a file and key on disk (`~/.claude/settings.json`, `.claude/settings.local.json`,
  the session `.jsonl`, a file the model edited);
- a request seen at the gateway (the stub's `/__log`: model id,
  `reasoning_effort`, system prompt);
- a request or response on the webview↔host channel (`__forgeSent`,
  `__forgeFallbacks` in the harness);
- a DOM state measured over CDP (text, `getBoundingClientRect`, computed style);
- a line in the Forge output channel (`Forge.log`).

A screenshot alone is supporting evidence, never the only evidence.

**Coverage columns** (in the tables):

| Tag | Layer | Tool |
| --- | --- | --- |
| **U** | unit / host spec | `pnpm test` (vitest, node environment, `test/mocks/vscode.ts`) |
| **H** | harness: the real built webview against the stub host, real mouse and keys over CDP | `harness.mjs` + `drive-all.mjs` / `drive-health.mjs` |
| **E** | end to end: the VSIX in VS Code / code-server, the real bundled CLI, the stub gateway | `e2e/launch.mjs` (the number is the scenario) |
| **L** | live endpoint: a real gateway or a real CLI turn | the env-gated specs (`FORGE_CLI_E2E=1`, `BASE_URL` + `API_KEY`) |
| **M** | manual: Windows VS Code with the user's gateway | Section 12 |

`—` means nothing covers it today. **Add** says what to build; every Add is
collected with a priority in Section 11.

---

## 1. Baseline (measured 2026-09-29, linux-x64 container, `ccr-6defd146-hqpzyo` at `15381c7`)

| Gate | Command | Result |
| --- | --- | --- |
| Install | `pnpm install --frozen-lockfile` | ok |
| Unit / host | `pnpm test` | **133 files: 129 passed, 4 skipped. 3,091 tests: 3,064 passed, 27 skipped** (30 s). After the terminal revert (item 3): 3,093 tests, 3,066 passed, 27 skipped |
| Types | `pnpm run typecheck:all` | clean (extension host + webview) |
| Build + gates | `pnpm run build` (eslint, lint:brand, lint:tokens, lint:commands, vite, esbuild) | passes; **eslint at 389 warnings against `--max-warnings 390`** |
| Harness | `harness.mjs --port 8771` + `drive-all.mjs --port 8771` (served `main.js` byte-equal to `dist/media/main.js`) | **17 PASS · 14 FAIL.** 13 FAILs are whole surfaces stopped by `Error: no /oracle/official.css`, one is the plan preview (a `TypeError` from the same missing file), and one was "Toggle fast mode", which failed because the terminal was paused (item 3) |
| End to end | `e2e/launch.mjs` | **not run here**: it needs code-server and the two native CLI binaries (~460 MB). The last recorded full run (report 65) had 22 pass · 2 partial · 0 fail over 24 scenarios. Scenarios 25–34 were added after it |

What the baseline shows:

1. **The skipped specs.** Four files need a real CLI or a real endpoint and
   skip without them: `cliGuardsE2E`, `hermesAgentE2E` (`FORGE_CLI_E2E=1`),
   `endpointE2E`, `hookRewriteProbe` (`BASE_URL` + `API_KEY`). The other
   skipped tests need the official bundle (`OFFICIAL_DIR`), which is not in
   this container (`../Real_Claude_Code_VSCODE_extension_files/` is missing).
2. **Without the official bundle, the harness tests nothing.** `drive-all.mjs`
   runs `probe-oracle.js` inside each surface's step, before its rows. With no
   official `index.css` the oracle throws, the step aborts, and not one row
   click runs. Only the "/" menu section list, the message-actions list and the
   16 Settings tabs (which only open each tab) pass. Clicking rows must not
   depend on a proprietary stylesheet (**P0-1**).
3. **The terminal is back on (fixed the same day).** At baseline "Open Forge in
   Terminal" was paused (`a846d08`): the "/" rows "Open Forge in Terminal" and
   "Toggle fast mode" were greyed with "(soon)" and sent nothing, the welcome
   button was disabled, and the empty chat's terminal card and tip were hidden.
   `drive-all.mjs` expected the working rows, so "Toggle fast mode" failed. On
   the user's decision the pause was reverted: every entry point opens the
   terminal again and no "(soon)" is left. After the revert, measured in the
   harness (fresh build, served `main.js` byte-equal): "Open Forge in Terminal"
   → `open_claude_in_terminal {location:'bottom'}`; "Toggle fast mode"
   (claude-opus-5) → `{prompt:'/fast', args:[], location:'bottom'}`; the empty
   chat's "Open Forge in Terminal." link → `open_claude_in_terminal`; all at
   opacity 1, no `aria-disabled`. `drive-health.mjs`: 34/34 (the oracle at its
   end is not run, for the reason in item 2). Guarded by
   `test/terminalAvailable.spec.ts`.
4. **Settings is opened, never used.** The harness opens each of the 16
   Settings tabs and checks its title. None of the ~150 controls inside is
   changed, saved, reloaded or reset by any layer (**P1-1**).
5. **The lint budget has one warning of headroom.** Any change that adds an
   eslint warning fails `pnpm run build`. This is not a test gap, but a test run
   that adds a helper can trip it.

---

## 2. Test layers

| Layer | What it proves | How to run | Evidence it leaves |
| --- | --- | --- | --- |
| **L0 static** | brand (no raw colour, no system font), tokens, command manifest, types, lint, the dist bundle | `pnpm run lint:forge`, `pnpm run typecheck:all`, `pnpm run lint`, `pnpm run lint:dist` | exit codes |
| **L1 unit / host** | each handler, validator, parser, store and translator in isolation; rejection cases | `pnpm test` | vitest report |
| **L2 protocol contract** | every request exists in all six places (B2) and the stub answers every one for real | `test/protocolDrift.spec.ts`, `test/stubsWired.spec.ts`, `test/untrustedInput.spec.ts`, `__forgeFallbacks` in the harness | spec report, fallback list |
| **L3 harness** | every row of every window: what it sends, what it shows, whether it stays open; structural parity with the official CSS | `node .claude/skills/ui-parity/scripts/harness.mjs --port <p>` then `drive-all.mjs --port <p> --out <md>` and `harness/drive-health.mjs` | the B9 table, oracle rows vs `baselines/oracle.json` |
| **L4 end to end** | the packaged VSIX in a real workbench with the real CLI: disk, gateway and DOM effects | `node .claude/skills/ui-parity/e2e/launch.mjs --code-server ~/cs/node_modules/.bin/code-server --vsix forge.vsix --stub` | `<root>/report/report.md`, `results.json`, screenshots |
| **L5 live** | real model behaviour on a real gateway / real CLI | `FORGE_CLI_E2E=1 pnpm test`, `BASE_URL=… API_KEY=… pnpm test`, `e2e/launch.mjs --gateway … --model …` | spec report, gateway log |
| **L6 manual** | what no automation here can reach: Windows desktop VS Code, the user's gateway, Claude in Chrome | Section 12 | the user's filled-in checklist |

Rules for every layer:
- **Isolation.** L4–L6 run with their own `--user-data-dir`, `--extensions-dir` and
  home (`HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`), so `~/.claude` is a
  fresh folder. The developer's own history and settings are never read or
  written.
- **Harness hygiene** (from the ui-parity skill): pick a free port, byte-compare
  the served `/main.js` with `dist/media/main.js`, confirm the stylesheets parsed,
  and use real input (`page.click`), never `element.click()`.
- **No secrets** in logs or reports. Keys are passed by environment-variable
  name (`--auth-env`).

---

## 3. Exit criteria: when Forge counts as fully tested

1. L0, L1 and L2 green, with every skip explained.
2. Every ID in Sections 4–10 has a verdict with evidence. Zero FAIL.
3. PARTIAL and UNVERIFIED appear only with a named reason and a step in Section 12.
4. L3: 0 FAIL, no fallback answers, and 0 structural oracle rows beyond the
   divergences recorded in `docs/forge-design.md` (only where the official
   bundle is available; otherwise the oracle part is reported as not run).
5. L4: a full run of every scenario with 0 FAIL on Linux, and the Windows run in
   Section 12 filled in.
6. Every out-of-scope row in Section 9 is proven **absent**.
7. The report uses the B9 table (Section 13).

---

## 4. VS Code contributions

### 4.1 Commands (31, `src/commands/forgeCommands.ts`)

Test recipe for every command: run it from the palette (E) **and** call its
implementation against the `vscode` mock (U). Assert the effect, then assert that
it ran with no workspace folder open and with no endpoint configured (a clear
message, never an exception).

| ID | Command | Expected effect (evidence) | Covered today | Add |
| --- | --- | --- | --- | --- |
| CMD-01 | `forge.sidebar.open` | the chat view focuses in the preferred side bar (`forge.chatViewSecondary`, else `forge.chatView`); falls back when a container is absent | U `openConfigHelp`, `contextKeysAndSettings`; E 27, 13 | U: both fallback orders |
| CMD-02 | `forge.editor.open` | a **new** editor tab each call (`chat-<n>` instance ids) | U `commandArguments`; E 13 (Ctrl+Shift+Esc) | U: two calls → two panels |
| CMD-03 | `forge.editor.openLast` | `panel`: the chat tab used last, or a new one; otherwise the side bar | U `chatInTab`; E 27 | — |
| CMD-04 | `forge.sessions.open` | the "Forge Sessions" editor page opens | E 27 (partly) | U; E: palette sweep (P1-3) |
| CMD-05 | `forge.welcome` | side bar revealed, `show_welcome` sent to the webview, the welcome page shows even with endpoints set | — | U + E |
| CMD-06 | `forge.newConversation` | side bar revealed, `new_conversation`: an empty composer, the previous session still in history | U `openConfigHelp` | E |
| CMD-07 | `forge.focus` | side bar revealed, composer has keyboard focus | E 13 | U |
| CMD-08 | `forge.blur` | `workbench.action.focusFirstEditorGroup`; the editor has focus | U `openConfigHelp`; E 13 | — |
| CMD-09 | `forge.focusLastMessage` | the last message has focus | — | U + E |
| CMD-10 | `forge.insertAtMention` | with an editor: `@path` or `@path#L<a>-<b>` for a selection is inserted in the composer; with none: the "open a file" message | E 13 (Alt+K) | U: both texts, 1-based lines, no editor |
| CMD-11 | `forge.acceptProposedDiff` | with a proposed diff open: accepted, file written; with none: no-op | — | U `proposedDiff` + E |
| CMD-12 | `forge.rejectProposedDiff` | with a proposed diff open: rejected, file unchanged | — | U + E |
| CMD-13 | `forge.createWorktree` | a git worktree is created (path and branch as prompted); outside a git repo: a clear message | — | U (git mocked) + E in a temp repo |
| CMD-14 | `forge.openSettings` | Settings opens on the tab passed (`isForgeSettingsTab`), anything else → General; an open failure shows an error, never silence | U `openForgeSettings`, `commandArguments`; E 12, 34 | — |
| CMD-15 | `forge.showLogs` | the Forge output channel is shown | U `chatErrors` | — |
| CMD-16 | `forge.runDoctor` | output shown; `checkCliHealth` runs; a failure shows the warning toast | U `hostRobustness` (partly) | U: ok and failing health |
| CMD-17 | `forge.openWalkthrough` | `workbench.action.openWalkthrough` with `<ext id>#forge-walkthrough` | — | U |
| CMD-18 | `forge.selectAgent` | a pick list: "No agent" + each Hermes agent (model, tools, mcp detail); a pick writes `forge.activeAgent` and starts a new session; no agents → "Create an agent..." runs `forge.createAgent`; load warnings toast | U `agentKinds` | E: pick, then the gateway's system prompt has `## Agent: <name>` (extends 28) |
| CMD-19 | `forge.createAgent` | asks the kind; Claude Code → `.claude/agents/<name>.md`; Hermes → `.forge/agents/<name>.md`; "Use it now" sets `forge.activeAgent` | U `agentKinds`, `customizations`; E 28 | — |
| CMD-20 | `forge.selectEndpoint` | a pick list of pairs (model, name · current) + "Add an endpoint…"; a pick writes `forge.endpointProfile` where it takes effect (never Workspace with no folder), resets the relay, shows "now using" | U `endpointProfile` (partly) | U: no-folder write target; E: switch mid-conversation (next turn's model id at the gateway) |
| CMD-21 | `forge.addEndpoint` | the setup flow (4.1a) writes `forge.endpoints.<name>` in **User** settings, the key in the keychain, and selects it | U `endpointSetupFlow`, `addEndpoint`, `endpointSetupCard`; E 24 (partly) | E: every branch of 4.1a |
| CMD-22 | `forge.editEndpoints` | opens settings.json at `forge.endpoints` | — | U |
| CMD-23 | `forge.endpointStatus` | the output channel lists `forge.endpointProfile`, every profile and every parse error | — | U; **check the copy**: it prints "(unset -- using Anthropic directly)", while `forge.selectEndpoint` says there is no Anthropic default |
| CMD-24 | `forge.runEndpointDiagnostics` | pick a profile; the diagnostic ladder runs, can be cancelled, and each rung is logged with its fix | U `endpointDiagnostics` (ladder) | U (command) + E against the stub, both up and down |
| CMD-25 | `forge.detectCapabilities` | the probes run, the result is written to **the scope that owns the profile** | U `endpointDiagnostics` (probes) | E: the written capabilities |
| CMD-26 | `forge.listEndpointModels` | a pick list of the models; an error shows a warning and leaves the model field as free text | U `endpointModelList` | E |
| CMD-27 | `forge.createSkill` | name + description → `SKILL.md` written and opened | U `customizations` (partly) | E: file on disk, listed in Settings › Skills |
| CMD-28 | `forge.addSkill` | a folder with a `SKILL.md` is added; a folder without one is refused | U `customizations` (partly) | E |
| CMD-29 | `forge.addMcpServer` | the server is added through `claude mcp add` (the resolved CLI) at the chosen scope | U `customizations` (partly) | E: `.mcp.json` / user config written, server listed in Settings › MCP |
| CMD-30 | `forge.createSubagent` | hidden from the palette (`when: false`); a keybinding still creates a Claude Code agent | U `agentKinds`; E 28 (absent from palette) | — |
| CMD-31 | `forge.createSlashCommand` | `.claude/commands/<name>.md` written and opened; it appears in the "/" menu after a reload | — | U + E |

**4.1a: the endpoint setup flow** (`src/services/endpoints/setupFlow.ts`,
`startPicker.ts`). Every branch, U (`endpointSetupFlow`, `endpointSetupCard`,
`discoverEndpoints`) and E:

| ID | Branch | Expected |
| --- | --- | --- |
| EPS-01 | a local server is running (Ollama 11434, LM Studio, vLLM, llama.cpp, Jan) | listed as "running now"; choosing it asks for a name, then a model; no address, no key |
| EPS-02 | no local server | the gateway path: URL → API (OpenAI / Anthropic) → key kind |
| EPS-03 | key kinds | none / bearer / custom header name; the key is asked **before** the model list; it goes to the keychain, `settings.json` holds only `${secret:…}` |
| EPS-04 | the model list | embedding models left out; listed models probed (4 at a time, 15 s each); answering ones first |
| EPS-05 | the list fails | the model id becomes free text |
| EPS-06 | the check | runs after the model is picked; a failure shows the failing rung's fix |
| EPS-07 | name validation | an existing name (a failed-to-parse entry included) is refused |
| EPS-08 | "Another model from" | reuses an existing endpoint and its stored key |
| EPS-09 | Escape at any step | nothing written, no key stored |
| EPS-10 | the result | `forge.endpoints.<name>` in User settings (application scope); `forge.endpointProfile` set with no toast click |

### 4.2 Settings (17 `forge.*` keys)

Recipe: set in User settings (and in Workspace, to prove the scope rules), then
observe the effect. `scope: machine` / `application` keys must be **ignored**
when a workspace sets them. That is a security row (X-SEC-05).

| ID | Key | Default | Expected effect | Covered today | Add |
| --- | --- | --- | --- | --- | --- |
| CFG-01 | `forge.selectedModel` | `default` | the model the next session launches with | — | U + E |
| CFG-02 | `forge.environmentVariables` (machine) | `[]` | each `{name,value}` reaches the CLI's environment; values never logged | U `loggingHygiene`, `cliLaunch` | E: the CLI's env via a `run :: env` turn |
| CFG-03 | `forge.allowDangerouslySkipPermissions` (machine) | false | gates the Bypass row; written by the Bypass confirmation | U `bypassGate`, `bypassPermissions`; E 20 | — |
| CFG-04 | `forge.autoApproveSafeCommands` (machine) | false | in Edit automatically, harmless commands run unasked; risky ones ask | U `autoApprove`, `commandRisk`; E 26 | — |
| CFG-05 | `forge.followEdits` | true | edited files open without focus, lines highlighted; off → editors untouched | U `followEdits`; E 25, 29 | E: off |
| CFG-06 | `forge.cliArgs` (machine) | `{}` | FREE flags pass, PROTOCOL flags rejected, MANAGED flags logged as duplicates, bypass flags rejected | U `cliArgs` | E: an unknown flag → the CLI's own reason in the chat (report 65) |
| CFG-07 | `forge.runDoctorOnStartup` | true | `claude doctor` runs at activation, version in the log; off → not run | — | U + E |
| CFG-08 | `forge.enableNewConversationShortcut` | false | Ctrl/Cmd+N starts a new conversation only when on and Forge has focus | — | E (keybinding) |
| CFG-09 | `forge.preferredLocation` | `panel` | panel / secondary / primary placement; the view `when` clauses | U `sidebarLocation`, `chatInTab`; E 27 | E: `primary`, `secondary` |
| CFG-10 | `forge.showSessionsSidebar` | per manifest | the sessions activity-bar container shows or hides | U `sidebarLocation` | E |
| CFG-11 | `forge.endpointProfile` | `""` | the active pair; a missing name → a clear error, no silent fallback | U `endpointProfile`, `configResolver` | E (launch-gate Phase 1 item 7) |
| CFG-12 | `forge.activeAgent` | `""` | the Hermes agent the session runs as | U `agentKinds`; E 28 | — |
| CFG-13 | `forge.agentsDir` | | where Hermes agents load from (relative → workspace) | U `contextKeysAndSettings` | U: `resolveAgentsDir` edge cases |
| CFG-14 | `forge.agentEndpoints` | `{}` | an agent's endpoint override | U `contextKeysAndSettings` | U + E |
| CFG-15 | `forge.endpointProfilesDir` | | profiles loaded from a directory | U `endpointProfile` | — |
| CFG-16 | `forge.endpointHealth.syncIntervalMinutes` | | the periodic health check; 0 = off | U `modelPickerHealth` | — |
| CFG-17 | `forge.endpoints` (application) | `{}` | the profiles; survives a colour-theme switch | U many; E 24, 30 | — |

### 4.3 Keybindings (5)

| ID | Keys | When | Expected | Covered | Add |
| --- | --- | --- | --- | --- | --- |
| KEY-01 | Alt+K | `editorTextFocus` | `forge.insertAtMention` | E 13 | — |
| KEY-02 | Ctrl/Cmd+Esc | `editorTextFocus` | `forge.focus` | E 13 | — |
| KEY-03 | Ctrl/Cmd+Esc | `!editorTextFocus` | `forge.blur` | E 13 | — |
| KEY-04 | Ctrl/Cmd+Shift+Esc | always | `forge.editor.open` | E 13 | — |
| KEY-05 | Ctrl/Cmd+N | setting on, `forge.sideBarActive`, no editor/panel focus | `forge.newConversation` | — | E: on/off, focus conditions |

### 4.4 Views, menus, context keys

| ID | Item | Expected | Covered | Add |
| --- | --- | --- | --- | --- |
| VIEW-01 | `forge.chatViewSecondary` | in the secondary side bar unless `primary` or unsupported | U `sidebarLocation`; E 27 | — |
| VIEW-02 | `forge.chatView` | in the activity bar when `primary` or `forge:doesNotSupportSecondarySidebar` | U `sidebarLocation` | E on `primary` |
| VIEW-03 | `forge.sessionsView` | the session manager when `forge:sessionsListEnabled && showSessionsSidebar` | E 22 | — |
| VIEW-04 | editor/title Accept / Reject | shown only while `forge.viewingProposedDiff` | — | E with a proposed diff |
| VIEW-05 | editor/title "Forge: Open" (brand icon) | on every editor title; opens the chat | — | E |
| VIEW-06 | command palette hiding | `createSubagent` hidden; accept/reject only while a diff is open | E 28 (createSubagent) | E for accept/reject |
| VIEW-07 | context keys | `forge.viewingProposedDiff`, `forge:sessionsListEnabled`, `forge:doesNotSupportSecondarySidebar`, `forge.sideBarActive` set and cleared | U `contextKeysAndSettings` | — |
| VIEW-08 | `jsonValidation` | `forge.endpoints` / profile JSON validates in the editor | — | U: the schema accepts every documented profile and rejects a bad one |

### 4.5 Walkthrough ("Get started with Forge")

| ID | Step | Expected | Covered | Add |
| --- | --- | --- | --- | --- |
| WT-01 | welcome | `resources/walkthrough/step1.md` renders | — | E |
| WT-02 | open-forge | completes on `forge.sidebar.open` / `forge.editor.open` | — | E |
| WT-03 | chat | step3.md renders | — | E |
| WT-04 | sessions | completes on `forge.sessions.open` | — | E |

### 4.6 Activation, trust, packaging surface

| ID | Item | Expected | Covered |
| --- | --- | --- | --- |
| ACT-01 | Restricted Mode | no Forge until the folder is trusted, then Forge | E 15, U `workspaceTrust` |
| ACT-02 | install and activation | never write `~/.claude/settings.json` | E 1 |
| ACT-03 | `onStartupFinished` | activates with no error in `Forge.log`; unhandled rejections are logged, not thrown | U `unhandledRejections` (via `hostRobustness`) |
| ACT-04 | virtual workspaces | not supported (declared) | manifest |

---

## 5. The chat window: every control

Unless stated, each row is checked in the harness (H) for: what it sends, that
the stub answered with a real handler (no fallback), what the page shows, and
whether the window stays open. Then it is checked in L4 for the real effect.

### 5.1 Header (`pages/ChatPage.vue`)

| ID | Control | Action | Expected | Covered | Add |
| --- | --- | --- | --- | --- | --- |
| HDR-01 | Conversation title | click | becomes editable | — | H |
| HDR-02 | title edit | Enter | `rename_session` sent; the title saved (`custom-title` in the `.jsonl`) | U `renameSession` | H + E |
| HDR-03 | title edit | Esc | edit cancelled, nothing sent | — | H |
| HDR-04 | title edit | empty or whitespace | refused, old title kept | — | H |
| HDR-05 | Session history | click | the sessions dropdown opens / closes | H | — |
| HDR-06 | New session | click | a new conversation; the old one stays in history | H (via "/") | H (the button itself) |
| HDR-07 | header glyphs | render | the official glyphs, not codicons (Part A) | report 05 | oracle |

### 5.2 Composer (`ChatInputBox.vue`, `ContentEditableInput.vue`, `ButtonArea.vue`)

| ID | Behaviour | Expected | Covered | Add |
| --- | --- | --- | --- | --- |
| CMP-01 | Enter | sends; the turn appears in the transcript | H, E 2 | — |
| CMP-02 | Shift+Enter | new line, nothing sent | — | H |
| CMP-03 | IME composition (`isComposing`) | Enter while composing does not send | — | H (synthetic `compositionstart`) |
| CMP-04 | empty or whitespace-only | send disabled, nothing sent | U `composerSubmit` (partly) | H |
| CMP-05 | Backspace/Delete on a chip | removes the whole mention chip | — | H |
| CMP-06 | paste plain text | inserted as text | — | H |
| CMP-07 | paste an image | an attachment thumbnail; sent as an image block | U `attachmentTypes` | H + E |
| CMP-08 | drop a file from the explorer / OS | an attachment or an `@` mention | — | H (synthetic drop) + E |
| CMP-09 | remove an attachment | the thumbnail's close button | — | H |
| CMP-10 | `@` completion | `list_files_request`; ↑↓ Enter Tab Esc; folders; fuzzy match; chip inserted; the path reaches the turn | U `browserIntegration` (files); E 23 | H: keyboard nav and chip |
| CMP-11 | `@browser:` completion | rows only with browser support; `new_tab` attaches a tab | H; E 16 | — |
| CMP-12 | `/` completion from the composer | the CLI's commands; Tab inserts with `argumentHint`, Enter sends | U `slashCompletion`, `commandArguments`; E 4 | — |
| CMP-13 | the selection chip (IDE context) | the editor selection is shown and sent as `<ide_selection>` | U `ideContext`, `editorSelection`; E 5 | — |
| CMP-14 | send while the model works | queued (messages while working), sent after, in order | U `pendingMessages` | E 10 (partly) |
| CMP-15 | Stop | `interrupt_claude`; the interrupt lands in the `.jsonl` | E 10 | H |
| CMP-16 | Esc while working | interrupts (as the official) | — | H + E |
| CMP-17 | the draft survives | switching tabs / reloading the webview keeps the typed text | — | H |
| CMP-18 | the footer at 300 px | the mode button does not overlap send/Stop (a known narrow-bar defect, e2e README) | — | H at 300 px (X-UI-03) |

### 5.3 "+" menu (`forge/AddMenu.vue`)

| ID | Row | Expected | Covered |
| --- | --- | --- | --- |
| ADD-01 | Upload from computer | the file chooser opens; the menu closes | H |
| ADD-02 | Add context | "@" inserted, `list_files_request`; the menu closes | H |
| ADD-03 | Browse the web | only with browser support; "@browser:" inserted | H; E 16 |
| ADD-04 | without browser support | exactly two rows | H (`?noBrowser`) |
| ADD-05 | window parity | 0 structural oracle rows | H (needs the official bundle) |

### 5.4 "/" menu (`forge/CommandMenu.vue`, rows in `ButtonArea.vue` `menuCommands`)

The list comes from the official `registerAction` registry. Test that every row
is present in its section and order, carries its label and description, shows
its trailing control, and **stays open or closes as the official does**.

| ID | Row (section) | Click → expected | Stays open | Covered | Add |
| --- | --- | --- | --- | --- | --- |
| SL-01 | Attach file… (Context) | file chooser; the chosen file becomes an attachment and reaches the turn | no | H | E: the file in the turn |
| SL-02 | Mention file from this project… | "@" inserted, file list | no | H | — |
| SL-03 | Rewind | the rewind picker (`RewindPicker`) → dialog → `rewind_code` dry run, then real | no | H; E 8 | — |
| SL-04 | Clear conversation | a new conversation in place | no | H | — |
| SL-05 | New conversation (filter only) | hidden until typed; a new conversation (side bar: in place; tab: new tab) | no | H | H: the tab case |
| SL-06 | Resume conversation (filter only) | hidden until typed; opens the sessions dropdown | no | H | — |
| SL-07 | Switch model… (Model), trailing: model name | opens the model menu; the trailing text is the current model | yes (hands off) | H | — |
| SL-08 | Effort (only when the model supports effort), trailing: slider | the row cycles the level; the slider sets it; `apply_settings {effortLevel}`; the label suffix updates; Ultracode only when the model lists `xhigh` and workflows are on | yes | U `effort`, `applySettings`; H; E 7 | H: every level + Ultracode on/off |
| SL-09 | Thinking, trailing: toggle | `set_thinking_level`; the thinking budget changes at the gateway | yes | U `thinkingLevel`; H; E 7 | — |
| SL-10 | Toggle fast mode (fast-capable models only) | `open_claude_in_terminal {prompt:'/fast', args:[], location:'bottom'}`; a terminal runs `claude /fast` | no | U `fastModeRow`, `terminalAvailable`; H | E: the terminal runs `/fast` |
| SL-11 | Output styles (Customize) | the picker (`get_output_style`); choose → `apply_settings {outputStyle}` (localSettings); "create" → the wizard → `create_output_style` | no | U `outputStyles`; H; E 11 | H: the wizard |
| SL-12 | MCP servers | Settings on MCP Servers (`open_forge_settings {tab:'mcp-servers'}`) | no | U `openForgeSettings`; H | E: the tab that opens |
| SL-13 | Hooks | Settings on Hooks | no | H | same |
| SL-14 | Permissions | the permission rules dialog (`list_permission_rules`) | no | H | — |
| SL-15 | Endpoints | Settings on Endpoints | no | H | — |
| SL-16 | Slash commands | Settings on Slash Commands | no | H | — |
| SL-17 | Manage plugins | Settings on Plugins | no | H | — |
| SL-18 | Open Forge in Terminal | `open_claude_in_terminal {location:'bottom'}`; a terminal named Forge runs the bundled CLI on the endpoint (TERM-*) | no | U `openClaudeInTerminal`, `terminalAvailable`; H; E 16 | — |
| SL-19 | Focus view (Settings), trailing: toggle | `set_focus_view`; the transcript shows only prompts and final answers, with fold rows | yes | U `focusView`; H | — |
| SL-20 | General config… | `open_config`: VS Code settings filtered to Forge | no | U `openConfigHelp`; H | — |
| SL-21 | View help docs (Support) | `open_help`: Settings on the Guide tab | no | U `openConfigHelp`, `guideTopics`; H | — |
| SL-22 | version row | `v<version>`, hidden while filtering; no "Report a problem" | — | U (step 33) | H: text equals `package.json` version |
| SL-23 | CLI slash-command rows | every command from the CLI's `initialize`; `context` and `usage` left out; aliases (`review`) per the official `Y55` rule; Enter sends, Tab inserts | — | U `slashCommands`, `commandMenuContextRows`; H `/compact`; E 4 | H: every row the stub lists |
| SL-24 | filtering | typing filters; "No matching commands"; filter-only rows appear | — | H | H: the empty state |
| SL-25 | keyboard | ↑↓ move, Enter runs, Esc closes, Tab on a command inserts | — | U (`useKeyboardNavigation` untested) | H + P2-4 |
| SL-26 | window parity | 0 structural | — | H (bundle needed) | — |

### 5.5 Model menu (`ModelSelect.vue`)

| ID | Behaviour | Expected | Covered | Add |
| --- | --- | --- | --- | --- |
| MOD-01 | rows | one row per endpoint+model pair that answered its last check | H; E 24 | — |
| MOD-02 | ping chip | fast / fair / slow tones from the last check | H | — |
| MOD-03 | refresh button | `sync_endpoint_health`; every endpoint re-checked; nothing picked | H; U `modelPickerHealth` | — |
| MOD-04 | Enter on the focused refresh | checks again, picks nothing | H | — |
| MOD-05 | pick a row | `set_model`; the pill shows it; the **next turn's** model id at the gateway | H; E 24 | E: switch mid-conversation (same `.jsonl`) |
| MOD-06 | the model in use is not answering | greyed with the reason; clicking does nothing | H (`?modelInUse=`) | — |
| MOD-07 | no models (`?models=none`) | the welcome / setup path | H | — |
| MOD-08 | Effort row inside the menu | as SL-08; hidden for a model without effort | H | — |
| MOD-09 | capability chips | "Max", "Ultracode", "Fast" only where the pair supports them | H | — |

### 5.6 Mode menu (`ModeSelect.vue`)

| ID | Row | Expected | Covered | Add |
| --- | --- | --- | --- | --- |
| MODE-01 | Expert | `set_expert_mode {enabled:true}`; `# Output Style: forge:Expert` in the next system prompt; survives a CLI kill; off → the CLI's reset notice | U `expertMode`; H; E 21 | — |
| MODE-02 | Manual | `set_permission_mode {default}`; every tool asks | H; E 26 | — |
| MODE-03 | Edit automatically | `acceptEdits`; edits run unasked, Bash still asks (unless CFG-04) | H; E 26 | — |
| MODE-04 | Plan | `plan`; the plan arrives as `ExitPlanMode`; nothing is written | H; E 6 | — |
| MODE-05 | Bypass permissions (setting off) | the confirmation modal; declining changes nothing; accepting writes CFG-03 and runs the next command unprompted | U `bypassGate`; E 20 (partial as root) | M |
| MODE-06 | Bypass row hidden | as root, and with a managed `disableBypassPermissionsMode: "disable"` | H (`?bypassPolicy=disable`); E 20 | — |
| MODE-07 | Shift+Tab | cycles Expert → Manual → Edit automatically → Plan → (Bypass when allowed) | H | — |
| MODE-08 | persistence | `persist_session_permission_mode`: the mode survives reopening the session | U `persistPermissionMode`; E 14 | — |
| MODE-09 | footer glyphs | `iconV2Small` in the footer, `iconV2` in the rows; bypass in deep red | U `bypassColour`; H | — |

### 5.7 Permission prompt (`PermissionRequestModal.vue`, `ToolPermissionView.vue`)

Run each prompt for **each tool kind**: Bash, Edit, Write, NotebookEdit,
WebFetch, an MCP tool, ExitPlanMode (the plan body) and a Hermes-scoped refusal.

| ID | Control | Expected | Covered | Add |
| --- | --- | --- | --- | --- |
| PRM-01 | 1 Yes (click and key `1`) | allowed once; no rule saved | H; E 6 | H: the key |
| PRM-02 | 2 Yes, don't ask again (click and key `2`) | allowed + the rule saved to the chosen destination | H; U `permissionRules`; E 6 | — |
| PRM-03 | option 2's destination picker | project local (`.claude/settings.local.json`) / project (`.claude/settings.json`) / user (`~/.claude/settings.json`): the rule lands in **that** file | U `permissionRules` | E: each destination (6 covers local only) |
| PRM-04 | 3 No (click and key `3`) | denied; the model is told | H | — |
| PRM-05 | the reject field | typed text is sent as the reason; Enter submits | — | H + E (the reason at the gateway) |
| PRM-06 | Esc | "Esc to cancel": denied, prompt closed | — | H |
| PRM-07 | fold button | Collapse / Expand the details | — | H |
| PRM-08 | Edit/Write | a diff is shown; the file opens beside (TODO.md item 5) | U `editorRequests` | H + E |
| PRM-09 | ExitPlanMode | the plan body; approving leaves Plan mode | U `planPreview`; E 6 | — |
| PRM-10 | plan comments | "Remove comment" on an inline comment | U `planPreview` | H |
| PRM-11 | a second prompt while one is open | queued, not lost | — | H + U |
| PRM-12 | window parity | 0 structural | H (bundle) | — |

### 5.8 Permission rules dialog (`PermissionRulesDialog.vue`)

| ID | Control | Expected | Covered | Add |
| --- | --- | --- | --- | --- |
| RUL-01 | open | `list_permission_rules`; allow / ask / deny per source | U `permissionRules`; H | — |
| RUL-02 | add a rule | `add_permission_rules` to the chosen destination file | U | H + E |
| RUL-03 | remove a rule | `remove_permission_rule`; gone from the file | U | H + E |
| RUL-04 | a managed rule | shown read-only, cannot be removed | — | U + H |
| RUL-05 | invalid rule text | refused with the reason | U | H |

### 5.9 Sessions dropdown (`forge/SessionsDropdown.vue`, the official `QW0`)

| ID | Control | Expected | Covered | Add |
| --- | --- | --- | --- | --- |
| SD-01 | list | `list_sessions_request`; newest first; archived hidden | H; E 3 | — |
| SD-02 | search by title | filters | H | — |
| SD-03 | search by git branch | filters on the branch | H; U `sessionBranchSearch` | — |
| SD-04 | rename (pencil) | `rename_session`; the title survives a reload | H; E 9 | — |
| SD-05 | archive | `archive_session`; gone from the list; in the session manager's Archived | H; E 9 | — |
| SD-06 | open a conversation | `get_session_request` + `launch_claude`; the transcript loads; the dropdown closes | H; E 3 | — |
| SD-07 | no unread dot, no unread row | as `QW0` | H | — |
| SD-08 | empty list, list error | "No sessions yet" | H | — |
| SD-09 | a session whose transcript is gone | resumes cleanly or says why | U `resumeWithoutTranscript` | E |

### 5.10 Message actions and rewind (`Messages/MessageActions.vue`, `RewindDialog.vue`)

| ID | Option | Expected (on disk) | Covered |
| --- | --- | --- | --- |
| MSG-01 | the options | Fork conversation from here / Rewind code to here / Fork conversation and rewind code | H |
| MSG-02 | Fork conversation from here | `fork_conversation`: a new `.jsonl`, opened | U `forkConversation`; H; E 8 |
| MSG-03 | Rewind code to here | dry run → confirmation listing the files → `rewind_code`; the files restored on disk | U `rewindCode`; H; E 8 |
| MSG-04 | Fork and rewind | both, in order | H |
| MSG-05 | no code changes | rewind disabled with the official explanation | H |
| MSG-06 | the first message | fork → a new conversation with the text in the composer | H |
| MSG-07 | cancel in the confirmation | nothing changed on disk | — (add H + E) |
| MSG-08 | copy a message | copied text equals the message's markdown | — (add H) |

### 5.11 Output styles (`OutputStylePicker.vue`, `OutputStyleWizard.vue`)

| ID | Control | Expected | Covered | Add |
| --- | --- | --- | --- | --- |
| OS-01 | the picker | built-ins, `forge:Expert`, project and user styles (`get_output_style_locations`) | U; H | — |
| OS-02 | pick | `outputStyle` in `.claude/settings.local.json`; the style in the next system prompt | U; E 11 | — |
| OS-03 | the wizard: create | `create_output_style`: the file written at the chosen location, selectable at once | U | H + E |
| OS-04 | the wizard: invalid name / existing name | refused | U | H |

### 5.12 Transcript (`Messages/*`, `blocks/*`)

Build **one fixture transcript per block type** in the mock host (P1-2) and check
each in the harness (render, oracle) and, where it depends on the CLI, in L4.

| ID | Block / behaviour | Expected | Covered | Add |
| --- | --- | --- | --- | --- |
| TR-01 | streaming text (`isPartialText`) | text grows in place; no flicker; the final text equals the `.jsonl` | U `streamingPartialText`, `smartStream` | H fixture |
| TR-02 | status dot (`p85`) | text-only messages get no dot; tool rows do; success / error / running colours | U `messageStatus` | H fixture |
| TR-03 | markdown | headings, lists, tables, links, inline code, blockquotes; raw HTML escaped | U `markdownExtensions` | H fixture incl. `<script>` (X-SEC-06) |
| TR-04 | code blocks | highlighted (`highlight.js`), copy button, language label | U `codeHighlight` | H |
| TR-05 | mermaid | rendered; the viewer opens, zooms, closes | — | H |
| TR-06 | thinking block | collapsed by default, expands; shown only when thinking is on | U (thinking) | H |
| TR-07 | image / document / opened-file / selection blocks | rendered; clicking opens the file | U `webviewPaths` | H |
| TR-08 | diagnostics block | the errors an edit introduced | U `editDiagnostics` | H |
| TR-09 | interrupt block | "Interrupted" after Stop | E 10 | H |
| TR-10 | LLM error / retry status | the endpoint's reason; retry countdown | U `chatErrors`, `retryStatus`, `toolErrorHints` | H + E (X-FAIL) |
| TR-11 | compact boundary | shown after `/compact` | E 4 | H |
| TR-12 | slash-command result | rendered as the official | — | H |
| TR-13 | subagent (Task) nesting | the subagent's tool calls nest under the Task row (TODO.md item 1) | U `subagentMessages` | H + E |
| TR-14 | TodoWrite | the checklist with states | — | H |
| TR-15 | focus view | only prompts + final answers; fold rows expand the hidden part | U `focusView` | H |
| TR-16 | tips / welcome card / wordmark | the empty chat | H; E 32 | — |
| TR-17 | long transcript | 500 turns scroll smoothly; memory stays bounded | — | X-PERF-02 |
| TR-18 | code-block links | a `file:line` link opens the file at the line | U `webviewPaths` | H + E |

**Tool renderers** (`components/Messages/tools/toolRegistry.ts`, 26 classes, no
spec imports it today). For each: the header line, the body, and the four
phases (`start`, `executing`, `complete`, `error`), plus a rejected call:

| ID | Renderer | Special checks |
| --- | --- | --- |
| TL-01 | Bash | the command highlighted; output collapsed after N lines; exit code; `TerminalBlock` |
| TL-02 | PowerShell | the PowerShell highlighter |
| TL-03 | Read | the path opens the file at the range |
| TL-04 | Write | the new file's content; opens in an editor |
| TL-05 | Edit | the diff (`DiffEditor`, `DiffLines`); red/green lines (TODO.md item 4) |
| TL-06 | NotebookEdit | the cell and the change |
| TL-07 | Glob | the pattern and the match count |
| TL-08 | Grep | the pattern, the path, the results |
| TL-09 | Search | as the official |
| TL-10 | ReadCoalesced | several reads folded into one row |
| TL-11 | WebFetch | the URL made safe (`safeUrl`) |
| TL-12 | WebSearch | the query and the results |
| TL-13 | TodoWrite | the checklist |
| TL-14 | Agent | the subagent header |
| TL-15 | AgentOutputTool / TaskOutput | the subagent's output |
| TL-16 | ExitPlanMode | the plan header ("Forge's plan") |
| TL-17 | Skill | the skill name |
| TL-18 | AskUserQuestion | the question and the options |
| TL-19 | ToolSearch | the query |
| TL-20 | REPL | the progress entries (`innerToolUseId`) |
| TL-21 | SandboxNetworkAccess | the host asked for |
| TL-22 | Artifact | as the official |
| TL-23 | MCP tool | `mcp__server__tool` shown as server › tool; the input/output rows |
| TL-24 | Chrome tools (19 actions: navigate, computer, find, read_page, tabs_*…) | per-action header text |
| TL-25 | Default | an unknown tool still renders its input and output |
| TL-26 | rejected call | the rejection reason (`rejectionReason`) |

Add: a unit spec over `toolRegistry.ts` (header text per tool and phase, pure
functions in node), and one harness fixture per renderer with the oracle (P1-2).

### 5.13 Banners, errors, notifications

| ID | Item | Expected | Covered |
| --- | --- | --- | --- |
| BAN-01 | the CLI exits | "Forge stopped unexpectedly (exit code N): <the CLI's own reason>" | U `chatErrors`; E 17, 20 |
| BAN-02 | View output logs | `open_output_panel` | H |
| BAN-03 | dismiss | the banner goes | H |
| BAN-04 | the CLI binary missing | the banner names it | E 17 |
| BAN-05 | `@browser` refused | "Couldn't attach a browser tab: <reason>"; the text back in the composer | H; E 16 |
| BAN-06 | `show_notification` | a VS Code toast with the given severity | U `settingsHandlers` |
| BAN-07 | a failed "/" row | the row's own error (`runHostAction`), never silence | U (step 31) |

### 5.14 Welcome and first run (`EndpointWelcome.vue`, `WelcomeCard.vue`)

| ID | State | Expected | Covered |
| --- | --- | --- | --- |
| WEL-01 | no endpoint | "Set up an endpoint"; nothing can be sent; nothing reaches `api.anthropic.com` | H; E 32 |
| WEL-02 | endpoints never checked | + "Check health" | H |
| WEL-03 | nothing answered | + "Skip to chat" (the composer anyway) | H |
| WEL-04 | some answered | the chat, no welcome | H |
| WEL-05 | "Set up an endpoint" | `run_endpoint_action {add}`: the setup flow (4.1a) | H; E 32 |
| WEL-06 | the endpoint chips | one per endpoint, with its detail | — (add H) |
| WEL-07 | "Use the terminal" | enabled; `open_claude_in_terminal`, no prompt, no args | H (`drive-health`) |
| WEL-08 | the first message after setup | answered; the gateway saw only the chosen model id | E 2 |

### 5.15 Plan preview page (`pages/PlanPreviewPage.vue`)

| ID | Control | Expected | Covered |
| --- | --- | --- | --- |
| PP-01 | open | `open_markdown_preview`: "Ready for review" | U `planPreview`; H (bundle) |
| PP-02 | select text → Add Comment | the comment box; Add Comment stores it (`get_plan_comments`) | U |
| PP-03 | Cancel | nothing stored | — (add H) |
| PP-04 | remove a comment | `remove_plan_comment` | U |
| PP-05 | close | `close_plan_preview` | U |
| PP-06 | the comments reach the model | the comment text in the next turn | — (add E) |

---

## 6. Session manager (left side bar, the official `KW0`)

Report 65 drove all of these in the harness and scenarios 9 and 22 ran them end
to end. Re-run them all.

| ID | Control | Expected | Covered |
| --- | --- | --- | --- |
| SM-01 | list | sessions, groups, section state | H; E 22 |
| SM-02 | collapse / expand the manager | `update_collapsed_panel_sections`; survives a reload with no flash | H; E 22 |
| SM-03 | New session | `reveal_chat {newConversation}` | H |
| SM-04 | search | folds out, filters, Esc folds away | H |
| SM-05 | New group (named inline) | `update_session_groups` | H |
| SM-06 | row menu | Resume session / New group from session / Add to group › / Mark as unread / Archive session | H |
| SM-07 | Add to group › | the group holds the row | H |
| SM-08 | collapse a group | stored | H |
| SM-09 | group menu | Start new session in this group / New group / Rename group / Delete group | H |
| SM-10 | Rename group | stored | H |
| SM-11 | Start new session in this group | the first message puts the new session in the group (count 2) | H; E 22 |
| SM-12 | multi-select (Ctrl+click) → New group from 2 sessions | both in the group | H |
| SM-13 | Remove from group | back to Ungrouped | H |
| SM-14 | drag a row onto a group | stored (synthetic drag in H) | H; **M** for a native drag |
| SM-15 | Mark as unread / read | `set_session_unread`; the dot; survives a reload | H; E 9 |
| SM-16 | Active · N | only unread rows | H |
| SM-17 | Filter by status | Status / Tabs sections with counts; a check keeps the menu open | H |
| SM-18 | Archive session | "Archived sessions 1" | H |
| SM-19 | expand Archived | `update_session_section_collapse_state` | H |
| SM-20 | archived row menu → Unarchive | back, pruned from every group | H |
| SM-21 | rename (pencil) | `custom-title` | H |
| SM-22 | Delete group | the group gone, sessions kept | H; E 22 |
| SM-23 | open a conversation | `reveal_chat {sessionId}`; the side bar hands off in < ~0.15 s | H; E 27 |
| SM-24 | no endpoint | the endpoint setup stands in the view | H |
| SM-25 | empty / error | "No sessions yet" | H |
| SM-26 | keyboard only | every row reachable and operable with Tab / arrows / Enter / Esc | — (add H, X-UI-05) |

---

## 7. Settings page: every tab, every control

`pages/SettingsPage.vue`, 16 tabs. Today the harness only opens each tab
(Section 1, item 4), so this section is almost entirely new work (**P1-1**).

**The recipe, for every control C at every scope S where C can be saved:**

1. Set C at S (User = `~/.claude/settings.json`; Project =
   `.claude/settings.json`; Local = `.claude/settings.local.json`; the active
   profile layer when a profile is selected).
2. **H**: the request (`update_setting {key, value, scope}` or the tab's own
   request) and a real answer.
3. **U/E**: the right key in the right file, and **no other file changed**.
4. Reload the window: the value is shown, with the right scope badge.
5. Set C at a lower scope: the effective value and the "inherited / overridden"
   hint are correct.
6. Reset C (`reset_setting`): the key is removed from that file only.
7. Invalid input (wrong type, out of range, a bad path, an empty required
   field): refused with a message, nothing written.
8. The effect reaches the CLI where it should (listed per control).

### 7.0 Page chrome

| ID | Control | Expected |
| --- | --- | --- |
| ST-00-01 | the tab list | 16 tabs in order: General, Models, Profiles │ Plugins, Environments, Memory and Rules │ Permissions, Sandbox, Network │ Hooks, Skills, Agents, MCP Servers, Slash Commands │ Endpoints │ Guide (footer) |
| ST-00-02 | open on a tab | `forge.openSettings <tab>` and every "/" row land on their tab (SL-12…17, SL-21) |
| ST-00-03 | scope tabs "Where changes are saved" | User / Project (shared) / Local; the title tooltip names the file |
| ST-00-04 | no workspace folder | the scope note shows; Project and Local are disabled; nothing is written to a workspace |
| ST-00-05 | profile selector | Default Profile / each profile / "Manage Profiles..." (→ Profiles tab); switching reloads the values |
| ST-00-06 | keyboard | Tab through every control; the focus ring is visible |
| ST-00-07 | the scoped preflight | Settings keeps its scoped Tailwind preflight; the chat has none (L0 gate) |

### 7.1 General (`SettingsTabGeneral.vue`)

| ID | Control | Kind | Key (expected) | Reaches the CLI as |
| --- | --- | --- | --- | --- |
| ST-GEN-01 | Default Permission Mode | dropdown | `permissions.defaultMode` | the mode of the next session |
| ST-GEN-02 | Extended Thinking | switch | `alwaysThinkingEnabled` | the thinking budget |
| ST-GEN-03 | Language | text | `language` | the reply language |
| ST-GEN-04 | Output Style | dropdown | `outputStyle` | the system prompt |
| ST-GEN-05 | Respect .gitignore | switch | `respectGitignore` | `@` search results |
| ST-GEN-06 | Teammate Mode | dropdown | per the CLI schema | — |
| ST-GEN-07 | Plans Directory | text | `plansDirectory` | where plans are written |
| ST-GEN-08 | Show Turn Duration | switch | per the CLI schema | the turn footer |
| ST-GEN-09 | System Notifications | switch | per the CLI schema | — |
| ST-GEN-10 | Completion Sound | switch | per the CLI schema | — |
| ST-GEN-11 | Git Attribution: Commit Message | text | `attribution.commit` | a commit the model makes |
| ST-GEN-12 | Git Attribution: PR Description | text | `attribution.pr` | — |
| ST-GEN-13 | Chat History: Cleanup period in days | number | `cleanupPeriodDays` | — |
| ST-GEN-14 | Updates Channel | dropdown | `autoUpdatesChannel` | — |
| ST-GEN-15 | ~~Login Method~~ | removed 2026-09-29 | `forceLoginMethod` | absent from the page and refused by the host (OOS-11) |
| ST-GEN-16 | ~~API Key Helper~~ | removed 2026-09-29 | `apiKeyHelper` | absent from the page and refused by the host (OOS-11) |
| ST-GEN-17 | extension config rows | `get_extension_config` / `update_extension_config` | the VS Code `forge.*` setting | — |

The exact key of every row is read from the component's `SettingsItem` binding
during the run and recorded in the report; the table's keys are the expected
ones from the Claude Code settings schema (`docs/CCSettings.md`).

### 7.2 Models (`SettingsTabModels.vue`)

| ID | Control | Expected |
| --- | --- | --- |
| ST-MOD-01 | each pair's "Show in the model menu" switch | the pair hidden / shown in MOD-01 |
| ST-MOD-02 | "Add an endpoint or a model" (both buttons) | `run_endpoint_action {add}` → the setup flow |
| ST-MOD-03 | a pair row → set as current | `set_model` |
| ST-MOD-04 | Always Thinking | switch; as ST-GEN-02 |
| ST-MOD-05 | Effort Level | dropdown; `effortLevel` in **User** settings; `reasoning_effort` at the gateway |
| ST-MOD-06 | Max thinking tokens | number; the thinking budget |
| ST-MOD-07 | Max output tokens | number; `max_tokens` at the gateway |
| ST-MOD-08 | precedence | a value in `~/.claude/forge.json` (flag settings) against the same key in user settings (B6, `docs/backend-wiring/settings-precedence.md`) |

### 7.3 Profiles (`SettingsTabProfiles.vue`)

| ID | Control | Expected |
| --- | --- | --- |
| ST-PRO-01 | the list | each profile; "In use" on the active one |
| ST-PRO-02 | switch | `switch_profile`; the CLI hot-reloads `forge.json` |
| ST-PRO-03 | New profile (name + submit) | `create_profile`; empty / duplicate / invalid names refused |
| ST-PRO-04 | Delete `<name>` | `delete_profile`; the active profile cannot be deleted, or falls back safely |

### 7.4 Plugins (`SettingsTabPlugins.vue`)

| ID | Control | Expected |
| --- | --- | --- |
| ST-PLG-01 | the catalog | `list_plugins`, `list_marketplaces`; search filters |
| ST-PLG-02 | Install → the scope chooser → user / project / local | `install_plugin` at that scope; Cancel changes nothing |
| ST-PLG-03 | enable / disable switch | `set_plugin_enabled`; the plugin's commands appear/disappear in "/" |
| ST-PLG-04 | Update | `update_plugin` |
| ST-PLG-05 | Uninstall | `uninstall_plugin` |
| ST-PLG-06 | the Marketplaces view | add (`add_marketplace`, a bad URL refused), refresh (`refresh_marketplace`), remove (`remove_marketplace`) |
| ST-PLG-07 | failures | the right button per failure kind: timeout / network (Retry), not_installed, not_found (Refresh and retry), disabled (Enable and update); the error dismisses |
| ST-PLG-08 | a plugin that needs to run a command | refused with its reason, never auto-approved |
| ST-PLG-09 | the external link | `open_url` with an http(s) URL only |

### 7.5 Environments (`SettingsTabEnvironments.vue`)

| ID | Control | Expected |
| --- | --- | --- |
| ST-ENV-01 | add a variable (name + value; the known-variables search) | `env.<NAME>` at the scope; the CLI's environment has it |
| ST-ENV-02 | edit / commit / cancel | written only on commit |
| ST-ENV-03 | override an inherited variable | written at this scope, the lower one untouched |
| ST-ENV-04 | remove | the key gone |
| ST-ENV-05 | Reset all | every `env` key at this scope removed, after a confirmation |
| ST-ENV-06 | invalid names | refused |
| ST-ENV-07 | secrets | a value is masked in the log (`loggingHygiene`) |

### 7.6 Memory and Rules (`SettingsTabMemoryAndRules.vue`)

| ID | Control | Expected |
| --- | --- | --- |
| ST-MEM-01 | User Memory → open | `~/.claude/CLAUDE.md` opens (created if missing) |
| ST-MEM-02 | Project Memory → open | `CLAUDE.md` in the workspace |
| ST-MEM-03 | Local Project Memory → open | `CLAUDE.local.md` |
| ST-MEM-04 | Agents → the Agents tab | `open_forge_settings {agents}` |
| ST-MEM-05 | Company Announcements (list) | `companyAnnouncements`; shown in the chat's tips |

### 7.7 Permissions (`SettingsTabPermissions.vue`)

| ID | Control | Expected |
| --- | --- | --- |
| ST-PER-01 | Permission Mode | `permissions.defaultMode` |
| ST-PER-02 | Bypass Mode Disabled | `permissions.disableBypassPermissionsMode`; hides MODE-05 |
| ST-PER-03 | Deny / Ask / Allow rules (list editors) | add, edit, remove; the prompt behaves accordingly (a denied tool is refused unasked) |
| ST-PER-04 | Additional directories | `permissions.additionalDirectories`; the model can read there |

### 7.8 Sandbox (`SettingsTabSandbox.vue`)

| ID | Control | Expected |
| --- | --- | --- |
| ST-SBX-01 | Enable Sandbox | `sandbox.enabled`; Bash runs sandboxed (where the platform supports it) |
| ST-SBX-02 | Auto-approve Bash when Sandboxed | `sandbox.autoAllowBashIfSandboxed` |
| ST-SBX-03 | Allow Unsandboxed Commands | the matching key |
| ST-SBX-04 | Excluded commands (list) | `sandbox.excludedCommands` |
| ST-SBX-05 | Allow Local Binding | `sandbox.network.allowLocalBinding` |
| ST-SBX-06 | Allowed Unix sockets (list) | `sandbox.network.allowUnixSockets` |
| ST-SBX-07 | HTTP / SOCKS proxy port | numbers, range-checked |

### 7.9 Network (`SettingsTabNetwork.vue`)

| ID | Control | Expected |
| --- | --- | --- |
| ST-NET-01 | HTTP Proxy / HTTPS Proxy / No Proxy | `env.HTTP_PROXY` / `env.HTTPS_PROXY` / `env.NO_PROXY`; the relay honours them (loopback never proxied) |
| ST-NET-02 | Client Certificate / Client Key / Key Passphrase | `env.CLAUDE_CODE_CLIENT_*`; the passphrase is a password field and never logged |
| ST-NET-03 | inherited values | shown as inherited from the lower scope |

### 7.10 Hooks (`SettingsTabHooks.vue`)

| ID | Control | Expected |
| --- | --- | --- |
| ST-HK-01 | Disable All Hooks | `disableAllHooks`; a hook no longer fires |
| ST-HK-02 | Add a Hook: every event in the dropdown | `hooks.<Event>[] = {matcher, hooks:[{type:'command', command, timeout}]}` |
| ST-HK-03 | matcher placeholder per event; events without a matcher | correct shape per event |
| ST-HK-04 | timeout 1–3600, empty = none | out of range refused |
| ST-HK-05 | the hook fires | E: a hook that writes a file runs on its event |
| ST-HK-06 | Remove | gone from the file |
| ST-HK-07 | "From Other Settings Files" | read-only list of hooks from other scopes |

### 7.11 Skills · 7.12 Agents · 7.14 Slash Commands (`ForgeItemsList.vue`)

| ID | Control | Expected |
| --- | --- | --- |
| ST-SK-01 | Create skill | CMD-27; the new row appears (Personal / Project badge) |
| ST-SK-02 | Add from folder… | CMD-28 |
| ST-SK-03 | a row | opens its `SKILL.md` |
| ST-AG-01 | Create agent | CMD-19; the Claude Code / Hermes badge; "In use" on the active Hermes agent |
| ST-AG-02 | a row | opens its file |
| ST-SC-01 | Create command | CMD-31 |
| ST-SC-02 | filter | filters the list |
| ST-SC-03 | refresh | re-asks the CLI (`sdk_probe`) |
| ST-SC-04 | each command | name, `argumentHint`, description as the CLI lists it |
| ST-XX-01 | loading / error + Retry / empty states | for all three tabs |

### 7.13 MCP Servers (`SettingsTabMCPServers.vue`)

| ID | Control | Expected |
| --- | --- | --- |
| ST-MCP-01 | Server Status | `get_mcp_servers`: each server with its status; "Probing…" then the result; the empty state |
| ST-MCP-02 | Refresh | re-probes |
| ST-MCP-03 | Add server | CMD-29 (`run_forge_action`) |
| ST-MCP-04 | Open project config / Open global config | `open_config_file`: `.mcp.json` / the user config |
| ST-MCP-05 | Auto-Approve All Project Servers | `enableAllProjectMcpServers` |
| ST-MCP-06 | Approved / Rejected servers (list editors) | `enabledMcpjsonServers` / `disabledMcpjsonServers` |
| ST-MCP-07 | Enterprise Policy: Allowed / Denied | read-only, "Managed" badge |
| ST-MCP-08 | MCP environment variables | the matching `env` keys |

### 7.15 Endpoints (`SettingsTabEndpoints.vue`, `EndpointHealthTable.vue`)

| ID | Button | Expected |
| --- | --- | --- |
| ST-EP-01 | Add (primary) | `run_endpoint_action {add}` → CMD-21 |
| ST-EP-02 | Select | → CMD-20 |
| ST-EP-03 | Edit | → CMD-22 |
| ST-EP-04 | Status | → CMD-23 |
| ST-EP-05 | Diagnostics | → CMD-24 |
| ST-EP-06 | Capabilities | → CMD-25 |
| ST-EP-07 | Models | → CMD-26 |
| ST-EP-08 | the health table | `get_endpoint_health`: each pair's last check, latency, error |
| ST-EP-09 | an unknown action | refused by the host |

### 7.16 Guide (`SettingsTabGuide.vue`, `guide/guideTopics.ts`)

| ID | Control | Expected |
| --- | --- | --- |
| ST-GD-01 | the overview | the five topics: conversation, skill, mcp, agent, use |
| ST-GD-02 | each topic | opens; its diagram renders |
| ST-GD-03 | copy buttons | the code block copied; "Copied" feedback |
| ST-GD-04 | action buttons | `run_forge_action` with a known id only; the action runs (CMD-19/27/29…) |
| ST-GD-05 | showcase | E 34 |

---

## 8. Host features

### 8.1 The request protocol (79 request types)

For **every** request in `ClaudeAgentService.ts`'s `switch`:

1. **B2, six places**: `messages.ts` types, `BaseTransport` method, dispatcher
   case, handler, mock-host answer, spec. `protocolDrift.spec.ts` and
   `stubsWired.spec.ts` check the first five mechanically.
2. **Happy path**: the response shape the webview reads.
3. **Rejection**: a missing field, a wrong type, an unknown enum value, an
   oversized string, `__proto__`/`constructor` keys, a path traversal in an id
   or a file name, a leading `-` in anything that reaches a CLI argument. Each
   must be refused **with no side effect** (X-SEC-01).

Coverage today (dedicated specs; the protocol-wide specs are left out of this
column):

| # | Request | Dedicated spec | H | Add |
| --- | --- | --- | --- | --- |
| REQ-01 | `init` | `claudeStateHandshake`, many | yes | — |
| REQ-02 | `get_claude_state` | `claudeStateHandshake`, `configResolver` | yes | — |
| REQ-03 | `sdk_probe` | `endpointModels`, `modelPickerHealth` | yes | — |
| REQ-04 | `get_mcp_servers` | **none** | — | spec + H (ST-MCP-01) |
| REQ-05 | `get_asset_uris` | **none** | — | spec |
| REQ-06 | `open_file` | `webviewPaths` | — | H (TR-07) |
| REQ-07 | `get_current_selection` | `editorSelection` | — | — |
| REQ-08 | `open_diff` | `editorRequests`, `webviewPaths` | — | H |
| REQ-09 | `open_content` | `editorRequests`, `channelControl` | — | H |
| REQ-10 | `show_notification` | `settingsHandlers` | — | — |
| REQ-11 | `new_conversation_tab` | **none** | — | spec + H (SL-05 in a tab) |
| REQ-12 | `rename_tab` | **none** | — | spec |
| REQ-13 | `open_url` | **none** | — | spec: http(s) only; `file:`, `command:`, `javascript:` refused |
| REQ-14 | `set_permission_mode` | `planPreview` | yes | spec: unknown modes; bypass without the setting |
| REQ-15 | `set_expert_mode` | `expertMode` | yes | — |
| REQ-16 | `persist_session_permission_mode` | `persistPermissionMode` | — | — |
| REQ-17 | `open_markdown_preview` | `planPreview` | — | — |
| REQ-18 | `get_plan_comments` | `planPreview` | — | transport method: `get_plan_comments` is not referenced in `BaseTransport.ts` (B2 check) |
| REQ-19 | `remove_plan_comment` | `planPreview` | — | — |
| REQ-20 | `close_plan_preview` | `planPreview` | — | — |
| REQ-21 | `set_model` | `effort`, `modelMetadata`, `endpointPair` | yes | — |
| REQ-22 | `get_applied_settings` | `effort`, `pendingMessages` | — | — |
| REQ-23 | `set_thinking_level` | `thinkingLevel`, `effort` | yes | — |
| REQ-24 | `apply_settings` | `applySettings` (whitelist `tu$`) | yes | — |
| REQ-25 | `list_permission_rules` | `permissionRules` | yes | — |
| REQ-26 | `add_permission_rules` | `permissionRules` | yes | — |
| REQ-27 | `remove_permission_rule` | `permissionRules` | — | H (RUL-03) |
| REQ-28 | `open_config_file` | `openConfigHelp`, `openForgeSettings` | — | H (ST-MCP-04) |
| REQ-29 | `open_forge_settings` | `openForgeSettings` | yes | — |
| REQ-30 | `open_config` | `openConfigHelp` | yes | — |
| REQ-31 | `open_help` | `openConfigHelp`, `guideTopics` | yes | — |
| REQ-32 | `open_output_panel` | `chatErrors` | yes | — |
| REQ-33 | `run_endpoint_action` | `openConfigHelp` | yes | spec: every action id + an unknown one |
| REQ-34 | `run_forge_action` | `customizations` | — | spec: every action id + an unknown one |
| REQ-35 | `list_forge_items` | `customizations`, `agentKinds` | yes | — |
| REQ-36 | `enable_bypass_permissions` | `bypassGate`, `bypassPermissions` | yes | — |
| REQ-37…45 | `list_plugins`, `list_marketplaces`, `install_plugin`, `uninstall_plugin`, `update_plugin`, `set_plugin_enabled`, `add_marketplace`, `remove_marketplace`, `refresh_marketplace` | `pluginManager`, `pluginHandlers` | list only | H: every button (ST-PLG) |
| REQ-46 | `get_endpoint_health` | `endpointHealth` | yes | — |
| REQ-47 | `sync_endpoint_health` | `settingsHandlers` | yes | — |
| REQ-48 | `reveal_chat` | `chatInTab`, `sessionGroups` | yes | — |
| REQ-49 | `get_settings` | `settingsHandlers`, `effort` | yes | — |
| REQ-50 | `update_setting` | **none dedicated** | — | spec: every scope, a key outside the schema, a wrong type, no workspace |
| REQ-51 | `reset_setting` | **none dedicated** | — | spec: removes only the key, only at that scope |
| REQ-52…54 | `switch_profile`, `create_profile`, `delete_profile` | `settingsHandlers` | — | H (ST-PRO) |
| REQ-55, 56 | `get_extension_config`, `update_extension_config` | `settingsHandlers` | yes | spec: a key outside `forge.*`; machine-scoped keys |
| REQ-57 | `list_sessions_request` | `archiveSession`, `renameSession` | yes | — |
| REQ-58 | `rename_session` | `renameSession` | yes | — |
| REQ-59 | `archive_session` | `archiveSession` | yes | — |
| REQ-60 | `unarchive_session` | `archiveSession`, `sessionGroups` | yes | — |
| REQ-61 | `set_session_unread` | `sessionUnread` | yes | — |
| REQ-62…66 | session groups and panel sections (5 requests) | `sessionGroups` | yes | — |
| REQ-67 | `rewind_code` | `rewindCode` | yes | — |
| REQ-68 | `fork_conversation` | `forkConversation` | yes | — |
| REQ-69…71 | `ensure_chrome_mcp_enabled`, `disable_chrome_mcp`, `create_new_browser_tab` | `browserIntegration` | yes | H: `disable_chrome_mcp` |
| REQ-72…74 | `get_output_style`, `get_output_style_locations`, `create_output_style` | `outputStyles` | partly | H (OS-03) |
| REQ-75 | `set_focus_view` | `focusView` | yes | — |
| REQ-76 | `get_session_request` | **none dedicated** | yes | spec: a bad id, a missing file |
| REQ-77 | `list_files_request` | `browserIntegration` | yes | spec: traversal, a huge tree, `.gitignore` |
| REQ-78 | `stat_path_request` | `webviewPaths` | — | — |
| REQ-79 | `open_claude_in_terminal` | `openClaudeInTerminal` (`JI0`), `terminalAvailable` | yes | — |

The channel messages outside `request` are tested the same way: `launch_claude`,
`close_channel`, `interrupt_claude`, `io_message`, `response`, `cancel_request`
(U `channelControl`, `hostMessageLoop`, `sdkMessageStream`). Also add: a
`cancel_request` for a request that already answered, and an `io_message` on a
closed channel.

The dispatcher cases that stay commented out (`get_auth_status`, `login`,
`submit_oauth_code`) are checked as **absent** (Section 9).

### 8.2 Settings layers and precedence

| ID | Check | Expected | Covered |
| --- | --- | --- | --- |
| LAY-01 | the write whitelist (`settingsWhitelist.ts`, the official `tu$`) | each key to its layer with its type; unknown keys refused | U `applySettings`, `settingsSafety` |
| LAY-02 | `forge.json` (flag settings) against user settings | a profile does not silently override the user's `effortLevel` (B6) | U `settingsFile`; doc `settings-precedence.md` |
| LAY-03 | the session flag layer | Ultracode and Expert are session-scoped, gone after the session | U `effort`, `expertMode` |
| LAY-04 | managed policy | managed keys win and show "Managed" | U (partly) → add E |
| LAY-05 | concurrent writes | two windows writing the same file: no lost update, valid JSON | — (add U) |
| LAY-06 | a malformed settings file | reported, never overwritten with defaults | — (add U + E) |

### 8.3 Model, effort, thinking, fast (B7: behaviour, not labels)

| ID | Check | Evidence | Covered |
| --- | --- | --- | --- |
| EFF-01 | each effort level reaches the gateway | `reasoning_effort` at the stub; `effortLevel` in User settings | U `effort`, `wireReasoning`; E 7 |
| EFF-02 | a level the model cannot run | downgraded to the model's highest | U |
| EFF-03 | Ultracode | effort `xhigh` + `apply_settings {ultracode:true}` in the session flag layer; another level clears the flag first | U `effort` |
| EFF-04 | thinking on / off | the thinking budget (`setMaxThinkingTokens`) changes; a reasoning block appears / does not | U `thinkingLevel`; E 7 |
| EFF-05 | reload keeps model, effort, thinking | same values after a window reload | E 14 |
| EFF-06 | fast mode | only for a fast-capable model; `claude /fast` in a terminal (SL-10) | U `fastModeRow`; H |

### 8.4 Permission modes, auto-approve, bypass

| ID | Check | Covered |
| --- | --- | --- |
| PERM-01 | the command risk classifier (`commandRisk/*`: tokenize, paths, shellUrlSafety) | U `commandRisk` (tokenize / paths / shellUrlSafety have no direct spec: add) |
| PERM-02 | chains: `cd … && git log … && grep … \| head` safe; `rm`, `sudo`, `git push`, `curl … \| sh`, `>` overwrite, `npm publish` ask | U `autoApprove`; E 26 |
| PERM-03 | Manual always asks, Plan unchanged, Bypass never asks | E 26, 20 |
| PERM-04 | the bypass gate as root / with the policy | U `bypassGate`; E 20 |
| PERM-05 | a repository cannot turn on CFG-03 / CFG-04 (machine scope) | U `settingsSafety` → add E |

### 8.5 Conversations on disk

| ID | Check | Covered |
| --- | --- | --- |
| CONV-01 | rename → `custom-title` in the `.jsonl` | U; E 9 |
| CONV-02 | archive / unarchive → the archive store; pruned from groups | U; E 9 |
| CONV-03 | unread → the unread store | U; E 9 |
| CONV-04 | groups → the group store; survive a reload | U; E 22 |
| CONV-05 | rewind → files restored; untracked new files removed; the dry run lists them exactly | U; E 8 |
| CONV-06 | fork → a new `.jsonl` with the history up to the message (`resumeSessionAt`) | U; E 8 |
| CONV-07 | resume → the follow-up in the **same** `.jsonl` | E 3 |
| CONV-08 | session ids validated before any filesystem access | U `untrustedInput` |
| CONV-09 | the session store watcher picks up sessions made in the terminal | — (add U `sessionStoreWatcher`) |

### 8.6 Browser integration (`chromeMcp.ts`, `chromeMcpClient.ts`)

| ID | Check | Covered |
| --- | --- | --- |
| BRW-01 | "Browse the web" only when supported | H; E 16 |
| BRW-02 | `@browser:new_tab` attaches `<browser tabGroupId tabId>` | H |
| BRW-03 | refusal → the reason in the chat, the text kept | H; E 16 |
| BRW-04 | a successful attach with Claude in Chrome | **M** (unverified: needs the extension and possibly a claude.ai login) |
| BRW-05 | `disable_chrome_mcp` | U → add H |

### 8.7 Output styles and Expert

Covered by OS-01…04 and MODE-01. Also add: a style file with bad frontmatter is
listed with an error, not dropped.

### 8.8 Following edits and proposed diffs

| ID | Check | Covered |
| --- | --- | --- |
| EDT-01 | a far edit: the file opens without focus, the line in view and marked, then fades | U `followEdits`; E 25, 29 |
| EDT-02 | a deletion point marked | E 29 |
| EDT-03 | three files in one turn: all stay open | E 29 |
| EDT-04 | the user typing elsewhere keeps focus and every keystroke | E 29 |
| EDT-05 | the chat in a tab: never covered | E 25 |
| EDT-06 | a proposed diff: accept / reject from the title bar (CMD-11/12, VIEW-04) | — (add U `proposedDiff` + E) |
| EDT-07 | edit diagnostics: new errors reported to the model | U `editDiagnostics` |

### 8.9 Terminal ("Open Forge in Terminal")

| ID | Check | Covered |
| --- | --- | --- |
| TERM-01 | every way in opens it and none is greyed or "(soon)": the "/" rows (SL-10, SL-18), the welcome's "Use the terminal" (WEL-07), the empty chat's card and its tip | U `terminalAvailable`; H (measured 2026-09-29, Section 1 item 3) |
| TERM-02 | the host validates `open_claude_in_terminal` like `JI0` (a bare slash command or `--resume <id>`, a `location`) and refuses anything else | U `openClaudeInTerminal` |
| TERM-03 | a terminal named Forge runs the bundled CLI; its `ANTHROPIC_BASE_URL` is the local relay | E 16 |
| TERM-04 | Claude Code's first-run screens only: no "custom API key" question, no unknown-model notice; the Forge banner and status line | E 16 (filmed in `report/terminal/`) |
| TERM-05 | a turn in the terminal is answered by the endpoint (the gateway log) | E 16 |
| TERM-06 | with no endpoint, it refuses with a message instead of starting a CLI; never "Please run /login" | launch-gate Phase 1 item 8 → add E |
| TERM-07 | a session started in the terminal shows up in the history (`sessionStoreWatcher`) | — (add E) |
| TERM-08 | Windows: PowerShell, cmd and Git Bash as the default terminal | M |

### 8.10 Plugins, 8.11 customizations

Covered by ST-PLG-* and CMD-27…31 / ST-SK / ST-AG / ST-SC / ST-MCP. The
extra host checks: a marketplace URL that is not http(s) or a git remote is
refused (U), and `pluginManager` never runs a plugin's install command without
the permission prompt (U).

### 8.12 Hermes agents (`src/services/agents/*`)

| ID | Check | Covered |
| --- | --- | --- |
| HRM-01 | the loader: frontmatter, tools, MCP globs, warnings for bad files | U `agentKinds` (+ `loader` has no direct spec: add) |
| HRM-02 | scope: only the allowed builtins are offered to the CLI | U; E 28 (Read, Grep, Glob; no Bash, Edit, Write) |
| HRM-03 | a disallowed tool call is refused with `agentRefusal` | U → add E |
| HRM-04 | MCP allow-list by server and tool glob | U `matchesGlob` → add spec |
| HRM-05 | the agent prompt and memory reach the system prompt | E 28 |
| HRM-06 | the agent's own model / endpoint (CFG-14) | — (add E) |
| HRM-07 | a live turn | L `hermesAgentE2E` |

### 8.13 Endpoints (`src/services/endpoints/*`)

| ID | Area | Covered | Add |
| --- | --- | --- | --- |
| EP-01 | discovery of local servers | U `discoverEndpoints` | — |
| EP-02 | the setup flow | U `endpointSetupFlow`, `addEndpoint` | E (4.1a) |
| EP-03 | auth: bearer, custom header, `exec` helpers, the keychain (`secretStore`) | U `secretStore`, `endpointProfile` | E: no token in `settings.json` or `Forge.log` |
| EP-04 | profiles and pairs | U `endpointProfile`, `endpointPair` | — |
| EP-05 | URL normalisation | U `endpointUrls` | — |
| EP-06 | health checks, the store, the periodic sync | U `endpointHealth`, `modelPickerHealth`, `fastHealthCheck` | — |
| EP-07 | the model list and gating | U `endpointModelList`, `endpointModels` | — |
| EP-08 | the diagnostic ladder | U `endpointDiagnostics` | — |
| EP-09 | capability detection | U (partly) | E (CMD-25) |
| EP-10 | the relay (the local Anthropic-shaped server the CLI talks to) | U `wireServer` | — |
| EP-11 | the transport: proxy, timeouts, retries (`spawnRetry`, `transport.ts`) | U (partly) | U: `probeClient.ts`, `transform.ts` have no direct spec |
| EP-12 | the endpoint rules | U `endpointRules` | — |
| EP-13 | the key in the keychain survives a restart | U `secretStore` | M |
| EP-14 | a live gateway | L `endpointE2E` | — |

### 8.14 The wire bridge (OpenAI ↔ Anthropic, `endpoints/wire/*`)

| ID | Area | Covered |
| --- | --- | --- |
| WIRE-01 | requests translated (`toOpenAI`): tools, tool choice, images, system prompt | U `wireBridge`, `wireForceTool` |
| WIRE-02 | the SSE stream translated back (`fromOpenAI`, `SseDecoder`) | U `wireBridge` |
| WIRE-03 | reasoning (`reasoning_content`, effort mapping) | U `wireReasoning` |
| WIRE-04 | tool-name and argument repair; JSON repair | U `wireToolRepair` |
| WIRE-05 | tool calls written as text (vLLM parsers) | U (partly: add `textToolCalls` cases) |
| WIRE-06 | truncation (Ollama context) and its advice | U `wireTruncation` |
| WIRE-07 | repetition detection | U `wireRepetition` |
| WIRE-08 | `cache_control` kept or stripped per capability | U (add `caching` spec) |
| WIRE-09 | upstream errors → Anthropic errors with hints (401, 404, 429, 500, transport) | U (add `errors`/`errorHints` status table) |
| WIRE-10 | `count_tokens` | U |

### 8.15 Small-model guards (`src/forge-sdk/*`)

| ID | Guard | Covered |
| --- | --- | --- |
| GRD-01 | loop guard: cycle detection, thresholds per level | U `loopGuard` |
| GRD-02 | repeat guard | U `repeatGuard`, `repeatLoop` |
| GRD-03 | stop gate | U `stopGate` |
| GRD-04 | smart stream (tool output filtering, full-output store) | U `smartStream` |
| GRD-05 | edit diagnostics | U `editDiagnostics` |
| GRD-06 | failure hints | U `toolErrorHints` |
| GRD-07 | the hook server and the CLI settings it writes | U `guardHookServer`, `guardHooks` |
| GRD-08 | levels per profile | U |
| GRD-09 | the whole chain against the real CLI | L `cliGuardsE2E`, `hookRewriteProbe` |
| GRD-10 | the layer rule: no `vscode`, no `src/services` imports | U `forgeSdkLayer` |

### 8.16 Session lifecycle and robustness

| ID | Check | Covered |
| --- | --- | --- |
| LIFE-01 | the watchdog restarts a stuck session | U `sessionWatchdog` |
| LIFE-02 | spawn retry | U `spawnRetry` |
| LIFE-03 | pending inputs across a relaunch | U `pendingMessages` |
| LIFE-04 | channels: open, close, interrupt, cancel | U `channelControl` |
| LIFE-05 | the CLI killed mid-turn → the reason shown; the next message relaunches | E 21 (kill) → add a mid-turn kill |
| LIFE-06 | 20-turn soak, 6-tab soak (CLI process count back to baseline) | E 18, 19 |
| LIFE-07 | the host message loop survives a malformed message | U `hostMessageLoop`, `hostRobustness` |

### 8.17 IDE context

| ID | Check | Covered |
| --- | --- | --- |
| IDE-01 | selection → `<ide_selection>` | U; E 5 |
| IDE-02 | opened files | U `ideContext` |
| IDE-03 | diagnostics | U `editDiagnostics` |
| IDE-04 | uploads: images, PDFs, text; size limits | U `attachmentTypes` |

### 8.18 Packaging and install

| ID | Check | Covered |
| --- | --- | --- |
| PKG-01 | the universal VSIX carries both binaries and both ripgreps, the right kind | `lint:dist:universal`, U `packaging`, `packagingTarget` |
| PKG-02 | the execute bit restored on Linux | E 23 |
| PKG-03 | `import.meta` in the bundle | U `bundleImportMeta` |
| PKG-04 | webview assets and CSP | U `webviewAssets` |
| PKG-05 | `release:check`, all eight steps | the release script |
| PKG-06 | install on Windows desktop VS Code | **M** |

---

## 9. Out of scope: prove absence

From `CLAUDE.md` and `docs/backend-wiring/out-of-scope.md`. Each row passes
only when the control is **absent** from the UI and the request is not
dispatched.

| ID | Feature | Must be absent | Check |
| --- | --- | --- | --- |
| OOS-01 | Microphone / speech-to-text | the mic button; `start_speech_to_text` / `stop_speech_to_text` | H: no `.micButton` in the composer; U: no dispatcher case |
| OOS-02 | Login / Switch account | the `login` row; `login`, `get_auth_status`, `submit_oauth_code` stay commented out | H + U |
| OOS-03 | Account & usage | the `account-usage` row; `/usage` | H: not in "/" (even filtered) |
| OOS-04 | Usage / context meter | the footer meter; `/context` | H |
| OOS-05 | Remote Control | the row and `/remote-control` | H |
| OOS-06 | Feedback | "Report a problem", `/feedback`, `/bug` | H (the version row alone) |
| OOS-07 | Thumbs rating | no thumbs | H |
| OOS-08 | Switch models when flagged | no row | H |
| OOS-09 | `/btw` | no row | H |
| OOS-10 | Worktree pill, `generate_session_title` | absent (not in either list) | H |
| OOS-11 | "Login Method" (`forceLoginMethod`) and "API Key Helper" (`apiKeyHelper`) in Settings › General | removed (the user's decision, 2026-09-29): no row on the page; `update_setting` / `reset_setting` refuse both keys at every layer | U `accountSettingsRemoved`; H (measured: Advanced shows only Updates Channel) |

Add: one harness step that asserts all of these at once, including while
filtering the "/" menu with each name (P1-6).

---

## 10. Cross-cutting

### 10.1 Security: the webview is untrusted (B3)

| ID | Check |
| --- | --- |
| X-SEC-01 | a generated fuzz over all 79 requests (from `messages.ts`): hostile payloads refused with no side effect (no file written, no process spawned, no setting changed) |
| X-SEC-02 | no route from the webview to an arbitrary process: `handleExec` is not reachable from a request; `open_claude_in_terminal` accepts only `JI0` shapes |
| X-SEC-03 | `open_url` / links: only http(s); `command:` URIs never run |
| X-SEC-04 | paths: every file request stays inside the workspace or the Claude config dirs |
| X-SEC-05 | a repository's `.vscode/settings.json` cannot set machine / application keys (`cliArgs`, `environmentVariables`, `endpoints`, bypass, auto-approve) |
| X-SEC-06 | markdown: `<script>`, `onerror=`, `javascript:` links in a model reply are inert (CSP + sanitising) |
| X-SEC-07 | secrets: no token in `settings.json`, `Forge.log` or a report |
| X-SEC-08 | an untrusted folder: nothing from its `.claude` runs (ACT-01) |

### 10.2 Failure injection

Extend the stub gateway (P1-5) so each of these is scriptable, then run each
from a fresh message and check the chat's text and the recovery:

| ID | Failure | Expected |
| --- | --- | --- |
| X-FAIL-01 | connection refused / reset | a clear message; the next message works once it is back (E 17) |
| X-FAIL-02 | 401 / 403 | "the key was refused"; never "Please run /login" |
| X-FAIL-03 | 404 model | names the model |
| X-FAIL-04 | 429 with `retry-after` | the retry status counts down, then retries |
| X-FAIL-05 | 500 / 502 / 503 | retried within the budget, then the reason |
| X-FAIL-06 | malformed SSE, a truncated JSON tool call | repaired or a clear error; no hang |
| X-FAIL-07 | a stream that stalls for 60 s | the timeout fires; Stop works |
| X-FAIL-08 | a drop mid-reply | the partial reply kept; a clear error |
| X-FAIL-09 | a cold local model that takes 20 s to load | the setup check does not falsely fail it |
| X-FAIL-10 | the CLI binary missing / not executable | the banner (E 17, 23) |
| X-FAIL-11 | a disk-full or read-only `~/.claude` | the write fails with the reason; nothing is corrupted |

### 10.3 Persistence and reload

Everything the user sets must survive a window reload and a VS Code restart:
model, effort, thinking, mode, output style, focus view, Expert (per session),
session titles, archive, unread, groups, collapsed sections, the Settings scope
tab, the draft in the composer. E 14 covers the first four and E 9/22 the
session ones. Add a single "reload everything" scenario that sets all of them,
reloads and reads each back.

### 10.4 Layout, themes, accessibility

| ID | Check |
| --- | --- |
| X-UI-01 | dark, light, high contrast dark, high contrast light: every window legible, contrast ≥ 4.5:1 for text |
| X-UI-02 | a theme switch mid-session restyles without losing state (E 30) |
| X-UI-03 | widths 300, 380, 600, 800, 1200 px: no horizontal scroll; the footer controls don't overlap (CMP-18) |
| X-UI-04 | `prefers-reduced-motion`: no animation; nothing stuck mid-transition |
| X-UI-05 | keyboard only: every control in every window reachable and operable; focus visible; Esc closes the top popup only |
| X-UI-06 | screen reader names: every icon button has an `aria-label` (a lint over the templates) |
| X-UI-07 | fonts: every computed `font-family` is a bundled Forge face (lint:brand + the oracle) |
| X-UI-08 | zoom 80%–200% (`window.zoomLevel`) |

### 10.5 Performance and soak

| ID | Check |
| --- | --- |
| X-PERF-01 | first paint of the chat under 1 s after the view opens (measured in E) |
| X-PERF-02 | a 500-turn transcript: scroll and typing latency; webview memory |
| X-PERF-03 | a 50,000-file workspace: `@` search answers under 1 s |
| X-PERF-04 | 20 turns (E 18) and 6 tabs (E 19): no leaked CLI processes, no `[error]` in the log |
| X-PERF-05 | the side-bar → chat hand-off under ~0.15 s (SM-23) |

### 10.6 Platform matrix

| Platform | Host | Layers |
| --- | --- | --- |
| Linux x64 (glibc) | code-server 4.105 + headless Chromium | L0–L5 (automated here) |
| Windows x64 | desktop VS Code | L4 (`e2e/launch.mjs --code`), L6 |
| Windows shells | PowerShell, cmd, Git Bash as the default terminal | M |
| Paths | spaces and non-ASCII in the workspace path and the home folder | E (run the kit with such a `--root`) + M |
| No workspace folder | setup, Settings, the chat | E |
| Two windows, two workspaces | a workspace-scoped endpoint in one | M |
| musl Linux | the refusal message (no musl binary) | U |

---

## 11. Gaps to build, by priority

### P0: without these, the results can't be trusted

| ID | What | Where | Done when |
| --- | --- | --- | --- |
| P0-1 | Row clicks must not depend on the official stylesheet. Give `drive-all.mjs` a `--no-oracle` mode (or catch the oracle's error per window and record it as "oracle not run") so every functional row runs anyway | `.claude/skills/ui-parity/scripts/drive-all.mjs` (the `oracle()` helper); `probe-planpreview.js` | in this container, drive-all reports every row with a real verdict and "oracle: not run" |
| P0-2 | ~~Terminal-paused expectations~~ **Done 2026-09-29**: the pause was reverted instead, so `drive-all.mjs`'s expectations (both rows send `open_claude_in_terminal`) are right again | — | both rows proven in the harness (Section 1 item 3) |
| P0-3 | Make the official bundle available to test runs (or record its absence as a skip reason in every report), so the 27 `OFFICIAL_DIR` tests and the oracle can run | environment / CI | the skips are 0 where the bundle is present |

### P1: features with no test at all

| ID | What | Where | Done when |
| --- | --- | --- | --- |
| P1-1 | **The Settings driver**: every control in Section 7, through the 8-step recipe, in the harness; and one e2e scenario that checks the files for a sample of each tab | new `scripts/drive-settings.mjs`; mock-host `update_setting` / `reset_setting` writing an in-memory layered store; `e2e/scenarios.mjs` | every ST-* row has a verdict |
| P1-2 | **Transcript fixtures**: one mock-host transcript per block type (TR-*) and per tool renderer × phase (TL-*), driven and oracled; plus a unit spec over `toolRegistry.ts` headers | `harness/mock-host.js` (`?transcript=<name>`); `test/toolRenderers.spec.ts` | every TR/TL row has a verdict |
| P1-3 | **The palette sweep**: an e2e scenario that runs all 31 commands from the palette with and without a folder / an endpoint, plus unit specs for the 17 commands with none (Section 4.1) | `e2e/scenarios.mjs`; `test/commands.spec.ts` | every CMD row has a verdict |
| P1-4 | Specs for the 8 requests with no dedicated spec: `get_mcp_servers`, `get_asset_uris`, `new_conversation_tab`, `rename_tab`, `open_url`, `update_setting`, `reset_setting`, `get_session_request` (rejection cases included) | `test/*.spec.ts` | 8 new specs green |
| P1-5 | **Failure injection** in the stub gateway: status codes, `retry-after`, malformed SSE, stalls, mid-stream drops; and a scenario per X-FAIL row | `e2e/stub-gateway.mjs` (`/__control`), `e2e/scenarios.mjs` | every X-FAIL row has a verdict |
| P1-6 | **Absence check** for Section 9 in one harness step | `drive-all.mjs` | every OOS row has a verdict |
| P1-7 | **Composer input** in the harness: Shift+Enter, IME, paste, drop, chip deletion, draft persistence (CMP-02…09, 16, 17) | `drive-all.mjs` | every CMP row has a verdict |
| P1-8 | **Hostile-payload fuzz** over all 79 requests, generated from `messages.ts` (X-SEC-01) | `test/requestFuzz.spec.ts` | green, with each request's refusal listed |
| P1-9 | The remaining keybinding, views and walkthrough rows (KEY-05, VIEW-04/05/08, WT-*) | e2e | verdicts |
| P1-10 | Proposed diffs end to end (CMD-11/12, VIEW-04, EDT-06) | U `proposedDiff` + e2e | verdicts |

### P2: depth

| ID | What |
| --- | --- |
| P2-1 | Unit specs for the untested pure modules: `commandRisk/tokenize`, `commandRisk/paths`, `commandRisk/shellUrlSafety`, `endpoints/probeClient`, `endpoints/transform`, `wire/caching`, `wire/errors` + `errorHints` (a status table), `agents/loader` (`matchesGlob`, `resolveAgentsDir`), `sessionStoreWatcher` |
| P2-2 | Webview logic in node: `models/contentParsers`, `core/SettingsStore`, `composables/useCompletionDropdown`, `useTriggerDetection`, `useKeyboardNavigation`, `utils/keyNormalize`, `KeybindingManager` (pure TS, testable without a DOM) |
| P2-3 | A theme × width matrix screenshot run (X-UI-01, 03) with the oracle per cell |
| P2-4 | A keyboard-only pass over every window (X-UI-05), and an `aria-label` lint (X-UI-06) |
| P2-5 | The "reload everything" scenario (10.3) |
| P2-6 | Performance probes (X-PERF-01…03) with thresholds that fail the run |
| P2-7 | The copy check on `forge.endpointStatus` (CMD-23) (OOS-11 is decided and done) |
| P2-8 | Raise the eslint headroom (389 of 390) before adding test helpers, or keep new helpers warning-free |

---

## 12. Manual checklist: Windows VS Code, the user's gateway

These are the steps no automation here can reach. Run them in the isolated
VS Code the kit launches:
`node .claude/skills/ui-parity/e2e/launch.mjs --code "<Code.exe>" --gateway http://localhost:20128/v1 --model auto/best-fast --auth-env OMNIROUTE_KEY --keep`.
Every step is **unverified** until you tick it.

| # | Step | Expected result |
| --- | --- | --- |
| 1 | Run the whole kit (all scenarios) | the report shows 0 FAIL; 16 and 20 PASS rather than partial (Windows has no root check) |
| 2 | Mode menu → Bypass permissions → Allow; send `run :: echo hi > bypass.txt` (with `--stub`) | `forge.allowDangerouslySkipPermissions: true` in `User/settings.json`; `bypass.txt` exists; no prompt appeared |
| 3 | With the Claude in Chrome extension running: "+" → Browse the web → New tab → send | the turn carries a browser tab; the model can read the page (BRW-04) |
| 4 | Permission prompt option 2 → each destination in turn | the rule in `.claude/settings.local.json`, `.claude/settings.json`, `~/.claude/settings.json` respectively |
| 5 | Settings › Endpoints → Add → a gateway with a bearer key | the key is in Windows Credential Manager; `settings.json` holds only `${secret:…}`; no key in the Forge output |
| 6 | Restart VS Code; send a message | answered with the stored key (EP-13) |
| 7 | Drag a session onto a group in the session manager with the mouse | the group holds it after a reload (SM-14, a native drag) |
| 8 | Open a workspace whose path has a space and a non-ASCII character; send `write <path> :: x` | the file is written there |
| 9 | Set the default terminal to PowerShell, then cmd, then Git Bash; send `run :: echo %CD%` / `pwd` | each runs and the output is shown |
| 10 | Two windows, two workspaces, one with a workspace-scoped `forge.endpointProfile` | each window uses its own pair (the gateway log's model ids) |
| 11 | High Contrast theme; side bar dragged to ~300 px | every window legible; the footer controls do not overlap |
| 12 | `pnpm run release:check` on a clean checkout | eight passes; the smoke install goes through desktop VS Code |
| 13 | "/" → Open Forge in Terminal; then the welcome page's "Use the terminal"; then the empty chat's "Open Forge in Terminal." link | each opens a terminal named Forge in the bottom panel; Claude Code's first-run screens only (no "custom API key" question); the Forge banner; a message typed there is answered through the endpoint; never "Please run /login" |
| 14 | Pick the fast-capable pair → "/" → Toggle fast mode | a terminal runs `claude /fast` |

---

## 13. Execution order and reporting

**Order.** Each phase must finish with a report before the next starts. A FAIL in
an earlier phase is fixed first, because the later layers run on top of it.

1. **P0 fixes** (11: P0-1, P0-3; P0-2 is done). Without them the harness proves nothing here.
2. **L0–L2** as they stand: `pnpm run verify`, `pnpm run build`. Record the counts and every skip.
3. **L3, existing coverage**: `drive-all.mjs` + `drive-health.mjs` → Sections 5, 6 (rows marked H).
4. **L1/L3, new coverage**, in this order: P1-4 (request specs), P1-8 (fuzz),
   P1-6 (absence), P1-7 (composer), P1-2 (transcript), P1-1 (Settings). Each lands with its rows' verdicts.
5. **L4**: the full kit with `--stub` on Linux, then P1-3 (palette), P1-5
   (failures), P1-9, P1-10, the "reload everything" scenario.
6. **L5**: the env-gated specs against a real CLI and a real gateway.
7. **L6**: Section 12, by the user on Windows.
8. **P2** items, then a final full pass of every layer on one build.

**The report** goes to `docs/backend-wiring/results/test-run-<date>.md`:

1. Build facts: commit, versions (the SDK, the bundled CLI, VS Code / code-server), the counts per layer, every skip and why.
2. The B9 table, one row per ID:
   `ID | row | request | host result | UI effect | evidence | verdict`.
3. Counts per verdict, per section.
4. The rows left out and why (Section 9, and anything unsupported for the model or host).
5. What was not run, and why ("the oracle was not run: no official bundle").
6. The Section 12 checklist with the steps still unverified.

Never round a partial result up to "works".
