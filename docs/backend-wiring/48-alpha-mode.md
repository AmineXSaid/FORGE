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

## Results

See the B9 report at the end of this file once each part is verified.
