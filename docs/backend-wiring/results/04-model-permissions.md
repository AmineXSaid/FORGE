# Group 4 report: model and permissions (steps 11–18)

Checkpoint for step 19. It covers `apply_settings`, model metadata, effort and Ultracode,
the thinking toggle, the fast-mode row, the permission prompt's option 2 and the
"Permission rules" dialog, the plan-mode labels and plan preview, and each
conversation's kept permission mode. Every row below was clicked in the ui-parity
harness (the real built webview against the stub host) unless it says "spec". The
per-step files have the full detail. This file repeats every row, re-measures every
window on the branch tip, and merges the VS Code checklists.

| Step | Subject | Commit | Rows (works / partial / broken / left out) | Per-step results |
| --- | --- | --- | --- | --- |
| 11 | `apply_settings` whitelist and precedence | `e7e431c` | 15 / 0 / 0 / 4 | [11-apply-settings.md](11-apply-settings.md) |
| 12 | Model metadata | `1cb03a6` | 12 / 0 / 0 / 0 | [12-model-metadata.md](12-model-metadata.md) |
| 13 | Effort end to end, and Ultracode (scope: `775dba3`) | `926674a` | 23 / 0 / 0 / 1 | [13-effort.md](13-effort.md) |
| 14 | Thinking toggle | `7144c35` | 10 / 0 / 0 / 0 | [14-thinking-toggle.md](14-thinking-toggle.md) |
| 15 | "Toggle fast mode" row | `785f977` | 4 / 0 / 0 / 0 | [15-fast-mode-row.md](15-fast-mode-row.md) |
| 16 | Permission option 2, save destination, "Permission rules" dialog | `78985a3` | 18 / 0 / 0 / 0 | [16-permission-destination.md](16-permission-destination.md) |
| 17 | Plan-mode labels, plan answers, plan preview | `de951fd` | 17 / 0 / 0 / 2 | [17-plan-mode-labels.md](17-plan-mode-labels.md) |
| — | The user's design requests (send arrow, model menu, placeholder, header order) | `0637636` | — | [../../forge-design.md](../../forge-design.md) |
| 18 | `persist_session_permission_mode` | `5e5a562` | 11 / 0 / 0 / 2 | [18-persist-session-permission-mode.md](18-persist-session-permission-mode.md) |

**Counts, steps 11–18:** works 110 · partial 0 · broken 0 · left out 9 (listed below).

Step 11's four "left out" keys have since changed: `ultracode` came into scope
(`775dba3`, flags layer only, step 13); `outputStyle` is step 29; `switchModelsOnFlag`
and `remoteControlAtStartup` stay out.

## Click-through on the branch tip (`5e5a562`), with menu behaviour

Run for this checkpoint on the final build. Whether each menu stays open after a row
is clicked is recorded here, as step 19 asks.

| Window → row | Request sent | Host / stub result | UI effect | Menu after the click | Verdict |
| --- | --- | --- | --- | --- | --- |
| "/" → Effort (Sonnet, Medium) | `{type:"apply_settings", settings:{effortLevel:"high"}}` | `apply_settings_response` | row **Effort(High)** | **stays open** | works |
| "/" → Thinking | `{type:"set_thinking_level", thinkingLevel:"off"}` (then back to `default_on`) | `set_thinking_level_response` | switch off; Effort still (High) | **stays open** | works |
| "/" → Switch model… | nothing | — | the "/" menu becomes the model menu | replaced by the model menu | works |
| model menu → greyed "Opus (1M context)" | nothing | — | nothing | **stays open** | works |
| model menu → Opus | `{type:"set_model", model:{value:"opus", …}}` | `set_model_response` | pill Opus 5 | **closes** | works |
| model menu (Opus) → Effort row | `apply_settings {effortLevel:"xhigh"}` | answered | High → Extra high | **stays open** | works |
| "/" (Opus) → Toggle fast mode | `{type:"open_claude_in_terminal", prompt:"/fast", args:[], location:"bottom"}` | `open_claude_in_terminal_response` | — | **closes** | works |
| model menu → Haiku | `set_model {value:"haiku"}` | answered | no effort anywhere; "/" has no Effort or fast-mode row | **closes** | works |
| "/" → Permissions | `{type:"list_permission_rules"}` on the session channel | the stub's rules | the "Permission rules" dialog | **closes** (dialog opens) | works |
| Modes → Bypass permissions (bypass not allowed) | `set_permission_mode {mode:"bypassPermissions", userInitiated:true}` | `success:false` | stays **Manual** | **closes** | works |
| Modes → Edit automatically / Plan / Manual (step 18 run) | `set_permission_mode {…, userInitiated:true}` (+ `persist_session_permission_mode` on a listed session) | `success:true` | footer follows | **closes** | works |
| Bash prompt, 1 rule → 2 "Yes, allow npm test for this project (just you)" | answer `{behavior:"allow", updatedInput, updatedPermissions:[{type:"addRules", rules:[{toolName:"Bash", ruleContent:"npm test:*"}], behavior:"allow", destination:"localSettings"}]}` | stub CLI stores `Bash(npm test:*)` (localSettings) | prompt closes | — | works |
| Bash prompt → 3 "No" | `{behavior:"deny", message:<AS>, interrupt:true}` | — | prompt closes | — | works |
| Bash prompt, Escape | `{behavior:"deny", …}` | — | prompt closes | — | works |
| Bash prompt, no suggestions → key "1" | `{behavior:"allow", updatedInput, updatedPermissions:[]}` | — | two buttons "1 Yes / 2 No"; closes | — | works |
| ExitPlanMode prompt | `open_markdown_preview {title:"Refactor the settings loader", enableComments:true}` | preview opened | "1 Yes, and auto-accept / 2 Yes, and manually approve edits / 3 No, keep planning" | — | works |
| 2 plan comments → "Send feedback and keep planning" (JS `.click()`: the Browser pane's pointer events missed the button, see note) | `remove_plan_comment` ×2, then `{behavior:"deny", message:"User chose to stay in plan mode…\n\nComments on the plan:\n[Re: …] …", interrupt:false}` | — | prompt closes; preview stays open | — | works |
| ExitPlanMode → "Yes, and auto-accept" (JS `.click()`) | `set_permission_mode {mode:"acceptEdits", userInitiated:false}`, `close_plan_preview`, then the allow answer | preview closed | footer **Edit automatically**; **no** `persist_session_permission_mode` (a prompt answer is not kept, as the official) | — | works |

Note on the two JS clicks. At that point the pane was 266×298 CSS px. Measuring
under an emulated 800×900 viewport, a coordinate click was drawn from a stale frame
and missed. The button's own `click` handler ran instead: the same handler a
pointer click runs. The same buttons were pointer-clicked in step 17.

## All rows, steps 11–18

### Step 11: `apply_settings` (15 works)
| Row | Request | Verdict |
| --- | --- | --- |
| accept `effortLevel` high / low / xhigh | `{settings:{effortLevel:…}}` → written to `~/.claude/settings.json`, then `applyFlagSettings` | works |
| accept empty patch | `{settings:{}}` | works |
| accept `effortLevel:null` | deletes the key (step 13 later matched the official: `null` is refused, see step 13) | works |
| reject 2 layers in one patch | `{effortLevel, ultracode}` → error, nothing written | works |
| reject `ultracode` to user settings, `switchModelsOnFlag`, `remoteControlAtStartup`, `outputStyle`, `apiKeyHelper` | error naming the key | works |
| reject wrong type | `{effortLevel:42}` | works |
| reject wrong layer | `effortLevel` with `flagsOnly` / `scope:"localSettings"` | works |
| reject contradictory | `flagsOnly` + `localSettings` | works |
| B6: the forge.json profile no longer pins `effortLevel` | spec | works |

### Step 12: model metadata (12 works)
| Row | Request | Verdict |
| --- | --- | --- |
| model list in the CLI's order, all `ModelInfo` fields | `get_claude_state` (`initializationResult()`) | works |
| greyed row: nothing sent, menu stays open | — | works |
| promo price struck through | — | works |
| pick Opus | `set_model {model:<row>}` → `"model":"opus"` + `applyFlagSettings` | works |
| pick Default | `set_model` → `model` cleared; pill names the resolved model | works |
| served-model pill | assistant `model` → pill and "Switch model…" trailing text | works |
| reject 4 malformed `set_model` | error | works |
| accept unlisted value | `set_model_response` (official) | works |
| failure revert | spec | works (spec) |

### Step 13: effort and Ultracode (23 works, 1 left out)
| Row | Request | Verdict |
| --- | --- | --- |
| startup seed from `applied.effort` | — | works |
| model menu slider, row cycle, notches (Sonnet 3, Opus 6 with Ultracode) | `apply_settings {effortLevel}`; stays open | works |
| Opus Max | `{effortLevel:"max"}` | works |
| Ultracode notch | `{effortLevel:"xhigh"}` then `{ultracode:true}, flagsOnly:true` | works |
| leave Ultracode | `{ultracode:null}, flagsOnly:true` then the level | works |
| downgrade on model switch | `set_model` → `applied.effort` shown | works |
| Haiku: no effort in pill, model menu or "/" | — | works |
| "/" Effort row on Opus → Ultracode | as above | works |
| `/effort low` re-read at turn end | `get_applied_settings` | works |
| welcome card with / without "Try Ultracode" | as above | works |
| accept / reject `ultracode` and `effortLevel` payloads (8 rows) | in-band errors as the official | works |
| `get_applied_settings` | `{applied:{model, effort, advisor, ultracode}}` | works |

### Step 14: thinking (10 works)
| Row | Request | Verdict |
| --- | --- | --- |
| launch with the stored level | `Options.thinking {enabled, 31999}` | works (spec + log) |
| "/" Thinking off / on | `set_thinking_level {off / default_on}` → `setMaxThinkingTokens(0 / 31999, null)`, stored; stays open | works |
| effort picks leave thinking alone (on and off) | `apply_settings` only | works |
| summaries | `setMaxThinkingTokens(31999, "summarized")` | works (spec) |
| reject bad levels, unknown channel | error; nothing stored | works |
| reload keeps the level | `init.thinkingLevel` | works (spec) |

### Step 15: fast mode (4 works)
| Row | Request | Verdict |
| --- | --- | --- |
| no row on Sonnet / Haiku | — | works |
| row on Opus, with tooltip | — | works |
| click | `open_claude_in_terminal {prompt:"/fast", args:[], location:"bottom"}`; closes | works |

### Step 16: permission option 2 and the rules dialog (18 works)
| Row | Request | Verdict |
| --- | --- | --- |
| prompt with a rule: option 2 label, destination link, hint, 500 ms guard | `tool_permission_request` (+ `defaultToNo`, `suppressAlwaysAllowRule`, `toolUseId`, `agentId`) | works |
| destination link cycles 4 destinations, remembered | nothing sent | works |
| ←/→ on option 2 | nothing sent | works |
| option 2 with "this project (shared)" | `addRules … destination:"projectSettings"` | works |
| option 2 `setMode acceptEdits` | `setMode … destination:"session"`, no `set_permission_mode` | works |
| Yes / No | allow with `[]` / deny with the official text | works |
| label variants (rules, directories, modes, none) | — | works |
| `suppressAlwaysAllowRule`, `defaultToNo`, keys | — | works |
| "/" → Permissions | `list_permission_rules`; closes; dialog | works |
| forge.json rule read-only (B6) | `flagSettings`, `readonly` | works |
| Add rule…, CLI warning / pending, duplicate | `add_permission_rules` | works |
| Remove → confirm | `remove_permission_rule` | works |
| 12 malformed add/remove | in-band `invalid request` | works |
| close by Escape / overlay | — | works |

### Step 17: plan mode (17 works, 2 left out)
| Row | Request | Verdict |
| --- | --- | --- |
| Modes → Plan | `set_permission_mode {plan, userInitiated:true}` → `success` | works |
| Bash prompt while in Plan: no plan labels | — | works |
| ExitPlanMode prompt (in Plan and in Manual) | `open_markdown_preview` | works |
| Yes, and auto-accept | `set_permission_mode {acceptEdits, false}`, `close_plan_preview`, allow | works |
| Yes, and manually approve edits | allow + `setMode default` (session) | works |
| No, keep planning / typed reason | deny with `_61` / `wM` text | works |
| plan comments arrive, × removes, send feedback | `plan_comment`, `remove_plan_comment`, deny with comments | works |
| preview page: ready, select → comment, host remove, hostile HTML | panel messages | works |
| a prompt on a channel nobody shows | — | works |
| rejections | in-band `success:false`, errors | works |

### Step 18: kept permission modes (11 works, 2 left out)
| Row | Request | Verdict |
| --- | --- | --- |
| Edit automatically in listed session A | `set_permission_mode`, then `persist_session_permission_mode {A, acceptEdits}` → stored | works |
| Plan in B | `persist {B, plan}` first (lowers privilege) → cleared | works |
| switch A → B → A | none | works |
| reload, reopen A / B | list carries `permissionMode`; `launch_claude {permissionMode:"acceptEdits"}` / `"default"` | works |
| init with the same id | nothing | works |
| new conversation: kept once the CLI names it | `persist {<new id>, acceptEdits}` | works |
| back to Manual | `persist {A, default}` | works |
| the CLI replaces the id | `persist {<new>, mode, previousSessionId:A, carriedFromStore:true}` → moved | works |
| "Default Permission Mode" → Plan | `init` re-read; new conversation starts in Plan | works |
| rejections | ids, modes, bypass gate, `carriedFromStore` | works (spec) |

## Oracle on every window, branch tip

Measured with `probe-oracle.js` (and `probe-planpreview.js` for the preview page)
on the step 18 build. The pane was 674×698, later 266×298 CSS px. Every window that
can reach a viewport-relative limit was re-measured under an emulated 800×900.

| Window (root selector) | Result | Note |
| --- | --- | --- |
| `.fg-commandmenu__menuPopup`, "/" menu, Sonnet | **0**, 79/79 | = baseline |
| `.fg-commandmenu__menuPopup`, "/" menu, Opus (fast-mode row) | **0**, 85/85 | = baseline |
| `.fg-commandmenu__menuPopup`, "/" menu, Haiku (no Effort, no fast row) | **0**, 68/68 | new state measured |
| `.fg-commandmenu__menuPopup`, model menu, Sonnet | 53/73 | **by design** (`0637636`): the only diffs are Forge's capability chips (no official twin) and the current model's name at weight 600. With the chips hidden it's also 53/73, and every official element is clean: popup, list, rows, divider, effort label and glyph |
| same, Opus | 56/76 | by design, as above |
| same, Haiku | 37/57 | by design, as above |
| `.fg-menu__menuPopup`, Modes menu | **0**, 41/41 | = baseline (a first read mid-entrance showed the popup at `opacity: 0`; re-read clean) |
| `.fg-permission__permissionRequestContainer`, Bash with 1 rule | **0**, 30/30 | = step 16 (the first read right after mount shows `pre.inputJson width 0`; re-read clean) |
| same, no suggestions | **0**, 25/25 | = step 16 base |
| same, ExitPlanMode | **0**, 20/20 at 800×900 | at a 298px-tall pane: 17/20, the container's `max-height: 70vh` resolving 0.56px apart because the probe's iframe takes the integer `innerHeight` while the live viewport is 297.6px at DPR 1.25. A harness artifact; clean at 800×900 |
| same, plan with 2 comments | **0**, 28/28 at 800×900 | the same 3 artifacts at 298px |
| "Permission rules" dialog `.fg-dialog__overlay` | **0**, 68/68 at 800×900 | at 674px: `.fg-dialog__dialog` 61/61, overlay 61/62 (its own width 658.4 vs 659.2, a fixed full-viewport box at a fractional width; as in step 17) |
| plan preview page (`probe-planpreview.js`) | **0**, 29/29 · with the comment UI **0**, 36/36 | = step 17 |
| `.fg-composer__inputWrapper` (idle) | 30/33 (Sonnet), 28/31 (Haiku) | = design baseline: the three sparks' opacity (`docs/forge-design.md`) |
| `.fg-shell__header` | **0**, 15/15 | = baseline |
| `.fg-markdown__root` (one-code-block message) | **1**, 8/9 | the known `codeBlockWrapper pre` font-family artifact |

**Structural diffs on official elements:** 0 in every window except three.
The model menu's current-model name is at weight 600, and the composer's sparks are at
opacity 0.35 (both Forge design decisions, recorded in `docs/forge-design.md`). The
markdown `pre` font artifact is known. Colour differs by design everywhere (purple).

## Gates at the tip

- `pnpm test`: `Test Files 21 passed (21) · Tests 472 passed (472)`
- `pnpm run typecheck:all`: both silent
- `pnpm run build`: exit 0 (brand, tokens and commands clean; see step 18)

## Rows deliberately left out, and why

| Row / feature | Step | Reason |
| --- | --- | --- |
| `switchModelsOnFlag` ("Switch models when a message is flagged") | 11 | gated by Anthropic experiment flags Forge never receives (`CLAUDE.md`) |
| `remoteControlAtStartup` | 11 | out of scope: account and cloud |
| `outputStyle` | 11 | in scope, step 29 |
| The Modes menu's effort row | 13 | the user decided to keep it out (effort lives in the model menu) |
| AskUserQuestion's branch of the prompt (`q`: "Submit answers") | 17 | Forge has no question form; switching labels would make the prompt unanswerable |
| `MW0`'s notification and Edit/Write diff branches | 17 | separate features (notifications, diff panel) |
| Auto mode (row, kept mode, initial mode) | 17, 18 | the user decided to keep Auto out |
| `persistDefaultPermissionMode` | 18 | unreachable: Forge's "Default Permission Mode" is always set, and the official never reads the remembered pick while its setting is set |
| Heuristic session-id adoption | 18 | Forge has no panel-tab restore across reloads |

Out of scope for the whole project (unchanged, `out-of-scope.md`):

| Feature | Official requests / ids | UI kept out | Reason |
| --- | --- | --- | --- |
| Microphone / speech-to-text | `start_speech_to_text`, `stop_speech_to_text` | the mic button | out of scope |
| Login / Switch account | `login`, `get_auth_status`, `submit_oauth_code` | the `login` row | account and cloud |
| Account & usage | `get_usage`, `open_account_usage` | `account-usage`, `usage` | account and cloud |
| Usage / context meter | `get_context_usage`, `request_usage_update` | footer meter, `context` | account and cloud |
| Remote Control | `toggle_remote_control`, `remoteControlAtStartup`, `/remote-control` | its rows | account and cloud |
| Feedback | `submit_feedback`, `/feedback`, `/bug`, "Report a problem" | those rows (step 33 removes the button) | account and cloud |
| Thumbs rating | `message_rated` | the thumbs | out of scope |
| Switch models when flagged | `switchModelsOnFlag` | its row | experiment-gated |
| Side question | `/btw`, `side_question` | its row | out of scope |

## Open issues carried forward

1. `CLAUDE.md`'s scope list still says the "/" Permissions row "must open the matching
   Settings tab". Since step 16 (user decision) it opens the official "Permission
   rules" dialog. Step 31 must not revert that.
2. `~/.forge.json` gains every default key on the first settings write, so "unset
   (let the CLI decide)" can't exist for Default Permission Mode (step 18). That's a
   Settings-page change, for step 31.
3. From group 3: `handleGetAssetUris` derives `extensionPath` from `process.cwd()`;
   the mock host acks unknown requests without `success`.
4. Forge's AskUserQuestion prompt is still the generic "Yes / No" (step 17).
5. Nothing from steps 12–18 is in the user's installed VS Code build
   (`~/.vscode/extensions/msaid.forge-0.1.0`, built 2026-09-18 17:24). None of the
   checklist below has been run.

## VS Code checklist for the user (**unverified**: nothing here was observed in real VS Code or against the real CLI)

Install a build of this branch first (`pnpm run package`, then install the `.vsix`
and reload the window).

**Settings writes and precedence (step 11)**
1. Note `~/.claude/settings.json`. Pick an effort in the model menu. **Expected:**
   `"effortLevel"` is written, two-space indented with a trailing newline. Every
   other key is untouched.
2. Create a profile with `"effortLevel": "low"` in `~/.claude/settings.<profile>.json`
   and switch to it. **Expected:** `~/.claude/forge.json` has **no** `effortLevel`,
   and the profile's other keys (e.g. `model`) are there.
3. With that profile active, pick High and restart VS Code. **Expected:** effort is
   still High. The profile doesn't win.

**Models (step 12)**
4. Open the model picker. **Expected:** the same models, order and descriptions as
   Claude Code's picker for the same account.
5. On an account with a model excluded by data-retention settings: **Expected:** it's
   listed last, greyed, and clicking it does nothing.
6. Pick Opus. **Expected:** `~/.claude/settings.json` has `"model": "opus"`, the next
   answer's `model` is `claude-opus-…`, and the pill reads "Opus 5".
7. Pick Default. **Expected:** the `model` key is removed and the pill names the
   default model, not "Default". Reload: the picker ticks it.
8. With Default selected, get a turn served by another model family. **Expected:**
   the pill and "/" → "Switch model…" name the model that answered.

**Effort and Ultracode (step 13)**
9. Sonnet: open the model menu. **Expected:** 3 notches, no Ultracode notch.
10. Pick Low. **Expected:** `"effortLevel": "low"` in the file. The output channel's
    `[Hook] PreToolUse: … (effort: low)` line and `/status` show low. After a reload
    the pill still shows Low.
11. Opus → Max, send a turn. **Expected:** the hook line shows `effort: max`. After a
    reload the pill shows the model's default (the CLI ignores `max` in the file),
    as Claude Code does.
12. Opus → the Ultracode notch. **Expected:** the pill reads "Opus 5 Ultracode". The
    file has `"effortLevel": "xhigh"` and **no** `ultracode` key. The hook line shows
    `effort: xhigh`. Then High: Ultracode is off.
13. `"maxEffortLevel": "medium"` plus `"effortLevel": "high"`, reload. **Expected:**
    the pill shows Medium, and the hook line shows `effort: medium`.
14. `"disableWorkflows": true`, reload, Opus. **Expected:** no Ultracode notch.
15. Send `/effort low`. **Expected:** the pill shows Low when the turn ends.
16. Haiku. **Expected:** no effort in the pill, and no Effort row in either menu.

**Thinking (step 14)**
17. "/" → Thinking off, send a turn. **Expected:** no thinking block. The output
    channel shows `{"type":"disabled"}`. Reload: still off.
18. Thinking on. **Expected:** a thinking block. With
    `"showThinkingSummaries": true` the thinking is summarized.
19. Toggle Thinking at any effort, and pick efforts with Thinking on and off.
    **Expected:** neither changes the other, in the UI or in `settings.json`.

**Fast mode (step 15)**
20. Opus on an account with fast mode, "/". **Expected:** "Toggle fast mode" after
    Thinking. Clicking it closes the menu and runs `claude /fast` in a bottom-panel
    terminal (Forge's bundled binary). Sonnet or Haiku: no row.

**Permission prompt and rules (step 16)**
21. Ask Claude to run `npm test`. Set the destination link to "this project
    (shared)" and choose option 2. **Expected:** `<workspace>/.claude/settings.json`
    gains `Bash(npm test:*)` under `permissions.allow`, and the command runs again
    without a prompt.
22. Repeat with "this session". **Expected:** no file changes. No prompt again in
    this session, but a prompt after a reload.
23. "/" → Permissions. **Expected:** the rule from 21 under Allow, "From shared
    project settings", with Remove. The session rule shows "Approved for this
    session only; not saved in a settings file."
24. A profile with `"permissions": {"deny": ["Bash(rm -rf:*)"]}`: switch to it and
    open the dialog. **Expected:** the rule is under Deny, "From settings given at
    startup", with no Remove.
25. Add rule… → Deny → `WebFetch(domain:example.com)` → all projects. **Expected:**
    it's in `~/.claude/settings.json` `permissions.deny`. Remove → Remove rule: it's gone.
26. Add `Bash(*)`. **Expected:** the yellow note says it was saved as the tool-wide
    rule "Bash".
27. Answer a prompt with plain "Yes". **Expected:** no settings file changes.

**Plan mode (step 17)**
28. In Plan mode, get a plan. **Expected:** a tab named after the plan's heading
    opens beside the chat with "Ready for review". The prompt reads "Accept this plan?".
29. Select text in the tab → Add Comment → Enter. **Expected:** it's highlighted with
    "1". The prompt shows "Comments (1)" and only "1 Send feedback and keep planning".
    Click it: Claude keeps planning with the comment, and the mode stays Plan.
30. Next plan → "Yes, and auto-accept". **Expected:** the tab closes, the mode is Edit
    automatically, and Claude edits without asking. "Yes, and manually approve edits"
    → Manual. "No, keep planning" → still Plan, tab open.
31. A Bash prompt while in Plan. **Expected:** "Yes / No", with no plan wording.

**Kept permission modes (step 18)**
32. Session A: Edit automatically, send a message. Session B: Plan. Reload the window
    and reopen each. **Expected:** A opens in Edit automatically and its edits aren't
    prompted. B opens in Manual (Plan is never kept).
33. **Expected on disk:** Forge's globalState holds
    `sessionPermissionMode:<A's id>` = `{"mode":"acceptEdits", …}` and nothing for B.
34. Settings › General › Default Permission Mode → Accept Edits, then New
    conversation. **Expected:** it shows Edit automatically.
35. A → Manual, reload, reopen A. **Expected:** Manual.
