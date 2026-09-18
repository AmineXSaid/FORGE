# Step 16: Permission option 2 with its save destination

Group 4, sixth step. Before: option 2 was the static text "Yes, and don't ask
again". It answered with every suggestion at its own destination, plain **"Yes"
did the same** (`accept()` defaulted `updatedPermissions` to the suggestions), and
the three permission-rule requests existed nowhere. "/" → Permissions opened the
Settings page.

## What the bundle says, and where the step file was wrong

The step file (and `docs/prompts/backend-wiring.md` B7) said option 2 "persists with
`add_permission_rules`" and that `session` is one of that request's destinations.
The bundle says otherwise, so the step file is corrected
([16-permission-destination.md](../16-permission-destination.md)):

1. **Option 2 answers the prompt; it sends no rule request.** `i1` in `EU0`:
   ```js
   J5 = (G ? [MU0] : $.suggestions).map((L0) => ({...L0, destination: L0.type === "setMode" ? L0.destination : O}));
   $0 = J5.find((L0) => L0.type === "setMode" && L0.destination === "session");
   if ($0 && !diffPath) await Z($0.mode, false);      // mirror the mode, don't push it
   $.accept(B || $.inputs, J5);
   ```
   The CLI writes the destination's settings file itself (`PermissionUpdate`,
   `sdk.d.ts` L2408). The host keeps only what the prompt offered:
   ```js
   // requestToolPermission
   B = Rf$(J);  H = U.filter((q) => QI0(q, B) && (V || !(q.type === "setMode" && q.mode === "bypassPermissions")));
   function QI0($, Q) { ... if (BH($) === BH(jf$)) return true;
     return Q.some((Y) => Y.type === "setMode" ? X === BH(Y) : typeof J === "string" && Object.hasOwn(ew0, J) && X === BH({...Y, destination: J})) }
   ```
2. **A session grant is `destination: "session"` in that answer.**
   `add_permission_rules` refuses it: `Zb` is `Wo$ = ["userSettings","projectSettings","localSettings"]`.
3. **The three requests belong to the "Permission rules" dialog** (`kU0`, module
   `0Reg3g`), opened by the "/" row `permission-rules` ("View and edit permission
   rules"). **The user decided (2026-09-18) to port it in this step**, so the row
   opens the dialog. Step 31 now covers only MCP servers, Hooks and Manage plugins.
4. **The host doesn't write the file.** `permissionRulesConfigManager.edit` (class
   `pe`) runs the CLI's hidden `claude edit-permission-rules --json` with the edit on
   stdin, in the session's cwd. CLI 2.1.274 has the subcommand ("Apply one
   permission-rule edit read as JSON from stdin (used by the VS Code extension)").
   The CLI validates the rule, rejects duplicates, writes the file, and prints
   `{ok, warnings, stored}`. Then `listPermissionRulesUntil` re-reads
   `query.listPermissionRules()` up to 14 × 300 ms.

Also from `EU0`: `U` is **"the ExitPlanMode request has plan comments"**, not
"feedback typed". That's step 17's subject and is corrected there.

## Results

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| Prompt, 1 rule suggested | `tool_permission_request {toolName, inputs, suggestions, defaultToNo?, suppressAlwaysAllowRule?, toolUseId?, agentId?}` (the four `CanUseTool` options the official forwards) | — | option 2 **"Yes, allow npm test for this project (just you)"**: grant span `title="npm test:*"`, `destinationLink` `title="Saves to .claude/settings.local.json (gitignored)"`, the hidden hint "Left or Right arrow changes where this is saved" on `aria-describedby`; buttons disabled for 500 ms, then enabled | works |
| Destination link, 5 clicks | nothing sent | — | this project (just you) → all projects → this project (shared) → this session → this project (just you), each with the official title; `localStorage["claude-vscode-permission-destination"]` follows; prompt stays up | works |
| ←/→ on focused option 2 | nothing sent | — | → +1, ← −1; → on button 1 does nothing | works |
| Option 2, "this project (shared)" | only `response {tool_permission_response, result:{behavior:"allow", updatedInput, updatedPermissions:[{type:"addRules", rules:[{toolName:"Bash", ruleContent:"npm test:*"}], behavior:"allow", destination:"projectSettings"}]}}` | stub CLI stores `Bash(npm test:*)` under `projectSettings`; real host: `QI0` keeps it (re-targeted offer) | prompt closes | works (host filter: spec) |
| Option 2, `setMode acceptEdits` (Edit) | only the answer, `updatedPermissions:[{type:"setMode", mode:"acceptEdits", destination:"session"}]`; **no** `set_permission_mode` | stub CLI mode `acceptEdits` | label "Yes, allow all edits this session"; footer Manual → **Edit automatically** | works |
| "Yes" (option 1) | answer `{behavior:"allow", updatedInput, updatedPermissions: []}` | — | — | works (was: sent every suggestion) |
| "No" | answer `{behavior:"deny", message: <official AS text>, interrupt:true}` | — | — | works |
| Label variants | — | — | 2 rules "…npm test and WebSearch for…"; 3 rules "…npm test and 2 more for…" (`title` = bullets); 1 dir "…access to shared/ for…"; 3 dirs "…access to 3 directories for…"; `setMode default` "Yes, return to normal mode"; no suggestions → 2 buttons; hint only for rules/dirs | works |
| `suppressAlwaysAllowRule: true` | — | — | no option 2 (buttons "1 Yes", "2 No") | works |
| `defaultToNo: true` | — | — | no shortcut numbers; `data-focused-index="2"` (reject); digit "1" does nothing | works |
| Keys | — | — | "2" inside the 500 ms guard: nothing, after it: option 2; "4": focus the reject field (`data-focused-index="3"`); Escape: reject; held Enter: swallowed | works |
| "/" → Permissions | `{type:"list_permission_rules"}` on the session's channel | `{type:"list_permission_rules_response", state}` | menu **closes**; dialog "Permission rules": Allow (5) / Ask (0) / Deny (2) / Workspace (2), scope note; session and startup rules read-only with the official reasons; focus on the dialog | works |
| forge.json rule (B6) | (in the listing) | `{source:"flagSettings", editability:"readonly"}` | "From settings given at startup", reason "From a settings file given at startup.", no Remove | works (stub state) |
| Add rule… (Deny) | `{type:"add_permission_rules", rules:["WebFetch(domain:evil.example)"], behavior:"deny", destination:"userSettings"}` (trimmed, as `S45`) | `{…, state}` | form: "Add deny rule", the official note, input focused, "Save for" 3 options with titles, starts at the remembered destination; row appears "From user settings" + Remove; destination remembered | works |
| Add `Bash(*)` (CLI warning, pending) | same shape | `{state, pending:true, warnings:[…tool-wide rule…]}` | yellow `warningMessage`: the CLI's note + "Saved to project local settings. Not listed yet: … (in auto permission mode, allow rules for risky commands are not applied)." | works (stub) |
| Add a duplicate | same shape | `{error:"\"Bash\" is already in the allow rules in project local settings"}` | "Couldn’t add the rule: …" in the form; Cancel closes it | works (stub) |
| Remove → confirm → Remove rule | `{type:"remove_permission_rule", rule:"Bash(npm test:*)", behavior:"allow", source:"projectSettings"}` | `{…, state}` | confirm panel "Remove allow rule?", rule, "From shared project settings", the official note; row gone | works |
| Rejections (raw requests) | 8 add + 4 remove bad shapes | all **in-band**: `{error:"invalid request"}`; `["   "]` passes the shape and the CLI says "rules must not be empty"; unknown rule "rule not found: …" | — | works |
| Close | — | — | Escape: closes, focus back to the composer; click inside: stays; overlay click: closes | works |

**Counts:** works 18 · partial 0 · broken 0 · left out 0 (see below for what the official has and Forge can't)

The harness proves the webview↔host contract against the stub CLI. The real
host's order (read → `claude edit-permission-rules` → re-read), its filter and
its errors are proven by specs. The real CLI side is the checklist.

## Every SDK field on the objects this step touched

| API / field | Surfaced? | Where / why not |
| --- | --- | --- |
| `CanUseTool` `suggestions` (L221) | yes | option 2's label and its answer |
| `CanUseTool` `defaultToNo` | yes | no numbers, focus on reject, digits off |
| `CanUseTool` `suppressAlwaysAllowRule` | yes | hides option 2 |
| `CanUseTool` `toolUseID` / `agentID` | carried | forwarded as `toolUseId` / `agentId` and kept on the request, as the official does. Nothing in the official prompt shows them |
| `CanUseTool` `title`, `displayName`, `description`, `decisionReason`, `blockedPath`, `mcpServer`, `matchedAskRule` | no | the official host doesn't forward them (`requestToolPermission(…, {defaultToNo, suppressAlwaysAllowRule, toolUseId, agentId})`), and the official prompt has no slot for them. Showing them would mean inventing markup |
| `CanUseTool` `signal` | no | **pre-existing gap:** the official passes it to `sendRequest`, which cancels the prompt when the SDK aborts. Forge's host `sendRequest` has no cancel path. Reported below, not fixed |
| `CanUseTool` `requestId` | no | only for out-of-band answers; the answer goes back in-band |
| `PermissionResult` allow: `updatedInput`, `updatedPermissions` | yes | every answer |
| `PermissionResult` `toolUseID`, `decisionClassification` | no | the official never sets them; the CLI infers the classification |
| `PermissionResult` deny: `message`, `interrupt` | yes | reject |
| `PermissionUpdate` `addRules` | yes | label (rules), answer, dialog |
| `PermissionUpdate` `addDirectories` | yes | label (directories), answer, dialog's Workspace section |
| `PermissionUpdate` `setMode` | yes | label (acceptEdits / default), answer, webview mirror |
| `PermissionUpdate` `replaceRules`, `removeRules`, `removeDirectories` | passed through | re-targeted and sent back if the CLI suggests them (`i1` maps every suggestion); the official label (`gK1`) doesn't describe them either |
| `PermissionUpdateDestination` `localSettings`, `userSettings`, `projectSettings`, `session` | yes | the destination link (`by`) |
| `PermissionUpdateDestination` `cliArg` | label only | `Iy`/`ao` have its words, but it isn't in the cycle (`by`); the host filter accepts it (`ew0`) |
| `PermissionBehavior` | yes | dialog sections, add form, request validation |
| `PermissionRuleValue` `toolName`, `ruleContent` | yes | label (`gK1`: `:*` prefix, 17-char cut, "Artifact(action:reply)" phrase) |
| `Query.listPermissionRules()` (sdk.mjs only; payload `SDKControlListPermissionRulesResponse` L4365) | yes | narrow type in `permissionRules.ts`, like `getSettings()` |
| `SDKControlPermissionRulesState` `rules`, `workspaceDirectories`, `originalCwd`, `managedOnly`, `errors` (L4522) | yes | all rendered (`managedOnly` hides Add/Remove; `errors` → "Settings file failed to load: …") |
| `SDKPermissionRuleEntry` `behavior`, `source`, `rule`, `description{prefix,emphasis,suffix}`, `editability`, `notInEffect` (L5217) | yes | all rendered |
| `SDKPermissionWorkspaceDirectory` `path`, `source` | yes | Workspace rows |
| `Query.setPermissionMode` (L2675) | existing | steps 17, 18 |
| `Query.setMcpPermissionModeOverride` (L2692) | no | tighten-only override for bypass/auto sessions; the official webview has no control for it, and Auto stays out of scope (the user's decision, 2026-09-18) |

## B6: permission rules and forge.json

The profile sync still copies a profile's `permissions` into forge.json (the
`--settings` flag layer). That's harmless here. The CLI keeps every rule with its
own source: `SDKPermissionRuleEntry.source` includes `flagSettings`, and its
`editability` marks `flagSettings` rules `readonly` (L5217–5240). So forge.json
rules **add** to the user's rules and replace none of them. The dialog lists them
as "From settings given at startup", with no Remove. A rule the dialog or the
prompt writes lands in the chosen settings file, where the profile can't mask it.
Deny wins over allow whatever the layer, as in the official. Shown in the harness
with a `flagSettings` rule in the stub state; the real-CLI case is checklist item 4.

## Changes

- `src/services/claude/permissionRules.ts` (new): `nu$`, `Wo$`/`Zb`, both shape
  checks, `BH`, `$j0`, `I8`, `pe.edit` (`runPermissionRuleEdit`),
  `listPermissionRules` via a narrow type, `listPermissionRulesUntil`, the
  add/remove "shows up" predicates, `Rf$`, `jf$`, `ew0`, `QI0`, and the
  `requestToolPermission` filter.
- `ClaudeAgentService`: the channel keeps its `cwd`; `canUseTool` forwards the four
  options and filters the answer (logging drops as the official does); the
  `list_permission_rules` / `add_permission_rules` / `remove_permission_rule`
  handlers, all in-band; dispatcher cases.
- `ClaudeSdkService`: `getClaudeBinary()` (the official's), and
  `getAllowDangerouslySkipPermissions()`. Forge has no such setting, so this is
  `forge.cliArgs` enabling `--allow-dangerously-skip-permissions` or
  `--dangerously-skip-permissions`, read through the same gate
  (`cliArgs.allowsDangerouslySkipPermissions`).
- `messages.ts` / `BaseTransport` / `Session` / `useSession`: the three requests
  (official payloads, channel on the envelope), the new fields on
  `tool_permission_request`, and `handleToolPermissionRequest` as the official does
  it (`S5` on name, inputs and suggestions; `=== true` on the flags).
- `core/PermissionRequest.ts`: the official `CL`. `accept()` sends no updates
  unless given some, plus the new fields and `id`.
- `core/permissionPrompt.ts` (new): `S5`, `by`, `uK1`, `Iy`, `ao`, `ro`/`io`,
  `O45`, `gK1` (with `N45`), `OU0`, `R45`/`mK1`, `LU0`, `L45` as label parts, `NU0`,
  `MU0`, and option 2's updates.
- `PermissionRequestModal.vue`: option 2 is `L45`, and the keys are `wU0`/`l0`.
  Also ported: the 500 ms guard (`P`), focus (`b0`, the focusin tracker, the settle
  timer) and unfold re-arming. `ChatPage` keys the prompt on `request.id` and
  passes `onPermissionModeChange` (`setPermissionMode(mode, push)`).
- `core/permissionRules.ts` (new) and `PermissionRulesDialog.vue` (new): `kU0`,
  `f45`, `y45`, `x45`, `C45`, `S45`, `IU0`, the copy (`b45`, `k45`, `h45`, `bU0`,
  `v45`) and the escaping (`E45`, `lK1`, `NQ`).
- `forge/ForgeDialog.vue` (new): the official `i7`, using the already-ported
  `dialog.css` (`f3sAzg`).
- `scripts/port-official-css.mjs`: two modules, `permissionrules` (`0Reg3g`) and
  `dialogbutton` (`GujgUQ`, the `_J` button). Regenerating changed no existing file.
- `ButtonArea` → `ChatInputBox` → `ChatPage`: "/" → Permissions opens the dialog.
- Mock host: the stub CLI's rules state (every source kind, including a
  `flagSettings` rule), the three answers with the official shapes and the CLI's
  own refusals, `rulesPending`, the prompt answers applied to the state
  (`__forgeAnswers`), and `__forgeSeedPermission` taking the four options.

## Gates

- `pnpm test`: `Test Files 18 passed (18) · Tests 393 passed (393)`
- `pnpm run typecheck:all`: `tsc --noEmit` and `vue-tsc -p src/webview/tsconfig.json --noEmit`, both silent
- `pnpm run build`: `✓ 4065 modules transformed.` · `✓ built in 6m 17s` · exit 0.
  `Forge brand guardrail: clean (310 files scanned)` · `Forge token check: clean (237 tokens used, 382 defined)` ·
  `Forge command check: clean (20 commands, 13 references)`

## Oracle

| Window (root selector) | Structural diffs | Note |
| --- | --- | --- |
| permission prompt `.fg-permission__permissionRequestContainer`, **before** (base `785f977`, 1 rule suggested) | **0**, 27/27 clean | new baseline, measured on a build of the base commit |
| same, **before**, no suggestions | **0**, 25/25 | |
| same, **after**, 1 rule suggested | **0**, 30/30 | +3 elements: the grant span, the destination link, the hidden hint. The first run right after mount reports `pre.inputJson width 0 vs 644.8` on both builds; re-runs are clean |
| "Permission rules" dialog `.fg-dialog__overlay`, list | **0**, 74/74 | new window |
| dialog, list with a warning | **0**, 94/94 | |
| dialog, add form | **0**, 24/24 | |
| dialog, add form with an error | **0**, 25/25 | |
| dialog, remove confirmation | **0**, 18/18 | |
| `.fg-composer__inputWrapper` (idle) | **0**, 29/29 | = baseline |
| `.fg-menu__menuPopup` (Modes menu) | **0**, 41/41 | = baseline |
| `.fg-commandmenu__menuPopup` model menu | Sonnet 50/50 · Opus 53/53 · Haiku 38/38 | = baseline |
| `.fg-commandmenu__menuPopup` "/" menu | Sonnet 79/79 · Opus with the fast-mode row 85/85 | = baseline |
| `.fg-shell__header` | **0**, 15/15 | = baseline |
| `.fg-markdown__root` (one-code-block message) | **1**, 8/9 | the known `codeBlockWrapper pre` font-family artifact |

## Specs added

`test/permissionRules.spec.ts`, 56 cases:

- host checks: behavior (10 rejections); destination (9 rejections, including
  `session` and `cliArg`); add (1–100 rules, ≤ 10 000 characters; 14 bad shapes
  including a path-like destination); remove (7 bad shapes); `BH` key order;
- the write: `$j0` (last line, strings only, junk), `I8` (native / node / args),
  `claude edit-permission-rules --json` with cwd, env, timeout and stdin; the
  CLI's message without colour codes or "Error:"; exit code / stopped;
  missing cwd vs other spawn errors; no binary, no spawn;
- the re-read: the narrow `listPermissionRules`, found on read 3 (2 sleeps of
  300 ms), never found (15 reads, 14 sleeps, unchanged), a failed re-read;
  the add/remove predicates;
- the answer filter: offered and re-targeted to each of the five destinations
  kept; another rule, another behavior, an unknown destination and a re-targeted
  `setMode` dropped; `jf$` always allowed; deny and plain allow untouched;
  `bypassPermissions` only when allowed; a malformed list; bidi-escaped echoes
  kept, raw ones dropped; `allowsDangerouslySkipPermissions`;
- the service, via the dispatcher: list; in-band errors (no channel, no method);
  add in the official order (read, edit, re-read ×2); warnings and pending; every
  bad shape refused before anything is read or written, with the official log
  line; a refused write and a missing channel in-band; cwd fallback; remove order,
  pending and failures; the prompt request carries the four options and the
  answer is filtered;
- webview: the cycle, the words and titles, the starting destination; every label
  variant; the 17-character cut, the prefix and the Artifact phrase; `OU0`; ⏎ and
  bullets; option 2's updates and the session mode change; **"Yes" sends no
  updates**; the transport's `S5` and `=== true`; the three payloads; the dialog's
  words, the escaping (zero-width, NBSP, bidi, edge spaces, `\u` look-alikes,
  astral private use), read-only reasons, source column, Remove visibility,
  grouping, the add form's start, the pending notices.

## Deviations from the official, deliberate

1. `getAllowDangerouslySkipPermissions()` reads `forge.cliArgs`, not a
   `claudeCode.allowDangerouslySkipPermissions` setting Forge doesn't have.
   The bypass gate therefore means the same thing it does in the official: the
   session was launched able to run in `bypassPermissions`.
2. The official announces a destination change to screen readers (`lP`, a
   polite live region at the app root). Forge has no such announcer, so the arrow
   keys change the destination silently. The `aria-describedby` hint is there.
3. `isRemote` is always false in Forge, so the dialog never shows the "runs on
   another machine" notice.

## Pre-existing issues found, not fixed here

1. **The SDK's abort signal doesn't reach the prompt.** The official
   `requestToolPermission` passes `signal` to `sendRequest`, and an abort cancels
   the webview prompt ("Aborted"). Forge's host `sendRequest` has no cancel path,
   so an aborted tool call leaves its prompt up until answered.
2. The official prompt renders tool-specific bodies (`BY(toolName).permissionRequest`:
   the plan for ExitPlanMode, the question form for AskUserQuestion, file edits).
   Forge shows the generic "Do you want to proceed with X?" for every tool.
   Relevant to step 17.
3. The mock host answers `set_permission_mode` without `success`, so a mode
   picked in the harness snaps back. Fixed in step 17, which covers that request.
4. Carried forward: `handleGetAssetUris` uses `process.cwd()`; the mock acks
   unknown requests without `success`.

## Rows deliberately left out

None from this step. Out of scope, unchanged ([out-of-scope.md](../out-of-scope.md)):

| Feature | Official requests / ids | UI to keep out | Reason |
| --- | --- | --- | --- |
| Microphone / speech-to-text | `start_speech_to_text`, `stop_speech_to_text` | the mic button | out of scope: account and cloud |
| Login / Switch account | `login`, `get_auth_status`, `submit_oauth_code` | the `login` row | out of scope: account and cloud |
| Account & usage | `get_usage`, `open_account_usage` | `account-usage`, `usage` | out of scope: account and cloud |
| Usage / context meter | `get_context_usage`, `request_usage_update` | footer meter, `context` | out of scope: account and cloud |
| Remote Control | `toggle_remote_control`, … | its rows | out of scope: account and cloud |
| Feedback | `submit_feedback`, `/feedback`, `/bug`, "Report a problem" | those rows (step 33 removes the button) | out of scope: account and cloud |
| Thumbs rating | `message_rated` | the thumbs | out of scope |
| Switch models when flagged | `switchModelsOnFlag` | its row | experiment-gated |
| Side question | `/btw`, `side_question` | its row | out of scope |

## VS Code checklist for the user — **unverified**

1. Trigger a Bash permission (e.g. ask Claude to run `npm test`). Click the
   underlined destination until it reads "this project (shared)", then choose
   option 2. **Expected:** `<workspace>/.claude/settings.json` gains
   `"permissions": {"allow": ["Bash(npm test:*)"]}`, and the same command runs
   again without a prompt.
2. Repeat with "this session". **Expected:** no settings file changes; the command
   isn't asked again in this session, but is after a reload.
3. "/" → Permissions. **Expected:** the dialog lists the rule from step 1 under
   Allow, "From shared project settings", with Remove; the session rule from
   step 2 shows "Approved for this session only; not saved in a settings file."
4. Put `"permissions": {"deny": ["Bash(rm -rf:*)"]}` in the active profile
   (`~/.claude/settings.<profile>.json`), switch to it, and open the dialog.
   **Expected:** the rule is listed under Deny, "From settings given at startup",
   with no Remove (the forge.json flag layer, B6).
5. In the dialog, "Add rule…" under Deny, type `WebFetch(domain:example.com)`,
   "Save for: all projects", "Add rule". **Expected:** `~/.claude/settings.json`
   gains it under `permissions.deny`, and the row appears "From user settings".
   Then Remove → "Remove rule". **Expected:** it is gone from the file.
6. Add `Bash(*)`. **Expected:** the yellow note says it was saved as the
   tool-wide rule "Bash".
7. Answer a prompt with plain "Yes". **Expected:** no settings file changes.
