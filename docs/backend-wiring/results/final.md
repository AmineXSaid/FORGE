# Final report: the backend behind the official-clone frontend (steps 01–34)

2026-10-03, on top of `15381c7`. This merges the six group reports
([1](01-frontend.md), [2](02-sdk.md), [3](03-dispatcher.md), [4](04-model-permissions.md),
[5](05-conversations.md), [6](06-browser-views.md)) as step 35 asks, using the B9 columns
(row | request | host result | UI effect | verdict). Groups 7 and 8 of the index (steps 42–47, results 51–66: the
endpoint line, the welcome page, the production audit, small-model guards) are not part of the six groups
step 35 depends on, and are not merged here except where they changed a row.

## Read this first

- **Nothing in this file was observed in real VS Code, against the real CLI with an account, or with a real
  Chrome.** The 122-item checklist at the end is entirely unverified, except that 9 items are *paused*, not
  unverified (see "Paused").
- **The oracle was not run.** The official `webview/index.css` is not in this container, and the two public
  hosts I tried for it answered 403 under the session's egress policy. No "0 structural diffs" is claimed for
  today's tree. The last recorded numbers are given per window, dated, with what changed since.
- What was run today, on linux-x64 (Node 22.22.0, pnpm 10.28.0, Chromium 1194 over CDP): `pnpm test`,
  `pnpm run typecheck:all`, `pnpm run build` (all pass), and a harness click-through of 14 surfaces
  (`PASS 112 · FAIL 0 · LEFT OUT 3`, oracle `NOT RUN`).
- 27 tests did not run here: 20 live tests that need a real CLI or gateway, and 7 that compare against the
  official bundle (listed in [06-browser-views.md](06-browser-views.md)).
- Some statements in the group reports no longer match the code ("Drift", below). Where a checklist item was
  affected it was changed or tagged.

## Found not marked done, and what was done about it

| Found | Done |
| --- | --- |
| Step 34 (group 6 checkpoint): three unchecked items, no `06-browser-views.md` | Click-through done today; report written; checklist handed over. The oracle line stays **unchecked**. |
| Step 35 (this report): four unchecked items, no `final.md` | This file. |
| Step 01's index line had no "(done)" marker, though `results/01-app-fills-webview.md` and the group 1 report exist | Marker added in the index. |
| 82 unchecked boxes across 16 other step files. Fifteen of those steps are marked "(done)" in the index (the sixteenth is step 01, above), and every one is covered by a result file or a group report. | **Not touched.** I could not tell whether the boxes are stale or the work is unrecorded. |
| Index lines 42, 43, 44, 46, 47 (groups 7 and 8) have no "(done)" marker; their step files contain no checkboxes and no result file shares their number | **Not touched**, outside the six groups. |

Found while running the gates (none is feature code; details in [06-browser-views.md](06-browser-views.md)):

1. `test/bypassGate.spec.ts` failed in this container: it passed only where `IS_SANDBOX` is unset. Fixed in the
   spec (environment stubbed); the source is unchanged. Verified with the variable set and unset, and with a
   negative control.
2. `drive-all.mjs` could not run without the official stylesheet (a probe error abandoned whole steps). Now it
   refuses to start and says why, and an explicit `--no-oracle` runs every row and reports oracle windows
   `NOT RUN`. `--no-oracle` cannot be combined with `--write-baseline`.
3. `drive-all.mjs` still expected the pre-pause behaviour for the two terminal rows (2 FAILs). It now asserts
   the paused design and reports those rows `LEFT OUT`.

## Gates (2026-10-03, the tree containing the changes above)

- `pnpm test`: `Test Files 129 passed | 4 skipped (133)`, `Tests 3064 passed | 27 skipped (3091)`, exit 0.
  The first run in this container, before the `bypassGate` spec change, was `1 failed | 3063 passed | 27 skipped`.
- `pnpm run typecheck:all`: `tsc --noEmit` and `vue-tsc -p src/webview/tsconfig.json --noEmit`, exit 0.
- `pnpm run build`: exit 0.
  - `eslint src --max-warnings 390`: `✖ 389 problems (0 errors, 389 warnings)`. **One warning of budget remains.**
  - `Forge brand guardrail: clean (469 files scanned)`
  - `Forge token check: clean (344 tokens used, 479 defined)`
  - `Forge command check: clean (31 commands, 11 references)`
  - webview `✓ 4200 modules transformed`, `✓ built in 7.05s`; extension `[watch] build finished`.
- Observed: `resources/native-binary/claude --version` prints `2.1.274 (Claude Code)` (230,580,536 bytes, copied
  by the build from `@anthropic-ai/claude-agent-sdk-linux-x64@0.3.274`); `package.json` asks for
  `@anthropic-ai/claude-agent-sdk` `^0.3.274`.
- Harness: `drive-all.mjs --no-oracle`, 14 of its 16 steps, against the real built webview and the stub host.
  `/main.js` byte-identical to `dist/media/main.js` (2,255,618 bytes). Final script: `PASS 112 · FAIL 0 · LEFT OUT 3`,
  exit 0. Before the script fix: `PASS 112 · FAIL 2 · LEFT OUT 1`.

## The B9 table, merged

One row per feature, not per sub-case. "(N)" is the number of sub-rows the group report recorded for the
step; each group file has them. Verdicts are the group report's, as recorded on the date shown; a row is
marked **today** only where today's harness run re-clicked it. A host handler named in a row has a vitest
spec, and all 3064 specs that ran pass today; that is the only sense in which a row is re-checked when it is
not marked **today**.

### Group 1: frontend defects (steps 01–05), recorded 2026-09-17 on `a74df01`

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| 01 · `#app` fills the webview at 1024, 460 and 320 px; sessions and settings pages; sessions dropdown at 460 and 320 | none | — | `#app` equals the body width, no horizontal overflow; with the rule removed live it measured 382.59 px, restored 460 | works (9) |
| 02 · Slash Commands section: CLI commands listed while filtering, `/context` and `/usage` hidden; click sends and keeps the draft; Tab inserts `/<cmd> ` | `io_message` | accepted | section between Settings and Support, only while filtering | works (14); **today:** `/compact` re-clicked, sent as a message |
| 02 · Shift+Tab inside the "/" filter | `set_permission_mode {acceptEdits}` | stub acked without `success` | menu stays open; label reverted | partial (a stub gap at the time). Today the mode menu's rows do follow their label; this keystroke path was not re-run. |
| 03 · streamed text held back until a fence or table closes; final message replaces the row; thinking, `tool_use`, abandoned stream, subagent, pinning, scrolling | `stream_event` … | — | T1–T12 | works (14) |
| 03 · copy button on a streamed code block | none | — | not run: clipboard denied in the pane | not verifiable (1) |
| 04 · status dot follows the official `p85` | assistant and user messages | — | text-only none; running `dotProgress`; error `dotFailure`; ok `dotSuccess`; reverts at turn end | works (9) |
| 05 · header glyphs | none | — | order New session, Session history; 28×28 boxes; oracle 15/15 | works (8). Index: "closed: superseded by the user's `d496deb`". |

**Counts, as recorded:** works 54 · partial 1 · not verifiable 1 · broken 0 · left out 0 (plus 3 pre-existing issues reproduced).

### Group 2: SDK upgrade (steps 07–08), recorded 2026-09-17 on `36b614e`

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| 07 · CLI binary resolution (official `xh0`); no binary gives `Unsupported platform` | `resolveClaudeExecutable` | the win32 binary at the time reported `2.1.274 (Claude Code)` | — | works (host check). **Today:** the linux-x64 binary reports `2.1.274 (Claude Code)`. |
| 07 · build copies the SDK's binary | `esbuild.ts` | copied when missing or a different size | — | works. **Today:** the build printed `[build] Copied …claude-agent-sdk-linux-x64@0.3.274… -> resources/native-binary/claude`. |
| 07 · flag gate: 40 SDK-derived flags classed against the installed `sdk.mjs`; 6 protocol flags rejected | `buildExtraArgs` | — | — | works (spec; `cliArgs.spec.ts`, 20 tests, pass today) |
| 07 · 0.3.x frames: 28 `system` subtypes and 6 top-level types add no row; final message replaces the streamed row | `io_message`, `stream_event` | — | +0 rows | works (harness at the time; `sdkMessageStream.spec.ts`, 7 tests, passes today) |
| 07 · send, thinking, tool rows, dots, "/", model, mode and permission windows | — | — | as group 1 | works (17) |
| 07 · model: click Opus | `set_model` | stub acked without `success` | label reverted | partial (a stub gap at the time) |

**Counts, as recorded:** works 21 · partial 1 · broken 0 · left out 0.

### Group 3: the dispatcher (steps 09–10), recorded on `f2e5059`

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| 09 · "/" → Open Forge in Terminal | `open_claude_in_terminal {location:"bottom"}` | validated (official `JI0`); launches Forge's bundled binary | at the time: one request, menu closes | **paused 2026-09-28.** The host handler is spec-verified today (`openClaudeInTerminal.spec.ts`, 62 tests). |
| 09 · accepted payloads: empty, bare slash command, `--resume <uuid>`, kickback shape | same | `open_claude_in_terminal_response` | — | works (spec) |
| 09 · rejected: `/x; rm`, `hello`, `--dangerously-skip-permissions`, `--resume ../x`, extra args, non-array args | same | the official error string, verbatim | — | works (spec) |
| 10 · dispatcher audit | — | only `get_auth_status`, `login`, `submit_oauth_code` are commented out | — | works. **Today:** still exactly those three; 86 live cases. |

**Counts, as recorded:** works 11 · partial 0 · broken 0 · left out 3 (the auth cases).

### Group 4: model and permissions (steps 11–18), recorded 2026-09-18 and 19 on `5e5a562`

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| 11 · `apply_settings`: `effortLevel` to userSettings; `ultracode` only through the flag layer; wrong key, type or layer, and two layers in one patch, rejected before any write | `apply_settings` | written to `~/.claude/settings.json`, then `applyFlagSettings`; errors in-band | — | works (15), 4 keys left out; `applySettings.spec.ts`, 34 tests, passes today |
| 11 · B6: a `forge.json` profile does not pin `effortLevel` | — | spec | — | works (spec) |
| 12 · model metadata: the CLI's order and every `ModelInfo` field, greyed unavailable rows, pick Opus or Default, served-model pill, 4 malformed `set_model` rejected | `get_claude_state`, `set_model` | `model` written or cleared, plus `applyFlagSettings` | pill follows | works (12) |
| 13 · effort and Ultracode: slider, row cycle, notches (Sonnet 3, Opus 6), Max, none on Haiku, `/effort` re-read; the Ultracode notch sends `xhigh` then `{ultracode:true}` flags-only, and leaving clears it first | `apply_settings {effortLevel}`, `{ultracode}` | as 11 | menu stays open | works (23), 1 left out |
| 14 · thinking toggle, separate from effort | `set_thinking_level` | `setMaxThinkingTokens(0)` or `setMaxThinkingTokens(31999)`, stored | stays open | works (10) |
| 15 · "Toggle fast mode", only for fast-capable models | `open_claude_in_terminal {prompt:"/fast", args:[], location:"bottom"}` | validated | closed | works at the time (4). **Paused 2026-09-28.** |
| 16 · permission prompt option 2 with its save destination; the "Permission rules" dialog | `add_permission_rules`, `list_permission_rules`, `remove_permission_rule` | written to the chosen layer; `flagSettings` rules read-only | dialog | works (18) |
| 17 · plan-mode labels, plan answers, plan preview and comments | `open_markdown_preview`, `set_permission_mode`, `close_plan_preview`, `remove_plan_comment` | as recorded | preview tab; prompt labels | works (17), 2 left out |
| 18 · kept permission mode per conversation | `persist_session_permission_mode` | stored per session; Plan never kept; a replaced CLI id carries the entry | footer follows | works (11), 2 left out |

**Counts, as recorded:** works 110 · partial 0 · broken 0 · left out 9.

### Group 5: conversations (steps 20–26), recorded 2026-09-19

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| 20 · rename, and its rejections (bad id, empty title, 200-character cap) | `rename_session` | `custom-title` line appended through the SDK's `renameSession`; `session_renamed` pushed | the row's title changes | works |
| 21 · archive, unarchive | `archive_session`, `unarchive_session` | `hiddenSessionIds` updated | the row moves into or out of Archived | works |
| 22 · unread, read and the status dot; the dot survives a feed push and a reload; repeats and bad keys do nothing | `set_session_unread` | key stored; feed rebroadcast | dot appears or clears; the dropdown stays open; opening an unread row sends nothing | works; "turn finishes while hidden" is spec-verified only |
| 23 · branch search; slow list | none; `list_sessions_request` | client-side filter | only matching branches, no `<mark>`; spinner | works |
| 24 · rewind: dry run, real run, nothing to restore, checkpoint error, "Never mind", bad uuid or non-boolean `dryRun`, closed channel | `rewind_code` | `query.rewindFiles(id, {dryRun})`; five fields forwarded; `error` thrown | dialog; "Code rewind successful" row | works; **the effect on files on disk is CLI-side and no harness can show it**; closed channel is spec-verified |
| 25 · "Message actions" button; fork from message 2 or later, from the first message, with rewind (order: dry run, rewind, fork), a rewind that cannot run (no fork is sent), a message with no uuid, fork rejections, a whole-conversation fork | `fork_conversation`, `rewind_code` | the SDK forks | as recorded | works |
| 26 · "/" → Rewind picker; "Resume conversation" only while filtering | none | — | picker; row appears only when typed | works |

**Counts, as recorded:** works 33 · spec-verified 3 · partial 0 · broken 0 · left out 10.

### Group 6: browser and views (steps 28–33), recorded when each step ran; re-clicked 2026-10-03

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| 28 · "+" menu with and without browser support | — | — | three rows with the globe glyph; two without | works. **Today:** re-clicked. |
| 28 · "+" → Browse the web; pick a tab; send a mention (first send, `@browser:new_tab`, no mention, unsupported) | `list_files_request`, `ensure_chrome_mcp_enabled`, `create_new_browser_tab` | `setMcpServers` adds `claude-in-chrome`; `tabs_context_mcp {createIfEmpty:true}` | `@browser:` inserted; tabs listed; turn carries `<browser …>` | works (7). **Today:** the insertion, the new-tab attach and the refusal path re-clicked. |
| 28 · `disable_chrome_mcp`; `channelId is required`; unopened channel; `setMcpServers` errors | same | rejected, or only `claude-in-chrome` removed | no UI row | spec-verified (7) |
| 29 · output styles: picker, apply (`localSettings` only), locations, wizard save, name exists, replace, no-reload | `get_output_style`, `apply_settings`, `get_output_style_locations`, `create_output_style` | file written with `O_EXCL` and `O_NOFOLLOW` inside the chosen folder | picker, wizard | works (7). **Today:** opening the picker re-clicked. |
| 30 · Focus view: toggle (menu stays open), `viewMode` to every channel, fold rows, same value twice, non-boolean | `set_focus_view` | config written; `applyFlagSettings({viewMode:"focus"})` or `null` | transcript folds | works (6). **Today:** the toggle re-clicked. |
| 31 · "/" → MCP servers, Hooks, Manage plugins, Slash commands open that Settings tab; unknown tab goes to General and runs nothing else | `open_forge_settings {tab}` | `{tab}`; `openEditorPage` only | Settings on the tab | works (7). **Today:** the four rows re-clicked. |
| 32 · General config…; a search string and its limits; `command:` config types refused | `open_config`, `open_config_file` | `focusFirstEditorGroup`, then `openSettings "forge"` | VS Code settings, filtered | works (6). **Today:** General config re-clicked. |
| 32 · View help docs | `open_help` | **then:** `env.openExternal(docs URL)`. **Now:** Forge Settings on the Guide tab (`0004b2b`). | menu closes | superseded; the current host side is spec-verified. **Today:** request and menu behaviour re-clicked. |
| 32/33 · Endpoints: the seven buttons | `run_endpoint_action` | the mapped `forge.*` command; unknown actions rejected | picker, flow, settings.json, report | works (7) |
| 33 · "Report a problem" | — | — | row removed; version text stays | left out (out of scope) |
| **Today** · every "/" and "+" row, filter-only rows and the Slash Commands section | as in [06-browser-views.md](06-browser-views.md) | stub host | as there | works 28 · paused 2 · left out by model 1 |

**Counts, as recorded in steps 28–33:** works 42 · spec-verified 7 · superseded 1 · partial 0 · broken 0.
**Today's click-through:** works 28 · paused 2 · left out by model 1.

### Totals

| Group | works | spec-verified | partial | not verifiable | superseded | broken |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 54 | — | 1 | 1 | — | 0 |
| 2 | 21 | — | 1 | — | — | 0 |
| 3 | 11 | — | 0 | — | — | 0 |
| 4 | 110 | — | 0 | — | — | 0 |
| 5 | 33 | 3 | 0 | — | — | 0 |
| 6 | 42 | 7 | 0 | — | 1 | 0 |
| **Sum, as recorded** | **271** | **10** | **2** | **1** | **1** | **0** |

These are sub-row counts as each group recorded them, on different dates and trees. 271 is not a statement about
today's tree: today's own measurements are the 31 rows above and the 112 `PASS` rows of the harness run (which
overlap). "Left out" is not summed, because every group repeats the same out-of-scope features; the unique list
is below. The paused rows were counted as works when recorded: group 3's UI row, and group 4 step 15's "row on
Opus" and "click" rows.

## The oracle, per window

**Today: not run.** The freshest per-window record is `baselines/oracle.json` (24 windows, last committed
2026-09-26 in `ada0d7e`), which accepts these structural rows and no others:

| Window | Accepted structural rows at the baseline |
| --- | --- |
| 17 windows: "/" menu, "+" menu, mode menu, sessions dropdown, message actions, both rewind dialogs, permission prompt (input shown), error banner, header, sessions page (list), browser attach error, session manager, session manager (a group), session row menu, session group menu, status filter menu | none |
| model menu (chips set aside); model menu (in use, not answering) | 1 each: `span.fg-modelmenu__modelLabel font-weight` (the ticked row's weight 600, Forge's own rule) |
| composer (idle) | 1: `fg-footer__sendIcon > path opacity` (the send sparks, by design) |
| transcript | 8: Forge's cube canvas and spinner (`fg-cube__*`, `fg-spinner__*`, `fg-chat__spinnerRow`) |
| welcome: no endpoint; endpoints never checked; nothing answered | 15, 16 and 16: the Forge welcome page's own layout (it is Forge's design, not a port of the official login page) |

Webview files changed **after** that baseline write (`git log ada0d7e..HEAD`): `CommandMenu.vue`, `ButtonArea.vue`,
`ChatPage.vue`, `App.vue`, `ContentBlock.vue`, `TextBlock.vue`, `EndpointWelcome.vue`, `RandomTip.vue`,
`ForgeWordmark.vue`, `ForgeMark.vue`, `forge-tokens.css`, the Settings Guide files, and `main.ts`. Windows built
from them may differ from their baseline: the "/" menu (`CommandMenu.vue`, which gained the `(soon)` element in
`a846d08`), the header, error banner, browser-attach banner and transcript (`ChatPage.vue`, `ContentBlock.vue`,
`TextBlock.vue`), the three welcome states (`EndpointWelcome.vue`), and possibly the composer's footer buttons
(`ButtonArea.vue`). The windows whose rendering component is not on that list (the "+" menu, mode menu, sessions
dropdown, message actions, rewind dialogs, permission prompt, session manager and its menus, model menu) are expected
unchanged. Expected is not measured.

The group-specific recorded numbers (for example 81/81 for the "/" menu at step 32, 57/57 for the sessions dropdown
at step 23, 41/41 for the mode menu, 30/30 and 25/25 for the permission prompt, 68/68 for the "Permission rules"
dialog) are in the group files, dated by their steps.

## The B2 rule, audited

B2: every request lives in six places (types, transport, dispatcher, handler, mock host, spec). A scratch script
(reproduced below; not committed) took every live `case "<name>":` in `ClaudeAgentService.ts` (86; the commented-out
ones are exactly `get_auth_status`, `login`, `submit_oauth_code`) and looked for the name in
`src/shared/messages.ts`, `BaseTransport.ts`, the case body, `mock-host.js` and `test/*.spec.ts`.

**82 of 86 are present in all six places.** The four it flagged, each read by hand:

| Case | Flagged for | What it is |
| --- | --- | --- |
| `request` | no handler | The message envelope, not a request type. It hands the message to `handleRequest`. |
| `set_model` | no handler | A false positive of the script: the case body starts with comments and then holds the full handler. |
| `cancel_request` | no mock-host answer | A one-way abort the webview sends (`BaseTransport.ts:904`). It has no response to mock. |
| `get_plan_comments` | no transport method | Host-only by design: `messages.ts` records that the official host answers it "which its webview never sends". |

The script is a heuristic (it matches names, not behaviour); it shows presence, not correctness.

<details><summary>The script</summary>

```js
// B2 audit: every live dispatcher request type against the six places it must live in.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = '/home/user/FORGE';
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const dispatcher = read('src/services/claude/ClaudeAgentService.ts');
const types = read('src/shared/messages.ts');
const transport = read('src/webview/src/transport/BaseTransport.ts');
const mock = read('.claude/skills/ui-parity/harness/mock-host.js');
const specs = readdirSync(join(ROOT, 'test')).filter((f) => f.endsWith('.spec.ts')).map((f) => ({ f, text: read(join('test', f)) }));
const lines = dispatcher.split('\n');
const cases = [];
lines.forEach((line, i) => {
  const m = line.match(/^\s*case "([a-z_]+)":/);
  if (m) cases.push({ name: m[1], line: i + 1, body: lines.slice(i + 1, i + 7).join('\n') });
});
const has = (text, name) => new RegExp(`["'\`]${name}["'\`]|\\b${name}\\b`).test(text);
const rows = cases.map(({ name, line, body }) => {
  const bodyCode = body.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  return { name, line, types: has(types, name), transport: has(transport, name),
    handler: /return|await|this\.|handle/.test(bodyCode.split(/\n\s*case "/)[0]),
    mock: has(mock, name), spec: specs.filter((s) => has(s.text, name)).length };
});
const gaps = rows.filter((r) => !r.types || !r.transport || !r.handler || !r.mock || !r.spec);
console.log(`${rows.length} live cases; ${rows.length - gaps.length} present in all six places; ${gaps.length} with a gap:`);
for (const r of gaps) console.log(`  ${r.name} (line ${r.line}): missing ${['types', 'transport', 'handler', 'mock', 'spec'].filter((k) => !r[k]).join(', ')}`);
```

</details>

## Rows deliberately left out and why

### Out of scope for the whole project (`out-of-scope.md`, unchanged)

| Feature | Official requests / ids | UI kept out | Reason |
| --- | --- | --- | --- |
| Microphone / speech-to-text | `start_speech_to_text`, `stop_speech_to_text`, the `resources/audio-capture` binary | the mic button (ported `micButton` classes stay unused) | out of scope: account and cloud |
| Login / Switch account | `login`, `get_auth_status`, `submit_oauth_code` (stay commented out) | the `login` row | out of scope: account and cloud |
| Account & usage | `get_usage`, `open_account_usage` | the `account-usage` row; the `usage` slash command | out of scope: account and cloud |
| Usage / context meter | `get_context_usage`, `request_usage_update` | the footer `YH0` / `usageButtonV2`; the `context` slash command | out of scope: account and cloud |
| Remote Control | `toggle_remote_control`, `remoteControlAtStartup`, `/remote-control` | the `remote-control-at-startup` and `/remote-control` rows | out of scope: account and cloud |
| Feedback | `submit_feedback`, `/feedback`, `/bug`, "Report a problem" | those rows; the "Report a problem" button was removed in step 33 and the version text stays | out of scope: account and cloud |
| Thumbs rating | `message_rated` (`WU0`) | the thumbs | out of scope |
| Switch models when flagged | `switchModelsOnFlag` (`NM1`) | the `switch-models-on-flag` row | gated by Anthropic experiment flags Forge never receives |
| Side question | `/btw`, `side_question` | the `/btw` row | out of scope |

**Moved into scope:** Ultracode (`ultracode` flag plus `xhigh`), 2026-09-18, the user's decision, built in step 13.
The "left out" tables in group reports 1–3 still list Ultracode as out of scope; that predates the decision.

**In neither scope list, so not built:** the worktree pill (`open_folder_in_new_window`) and `generate_session_title`.

### Left out by the groups

| Group · step | Left out | Why |
| --- | --- | --- |
| 4 · 11 | `switchModelsOnFlag`, `remoteControlAtStartup` settings keys | as above |
| 4 · 13 | The Modes menu's effort row | the user decided effort lives in the model menu |
| 4 · 17 | AskUserQuestion's branch of the permission prompt ("Submit answers") | Forge has no question form; switching the labels would make the prompt unanswerable |
| 4 · 17 | `MW0`'s notification and Edit/Write diff branches | separate features |
| 4 · 17, 18 | Auto mode (row, kept mode, initial mode) | the user decided to keep Auto out |
| 4 · 18 | `persistDefaultPermissionMode`; heuristic session-id adoption | unreachable in Forge; Forge has no panel-tab restore across reloads |
| 5 | `liveElsewhereSessions` and the `statusDotElsewhere` ring, `statusDotFailed` | need a second surface, or have no producer |
| 5 | The official's `messageHovered` class | inert upstream; omitted |
| 5 | `AppContext.forkConversation`'s `openNewInTab` branch | needs a `sessionId` on `new_conversation_tab`; the host hardcodes `openNewInTab: false` |
| 5 | A setting for file checkpointing | the official has none; the user chose "always on" |
| 5 | The official's replay placement machinery | ordering, not correctness; Forge appends and dedupes by uuid |
| 6 · 28 | A browser status pill and disconnect control; `@terminal:` mentions | the surface is not in scope; not named by the step |
| 6 · 28 | "Browse the web" on a build with no Claude binary | B4: the backend cannot work |
| 6 · 30 | Official Focus view parts: subagent spans, synthetic and origin-filtered messages, teleported messages, "Thought for Ns", `redacted_thinking` | Forge's transcript model has no field for them |
| 6 · 31 | "/" → Permissions as a Settings tab | step 16 (the user's decision) made it open the "Permission rules" dialog; `CLAUDE.md`'s scope line still says Settings tab and is out of date |
| 6 · 32 | `forge.newConversation`, `forge.showLogs` as webview-triggered commands | dropped with the `command:` branch; `forge.showLogs` remains in the command palette |

### Hidden per model, session or environment (as the official)

| Row | Shown only when |
| --- | --- |
| Effort (model menu, "/", pill) | the model has `supportsEffort` (hidden on Haiku) |
| Ultracode notch | the model lists `xhigh` and workflows are not disabled |
| "Toggle fast mode" | the model has `supportsFastMode` (and see "Paused") |
| "Browse the web" | the Claude binary resolves |
| Slash Commands section, "New conversation", "Resume conversation" | the user is typing a filter |
| Output styles → "Build a custom style" | the style list has loaded |
| Permission prompt option 2 | the CLI offered a suggestion |
| Message actions options 2 and 3 | the message has a uuid |
| Greyed unavailable models | the CLI reported them in `unavailable_models` |
| "Bypass permissions" | the CLI would accept it (it refuses it as root outside a sandbox; `bypassGate.ts`) |

### Paused

"Open Forge in Terminal" and "Toggle fast mode" (which runs `claude /fast` in a terminal), by the user's decision on
2026-09-28 (`a846d08`): greyed, "(soon)", `aria-disabled`, and they do nothing. One switch, `TERMINAL_AVAILABLE`, brings
them back. The host request still works and is spec-verified. Checklist items 26–33 and 53 are tagged *paused*; item
122 checks the paused state.

## Where the group reports no longer match the code

| Report says | Now | Commit |
| --- | --- | --- |
| Group 6 step 32: `open_help` opens the docs URL | opens Forge Settings on the Guide tab; `FORGE_HELP_URL` is gone | `0004b2b`, 2026-09-27 |
| Groups 3 and 4: "Open Forge in Terminal" and "Toggle fast mode" launch a terminal | greyed and paused | `a846d08`, 2026-09-28 |
| Groups 1–3: Ultracode is out of scope | in scope since 2026-09-18 | `775dba3` |
| Group 6 step 31: 13 Settings tab ids | 16 (`agents`, `endpoints`, `guide` added) | endpoints line, `0004b2b` |
| Group 5: `handleNewConversationTab` is a stub | it runs `forge.editor.open` | — |
| Counts "20 commands, 13 references", "355 files", "240 tokens used" | 31 commands, 11 references; 469 files; 344 tokens used | various |
| Group 4 open issue 5: nothing from steps 12–18 is in the user's installed build | unknown today | — |

## Open issues carried forward

Recorded in the group reports. Marked **still true today** only where I re-checked the code in this pass.

- `CLAUDE.md` line 110 still says "/" → Permissions "must open the matching Settings tab". **Still true today.**
- `resources/claude-code/` (CLI 2.0.76) is unused but still tracked. **Still true today.**
- `pnpm-workspace.yaml` still carries `minimumReleaseAgeExclude` for the nine 0.3.274 SDK packages. **Still true today.**
- No reference to `session_archive_changed` exists anywhere in `src`. **Still true today.**
- `openNewInTab` is still hardcoded `false` (`BaseTransport.ts`, `AppContext.ts`). **Still true today.**
- The ESLint warning budget is 389 of 390. **New today.**
- `handleGetAssetUris` derived `extensionPath` from `process.cwd()` (group 3). Not re-checked.
- The mock host acks unknown requests without `success` (groups 1–3). Not re-checked.
- The Settings page lists models through an `sdk_probe` spawn; `~/.forge.json` gains every default key on the first
  settings write; the AskUserQuestion prompt is a generic Yes/No (groups 4–5). Not re-checked.
- Composer oracle rows; empty-state oracle rows; Settings heading overlap at 460 px; relative time "刚刚"; Shift+Tab in
  the "/" filter cycling the mode; the filter ranking differing from the official's Fuse; the row-count watcher
  scrolling to the bottom; the Bash tool rows' structural differences; the double space after a completed `@` mention
  (groups 1, 6). Not re-checked.
- A send while a turn is running was dropped (groups 1–2); a later step (59, "messages sent while the model works")
  addresses it. Not re-checked.
- The VSIX is platform-specific (it carries the build machine's binary). Not re-checked.

## VS Code checklist for the user

**122 items. None has been run by the author, and none is verified.** Items are numbered globally; the tag
`[G4 #12]` gives the item's group and its number in that group's report. Tick an item only after running it
against the real CLI, and report the number back. Items tagged *paused* cannot be run until `TERMINAL_AVAILABLE`
is `true`.

Install a build of this branch first (`pnpm run package`, then install the `.vsix` and reload the window).

### Group 1: frontend defects (steps 01–05)

Source: [`01-frontend.md`](01-frontend.md), section "VS Code checklist for the user (unverified: the agent can't observe VS Code)".

> The harness proves the webview↔host contract against a stub. Nothing here was observed in real VS Code,
> against the real CLI, or with a real Chrome. Steps 1–8 need Chrome with the Claude in Chrome extension.

> The harness proves the webview↔host contract. Everything below is CLI-side or
> on-disk and **has not been observed**. Numbered so results can be reported back.

> Install a build of this branch first (`pnpm run package`, then install the `.vsix`
> and reload the window).

> The harness proves the webview↔host contract. None of the following was observed;
> the agent cannot run real VS Code.

**Step 01**

1. [ ] [G1 #1] Open Forge in the sidebar at about 460px wide. **Expected:** the chat fills the whole panel width, with no empty band on the right.

2. [ ] [G1 #2] Open past conversations (the clock icon) at ~460px and at ~320px. **Expected:** the dropdown sits under the header, 16px from both edges, fully visible.

**Step 02**

3. [ ] [G1 #3] Open "/" without typing. **Expected:** no "Slash Commands" section.

4. [ ] [G1 #4] Type `/`. **Expected:** a "Slash Commands" section with your CLI's commands in alphabetical order, without `/context` or `/usage`.

5. [ ] [G1 #5] Click `/init`. **Expected:** the menu closes, `/init` is sent and runs in the transcript, and your draft stays in the composer.

6. [ ] [G1 #6] Open "/", type `init`, press Tab. **Expected:** nothing is sent; the composer holds `/init ` with the caret at the end.

7. [ ] [G1 #7] If two plugins define the same command name. **Expected:** one row shows as `/<plugin>:<name>`.

**Step 03**

8. [ ] [G1 #8] Ask for a long answer with a code block and a table. **Expected:** text streams paragraph by paragraph; no half-written fence or table appears; the full block and table render once they finish.

9. [ ] [G1 #9] While it streams, stay at the bottom. **Expected:** the view follows. Scroll up mid-stream. **Expected:** the view stays put. (Known issue 11: if you scroll up *before* the reply's first row appears, it can still jump down.)

10. [ ] [G1 #10] Ask something that reads a file. **Expected:** the Read row appears only once its input is complete, then shows its result.

11. [ ] [G1 #11] With thinking on, send a prompt. **Expected:** "Thinking..." while it streams, then a collapsed "Thought for Ns" or "Thinking" row.

12. [ ] [G1 #12] Reload the conversation from history. **Expected:** the same transcript, with no duplicated or missing rows.

**Step 04**

13. [ ] [G1 #13] Ask Claude to run a shell command. **Expected:** the Bash row's dot blinks while it runs, then turns green.

14. [ ] [G1 #14] Ask it to read a file that doesn't exist. **Expected:** that row's dot is red.

15. [ ] [G1 #15] Ask a plain question with no tools. **Expected:** the grey dot, with no colour and no blink.

16. [ ] [G1 #16] Start a tool that needs permission and stop the turn. **Expected:** after the turn ends, that row's dot is red, not blinking.

17. [ ] [G1 #17] Reopen an older conversation. **Expected:** completed tools are green or red, text replies grey; nothing blinks.

**Step 05**

18. [ ] [G1 #18] Look at the panel header. **Expected:** New session (pen in a square), then Session history (clock).

### Group 2: Agent SDK upgrade (steps 07–08)

Source: [`02-sdk.md`](02-sdk.md), section "VS Code checklist for the user (unverified until you run it)".

19. [ ] [G2 #1] `pnpm install`, then `pnpm run build`. **Expected:** `resources/native-binary/claude.exe` exists (233,691,808
    bytes), and running it with `--version` prints `2.1.274 (Claude Code)`.

20. [ ] [G2 #2] Install or launch the build and open the Forge output channel. **Expected:**
    `CLI Path: …\resources\native-binary\claude.exe`; `claude doctor` reports version 2.1.274; no
    `Claude CLI not found` or `Unsupported platform` line.

21. [ ] [G2 #3] Send a message that uses a tool (e.g. "Read package.json and summarise it") and approve the permission.
    **Expected:** text streams, the tool row and its output render, the result arrives and the Stop button goes away.
    No `unknown option` or `process exited with code` errors in the Forge log.

22. [ ] [G2 #4] Resume an old session from the history dropdown. **Expected:** the history loads, and a new message continues it.

23. [ ] [G2 #5] Turn Thinking **off** in the "/" menu and send a message. **Expected:** the session starts and answers (the SDK
    now passes `--thinking disabled`).

24. [ ] [G2 #6] Ask for a 3-step todo list. **Expected:** if the model uses a todo tool, it's `TodoWrite` (a todo row), not
    `TaskCreate`.

25. [ ] [G2 #7] Set `"forge.cliArgs": { "model": "opus", "effort": "high", "print": true }` and start a session. **Expected:**
    - the log shows `! --model opus -- the SDK also emits it from model on this launch…`;
    - `+ --effort high (passthrough (SDK option effort is not set))`;
    - `x --print REJECTED`;
    - the session starts.

    Remove the setting afterwards.

### Group 3: the dispatcher, `open_claude_in_terminal` (steps 09–10)

> **Items 26–33 are paused, not unverified.** On 2026-09-28 (`a846d08`) the user paused "Open Forge in Terminal": the row is greyed
> with "(soon)" and does nothing, so these eight items cannot be run. They apply again only after `TERMINAL_AVAILABLE` in
> `src/webview/src/components/forge/terminalAvailability.ts` is set to `true`. Item 122 checks the paused state instead.

Source: [`03-dispatcher.md`](03-dispatcher.md), section "VS Code checklist for the user — **unverified**".

26. [ ] [G3 #1, paused] Open the Forge panel, press "/", choose **Open Forge in Terminal**.
    **Expected:** a terminal appears in the **bottom panel** (not beside the
    editor), named **Forge**, with the Forge logo as its icon, and an interactive
    `claude` session starts in it.

27. [ ] [G3 #2, paused] In that terminal, look at the command line that ran.
    **Expected:** the **absolute path** to
    `…/resources/native-binary/claude.exe`, not the bare word `claude`.
    On PowerShell it is prefixed with the call operator: `& 'C:\…\claude.exe'`.

28. [ ] [G3 #3, paused] Set `terminal.integrated.defaultProfile.windows` to **Command Prompt**,
    reload the window, repeat item 26.
    **Expected:** the command line is `"C:\…\claude.exe"` (double quotes, no `&`)
    and claude starts.

29. [ ] [G3 #4, paused] Set the same setting to **Git Bash**, reload, repeat item 26.
    **Expected:** the command line is `'C:\…\claude.exe'` (single quotes) and
    claude starts.

30. [ ] [G3 #5, paused] Exit claude cleanly (`/exit`, exit code 0) in a PowerShell or Git Bash
    terminal. **Expected:** the terminal closes itself. On Command Prompt it stays
    open — the command line starts with `"`, which the official's own rule
    excludes from auto-dispose.

31. [ ] [G3 #6, paused] Set `CLAUDE_CODE_TERMINAL_TITLE=Something` in the environment, restart VS Code,
    repeat item 26. **Expected:** the terminal is named `Something`.

32. [ ] [G3 #7, paused] Confirm no `cwd` override: with `terminal.integrated.cwd` set to a folder,
    repeat item 26. **Expected:** the terminal opens in that folder, because the
    handler passes no `cwd` of its own (matching the official).

33. [ ] [G3 #8, paused] Confirm the webview cannot launch anything else: there is no UI for it, but if
    you drive the webview console with
    `{type:"open_claude_in_terminal", args:["--dangerously-skip-permissions"]}`,
    **Expected:** an error response and **no terminal is created**.

### Group 4: model and permissions (steps 11–18)

Source: [`04-model-permissions.md`](04-model-permissions.md), section "VS Code checklist for the user (**unverified**: nothing here was observed in real VS Code or against the real CLI)".

**Settings writes and precedence (step 11)**

34. [ ] [G4 #1] Note `~/.claude/settings.json`. Pick an effort in the model menu. **Expected:**
    `"effortLevel"` is written, two-space indented with a trailing newline. Every
    other key is untouched.

35. [ ] [G4 #2] Create a profile with `"effortLevel": "low"` in `~/.claude/settings.<profile>.json`
    and switch to it. **Expected:** `~/.claude/forge.json` has **no** `effortLevel`,
    and the profile's other keys (e.g. `model`) are there.

36. [ ] [G4 #3] With that profile active, pick High and restart VS Code. **Expected:** effort is
    still High. The profile doesn't win.

**Models (step 12)**

37. [ ] [G4 #4] Open the model picker. **Expected:** the same models, order and descriptions as
    Claude Code's picker for the same account.

38. [ ] [G4 #5] On an account with a model excluded by data-retention settings: **Expected:** it's
    listed last, greyed, and clicking it does nothing.

39. [ ] [G4 #6] Pick Opus. **Expected:** `~/.claude/settings.json` has `"model": "opus"`, the next
    answer's `model` is `claude-opus-…`, and the pill reads "Opus 5".

40. [ ] [G4 #7] Pick Default. **Expected:** the `model` key is removed and the pill names the
    default model, not "Default". Reload: the picker ticks it.

41. [ ] [G4 #8] With Default selected, get a turn served by another model family. **Expected:**
    the pill and "/" → "Switch model…" name the model that answered.

**Effort and Ultracode (step 13)**

42. [ ] [G4 #9] Sonnet: open the model menu. **Expected:** 3 notches, no Ultracode notch.

43. [ ] [G4 #10] Pick Low. **Expected:** `"effortLevel": "low"` in the file. The output channel's
    `[Hook] PreToolUse: … (effort: low)` line and `/status` show low. After a reload
    the pill still shows Low.

44. [ ] [G4 #11] Opus → Max, send a turn. **Expected:** the hook line shows `effort: max`. After a
    reload the pill shows the model's default (the CLI ignores `max` in the file),
    as Claude Code does.

45. [ ] [G4 #12] Opus → the Ultracode notch. **Expected:** the pill reads "Opus 5 Ultracode". The
    file has `"effortLevel": "xhigh"` and **no** `ultracode` key. The hook line shows
    `effort: xhigh`. Then High: Ultracode is off.

46. [ ] [G4 #13] `"maxEffortLevel": "medium"` plus `"effortLevel": "high"`, reload. **Expected:**
    the pill shows Medium, and the hook line shows `effort: medium`.

47. [ ] [G4 #14] `"disableWorkflows": true`, reload, Opus. **Expected:** no Ultracode notch.

48. [ ] [G4 #15] Send `/effort low`. **Expected:** the pill shows Low when the turn ends.

49. [ ] [G4 #16] Haiku. **Expected:** no effort in the pill, and no Effort row in either menu.

**Thinking (step 14)**

50. [ ] [G4 #17] "/" → Thinking off, send a turn. **Expected:** no thinking block. The output
    channel shows `{"type":"disabled"}`. Reload: still off.

51. [ ] [G4 #18] Thinking on. **Expected:** a thinking block. With
    `"showThinkingSummaries": true` the thinking is summarized.

52. [ ] [G4 #19] Toggle Thinking at any effort, and pick efforts with Thinking on and off.
    **Expected:** neither changes the other, in the UI or in `settings.json`.

**Fast mode (step 15)**

53. [ ] [G4 #20, paused] Opus on an account with fast mode, "/". **Expected:** "Toggle fast mode" after
    Thinking. Clicking it closes the menu and runs `claude /fast` in a bottom-panel
    terminal (Forge's bundled binary). Sonnet or Haiku: no row.
    *Paused since 2026-09-28: the row is greyed "(soon)" and does nothing, so this cannot be run until
    `TERMINAL_AVAILABLE` is `true`. Item 122 checks the paused state.*

**Permission prompt and rules (step 16)**

54. [ ] [G4 #21] Ask Claude to run `npm test`. Set the destination link to "this project
    (shared)" and choose option 2. **Expected:** `<workspace>/.claude/settings.json`
    gains `Bash(npm test:*)` under `permissions.allow`, and the command runs again
    without a prompt.

55. [ ] [G4 #22] Repeat with "this session". **Expected:** no file changes. No prompt again in
    this session, but a prompt after a reload.

56. [ ] [G4 #23] "/" → Permissions. **Expected:** the rule from item 54 under Allow, "From shared
    project settings", with Remove. The session rule shows "Approved for this
    session only; not saved in a settings file."

57. [ ] [G4 #24] A profile with `"permissions": {"deny": ["Bash(rm -rf:*)"]}`: switch to it and
    open the dialog. **Expected:** the rule is under Deny, "From settings given at
    startup", with no Remove.

58. [ ] [G4 #25] Add rule… → Deny → `WebFetch(domain:example.com)` → all projects. **Expected:**
    it's in `~/.claude/settings.json` `permissions.deny`. Remove → Remove rule: it's gone.

59. [ ] [G4 #26] Add `Bash(*)`. **Expected:** the yellow note says it was saved as the tool-wide
    rule "Bash".

60. [ ] [G4 #27] Answer a prompt with plain "Yes". **Expected:** no settings file changes.

**Plan mode (step 17)**

61. [ ] [G4 #28] In Plan mode, get a plan. **Expected:** a tab named after the plan's heading
    opens beside the chat with "Ready for review". The prompt reads "Accept this plan?".

62. [ ] [G4 #29] Select text in the tab → Add Comment → Enter. **Expected:** it's highlighted with
    "1". The prompt shows "Comments (1)" and only "1 Send feedback and keep planning".
    Click it: Claude keeps planning with the comment, and the mode stays Plan.

63. [ ] [G4 #30] Next plan → "Yes, and auto-accept". **Expected:** the tab closes, the mode is Edit
    automatically, and Claude edits without asking. "Yes, and manually approve edits"
    → Manual. "No, keep planning" → still Plan, tab open.

64. [ ] [G4 #31] A Bash prompt while in Plan. **Expected:** "Yes / No", with no plan wording.

**Kept permission modes (step 18)**

65. [ ] [G4 #32] Session A: Edit automatically, send a message. Session B: Plan. Reload the window
    and reopen each. **Expected:** A opens in Edit automatically and its edits aren't
    prompted. B opens in Manual (Plan is never kept).

66. [ ] [G4 #33] **Expected on disk:** Forge's globalState holds
    `sessionPermissionMode:<A's id>` = `{"mode":"acceptEdits", …}` and nothing for B.

67. [ ] [G4 #34] Settings › General › Default Permission Mode → Accept Edits, then New
    conversation. **Expected:** it shows Edit automatically.

68. [ ] [G4 #35] A → Manual, reload, reopen A. **Expected:** Manual.

### Group 5: conversations (steps 20–26)

Source: [`05-conversations.md`](05-conversations.md), section "VS Code checklist for steps 20–26 — **all unverified**".

**Rename, archive, unread, search (20–23)**

69. [ ] [G5 #1] Rename a conversation in "Past conversations". **Expected:** the title
    changes in the list, and `~/.claude/projects/<project>/<id>.jsonl` gains a
    `custom-title` line.

70. [ ] [G5 #2] Archive it, then unarchive it. **Expected:** it moves into and out of the
    Archived section, and survives a window reload both ways.

71. [ ] [G5 #3] Send a prompt, hide the Forge view before the turn ends, then show it again.
    **Expected:** the row carried an unread dot, and showing the view cleared it.

72. [ ] [G5 #4] Click the envelope on a row. **Expected:** a dot appears, the title flips to
    "Mark as read", the dropdown stays open, and the dot survives a reload.

73. [ ] [G5 #5] Open the same repo from a `.claude/worktrees/<name>` checkout. **Expected:**
    the same unread list — `A7$` strips the worktree segment.

74. [ ] [G5 #6] Type part of a branch name that is in no title. **Expected:** that branch's
    conversations stay listed, with no highlight on their titles.

**Rewind (24)**

75. [ ] [G5 #7] Ask Claude to edit `a.txt` and let it finish. Run "/" → Rewind, pick the
    message before that edit. **Expected:** the dialog names `a.txt` **relative
    to the workspace root**, with counts matching the edit.

76. [ ] [G5 #8] Confirm. **Expected:** `a.txt` is back to its previous content **on disk**,
    and a one-line "Code rewind successful" note appears in the transcript.

77. [ ] [G5 #9] Repeat where a tracked file is a symlink. **Expected:** "Code rewind
    completed, but 1 file was skipped: the tracked path is (or became) a link…",
    and a warning notification saying the same.

78. [ ] [G5 #10] Check disk use on a large repo after a long session. **Expected:**
    checkpoint backups exist. That is the price of always-on checkpointing, and
    the moment to ask for a setting if it is too high.

**The uuid and replay change (24) — most worth checking by hand**

79. [ ] [G5 #11] Send a prompt in a live session. **Expected:** it appears **once**. If you
    ever see a prompt doubled, that is this change, and
    `--replay-user-messages` in `forgeBaseCliArgs` is the thing to remove.

80. [ ] [G5 #12] Close a conversation, reopen it from "Past conversations", and run "/" →
    Rewind. **Expected:** every past prompt is listed. Before this group the
    list would have been empty — the loader threw the uuids away.

81. [ ] [G5 #13] Trigger a message the webview did not send (a `UserPromptSubmit` hook, or
    queue a prompt while a turn runs). **Expected:** it now appears in the
    transcript. Its **position** may differ from the official's, which inserts
    it at the replay index while Forge appends it — the one piece deliberately
    not ported.

**Fork and Message actions (25)**

82. [ ] [G5 #14] Hover the **second** user message and click the button at its top-right.
    **Expected:** three options.

83. [ ] [G5 #15] "Fork conversation from here". **Expected:** a new conversation holding
    history up to the message **before** the one picked, that message's text in
    the composer, the original unchanged on disk, and a new `.jsonl` named for
    the new session id.

84. [ ] [G5 #16] Open "Past conversations". **Expected:** the fork is listed as
    `<original> (fork)` — the SDK derives that when no title is passed.

85. [ ] [G5 #17] "Fork conversation and rewind code" on a message after a file edit.
    **Expected:** the dialog is titled "Fork and rewind"; confirming restores
    the files **and then** opens the fork.

86. [ ] [G5 #18] Make the rewind fail (pick a message with no checkpoint — anything from
    before this build, since checkpointing only started in step 24).
    **Expected:** an error, and **no fork is created**. That ordering is the
    single most valuable thing on this list.

87. [ ] [G5 #19] Hover the **first** user message and fork from it. **Expected:** a brand-new
    empty conversation seeded with that prompt, not a fork.

**Resume (26)**

88. [ ] [G5 #20] Type `/` then `resume` in the command filter and choose the row.
    **Expected:** past conversations open in the dropdown under the header.

89. [ ] [G5 #21] Open the "/" menu without typing. **Expected:** "Resume conversation" is
    **not** listed (it is `filterOnly`), while "Rewind" is.

### Group 6: browser and views (steps 28–33)

Source: [`06-browser-views.md`](06-browser-views.md), section "VS Code checklist for the user (unverified until you run it)".

**@browser tabs (step 28)**

90. [ ] [G6 #1] Open Forge in a workspace. **Expected:** "+" shows three rows, the third "Browse the web" with a globe icon.

91. [ ] [G6 #2] Click it with **no** Claude in Chrome extension installed. **Expected:** a VS Code notification, *"Claude in
    Chrome: Install the browser extension to control Chrome from Claude Code"*, with **Install Extension** and
    **Don't Show Again**. Install Extension opens `https://claude.ai/chrome`.

92. [ ] [G6 #3] Click **Don't Show Again**, then repeat item 91. **Expected:** no notification the second time
    (`globalState["chromeExtensionNotificationDismissed"]`).

93. [ ] [G6 #4] With the extension installed and Chrome running, click "+" → Browse the web. **Expected:** the `@` dropdown
    lists your real open tabs as `browser:<Tab_Title>` plus a `browser:new_tab` row.

94. [ ] [G6 #5] Pick a tab, type "summarise this page" and send. **Expected:** the CLI gains the `mcp__claude-in-chrome__*`
    tools, and Claude reads that tab.

95. [ ] [G6 #6] Send `@browser:new_tab open example.com`. **Expected:** a **new Chrome tab** opens and Claude navigates it.

96. [ ] [G6 #7] Check the Forge output channel for `Chrome MCP: Connecting to server with command: <claude binary>
    --claude-in-chrome-mcp` and `Chrome MCP: Successfully connected to server`. **Expected:** both lines, and the
    binary path is the one Forge launches sessions with.

97. [ ] [G6 #8] If item 94 or 95 fails with a handshake error, the `forge-vscode-chrome-mcp-client` `clientInfo` is the thing to
    change back to the official's (step 28's scope table). **Expected:** no handshake error.

**Output styles (step 29)**

98. [ ] [G6 #9] Open a conversation, press "/", choose **Output styles**. **Expected:** the menu closes and a popup opens above
    the composer listing the styles the CLI knows (at least `default`), with a tick on the current one.

99. [ ] [G6 #10] Pick a style other than the current one. **Expected:** `.claude/settings.local.json` in the project gains
    `"outputStyle": "<name>"`, and the next reply follows that style.

100. [ ] [G6 #11] Re-open "/" → Output styles. **Expected:** the tick is on the style picked in item 99.

101. [ ] [G6 #12] "/" → Output styles → **Build a custom style ›**, name it `Diagrams first`, leave the description blank, give it
     one line of instructions, keep "Include the coding instructions" on, choose **Project**, keep "Switch to this
     style now" on, press **Save**. **Expected:** `.claude/output-styles/Diagrams first.md` exists with front matter
     `name: Diagrams first` and `keep-coding-instructions: true`; `.claude/settings.local.json` now says
     `"outputStyle": "Diagrams first"`; and the style appears in the picker.

102. [ ] [G6 #13] Repeat item 101 with the same name. **Expected:** "A style file named Diagrams first.md already exists here."
     and the button reads **Replace**. Press **Replace**: the file's instructions are the new ones, and no `.tmp`
     file is left in the folder.

103. [ ] [G6 #14] Try to name a style `../escape` or `a/b`. **Expected:** "A name can't contain / \ : * ? " < > | or ---",
     **Next** does not advance, and nothing is written anywhere.

**Focus view (step 30)**

104. [ ] [G6 #15] "/" → **Focus view**. **Expected:** the toggle turns on and the menu stays open; the transcript immediately shows
     only your prompts and Forge's replies, with a row like "3 tool calls" where the work was.

105. [ ] [G6 #16] Close and reopen the panel (or reload the window). **Expected:** focus view is still on, and `focusView: true`
     is in Forge's extension config file.

106. [ ] [G6 #17] With focus view on, ask for something that runs a tool. **Expected:** while it runs, the fold row reads
     "Running `<Tool>`…" in a pulsing label with a progress dot and is **open** so you can watch it; when it finishes
     it collapses to the summary. *(The harness could not hold this state; please check it.)*

107. [ ] [G6 #18] Trigger a permission prompt with focus view on. **Expected:** the fold holding that tool call is forced open, and
     the row reads "Waiting for permission…".

108. [ ] [G6 #19] Click a fold row, then the "Collapse" row beneath it. **Expected:** it expands and collapses.

109. [ ] [G6 #20] Turn focus view off. **Expected:** the whole transcript returns, and `focusView: false` is written.

110. [ ] [G6 #21] With a session running, check what the CLI itself reports. **Expected:** the `viewMode` flag setting is `focus`
     while the toggle is on and cleared when it is off (`'default' | 'verbose' | 'focus'`, `sdk.d.ts` L8167).

**Settings tabs (step 31)**

111. [ ] [G6 #22] "/" → **MCP servers**. **Expected:** the menu closes and Forge Settings opens on the **MCP Servers** tab.

112. [ ] [G6 #23] Without closing Settings, go back to the chat and run "/" → **Hooks**. **Expected:** the *same* Settings tab is
     revealed and switches to **Hooks**, not a second panel.

113. [ ] [G6 #24] Repeat with **Manage plugins** and **Slash commands**. **Expected:** Plugins and Slash Commands respectively.

114. [ ] [G6 #25] "/" → **Permissions**. **Expected:** the "Permission rules" dialog, not Settings (step 16's behaviour).

115. [ ] [G6 #26] From the command palette, run **Forge: Open Settings**. **Expected:** Settings opens on **General**.

**Typed config and help (steps 32, 33)**

116. [ ] [G6 #27] "/" → **General config…**. **Expected:** the menu closes and VS Code's Settings open, filtered to `forge`, in the
     first editor group.

117. [ ] [G6 #28] "/" → **View help docs**. **Expected (current behaviour, replacing step 32's):** the menu closes and **Forge
     Settings opens on the Guide tab**. No browser opens and nothing leaves the machine.

118. [ ] [G6 #29] Open "/" and look at the bottom row. **Expected:** the version (`v0.1.x`) and nothing else, with no "Report a
     problem".

119. [ ] [G6 #30] Command palette → **Forge: Show Logs**. **Expected:** the Forge output channel opens.

120. [ ] [G6 #31] Settings → Endpoints, click each of the seven buttons. **Expected:** Select… a picker; Add… the five questions;
     Open settings.json at `forge.endpoints`; Run the diagnostics ladder; Probe the capability sweep; List the model
     picker; Show the output channel.

121. [ ] [G6 #32] Settings → MCP Servers → the global and project config buttons. **Expected:** they still open their JSON files.

**Paused rows**

122. [ ] [G6 #33] "/" → **Open Forge in Terminal** and **Toggle fast mode** (on a model with fast mode). **Expected:** both are
     greyed with "(soon)", choosing either does nothing, and no terminal opens. This replaces the old checklist
     items for opening a terminal; they apply again only after `TERMINAL_AVAILABLE` is set to `true`.

