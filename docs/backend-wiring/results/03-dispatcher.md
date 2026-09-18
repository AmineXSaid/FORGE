# Group 3 report: the dispatcher (steps 09–10)

Scope for this group was one request: re-enable `open_claude_in_terminal`, which
the "/" menu was already calling into a commented-out dispatcher case. `CLAUDE.md`
B2 calls that a bug, not a placeholder, so the fix is all six places plus the
validation the official host does before it launches anything.

Base: `claude/code-chat-ui-parity-2348d5` at `3510c0a` (the new UI, steps 01–08).
Commits: `f2e5059` (step 09).

## Results

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| "/" → Open Forge in Terminal | `{type:"open_claude_in_terminal", location:"bottom"}` | `open_claude_in_terminal_response`; host builds the command line from Forge's bundled binary and creates the terminal | exactly one request; menu closes | works |
| (payload) empty | `{type:"open_claude_in_terminal"}` | `open_claude_in_terminal_response` | — | works |
| (payload) bare slash command | `{prompt:"/fast"}` | `open_claude_in_terminal_response` | — | works |
| (payload) resume | `{args:["--resume","3f2504e0-…-0305e82c3301"]}` | `open_claude_in_terminal_response` | — | works |
| (payload) kickback shape | `{prompt:"/login", args:[], location:"window"}` | `open_claude_in_terminal_response` | — | works |
| (reject) injection | `{prompt:"/x; rm"}` | `error`: the official message | — | works |
| (reject) not a slash command | `{prompt:"hello"}` | `error` | — | works |
| (reject) unknown flag | `{args:["--dangerously-skip-permissions"]}` | `error` | — | works |
| (reject) path traversal | `{args:["--resume","../x"]}` | `error` | — | works |
| (reject) extra args | `{args:["--resume",<id>,"--print"]}` | `error` | — | works |
| (reject) args not an array | `{args:"--resume"}` | `error` | — | works |

Every rejection returns the official string verbatim:
`open_claude_in_terminal: only a bare slash command and --resume <session id> can be passed from the webview`

**Counts:** works 11 · partial 0 · broken 0 · left out 3 (the out-of-scope auth cases below)

### Neighbouring "/" rows, re-clicked for regressions

| Row | Request | Menu | Verdict |
| --- | --- | --- | --- |
| Permissions | `{type:"open_config_file", configType:"command:forge.openSettings"}` | closes | no regression |
| Thinking | `set_thinking_level` | **stays open** (`keepMenuOpen`) | no regression |

The "/" menu still registers 14 rows, in the same order as before the change.

## Step 10 audit: what is still commented out

`grep -nE '^\s*//\s*case "' src/services/claude/ClaudeAgentService.ts`

```
797:            // case "get_auth_status":
800:            // case "login":
803:            // case "submit_oauth_code":
```

Exactly the three out-of-scope authentication cases, and nothing else. 38 live
`case` arms. `open_claude_in_terminal` is no longer among the commented ones.

## Gates

- `pnpm test`: `Test Files 12 passed (12) · Tests 188 passed (188)`
- `pnpm run typecheck:all`: `tsc --noEmit` and `vue-tsc -p src/webview/tsconfig.json --noEmit`, both silent
- `pnpm run build`:
  ```
  Forge brand guardrail: clean (297 files scanned)
  Forge token check: clean (235 tokens used, 382 defined)
  Forge command check: clean (20 commands, 13 references)
  ✓ built in 5m 41s
  ```

## Oracle

Measured on the built webview in the harness, started with
`--ref C:/Users/med-a/Music/Real_Claude_Code_VSCODE_extension_files/webview/index.css`
(`cssRules` = 9720, `__forgeSent` present, the new strings in `/main.js`).

| Window (root selector) | Structural diffs | Colour diffs (expected, brand) |
| --- | --- | --- |
| `.fg-composer__inputWrapper` | **0** — 29/29 clean | link and blockquote only, by design |
| `.fg-menu__menuPopup` (Modes menu open) | **0** — 41/41 clean | as above |
| `.fg-shell__header` | **0** — 15/15 clean | as above |
| `.fg-markdown__root` | **1** — 29/30 clean | as above |

All four baselines held. The single markdown diff is the documented harness
artifact: `codeBlockWrapper pre` reports
`forge "Forge Mono", ui-monospace | official monospace`, because the oracle
iframe has no `--vscode-editor-font-family` to resolve. The recorded baseline
reads 57/59 with two such rows; this transcript carried one code block instead of
two, so the same artifact appears once. Same element, same property, same cause —
sample size differs, the profile does not.

A busy composer (mid-turn, queued message) measures 111/111 clean, 0 structural,
which is a superset of the idle baseline rather than a change to it.

## Specs added

- `test/openClaudeInTerminal.spec.ts` — 48 cases:
  - `JI0`: empty payload, the "/" row shape, `/fast`, `[]`, `["--resume", <id>]`,
    the kickback `{prompt:"/login", args:[]}`;
  - rejections: `"/x; rm"`, `/x && curl`, backtick and `$( )` injection, `hello`,
    `""`, `/`, `/Review`, `/9lives`, `/-x`, `/a b`, `//x`, a 64-char command,
    non-string prompts, `--dangerously-skip-permissions`, `--settings`, bare
    `--resume`, extra args, `-r`, `../x`, `../../etc/passwd`, `<id>/../x`, a
    de-hyphenated uuid, non-array `args`;
  - `y0`/`SD0` session ids, and that neither regex is global (a stateful
    `lastIndex` would make the second identical call disagree with the first);
  - `$d0` location, and the `bottom → panel` / `window → one` / `beside` mapping;
  - `az` quoting, including that every accepted argument passes through unchanged;
  - `za$` command-line assembly; `Ja$` per-shell quoting; `Qa$` Windows shell
    detection (profile source, path, path list, `{path}` object, `${env:…}`, 8.3
    names, built-in names, `vscode.env.shell`, unusable paths); `tn$` profile
    reading including prototype-chain safety; `Ya$` dispose-on-clean-exit.

## What changed, and the one deliberate divergence

The previous handler ran `terminal.sendText("claude")` — a bare name resolved off
`PATH`. Forge ships its own native binary and the SDK's flags follow its own CLI
release, so that could launch a different Claude than the session uses, or
nothing at all. The terminal now launches
`ClaudeSdkService.resolveClaudeExecutablePath()`, the same binary a session runs.

That forces one divergence from the official. The official's `Ja$` falls back to
the bare name `claude` for every shell except PowerShell, because it *is* on
`PATH`; Forge has no such fallback, so it always quotes the absolute path for the
detected shell — `& '<path>'` for PowerShell (a quoted path without the call
operator is printed, not run), `"<path>"` for Command Prompt and for a shell that
could not be identified, POSIX quoting for bash and for every non-Windows shell.
Where the official falls back to `claude` for a cmd path containing `%` or `!`,
Forge refuses the launch instead, because `%` is expanded inside double quotes and
has no escape on an interactive command line.

Everything else is ported literally: the terminal name
(`CLAUDE_CODE_TERMINAL_TITLE` first), the extension icon, `isTransient`,
`NoDefaultCurrentDirectoryInExePath`, no explicit `cwd` (so
`terminal.integrated.cwd` still applies), the location mapping, shell integration
with a 3-second `sendText` fallback, and the dispose-on-clean-exit rule.

## Pre-existing issues found, not fixed (out of this step's scope)

1. `handlers.ts` `handleGetAssetUris` computes `const extensionPath = process.cwd()`
   under a `// TODO: 获取 extensionPath`. `process.cwd()` is not the extension
   root in VS Code, so those asset URIs are likely wrong. `IClaudeSdkService`
   now exposes `asAbsolutePath`, which would fix it in one line — but it is not
   part of step 09.
2. The harness mock host answers unknown requests with a bare
   `<type>_response` ack and no `success` field, so any label waiting on
   `success` reverts. Not a product defect; noted so the next step does not read
   it as one.

## Rows deliberately left out, and why

| Feature | Official requests / ids | UI kept out | Reason |
| --- | --- | --- | --- |
| Microphone / speech-to-text | `start_speech_to_text`, `stop_speech_to_text`, `resources/audio-capture` | the mic button | out of scope: account and cloud |
| Login / Switch account | `login`, `get_auth_status`, `submit_oauth_code` (stay commented out) | the `login` row | out of scope: account and cloud |
| Account & usage | `get_usage`, `open_account_usage` | the `account-usage` row; the `usage` slash command | out of scope: account and cloud |
| Usage / context meter | `get_context_usage`, `request_usage_update` | the footer `YH0` / `usageButtonV2`; the `context` slash command | out of scope: account and cloud |
| Remote Control | `toggle_remote_control`, `remoteControlAtStartup`, `/remote-control` | the `remote-control-at-startup` and `/remote-control` rows | out of scope: account and cloud |
| Feedback | `submit_feedback`, `/feedback`, `/bug`, "Report a problem" | those rows; the button is removed in step 33, version text stays | out of scope: account and cloud |
| Thumbs rating | `message_rated` (`WU0`) | the thumbs | out of scope |
| Switch models when flagged | `switchModelsOnFlag` (`NM1`) | the `switch-models-on-flag` row | gated by Anthropic experiment flags Forge never receives |
| Side question | `/btw`, `side_question` | the `/btw` row | out of scope |
| Ultracode | `ultracode` flag, the `xhigh`+flag mode | any Ultracode option | out of scope |

Also not built (in the spec, but not in `CLAUDE.md`'s in-scope list): the
worktree pill (`open_folder_in_new_window`) and `generate_session_title`.

The official also registers `terminal-kickback-<id>` rows, which send
`{prompt:"/<command>", args:[], location:"window"}`. Forge's handler accepts that
payload — it is tested — but no row sends it yet, because the kickback registry is
not part of this group.

## VS Code checklist for the user — **unverified**

The harness proves the webview↔host contract. None of the following was observed;
the agent cannot run real VS Code.

1. Open the Forge panel, press "/", choose **Open Forge in Terminal**.
   **Expected:** a terminal appears in the **bottom panel** (not beside the
   editor), named **Forge**, with the Forge logo as its icon, and an interactive
   `claude` session starts in it.
2. In that terminal, look at the command line that ran.
   **Expected:** the **absolute path** to
   `…/resources/native-binary/claude.exe`, not the bare word `claude`.
   On PowerShell it is prefixed with the call operator: `& 'C:\…\claude.exe'`.
3. Set `terminal.integrated.defaultProfile.windows` to **Command Prompt**,
   reload the window, repeat step 1.
   **Expected:** the command line is `"C:\…\claude.exe"` (double quotes, no `&`)
   and claude starts.
4. Set the same setting to **Git Bash**, reload, repeat step 1.
   **Expected:** the command line is `'C:\…\claude.exe'` (single quotes) and
   claude starts.
5. Exit claude cleanly (`/exit`, exit code 0) in a PowerShell or Git Bash
   terminal. **Expected:** the terminal closes itself. On Command Prompt it stays
   open — the command line starts with `"`, which the official's own rule
   excludes from auto-dispose.
6. Set `CLAUDE_CODE_TERMINAL_TITLE=Something` in the environment, restart VS Code,
   repeat step 1. **Expected:** the terminal is named `Something`.
7. Confirm no `cwd` override: with `terminal.integrated.cwd` set to a folder,
   repeat step 1. **Expected:** the terminal opens in that folder, because the
   handler passes no `cwd` of its own (matching the official).
8. Confirm the webview cannot launch anything else: there is no UI for it, but if
   you drive the webview console with
   `{type:"open_claude_in_terminal", args:["--dangerously-skip-permissions"]}`,
   **Expected:** an error response and **no terminal is created**.
