# Forge end to end

The harness (`../harness/`) proves the webview against a stub host. This kit
proves the **whole extension**: the VSIX installed into a real VS Code, the
real Claude Code CLI it bundles, a real endpoint, driven over the Chrome
DevTools Protocol. Every scenario reads its evidence back from disk (settings
files, session `.jsonl`, files the model wrote), from the gateway's request
log or from the webview's DOM, never from the UI alone.

| File | What it is |
| --- | --- |
| `launch.mjs` | Package, install isolated, start the host, run the scenarios, write the report, close |
| `scenarios.mjs` | The scenarios (ids 1–29) and their helpers |
| `workbench.mjs` | Driving the workbench: palette, notifications, the Forge webview frame, real input inside it |
| `cdp.mjs` | A CDP client that auto-attaches to every target and evaluates in any frame |
| `stub-gateway.mjs` | An OpenAI-compatible gateway that scripts the model (tool calls, several files edited in one turn, plans, delays, outages) |

## Run it on Windows (the target)

Prerequisites: VS Code installed, Node 22+, Chrome not needed (VS Code is the
browser). The user's gateway (`omniroute`) is running. If it needs a key, put
it in an environment variable first; the kit passes the variable's **name**,
never its value.

```powershell
# optional: the gateway key, in this shell only
$env:OMNIROUTE_KEY = "…"

node .claude/skills/ui-parity/e2e/launch.mjs `
  --code "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" `
  --gateway http://localhost:20128/v1 --model auto/best-fast `
  --auth-env OMNIROUTE_KEY
```

- Without `--vsix` it runs `pnpm run package` first and installs `forge.vsix`,
  the one package for Windows x64 and Linux x64.
- The window is titled `forge-e2e-<run id>` (`window.title`), and on Windows
  it is closed by that exact title (`taskkill /FI "WINDOWTITLE eq …"`), so no
  other VS Code window is touched.
- Isolation: its own `--user-data-dir`, `--extensions-dir`, and a home of its
  own (`HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`), so `~/.claude` is a
  fresh folder the scenarios inspect. The environment is rebuilt from system
  variables only: no credential from the shell reaches the CLI except the one
  named by `--auth-env`.
- With a real gateway the scenarios that script the model (`needs: ['stub']`)
  are **skipped**; add `--stub` to run everything against the stub instead.

## Run it on Linux

The same `forge.vsix` installs on Linux x64. code-server is VS Code 1.105
(workbench, extension host, webviews) served to a browser; the kit drives it
in headless Chromium (desktop `code` works too, with `--code`).

```bash
npm i --prefix ~/cs code-server@4.105.1   # Node 22
pnpm run package                          # forge.vsix: fetches the other platform's binary
node .claude/skills/ui-parity/e2e/launch.mjs \
  --code-server ~/cs/node_modules/.bin/code-server --vsix forge.vsix --stub
```

Options: `--root <dir>` (default: a fresh temp folder), `--only 1,2,15`,
`--keep` (leave the host running), `--attach` (re-run against a kept host:
same `--root`, add `--stub` if it used one), `--scenario-timeout <s>`,
`--capabilities <json>` (the profile's capabilities; `--stub` defaults to
effort low..xhigh with `reasoning_content`), `--theme <name>` (the colour
theme from launch, e.g. `"Default Dark Modern"`, so scenario 30 switches
dark to light).

The report is `<root>/report/report.md` (plus `results.json`, `run.log` and a
screenshot per failure).

## The scenarios

| # | What it proves | Evidence |
| --- | --- | --- |
| 15 | Restricted Mode: no Forge until trusted, then Forge | status bar, palette, webview frames |
| 1 | Install and activate never write `~/.claude/settings.json` | the file's absence |
| 2 | A first message streams from the endpoint | gateway log (model id, `stream`), session `.jsonl` |
| 3 | History and resume | the list, the transcript, the follow-up in the same `.jsonl` |
| 4 | The slash list is the CLI's; `/compact` runs | rows, `compact_boundary` in the `.jsonl` |
| 5 | Editor selection reaches the model | `<ide_selection>` in the `.jsonl` and the gateway |
| 6 | Permission option 2 saves its rule; Plan mode | `.claude/settings.local.json`, the file touched, the mode |
| 7 | Effort and thinking | `effortLevel` in `~/.claude/settings.json`, `reasoning_effort` at the gateway |
| 8 | Rewind and fork | the file gone from disk; a new `.jsonl` |
| 9 | Rename, archive (the dropdown), unread (the session manager) survive a reload | `custom-title` in the `.jsonl`, the list and the dot after reload |
| 10 | A mid-turn message, then Stop | the interrupt in the `.jsonl` |
| 11 | Output styles, `forge:Expert` included | `outputStyle` in the local layer, the system prompt at the gateway |
| 12 | Settings page layers | user / workspace / local files |
| 14 | Reload keeps model, effort, thinking, history | before/after |
| 16 | Open in Terminal; the "+" menu's "Browse the web"; a failed `@browser:new_tab` attach | the CLI process and its `ANTHROPIC_BASE_URL`; the terminal filmed in xterm (`report/terminal/`): Claude Code's first-run screens stepped through, no "custom API key" question, no unknown-model notice, the Forge status line; a second launch shows the Forge banner, one short launch line and the welcome line; "+" rows; the chat's banner with the CLI's reason and the text back in the composer (a successful attach needs Claude in Chrome: partial) |
| 17 | Gateway down then back; CLI binary missing | the chat's error text; the banner |
| 18 | Soak: 20 turns | latencies, no `[error]` in the Forge log |
| 27 | Forge opens like Claude Code: the history on the left, the chat as an editor tab in its own column | the Forge group's width against the editor area (40–60%), the lock, the side bar still open, the chat's rendered size, and a conversation from the history opening in the same tab (one Forge tab). The kit pins `forge.preferredLocation: secondary` for the other scenarios; 27 sets `panel` in the workspace settings and restores them |
| 19 | Soak: 6 tabs opened, used and closed | CLI process count |
| 20 | Bypass permissions: the confirmation, the machine setting, deep red, no prompts. As root (a Linux container), the row is left out and the scenario reports partial | `forge.allowDangerouslySkipPermissions` (desktop `User/settings.json`, code-server `Machine/settings.json`), computed colours, the file touched; the setting is removed afterwards. As root: the mode menu's rows |
| 21 | Expert: on after a plain turn, survives a relaunch, off | `# Output Style: forge:Expert` at the gateway, no settings file changed, the CLI killed and relaunched, the CLI's reset notice |
| 22 | Session manager: a group, "Start new session in this group", the collapsed section, all after a reload | the group's count before and after, the collapsed body after reload |
| 23 | One VSIX, Linux side (Linux only): the installed `claude` and `rg` stripped of their execute bit, as a Windows-packaged VSIX installs them | a turn answered and `@` search working after a reload; both files 755 again |
| 24 | Model picker: only what answers, the ping, the refresh, a dead endpoint in use | a second profile whose model the stub does not serve, added to `User/settings.json` (`forge.endpoints` is an application setting); the stub's log shows one 4-token probe per endpoint (the dead one 404); the picker keeps only the answering one, with its ping; with the dead one in use, the pill names it and its row is greyed with the reason. The periodic 5-minute check is off in this kit (`syncIntervalMinutes: 0`), so it is proven by `test/modelPickerHealth.spec.ts`, not here |
| 25 | Following edits: an edit far down a file, a new file written, and the chat in a tab | the file changed on disk; its tab active; the changed line (65 of 80) in view with line 1 off screen; a `ced-*` highlight that fades (4 s highlight, then 3 s gutter bar); no editor focus; with the chat in a tab, a second editor group and the chat still on screen |
| 26 | Edit automatically: deleting always asks; `forge.autoApproveSafeCommands` on: a reading chain (`cd … && git log … && echo … && grep … \| head`), `python3 -c` and an edit (`>>`) run unasked, `rm` and a chain ending in `git push` ask; Manual still asks | the prompt (or none) per command; `[AutoApprove]` and `[EditMode]` lines in `Forge.log`; the file changed or still there on disk. The setting is written to this test host's machine settings only and removed afterwards |
| 28 | Create Agent asks which kind; both kinds are written, listed, and the Hermes one runs the conversation in its scope | the palette (Create Agent, no Create Subagent); the kind picker's two rows; `.claude/agents/<name>.md` and `.forge/agents/<name>.md` with their `tools` lines; `forge.activeAgent` in `.vscode/settings.json` after "Use it now"; Settings › Agents rows with their kind and "In use"; at the gateway, `## Agent: <name>` in the system prompt and the offered tools (Read, Grep, Glob, no Bash, Edit or Write). The workspace settings are restored |
| 29 | Following edits, filmed: a far edit, an edit whose new text also sits higher up, a deletion, three files in one turn, the user typing in another file meanwhile, a new file | per case, frames and a probe every ~200 ms in `report/follow/` (`<case>-NN.png`, `<case>.json`: active tab, preview or not, lines in view, marked lines, keyboard focus). Asserts: the edited line (80, not 5) marked and in view; the deletion point (85) marked; all three files still open as tabs; all typed keystrokes in the user's file, focus in their editor every frame, the agent's file in another group; the new file marked. Run again with `--theme "Default Dark Modern"` for the dark frames |
| 30 | Colour theme switched mid-session, twice, through "Preferences: Color Theme" | after each switch: the chat restyled (`vscode-dark`/`vscode-light` on its body, its background's luminance), no setup page, a new conversation answered by the stub, and in `Forge.log` no `relay stopped` without a `Relay listening`. It failed before `forge.endpoints` became an application setting: code-server dropped the machine-scoped value from User settings after the theme write |
| 31 | Showcase, for sharing: a failing unittest in a tiny `slugify` module found, fixed and re-run, from the natural prompt in `demos/fix-failing-test.json`. Every tool call (Read, Bash, Edit) runs for real in the CLI; the stub scripts only the wording. Run it with and without `--theme "Default Dark Modern"` | `report/showcase/`: the first permission prompt, the edit highlighted beside the chat, the finished conversation, each at 2x; `slugify.py` fixed on disk; the real failing and passing test runs in the transcript |
| 13 | Keybindings (runs last) | focus, the @-mention, the mode, the new tab; it first closes editor groups and the secondary side bar and drags the side bar to a normal width, which earlier scenarios change |

## Known harness limits

- **code-server + headless Chromium:** after Ctrl+Esc is pressed *inside any
  webview* (VS Code's own Markdown preview included), the next page reload
  hangs the renderer. Not Forge: the keybindings scenario runs last so no
  reload follows it. Desktop VS Code is not known to do this.
- **A root host (a Linux container):** Claude Code refuses bypass
  permissions as root ("cannot be used with root/sudo privileges") and exits,
  so Forge leaves the Bypass row out there (`bypassGate.ts`). Scenario 20
  then proves the row is absent and reports *partial*: the unprompted run is
  only observable as a normal user (Windows has no such check).
- **The footer in a narrow side bar:** with a long file name in the
  selection chip, the ported footer squeezes the mode button until its icon
  overlaps the left half of the send/Stop button. Scenarios that click Stop
  close editors first (scenario 10).
- Real Windows VS Code and the user's gateway are not reachable from the
  cloud container this kit was built in; results from there are marked
  unverified until the kit is run on Windows.
