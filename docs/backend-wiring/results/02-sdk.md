# Group 2 report: Agent SDK upgrade (steps 07–08)

Checkpoint (step 08), 2026-09-17, on `36b614e` ("Upgrade the Agent SDK to 0.3.274 (step 07)").

- **Upgrade:** `@anthropic-ai/claude-agent-sdk` **0.1.77 → 0.3.274** (CLI 2.1.274). Resolved versions, the 14
  breaking changes and how each was handled, the consumer re-verification, and the API table with `.d.ts` line
  references are in [`docs/sdk-upgrade.md`](../../sdk-upgrade.md), which is complete. Per-row evidence is in
  [`07-sdk-upgrade.md`](07-sdk-upgrade.md).
- **Did I wait for your streaming check in VS Code? No.** Nothing in this batch is feature work, and step 09
  (`open_claude_in_terminal`) comes next. I couldn't observe real VS Code or the real CLI, so every VS Code item below
  is **unverified**. Please run checklist items 2–4 before step 09 is merged onto `forge/backend-wiring`. If streaming
  or tool rows fail there, the SDK upgrade is the first suspect.

## Results

Harness rows were measured in step 07 on the build whose `dist/media/main.js` (`782dafd9…`) and `style.css`
(`2cff21ab…`) are byte-identical to the final `36b614e` build, since step 07 changed no webview source.
**The harness was not restarted for step 08**, because this checkpoint changes no code.
The harness only proves the webview's side. "Host result" is the mock host, except where a row says otherwise.

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| CLI binary resolution | `resolveClaudeExecutable` (official `xh0`) | `resources/native-binary/claude.exe` → `2.1.274 (Claude Code)`; no binary → `Unsupported platform: …` (spec, and `checkCliHealth` returns `ok:false`) | — | works (host check, not real VS Code) |
| Build copies the binary | `esbuild.ts` `copyNativeBinaryPlugin` | copied when missing (identical per `cmp`); skipped when present | — | works |
| CLI flag gate | `buildExtraArgs(base, forge.cliArgs, options)` | 40 SDK-derived flags classified against the installed `sdk.mjs`; 6 protocol flags rejected | — | works (spec) |
| Chat: composer send | `io_message` user text | accepted | turn added, Stop button | works |
| 03 T1–T6 streamed text, with 0.3.x wrapper fields | `stream_event` (`ttft_ms`, `user_message_uuid(s)`), final `assistant` (`request_id`, ISO `timestamp`) | — | partial paragraph held back; fence and table held until closed; final message replaces the row (1 row) | works |
| 03 T7 thinking | `thinking_delta` | — | "Thinking..." → "Thinking" | works |
| 03 T8 tool_use, split JSON | `input_json_delta` | — | hidden while partial; Read row after stop; result attaches | works |
| 03 T9 abandoned stream (final `aborted: true`) | `message_start` ×2 | — | stuck row removed, retry shown once | works |
| 03 T10 subagent stream | `parent_tool_use_id` | — | 1 row | works |
| 03 T11 pinned | 40 × `text_delta` | — | gap 0–1px | works |
| 03 T12 scrolled up | 20 × `text_delta` | — | `scrollTop` stays 200 | works |
| New 0.3.x frames (28 `system` subtypes + 6 top-level types) | 34 × `io_message` | — | +0 rows, still busy, no stray text | works |
| `error: model_not_found` with empty content | `assistant` | — | +0 rows | works |
| 04 D1–D6 (busy) | `assistant` / `tool_result` | — | none, `dotProgress`/blink, `dotFailure`, `dotSuccess`, `dotProgress`→`dotSuccess`, `dotProgress`/blink | works |
| 04 D7 turn end | `result` | — | Stop gone; none, `dotFailure`, `dotFailure`, `dotSuccess`, `dotSuccess`, `dotFailure` | works |
| 04 D8 / D9 | streamed text / streamed Read | — | none / `dotSuccess` | works |
| "/" window | none | — | Context, Model, Customize, Settings, Support; filter `/` shows 5 slash commands | works |
| "/" click `/init` | `io_message` `/init` | accepted | menu closes | works |
| Model window | none | — | Default, Sonnet, Fable, Opus, Haiku | works |
| Model: click Opus | `set_model {model:{value:"opus"}}` | mock ack without `success` | menu closes; label reverts | partial (mock host) |
| Mode window: click Plan | `set_permission_mode {mode:"plan"}` | ack | menu closes | works (label revert is the same mock gap) |
| Permission window: 1 Yes / 2 No | `tool_permission_response` `allow` (with `updatedInput`) / `deny` | — | prompt closes | works |

**Counts:** works 21 · partial 1 (model label, a mock-host gap) · broken 0 · left out 0.

## Gates (output tails, final `36b614e` tree)
- `pnpm test`: `Test Files 9 passed (9)`, `Tests 111 passed (111)`. Re-run for this checkpoint; the tree equals `36b614e`.
- `pnpm run typecheck:all`: `tsc --noEmit` and `vue-tsc -p src/webview/tsconfig.json --noEmit`, exit 0.
- `pnpm run build`: exit 0.
  ```
  Forge brand guardrail: clean (283 files scanned)
  Forge token check: clean (222 tokens used, 374 defined)
  Forge command check: clean (20 commands, 13 references)
  ✓ built in 4m 40s
  [watch] build finished
  ```

## Oracle
| Window (root selector) | Checked | Structural diffs | Colour diffs (expected, brand) |
| --- | --- | --- | --- |
| "/" `.fg-commandmenu__menuPopup` (no filter / filter `/`) | 82 / 100 | **0 / 0** | brand only |
| Model `.fg-commandmenu__menuPopup` (settled) | 51 | **0** | — |
| Mode `.fg-menu__menuPopup` | 45 | 3, **already existed**: scoped rules in `ModeSelect.vue` from `b6f21be`; with them removed live, 45/45 clean | — |
| Permission `.fg-permission__permissionRequestContainer` (settled) | 25 | **0** | — |
| Transcript rows: text / streamed / Read ok / Read error / Bash | 3 / 23 / 8 / 8 / 17 | 0 / 1 / 0 / 0 / 9. Same as group 1: brand `pre` font; Bash rows from the merged Pajamas terminal | — |

## Specs added (group 2)
- `test/cliLaunch.spec.ts` (15): the official binary order; **rejections** (cli.js never picked; no binary →
  `unsupported_platform`); SDK platform package order; musl; env defaults; `checkCliHealth` without a binary.
- `test/cliArgs.spec.ts` (20, 9 new): SDK-derived flags warned only when duplicated; **rejection** of
  `permission-prompt-tool`; builder shapes; `append-system-prompt` overlap; replacing `--settings`; cross-check
  against the installed `sdk.mjs`.
- `test/sdkMessageStream.spec.ts` (7): type-level exhaustive `SDKMessage` union (negative control confirmed with
  `tsc`); no rows for new frames; 0.3.x fields keep the streamed-row replacement; `error` frames add no row.

## Rows deliberately left out and why
Group 2 adds no rows. The out-of-scope list, copied from `out-of-scope.md`:

| Feature | Official requests / ids | UI to keep out | Reason |
| --- | --- | --- | --- |
| Microphone / speech-to-text | `start_speech_to_text`, `stop_speech_to_text`, the `resources/audio-capture` binary | the mic button (ported `micButton` classes stay unused) | out of scope: account and cloud |
| Login / Switch account | `login`, `get_auth_status`, `submit_oauth_code` (stay commented out) | the `login` row | out of scope: account and cloud |
| Account & usage | `get_usage`, `open_account_usage` | the `account-usage` row; the `usage` slash command (its official action is `account-usage`) | out of scope: account and cloud |
| Usage / context meter | `get_context_usage`, `request_usage_update` | the footer `YH0` / `usageButtonV2`; the `context` slash command (its official action opens the context view) | out of scope: account and cloud |
| Remote Control | `toggle_remote_control`, `remoteControlAtStartup`, `/remote-control` | the `remote-control-at-startup` row and the `/remote-control` row | out of scope: account and cloud |
| Feedback | `submit_feedback`, `/feedback`, `/bug`, "Report a problem" | those rows; the live "Report a problem" button is **removed** in step 33, and the version text stays | out of scope: account and cloud |
| Thumbs rating | `message_rated` (`WU0`) | the thumbs | out of scope |
| Switch models when flagged | `switchModelsOnFlag` (`NM1`) | the `switch-models-on-flag` row | gated by Anthropic experiment flags Forge never receives |
| Side question | `/btw`, `side_question` | the `/btw` row | out of scope |
| Ultracode | `ultracode` flag, the `xhigh`+flag mode | any Ultracode option; `ultracode` isn't in Forge's settings whitelist | out of scope |

New SDK capabilities with no UI and no step yet (auto mode, fallback model, budgets, background tasks, MCP toggles,
`prompt_suggestion`, `conversation_reset`, `supersedes`) are listed in `docs/sdk-upgrade.md`. They are reachable
through `forge.cliArgs` where flag-based. Adding UI for them needs a scope decision.

## Open issues
1. The mock host answers `set_model` / `set_permission_mode` without `success`, so harness labels revert.
2. The `ModeSelect.vue` scoped overrides of ported official rules cause the mode menu's 3 structural rows.
3. `resources/claude-code/` (CLI 2.0.76) is unused but still tracked and packaged.
4. The VSIX is platform-specific (it carries the build machine's binary).
5. `pnpm-workspace.yaml` carries `minimumReleaseAgeExclude` for the nine 0.3.274 packages (published about 12 hours
   before install). Remove it after a day, or pin `^0.3.273`.
6. `maxThinkingTokens` / `setMaxThinkingTokens` are deprecated. Step 14 moves to `thinking`.
7. The first session's env reports `CLAUDE_CODE_ENTRYPOINT=sdk-ts`, because Forge sets it on `process.env` after
   building the env. This was already the case before the upgrade.
8. Carried from group 1: busy sends are dropped; ChatPage's row-count watcher scrolls when scrolled up before a new
   row; the composer oracle has 3 rows; Settings heading overlap; "刚刚"; Ultracode in the empty state.

## VS Code checklist for the user (unverified until you run it)
1. `pnpm install`, then `pnpm run build`. **Expected:** `resources/native-binary/claude.exe` exists (233,691,808
   bytes), and running it with `--version` prints `2.1.274 (Claude Code)`.
2. Install or launch the build and open the Forge output channel. **Expected:**
   `CLI Path: …\resources\native-binary\claude.exe`; `claude doctor` reports version 2.1.274; no
   `Claude CLI not found` or `Unsupported platform` line.
3. Send a message that uses a tool (e.g. "Read package.json and summarise it") and approve the permission.
   **Expected:** text streams, the tool row and its output render, the result arrives and the Stop button goes away.
   No `unknown option` or `process exited with code` errors in the Forge log.
4. Resume an old session from the history dropdown. **Expected:** the history loads, and a new message continues it.
5. Turn Thinking **off** in the "/" menu and send a message. **Expected:** the session starts and answers (the SDK
   now passes `--thinking disabled`).
6. Ask for a 3-step todo list. **Expected:** if the model uses a todo tool, it's `TodoWrite` (a todo row), not
   `TaskCreate`.
7. Set `"forge.cliArgs": { "model": "opus", "effort": "high", "print": true }` and start a session. **Expected:**
   - the log shows `! --model opus -- the SDK also emits it from model on this launch…`;
   - `+ --effort high (passthrough (SDK option effort is not set))`;
   - `x --print REJECTED`;
   - the session starts.

   Remove the setting afterwards.
