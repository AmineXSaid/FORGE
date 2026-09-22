# Step 28: @browser tabs and "Browse the web" — results

Wires the three browser requests, ports the official Chrome MCP client, the
extension probe and the `@browser` mention expander, and turns on the "+" row
that was built in an earlier step but permanently hidden.

## What the bundle actually says

| Piece | Source | Code |
| --- | --- | --- |
| Senders | `index.js` @3316158 | `ensureChromeMcpEnabled($){return this.sendRequest({type:"ensure_chrome_mcp_enabled"},$)}` · `disableChromeMcp($){…({type:"disable_chrome_mcp"},$)}` · `createNewBrowserTab(){return this.sendRequest({type:"create_new_browser_tab"})}` |
| Dispatcher | `extension.js` @3064039 | the two chrome cases throw `channelId is required for …`; `create_new_browser_tab` is a bare `return await this.createNewBrowserTab()` |
| `ensureChromeMcpEnabled` | `extension.js` @3055530 | `withChannel`: `X=state.status==="disconnected"` → `{status:"connecting"}` → `Y={...channel.mcpServers,"claude-in-chrome":getChromeMcpServerConfig()}` → `query.setMcpServers(Y)` → throw the joined `errors` → `{status:"connected"}` → `{type:"ensure_chrome_mcp_enabled_response",wasDisabled:X}`; `catch` sets `{status:"error",error}` and rethrows |
| `disableChromeMcp` | `extension.js` @3056400 | `X=state.status==="connected"`, `{"claude-in-chrome":J,...Y}=mcpServers`, `setMcpServers(Y)`, and **only if `X`** `in.enqueue` the synthetic `[Browser disconnected: …]` user message |
| Server config | `extension.js` @3291268 | `getChromeMcpServerConfig(){let{command,args}=I8(this.getClaudeBinary(),["--claude-in-chrome-mcp"]);return{type:"stdio",command,args}}` |
| `I8` | `extension.js` @2864719 | `executableArgs` first, else `nodePath` + path, else the bare path |
| MCP client `AF` | `extension.js` @3181033 | `StdioClientTransport({command,args,env:{...binary.env,USER_TYPE:"external"}})`, `Client({name:"claude-vscode-chrome-mcp-client",version:"2.1.270"},{capabilities:{}})`, `callTool({name:"tabs_context_mcp",arguments:{createIfEmpty:!0}},CallToolResultSchema)` |
| Extension probe | `extension.js` @2860285 | `VD0="fcoeoabgfenejglbffodgkkbkcdhcgfn"`, `HD0` (7 browsers), `qD0` (per-platform profile roots), `ZD0` (walk `Default` / `Profile N` → `Extensions/<id>`) |
| Install prompt | `extension.js` @3308953 | on darwin/win32/linux, unless `globalState["chromeExtensionNotificationDismissed"]`, `showInformationMessage("Claude in Chrome: …","Install Extension","Don't Show Again")`, then `super.ensureChromeMcpEnabled` |
| Support flag | `extension.js` @3061483, @3310292 | `browserIntegrationSupported:this.isBrowserIntegrationSupported()` on the **init state**; `isBrowserIntegrationSupported(){return this.authManager.getAuthStatus()?.authMethod==="claudeai"}` |
| "+" row | `index.js` @5001250 | `q.push({id:"browser",label:"Browse the web",title:"Add browser tabs to the conversation",icon:F(Xt,{}),onSelect:()=>{$("@browser:"),Q(!1)}})` — an entry in `pV0`'s own array behind a plain `if(Z)`, **not** a `registerAction` |
| Send path | `index.js` @3495800 | `dR1($,J,Q, …, G?()=>this.ensureChromeMcpEnabled():async()=>!1, ()=>this.createNewBrowserTab(), G&&(config.browserIntegrationSupported??!1))` |
| Mention expander `Oj0` | `index.js` @3455450 | `/@browser(?:(?::([^:]*):(\d+):([^\s]*))|:new_tab\|(?=\s\|$))/g`, instruction block only `if(await J())`, `q===""&&U==="0"` → `createNewBrowserTab()` |
| Instruction text `Aj0` | `index.js` @3448888 | 54 lines, ported verbatim |
| Mention rows | `extension.js` @3306700, @3308572 | `findFiles` branches on a `browser:` query; `filterBrowserTabs` writes `path:"browser:<group>:<id>:<url>"` / `"browser:new_tab"`, `name:"browser:<Title_With_Underscores>"`, `type:"browser"` |
| Row markup | `index.js` @4962200 | a browser row is globe icon + `fileName` + the trailing word `"browser"` |

### Four step-file / prompt claims corrected

1. **"Compute `browserIntegrationSupported` the way the official does"** (step file).
   Misleading twice over. It is **not** computed in the webview at all — it is a
   field on the host's init state (`connection.config.value?.browserIntegrationSupported`),
   which Forge's `InitResponse.state` did not have. And the official's own test
   is `authStatus.authMethod === "claudeai"`, which Forge cannot evaluate because
   login is out of scope (`get_auth_status` stays commented out). See the scope
   table below for what Forge gates on instead.
2. **"The row's gate is a `registerAction` condition."** It is not a registry row
   at all; the "+" menu builds its own array and the gate is a plain `if`.
   Forge's `AddMenu.vue` already had this shape, so only the prop had to be fed.
3. **"A bare `@browser:` is the mention."** It is not: the official regex
   deliberately does not match `@browser:` on its own. The "+" row inserts that
   prefix so the composer's `@` dropdown can list the open tabs and complete it
   into `@browser:<group>:<id>:<url>` — or the user types `@browser:new_tab`, or
   leaves a bare `@browser` followed by a space. This is why the step's second
   task ("wire `@browser:` tab mentions the way the official does") also needed
   the `findFiles` browser branch; without it the row inserts text that resolves
   to nothing. A spec records the non-match explicitly so nobody "fixes" it.
4. **"`create_new_browser_tab` goes through the session."** It does not: the
   official opens a **second, private MCP stdio connection** to the same binary,
   because the webview needs the tab ids before the turn is sent.

## Scope decisions

| Decision | Why |
| --- | --- |
| `browserIntegrationSupported` = "the Claude binary resolves" | The official reads an auth method Forge has no access to (login is out of scope, `get_auth_status` is commented out and stays that way). What the feature actually needs is the binary: the browser MCP server *is* `claude --claude-in-chrome-mcp`. So Forge gates on something it can observe and that the feature genuinely depends on. A build with no bundled CLI leaves the row out entirely (B4) rather than showing one that cannot connect. |
| The install prompt is ported, and does **not** gate the row | The official shows the row regardless of whether the Chrome extension is installed, and prompts to install it on the first connect. Gating the row on extension presence would hide the feature from every user who has not installed it yet — worse product, and not what the official does. |
| `chromeMcpState` is kept host-side, not pushed | The official keeps it on the channel *and* pushes it to the webview through `update_state`, where a browser status pill reads it. Forge has no `update_state` push and no pill (out of scope), but the state is still needed host-side: `wasDisabled` / `wasEnabled` are transitions, and the disconnect notice must only fire when it really was connected. |
| The MCP client identifies as `forge-vscode-chrome-mcp-client` | The official sends `claude-vscode-chrome-mcp-client` / `2.1.270`. This is `clientInfo` on the MCP `initialize`; claiming to be the official extension would be untrue. If the Chrome MCP server ever gates on that name this is the line to change. **Unverified against a real Chrome MCP server** — see the checklist. |
| `getBrowserTabs` is ported even though no Forge surface lists tabs | Standing direction: within an in-scope feature, expose what the API exposes. The same connection serves it, and `findFiles`'s browser branch needs it. |
| `@terminal:` mentions are **not** added | The official's `findFiles` has a parallel `terminal:` branch behind `process.env.AT_MENTION_TERMINAL==="true"`. Forge has no `@terminal` mentions and step 28 does not name them. Out of scope; flagged here, not built. |

## Results

> Every row below was driven in the harness on port 8743 with a real Chrome over
> CDP (`cdp-driver.mjs`), the served `/main.js` byte-identical to
> `dist/media/main.js` (1,925,796 bytes) and `cssRules` `1,5,9847`. The two
> `channelId is required` rejections cannot be produced by any control, so they
> are driven at the **real dispatcher** in vitest instead, and marked
> spec-verified.

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| "+" → menu, browser supported | — | — | three rows: Upload from computer / Add context / **Browse the web**, the last with the official `Xt` globe (`d` starts `M7.27056 3.0498`) | works |
| "+" → menu, unsupported (`?noBrowser`) | — | — | two rows; "Browse the web" absent | works |
| "+" → Browse the web | `list_files_request {pattern:"browser:"}` | `findFiles`'s browser branch: tabs only, fetched live | menu **closes**, `@browser:` inserted, the `@` dropdown opens listing `browser:Anthropic_Docs` · `browser:GitLab_Pajamas` · `browser:new_tab`, each with the globe glyph and the trailing word `browser` | works |
| Picking a tab in that dropdown | — | — | the draft becomes `@browser:group-1:11:https://docs.anthropic.com/en/docs ` | works |
| Sending a fully-specified mention (first time) | `ensure_chrome_mcp_enabled` → `{wasDisabled:true}` | `setMcpServers({…, "claude-in-chrome": {type:"stdio", command:<binary>, args:["--claude-in-chrome-mcp"]}})` | content is `<browser_instruction>…</browser_instruction>`, `<browser tabGroupId="group-1" tabId="11">https://…</browser>`, then the prompt. **No tab created** — the ids were given | works |
| Sending `@browser:new_tab` while already connected | `ensure_chrome_mcp_enabled` → `{wasDisabled:false}`, then `create_new_browser_tab` | `tabs_context_mcp {createIfEmpty:true}` | content is `<browser tabGroupId="group-1" tabId="100"></browser>` then the prompt — **no second instruction block** | works |
| Sending a prompt with no mention | none | — | content is the prompt alone; nothing browser-related sent | works |
| A typed `@browser:new_tab` while unsupported | none | — | the mention is left as plain text; no `ensure_chrome_mcp_enabled`, no tab | works |
| `disable_chrome_mcp`, from connected | `{type:"disable_chrome_mcp"}` | only `claude-in-chrome` removed from `mcpServers`; `{wasEnabled:true}`; the synthetic `[Browser disconnected: …]` user message enqueued once | no Forge row (the official's is on the browser status pill, out of scope) | spec-verified |
| `disable_chrome_mcp`, from disconnected | `{type:"disable_chrome_mcp"}` | `{wasEnabled:false}`; **nothing enqueued** | — | spec-verified |
| `ensure_chrome_mcp_enabled` with no channelId | `{type:"ensure_chrome_mcp_enabled"}` | `Error: channelId is required for ensure_chrome_mcp_enabled`, before `setMcpServers` | rejected promise | spec-verified (real dispatcher) |
| `disable_chrome_mcp` with no channelId | `{type:"disable_chrome_mcp"}` | `Error: channelId is required for disable_chrome_mcp` | rejected promise | spec-verified (real dispatcher) |
| `ensure_chrome_mcp_enabled` on an unopened channel | — | `Error: Channel not found: nope` (the official `withChannel`) | rejected promise | spec-verified |
| `setMcpServers` reporting errors | — | throws the joined `"<name>: <message>"`, state left `{status:"error",error}`, and the server is **not** remembered as installed | rejected promise | spec-verified |
| `@` mention list with no browser query | `list_files_request {pattern:"src/"}` | files first, cached tabs appended | ordering matches the official `findFiles` | works |
| `@` mention list while typing towards `browser:` (`"bro"`) | `list_files_request {pattern:"bro"}` | **tabs first**, then files | ordering matches | spec-verified |

**Counts:** works 9 · spec-verified 7 · partial 0 · broken 0 · left out 2 (below)

## Gates

- `pnpm test`: `Test Files 29 passed (29) · Tests 710 passed (710)` (47 of them new)
- `pnpm run typecheck:all`: clean (`tsc --noEmit`, `vue-tsc -p src/webview/tsconfig.json --noEmit`)
- `pnpm run build`: `exit=0` — `lint:brand` clean (345 files), `lint:tokens` clean (240 used / 383 defined), `lint:commands` clean (20 commands, 13 references), webview `✓ built in 18m 50s`, extension built

## Oracle

| Window (root selector) | Structural diffs | Colour diffs | Baseline |
| --- | --- | --- | --- |
| `.fg-addmenu__menuPopup`, 3 rows (browser supported) | **0** (16/16 clean) | 0 | new baseline — never captured before |
| `.fg-addmenu__menuPopup`, 2 rows (unsupported) | **0** (11/11 clean) | 0 | new baseline |

No other window's markup changed, so the step-27 baselines stand unmeasured this
pass: `.fg-commandmenu__menuPopup` 82/82, `.fg-composer__inputWrapper` 30/33,
`.fg-menu__menuPopup` 41/41, `.fg-shell__header` 15/15,
`.fg-sessionsdropdown__dropdown` 57/57. Saying so rather than re-pasting them as
if they were re-run.

## Specs added

`test/browserIntegration.spec.ts`, 47 cases:

- `claudeCommandLine` (`I8`): `executableArgs` first, `nodePath` second, bare path third.
- `chromeMcpServerConfig`: the exact `{type:"stdio"}` and the flag and server-key constants.
- `browserProfileRoots`: win32 Local vs opera's Roaming, arc dropped on linux, an unlisted platform answers nothing.
- `findChromeExtension`: found under `Default` / `Profile N`; not found; an absent root skipped and the walk continues; `ProfileX` and `System Profile` must **not** match; an empty root list touches no disk.
- `chromeMcpClient` parsers: new-tab JSON, empty/text-less content, `Ul$` flattening, group id stamped onto listed tabs, `"No MCP tab groups found."` as an empty group.
- `browserTabEntries`: the mention path form, `new_tab` special case, case-insensitive title/url filter, and a **round trip** — a listed row's path parsed back by `browserMentionBlocks`.
- `handleListFiles`: `browser:` query → tabs only, live; `"bro"` → tabs first; anything else → files first, cached; empty pattern.
- `ClaudeAgentService`: add-only `setMcpServers`, `wasDisabled` both ways, joined error + error state + not-remembered, channel-not-found, missing channelId through `processRequest`, install prompt copy + dismissal, remove-only + notice gating, `create_new_browser_tab` unscoped, the unsupported guard spawning nothing, cache fallback on a failed fetch.
- `handleInit`: `browserIntegrationSupported` reported both ways.
- `browserMentionBlocks`: no mention → no calls at all; `new_tab` creates; **bare `@browser:` does not match**; word-boundary and end-of-input forms; `@browsers` is not a mention; fully-specified ids create nothing; the instruction block only when `wasDisabled`; several mentions in order; and the instruction text checked against three lines read out of the bundle plus its 54-line length.

### Mutation check (does each guard bite?)

A throwaway script broke each guard in turn, ran the spec, and restored the file.
**15 of 15 bite.** One missed on the first run — `handleInit` replacing
`isBrowserIntegrationSupported()` with `true` went unnoticed because nothing
exercised `handleInit`; a `handleInit` case was added and it now bites.

## Rows deliberately left out and why

From `out-of-scope.md` (unchanged by this step): microphone / speech-to-text;
login and "Switch account"; "Account & usage…" and the usage/context meter;
Remote Control; feedback (`submit_feedback`, `/feedback`, `/bug`, "Report a
problem" — removed in step 33); thumbs rating; "Switch models when a message is
flagged"; `/btw`. Also not built: the worktree pill and `generate_session_title`.

Left out by this step specifically:

| Left out | Why |
| --- | --- |
| A browser status pill / disconnect control | The official's `chromeMcpState` UI. `disable_chrome_mcp` is wired through the host, the transport and the session, but has no row, because the surface it lives on is not in scope. |
| `@terminal:` mentions | The official's parallel `findFiles` branch, behind an env flag. Not named by step 28. |
| "Browse the web" on a build with no Claude binary | B4: the row's backend cannot work, so the row is not registered. Proved with `?noBrowser`. |

## Pre-existing issues (unchanged, not fixed here)

Still open from earlier steps: `handleGetAssetUris` uses `process.cwd()`; the
mock host acks unknown requests without success; the Settings page lists models
through an `sdk_probe` spawn; `~/.forge.json` gets every default key on the first
settings write; the `AskUserQuestion` prompt is a generic "Yes / No"; CLAUDE.md's
Permissions scope line is outdated; step 21 never wired `session_archive_changed`
into the webview; `handleNewConversationTab` is a stub and `openNewInTab` is
hardcoded `false`; `.fg-chat__errorMessage` is ported but dead; the official's
replay placement machinery is deliberately not ported.

One new observation, **not** introduced by this step: completing any `@` mention
leaves a double space after the inserted path (`replaceRange` appends one and the
editor keeps a trailing `&nbsp;`). It is harmless for `@browser` — the regex's
`[^\s]*` stops at the first space — and it affects file mentions identically, so
it is recorded rather than fixed inside a backend step.

## VS Code checklist for the user (unverified until you run it)

The harness proves the webview↔host contract. Everything below needs a real
Chrome, the Claude in Chrome extension and the real CLI, none of which this agent
can observe.

1. Open Forge in a workspace. **Expected:** "+" shows three rows, the third
   "Browse the web" with a globe icon.
2. Click it with **no** Claude in Chrome extension installed. **Expected:** a VS
   Code notification, *"Claude in Chrome: Install the browser extension to
   control Chrome from Claude Code"*, with **Install Extension** and **Don't Show
   Again**. Install Extension opens `https://claude.ai/chrome`.
3. Click **Don't Show Again**, then repeat step 2. **Expected:** no notification
   the second time (`globalState["chromeExtensionNotificationDismissed"]`).
4. With the extension installed and Chrome running, click "+" → Browse the web.
   **Expected:** the `@` dropdown lists your real open tabs as
   `browser:<Tab_Title>` plus a `browser:new_tab` row.
5. Pick a tab, type "summarise this page" and send. **Expected:** the CLI gains
   the `mcp__claude-in-chrome__*` tools, and Claude reads that tab.
6. Send `@browser:new_tab open example.com`. **Expected:** a **new Chrome tab**
   opens and Claude navigates it.
7. Check the Forge output channel for `Chrome MCP: Connecting to server with
   command: <claude binary> --claude-in-chrome-mcp` and
   `Chrome MCP: Successfully connected to server`. **Expected:** both lines, and
   the binary path is the one Forge launches sessions with.
8. Confirm the MCP client name is accepted: if step 5 or 6 fails with a
   handshake error, the `forge-vscode-chrome-mcp-client` `clientInfo` is the
   thing to change back to the official's (see the scope table).
