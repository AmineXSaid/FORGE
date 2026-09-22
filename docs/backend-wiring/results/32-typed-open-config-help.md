# Step 32 results: typed `open_config` / `open_help` replace the `command:` allow-list

## Results

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| "/" → General config… | `{type:"open_config"}` | `focusFirstEditorGroup`, then `openSettings` with `"forge"` | menu closes, VS Code settings open filtered to Forge | works |
| "/" → View help docs | `{type:"open_help"}` | `env.openExternal(https://code.claude.com/docs/en/vs-code)`; **no** command run | menu closes, the docs open | works |
| a search string | `{type:"open_config", searchString:"forge.cliArgs"}` | `openSettings` with that string | — | works |
| a search that is not a string | `…searchString:42` | `open_config: searchString must be a string`, nothing run | — | works |
| a search over the cap | `…searchString:"x".repeat(201)` | `open_config: searchString is longer than 200 characters`, nothing run | — | works |
| a `command:` config type | `{type:"open_config_file", configType:"command:workbench.action.quit"}` | `Failed to open config file: Not a config file: command:workbench.action.quit` | — | works |
| the same for a Forge command | `…configType:"command:forge.showLogs"` | the same rejection | — | works |

**Counts:** works 7 · partial 0 · broken 0 · left out 2 (below)

The property this step buys, and the allow-list never could: **there is no path
from the webview to a VS Code command of its choosing.** `open_config` runs one
fixed pair of commands and puts the webview's string in a search box;
`open_help` takes no payload at all; `open_forge_settings` (step 31) takes a tab
id from a closed set; and `open_config_file`'s `command:` branch is gone.

## Decisions written down, as the step file asks

- **The config search string.** The official's default is `"claudeCode"`
  (`$||"claudeCode"`). Forge's is **`forge`**, its settings prefix — which is
  what `open_config_file {configType:"vscode"}` already searched for, so the row
  behaves as it did. It lives in `src/shared/messages.ts` as
  `FORGE_CONFIG_SEARCH`.
- **The help URL.** Kept as the official's,
  `https://code.claude.com/docs/en/vs-code` (`FORGE_HELP_URL`), and **not**
  rebranded: Forge runs the Claude Code CLI, and that page documents what it
  actually does. The row's label stays "View help docs".
- **The length cap.** The official caps nothing. B3 says the webview is
  untrusted, and this is a search box query, so `CONFIG_SEARCH_MAX_LENGTH` is
  200. The cap itself is accepted; one character more is refused.

## The other `command:` users

The step file asks for `forge.showLogs` and `forge.newConversation` to get typed
requests **or be removed if nothing in scope uses them**.

| Command | In-scope user? | What happened |
| --- | --- | --- |
| `forge.newConversation` | none — no webview file referenced it | dropped with the branch |
| `forge.showLogs` | only **"Report a problem"**, which `CLAUDE.md` puts out of scope and step 33 removes | dropped with the branch, and the button removed with it |

**This removed the "Report a problem" button, which is step 33's task.** It was
not optional: the button's only implementation was the `command:` branch this
step deletes, and leaving a button that throws is worse than either state. The
version row keeps the version text alone, which is what step 33 asks for, so
**step 33 is now a no-op to confirm** rather than work to do. The official's own
button opens its feedback dialog (`openFeedbackDialog("command_menu")`), which
is out of scope for Forge.

## Gates

- `pnpm test`: `Test Files 33 passed (33) · Tests 814 passed (814)`
- `pnpm run typecheck:all`: clean
- `pnpm run build`: `brand: clean (355 files)`, `tokens: clean (240 used, 383 defined)`, `commands: clean (20 commands, 13 references)`, `✓ built in 6m 50s`
- `grep -rn "command:" src/webview/src` finds **no** config-type usage (only
  unrelated words: a `command:` object key in a tool's input, a comment, a
  parameter name).

## Oracle

| Window (root selector) | Structural diffs | |
| --- | --- | --- |
| "/" command menu (85 elements) | **0** | `classesNotInOfficialCss: []`, `missingTwin: 0` |
| version row alone (2 elements) | **0** | now `<div class="versionRow"><span class="versionText">v0.1.0</span></div>` |

## Harness runs

- "/" → General config… sent `open_config` and the host searched `forge`; the
  menu closed.
- "/" → View help docs sent `open_help` and the host opened
  `https://code.claude.com/docs/en/vs-code`; the menu closed.
- Posted straight down the transport: `command:workbench.action.quit` and
  `command:forge.showLogs` both answered
  `Failed to open config file: Not a config file: …`; a 201-character search and
  a numeric search were both refused with the host's own messages; a real search
  string went through.
- The "Report a problem" button is gone from the DOM.

## Specs added

`test/openConfigHelp.spec.ts` (12 cases): the two commands `open_config` runs
and in what order; the default, a passed string, and the empty-string fallback;
a non-string and an over-long search refused **before** anything runs; a search
that looks like a command id landing in the search box rather than being run;
`open_help` opening the URL and running no command, and ignoring any payload;
`open_config_file` rejecting four `command:` values while still serving
`vscode`; and two source-level checks — no webview file passes a `command:`
config type, and `ButtonArea` uses the typed requests and no longer holds the
docs URL.

`test/mocks/vscode.ts` gained `env.openExternal`, which the mock had never had.

## VS Code checklist for the user (unverified until the user runs it)

1. "/" → **General config…**. **Expected:** the menu closes and VS Code's
   Settings open, filtered to `forge`.
2. "/" → **View help docs**. **Expected:** the browser opens
   `https://code.claude.com/docs/en/vs-code`.
3. Open the "/" menu and look at the bottom row. **Expected:** the version
   (`v0.1.0`) and nothing else — no "Report a problem".
4. Check that the logs are still reachable: command palette → **Forge: Show
   Logs**. **Expected:** the Forge output channel opens. The command still
   exists; only the webview's way of triggering it is gone.
