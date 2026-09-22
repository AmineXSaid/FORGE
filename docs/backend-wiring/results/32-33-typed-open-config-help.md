# Steps 32 and 33 — results

Two steps in one pass, because 33 removes the only caller of the command 32
deletes. `open_config_file`'s `command:<id>` escape hatch is gone entirely, and
"Report a problem" is gone with it.

## What the bundle actually says

| Piece | Source | Code |
| --- | --- | --- |
| Sender, config | `index.js` | `openConfig($){return this.sendRequest({type:"open_config",searchString:$})}` |
| Sender, help | `index.js` | `openHelp(){return this.sendRequest({type:"open_help"})}` |
| The "/" rows | `index.js` | `registerAction({id:eV.config,label:"General config…",…},"Settings",()=>{J.openConfig()})` — **no argument** |
| Handler, config | `extension.js` | `case"open_config":return await this.openConfig($.request.searchString),{type:"open_config_response"}` |
| `openConfig` body | `extension.js` | `await commands.executeCommand("workbench.action.focusFirstEditorGroup"),await commands.executeCommand("workbench.action.openSettings",$\|\|"claudeCode")` |
| `openHelp` body | `extension.js` | `let $=Uri.parse("https://code.claude.com/docs/en/vs-code");await env.openExternal($)` |
| Version row | `index.css` | `.versionRow_G_S7FQ{display:flex;…justify-content:space-between;…padding:4px 12px 8px;font-size:.8em}` |

Two details the step file did not have:

1. **The row passes no search string.** The official's "General config…" calls
   `openConfig()` bare and leans on the host's `$ || "claudeCode"` fallback.
   Forge's fallback is `"forge"`, which is the prefix on every Forge setting.
   So there is no "Forge brand search string" to decide — the correct port is
   to send nothing, exactly as the official does.
2. **`focusFirstEditorGroup` comes first.** Without it the settings editor can
   open behind whatever has focus. It is one line and it is in the official.

## The part the step file could not have anticipated

Step 32 was written before the endpoint track existed, and says "delete the
`command:` branch". By the time it ran, seven of the ten allow-listed commands
were the Endpoints tab's. Deleting the branch and leaving them would break the
tab; keeping the branch for them would keep the thing B3 forbids.

Resolved with a third typed request rather than an exception:

```ts
export type EndpointAction =
  | "select" | "add" | "edit" | "status" | "diagnostics" | "capabilities" | "models";
```

The webview names an **action**; `ENDPOINT_ACTION_COMMANDS` in `handlers.ts`
owns the mapping to a `forge.*` command. An unknown action throws rather than
no-opping, because a silent no-op is how "the button does nothing" happens —
the defect this branch started with. The lookup uses
`Object.prototype.hasOwnProperty`, so `__proto__`, `constructor` and `toString`
are rejected like any other unknown action rather than resolving to something
on `Object.prototype`.

`forge.showLogs` needed no replacement: its only caller was "Report a problem",
which step 33 removes. `forge.newConversation` had no webview caller at all.

## Step 33: the version row

The official row is `[Report a problem, version]` under `justify-content:
space-between`. Forge drops the button — feedback is out of scope, and the
button Forge had opened the log channel, which is not what the official one
does. The ported `versionRow` rule is **not** overridden to move the remaining
text: with one child, `space-between` leaves it at the start, and overriding a
ported rule to "fix" that is the trap rule 4 names.

## Results

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| "/" ▸ General config… | `open_config` (no searchString) | `focusFirstEditorGroup`, then `openSettings "forge"` | settings editor, filtered | **works** (harness: `__forgeConfigSearches = ["forge"]`); unverified in real VS Code |
| "/" ▸ View help docs | `open_help` | `env.openExternal(HELP_URL)` | the docs | **works** (harness: the official URL); unverified in real VS Code |
| Endpoints ▸ Select… | `run_endpoint_action {select}` | `forge.selectEndpoint` | picker | **works** (harness) |
| Endpoints ▸ Add… | `run_endpoint_action {add}` | `forge.addEndpoint` | guided flow | **works** (harness) |
| Endpoints ▸ Open | `run_endpoint_action {edit}` | `forge.editEndpoints` | settings.json | **works** (harness) |
| Endpoints ▸ Run | `run_endpoint_action {diagnostics}` | `forge.runEndpointDiagnostics` | ladder report | **works** (harness) |
| Endpoints ▸ Probe | `run_endpoint_action {capabilities}` | `forge.detectCapabilities` | proposed block | **works** (harness) |
| Endpoints ▸ List | `run_endpoint_action {models}` | `forge.listEndpointModels` | model picker | **works** (harness) |
| Endpoints ▸ Show | `run_endpoint_action {status}` | `forge.endpointStatus` | output channel | **works** (harness) |
| "/" ▸ Report a problem | — | — | **row removed** | **removed** (out of scope, CLAUDE.md) |
| `open_config_file {configType:"command:…"}` | — | rejected | error | **works** (harness + spec) |

**Counts:** 1267 unit tests (44 files, up from 1253), `typecheck:all`,
`lint:forge` and `build` clean.

## Measurements

`grep -rn "command:" src/webview/src` finds only prose and unrelated
identifiers — no config-type usage remains.

Posted at the stub host directly, the way a hostile webview would:

| Posted | Answer |
| --- | --- |
| `open_config_file {configType:"command:workbench.action.quit"}` | `error: open_config_file no longer runs commands…` |
| `open_config_file {configType:"command:forge.openSettings"}` | same error — **deleted, not narrowed** |
| `open_config_file {configType:"mcp-global"}` | `open_config_file_response` (file types still work) |
| `run_endpoint_action {action:"forge.runDoctor"}` | `error: Unknown endpoint action` |
| `run_endpoint_action {action:"__proto__"}` | `error: Unknown endpoint action` |
| `run_endpoint_action {action:"status"}` | `run_endpoint_action_response` |
| `open_config {searchString: "x"×5000}` | recorded search string length **200** |

`probe-oracle.js` on the "/" menu, animations finished first:
**81/81 clean, 0 structural diffs** — one element fewer than the 82 before this
step, which is exactly the removed button. The version row's own markup:

```html
<div class="fg-commandmenu__versionRow"><span class="fg-commandmenu__versionText">v0.1.0</span></div>
```

## VS Code checklist for the user

Unverified — the agent cannot observe real VS Code.

1. "/" ▸ **General config…**
   *Expect:* VS Code's settings editor opens, filtered to `forge`, in the first
   editor group.
2. "/" ▸ **View help docs**
   *Expect:* `https://code.claude.com/docs/en/vs-code` opens in your browser.
3. Open "/" and look at the bottom.
   *Expect:* the version text `v0.1.0` and **no** "Report a problem".
4. Settings ▸ Endpoints, click each of the seven buttons.
   *Expect:* Select… a picker; Add… the five questions; Open settings.json at
   `forge.endpoints`; Run the diagnostics ladder; Probe the capability sweep;
   List the model picker; Show the output channel.
5. Settings ▸ MCP Servers ▸ the global/project config buttons.
   *Expect:* still open their JSON files — `open_config_file` kept its file
   types, only the command branch went.
