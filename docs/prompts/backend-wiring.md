# Prompt: wire Forge's backend to the new official-clone frontend

> **Scope and order are set in `CLAUDE.md` ("Current task"), which wins over this file.**
> Out of scope there: the microphone, and everything under Account & cloud (login / Switch account,
> Account & usage and the context meter, Remote Control, Report a problem / feedback), plus thumbs
> rating, flagged-message model switching, `/btw` and Ultracode. The SDK is upgraded (rule B5)
> rather than worked around, so read Part C as settled.

Use the `ui-parity` skill. Read `CLAUDE.md` first. Its rules are binding, rule 7
most of all: every button's window must work like the official one, row for row.

## 0. Context you need before touching anything

**What Forge is.** A VS Code extension (`C:\Users\med-a\Music\Claudix`). The
webview is Vue 3 (`src/webview/src`). The extension host is TypeScript
(`src/services`, `src/extension.ts`). It runs the Claude Code CLI through
`@anthropic-ai/claude-agent-sdk` **0.1.77** (package.json says `^0.1.76`).

**The reference.** `C:\Users\med-a\Music\Real_Claude_Code_VSCODE_extension_files\`
is the real Claude Code extension, v2.1.270:
- `webview/index.js` is the component spec and the webview→host protocol. It is
  minified React. Grep it, and don't guess.
- `extension.js` is the host implementation. Every `case"<request_type>"` in it
  is the official handler for that request.
- `webview/index.css` is the style spec.

**What changed on the frontend (already built, and it passes `pnpm run build`).**
The composer, its menus, the permission prompt, the sessions dropdown and the
transcript now use the official DOM, classes and copy:

| Surface | Forge file | Official source |
| --- | --- | --- |
| `+` menu | `components/forge/AddMenu.vue` | `pV0` (module Lu5mZA) |
| `/` command menu | `components/forge/CommandMenu.vue`, rows built in `components/ButtonArea.vue` (`menuCommands`, `runCommand`) | `TV0` + `registerAction(...)` registry |
| Model picker + pill | `components/ModelSelect.vue` | `HF1` pill, `aV0` popup, `H75` rows, `QF1` effort row |
| Mode button/menu | `components/ModeSelect.vue`, `components/forge/ModeIcon.vue` | `$H0` |
| Effort slider / toggle | `components/forge/EffortSlider.vue`, `ToggleSwitch.vue` | `ko` (P1HaRA), `Xj` (0c4GDA) |
| Permission prompt | `components/PermissionRequestModal.vue` | `y5` (qlaBag), `gT` contenteditable |
| Past conversations | `components/forge/SessionsDropdown.vue` (opened from the header clock in `pages/ChatPage.vue`) | `QW0` + `At` + `V95` |
| User message | `components/Messages/UserMessage.vue`, `components/forge/ExpandableText.vue` | `g85`, `xq0` |
| Assistant message | `components/Messages/AssistantMessage.vue` | `u85`, status `p85` |
| Markdown | `components/Messages/blocks/TextBlock.vue` | `r$` (-a7MRw), copy button `US` (CEmTFw) |

The official only registers a row when its host can do the job. Forge follows
the same rule, so **rows with no Forge backend were left out.** Your job is to
build those backends and then add the rows back, exactly as the official has them.

---

## Part A: frontend defects to fix first (small, measured, not yet fixed)

1. **The app doesn't fill the webview.** The official has
   `#root{display:flex;flex:1;min-width:0;max-width:100%}`, but Forge mounts on
   `#app` and has no such rule. Measured in the harness: body 460px, `#app` 412px.
   That's why the sessions dropdown clips off the left edge (it uses the
   official right-anchor formula). Add the rule for `#app` in
   `styles/forge-fonts.css`, next to the other official globals.
2. **The Slash Commands section is always empty.** `ButtonArea.vue` accepts a
   `slashCommands` prop, but `ChatInputBox.vue` never passes it. The official
   source is `claudeConfig.value.commands` (`qz0(J.commandRegistry, commands, ...)`;
   `context` opens the context view, `usage` runs `account-usage`, and anything
   else inserts `/${name}`).
3. **Streaming text is never marked partial.** `TextBlock.vue` has an
   `isPartialText` prop that implements the official `wL0` rule, but
   `ContentBlock.vue` never passes it. Pass the content wrapper's partial flag.
4. **The assistant status dot doesn't follow the official rule.**
   `AssistantMessage.vue` defaults to `dotSuccess`. The official
   `p85(message, busy)` only returns a status for messages that contain a
   `tool_use`:
   - no tool result and not busy: `failure`
   - no tool result and busy: `progress`
   - `toolResult.is_error`: `failure`
   - otherwise: `success`
   - a text-only message: `null` (no dot class at all)

   It needs the tool_use→tool_result link and the session's `busy` flag.
5. **The header glyphs aren't the official ones.** The clock and new-chat
   buttons in `ChatPage.vue` are codicons. Extract the real glyphs with
   `extract-icons.mjs` (pairs are `ComponentName=bundleFn`).

---

## Part B: backend work, surface by surface

The format for each item: the UI row, then the official request (webview→host),
then the official host implementation (`extension.js`), then what Forge has
today, then what to build.

Forge's request dispatcher is the `switch` in
`src/services/claude/ClaudeAgentService.ts` (around lines 660–810). Request and
response types live in `src/shared/messages.ts`. Webview transport methods live
in `src/webview/src/transport/BaseTransport.ts`. Handlers live in
`src/services/claude/handlers/handlers.ts`.

### B1. Dispatcher cases that are commented out (the UI already calls one)
- `open_claude_in_terminal`: **the "/" menu row "Open Claude in Terminal"
  currently throws `Unknown request type`.** Uncomment it.
  `handleOpenClaudeInTerminal` now sends `claude`, not `claude --help`.
  - Official request: `{type:"open_claude_in_terminal", prompt?, args?, location?}`.
  - The official validates with `JI0`: `prompt` may only be a bare slash
    command, and `args` may only be `[]` or `["--resume", <sessionId>]`.
  - The official host runs `claude-vscode.terminal.open` with a named terminal,
    the extension icon and `location` (`"bottom"` from the menu). Match that.
- `login`, `get_auth_status`, `submit_oauth_code`: needed by "Switch account".
  The official is `{type:"login", method}`, with auth-URL callbacks and
  `submit_oauth_code {code}`.

### B2. Effort (the effort row in "/", the effort row in the model picker, the pill label)
- **Today Forge records effort but it changes nothing.** `ChatPage.handleEffortSelect`
  calls `session.setThinkingLevel(level)`. The host's
  `ClaudeAgentService.getMaxThinkingTokens` returns `0` for `off` and `31999`
  for everything else.
- Official webview: `setEffortLevel(level)` becomes
  `applySettings({effortLevel: level})`, sent as
  `{type:"apply_settings", settings, flagsOnly?, scope?}`.
- Official host: `applySettings` validates against a whitelist
  (`tu$ = { effortLevel:{layer:"userSettings"}, ultracode:{layer:"flags"},
  switchModelsOnFlag:{layer:"userSettings"}, outputStyle:{layer:"localSettings"},
  remoteControlAtStartup:{layer:"userSettings"} }`) and rejects any other key.
  It then writes the user settings and pushes them to the running CLI.
- The CLI takes effort as `--effort <level>`, as env `CLAUDE_CODE_EFFORT_LEVEL`,
  or from the `effortLevel` setting (low | medium | high | xhigh), optionally
  capped by `maxEffortLevel`.
- **Build:**
  - an `apply_settings` request with the same whitelist and validation;
  - persist `effortLevel` to `~/.claude/settings.json`;
  - apply it to new queries (`--effort` through the SDK's extra args or env)
    and to the running channel if the SDK allows, or restart the query on the
    next turn and document that.
  - Keep "Ultracode" (`xhigh` plus the flag) out unless the CLI supports it.
  - Then make the webview's effort state separate from `thinkingLevel`.
- Levels shown today are `low | medium | high | xhigh | max`
  (`components/forge/effort.ts`). **Check `max` against the settings enum**,
  which lists only low/medium/high/xhigh. The official takes the levels from
  `model.supportedEffortLevels`, and when the model doesn't support effort it
  unregisters the row (`effort-level`). Do the same: hide the slider when the
  model has no effort support.

### B3. Thinking toggle ("/" → Model → Thinking)
- Official: `setThinkingLevel(on ? "off" : "default_on")` sends
  `{type:"set_thinking_level", thinkingLevel}`.
- The host's `setThinkingLevel` computes a budget and display mode from
  settings (`getShowThinkingSummariesSetting`) and calls
  `query.setMaxThinkingTokens(budget, display)`, or `0`. It also persists the
  level.
- Forge only calls `setMaxThinkingTokens(0 | 31999)`. Add persistence and the
  summaries display once effort is separate (B2).

### B4. Model picker data
- Forge's `sdk_probe` with `capabilities:["supportedModels"]` returns
  `{type:"sdk_probe_response", data:{supportedModels:[...]}}`.
  `ModelSelect.vue` reads `data.supportedModels[].{value, displayName, description}`.
- Those entries must look like the official's: `displayName` e.g.
  "Default (recommended)", and `description` e.g.
  "Sonnet 5 · Efficient for routine tasks" (the pill shows the part before " · ").
- Keep SDK order.
- Add `supportsEffort` / `supportedEffortLevels` per model (B2) and
  `unavailable_models` (the official greys those rows with
  `unavailableModelItem`).
- Check that `set_model` handles `default` together with `lastServedModel`
  the way the official `wC(...)` does.

### B5. "/" command menu: rows to add back, each with a working backend
Row definitions are copied from the official registry (id / label / description
/ section / flags). Add each to `menuCommands` in `ButtonArea.vue` only after
its backend works:

| id | Label | Section | Flags | Official request / behaviour |
| --- | --- | --- | --- | --- |
| `rewind` | Rewind | Context | | opens the rewind flow; `{type:"rewind_code", userMessageId, dryRun}` → host `query.rewindFiles(id,{dryRun})` → `{canRewind, filesChanged, insertions, deletions, skippedLinks}`; confirm dialog `mo` |
| `resume-conversation` | Resume conversation | Context | filterOnly | opens past conversations |
| `switch-models-on-flag` | Switch models when a message is flagged | Model | toggle, keepMenuOpen | setting `switchModelsOnFlag` (userSettings); only when `experimentGates` allow (`NM1`) |
| `account-usage` | Account & usage… | Model | | `{type:"open_account_usage"}` / `{type:"get_usage"}` → host `query.usage_EXPERIMENTAL...` |
| `fast` | Toggle fast mode | Model | | only when `currentModelSupportsFastMode`; runs `openClaudeInTerminal("/fast", [], "bottom")` |
| `output-style` | Output styles | Customize | | `get_output_style` → `{outputStyle, availableStyles}`; `create_output_style`, `get_output_style_locations` |
| `mcp-config` / `hooks-config` / `permission-rules` / `plugins` | MCP servers / Hooks / Permissions / Manage plugins | Customize | | **today:** all open the Forge Settings page on General via `open_config_file` `command:forge.openSettings`. **Build:** open the matching Settings tab (add a tab argument to `forge.openSettings` and to `webViewService.openEditorPage`) |
| `login` | Switch account | Settings | | B1 |
| `remote-control-at-startup` | Enable Remote Control for all sessions | Settings | toggle, keepMenuOpen | `apply_settings {remoteControlAtStartup}` + `{type:"toggle_remote_control", enable}` |
| `toggle-focus-view` | Focus view | Settings | toggle, keepMenuOpen | `{type:"set_focus_view", enabled}`; the transcript then shows only prompts and responses |
| `/remote-control`, `/btw`, `/feedback`, `/bug` (filterOnly) | | Slash Commands | | official ids `eV.remoteControl`, `eV.btw` (`side_question`), `eV.feedback`, `eV.bug` |

Rows already live, and what to finish on each:
- `config` "General config…": the official is `{type:"open_config", searchString}`,
  which runs `workbench.action.openSettings` with the search. Forge uses
  `open_config_file "vscode"`. Add `open_config`.
- `help` "View help docs": the official is `{type:"open_help"}`, which opens
  `https://code.claude.com/docs/en/vs-code`. Forge uses `open_url` with the
  same URL. Fine, or add `open_help`.
- "Report a problem" in the version row: the official opens a feedback dialog
  and sends `{type:"submit_feedback", channelId, description}`. Forge opens
  logs (`command:forge.showLogs`). Build the dialog and the request.
- The version text shows the `package.json` version (Forge 0.1.0).
- **Security:** `handleOpenConfigFile` now accepts `configType:"command:<id>"`
  for an allow-list (`forge.openSettings`, `forge.showLogs`,
  `forge.newConversation`). Replace it with typed requests. Never let the
  webview run arbitrary commands.

### B6. "+" menu
- "Upload from computer" works (file input, then `addAttachment`).
  "Add context" inserts `@`.
- "Browse the web" is hidden because Forge has no browser integration. The
  official shows it when `browserIntegrationSupported` and inserts
  `@browser:`. Its backend is `ensure_chrome_mcp_enabled`,
  `create_new_browser_tab` and `disable_chrome_mcp`. Only add it if you build
  that; then pass `browser-integration-supported` to `AddMenu`.

### B7. Permission prompt
- **Option 2 isn't the official one.** Forge shows the static text
  "Yes, and don't ask again". The official shows `L45` there: the suggestion
  plus a **destination link** (`destinationLink`, dotted underline) that picks
  where the rule is saved.
  - Read `L45` in `index.js` for the exact copy and the destination values
    (`session` / `localSettings` / `projectSettings` / `userSettings`).
  - Persist with `{type:"add_permission_rules", rules, behavior, destination}`.
    The related requests are `list_permission_rules` and
    `remove_permission_rule`.
- **Verify the plan-mode labels.** Forge relabels to "Yes, and auto-accept" /
  "No, keep planning" whenever the session is in plan mode. In the official,
  that flag (`G`) belongs to the ExitPlanMode request, and option 2 then reads
  "Yes, and manually approve edits". When the user types feedback (`U`), the
  reject label becomes "Send feedback and keep planning".
- `persist_session_permission_mode {sessionId, mode, previousSessionId,
  carriedFromStore}` keeps the mode per session.

### B8. Past conversations dropdown
- **Today:** it lists `store.sessionsByLastModified`, searches the title
  (summary, or "Untitled"), highlights matches, shows relative time
  (y/mo/d/h/m/now) and opens a session on click. **Not built yet:**
  - **Rename** (the official row action "Rename session", `bn` icon):
    `{type:"rename_session", sessionId, title}`. The host appends
    `{"type":"custom-title","sessionId","customTitle"}` to the session's
    `.jsonl` transcript.
  - **Archive / Unarchive** (`H21` / `B21` icons):
    `{type:"archive_session"|"unarchive_session", sessionId}`, stored in
    extension settings. Archived sessions go under an "Archived sessions"
    group header.
  - **Unread / status dot** (`vG`, rendered at the start of the row when
    `openState` is set): `{type:"set_session_unread", sessionKey, unread}`,
    plus open/working/needs-input state. The old `SessionsPage.vue` already has
    local unread tracking (`loadUnread` / `toggleUnread`); move it to the
    backend.
  - **Search by git branch:** the official also matches
    `session.gitBranch` (case-insensitive). `list_sessions_response` must
    include `gitBranch`.
  - "Loading sessions…" needs the official spinner glyph `JW0`.
  - Also: `worktree` pill ("Open <name> in new window", `open_folder_in_new_window`)
    and `generate_session_title {channelId, description}` for automatic titles.
  - Clicking a row: the official only closes the dropdown for local sessions.

### B9. Transcript
- **User message actions** (`HU0`, the "Message actions" button with the
  rewind-arrow icon, shown on hover). Its options:
  - "Fork conversation from here": `{type:"fork_conversation",
    forkedFromSession, resumeSessionAt}` returns `{sessionId}`. The host uses
    `forkSession`.
  - "Rewind code to here": `rewind_code` (B5).
  - "Fork conversation and rewind code".

  The SDK has `rewindFiles`, `forkSession`, `resumeSessionAt` and
  `enableFileCheckpointing`. Turn on file checkpointing when launching queries.
  The button is omitted until this works.
- **Assistant feedback thumbs** (`WU0`): `{type:"message_rated", channelId,
  ...}`. The official hides them unless analytics is enabled and
  `experimentGates.tengu_vellum_siding`. Forge should leave them out; state
  that as a decision.
- The status dot needs the tool_use→tool_result link and `busy` (Part A.4).

### B10. Composer controls that are still missing
- **Microphone:** `{type:"start_speech_to_text", channelId}` /
  `stop_speech_to_text`, with a stream and audio-level handler. The official
  ships `resources/audio-capture` (a native binary) and only shows the mic when
  `speechToTextEnabled`. The DOM classes (`micButton`, `micIcon`,
  `micTooltip...`) are ported and unused.
- **Usage meter** in the footer (`YH0`, class `usageButtonV2`): it gets
  `usedTokens`, `contextWindow - maxOutputTokens - 13000` and `onCompact`.
  Official: `{type:"get_context_usage"}` → `query.getContextUsage()`, and
  `request_usage_update`. **SDK 0.1.77 has no `getContextUsage`.** Either
  upgrade (Part C) or compute it from `result.usage` in the stream.

---

## Part C: SDK version

Checked in `entrypoints/sdk/runtimeTypes.d.ts` of the installed 0.1.77:

- **Present:** `supportedModels`, `setMaxThinkingTokens`, `setModel`,
  `setPermissionMode`, `rewindFiles`, `forkSession`, `resumeSessionAt`,
  `enableFileCheckpointing`.
- **Absent:** `getContextUsage`, `getSettings`, `applyFlagSettings`, and any
  effort option.

Decide between upgrading the SDK (check the changelog for breaking changes to
the message stream Forge parses) and implementing the missing pieces through CLI
flags, env and settings files. Write the decision down in `docs/`.

---

## Part D: how to prove it works (required, per rule 6 and rule 7)

1. Run `pnpm run build`. All gates must pass (`lint:brand`, `lint:tokens`,
   `lint:commands`).
2. Harness: `node .claude/skills/ui-parity/scripts/harness.mjs --port 8735`,
   then open `http://127.0.0.1:8735/index.html` (`?page=sessions|settings` for
   other pages). Wait 3s and confirm `cssRules.length > 0`.
3. For every new request, extend
   `.claude/skills/ui-parity/harness/mock-host.js` so the harness answers it
   the way the real host does (it already answers `sdk_probe`, and has
   `__forgeSeedPermission()` and `__forgeChannelId()`).
4. **Click every row of every window** (`+`, `/`, model picker, mode menu,
   permission prompt, sessions dropdown, message actions). For each one, record
   the request sent, the state change, and whether the menu stays open or
   closes (`keepMenuOpen`).
5. Run the oracle on each open window:
   `window.__oracle={root:'<selector>'}; eval(await (await fetch('/probes/probe-oracle.js')).text())`.
   Structural diffs must be 0. Colour diffs are expected (brand).
6. Test in real VS Code as well: install the built extension and run each row
   against the real CLI. The harness can't prove the backend.
7. Report as a table (**row | request | host result | UI effect | verdict**),
   with counts, plus the list of rows still left out and why. Don't say
   something works unless it was clicked.

## Part E: don't break these

- **Colour:** every colour goes through `styles/forge-tokens.css`. Forge is
  Pajamas purple where Claude Code is orange; nothing else differs.
- **Fonts:** Anthropic Sans (text) and GitLab Mono (code) are bundled. No
  system font, ever. The global `button{font-family:var(--forge-font-sans)}`
  rule exists because buttons fell back to Arial.
- **No Tailwind preflight on the document.** Only the Settings page keeps a
  scoped copy (`styles/forge-settings-preflight.css`, generated by
  `scripts/gen-settings-preflight.mjs`).
- **Don't add scoped `<style>` overrides to ported official classes.** Ported
  CSS is regenerated by `node scripts/port-official-css.mjs`; add new modules
  to its `MODULES` table instead.
- **Webview input is untrusted.** Validate every request the way the official
  does (whitelists like `tu$`, validators like `JI0`, session-id checks).
- The composer's star/effort legend was removed at the user's request. Don't
  bring it back.
