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
| `scenarios.mjs` | The scenarios (ids 1–21) and their helpers |
| `workbench.mjs` | Driving the workbench: palette, notifications, the Forge webview frame, real input inside it |
| `cdp.mjs` | A CDP client that auto-attaches to every target and evaluates in any frame |
| `stub-gateway.mjs` | An OpenAI-compatible gateway that scripts the model (tool calls, plans, delays, outages) |

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

- Without `--vsix` it runs `pnpm run package` first (win32-x64) and installs
  `forge-win32-x64.vsix`.
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

## Run it on Linux (a stand-in)

code-server is VS Code 1.105 (workbench, extension host, webviews) served to a
browser; the kit drives it in headless Chromium. It proves behaviour on Linux,
not on Windows.

```bash
npm i --prefix ~/cs code-server@4.105.1   # Node 22
pnpm run build:webview && npx tsx esbuild.ts --production --target linux-x64
npx vsce package --no-dependencies --target linux-x64 -o forge-linux-x64.vsix
node .claude/skills/ui-parity/e2e/launch.mjs \
  --code-server ~/cs/node_modules/.bin/code-server --vsix forge-linux-x64.vsix --stub
```

Options: `--root <dir>` (default: a fresh temp folder), `--only 1,2,15`,
`--keep` (leave the host running), `--attach` (re-run against a kept host:
same `--root`, add `--stub` if it used one), `--scenario-timeout <s>`,
`--capabilities <json>` (the profile's capabilities; `--stub` defaults to
effort low..xhigh with `reasoning_content`).

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
| 9 | Rename, archive, unread survive a reload | `custom-title` in the `.jsonl`, the list after reload |
| 10 | A mid-turn message, then Stop | the interrupt in the `.jsonl` |
| 11 | Output styles, `forge:Expert` included | `outputStyle` in the local layer, the system prompt at the gateway |
| 12 | Settings page layers | user / workspace / local files |
| 14 | Reload keeps model, effort, thinking, history | before/after |
| 16 | Open in Terminal; the "+" menu's "Browse the web" | the CLI process and its `ANTHROPIC_BASE_URL`; "+" rows (the attach needs Claude in Chrome: partial) |
| 17 | Gateway down then back; CLI binary missing | the chat's error text; the banner |
| 18 | Soak: 20 turns | latencies, no `[error]` in the Forge log |
| 19 | Soak: 6 tabs opened, used and closed | CLI process count |
| 20 | Bypass permissions: the confirmation, the machine setting, deep red, no prompts | `forge.allowDangerouslySkipPermissions` (desktop `User/settings.json`, code-server `Machine/settings.json`), computed colours, the file touched; the setting is removed afterwards |
| 21 | Expert: on after a plain turn, survives a relaunch, off | `# Output Style: forge:Expert` at the gateway, no settings file changed, the CLI killed and relaunched, the CLI's reset notice |
| 13 | Keybindings (runs last) | focus, the @-mention, the mode, the new tab |

## Known harness limits

- **code-server + headless Chromium:** after Ctrl+Esc is pressed *inside any
  webview* (VS Code's own Markdown preview included), the next page reload
  hangs the renderer. Not Forge: the keybindings scenario runs last so no
  reload follows it. Desktop VS Code is not known to do this.
- **A root host (a Linux container):** Claude Code refuses bypass
  permissions as root ("cannot be used with root/sudo privileges") and exits.
  Scenario 20 then proves the chat shows that reason and reports *partial*:
  the unprompted run is only observable as a normal user (Windows has no such
  check).
- Real Windows VS Code and the user's gateway are not reachable from the
  cloud container this kit was built in; results from there are marked
  unverified until the kit is run on Windows.
