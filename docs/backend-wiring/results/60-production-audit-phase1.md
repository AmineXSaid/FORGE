# Production audit, Phase 1: the release blockers

Branch `claude/endpoint-model-health-ebc111`, on top of `fa01783` (which had
already started items 1–3: the startup write removed, `exec` gone, profile
names, the Settings-page whitelist, `update_extension_config`, `open_url`,
`get_session_request`, `sdk_probe`, the machine scopes). The official
extension 2.1.270 was on disk for every B1 check below
(`../Real_Claude_Code_VSCODE_extension_files`, from the `other-files` branch).

Where it ran: a Linux container. Headless Chromium drove the harness. There is
no VS Code and no Windows here, so nothing below was observed in real VS Code.

## Results

| # | Row | Request / code path | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | Startup | `ConfigurationService.initialize` | writes only `~/.forge.json` and `~/.claude/forge.json`; `settings.json` untouched (spec: byte-identical, and not created) | — | works (spec) |
| 1 | Launch defaults | `forgeLaunchDefaults` → forge.json and the launch env (`mergeLaunchEnvironment`, lowest layer, after `whenReady`) | a key or variable the user sets anywhere is left out | — | works (spec) |
| 1 | Settings writes | `readJsonObjectForWrite` / `writeJsonAtomic` (`settingsFile.ts`), used by the config service **and** `apply_settings` (effort), which still had the `{}` bug | an unparseable file is refused and left byte-identical; writes are temp + rename, with a retry for a Windows rename lock | — | works (spec) |
| 2 | `exec` | removed from all six places | — | — | works (spec) |
| 2 | `open_file`, `open_diff`, `open_content`, `stat_path_request` | `webviewPaths.ts` | UNC, device, URI, NUL, empty and oversized input refused before any search or `stat`; `stat_path` answers `other` for them | — | works (spec, harness stub mirrors it) |
| 2 | `open_url`, `get_session_request`, profiles, `update_setting`/`reset_setting`, `update_extension_config`, `sdk_probe` | from `fa01783` | refusals as specified | — | works (spec) |
| 3 | Workspace trust | `package.json` | `cliArgs`, `endpoints`, `environmentVariables`, `endpointProfilesDir` machine-scoped; `untrustedWorkspaces.supported:false`, as the official declares | — | works (spec) |
| 3 | Bypass via `forge.cliArgs` | `SETTING_OWNED_FLAGS` in `cliArgs.ts` | both bypass flags refused with "set forge.allowDangerouslySkipPermissions instead"; `getAllowDangerouslySkipPermissions` reads only the setting | — | works (spec) |
| 4 | Error banner | `close_channel {error}` → `session.error` | `describeLaunchError`: platform, missing binary, exit code, signal; aborts Forge caused are not reported | the official `errorBanner` markup (`index.js`), "View output logs" (`open_output_panel`, new), "Troubleshooting resources", × dismiss | works (spec + harness, oracle 0 structural) |
| 4 | Failed session load | `get_session_request` error | — | the official "Couldn't open this session." + Retry (`loadFailed`), Retry reloads | works (spec + harness, oracle 0 structural) |
| 5 | Ctrl+Esc / Ctrl+N | `forge.sideBarActive` | set from the side-bar chat views' visibility (`SideBarActiveTracker`) | — | works (spec); keypress unverified |
| 6 | Select Agent | `forge.activeAgent`, `agentsDir`, `agentEndpoints` | declared; no-folder write goes to user settings | — | works (spec); command unverified |
| 7 | Permission prompt, panel closed | `onDidDisposeWebview` → `settleRequestsOf` | pending `tool_permission_request` resolves as deny | — | works (spec) |
| 7 | Unhandled rejections | message loop, stall notice, output loop, `reveal_chat` close, `watchUnhandledRejections` | all caught; Forge-owned rejections logged to the Forge channel | — | works (spec) |
| 8 | `rename_tab` | official `panelTab.title=GX(title)` | retitles the editor panel (200 code points) | tab mode: sent on summary change | works (spec + harness) |
| 8 | `get_mcp_servers` | official `mcpServerStatus()` minus `claude-vscode`, `{error}` on failure | — | — | works (spec) |
| 8 | `get_asset_uris` | official `context.asAbsolutePath` | resolves under the extension | — | works (spec) |
| 8 | `openNewInTab` | official `!!panelTab` | true for an editor-tab chat only; a broadcast push keeps it | side bar: New conversation starts over in place; tab: sends `new_conversation_tab` | works (spec + harness) |
| 8 | "/" New conversation, header New session | official `if(!startNewConversationTab())createSession()`; "Clear conversation" is always in place | `new_conversation_tab` opens `forge.editor.open` | as above | works (harness) |
| 9 | Packaging | `package` = verify → build (`--target win32-x64`) → `lint:dist:win32` → `vsce --target win32-x64` | `check-dist --target` checks claude.exe (MZ, >10 MB, alone), ripgrep, forge-plugin, repository, CHANGELOG, the ignore rule | — | works (spec on fixtures); **VSIX not built here** (Linux has no Windows binary) |
| 9 | ripgrep | `resources/ripgrep/x64-win32/rg.exe`, `resolveRipgrep` | the path was three folders above `dist/`; now under the extension, else `rg.exe` on PATH (as the official) | — | works (spec); search unverified in VS Code |
| 9 | Non-Windows | `unsupportedPlatformMessage` at activation | one error message, and the banner text on launch | — | works (spec) |
| 10 | Logging | 80 log calls + 2 UI strings in English; per-message lines at trace; stderr by the CLI's `[LEVEL]`; env dump and config probe summarised | `LogService` floor is Trace, so the channel's own level decides | webview no longer logs every host message | works (spec) |
| 11 | ESLint | `vue-eslint-parser`, `curly: multi-line`, `no-control-regex` | 0 errors (was 1345), 390 `any` warnings capped by `--max-warnings 390`; `lint` in `build` and `verify` | — | works |
| 12 | Drift guard | `protocolDrift.spec.ts` | every `WebViewRequest` has a dispatcher case and a mock-host case (except the 3 out-of-scope auth requests); every host push is in `ExtensionRequest` (+`select_settings_tab`, `extension_config_changed`) | the mock host now answers 12 requests it used to fall through on, with real shapes and the real validation | works (spec) |

**Counts:** works 25 (by spec and/or harness) · partial 0 · broken 0 · not
built here: the VSIX itself (needs Windows).

## Gates

- `pnpm test`: 2328 passed, 8 skipped (the two endpoint E2E suites, which
  need `FORGE_E2E_BASE_URL` and a key). 89 files.
- `pnpm run typecheck:all`: clean.
- `pnpm run lint`: 0 errors, 390 warnings (all `no-explicit-any`, capped).
- `pnpm run build` (lint, lint:brand, lint:tokens, lint:commands, webview,
  extension): passes.
- `node scripts/check-dist.mjs`: passes. `--target win32-x64` fails here, as
  it should: there is no `claude.exe` on Linux.

## Oracle

| Window (root) | Checked | Structural diffs | Colour |
| --- | --- | --- | --- |
| `.fg-chat__errorBanner` (CLI exit) | 6 | 0 | 0 |
| `.fg-chat__errorBanner` (load failed, Retry) | 7 | 0 | 0 |

The first run of the second row showed `opacity 0.7` on the × button: the
pointer was resting on it from the previous click (`:hover`). Moved away, 0.

## Specs added

`settingsFile`, `webviewPaths`, `chatErrors`, `contextKeysAndSettings`,
`hostRobustness`, `stubsWired`, `packagingTarget`, `loggingHygiene`,
`eslintGate`, `protocolDrift`, plus `test/helpers/officialBundle.ts` (specs
that compare with the official bundle find it next to the checkout or in
`FORGE_OFFICIAL_DIR`, and are reported as skipped without it; the one that
read `C:/Users/med-a/...` now uses it).

## Decisions and divergences

- **Restricted Mode:** kept `supported:false` from `fa01783` rather than the
  plan's "limited": the official declares exactly that, and in SDK mode the
  CLI runs the folder's hooks and MCP servers with no trust prompt of its own.
- **Stricter than the official, on purpose** (recorded in `docs/forge-design.md`):
  `open_url` schemes, the path rules, refusing an unparseable `settings.json`
  in `apply_settings`, the bundled ripgrep.
- **`new_conversation_tab`** opens an empty tab: Forge's request has no
  `sessionId` and `forge.editor.open` takes no arguments (the fork-into-a-tab
  branch is still not ported, as step 25 recorded).

## VS Code checklist for the user (unverified until run)

1. Put a `// comment` in `~/.claude/settings.json`, reload VS Code, choose an
   effort level. **Expected:** an error notice; the file is byte-identical.
2. Delete `~/.claude/settings.json`, start VS Code with Forge. **Expected:** the
   file is not re-created; `~/.claude/forge.json` has `attribution`,
   `skipWebFetchPreflight` and the three env variables.
3. Rename `resources/native-binary/claude.exe` in the installed extension and
   send a message. **Expected:** the red banner: "The Claude Code binary is
   missing from this Forge install (…). Reinstall the Forge extension."
   "View output logs" opens the Forge channel.
4. Open a folder whose `.vscode/settings.json` sets `forge.cliArgs:
   {"dangerously-skip-permissions": true}`. **Expected:** VS Code greys the
   setting ("machine"), the mode menu offers no Bypass.
5. Open the chat in a tab (Ctrl+Shift+Esc), send a message. **Expected:** the tab
   title becomes the conversation's summary; New session opens a second tab.
6. With the side-bar chat showing and focus in it, press Ctrl+Esc.
   **Expected:** focus returns to the editor.
7. Run "Forge: Select Agent" with no folder open. **Expected:** no error; the
   choice lands in user settings.
8. Type `@` and a file name in the composer. **Expected:** files are listed (the
   bundled `rg.exe`); the Forge channel at Trace shows no `rg` spawn error.
9. `pnpm run package` on Windows. **Expected:** `forge-win32-x64.vsix`, with
   `extension/resources/native-binary/claude.exe` and no
   `extension/resources/claude-code/` inside (`vsce ls`).
