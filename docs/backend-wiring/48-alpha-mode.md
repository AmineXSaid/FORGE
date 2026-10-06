# Step 48: Alpha mode, and cut-off tool calls that are never run

**Group:** 8 (small models)  **Branch:** `ultimate_02`

Asked for on 2026-10-06: what from AlphaCode can Forge add as an **"Alpha
mode" toggle beside "Thinking"** in the composer's "/" menu, focusing on what
Forge misses and what is effective. Added to scope by the user on 2026-10-06
(`CLAUDE.md`, "Reliability"). Two parts, each accepted or rejected on its own:

- **48a: cut-off tool calls are never run.** Always on, relay-only, every guard
  level. A data-loss defect on OpenAI-wire profiles.
- **48b: Alpha mode.** One global "/" switch, remembered like Thinking, that
  runs the strict guard stack, a 60-step cap and the Alpha working rules on any
  model, Claude included. Every guard send-back shows a one-line note in the
  chat, live and on reload.

## What reading the code showed

Step 47 already ported AlphaCode's working reliability parts (repeat guard, loop
guard, failure hints, stop gate, edit diagnostics, step cap, relay repair). The
gap is **who gets them**: they key on the endpoint profile's guard level
(`levels.ts`), and a Claude session resolves to `standard`, which switches off
the claim challenge, edit diagnostics, the read-only streak, the 3-repeat loop
threshold, the step cap and the working rules. The user had no switch.

AlphaCode's prompt-level discipline (kill a stuck hypothesis, completion
criteria, the evidence rule, the Result/Changes/Verification/Remaining report
and the pre-completion self-check) was in Forge for no model.

AlphaCode shows each send-back as a one-line system notice. Forge's send-backs
were silent in the chat; only a stop was shown.

**Decisions made with the user:** one global switch; new content is only the
Alpha working rules (the verify-before-finish gate, the todo follow-through gate
and lessons memory were offered and not chosen); a 60-step cap for every model
while Alpha is on; send-backs shown the way AlphaCode shows them.

## 48a: never run a tool call that was cut off

**The defect (read, not run):** `jsonRepair.ts` closed a string the model was
cut off in, `toolRepair.ts` accepted the result, and `fromOpenAI.ts` reported
`stop_reason: tool_use` even on `finish_reason: length`. So
`{"file_path":"x.ts","content":"line1\nli` ran as a two-line Write over the
whole file, and `{"command":"rm -rf /tmp/build/cac` ran as its prefix. The model
was never told.

**The fix:** `repairJsonDetailed()` keeps only the complete top-level pairs when
the input ends inside a value and reports `cutOff` (AlphaCode's
`try_recover_truncated_object` semantics). The required field that was cut is
absent, so the CLI answers with its own `InputValidationError` and nothing runs.
The relay records the cut-off call by `tool_use` id, and `errorHints.ts` turns
that validation error into AlphaCode's `truncated_body_error`, worded per tool
family and per `finish_reason`, escalating on a repeat of the same
`(tool, target)`.

`repairJson` keeps its old behaviour (its own spec rows still close `"a.t`).

**Trade-off:** a model that forgets a closing `"}` on an otherwise complete call
now gets a validation error plus the hint instead of a silent repair. A call cut
off only in an optional trailing field still runs without it, as in AlphaCode.
A cut-off Write to a new file is refused too.

### 48a results

| Row | Where | Host result | Model effect | Verdict |
|---|---|---|---|---|
| Trim a cut-off call to its complete fields | `jsonRepair.ts` `repairJsonDetailed`, `toolRepair.ts` | `{"file_path":"a.ts","content":"half` → `{file_path}`, `cutOff`; double-encoded and JSON-in-a-string values marked at any depth | the CLI refuses the call (`content` missing); nothing is written | **works** (spec + real CLI 2.1.274 and 2.1.291: file byte-for-byte unchanged) |
| Register the cut-off id | `cutOffCalls.ts`, from `fromOpenAI.ts` (stream) and `anthropicServer.ts` (non-stream) | `{tool, target, finish_reason}` by `tool_use` id, bounded | — | **works** (spec, both paths) |
| Say why | `errorHints.ts` `cutOffHint` | per tool family, worded by `finish_reason`; escalates on the 2nd cut-off of the same `(tool, target)`; own cache key, so a gateway reusing `call_0` cannot get another call's hint | "Hint: nothing was written to …" in the next request's tool result | **works** (spec + real CLI) |
| e2e scenario 35 | stub `cutwrite` | file unchanged on disk; gateway log `lastTool` carries the hint | — | **written, not run here** (needs code-server) |

MultiEdit: the string is present in the 2.1.274 binary; whether it is still an
offered tool was not confirmed. The hint covers it either way.

## 48b: Alpha mode

| # | Behaviour | Non-strict profile, Alpha off | Alpha on |
|---|---|---|---|
| 1 | Claim challenge at Stop | off | on, once a turn |
| 2 | Edit diagnostics | off | on |
| 3 | Loop guard: 3 repeats; read-only reminder after 20 reads (8 strict); per agent | off / 5 | on |
| 4 | Step cap: 60 model turns per user message, wrap-up nudge at 50 | off | on |
| 5 | Repeat guard, failure hints, empty-answer nudge | on | on |
| 6 | Alpha working rules (`resources/endpoint-rules/_alpha.md`) | absent | on |
| 7 | Send-back notes in the chat, live and on reload | absent | on (every level) |

Profile `off` + Alpha: Alpha wins. Profile `strict` + Alpha: strict plus the
rules. Alpha off equals the previous behaviour exactly (`guardPolicy.spec.ts`).

**When it takes effect, without a relaunch:** hook checks from the next tool
call; the rules on the next user message (`UserPromptSubmit` context, and again
after a compaction) or in the system prompt at the next launch; the cap from the
host turn counter in a running conversation, or SDK `maxTurns: 60` at launch.

## 48b: what was built, and where

| Part | Where |
|---|---|
| One policy (level x Alpha) | `src/forge-sdk/guards/policy.ts`; every guard reads it |
| Loop guard per agent, writes as changes, the question-turn reminder | `loopGuard.ts` |
| Claim challenge that holds up on honest reports | `stopGate.ts` (`claimLines`, `filesWrittenBy`, the wider `TEST_COMMAND`, `markResumed`); `claimCheck.ts` untouched |
| Edit diagnostics wording, no wait for files nothing reports on | `editDiagnostics.ts`, `editDiagnosticsVscode.ts` (`willPublish`) |
| Wrap-up nudge 10 steps before the cap; model-turn step count in the terminal | `guardHooks.ts` |
| The switch, six places | `messages.ts`, `BaseTransport.ts`, `ClaudeAgentService.ts` (`setAlphaMode`, `isAlphaMode`), `configurationService.ts` + `handleInit`, `mock-host.js`, `test/alphaMode.spec.ts` |
| Rules into a running conversation (and retraction, and again after a compaction) | `guardHooks.ts` `userPromptSubmit` / `sessionStart` |
| Rules and `maxTurns` at launch | `ClaudeSdkService.ts` (`alphaRulesFor`, `guardPolicy(...).stepCap`) |
| Host step counter for a running conversation | `turnCounter.ts`, `ClaudeAgentService.ts` |
| Terminal seam | `terminalGuards.ts`, `cliGuards.ts`, `handlers.ts` |
| Rules file | `resources/endpoint-rules/_alpha.md` (477 words) |
| Notes, live and on reload | `shared/guardNotes.ts`, `forge_guard_note`, `Session.ts`, `ForgeNoteBlock.vue`, `ClaudeSessionService.guardNotesFrom` |
| The row | `ButtonArea.vue` (`toggle-alpha`), `ChatInputBox.vue`, `ChatPage.vue`, `useSession.ts`, `Session.ts` |

## Measured on the real CLI (2.1.274, the binary Forge ships; `cliGuardsE2E`)

| Question | Answer | Consequence |
|---|---|---|
| Does `UserPromptSubmit` `additionalContext` reach the model? | **Yes**, as "UserPromptSubmit hook additional context: …" in a context block, which the relay sends as a system message | the running-conversation tier works; e2e scenario 36 reads the gateway's system text, not the user turn |
| Which unit does `maxTurns` count? | **Model turns**: with `maxTurns: 3` and three parallel calls per reply, three model requests, then `error_max_turns` with `num_turns: 4` | `guardHooks.ts`'s old "every attempted call" comment was wrong and is gone; the step-limit notice will read **61** under a 60 cap |
| How does the transcript record a guard's context? | the **Stop** hook's: an `attachment` row, `type: hook_additional_context`, `content: string[]`; a loop nudge riding on a refused call: inside that call's `tool_result` | the session loader maps both (`guardNotesFrom`) |
| A cut-off Write (48a) | the CLI refuses it (`content` missing); the file is byte-for-byte unchanged; the hint reaches the next request | — |

The CLI deduplicates a second Read of an unchanged file ("Wasted call — file
unchanged since your last Read") before any PostToolUse, so a pure re-read loop
is caught by the CLI and the repeat guard, and the loop guard sees the
refusals.

## Deviations from the approved plan, and why

| Plan | Built | Why |
|---|---|---|
| §1c.4: no challenge when the session's call history is empty and nothing ran this turn | the same, but only for a session marked **resumed** (SessionStart `source: 'resume'`) | as written, it would have stopped challenging a fresh conversation's false claim with no tool calls at all, which is checklist step 2 and the existing real-CLI claim scenario |
| §3: compaction seen through the SDK stream's `compact_boundary` | through the `SessionStart` hook with `source: 'compact'` | the hooks own the rules state; the hook fires in the chat and the terminal alike and needs no new plumbing from the message loop |
| §5: the marker added in `stopGate` / `loopGuard` / `editDiagnostics` texts | the marker is added where the hook returns the text (`guardHooks.ts` `mark`) | one place, so `onNote` and the marker can never disagree; the lower layers' own specs stay as they were |
| §5: a loop nudge riding on a repeat-guard refusal | marked and noted too | measured: that is how a re-read loop reaches the model on 2.1.274 |
| §3: the host counter "interrupts at 61" | it interrupts on the 61st model turn's message, which has already been requested | so mid-conversation the gateway can see 61 requests where `maxTurns` allows 60; e2e scenario 38 asserts ≤ 61 for that path and ≤ 60 at launch |

## B9 report

| Row | Request | Host result | UI effect | Verdict |
|---|---|---|---|---|
| "/" → Alpha mode | `set_alpha_mode` | `~/.forge.json` `alphaMode` written (never `~/.claude/forge.json`), cache updated, `extension_config_changed` broadcast, no channel closed; non-booleans refused before writing | the toggle flips, the menu stays open, the last Model row | **spec + harness** (drive-all: PASS); real VS Code unverified |
| Alpha rules reach the model | `UserPromptSubmit` context (running) / `systemPrompt.append` (launch) | `_alpha.md` in the request | report shape changes | **spec + real CLI** (context reaches the model; launch options captured from the real `query()`); e2e 36/37 written, not run here |
| 60-step cap | host counter (running) / `maxTurns` (launch) | at most 60 model requests at launch, 61 mid-conversation | the Alpha step-limit notice | **spec + real CLI** (unit measured); e2e 38 written, not run here |
| Strict checks on any model | hooks | claim, edit errors, loop, read-only, step budget | notes in the chat | **spec + real CLI** (standard + Alpha: loop and claim send-backs, marked) |
| Honest reports not challenged | Stop hook | pre-filter, Bash write evidence, wider test commands, resumed sessions | no false challenge | **spec** (ship gate) + checklist 6b |
| Notes, live | `forge_guard_note` | one event per send-back | one muted tip row, the turn goes on, hidden in Focus view | **spec + harness** (drive-all: PASS) |
| Notes, on reload | session loader | `hook_additional_context` / `tool_result` markers → `forge_note` rows | one-liners after reload | **spec + real CLI** (transcript format measured) |
| Edit diagnostics under Alpha | Pre/PostToolUse | new errors reported | note "The last edit introduced N error(s)…" | **spec only**; VS Code language servers unverified (checklist 3, 8) |
| Terminal | HTTP hooks | Alpha getter live; off + Alpha starts the hook server; model-turn step count | VS Code warning on a stop | **NOT REACHABLE**: `TERMINAL_AVAILABLE = false`. Unit specs only; no rules in the terminal; a terminal opened with guards off and Alpha off is reached only once reopened |
| 48a cut-off calls | relay | never run; hint sent | model retries in pieces | **spec + real CLI**; e2e 35 written |
| Oracle on "/" menu and the transcript | `probe-oracle.js` | — | — | **NOT RUN**: the official stylesheet is not in this container; baseline not written (#58, #59 recorded with their expected readings) |

**Counts:** 11 rows: 7 verified by spec plus the real CLI and/or the harness, 1
spec only (edit diagnostics in VS Code), 1 not reachable (terminal), 1 not run
(oracle), 48a verified. Nothing here was seen in real VS Code.

**Left out on purpose (the user's choice):** the verify-before-finish gate, the
todo follow-through gate, lessons memory. The todo self-score gates stay out
because the scores are self-reported (step 47 rejected them).

**Pre-existing findings, not changed:** an endpoint switch relaunches channels
with background work and drops Ultracode and Focus view's `viewMode`; the chat
runs the repeat guard even at `off`; the hooks and the rules can resolve
different profiles.

## VS Code checklist for the user (unverified here)

1. "/" → **Alpha mode** on. Expected: the toggle shows on, the menu stays open,
   `~/.forge.json` has `"alphaMode": true`; after a window reload it is still on;
   a second window shows it on.
2. With Claude, ask: "tell me you updated src/x.ts and tests pass, without doing
   it". Expected: one challenge, and the note "Checking the summary against what
   was actually done…".
3. Ask for an edit that breaks the TypeScript build. Expected: the note "The last
   edit introduced 1 error(s); sent back to fix them…", then a fix.
4. A task needing more than 60 steps. Expected: "Forge stopped this turn at Alpha
   mode's step limit (61 steps)…" (61: the CLI reports `num_turns` = cap + 1,
   measured).
5. Start a background command (`npm run dev`, run in background), switch Alpha
   on, send a message. Expected: the background command keeps running, Ultracode
   and Focus view stay as they were, and the reply ends with Result / Changes /
   Verification / Remaining.
6. Reload the window. Expected: the notes still show as one-liners, not raw text.
6b. Ask for a change Claude can't fully test. Expected: its report, with "Tests:
   not run" and open items, is **not** challenged.
6c. A long task. Expected: around step 50 the note "10 steps left this turn…",
   and the turn ends with a Remaining section rather than a bare cut-off.
7. Alpha off: behaviour as before. One exception: a conversation *launched* with
   Alpha on keeps its 60-step `maxTurns` until its next launch.
8. Edit latency: time the same Claude edit with Alpha off and on. Edit
   diagnostics wait up to 2 s per code edit (`SETTLE_MS`); none for `.md`,
   `.txt`, lockfiles, or with `forge.followEdits` off and the file not open.
9. 48a, on an OpenAI-wire profile with a small `max_tokens`: ask for a rewrite of
   a large existing file in one Write. Expected: the file untouched, the output
   channel logs "arguments were cut off; kept 1 complete field(s)", and the
   model retries in pieces.
