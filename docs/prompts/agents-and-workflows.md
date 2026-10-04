# Subagents and workflows: live status, the agents pill, the Agent map

Handover spec, written 2026-10-04. Build on branch **`ultimate_02`**, commit and
push there. Everything below was read from the files named; offsets are byte
offsets into the minified bundles, so `python3 -c "s=open(F).read(); print(s[OFF:OFF+1500])"`
prints the code.

## Goal

When the model starts subagents (the `Agent`/`Task` tool) or a workflow (the
`Workflow` tool, which Ultracode turns on), Forge must show **what is running and
how it is going**, the way the official Claude Code extension does. Today Forge
ignores every task event the CLI sends, so a turn with five subagents looks
like one spinner.

What to build, in this order. Finish, verify and commit each phase before the next:

| Phase | Deliverable |
| --- | --- |
| 1 | Task state in the webview session, fed by the CLI's task events (port of the official handlers) |
| 2 | The **"N agents" pill** in the composer footer, with its running/waiting dot and tooltip |
| 3 | The **Agent map** dialog (tree, statuses, per-agent details, **Stop agent**, **Open transcript**) and its two host requests |
| 4 | Workflows as tasks (`local_workflow`), subagent spans in Focus view, and the working indicator naming subagent progress |

## Rules (read first)

- `CLAUDE.md` rules 1–7 and backend rules B1–B9 apply. Use the **`ui-parity`** and
  **`backend-parity`** skills (`.claude/skills/`). The official bundle is the spec:
  same type strings, same payload fields, same labels, same CSS. Do not redesign.
- Reference files: `../Real_Claude_Code_VSCODE_extension_files/webview/index.js`
  (component + session spec), `…/webview/index.css` (styles),
  `…/extension.js` (host handlers). In this cloud checkout they are at
  `/home/user/Real_Claude_Code_VSCODE_extension_files/` (extract from the
  `other-files` branch if missing: `git archive origin/other-files Real_Claude_Code_VSCODE_extension_files | tar -x -C ..`).
- SDK: `@anthropic-ai/claude-agent-sdk` **0.3.274**, typings in
  `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`. Cite the `.d.ts` line
  for every field you use.
- The user is cost-sensitive: do the work directly, without spawning subagents or
  workflows, unless asked.
- Definition of done per phase: vitest specs (`test/*.spec.ts`), `pnpm test`,
  `pnpm run typecheck:all`, `pnpm run build` all green; harness check for UI
  phases; a VS Code checklist marked **unverified** for real-CLI behaviour.

## Source of truth

### SDK events (sdk.d.ts, v0.3.274)

All arrive as `type: 'system'` messages on the SDK stream (union at L5002):

| subtype | type | line | fields used |
| --- | --- | --- | --- |
| `task_started` | `SDKTaskStartedMessage` | L5671 | `task_id`, `tool_use_id?`, `description`, `subagent_type?`, `is_backgrounded?`, `spawn_depth?`, `task_type?` (`local_agent`, `local_workflow`, …), `workflow_name?`, `prompt?`, `skip_transcript?`, `ambient?` |
| `task_progress` | `SDKTaskProgressMessage` | L5646 | `task_id`, `tool_use_id?`, `description`, `subagent_type?`, `usage{total_tokens,tool_uses,duration_ms}`, `last_tool_name?`, `summary?` |
| `task_updated` | `SDKTaskUpdatedMessage` | L5707 | `task_id`, `patch{status?: pending/running/completed/failed/killed/paused, description?, end_time?, total_paused_ms?, error?, is_backgrounded?}` |
| `task_notification` | `SDKTaskNotificationMessage` | L5616 | `task_id`, `tool_use_id?`, `status: completed/failed/stopped`, `reason?`, `output_file`, `summary`, `usage?`, `skip_transcript?`, `ambient?` |
| `background_tasks_changed` | `SDKBackgroundTasksChangedMessage` | L3476 | `tasks[]{task_id, task_type, description, ambient?}` — **replace** semantics |

Query/controls: `query.stopTask(taskId)` **L2991** ("A task_notification with status
'stopped' will be emitted"); `getSubagentMessages(sessionId, agentId, options?)`
**L866**; `listSubagents(sessionId)` **L1079**. Options worth checking against the
official host before setting: `perTaskStopAffordance` (L4267 / ~L1702 — declares a
per-task stop control; with it, Stop aborts only the turn and spares background
agents/workflows), `agentProgressSummaries` (L1969/L4260), `forwardSubagentText`
(L1781/L4261). The official host's options are around `extension.js` @2847143 and
@2852532 — read them and copy what it passes; do not guess.

### Official webview session (index.js)

State on the session class (@3480122): `subagentTasks = signal(new Map)`,
`agentMapAgents = signal(N51 /* empty Map */)`, `subagentSpawnToolUseIds = new Map`
(bounded by `nj0`), `backgroundTaskIds = signal(new Set)`.

Dispatch (@3538206), inside the message handler:
`system/task_started → handleTaskStarted`, `task_progress → handleTaskProgress`,
`task_notification → handleTaskNotification`, `task_updated → handleTaskUpdated`,
`background_tasks_changed → handleBackgroundTasksChanged`.

Handler definitions (port literally):

| handler | offset | behaviour |
| --- | --- | --- |
| `handleTaskStarted` | @3540210 | ignores anything but `task_type === "local_agent"`; resolves the spawning tool_use id (`tool_use_id ?? subagentSpawnToolUseIds.get(task_id)`), remembers it; adds `{taskId, toolUseId, description, prompt, taskType, isBackgrounded, startTime: now, status: "running"}` to `subagentTasks`; adds to `agentMapAgents` via `FR1` with `parentToolUseId = L51(messages, toolUseId)`, `subagentType` |
| `handleTaskUpdated` | @3541220 | `agentMapAgents = _51(…, {status, error, end_time, is_backgrounded})`; in `subagentTasks`: completed/failed/killed → delete; `is_backgrounded` change → update |
| `handleBackgroundTasksChanged` | @3541714 | drops backgrounded `subagentTasks` no longer listed; `backgroundTaskIds` = ids of tasks with `task_type` `local_agent` **or `local_workflow`** |
| `handleTaskProgress` | @3542179 | `agentMapAgents = PR1(O51(…), task_id, {totalTokens, toolUses, durationMs})`; in `subagentTasks`: usage, `summary`, and `recentTools` = last 3 distinct of (`description` if changed, else `last_tool_name`) — only while there is no summary |
| `handleTaskNotification` | @3542870 | `agentMapAgents = jR1(O51(…), {status, summary, usage, outputFile, endTime})`; removes from `subagentTasks` |
| `rememberSubagentSpawnToolUseId` | @3540956 | LRU-bounded map task_id → tool_use_id |

Agent-map model helpers (same module, port with them):
`FR1` @3430604 (add/merge an agent, handles `call:`-prefixed provisional ids and
`wakeToolUseIds`), `O51` @3431589 (re-key a provisional `call:` entry to the real
task id), `PR1` @3431821 (usage update; revives a `processEnded` stopped agent),
`_51` @3432025 (patch status/error/backgrounded via `T51`), `jR1` @3432457
(notification → final status, default `"finished"`), `MR1` @3432722 (on process
reset: every `working` agent → `stopped`, `processEnded: true`), `nC` @3432883
(set of agentIds that have pending permission requests), `oC` (working + pending
permission → `"waiting"`), `wR1` @3433213 (pill dot: `waiting` / `running` / `idle`),
`NR1` (status counts), `OR1` @3433486 (build the tree by `parentToolUseId`),
`RR1` @3433923 (fill missing `parentToolUseId` from messages), `L51` @3434135
(parent tool-use id of a tool_use), `E51` @3434685 (rebuild `agentMapAgents` from a
loaded transcript — used on session load/replay).

Reset points (port them, or state leaks between sessions): on load/replay
@3494280 and @3495946 (`subagentTasks` cleared, spawn map cleared,
`clearBackgroundTasks()`, `agentMapAgents = E51(messages)`); on process reset
@3507376 (`subagentTasks` cleared, `agentMapAgents = MR1(agents, now)`).

Status labels (`gz0`, just before @4800607):
`working: "Working"`, `waiting: "Waiting for your permission"`,
`finished: "Finished"`, `failed: "Failed"`, `stopped: "Stopped"`.

### Official UI (index.js)

- **Agents pill** — `uV0` @5003418 / `z75` @5003571, label `zF1(n)` = `"N agent(s)"`
  (`NY` pluralises). Renders `<button class="modelPill agentsPill" data-agents-dot={dot}>`
  with an icon span and label. Tooltips, verbatim:
  - waiting: `"An agent is waiting for your permission · Click to open the agent map"`
  - running: `"Agents are working · Click to open the agent map"`
  - otherwise: `"Click to open the agent map"`
  - `aria-label`: `` `${label} · ${tooltip}` ``.
  Shown in the composer footer only when `agentMapAgents.size > 0` (footer layout
  @5041900). Clicking calls `onOpenAgentMap` (@5130100).
  CSS modules: `X7.modelPill` = `modelPill_gGYT1w`; `xy` =
  `{agentsPill:"agentsPill_EGyesg", dot:"dot_EGyesg", icon:"icon_EGyesg", label:"label_EGyesg"}`.
- **Agent map dialog** — `cz0` @4800652: dialog (`i7`) titled **"Agent map"**,
  `maxWidth: 1200`, scroll inside; subtitle `"{n} agent(s) · click an agent for details"`;
  tree = main row (`g55` @4802846) + children (`lz0` @4801569, rows `u55` @4802491);
  selecting the main row shows `c55` @4803523, an agent shows `r55` @4805132.
  The agent detail shows status, last tool (`subagentTasks.get(id).recentTools.at(-1)`),
  pending permission for that agent (`permissionRequests.find(p => p.agentId === id)`),
  error/summary, prompt, tool calls, an **"Open transcript"** button and a
  **"Stop agent"** danger button (`"Stopping…"` while pending; on failure:
  `"The agent could not be stopped. It may have finished already."`) — @4808193.
  CSS module `G4` (hash `iHnHpw`): `subtitle, tree, node, children, child, row,
  rowMain, rowTitle, rowMeta, transcriptHeader, cardTitle, meta, activity,
  activityLabel, failure, result, section, sectionHeader, prompt, toolCalls,
  toolCall, toolCallSpacer, actions, dangerButton, counts`.
- **Focus view** — `DL1` @3464344 + `NL1` @3469534 use `subagentTasks` to keep running
  subagents visible (@5130791). Forge's `src/webview/src/core/focusView.ts` says
  subagent spans (`uj0`/`PL1`/`gj0`, `IK1` rows) were **not ported** because Forge
  had no task state — phase 4 ports them.

### Official host requests (extension.js)

| request | webview sender | host handler | behaviour |
| --- | --- | --- | --- |
| `stop_subagent` `{taskId}` | index.js @3315029 (`stopSubagent`), session @3511265 | dispatcher @3062759 → `stopSubagent` @3049664 | `withChannel(channelId, c => c.query.stopTask(taskId))` → `{type:"stop_subagent_response"}`; on error `{type:"stop_subagent_response", error:String(e)}`. Webview then marks a still-`working` agent `killed` via `_51` |
| `get_subagent_transcript` `{sessionId, agentId}` | index.js @3315029 | `getSubagentTranscript` @3049731 | **validation**: session id valid (`y0`) **and** `agentId` matches `/^[A-Za-z0-9_-]{1,128}$/`, else `{error:"Not a session and agent id"}`; returns `{type:"get_subagent_transcript_response", messages}`. Official reads its own session store; Forge should use the SDK's `getSubagentMessages(sessionId, agentId)` (L866) — check the transcript dir option matches Forge's session location |

Both follow B2 (six places): `src/shared/messages.ts`,
`src/webview/src/transport/BaseTransport.ts`,
`src/services/claude/ClaudeAgentService.ts` (dispatcher), 
`src/services/claude/handlers/handlers.ts`,
`.claude/skills/ui-parity/harness/mock-host.js`, and a spec under `test/`
(including the rejection cases: bad agentId, bad sessionId, no running channel).

## Forge today (ultimate_02 @ b46b832)

- `src/webview/src/core/Session.ts` ~L1376–1405: the `event.type === 'system'`
  branch handles only `api_retry` and `init`. Add the task dispatch here and the
  state fields on the class; port the reset points into Forge's equivalents
  (session load/rebuild and process reset).
- Permission requests already carry `agentId`
  (`src/webview/src/core/PermissionRequest.ts:23`, host `ClaudeAgentService.ts:1031`),
  so `nC`/`oC` "waiting" works as in the official.
- The tool row for subagents: `src/webview/src/components/Messages/tools/toolRegistry.ts`
  (`name = 'Agent'` ~L226; `Task` maps to `Agent` ~L864). Check what the official
  shows **inside** the Agent tool row while it runs (grep around the
  `subagent_type` uses in index.js) and port that; do not invent a layout.
- Composer footer: `src/webview/src/components/ButtonArea.vue` (holds the model pill);
  the agents pill goes beside it, as in the official footer.
- Dialog primitive: find Forge's port of the official `i7` dialog (used by other
  official-ported dialogs such as the Rewind/Output-style pickers) and reuse it.
- Styles: port `iHnHpw` and `EGyesg` modules from `index.css` with
  `pnpm run ui:port` (add the modules to `MODULES`), never hand-written colours
  (`pnpm run lint:brand`).
- Working indicator: `src/webview/src/core/currentStep.ts` already shows
  "Running a subagent: … · 40s" while an Agent tool call is open. In phase 4, when
  `subagentTasks` has the task, append its latest `recentTools` entry
  (e.g. "Running a subagent: audit relay · Grep · 40s").
- Host forwarding: the webview already receives `system` messages (`api_retry`
  arrives), so the task events should reach `Session` as-is — **verify** in the
  harness and with one real run before relying on it.
- Ultracode/workflows: `ultracodeAvailable` is already ported (settings whitelist,
  handlers). Workflows are run by the CLI's `Workflow` tool; saved workflows come
  through the CLI's own command list into the "/" menu. Verify a saved workflow
  appears there; don't add a hand-made "/workflow" row (rule 7: the official has none).

## Phase details

### Phase 1 — task state (no new UI yet besides what the official renders inline)
1. Add `subagentTasks`, `agentMapAgents`, `subagentSpawnToolUseIds`,
   `backgroundTaskIds` to `Session`, typed from the official shapes.
2. Port the five handlers and the helper functions listed above into a pure
   module (e.g. `src/webview/src/core/agentMap.ts`) so they are unit-testable.
3. Dispatch from the `system` branch; port the reset points.
4. Specs: feed sequences of real-shaped events (started → progress ×3 →
   notification; started → updated(killed); provisional `call:` id re-keying;
   backgrounded task dropped by `background_tasks_changed`; `local_workflow` ids
   collected; reset marks working agents stopped).

### Phase 2 — agents pill
1. Component port of `uV0`/`z75`; label/tooltip strings verbatim; `data-agents-dot`.
2. Visible only while `agentMapAgents.size > 0`.
3. Harness: mock-host emits a scripted `task_started`/`task_progress`/
   `task_notification` sequence; confirm pill text, dot and tooltip change;
   `probe-oracle.js` 0 structural diffs against the official pill.

### Phase 3 — Agent map + host requests
1. Port `cz0`, `lz0`, `u55`, `g55`, `c55`, `r55` and the `G4` styles.
2. Wire `stop_subagent` and `get_subagent_transcript` in six places; validation as above.
3. Pill click opens the dialog; Esc/close returns focus to the composer.
4. Harness: open the map, select an agent, Stop (success and failure paths),
   Open transcript (success and "Not a session and agent id"); 0 structural diffs.

### Phase 4 — workflows, Focus view, indicator
1. Workflow tasks (`task_type: "local_workflow"`) tracked in `backgroundTaskIds`
   exactly as the official; show them wherever the official does (check the
   footer/pill and Focus view code paths for `backgroundTaskIds` use).
2. Port the Focus-view subagent spans that `focusView.ts` documents as skipped.
3. Working indicator: subagent's latest tool from `recentTools`.
4. If the official host passes `perTaskStopAffordance` / `agentProgressSummaries`,
   pass the same through `ClaudeSdkService.ts` (`cliArgs.ts` if it is a flag) and
   test it.

## VS Code checklist to hand back (mark each unverified until seen)

1. With a Claude model, ask: "Use three subagents in parallel to summarise
   src/services, src/webview and test." → the footer shows **"3 agents"** with the
   running dot; tooltip "Agents are working · Click to open the agent map".
2. Click the pill → **Agent map** lists main + 3 agents, each "Working", with its
   latest tool; when done each shows "Finished" and its summary.
3. Start a long subagent, open its details, click **Stop agent** → status becomes
   "Stopped"; the main turn continues.
4. **Open transcript** on a finished agent shows its messages.
5. A subagent that needs permission (Manual mode, Bash) → pill dot turns to
   waiting; tooltip "An agent is waiting for your permission…".
6. Turn on Ultracode, ask for a workflow → the run appears as a task; a saved
   workflow appears in the "/" menu.

## Out of scope

Remote/cloud agents, Slack tags, teleport, anything gated on Anthropic
experiment flags, and the out-of-scope list in `CLAUDE.md`.
