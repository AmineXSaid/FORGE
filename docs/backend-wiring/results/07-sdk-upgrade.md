# Results, step 07: Agent SDK 0.1.77 → 0.3.274

The full write-up (versions, the 14 breaking changes and how each was handled, consumer re-verification, and the API
table with `.d.ts` lines) is in [`docs/sdk-upgrade.md`](../../sdk-upgrade.md). This file holds the evidence.

## What changed
| File | Change |
| --- | --- |
| `package.json` | `@anthropic-ai/claude-agent-sdk ^0.3.274`, `@anthropic-ai/sdk ^0.126.0`, `@modelcontextprotocol/sdk ^1.30.0`, `zod ^4.6.5`; `forge.cliArgs` description matches the new gate |
| `pnpm-lock.yaml`, `pnpm-workspace.yaml` | resolved 0.3.274 (plus `…-win32-x64@0.3.274`); pnpm's `minimumReleaseAgeExclude` for the nine 0.3.274 packages (see the supply-chain note in `docs/sdk-upgrade.md`) |
| `src/services/claude/cliLaunch.ts` (new) | official `xh0` / `o1$` / `jh0` binary resolution, no cli.js fallback; the SDK's `AG` package order; the official `l3` env defaults |
| `src/services/claude/ClaudeSdkService.ts` | uses `resolveClaudeExecutable`; applies `OFFICIAL_CLI_ENV_DEFAULTS`; builds `extraArgs` after the Options, so the gate sees what the SDK emits; `checkCliHealth` returns `{ok:false, error}` when no binary is bundled (the `forge.runDoctor` command awaits it, and the doctor must never throw) |
| `src/services/claude/cliArgs.ts` | PROTOCOL + `permission-prompt-tool`; `SDK_DERIVED_FLAGS` (all 40 flags from the 0.3.274 builder, each keyed to its `Options` field); `SDK_INITIALIZE_FLAGS` (`system-prompt`, `append-system-prompt`); a flag is always applied, and warned only when really duplicated |
| `src/services/configurationService.ts` | `defaultPermissionMode: PermissionMode` (the SDK dropped `'delegate'`) |
| `esbuild.ts` | `copyNativeBinaryPlugin` copies the SDK's platform binary to `resources/native-binary/` (replaces the dead `copyClaudeCliPlugin`) |
| `.gitignore` | `/resources/native-binary/` |

**Scope notes (revertable):**
- The cli.js fallback was removed, and the binary copy step and the two official env defaults were added. These go
  beyond "update package.json", but without them the upgrade breaks launch: CLI 2.0.76 rejects `--thinking`, which
  0.3.x emits for `maxThinkingTokens: 0`.
- The gate was widened from "flags Forge passes" to every flag the SDK can derive, as the user asked on 2026-09-17
  ("maximize what Forge is capable of").

**Branch check (user request, 2026-09-17):** there was nothing to merge.
- The newest chat-rendering UI is `claude/ui-parity-code-chat-91c368` @ `9f22c9c`, already in this branch via the
  user's `fe6833f`.
- `git branch -a --no-merged HEAD` is empty; `origin/*` was refetched through schannel and is from April.
- No other worktree has uncommitted changes, and the stash is empty.

## Host-side checks (no harness equivalent)
| Check | Result | Verdict |
| --- | --- | --- |
| New CLI binary | `node_modules/…/claude-agent-sdk-win32-x64/claude.exe --version` → `2.1.274 (Claude Code)` | works |
| Old fallback incompatible | `resources/claude-code/cli.js` is `Version: 2.0.76`: 0 occurrences of `"--thinking`, `_allowUnknownOption=!1` | confirmed (the reason for removal) |
| Forge's own `--debug-to-stderr` still parsed by 2.1.274 | binary contains `toStderr=i.includes("--debug-to-stderr")` | works |
| `CLAUDE_CODE_ENABLE_TASKS=0` read by the CLI | binary: `if(a.CLAUDE_CODE_ENABLE_TASKS===!1)return!1` | works |
| Build copies the binary | delete `resources/native-binary/claude.exe`, then `pnpm run build:extension` → `[build] Copied …claude-agent-sdk-win32-x64\claude.exe -> resources\native-binary\claude.exe`; `cmp` identical; copy `--version` → `2.1.274`; second run: no copy (same size) | works |
| Gate vs the installed SDK | `test/cliArgs.spec.ts` re-reads `sdk.mjs`: 0 unlisted flags, 0 stale entries | works |
| Type-level stream checks | `tsc` on `test/sdkMessageStream.spec.ts`: exit 0. Negative control (drop `'informational'`, assert `'plan'` isn't a mode): `TS2322` on exactly those lines | works |

## Harness rows
Harness `--port 8735`, started after the build. Checks:
- `Array.isArray(window.__forgeSent)` is true;
- stylesheets `[1, 5, 9691]`;
- served `/main.js` SHA-256 `782dafd9…` equals `dist/media/main.js` built 14:10. There is no new webview string to
  look for, because step 07 changed no webview source (`git diff --stat HEAD -- src/webview` is empty).

Viewport 460×900. The turn began with a real composer send. The harness mocks the extension host, so this row set
proves the webview's side of the new stream, not the CLI.

| Row | Request / event | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| Chat: composer send | `io_message` user "Show me a code block and a table" | accepted | 1 turn, Stop button (busy) | works |
| 03 T1–T6 with 0.3.x wrapper fields (`ttft_ms`, `user_message_uuid(s)` on `message_start`; `request_id`, ISO `timestamp` on the final message) | `stream_event` ×8, `assistant` | — | T1 0 rows; T2 `<p>Here is a code block:</p>`; T3 `pre` 0; T4 `pre` 1, table 0, "And a table:"; T5 `pre` 1, table 1, cells Name/Value/a/1/b/2, no dot class; T6 1 assistant row, 2 transcript rows | works |
| New frame types mid-turn: 28 `system` subtypes + `tool_progress`, `auth_status`, `tool_use_summary`, `rate_limit_event`, `prompt_suggestion`, `conversation_reset` | 34 `io_message` | — | transcript rows 2 → 2; still busy; none of the frames' text appears | works |
| 03 T7 thinking | `thinking_delta`, `signature_delta`, stop, final | — | "Thinking..." → "Thinking" → "Thinking", 2 rows | works |
| 03 T8 tool_use, JSON split mid-string | `input_json_delta` ×2, stop, final, `tool_result` (with `tool_use_result`, `timestamp`) | — | hidden (2 rows) → "Read forge-tokens.css" `dotProgress` (3) → `dotProgress` (3) → `dotSuccess` (3) | works |
| 03 T9 abandoned stream, final with `aborted: true` | `message_start` msg_B, then msg_C | — | "STUCK attempt" shown, then removed; "Retry text" once | works |
| 03 T10 subagent (`parent_tool_use_id`, `subagent_type`) | `stream_event` ×5, final | — | 1 row while streaming and after | works |
| `error: "model_not_found"` assistant with empty content | `assistant` | — | +0 rows | works |
| 03 T11 pinned, 40 paragraphs | `text_delta` ×40 | — | gap 0, 0, 1, 1, 0, 0, 0 | works |
| 03 T12 scrolled up after the row exists, 20 paragraphs | `text_delta` ×20, final | — | `scrollTop` 200 ×6; 0 `scrollIntoView` calls after the scroll | works |
| 04 D1–D6 busy | `assistant` / `tool_result` | — | none/none, `dotProgress`/blink, `dotFailure`, `dotSuccess`, `dotProgress`→`dotSuccess`, `dotProgress`/blink | works |
| 04 D7 turn end | `result` (with `stop_reason`, `modelUsage`, `permission_denials`) | — | Stop gone; none, `dotFailure`, `dotFailure`, `dotSuccess`, `dotSuccess`, `dotFailure`; all animations `none` | works |
| 04 D8 / D9 after turn end | — | — | streamed text row none; streamed Read row `dotSuccess` | works |
| "/" window, no filter | none | — | Context, Model, Customize, Settings, Support; 14 rows | works |
| "/" window, filter `/` | none | — | `/compact`, `/init`, `/review`, `/security-review`, `/team-tools:review` | works |
| "/" click `/init` | `io_message` `[{type:"text",text:"/init"}]` | accepted | menu closes, busy | works |
| Model window | none | — | Default (recommended), Sonnet, Fable, Opus, Haiku | works |
| Model window: click Opus | `set_model {model:{value:"opus"}}` | mock ack **without `success`** | menu closes; pill reverts to "Sonnet 5 · Medium" | partial: same mock-host gap as `set_permission_mode` (results/01-frontend issue 18); `Session.setModel` reverts unless `success` |
| Mode window | none | — | header "Modes ⇧ + tab to switch"; Manual, Edit automatically, Plan, Bypass permissions | works |
| Mode window: click Plan | `set_permission_mode {mode:"plan"}` | ack | menu closes | works (label revert is the known mock gap) |
| Permission window (`__forgeSeedPermission`) | `tool_permission_request` Bash | — | "Do you want to proceed with Bash?", 1 Yes, 2 No, reject field, "Esc to cancel" | works |
| Permission: 1 Yes | `response` `tool_permission_response {behavior:"allow", updatedInput:{command:"pnpm run build",…}}` | — | prompt closes | works |
| Permission: 2 No | `response` `{behavior:"deny", message:"The user doesn't want to proceed…"}` | — | prompt closes | works |

**Counts:** works 22 · partial 1 (model click: mock ack, not the SDK) · broken 0 · rows left out 0 (23 rows).

## Oracle
| Window (root) | Checked | Structural | Note |
| --- | --- | --- | --- |
| "/" `.fg-commandmenu__menuPopup`, no filter | 82 | **0** | |
| "/" filter `/` | 100 | **0** | |
| Model `.fg-commandmenu__menuPopup` | 51 | **0** (settled) | the first run, 400ms after opening, caught the popup's `fadeIn` (`opacity` row); re-run after 1.2s: 51/51 clean |
| Mode `.fg-menu__menuPopup` | 45 | 3 | **already existed:** `kbd` font / size / line-height, `.fg-menu__menuItemIcon span` `display` flex vs block, `> svg` `min-width`/`min-height`. Cause: scoped `.fg-menu__menuHeaderHint kbd[data-v-599c9753]` and `.fg-modeTint[data-v-599c9753] { display: inline-flex }` in `ModeSelect.vue`, added in `b6f21be` (2026-09-16). **Proof:** deleting those two rules live → 45/45 clean, 0 structural |
| Permission `.fg-permission__permissionRequestContainer` | 25 | **0** (settled) | first run: `pre.fg-permission__inputJson` width 0 vs 392.8 while the prompt mounted; re-run twice: 0 |
| Transcript: text row / streamed row / Read ok / Read error / Bash | 3 / 23 / 8 / 8 / 17 | 0 / 1 / 0 / 0 / 9 | identical to results/01-frontend (brand `pre` font; Bash terminal rows from the merge) |

## Gates
- `pnpm test`: `Test Files 9 passed (9)`, `Tests 111 passed (111)` (31 new: cliArgs 11 → 20, cliLaunch 15, sdkMessageStream 7).
- `pnpm run typecheck:all`: `tsc --noEmit` and `vue-tsc -p src/webview/tsconfig.json --noEmit`, exit 0.
- `pnpm run build`: exit 0.
  ```
  Forge brand guardrail: clean (283 files scanned)
  Forge token check: clean (222 tokens used, 374 defined)
  Forge command check: clean (20 commands, 13 references)
  ✓ built in 4m 40s
  [watch] build finished
  ```
  This is the final build, after the `checkCliHealth` fix. Its `dist/media/main.js` (`782dafd9…`) and `style.css`
  (`2cff21ab…`) are byte-identical to the bundle measured in the harness above.

## Specs added
- `test/cliLaunch.spec.ts` (15):
  - `xh0` order: exact dir, `native-binary` fallback, `.exe` only on win32, `-musl` dir and not the glibc one,
    win32-arm64 → x64 only on win32;
  - **rejections:** cli.js is never picked; no binary throws `unsupported_platform` with the official message;
  - SDK `AG` specifiers (win32, darwin, linux glibc/musl order, android);
  - `jh0` false off Linux;
  - env defaults exact and frozen;
  - `checkCliHealth` through the real service registration with no binary → `ok: false` and the official message, no throw.
- `test/cliArgs.spec.ts` (20, 9 new):
  - SDK-derived flag accepted with its option named when Forge doesn't set it; warned only when it does;
  - `--thinking` / `--max-thinking-tokens` from `maxThinkingTokens` (including 0);
  - builder shapes (`allowedTools: []`, `skills`, `tools: []`, empty `mcpServers`, `persistSession`,
    `pluginDelivery`, `settingSources: []`, `thinking.display`, `verbose`);
  - `append-system-prompt` overlap; replacing Forge's `--settings`;
  - **rejection:** `permission-prompt-tool` (valued and valueless);
  - builder cross-check against the installed `sdk.mjs`.
- `test/sdkMessageStream.spec.ts` (7):
  - type-level exhaustive union, required `session_id`, `'delegate'` gone and `'auto'` present;
  - every non-row frame → `fromRaw` null and no row (streaming and not);
  - replay user frame still a row;
  - final message with the 0.3.x fields and `aborted` replaces the streamed row;
  - `error` frame with no content → no row;
  - ISO `timestamp` kept.

## Issues found, not fixed
1. **Mock host:** `set_model` and `set_permission_mode` get the generic ack without `success`, so the harness reverts
   both labels. The real dispatcher returns `success: true`.
2. **`ModeSelect.vue` scoped overrides** of ported official rules (`b6f21be`) cause the mode menu's 3 structural rows.
   `CLAUDE.md` rule 4 forbids these; that needs a ui-parity fix.
3. `resources/claude-code/` (CLI 2.0.76 plus a vendor ripgrep tree) is still tracked and packaged, but nothing uses
   it any more. Delete it, or add it to `.vscodeignore`.
4. The VSIX is now **platform-specific**: it carries the binary of the platform that built it, as the official
   per-platform VSIX does. Cross-platform packaging would need the other `@anthropic-ai/claude-agent-sdk-<platform>` packages.
5. Not handled (new SDK features, no regression): `supersedes` on assistant messages, `conversation_reset`,
   `prompt_suggestion`, `rate_limit_event`. They are listed in `docs/sdk-upgrade.md` with no step assigned.
6. `CLAUDE_CODE_ENTRYPOINT` is set on `process.env` *after* the first session's env is built, so the first spawn
   reports `sdk-ts`. This already happened with 0.1.77 (its `env` also replaced `process.env`).
7. `maxThinkingTokens` / `setMaxThinkingTokens` are deprecated but still work; step 14 moves to `thinking`.

## VS Code checklist for the user (unverified)
1. `pnpm install`, then `pnpm run build`. **Expected:** `resources/native-binary/claude.exe` exists (233,691,808 bytes), and
   running it with `--version` prints `2.1.274 (Claude Code)`.
2. Start the extension (F5 or the packaged build) and open the Forge output channel. **Expected:**
   `CLI Path: …\resources\native-binary\claude.exe`; `claude doctor` reports version 2.1.274; no
   `Claude CLI not found` or `Unsupported platform` error.
3. Send "Read package.json and summarise it". **Expected:** text streams, the Read tool row appears once its input is
   complete, a permission prompt appears if your mode asks, choosing **1 Yes** runs the tool, the result renders, and
   the turn ends (Stop button gone). No `unknown option` or `Claude Code process exited with code` lines in the log.
4. Turn Thinking **off** in the "/" menu, then send a message. **Expected:** the session starts and answers. This is
   the case the old cli.js fallback would have crashed on (`--thinking disabled`).
5. Ask Claude to make a short todo list for a 3-step task. **Expected:** a `TodoWrite` row, not `TaskCreate`
   (`CLAUDE_CODE_ENABLE_TASKS=0`). On Sonnet 5 / Opus 5 the model may not use a todo tool at all (0.3.233); that is
   CLI behaviour, not a Forge error.
6. Resume an older conversation from the history dropdown. **Expected:** its messages load, and a new message
   continues the same session.
7. Set `"forge.cliArgs": { "model": "opus", "effort": "high", "print": true }` and start a session. **Expected:**
   - the log shows `! --model opus -- the SDK also emits it from model on this launch…`;
   - `+ --effort high (passthrough (SDK option effort is not set))`;
   - `x --print REJECTED`;
   - the session still starts.
