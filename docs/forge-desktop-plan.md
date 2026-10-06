# Forge Desktop — plan

A Windows desktop app for Forge, built in Rust: to the Forge VS Code extension what the
Claude Code desktop app (its **Code** tab) is to the Claude Code VS Code extension. Same agent,
conversations and features, in its own window, with no editor host. Forge's name, logo,
Pajamas colours and fonts (Anthropic Sans, GitLab Mono) stay.

This is a plan only. Nothing in `src/` was changed to write it.

## 0. The decision in brief

| | |
| --- | --- |
| **Architecture** | **Tauri 2 (Rust) + the existing Vue webview + a Node sidecar running Forge's existing TypeScript host** (option a). That is the shape Claude Desktop has too: a web UI plus the Agent SDK in a Node process (§2.3). |
| **Why** | 110 of the 139 host files already have no runtime path to `vscode` (§1.4). The agent protocol (38 control-request types, `canUseTool`, hooks, sessions, rewind) lives in `@anthropic-ai/claude-agent-sdk`, which only runs in Node. The endpoint relay is 8.7k lines of Node. Rewriting any of it buys about 60–90 MB of RAM and costs months, then ongoing drift. |
| **Staging** | M1 runs the unchanged host behind a small `vscode` compatibility shim, so you can chat on day one. M3 replaces the shim with real host interfaces, keeping the VS Code build green throughout. Rust gets the parts that are Rust-shaped: windows, tray, menus, toasts, Credential Manager, dialogs, single instance and the IPC router. |
| **Milestone 1** | A Tauri window, a folder picker, the sidecar, `TauriTransport`: chat with the real CLI in the chosen folder (§4.5). |

### How this was researched

| Source | What it is | Cited as |
| --- | --- | --- |
| This repo at `4c7834c` (branch `ultimate_02`) | Forge | `path:line` |
| The uploaded `claude-desktop-ui.7z` | Claude Desktop **1.24012.11** (`package.json` `"version"`), Electron app.asar contents | `desktop:<path>` |
| `code.claude.com/docs/en/desktop`, fetched 2026-10-06 | The official Code-tab reference | `docs#<anchor>` |
| `@anthropic-ai/claude-agent-sdk@0.3.274` `sdk.d.ts` (via `npm pack`) | The SDK Forge pins (`package.json:1128`) | `sdk.d.ts:line` |

**Could not verify:**
- `../Real_Claude_Code_VSCODE_extension_files/` is not in this workspace, so nothing here is checked against the official VS Code bundle.
- The Claude Desktop **Code tab's renderer UI is not in the archive**: `desktop:.vite/renderer/main_window/index.html:1` reads *"this is the html for app title bar and error UI. everything else gets loaded from claude.ai"*. Its features are verified from the main process and its typed IPC names. Its exact pixels and markup are verified only as far as the docs describe them. Everything visual that is not in the docs is marked **assumed**.
- No Windows machine was available. Every Windows behaviour below is a plan, not an observation.

---

## 1. Forge today (Step 1 findings)

### 1.1 Startup

`activate()` (`src/extension.ts:18-141`) runs these steps in order:

1. Set sidebar context keys (`:22`).
2. Build the DI container (`:25-31`), registering 16 services (`src/services/serviceRegistry.ts:36-79`). Four of them take the `vscode.ExtensionContext`: WebView `:62`, Endpoint `:69`, EndpointHealth `:73`, ClaudeSdk `:76`. Test mode is `ExtensionMode.Test` (`:40`).
3. Log, then run an advisory `claude doctor` (`extension.ts:66-71`).
4. Register the webview provider under every Forge view id (`:83-93`).
5. Wire the webview messages to `ClaudeAgentService.fromClient` (`:96-98`).
6. Create the host `VSCodeTransport`, then `setTransport`, then `start()` (`:101-107`).
7. Start endpoint health (`:122-124`).
8. Register the 31 commands (`:128`). Their source of truth is `src/commands/forgeCommands.ts:125-159`.

The DI framework (`src/di/*`, 783 lines) is plain TypeScript. Services are interfaces plus decorators, so swapping an implementation per host is already the architecture's idiom (`docs/USAGE.md`).

### 1.2 Frontend ↔ host protocol

**Shared types** live in `src/shared/messages.ts` (2,587 lines; it imports only SDK *types*, `:8-22`):
- Envelope (`:114-145`): `request {requestId, channelId?, request}`, `response`, `cancel_request`.
- Channel messages: `launch_claude` (`:53-61`), `io_message` (`:66-71`), `interrupt_claude`, `close_channel`.
- Unions: `WebViewToExtensionMessage` (`:2296-2303`) and `ExtensionToWebViewMessage` (`:2308-2314`). Every host→webview post is wrapped as `{type:"from-extension", message}` (`:2319-2322`).
- **85 webview→host request types** (`WebViewRequest`, `:2331-2422`). **13 host→webview pushes** (`ExtensionRequest`, `:2517-2530`). Only one response flows the other way: the permission answer (`:2586-2587`).

**Webview side.** `abstract class BaseTransport` (`src/webview/src/transport/BaseTransport.ts:107`, 1,226 lines) holds all 85 request methods. It needs only two things from a subclass:
- `send()` (`:200`);
- someone to `fromHost.enqueue(...)` (`:189`).

`VSCodeTransport` is 56 lines: `acquireVsCodeApi()` (`VSCodeTransport.ts:29`), `postMessage` (`:38-40`), a `window` `message` listener filtering `from-extension` (`:17-24`), and `postRaw` for the plan preview (`:48-50`). The transport singleton is created in one place (`src/webview/src/core/runtimeTransport.ts:9`).

**Host side.** `ITransport` is `send` + `onMessage` (`src/services/claude/transport/BaseTransport.ts:22-36`). Its header already anticipates "ElectronTransport: Electron IPC (future)" (`:9`). `VSCodeTransport.send` forwards to `IWebViewService.postMessage` (`transport/VSCodeTransport.ts:34-41`). `WebViewService.registerWebview` stamps a `webviewId` on every inbound message (`src/services/webViewService.ts:663-690`), and replies route back by that id.

### 1.3 Host: services, handlers, and the CLI

- **Dispatcher.** `ClaudeAgentService` (3,209 lines) reads a queue of client messages (`:786-797`) and `dispatchFromClient` routes them (`:799-857`). Messages for one channel run in order on that channel's queue (`:868-884`). One failing message never stops the loop (`:769-797`, comment). The request `switch` is at `:1482-1862`; `open_claude_in_terminal` is live (`:1846`); login stays commented out (`:1850-1856`, per CLAUDE.md scope).
- **Launch.** `launchClaude` (`:909+`) builds an `AsyncStream<SDKUserMessage>` and calls `IClaudeSdkService.query`. `ClaudeSdkService.query` (`src/services/claude/ClaudeSdkService.ts:307-760`) builds the SDK `Options`:
  - `canUseTool`, plus in-process hook callbacks: the Forge SDK guards `:403-412` and `hooks: {...}` `:508-668`;
  - `pathToClaudeCodeExecutable` (`:672`) and `settingSources: ['user','project','local']` (`:682`);
  - `includePartialMessages` (`:684`) and `enableFileCheckpointing` (`:693`);
  - `extraArgs` from the gated `cliArgs.ts`, with `--settings ~/.claude/forge.json` (`:697-716`);
  - `CLAUDE_CODE_ENTRYPOINT='claude-vscode'` (`:726`).
  It then calls `query({prompt, options})` from the SDK (`:741-752`), wrapped in spawn retries.
- **Message stream.** `ClaudeAgentService.ts:1127` runs `for await (const message of query)` and forwards each SDK message to the webview as an `io_message`.
- **The binary.** `findClaudeBinary` looks in `resources/native-binaries/<platform>-<arch>/claude[.exe]`, then `resources/native-binary/claude[.exe]` (`src/services/claude/cliLaunch.ts:55-77`). The native CLI is a per-platform optional dependency of the SDK (`cliLaunch.ts:4-11`). `esbuild.ts`'s `copyNativeBinaryPlugin` copies it into `resources/native-binary/` at build time (`esbuild.ts:75-126`). `claude.exe` is 233,691,808 bytes (`docs/sdk-upgrade.md:10`).
- **Other SDK calls Forge makes.**
  - Runtime functions: `query`, `listSessions`, `forkSession`, `renameSession` and `getSubagentMessages` (dynamic imports in `ClaudeSessionService.ts:405`, `ClaudeSdkService.ts:741`, and others).
  - `Query` control methods: `initializationResult`, `setMaxThinkingTokens`, `applyFlagSettings`, `stopTask`, `setMcpServers`, `rewindFiles`, `getSettings`, `mcpServerStatus`, `listPermissionRules`, `updateSettings`, `setPermissionMode` and `interrupt` (grep over `src/`).

### 1.4 What is already editor-independent

**Method.** An import-graph walk over every host `.ts` file: follow relative imports, skip `import type`, and ask whether a chain reaches `'vscode'`.

**Result.** **25 files import `vscode` directly. 4 reach it only through `logService.ts`'s decorator import. 110 files (~23.9k lines) never reach it.**

The clean ones:

| Area | Files |
| --- | --- |
| DI | `src/di/*` |
| Forge SDK layer | `src/forge-sdk/**` (guards, CLI hook server). Kept clean by `test/forgeSdkLayer.spec.ts:25-32`. |
| Shared | `src/shared/**`, including `messages.ts` |
| Claude host logic | Almost all of `src/services/claude/**`: `cliArgs`, `cliLaunch`, `commandRisk/*`, `permissionRules`, `outputStyles`, `rewindCode`, `forkConversation`, `sessionList`, `archivedSessions`, `unreadSessions`, `sessionPermissionModes`, `sessionGroupStore`, `attachmentStaging`, `chatExport`, `chromeMcp*`, `planPreview`, `pluginManager`, `terminalLaunch`, `terminalBrand`, `settingsWhitelist`, `thinkingLevel`, `sideQuestion`, `sessionWatchdog`, `spawnRetry`, `doctor`, `webviewPaths` |
| Endpoints | `src/services/endpoints/**` except `endpointService.ts`, `health.ts` and `selection.ts` (the whole relay and `wire/`) |
| Other | `agents/loader.ts`, `agents/scope.ts`, `customizations`, `diagnostics/ladder`, `settingsFile`, `telemetryService`, `webviewAssets` |

Several of these were written to be portable on purpose:
- `cliLaunch.ts:12`: "Kept free of `vscode`".
- `setupFlow.ts:22-23`: "The prompts are reached only through `SetupUi`".
- `secretStore.ts:61-64`: `SecretReader`.
- `editDiagnostics`'s `DiagnosticsSource`.
- The stores take a `Memento` slice (`sessionPermissionModes.ts:84`).

### 1.5 Endpoint and relay layer

- **The relay.** `relay.ts` runs a **loopback HTTP server** (`relay.ts:1-35`: binds `127.0.0.1`, ephemeral port, per-session bearer token, `:161`, `:302-309`). It puts mTLS, a custom CA, proxy, auth and request transforms in front of the CLI. With `wire: openai` it translates the Anthropic Messages API to chat/completions (`wire/anthropicServer.ts`).
- **Pointing the CLI at it.** `endpointService.ts:78` sets the CLI's `ANTHROPIC_BASE_URL` to the relay.
- **Size.** `src/services/endpoints/**` is **8,713 lines**, all Node (`node:http`, `undici`).
- **The only coupling:**
  - `endpointService.ts`: `forge.endpoints` / `forge.endpointProfile` settings (`:261-303`), `context.secrets` (`:168-183`), the workspace folder (`:365`), a warning (`:369`);
  - `health.ts`: `vscode.EventEmitter` (`:88`), `onDidChangeConfiguration` (`:463`), the `ExtensionContext` (`:100`), with records in `globalState` key `forge.endpointHealth` (`healthStore.ts:52`);
  - `selection.ts`: `ConfigurationTarget` (`:22-32`).

### 1.6 Settings and storage: what is persisted, and where

| What | Where | Owner / code |
| --- | --- | --- |
| CLI user / project / local settings | `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json` | CLI; Forge writes through the whitelist (`settingsWhitelist.ts`, `configurationService.ts:20-27`) |
| Forge flag-settings layer | `~/.claude/forge.json`, passed as `--settings` | `configurationService.ts:308`, `ClaudeSdkService.ts:346,704` |
| Profile overlays | `~/.claude/settings.<name>.json` | `configurationService.ts:263-318` |
| Forge extension config (default mode, model, notifications, focus view, custom models) | `~/.forge.json` | `configurationService.ts:44-72,300` |
| Endpoint profile files | `~/.forge/endpoints` (or `forge.endpointProfilesDir`) | `endpointService.ts:266` |
| **VS Code settings** `forge.*` (17 keys, including `forge.endpoints`, `forge.endpointProfile`, `forge.cliArgs`, `forge.environmentVariables`, `forge.allowDangerouslySkipPermissions`) | VS Code `settings.json` | `package.json` `contributes.configuration`; read at 28 call sites |
| **VS Code `globalState`** | VS Code storage | `hiddenSessionIds`, `sessionUnarchivedAt` (`archivedSessions.ts:64`), `sessionUnread:<root>` (`unreadSessions.ts:13`), per-session permission modes (`sessionPermissionModes.ts:32`), session groups and `collapsedPanelSections` (`sessionGroupStore.ts:8-13`), `thinkingLevel` (`ClaudeSdkService.ts:1047-1053`), `chromeExtensionNotificationDismissed` (`:63`), `forge.endpointHealth` |
| **VS Code `SecretStorage`** | OS keychain via VS Code | endpoint tokens `forge.endpoint.<name>.token` (`secretStore.ts:26-28`) |
| Conversations | `~/.claude/projects/<dir>/*.jsonl` | the CLI; Forge reads them through the SDK (`ClaudeSessionService.ts:401-406`) |
| Attachments staging | `<project>/.forge/attachments` | `attachmentStaging.ts:39` |
| Logs | VS Code output channel "Forge" | `logService.ts:46` |

Everything in rows 1–5 and 9–10 is shared with the CLI and is host-independent. The three VS Code stores — settings, `globalState` and `SecretStorage` — and the log are what the desktop app has to replace.

### 1.7 Tests, harness, build

- **Unit tests.** **151 vitest specs** (33,484 lines) in `test/*.spec.ts`, with `vscode` aliased to a 208-line mock (`vitest.config.ts`, `test/mocks/vscode.ts`).
- **Protocol drift guard.** `test/protocolDrift.spec.ts` fails if a request type is missing from the dispatcher or from the harness mock host.
- **UI harness.** `.claude/skills/ui-parity/harness/` runs the **built webview in a plain browser**:
  - `index.html:10-79` injects a full dark `--vscode-*` variable set and `body.vscode-dark` (`:108`);
  - `mock-host.js` stubs `acquireVsCodeApi` (`mock-host.js:831`) and answers every request.
  - This is direct proof that the frontend runs outside VS Code.
- **E2E.** `e2e/launch.mjs` packages the VSIX and drives real VS Code or code-server over CDP, with a stub OpenAI-compatible gateway (`e2e/stub-gateway.mjs`).
- **Build.**
  - `pnpm run build` = lint + brand/token/command gates + `vite build` (to `dist/media`, `src/webview/vite.config.ts:110-130`) + `esbuild` (`src/extension.ts` to `dist/extension.cjs`, CJS, Node, `external: ['vscode']`, `esbuild.ts:204-222`).
  - Packaging: `docs/PACKAGING.md`, with the universal VSIX carrying the win32-x64 and linux-x64 binaries (`scripts/fetch-native-binaries.mjs:27`).

---

## 2. Answers (Step 2)

### 2.1 Coupling: every `vscode` dependency, classified

Classes: **P** portable (works as-is or with a trivial swap to Node); **R** needs a replacement (a host interface with a VS Code and a desktop implementation); **D** VS Code-only, drop it in the desktop app (the VS Code implementation keeps it).

| # | Concern | Where (file:line) | Used for | Class | Desktop replacement |
| --- | --- | --- | --- | --- | --- |
| 1 | Activation, lifecycle | `extension.ts:18-149`; `serviceRegistry.ts:38-40` (`ExtensionContext`, `ExtensionMode.Test`) | DI setup, wiring, disposal, test mode | R | `src/desktop-host/main.ts`: same steps, an `IHostEnvironment` instead of the context |
| 2 | Webview views and panels | `webViewService.ts:205-330` (`WebviewViewProvider`), `:532`, `:636` (`createWebviewPanel`), `:129-164` (tab groups, `ViewColumn`), `:287` (`setContext`), `:553` (`lockEditorGroup`) | sidebar chat, sessions view, chat-in-tab, Settings tab, plan-preview panel, routing by `webviewId` | R | `IWindows`: Tauri windows / in-app pages; routing by window label |
| 3 | Webview HTML, URIs, CSP | `webViewService.ts:612-620` (`asWebviewUri` welcome art), `:700-760` (HTML, nonce, `cspSource` CSP `:735-742`), `:766-818` (Vite dev HTML) | loading the bundle | R | static `index.html` in the Tauri frontend dist, CSP in `tauri.conf.json`, bootstrap through an initialization script |
| 4 | Commands and palette | `forgeCommands.ts:983` (`registerCommand`), 13× `executeCommand`; `package.json` 31 commands, 5 keybindings | user entry points, endpoint and customisation flows | R | a `HostCommands` registry of plain functions, called from VS Code commands *and* desktop menus |
| 5 | Commands invoked by the webview | `handlers.ts:1917` (`run_endpoint_action`), `:1947` (`run_forge_action`), `:2547` (`forge.addEndpoint`), `:1095` (`forge.editor.open`) | Settings buttons that start guided flows | R | call the same `HostCommands` functions directly |
| 6 | Native prompts (QuickPick, InputBox, progress) | `customizationCommands.ts:51-379` (12 input boxes, 6 quick picks, `:111` open dialog), `forgeCommands.ts:275-949` (quick picks, `createQuickPick :601`, input `:621,:1016`, `withProgress` ×5 `:638-948`) | create skill / agent / command / MCP server; add and edit endpoint; select agent / endpoint | R | `IPrompts` (quickPick, inputBox, withProgress); the desktop renders it as an in-webview dialog. `setupFlow.ts` already uses `SetupUi` (`setupFlow.ts:40-68`) |
| 7 | `forge.*` configuration | 28 call sites, e.g. `ClaudeSdkService.ts:705,1069,1090`, `ClaudeAgentService.ts:657` (change events), `:1015`, `agentService.ts:132,142,215`, `endpointService.ts:270,283,303`, `selection.ts:30`, `health.ts:387,463`, `chatLocationSetting.ts:7`, `followEdits.ts:276`, `handlers.ts:1972,2041,2573`, `extension.ts:66` | the 17 `forge.*` settings | R | `IHostConfig` (get, inspect, update, onDidChange) over `%APPDATA%\com.msaid.forge\settings.json` |
| 8 | Other extensions' config | `fileSystemService.ts:664-665` (`search.exclude`, `files.exclude`, `useIgnoreFiles`), `handlers.ts:2672` (`terminal.integrated`) | @-mention file search excludes; terminal shell | R | desktop defaults plus `.gitignore` (already read, `:683`); shell detection (`detectDefaultWindowsShell`, `handlers.ts:2671`) |
| 9 | Secrets | `endpointService.ts:168-183` (`context.secrets`) | endpoint tokens | R | `ISecretStore` backed by **Windows Credential Manager** (Rust `keyring`) |
| 10 | `globalState` | `ClaudeSdkService.ts:1047-1149`; `webViewService.ts` (collapsed sections); `healthStore.ts:231-281` | the stores listed in §1.6 | R | `IMemento` over `%APPDATA%\com.msaid.forge\state.json`, written atomically with the existing `settingsFile.writeJsonAtomic` |
| 11 | Logging | `logService.ts:46` (`createOutputChannel`), `:53-55` (`show`) | Forge log, "Show Logs" | R | rotating file log in `%LOCALAPPDATA%\com.msaid.forge\logs`; "Show Logs" opens it |
| 12 | Notifications with buttons | `notificationService.ts:20-30`; direct calls `handlers.ts:1046-1053` (`show_notification`), `:2008-2043` (bypass confirmation), `:2543`; `ClaudeSdkService.ts:410`; `terminalGuards.ts:35`; ~30 in `forgeCommands.ts` | info, warnings and confirmations, some awaiting a choice | R | `INotifications`: in-app toast with action buttons (existing `Toast.vue` / `ForgeDialog.vue`), plus a **Windows toast** for background events |
| 13 | File dialogs | `dialogService.ts:22-34`; `handlers.ts:1691` (export save), `:1715` (import open) | export/import conversation, add a skill folder | R | `IDialogs` through `tauri-plugin-dialog` |
| 14 | Terminals | `terminalService.ts:28-32`; `handlers.ts:2513-2670` (`open_claude_in_terminal`: `createTerminal`, shell-integration events `:2624-2650`, `moveEditorToNewWindow :2661`, `env.shell :2683`) | "Open Forge in Terminal" | R | `ITerminalLauncher`: Windows Terminal (`wt.exe`) or PowerShell, given the same validated args (`terminalLaunch.ts`). An embedded pty comes later (§2.4) |
| 15 | Workspace folders | `workspaceService.ts:38-51`; direct `workspaceFolders?.[0]` at `ClaudeSdkService.ts:1129,1139`, `configurationService.ts:327`, `agentService.ts:128,224`, `endpointService.ts:365`, `fileSystemService.ts:683`, `handlers.ts:2371,2618`, `forgeCommands.ts:207,1010`, `customizationCommands.ts:44`; `ClaudeAgentService.getCwd :2051` | the project the CLI runs in, session-list scope | R | `IHostEnvironment.workspaceFolder` = the window's chosen project |
| 16 | File system API | `fileSystemService.ts:162-186` (`workspace.fs` read/write/delete/rename/mkdir/readdir/stat), `Uri` in its interface `:34-40` | file I/O | **P** | Forge is local-only (`package.json` `capabilities.virtualWorkspaces: false`), so `node:fs` is equivalent; the interface takes string paths |
| 17 | File search | `fileSystemService.ts:247` (`findFiles`) | @-mention completion | R | bundled ripgrep `rg --files` (already resolved for this platform, `fileSystemService.ts:419-420,779-780`) |
| 18 | Editor: active and visible editors, selection | `tabsAndEditorsService.ts:21-29`; `editorSelection.ts:62-129`; `forgeCommands.ts:237-242,376-381`; `handlers.ts:1005-1028` (`get_current_selection`) | IDE-context block, `insert_at_mention` (Alt+K), `selection_changed` push | **D** | no editor: there is no selection. `get_current_selection` answers `null`; the webview already handles "no selection" (`ideContext.ts`) |
| 19 | Open file in editor | `handlers.ts:948-1003` (`openTextDocument`, `showTextDocument`, `revealRange`, `Selection`, `revealInExplorer :965`) | clicking a path in the transcript | R | the in-app file pane (M6), or **Open in** an installed editor, or **Show in Explorer** |
| 20 | Open content as a document | `handlers.ts:1762-1800` (`open_content`), `:2922-2978` (`waitForDocumentEdits`) | showing or editing generated text | R | in-app viewer/editor dialog |
| 21 | Diff editor | `proposedDiff.ts:51` (`vscode.diff`), `:79-111` (tab groups); `handlers.ts:1129-1188` (`open_diff`); accept/reject commands | reviewing a proposed edit in VS Code's diff tab | R / low | in-webview diff modal (`DiffEditor.vue` already renders it). No webview code calls `openDiff` today: `BaseTransport.ts:484` defines it and nothing calls it |
| 22 | Follow edits | `followEdits.ts` (decorations `:240-255`, `vscode.open :323`, `showTextDocument :329-330`) | opening and highlighting each edited file | **D** | replaced by the Changes pane (M6) and "Open in editor" |
| 23 | Language diagnostics | `editDiagnosticsVscode.ts:28-60` (`languages.getDiagnostics`, `onDidChangeDiagnostics`) | small-model guard: "your edit introduced errors" | **D** | a null `DiagnosticsSource`; it returns `undefined` ("no view of the file"), which the guard already treats as unknown (`editDiagnosticsVscode.ts:26-30`) |
| 24 | External links | `handlers.ts:1816` (`env.openExternal`) | `open_url` | R | `tauri-plugin-opener`, behind the existing `isOpenableUrl` (`handlers.ts:3065`) |
| 25 | Settings editor | `handlers.ts:2365,2412-2413` (`workbench.action.openSettings`), `:2379-2380` (open a config file) | `open_config`, `open_config_file` | R | Forge's own Settings page (new "Desktop" section), or the JSON file in the default editor |
| 26 | Side bars and layout | `extension.ts:22`; `handlers.ts:2221-2320` (`reveal_chat`, `closeSidebar :2292`), `:2332-2333` (secondary-sidebar version check); `webViewService.ts:287` | moving between the sessions view and the chat | **D** | the desktop has one layout; `reveal_chat` becomes an in-app page switch |
| 27 | Host version info | `handlers.ts:2333` (`vscode.version`), `:2468` (extension version); `forgeCommands.ts:111,297` | diagnostics, feature gates | R | app version from Tauri (`IHostEnvironment.appVersion`) |
| 28 | Resource paths | `ClaudeSdkService.ts:1018-1045` (`asAbsolutePath`), endpoint rules (`:389-396`) | bundled `claude.exe`, ripgrep, endpoint-rule texts, terminal icon | R | `IHostEnvironment.resourcePath()` = Tauri resource dir |
| 29 | Plan preview panel | `webViewService.ts:630-646` (`createPagePanel`), `planPreview.ts` | the plan page with comments, on its own channel | R | second Tauri window or right-hand pane, behind an `IPagePanel` |
| 30 | Event primitives | `health.ts:78-88` (`vscode.Event`, `EventEmitter`, `Disposable`) | internal events | **P** | a 20-line `Emitter` in `src/host-api` |
| 31 | Worktree command | `forgeCommands.ts:1009-1050` (`git worktree add`, then `vscode.openFolder`) | create worktree, open it | R | host command; desktop opens the worktree as a session cwd or a new window |

**Counts:** 31 concerns: **2 P**, **25 R**, **4 D**. None of them sits on the conversation's critical path except #1–#3, #7, #10, #15 and #28, which is exactly the shim's surface in M1 (§4.5).

### 2.2 Webview: what assumes a VS Code webview, and what it becomes

| Assumption | Evidence | In the Tauri shell |
| --- | --- | --- |
| `acquireVsCodeApi()` messaging | `transport/VSCodeTransport.ts:29,38-40`; typing in `main.ts:8-25` | `TauriTransport extends BaseTransport`: `send` = `invoke('forge_send', {message})`; receive = window-scoped `listen('forge://host')` → `fromHost.enqueue`. Selected in `runtimeTransport.ts:9` by `isTauri()`. The VS Code path is untouched |
| `from-extension` envelope | `VSCodeTransport.ts:17-24`, `messages.ts:2319` | kept byte-for-byte; Rust forwards it as it is |
| `window.FORGE_BOOTSTRAP` written into the HTML | `webViewService.ts:743-747` | injected by Rust with `WebviewWindowBuilder::initialization_script` (`{host:'editor', page:'chat'\|'desktop', welcomeArt, ...}`) |
| `--vscode-*` theme variables (**84 distinct** in `src/webview/src`; most used: `--vscode-foreground` ×92, `editor-background` ×24, `focusBorder` ×17) and the `body.vscode-dark` / `vscode-high-contrast` classes | `forge-tokens.css:12-24` ("HYBRID": structure on `--vscode-*`, brand on Pajamas), `:363-364`, `:532-533` | new `src/webview/src/styles/forge-desktop-host.css`: all 84 variables defined for a **Forge Desktop light and dark theme** from Pajamas neutrals; body class set from `prefers-color-scheme` (WebView2 follows Windows). The harness `index.html:10-79` is the starting value set. Added to `scripts/check-brand.mjs` `ALLOW` (`:27-35`) like `forge-tokens.css` |
| VS Code's host stylesheet under every webview | `forge-host-defaults.css:1-24` (already restores it in-app), harness `vscode-default.css` | nothing to do: Forge already ships the rules |
| Base font size `--vscode-chat-font-size` (13px) | CLAUDE.md rule 4 | defined in `forge-desktop-host.css` (13px, as the official) |
| Resource URIs (`asWebviewUri`) | welcome art `webViewService.ts:612-620`; assets are relative (`vite.config.ts` `base: ''`) | everything is bundled in the frontend dist; welcome PNGs copied next to `index.html` (the harness does this: `index.html:96-100`) |
| CSP with nonce and `cspSource` | `webViewService.ts:735-742` | `tauri.conf.json` `app.security.csp`: `default-src 'self'; img-src 'self' data: https: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; connect-src ipc: http://ipc.localhost; worker-src 'self' blob:` (Tauri adds its own nonces) |
| Dev server | `webViewService.ts:766-818` | `tauri.conf.json` `build.devUrl = http://localhost:5173` (the same `pnpm dev:webview`) |
| Visibility of a hidden, retained panel | `postVisibility`, `webViewService.ts:63-75` | Tauri window focus and minimise events, sent as the same `visibility_changed` push |
| Editor-only webview actions | `openOutputPanel` (`AppContext.ts:181`, `ChatPage.vue:98,565`); `renameTab` (`AppContext.ts:186`, `SessionStore.ts:235,256`); `new_conversation_tab`; `revealChat` (`App.vue:139`); `getCurrentSelection` (`useRuntime.ts:119`); `openMarkdownPreview` (`Session.ts:1309`); `openConfig` / `openHelp` (`ButtonArea.vue:381-382`); terminal row (`ButtonArea.vue:322`) | respectively: open the log viewer; set the session/window title; new session in the sidebar; switch page; `null`; plan pane; desktop Settings / help URL; external terminal |
| Page model: one page per webview (`App.vue:16-31`, `FORGE_BOOTSTRAP.page`) | `App.vue:61-70` | new `desktop` page: `DesktopShell.vue` lays out sidebar + chat + right pane in one webview (§4.1) |
| Keybindings declared in `package.json` (VS Code `when` clauses) | 5 keybindings | native menu accelerators plus the webview's `KeybindingManager` |

### 2.3 Claude Code desktop: what it offers and looks like

Legend: **V-bundle** verified in the uploaded app; **V-docs** verified in the official docs; **A** assumed.

Bundle facts used below:
- The preload exposes typed IPC names `claude.<area>_$_<Interface>_$_<method>` (`desktop:.vite/build/mainView.js`): **823 names; 212 under `LocalSessions`**, the Code tab's backend.
- The main process is `desktop:.vite/build/index.chunk-CprN6fNp.js`.
- It runs the **Agent SDK in Node**. `package.json` pins `@anthropic-ai/claude-agent-sdk 0.3.219-rc…`. It sets `pathToClaudeCodeExecutable` / `spawnClaudeCodeProcess` (`index.chunk-CIn4_NWS.js`) and `CLAUDE_CODE_ENTRYPOINT: "claude-desktop"` (`index.chunk-CprN6fNp.js`).
- It downloads `claude.exe.zst` per platform with checksums, and keeps an `sdkCompat.testedWrapperVersions` list.

| # | Area | What it offers / looks like | Verified? | Forge has | Needs adapting | Missing |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Window layout and sidebar** | Sidebar lists sessions with "+ New session". The main area has a session title bar with **Terminal / Changes / Browser** buttons and a **⋮** menu. Panes (chat, diff, browser, terminal, file, plan, tasks, subagent) can be dragged, resized and popped out to a window. The window is frameless (`titleBarStyle:"hidden"`, `titleBarOverlay`, `frame:!1`), min 600–720 × 400–560. UI fonts are Anthropic Sans and Serif. | V-docs `#arrange-your-workspace`; V-bundle (window options; `renderer/main_window/assets/AnthropicSans-*.ttf`); exact pixel layout **A** | `SessionsPage` and `ChatPage` as separate pages (`App.vue:16-31`), Settings page, Agent map, tasks tray (`docs/forge-design.md:845-922`) | one `DesktopShell` with a resizable sidebar \| chat \| right-pane layout | a free drag-dock pane system (deliberately not built, §4.4) |
| 2 | **Session list** | Filter by status, project or environment; group by project; rename from the title; archive on hover; Ctrl+Tab cycles. IPC: `getAll`, `searchSessions`, `archive`, `unarchive`, `delete`, `updateSession`, `setFocusedSession`. | V-docs `#work-in-parallel-with-sessions`; V-bundle (IPC) | `SessionList`, `SessionRow`, `SessionGroupHeader`, `StatusDot`; rename, archive, unarchive, unread, groups (`messages.ts:607-724`); search | becomes the sidebar | an all-projects list (`listSessions` without `dir` lists every project, `sdk.d.ts:1029-1035`); delete |
| 3 | **Project/folder picker** | The prompt area picks **Environment** (Local / Cloud / SSH / WSL) and **Project folder**. IPC: `getDetectedProjects`, `changeCwd`, `addDirectories`, `FilePickers.getDirectoryPath`. | V-docs `#start-a-session`; V-bundle | none (the workspace folder comes from VS Code) | — | folder picker, recent projects, detected projects |
| 4 | **Chat and composer** | Enter sends, stop interrupts, a correction can be queued while running; **+** opens attachments, skills, connectors and plugins; @mention with autocomplete; drag and drop files; model dropdown and mode selector beside Send; effort menu; usage ring. IPC: `sendMessage`, `cancelQueuedMessage`, `promoteQueuedMessage`, `reorderQueuedMessage`, `setModel`, `setEffort`, `setFastMode`. | V-docs `#use-the-prompt-box`, `#add-files-and-context-to-prompts`; V-bundle | the official composer: `ChatInputBox`, `AddMenu`, `ModelSelect`, `ModeSelect`, `EffortSlider`, queued input (`pendingInputs.ts`), attachments (`attachmentStaging.ts`) | — | usage ring (out of scope by CLAUDE.md: "Account & usage") |
| 5 | **Permission prompts** | Modes **Manual / Accept edits / Plan / Auto / Bypass permissions**. The mode is remembered per folder (Plan is per session). Manual shows a diff to accept or reject. Bypass is enabled in Settings. IPC: `onToolPermissionRequest`, `respondToToolPermission`, `setPermissionMode`. | V-docs `#choose-a-permission-mode`; V-bundle | `PermissionRequestModal` with rule destinations, `persist_session_permission_mode`, the bypass gate | mode labels (see Q4 in §5) | — |
| 6 | **Diff review and applying changes** | A `+12 -1` indicator opens the diff viewer: file list on the left, per-file diff on the right. Click a line to comment; **Ctrl+Enter** submits all comments, and Claude answers with a new diff. `/code-review` card. IPC: `getGitDiff`, `getGitDiffStats`, `getGitDiffFilePatch`, `getDiffFileContent`, `reviewDiff`, `commitAllChanges`, `discardWorkingTree`, `stashWorkingTree`. | V-docs `#review-changes-with-diff-view`; V-bundle | a per-tool-call diff (`DiffEditor.vue`, `DiffLines.vue`) with a full modal; Rewind (`rewind_code` → `query.rewindFiles`) | — | a working-tree **Changes pane** with comments; discard |
| 7 | **Several sessions side by side** | Parallel sessions in the sidebar; Ctrl+click opens a split; a **worktree** option per session (`<project>/.claude/worktrees/`); "tear-off" (`beginTearOffHalo`). | V-docs `#work-in-parallel-with-sessions`; V-bundle | `SessionStore` holds many live sessions in one webview (`SessionStore.ts` `sessions` / `activeSession`); VS Code chat tabs; the `forge.createWorktree` command (`forgeCommands.ts:1009-1050`) | several live sessions per window; worktree option in "New session" | split view (M8) |
| 8 | **Settings** | Settings → Claude Code: bypass toggle, worktree location, branch prefix, auto-archive, Browser tools. Local environment editor (encrypted env vars). Ctrl+, opens it. IPC: `AppPreferences`, `LocalSessionEnvironment.get/save`, `ClaudeCode.patchUserSettings`. | V-docs `#work-in-parallel-with-sessions`, `#local-sessions`; V-bundle (menu "Settings..." `CmdOrCtrl+,`) | `SettingsPage` with 17 tabs (General, Models, Permissions, Hooks, MCP, Plugins, Skills, Slash commands, Endpoints, Profiles, Agents, Environments, Network, Sandbox, Memory and rules, Guide) | add a "Desktop" section for the 17 former VS Code settings | worktree location and branch prefix |
| 9 | **Keyboard shortcuts** | In the Code tab: Ctrl+/ shortcuts, Ctrl+N new, Ctrl+W close, Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+Shift+] / [, Esc stop, Ctrl+Shift+D diff, Ctrl+Shift+B browser, Ctrl+` terminal, Ctrl+\ close pane, Ctrl+; side chat, Ctrl+O view mode, Ctrl+Shift+M mode menu, Ctrl+Shift+I model menu, Ctrl+Shift+E effort menu, 1–9 picks in a menu. Native menu: **File** (New Conversation Ctrl+N, Settings... Ctrl+,, Close Window Ctrl+W, Exit); **Edit** (Undo, Redo Ctrl+Shift+Z, Cut, Copy, Paste, Paste and Match Style Ctrl+Shift+V, Select All, Find Ctrl+F, Find Next Ctrl+G, Find Previous Ctrl+Shift+G); **View** (Reload F5, Back Alt+Left, Forward Alt+Right, zoom Ctrl+= / Ctrl+- / Ctrl+0, devtools Ctrl+Alt+I). | V-docs `#keyboard-shortcuts`; V-bundle (menu template with accelerators in `index.chunk-CprN6fNp.js`) | webview keys (Ctrl+Esc focus, Enter / Shift+Enter, menus) via `KeybindingManager`; VS Code keybindings | map onto native menus plus the webview | a shortcuts dialog |
| 10 | **Tray and notifications** | Tray icon (`Tray-Win32.ico` / `-Dark.ico`); click shows the window; right-click menu **Show App / … / Quit**; first-run balloon *"Claude runs in the Notification Area"* (it keeps running after the window closes); a `menuBarEnabled` preference. An OS notification arrives when a session finishes and you are not viewing it; clicking it calls back; tag de-duplication. | V-bundle (tray code beside `new P.Tray`; notification class beside `new P.Notification`); V-docs `#work-in-parallel-with-sessions` | `systemNotifications` and `completionSound` settings exist (`SettingsTabGeneral.vue:159,174`, `configurationService.ts:59-60`) | — | tray, toasts |
| 11 | Side chat (`/btw`) | Ctrl+; or `/btw`; reads the thread; not saved. IPC: `startSideChat`, `sendSideChatMessage`. | V-docs; V-bundle | `SideChat.vue` and `side_question` (`docs/forge-design.md:1022`) | add the Ctrl+; shortcut | — |
| 12 | Background tasks pane | Subagents, background shells and workflows; stop. | V-docs `#watch-background-tasks` | `TasksTray.vue`, `stop_subagent` | — | — |
| 13 | View modes | Normal / Thinking / Verbose, Ctrl+O. | V-docs `#switch-view-modes` | Focus view (`set_focus_view`) | Ctrl+O toggles focus view | Verbose mode |
| 14 | Integrated terminal | Ctrl+`; opens in the session cwd; tabs. node-pty with ConPTY is bundled (`desktop:node_modules/node-pty/prebuilds/win32-x64/conpty.node`); IPC `startShellPty`, `writeShellPty`. | V-docs; V-bundle | VS Code terminal for "Open Forge in Terminal" | external terminal first | embedded pane (optional M8) |
| 15 | File pane, "Open in" editor | Click a path to open it, edit, save. Right-click: Attach as context, **Open in** (VS Code / Cursor / Zed), Show in Explorer, Copy path. IPC: `getInstalledEditors`, `openInEditor`, `showSessionFileInFolder`. | V-docs `#open-and-edit-files`, `#open-files-in-other-apps`; V-bundle | `open_file` in a VS Code editor | — | file pane, Open in, Show in Explorer |
| 16 | Browser / preview pane | Dev servers from `.claude/launch.json`, tabbed browser, auto-verify (the `Launch` interface, 60 methods). | V-docs; V-bundle | `@browser` through Claude in Chrome MCP | — | skipped (§4.4) |
| 17 | PR monitoring, cloud, SSH, WSL, Dispatch, computer use, scheduled tasks | various | V-docs; V-bundle | none | — | skipped (§4.4) |
| 18 | Continue a CLI session | `/resume` lists CLI sessions (`listCliSessions`, `importCliSession`) | V-docs `#coming-from-the-cli` | resume reads the same `~/.claude/projects` | — | — |

### 2.4 Desktop-only needs on Windows

| Need | Recommendation | Mechanism |
| --- | --- | --- |
| Choosing and remembering project folders | First launch shows a folder picker. The sidebar header has a project switcher: Open folder…, Recent (up to 10), and Detected (cwds of existing sessions). | `tauri-plugin-dialog` `pick_folder`; `recent.json`; `listSessions()` with no `dir` for detection (`sdk.d.ts:1029-1035`) |
| Multiple windows / tabs | **One window per project, one sidecar per window**, as VS Code runs one extension host per window. Within a window, several live sessions sit in the sidebar. | Tauri `WebviewWindowBuilder`, labelled `project-<hash>`; the Rust router keeps one sidecar per label |
| Native menus and shortcuts | File / Edit / View / Help menus copying Claude Desktop's accelerators (§2.3 #9), plus Code-tab shortcuts handled in the webview | `tauri::menu` (`MenuBuilder`, `PredefinedMenuItem` for edit roles) |
| Tray | Show Forge, New session, Quit; close-to-tray **on** by default, as Claude does; first-run balloon text in Forge's voice | Tauri `tray-icon` feature, `TrayIconBuilder` |
| Windows toast notifications | On turn end or permission needed, only when the window is unfocused or the session isn't visible, and only if `systemNotifications` is on; clicking focuses the window and session | `tauri-plugin-notification` (click routing on Windows is a risk, §4.5 M5) |
| Credentials in Credential Manager | Endpoint tokens under service `Forge`, user `forge.endpoint.<name>.token` (same key names, `secretStore.ts:26-28`) | Rust `keyring` crate (Windows backend), exposed as host calls `secrets.get/set/delete` |
| Viewing and applying diffs without an editor | Inline diffs already in the transcript; the new **Changes** pane for the working tree; Rewind for undo | git CLI from the host; `DiffLines.vue` renders |
| Opening files in the user's editor | **Open in ▸** with installed editors (VS Code `code`, Cursor, Zed found on PATH or the registry App Paths), Show in Explorer, Copy path | host calls `shell.openInEditor`, `shell.showInFolder` |
| Embedded terminal | **Not at first (no for M1–M7); optional M8.** External Windows Terminal or PowerShell covers "Open Forge in Terminal". Claude Desktop does embed one (node-pty with ConPTY), so it's a parity item, not a need. | `wt.exe -d <cwd> -- <claude.exe> …`; later xterm.js plus node-pty in the sidecar |
| Logs | Host and Rust logs in `%LOCALAPPDATA%\com.msaid.forge\logs\`, rotated; Help ▸ Show Logs | `tauri-plugin-log` (Rust) and a file sink in the Node `LogService` |
| Single instance | `forge-desktop.exe <folder>` opens or focuses that project's window in the running app | `tauri-plugin-single-instance` |
| Window position and size | remembered per project window | `tauri-plugin-window-state` |

---

## 3. Architecture (Step 3)

| Criterion | **(a) Tauri + existing webview + Node sidecar** | (b) Tauri + existing webview + host rewritten in Rust | (c) Fully native Rust UI |
| --- | --- | --- | --- |
| **Reuse** (from §1–2) | Webview: all ~62.6k lines (Vue 30.5k, TS 20.7k, CSS 11.4k) plus a ~40-line transport. Host: 110 clean files as-is; 29 coupled files keep their logic behind interfaces. All 151 specs keep running. | Webview reused. Host: **0 lines**; ~38k lines of TypeScript rewritten. The specs don't cover Rust. | Webview **0%**, with no CSS parity against the official stylesheet. Host as in (a) or (b). |
| **Agent protocol to re-implement** | **None.** The SDK speaks it: 38 `SDKControl*Request` types (`sdk.d.ts`), `canUseTool`, hook callbacks, SDK MCP, `rewindFiles`, plus the session utilities (`listSessions`, `forkSession`, `renameSession`, `getSubagentMessages`). | All of it: stream-JSON framing; 38 control requests; permission and hook round-trips (Forge's guards are in-process hooks, `ClaudeSdkService.ts:508-668`); resume and fork (`forkSession` is SDK JavaScript, not a CLI flag); rewind; session listing; the custom-endpoint relay (8.7k lines: OpenAI wire, OCR, PDF text, image prep, JSON repair). The CLI and SDK ship as a pair (`cliLaunch.ts:4-9`), so this is a moving private protocol. Even Claude Desktop wraps the SDK and pins tested versions rather than re-implement it (V-bundle). | Same as (a) or (b). |
| **Fidelity to Claude Code desktop's look** | High. The same DOM and CSS as the measured VS Code port, plus a desktop shell built in the same CSS. WebView2 is Chromium, so rendering matches the harness. | High (same UI). | Low. No CSS reuse; Markdown, Mermaid, highlight.js, Lexical editor and fonts all need native replacements; parity can't be measured with `probe-oracle.js`. |
| **Memory and startup** (estimates, **unmeasured**) | WebView2 processes ~120–200 MB plus Node ~60–90 MB per window, plus one `claude.exe` per live session (the same in every option). Cold start ~1 s (window ~0.3 s, Node loading a bundled `.cjs` ~0.3–0.6 s). | Saves the Node process (~60–90 MB, ~0.4 s). | Lowest UI memory (~30–60 MB), fastest start. |
| **Upkeep for one person** | Lowest. One host codebase serves VS Code and desktop; an SDK upgrade is done once (`docs/sdk-upgrade.md`). Rust stays small (~1.5–2.5k lines of shell). | Highest. Two hosts; every SDK or CLI release must be re-checked by hand against a protocol nobody documents. | Highest. Two UIs forever, and every Forge UI change lands twice. |

**Recommendation: (a)**, staged:

1. **Stage 1 (M1–M2):** the unchanged host runs in the sidecar behind a `vscode` shim. Rust is a thin shell: windows, IPC router, sidecar supervisor.
2. **Stage 2 (M3–M7):** real host interfaces replace the shim. Native capabilities live in Rust as host calls: tray, menus, toasts, Credential Manager, dialogs, opener, single instance, window state.
3. **Stage 3 (optional):** move further pieces to Rust only where Rust is the natural home and the gain is measurable. Examples: a single-exe sidecar via Node SEA instead of `node.exe`; the loopback relay, if you ever want a Node-free endpoint path. **Never** re-implement the SDK protocol while the SDK exists. The bundle shows Anthropic doesn't either.

---

## 4. The plan (Step 4)

### 4.1 Target structure

```text
FORGE/
├─ src/                                 # unchanged home of all shared code
│  ├─ host-api/                         # NEW (M3): interfaces only; no vscode, no Tauri
│  │   index.ts  events.ts  environment.ts  config.ts  memento.ts  secrets.ts
│  │   dialogs.ts  prompts.ts  notifications.ts  windows.ts  terminal.ts
│  │   external.ts  clipboard.ts  editor.ts
│  ├─ vscode/                           # NEW (M3): VS Code implementations (code moved from services/*)
│  ├─ desktop-host/                     # NEW (M1): the Node sidecar
│  │   main.ts        # activate() equivalent: DI, transport, start
│  │   stdio.ts       # NDJSON framing, console redirect
│  │   hostCalls.ts   # Node→Rust calls (dialogs, toasts, secrets…)
│  │   vscodeShim.ts  # M1–M2 only; deleted in M3
│  │   impl/          # M3: desktop implementations of host-api
│  ├─ services/ commands/ di/ forge-sdk/ shared/    # existing; coupled files refactored in M3
│  └─ webview/src/
│      transport/TauriTransport.ts      # NEW (M1)
│      styles/forge-desktop-host.css    # NEW (M1 dark, M2 light)
│      desktop/                         # NEW (M2+): DesktopShell.vue, Sidebar.vue, TitleBar.vue,
│                                       #   ProjectSwitcher.vue, ChangesPane.vue, FilePane.vue,
│                                       #   HostPromptDialog.vue, ShortcutsDialog.vue
├─ desktop/                             # NEW (M1): the Tauri app
│  ├─ web/index.html                    # desktop page: loads style.css, main.js, forge-desktop-host.css
│  ├─ scripts/build-desktop.mjs         # build webview → esbuild host → stage resources → cargo tauri build
│  ├─ e2e/smoke.mjs                     # per-milestone CDP smoke (reuses ui-parity/e2e/cdp.mjs, stub-gateway.mjs)
│  └─ src-tauri/
│      Cargo.toml  tauri.conf.json  build.rs  capabilities/default.json  icons/
│      src/ main.rs lib.rs sidecar.rs ipc.rs host_calls.rs windows.rs menu.rs
│           tray.rs notify.rs secrets.rs recent.rs paths.rs
└─ test/                                # existing specs + desktop specs (§4.7)
```

Rules that keep the VS Code extension building throughout:

- **Additive first.** M1 and M2 add files. The only edit to existing code is `runtimeTransport.ts`, which picks the transport. `esbuild.ts` is untouched: the desktop host has its own build in `desktop/scripts/build-desktop.mjs`, with no `external: ['vscode']`. A stray `vscode` import therefore fails the desktop build, which acts as a free gate.
- **`.vscodeignore`** gains `desktop/**` (the existing `src/**` already excludes the new sources).
- **M3 refactors in small steps.** Each step moves one coupled service behind `host-api` and must pass `pnpm test`, `pnpm run typecheck:all` and `pnpm run build`, plus the VS Code e2e kit (`launch.mjs --stub`) before the next.
- **A new spec `test/desktopHostLayer.spec.ts`** (modelled on `test/forgeSdkLayer.spec.ts`) fails if anything reachable from `src/desktop-host/main.ts` imports `vscode` (M3 onward).

Module by module:

| Module | Fate |
| --- | --- |
| `src/webview/**` | **reused**, plus `TauriTransport`, a desktop stylesheet and `desktop/` components |
| `src/shared/**`, `src/di/**`, `src/forge-sdk/**` | **reused as-is** |
| `src/services/claude/**` (the 50+ vscode-free files), `src/services/endpoints/**` (relay, wire), `agents/loader|scope`, `customizations`, `diagnostics` | **reused as-is** |
| `ClaudeAgentService.ts`, `ClaudeSdkService.ts`, `handlers/handlers.ts`, `ClaudeSessionService.ts` | **reused**; their few `vscode` uses move behind `host-api` in M3 (§2.1 #7, #10, #12, #15, #28) |
| `configurationService`, `fileSystemService`, `workspaceService`, `logService`, `notificationService`, `dialogService`, `terminalService`, `endpointService`, `health`, `selection`, `agentService`, `chatLocationSetting` | **wrapped**: logic stays; the host-specific part becomes a `host-api` implementation |
| `webViewService`, `forgeCommands`, `customizationCommands`, `extension.ts`, `serviceRegistry.ts` | **split**: VS Code half in `src/vscode/`; desktop half in `src/desktop-host/` |
| `tabsAndEditorsService`, `editorSelection`, `followEdits`, `editDiagnosticsVscode`, `proposedDiff` | **VS Code-only**; desktop gets null or alternative implementations |
| Ported to Rust | nothing of Forge's logic. New Rust: window and tray shell, IPC router, native host calls |

### 4.2 Host abstraction

The interfaces live in `src/host-api` and are signature-level only. Where Forge already has a narrow interface, it is reused.

```ts
// src/host-api — no 'vscode', no '@tauri-apps/*'
export interface Disposable { dispose(): void }
export type Event<T> = (listener: (e: T) => void) => Disposable;

export interface IHostEnvironment {          // replaces ExtensionContext / ExtensionMode / vscode.version
  readonly kind: 'vscode' | 'desktop';
  readonly appVersion: string;
  readonly isTest: boolean;
  resourcePath(relative: string): string;    // asAbsolutePath
  readonly workspaceFolder: string | undefined;
  readonly onDidChangeWorkspaceFolder: Event<string | undefined>;
}
export interface IHostConfig {                // forge.* settings
  get<T>(key: string, fallback: T): T;
  inspect<T>(key: string): { user?: T; workspace?: T; default?: T };
  update(key: string, value: unknown, target: 'user' | 'workspace'): Promise<void>;
  readonly onDidChange: Event<{ affects(key: string): boolean }>;
}
export interface IMemento { get<T>(key: string): T | undefined; update(key: string, value: unknown): Promise<void> }
export interface ISecretStore extends SecretReader {   // SecretReader = secretStore.ts:62
  store(key: string, value: string): Promise<void>; delete(key: string): Promise<void>;
}
export interface IDialogs { openFiles(o): Promise<string[] | undefined>; openFolder(o): Promise<string | undefined>; saveFile(o): Promise<string | undefined> }
export interface IPrompts extends SetupUi { withProgress<T>(title: string, task: () => Promise<T>): Promise<T> } // setupFlow.ts:57
export interface INotifications {             // INotificationService already has show*
  showInformation(m: string, ...actions: string[]): Promise<string | undefined>;
  showWarning(...): ...; showError(...): ...;
  toast(o: { title: string; body: string; tag?: string; sessionId?: string }): void;   // OS toast
}
export interface IWindows {                    // the host-neutral half of IWebViewService
  postMessage(m: unknown): void; setMessageHandler(h: (m: unknown) => void): void;
  onDidDisposeWebview(l: (id: string) => void): Disposable;
  openPage(page: 'settings' | 'sessions' | 'chat', o?: { tab?: string; sessionId?: string }): void;
  setTitle(webviewId: string, title: string): boolean;          // renamePanel
  createPagePanel(page: 'plan-preview', title: string): IPagePanel;
}
export interface ITerminalLauncher { openClaude(args: string[], cwd: string, env: Record<string, string>): Promise<void> }
export interface IExternal { openUrl(url: string): Promise<boolean>; showInFolder(p: string): Promise<void>; openInEditor(p: string, line?: number): Promise<boolean>; listEditors(): Promise<string[]> }
export interface IClipboard { writeText(t: string): Promise<void> }
export interface IEditorBridge {               // optional: VS Code only does real work
  currentSelection(): SelectionRange | undefined; openFile(p: string, range?: Range): Promise<void>;
  readonly onDidChangeSelection: Event<SelectionRange | undefined>;
}
// DiagnosticsSource (forge-sdk/guards/editDiagnostics.ts) stays as is.
```

| Interface | VS Code implementation (from) | Desktop implementation | Main consumers |
| --- | --- | --- | --- |
| `IHostEnvironment` | `ExtensionContext`, `vscode.version`, `workspaceFolders[0]` | env vars from Rust: `FORGE_WORKSPACE`, `FORGE_RESOURCES`, `FORGE_APP_VERSION`, `FORGE_DATA_DIR` | `ClaudeSdkService`, `ClaudeAgentService.getCwd`, `configurationService:327`, `agentService`, `endpointService` |
| `IHostConfig` | `workspace.getConfiguration('forge')` + `onDidChangeConfiguration` | JSON file `%APPDATA%\com.msaid.forge\settings.json` (the same 17 keys; defaults from `package.json` `contributes.configuration`) + a file watcher | 28 call sites (§2.1 #7) |
| `IMemento` | `context.globalState` | `state.json`, atomic writes (`settingsFile.ts`) | session stores, thinking level, health store |
| `ISecretStore` | `context.secrets` | host call → Rust `keyring` (Credential Manager) | `endpointService.secretsFor`, setup flow |
| `IDialogs` | `window.show*Dialog` | host call → `tauri-plugin-dialog` | export/import, add skill |
| `IPrompts` | QuickPick, InputBox, `withProgress` | host→webview `host_prompt` request rendered by `HostPromptDialog.vue` | `forgeCommands`, `customizationCommands`, `setupFlow` |
| `INotifications` | `show*Message` | in-app toast with buttons (host→webview `show_toast` push); `toast()` → Windows toast | handlers, guards, commands, the turn-end notifier |
| `IWindows` | `WebViewService` | `DesktopWindows`: one webview per Tauri window; pages are in-app | `ClaudeAgentService`, `VSCodeTransport` / `DesktopTransport`, `planPreview` |
| `ITerminalLauncher` | `createTerminal` + shell integration | `wt.exe` if present, else `powershell.exe -NoExit`; same args from `terminalLaunch.ts` | `open_claude_in_terminal` |
| `IExternal` | `env.openExternal`, `revealInExplorer` | `tauri-plugin-opener` (`open_url`, `reveal_item_in_dir`) + editor detection | `open_url`, file context menu |
| `IClipboard` | `env.clipboard` | `tauri-plugin-clipboard-manager` (or the webview's `navigator.clipboard`) | copy path |
| `IEditorBridge` | `editorSelection.ts`, `handlers.ts:948-1028` | selection `undefined`; `openFile` → file pane | ide context, `open_file` |
| `ILogService` (unchanged interface) | output channel | rotating file | everything |

New host→webview pushes need the six-places rule (CLAUDE.md B2) and `protocolDrift.spec.ts`. They are `host_prompt` (request/response), `show_toast`, and `desktop_command` (menu → webview: new session, toggle pane, open shortcuts).

### 4.3 Transport

```text
 Vue webview ──invoke('forge_send')──▶ Rust router ──NDJSON stdin──▶ Node sidecar (Forge host)
             ◀──emit('forge://host')── (per window) ◀──NDJSON stdout── DesktopTransport.send
                                       ▲      │
                       host calls ─────┘      └──── native: dialogs, toasts, keyring, opener
```

- **Message types are unchanged.** The same `WebViewToExtensionMessage` / `ExtensionToWebViewMessage` and the same `from-extension` wrapper (`messages.ts:2296-2322`). The webview's `BaseTransport` and the host's dispatcher don't know they moved.
- **Webview.** `TauriTransport` implements `send()` with `invoke`, listens on a window-scoped event and enqueues into `fromHost`. `postRaw` → `invoke('forge_send_raw')` for the plan preview.
- **Rust router (`ipc.rs`).** `#[tauri::command] forge_send(window, message: serde_json::Value)` validates the **envelope** before anything reaches Node:
  - it is an object whose `type` is one of the 7 client types;
  - `channelId` and `requestId` are strings of 128 chars or fewer;
  - its serialised size is within a cap (64 MB; attachments are staged by path, `stage_attachment`).
  It then **overwrites `webviewId`** with the window label, mirroring `webViewService.ts:663-690`, so a page can't impersonate another, and writes one line to that window's sidecar.
- **Node (`desktop-host/stdio.ts`).** It reads stdin lines into `claudeAgentService.fromClient(msg)`, exactly as `extension.ts:96-98` does. `DesktopTransport.send(msg)` writes `{"$forge":"out","message":…}`.
  - `console.*` is redirected to the file log at startup.
  - Rust treats any stdout line that is not a `$forge` frame as a log line, so a stray print can never corrupt the protocol.
- **Host calls.** Node → Rust → Node uses `{"$forge":"call","id","method","params"}` and comes back as `{"$forge":"return","id","result"|"error"}`.
  - Methods are a **fixed whitelist**: `dialog.openFiles|openFolder|saveFile`, `notify.toast`, `secrets.get|set|delete`, `shell.openUrl` (http, https and mailto only, the same rule as `isOpenableUrl`), `shell.showInFolder`, `shell.openInEditor`, `window.setTitle|focus`, `clipboard.writeText`, `app.info`.
  - Rust validates the params: absolute paths, schemes, key prefix `forge.endpoint.`.
- **Validation of every request stays in the host, unchanged.** It is the same dispatcher and the same B3 validators: `webviewPaths.ts`, `settingsWhitelist.ts`, session-id checks, the `JI0`-style terminal argument check, plugin and endpoint action allow-lists (`handlers.ts:1903-1947`). The desktop adds the envelope check and the host-call whitelist; it removes nothing.
- **Rejected alternative: a direct webview ↔ Node WebSocket.** It would need a loopback port, a token and a widened CSP, and Rust could neither route windows nor add native calls on the same path. Keep it in mind only if streaming throughput turns out to be a problem (risk in M1).

### 4.4 Feature parity matrices

**A. Claude Code desktop → Forge Desktop**

| Claude Code desktop feature | Forge Desktop | How / why |
| --- | --- | --- |
| Sidebar session list: new, rename, archive, filter, group | **Adapted** | Forge's `SessionList` and groups in a sidebar; filter by status, archived and search; groups are Forge's session groups |
| All-projects session list | **Adapted** (M4) | current project's sessions plus the project switcher; an "All projects" view is read-only and opens that project's window |
| Project folder picker, recent folders | **Same** (M1 / M4) | dialog plus recent and detected projects |
| Environment: Local | **Same** | — |
| Environment: Cloud, SSH, WSL; Dispatch; teleport to cloud | **Skipped** | need Anthropic cloud services or a remote-runner stack; login and remote are out of scope (CLAUDE.md "Account & cloud") |
| Composer: Enter, stop, queued correction, +, @mention, attachments, model, mode, effort | **Same** | the official VS Code composer already does these |
| Usage ring | **Skipped** | out of scope (CLAUDE.md: "Account & usage…") |
| Permission modes and per-folder memory | **Same** | `persist_session_permission_mode`; labels per Q4 |
| Diff stats indicator, Changes pane, line comments, Ctrl+Enter | **Adapted** (M6) | git CLI in the host plus `ChangesPane.vue`; comments go into one user message |
| `/code-review` card, Walk through in diff | **Skipped for now** | depends on the Changes pane; revisit after M6 |
| Discard, stash, commit-all from the diff | **Adapted** (M6: discard per file only) | `git restore` through a validated host request; commit and stash left to the user or Claude |
| Parallel sessions | **Same** | several live channels per window (`SessionStore`) |
| Worktree option per session | **Adapted** (M4) | reuse `createWorktree`; default location `<project>/.claude/worktrees/<branch>` as the docs describe |
| Split view (Ctrl+click) | **Adapted later** (M8) | two `ChatPage` instances bound to two sessions |
| Free drag-and-dock panes, pop-out | **Skipped** | a docking framework is a project of its own; Forge Desktop has a fixed sidebar \| chat \| right pane with splitters |
| Integrated terminal (Ctrl+`) | **Adapted** (M7 external, M8 optional embedded) | `wt.exe`; later xterm.js plus node-pty |
| File pane, Open in editor, Show in Explorer, Copy path | **Adapted** (M6 / M5) | read-only viewer with "Open in"; editing stays with your editor |
| Browser / preview pane, auto-verify | **Skipped** | Tauri child webviews are behind its `unstable` feature (believed, verify before relying on it); Forge already has Claude in Chrome (`@browser`) |
| Side chat (Ctrl+;, `/btw`) | **Same** (+ shortcut) | `SideChat.vue` |
| Background tasks pane | **Same** | `TasksTray.vue` |
| View modes (Ctrl+O) | **Adapted** | toggles Focus view; Verbose skipped |
| PR monitoring, auto-fix CI, auto-merge | **Skipped** | needs `gh` polling plus a PR UI; not core to "chat with the agent" |
| Scheduled tasks | **Skipped** | separate scheduler subsystem |
| Computer use, iOS simulator | **Skipped** | platform features of Claude Desktop |
| Connectors UI (claude.ai MCP) | **Skipped** | account feature; local MCP stays in Settings → MCP |
| Native menus and accelerators | **Same** | §2.3 #9 |
| Code-tab shortcuts | **Same** where the feature exists | §4.5 M2 list |
| Tray, close-to-tray, first-run balloon | **Same** | Forge copy and icon |
| OS notification when a background session finishes | **Same** | Windows toast, gated by `systemNotifications` |
| Global shortcut, Quick Entry window | **Skipped** (open question Q7) | not needed for coding |
| Find in page (Ctrl+F) | **Adapted** (M2) | WebView2's built-in find isn't exposed; a small in-page find bar (risk: low) |
| Auto-update | **Skipped** | needs signing and hosting (§4.6) |
| Account, login, `/feedback`, Remote Control | **Skipped** | out of scope by CLAUDE.md |

**B. Forge VS Code → Forge Desktop**

| Forge VS Code feature | Forge Desktop | How / why |
| --- | --- | --- |
| Chat, transcript, tools, thinking, Agent map, Mermaid, `/btw`, tasks tray, claim-check | **Same** | same webview |
| Permission prompt, rules, destinations, bypass gate | **Same** | same handlers |
| Model picker, effort, Ultracode, Thinking, fast mode | **Same** | same handlers and SDK calls |
| Sessions: list, rename, archive, unread, groups, fork, rewind, resume, export/import | **Same** (export/import via native dialogs) | — |
| Plan preview with comments | **Adapted** | right pane or second window (`IPagePanel`) |
| Settings page (17 tabs), Hooks, MCP, Plugins, Skills, Profiles | **Same** | — |
| `forge.*` VS Code settings | **Adapted** | desktop `settings.json` plus a Settings "Desktop" section |
| Endpoint profiles, relay, health, setup flow | **Same** (prompts as in-app dialogs) | `IPrompts` |
| Endpoint tokens in SecretStorage | **Adapted** | Credential Manager; tokens are re-entered once (VS Code's storage can't be read from outside) |
| Hermes agents, `/agents` | **Same** | `agentService` behind `IHostConfig` |
| Small-model guards (SDK hooks) | **Same**, except the diagnostics guard | no language servers, so a null `DiagnosticsSource` |
| Browser integration (Claude in Chrome MCP) | **Same** | host logic is vscode-free (`chromeMcp*.ts`) |
| "Open Forge in Terminal" | **Adapted** | external terminal, same validated args |
| IDE context: selection, open file, Alt+K @-mention from the editor | **Dropped** | there is no editor |
| Follow edits (open and highlight edited files) | **Dropped** | Changes pane instead |
| VS Code diff tab for proposed edits, accept/reject title buttons | **Dropped** | inline diffs plus the Changes pane |
| Sidebar / secondary sidebar / editor-tab placement, `reveal_chat` hand-off animation | **Dropped** | one window layout |
| Output channel, "Show Logs" | **Adapted** | log file plus viewer |
| Walkthrough (VS Code `walkthroughs`) | **Dropped** | the welcome page covers first run |
| Workspace trust (`untrustedWorkspaces: false`) | **Adapted** | first open of a folder asks "Trust this folder?" (Claude Desktop has `checkTrust` / `saveTrust`, V-bundle), stored in `state.json` |

### 4.5 Milestones

Each milestone ends with something you can run on Windows, and with the VS Code extension still green (`pnpm test`, `pnpm run typecheck:all`, `pnpm run build`).

#### M1: a Windows window where you chat with the real agent in a chosen folder

- **Scope**
  1. A Tauri 2 app with one window (native title bar, Forge icon from `resources/forge-logo.png` via `cargo tauri icon`).
  2. On launch, `pick_folder` runs unless `recent.json` has a last folder; the choice is saved.
  3. Rust spawns the sidecar `node <resources>/forge-host.cjs`. M1 uses system Node 22+ and shows a clear error if it is missing. The env passes `FORGE_WORKSPACE`, `FORGE_RESOURCES`, `FORGE_DATA_DIR` and `FORGE_APP_VERSION`.
  4. The NDJSON bridge and envelope validation (§4.3).
  5. `src/desktop-host/main.ts` replays `activate()`'s steps with the existing services. `vscode` resolves to `vscodeShim.ts`, which implements only what the chat path touches:
     - `workspace.getConfiguration` (JSON file) and `onDidChangeConfiguration`;
     - `workspace.workspaceFolders` = `FORGE_WORKSPACE`;
     - `workspace.fs` → `node:fs`;
     - `Uri.file` and `joinPath`;
     - `EventEmitter`, `Disposable`;
     - `ExtensionContext {globalState (state.json), secrets (in-memory + env fallback until M5), asAbsolutePath, extensionPath, extensionMode}`;
     - `window.createOutputChannel` → file;
     - `window.show*Message` → log, plus a `show_notification`-style toast;
     - `env.openExternal` → host call.
     Every other member throws `Error('Forge Desktop: <api> is not available yet')`. The dispatcher already contains one failing request (`ClaudeAgentService.ts:769-797`). The shim is modelled on `test/mocks/vscode.ts` (208 lines).
  6. `TauriTransport.ts`, plus `runtimeTransport.ts:9` choosing it when `isTauri()`.
  7. `desktop/web/index.html`: `forge-desktop-host.css` (dark set from the harness), `body.vscode-dark`, `style.css` and `main.js` copied from `dist/media`, and `FORGE_BOOTSTRAP = {host:'editor', page:'chat'}`.
  8. `claude.exe` from `resources/native-binary/` (produced by the existing esbuild plugin on a Windows build machine), mapped by `tauri.conf.json` `bundle.resources`.
  9. Credentials: whatever the CLI already uses (`claude login` / `ANTHROPIC_API_KEY`), or a Forge endpoint profile in `~/.forge/endpoints`. Login stays out of scope.
- **Files.**
  - New: `desktop/src-tauri/{Cargo.toml,tauri.conf.json,build.rs,capabilities/default.json,src/{main,lib,sidecar,ipc,paths,recent}.rs}`, `desktop/web/index.html`, `desktop/scripts/build-desktop.mjs`, `src/desktop-host/{main,stdio,hostCalls,vscodeShim}.ts`, `src/webview/src/transport/TauriTransport.ts`, `src/webview/src/styles/forge-desktop-host.css`.
  - Edited: `src/webview/src/core/runtimeTransport.ts` (selection only), `scripts/check-brand.mjs` (`ALLOW` entry), `.vscodeignore`, `package.json` (scripts `desktop:dev`, `desktop:build`; devDep `@tauri-apps/api`).
- **Done when**
  1. `pnpm desktop:dev` opens a Forge window.
  2. Pick an empty test folder. In Manual mode send *"create hello.txt containing hi"*: the permission prompt shows, you allow it, and `hello.txt` exists with `hi`.
  3. A new `*.jsonl` appears under `%USERPROFILE%\.claude\projects\<folder-key>\`.
  4. Close and reopen: History lists the session, and resuming continues it.
  5. Streaming text renders smoothly (watch a long answer).
  6. `desktop/e2e/smoke.mjs` scenario 1 (stub gateway profile; launch with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`; assert the file on disk) passes.
  7. VS Code gates are green.
- **Risks**
  - Stdout pollution breaking NDJSON. Mitigated by the console redirect and `$forge` framing.
  - A shim gap hit by a request. Mitigated: it is logged by name, and the dispatcher isolates it.
  - Event throughput with `includePartialMessages`. Measure; if it is slow, batch `io_message`s per 16 ms in Node.
  - CSP blocking IPC. Test early.
  - `claude.exe` must come from a Windows `pnpm install`.
  - Node missing from PATH.

#### M2: the desktop shell and look

- **Scope**
  - `DesktopShell.vue` as a new `desktop` page in `App.vue`:
    - left: a resizable sidebar (sessions list built from `SessionsPage` parts, "+ New session", search, filters, archived);
    - centre: `ChatPage` for the active session;
    - title bar row: session title (click to rename), **Changes** (disabled until M6), **⋮** menu.
  - Light and dark themes follow Windows, with the full 84-variable map for both.
  - Native menus copying Claude Desktop's (§2.3 #9) with Forge labels: File ▸ New Session / Open Folder… / Settings… / Close Window / Exit; Edit roles plus Find; View ▸ Reload / Zoom / Toggle Sidebar / Developer Tools; Help ▸ Show Logs / About Forge.
  - Shortcuts, all of them existing features: Ctrl+N, Ctrl+W, Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+Shift+] / [, Esc stop, Ctrl+, settings, Ctrl+/ shortcuts dialog, Ctrl+; side chat, Ctrl+O focus view, Ctrl+Shift+M / I / E mode / model / effort menus, 1–9 in menus.
  - Settings opens as an in-app page.
  - `window-state` and `single-instance` plugins.
- **Files.** `src/webview/src/desktop/{DesktopShell,Sidebar,TitleBar,ShortcutsDialog,FindBar}.vue`, `App.vue` (page union), `forge-desktop-host.css` (light), `desktop/src-tauri/src/{menu,windows}.rs`. The harness gains `?host=desktop` (`harness/index.html`, `mock-host.js` answering `desktop_command`).
- **Done when**
  - Every shortcut in the list does its action (checklist);
  - `probe-oracle.js` shows 0 structural diffs on the chat, permission prompt and menus inside the desktop page, against the same baselines as today;
  - light and dark screenshots are reviewed against Claude Desktop (layout only; colours are Forge's);
  - smoke scenario 2 (Ctrl+N starts a second session; both answer) passes.
- **Risks**
  - Ctrl+N / Ctrl+W colliding with the webview's own bindings (`KeybindingManager`).
  - The official chat layout's assumptions about narrow widths.
  - The Settings page's scoped preflight inside a shell page.

#### M3: host abstraction (retire the shim)

- **Scope**
  - Add `src/host-api`. Move each coupled service behind it, in this order: `logService` → `IHostEnvironment` / `IMemento` / `IHostConfig` → `workspaceService`, `fileSystemService` (`node:fs`, `rg --files`) → `notificationService`, `dialogService`, `IPrompts` → `endpointService`, `health`, `selection` → `agentService`, `chatLocationSetting` → `ClaudeSdkService` / `ClaudeAgentService` / `handlers.ts` call sites → `webViewService` split (`IWindows`) → `forgeCommands` / `customizationCommands` into a `HostCommands` registry → `extension.ts` / `serviceRegistry.ts` taking an implementation set.
  - Create the desktop implementations in `src/desktop-host/impl/`, then delete `vscodeShim.ts`.
- **Files.** The 29 files of §2.1 plus the new folders.
- **Done when**
  - the desktop host builds with no `vscode` alias;
  - `test/desktopHostLayer.spec.ts` passes;
  - all 151 existing specs pass;
  - the VS Code e2e kit (`node .claude/skills/ui-parity/e2e/launch.mjs --code-server … --stub`) passes as before;
  - M1 and M2 smoke still pass.
- **Risks**
  - This is the largest diff, touching `ClaudeSdkService`, `handlers.ts` and `webViewService`. Mitigation: one service per commit, the VS Code gates after each, and no behaviour changes mixed in.
  - Settings-key drift between the two config stores. Mitigation: one key list generated from `package.json`, with a spec.

#### M4: projects, windows and sessions

- **Scope**
  - Project switcher in the sidebar header: Open folder…, Recent, and Detected via `listSessions()` with no `dir`.
  - **One window and one sidecar per project**; File ▸ New Window; opening a recent project focuses its window.
  - Trust prompt on first open.
  - "New session" offers **worktree** with a branch name; `git worktree add` into `<project>/.claude/worktrees/<branch>` (a validated host command); the session's `cwd` is the worktree.
  - Status dots and unread across live sessions (existing `session_states_update`); "Open in new window" for a session.
- **Files.** `desktop/src-tauri/src/{windows,recent}.rs`, `src/webview/src/desktop/ProjectSwitcher.vue`, a new request `create_worktree_session` (six places), `src/desktop-host/impl/environment.ts`.
- **Done when**
  - two projects run in two windows, each listing only its own sessions;
  - three sessions in one window run long tasks concurrently and all finish, with three `.jsonl` files;
  - a worktree session's edit leaves the main tree's `git status` clean;
  - smoke scenario 3 (worktree) passes.
- **Risks**
  - Memory with many windows (each has its own Node). Measure, and if needed share one sidecar per process later.
  - A git worktree on a dirty tree.
  - Windows path length limits in `.claude/worktrees`.

#### M5: native integration

- **Scope**
  - **Tray**: Show Forge, New Session, Quit; close-to-tray setting; first-run balloon.
  - **Windows toasts** on turn end or permission needed while unfocused (`systemNotifications`), plus `completionSound`; clicking focuses the window and session.
  - **Credential Manager** for endpoint tokens (`ISecretStore`).
  - Native dialogs for export, import, attach and add-skill.
  - Open external links.
  - **Open in ▸ editor**, **Show in Explorer** and **Copy path** on file paths.
  - Log file and Help ▸ Show Logs.
  - `HostPromptDialog` for every guided flow: Add endpoint, Select endpoint/agent, Create skill/agent/command, Add MCP server.
  - Progress toasts.
- **Files.** `desktop/src-tauri/src/{tray,notify,secrets,host_calls}.rs`, `src/desktop-host/impl/{secrets,notifications,dialogs,prompts,external}.ts`, `src/webview/src/desktop/HostPromptDialog.vue`, new pushes `host_prompt`, `show_toast` (six places each).
- **Done when**
  - Settings → Endpoints → Add endpoint completes in-app; `cmdkey /list | findstr forge.endpoint` shows the token, and it does not appear in `settings.json` or `~/.forge/endpoints`;
  - a chat over that endpoint answers;
  - minimise, finish a turn: a toast appears, and clicking it focuses the session;
  - right-click a path ▸ Open in VS Code opens the file;
  - smoke scenario 4 (add endpoint against the stub gateway) passes.
- **Risks**
  - Toast click routing on Windows through `tauri-plugin-notification` (believed limited). Fallback: the `tauri-winrt-notification` crate with an AUMID set by the installer.
  - Credential Manager's per-entry size limit (about 2.5 KB) is fine for tokens.
  - Editor detection across install types.

#### M6: diff review and files

- **Scope**
  - A **Changes** button with a `+N −M` indicator. The right pane holds a file list and a per-file diff (reusing `DiffLines.vue` rows), with click-a-line comments; **Ctrl+Enter** sends all comments as one user message ("In `a.ts` line 12: …").
  - Discard a file's changes, after confirmation.
  - A **file pane**: read-only viewer with "Open in editor", fed by `open_file`.
  - The **plan preview** in the right pane.
  - New requests: `get_git_diff_stats`, `get_git_diff`, `get_git_file_diff`, `discard_file_changes`, `read_project_file`. Each one has paths validated inside the project (reusing `webviewPaths.ts`), runs `git` with fixed argument lists (no shell, B3), and covers all six places.
- **Files.** `src/webview/src/desktop/{ChangesPane,FilePane}.vue`, `messages.ts`, `BaseTransport.ts`, `ClaudeAgentService.ts`, `handlers.ts` (or a new `gitDiff.ts`), `mock-host.js`, `test/gitDiff.spec.ts`.
- **Done when**
  - after Claude edits two files, the indicator equals `git diff --numstat`;
  - a line comment reaches Claude (visible in the transcript) and produces a new diff;
  - discard makes `git status` clean for that file;
  - path-traversal attempts in specs are rejected;
  - smoke scenario 5 passes.
- **Risks**
  - Large diffs: cap the size and virtualise the rows.
  - Binary files.
  - Line-ending noise on Windows (`core.autocrlf`).

#### M7: terminal, packaging, polish

- **Scope**
  - "Open Forge in Terminal" → `wt.exe`, or PowerShell (`ITerminalLauncher`, existing `JI0` validation).
  - **Bundle `node.exe`** as a Tauri `externalBin` (`binaries/node-x86_64-pc-windows-msvc.exe`) so the app no longer needs system Node.
  - NSIS installer (per-user); About dialog with versions (app, SDK, CLI from `claude --version`).
  - Help ▸ "Open data folder".
- **Files.** `tauri.conf.json` (`bundle.externalBin`, `bundle.resources`, `bundle.windows.nsis`), `desktop/scripts/build-desktop.mjs`, `src/desktop-host/impl/terminal.ts`.
- **Done when**
  - a fresh Windows user account without Node installs `Forge_x.y.z_x64-setup.exe`, opens a folder and chats (M1's check);
  - the terminal row opens Windows Terminal running Forge's CLI in the folder.
- **Risks**
  - Installer size (~234 MB `claude.exe` + ~80 MB `node.exe`). It is acceptable for personal use.
  - SmartScreen warns because the build is unsigned.

#### M8 (optional): parity extras

An embedded terminal pane (xterm.js + node-pty ConPTY in the sidecar, Ctrl+`), split view (Ctrl+click), a frameless custom title bar like Claude's, the "All projects" sidebar view, and `/code-review` findings in the Changes pane. Each item ships alone, with its own smoke scenario.

### 4.6 Build and install (local, Windows)

**One-time prerequisites:** Rust stable (MSVC) via `rustup`; Visual Studio Build Tools with "Desktop development with C++"; the WebView2 Runtime (present on Windows 10/11); Node 22 and pnpm 10; `cargo install tauri-cli --version "^2"`.

```powershell
pnpm install                 # on Windows, so @anthropic-ai/claude-agent-sdk-win32-x64 (claude.exe) is installed
pnpm desktop:dev             # = vite dev (5173) + desktop host build --watch + cargo tauri dev
pnpm desktop:build           # = build:webview → host bundle → stage → cargo tauri build
```

`desktop/scripts/build-desktop.mjs` stages:
- `dist/media/*` + `desktop/web/index.html` + welcome PNGs → `desktop/dist/web` (`frontendDist`);
- `src/desktop-host/main.ts` (esbuild, CJS, Node 22, minified like `esbuild.ts`) → `desktop/dist/host/forge-host.cjs`;
- `resources/native-binary/claude.exe`, `resources/ripgrep/x64-win32/rg.exe`, `resources/endpoint-rules/**` → Tauri `bundle.resources`.

Outputs:
- `desktop/src-tauri/target/release/forge-desktop.exe`;
- the installer `…/bundle/nsis/Forge_<ver>_x64-setup.exe`.

How the Claude Code CLI is found, in order:
1. the `claudePath` desktop setting, if set;
2. the bundled `<resources>/native-binary/claude.exe`, through the existing `findClaudeBinary` with `asAbsolutePath` = the resource dir (`cliLaunch.ts:55-77`);
3. no PATH fallback by default (open question Q3).

Bundling keeps the SDK and CLI a matched pair, as `cliLaunch.ts:4-11` requires.

Where things live:

| What | Path |
| --- | --- |
| App settings (former `forge.*`) | `%APPDATA%\com.msaid.forge\settings.json` |
| App state (former `globalState`) | `%APPDATA%\com.msaid.forge\state.json` |
| Recent projects, window state | `%APPDATA%\com.msaid.forge\recent.json`, plugin file in the same folder |
| Logs (host and Rust) | `%LOCALAPPDATA%\com.msaid.forge\logs\` |
| Endpoint tokens | Windows Credential Manager, service `Forge` |
| Shared with the CLI and Forge for VS Code (unchanged) | `%USERPROFILE%\.claude\…`, `%USERPROFILE%\.forge.json`, `%USERPROFILE%\.forge\endpoints`, `%USERPROFILE%\.claude\projects` (conversations are shared across VS Code, desktop and terminal) |

Not done: code signing (SmartScreen shows "More info → Run anyway"), Store publishing, and auto-update (`tauri-plugin-updater` needs a signing key and a hosted manifest, which is not nearly free).

### 4.7 Testing

- **Keep green at every milestone:** `pnpm test` (151 specs), `pnpm run typecheck:all`, `pnpm run build` (all lint, brand, token and command gates), the UI harness with `probe-oracle.js` baselines, and the VS Code e2e kit.
- **New TypeScript specs:**

  | Spec | Proves |
  | --- | --- |
  | `test/desktopStdio.spec.ts` | framing, junk lines ignored, size cap, console redirect |
  | `test/desktopHostCalls.spec.ts` | whitelist, timeouts, error mapping |
  | `test/desktopConfig.spec.ts` | the 17 keys and their defaults from `package.json`; change events; precedence with `~/.claude` layers unchanged |
  | `test/desktopMemento.spec.ts` | atomic writes, corrupt-file recovery |
  | `test/desktopHostLayer.spec.ts` (M3) | no `vscode` reachable from `src/desktop-host/main.ts` |
  | `test/gitDiff.spec.ts` (M6) | path validation, fixed git argv |

  `protocolDrift.spec.ts` already covers new request types.
- **Rust:** `cargo test` for `ipc.rs` (envelope validation, `webviewId` overwrite, size cap) and `host_calls.rs` (parameter validation, URL schemes, path checks), plus `secrets.rs` behind a trait with a fake.
- **Harness:** `?host=desktop` renders `DesktopShell` with `mock-host.js`, so `probe-oracle.js` keeps measuring the official surfaces inside the shell.
- **E2E per milestone:** `desktop/e2e/smoke.mjs` launches the built `forge-desktop.exe` with an isolated `USERPROFILE` / `APPDATA` (as `e2e/launch.mjs` does). It attaches over WebView2's CDP (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`) with the existing `e2e/cdp.mjs`, and scripts the model with `e2e/stub-gateway.mjs`. Each scenario checks evidence on disk:

  | Scenario | Milestone | Evidence |
  | --- | --- | --- |
  | 1 | M1 | chat creates a file |
  | 2 | M2 | second session |
  | 3 | M4 | worktree isolation |
  | 4 | M5 | endpoint token in Credential Manager |
  | 5 | M6 | diff counts and comment round-trip |
  | 6 | M7 | installed build without Node |

---

## 5. Open questions, each with a recommended answer

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | Shim first, or interfaces first? | **Shim first (M1), interfaces in M3.** Chat works on day one with no edits to `src/services`; the shim is deleted once M3 lands. |
| Q2 | One sidecar per window, or one for the whole app? | **Per window (= per project).** It matches the host's single-workspace assumption (38 workspace-folder reads, `ClaudeAgentService.getCwd`), as VS Code's one extension host per window does. Revisit only if measured memory hurts. |
| Q3 | Bundle `claude.exe`, or use the one on PATH? | **Bundle** (the SDK and CLI must match, `cliLaunch.ts:4-11`), with an explicit `claudePath` override for experiments. No silent PATH fallback. |
| Q4 | Permission-mode labels: VS Code's (what Forge shows) or Desktop's (Manual / Accept edits / Plan / Auto / Bypass permissions)? | **Desktop's labels in Forge Desktop**, through a host-keyed label table in `ModeSelect`; the VS Code build is unchanged. The goal is to mimic the desktop app. |
| Q5 | Node runtime: system Node, bundled `node.exe`, or Node SEA? | **System Node in M1, bundled `node.exe` from M7.** Node SEA (single exe) is optional later; it adds a build step for little gain. |
| Q6 | Embedded terminal? | **No until M8.** External Windows Terminal covers "Open Forge in Terminal"; embed only if you miss it. |
| Q7 | Global shortcut / Quick Entry window like Claude's? | **Skip.** At most, a global shortcut that shows the main window (one plugin call), if wanted later. |
| Q8 | Close-to-tray by default? | **Yes**, like Claude Desktop (V-bundle), with a setting to turn it off. |
| Q9 | Where do the 17 `forge.*` settings live, and can VS Code's values be imported? | **`%APPDATA%\com.msaid.forge\settings.json`**, same keys. Offer a one-time "Import from VS Code" that reads `%APPDATA%\Code\User\settings.json` `forge.*` keys. Tokens can't be imported (VS Code's SecretStorage is VS Code-encrypted), so re-enter them. |
| Q10 | Custom frameless title bar like Claude's? | **Native title bar until M8.** A frameless window needs hand-built caption buttons, drag regions and Snap Layouts handling; cosmetic only. |
| Q11 | Should the Rust host ever take over the relay? | **Not unless a concrete need appears** (for example dropping Node entirely). It is self-contained (`relay.ts`), so it is the one piece that could move cleanly later. |
| Q12 | Repo layout: `desktop/` inside FORGE, or a separate repo? | **Inside FORGE.** The desktop host compiles the same `src/` and the drift tests must see both. |

---

## Appendix A: the Claude Desktop IPC evidence used

From `desktop:.vite/build/mainView.js`, these are the interfaces whose method names back the "V-bundle" marks in §2.3 (counts are methods):

| Interface | Methods |
| --- | --- |
| `LocalSessions` | 212 |
| `LocalAgentModeSessions` | 97 |
| `Launch` (preview / browser) | 60 |
| `WindowControl` | 9 |
| `WindowState` | 7 |
| `ClaudeCode` | 7 |
| `DesktopNotifications` | 5 |
| `GlobalShortcut` | 3 |
| `FilePickers` | 2 |
| `MenuEvents` | 3 |
| `QuickEntry` | 2 |
| `Toast` | 1 |
| `LocalSessionEnvironment` | 2 |
| `CCDScheduledTasks` | 10 |
| `FileSystem` | 18 |
| `AppPreferences` | 3 |
| `CcdCli` | 3 |
| `FindInPageProvider` | 4 |

`LocalSessions` methods relevant here:
- Sessions: `start`, `sendMessage`, `interrupt`, `getAll`, `searchSessions`, `archive`, `unarchive`, `delete`, `forkSession`, `rewind`, `setModel`, `setEffort`, `setFastMode`, `setPermissionMode`, `onToolPermissionRequest`, `respondToToolPermission`, `cancelQueuedMessage`, `promoteQueuedMessage`, `reorderQueuedMessage`, `changeCwd`, `addDirectories`, `getDetectedProjects`, `listCliSessions`, `importCliSession`, `startSideChat`, `sendSideChatMessage`, `stopTask`, `setFocusedSession`, `checkTrust`, `saveTrust`.
- Git and diff: `getGitDiff`, `getGitDiffStats`, `getGitDiffFilePatch`, `getDiffFileContent`, `reviewDiff`, `commitAllChanges`, `discardWorkingTree`, `stashWorkingTree`.
- Editors and terminal: `getInstalledEditors`, `openInEditor`, `showSessionFileInFolder`, `startShellPty`, `writeShellPty`, `resizeShellPty`.
