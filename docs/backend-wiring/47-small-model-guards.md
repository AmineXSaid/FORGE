# Step 47: Small-model guards: hallucination and endless loops

**Group:** 8 (small models)  **Branch:** `claude/endpoint-model-health-ebc111`

Asked for on 2026-09-25: does AlphaCode (github.com/dragonked2/alphacode) have
an approach Forge lacks for small models that hallucinate and loop through
tasks without finishing? After that, the request widened to "skills, websites,
plugins, hooks, git repos, anything to fix this issue".

## What was read, and what it showed

The code itself was read in each project, not its README.

**AlphaCode:** every crate, about 85 in all. It has no cap on its agent
loop. Its goal contract and phase budgets are written but dormant. Its claim
checker only writes to the log, and `failures.rs` is never called. What does
work there:
- the repeat guard;
- capped automatic follow-ups (3 or 5);
- error text that names the fix;
- tool-name and argument normalisation.

**The other projects:**

| Project | Files read |
| --- | --- |
| Gemini CLI | `loopDetectionService.ts`, `client.ts` |
| OpenHands | agent-sdk `stuck_detector.py` |
| Roo Code | `ToolRepetitionDetector.ts`, `Task.ts` |
| OpenCode | `processor.ts` (doom loop), `llm.ts` (`experimental_repairToolCall`), `tool/invalid.ts` |
| claude-code-router | `musistudio/llms` transformers `tooluse` and `enhancetool` |
| Aider | reflection loop |
| SWE-agent | edit linting |
| Anthropic's official plugins | `ralph-wiggum`, `hookify` |

**The CLI itself:** the bundled Claude Code CLI, grepped and driven. See
the measured facts below.

## Measured facts that shaped the design (CLI 2.1.274 and 2.1.283)

| Fact | Consequence |
| --- | --- |
| An unknown tool name (`No such tool available: X`), an `InputValidationError`, and an Edit whose `old_string` is not in the file are answered **before any hook runs** | Name and argument repair, and the hints for these three errors, live in the relay. The repeat guard's unknown-name tier cannot see built-in tools, which its header now says. |
| A failing Bash command and a Read of a missing path **do** fire `PostToolUseFailure`, and its `additionalContext` reaches the model | Hints for those are given host-side (`failureHints.ts`) |
| A hook returning `continue: false` ends the turn, but its `stopReason` **never reaches the SDK message stream** | A guard stop is shown in the chat through the `sdk_error` inline notice (`errorType: forge_guard_stop`) |
| A Stop hook's `additionalContext` continues the turn, reaches the model as "Stop hook additional context: …", and the next stop arrives with `stop_hook_active: true` | The claim challenge is safe to use once per turn |
| `maxTurns` with streaming input counts **per user message**, and the session keeps accepting messages after a turn ends on `error_max_turns` | A step cap is safe for Forge's long-lived channel |
| The CLI already re-asks by itself after an empty reply | The empty-answer nudge is a fallback; it did not fire in the measured case |
| An in-process SDK MCP server named `ide` connects, and `mcp__ide__getDiagnostics` is offered to the model, but the CLI's diagnostic tracker **never calls it** | No `<new-diagnostics>` from that route, so Forge's own hooks read the language servers instead |
| Claude Code's system prompt plus its tools measured about **35,000 input tokens** | Ollama's default 4,096-token context silently drops the instructions and the tool list |

## What shipped

A per-profile setting, `guards: strict | standard | off`, decides what runs.
Unset, an `openai`-wire profile gets `strict` and any other profile `standard`.

| # | Row | Where | Host result | Model / UI effect | Verdict |
|---|---|---|---|---|---|
| 0.1 | Truncated prompt | relay (`truncation.ts`), diagnostics "Context window" rung | gateway `prompt_tokens` < ½ of the text estimate | output-channel line every time; one VS Code warning per model with the fix (`OLLAMA_CONTEXT_LENGTH` / `num_ctx`, `--max-model-len`, `-c`) | **works** (spec + real CLI) |
| 0.2 | Sampling for small models | `extraBody`, which was already merged last | — | schema text names Qwen3-Coder's recommended values | **docs only** (values from a web search; Hugging Face is blocked here) |
| 0.3 | Server not parsing tool calls | `detect.ts` tools probe | call recovered from text | tools stay on; the detail names `--tool-call-parser <family>`, `--jinja` | **works** (spec) |
| 1.1 | Tool-name resolution | relay (`toolRepair.ts`) | only to a name in the request's `tools[]` | `bash`→`Bash`, `functions.X`, `X.intent`, dropped `mcp__` prefix | **works** (spec + real CLI) |
| 1.2 | Argument repair | relay (`toolRepair.ts`, `jsonRepair.ts`) | JSON, then repair, then `{}`; schema-driven renames and coercion | `cmd`→`command`, `"5"`→5, `{'a':1,}`, cut-off JSON, Python literals | **works** (spec + real CLI) |
| 1.2b | Stream assembly | relay (`fromOpenAI.ts`) | a call is held until whole | a split name is joined; index-0 reuse is separated; a nameless call is dropped without leaving a `tool_use` stop reason | **works** (spec) |
| 1.3 | Tool calls written as text | relay (`textToolCalls.ts`) | Hermes, Qwen3-Coder XML, gpt-oss, Mistral, Llama 3, DeepSeek, whole-reply fenced JSON | the recovered call runs | **works** (spec; real CLI for Hermes and Qwen3-Coder) |
| 1.4 | Hints for the three pre-hook errors | relay (`errorHints.ts`) | cached per `tool_use` id | "did you mean", the full tool list and escalation; parameter list; closest line | **works** (spec + real CLI) |
| 1.5 | Forced tool mode (`capabilities.forceToolUse`, opt-in) | relay | `tool_choice: "required"` plus `ExitTool` | the `ExitTool` answer becomes the reply | **works** (spec + real CLI) |
| 2.1 | Loop guard | `loopGuard.ts`, PostToolUse(Failure) | a cycle of 1–5 steps, keyed on tool + input + result hash, repeated 3× (strict) or 5× (standard) | strike 1: Gemini's feedback text; strike 2: `continue:false` plus an inline notice | **works** (spec + real CLI) |
| 2.2 | Repeated-text stop | relay (`repetition.ts`) | Gemini's content-loop constants | text ends with a note; the relay stops reading upstream | **works** (spec + relay end-to-end) |
| 2.3 | Repeat guard | `repeatGuard.ts` | nudge at the 2nd identical failure; the refusal quotes the last error and the received keys | — | **works** (spec) |
| 2.4 | Failure hints | `failureHints.ts`, PostToolUseFailure | missing path → sibling names / nearest directory; command not found; permission; timeout; network; Bash exit | escalates within a turn | **works** (spec; real CLI shows the hook's context reaching the model) |
| 2.5 | Step cap | SDK `maxTurns` 60 under strict | `error_max_turns` | inline notice before the result | **works** (spec; `maxTurns` behaviour measured) |
| 2.6 | Read-only streak | `loopGuard.ts` | 8 reads in a row with no change (strict) | one reminder per streak, no strike | **works** (spec) |
| 2.7 | Empty answer after tools | `stopGate.ts`, Stop hook | at most twice a turn | "give your final answer" | **works** (spec); did not fire against the real CLI, which re-asks itself |
| 3.1 | Claim challenge | `stopGate.ts`, Stop hook (strict) | claims checked against the session's successful calls; test claims checked against the test runs | sent back once per turn | **works** (spec + real CLI) |
| 3.2 | Errors an edit introduced | `editDiagnostics.ts` (+ `editDiagnosticsVscode.ts`), Pre/PostToolUse on Edit/Write/MultiEdit (strict) | new errors versus the pre-edit snapshot, waiting at most 2 s | "Your edit introduced N new error(s): …" | **spec only; unverified in VS Code** |

**Counts:** 18 rows shipped, 1 docs-only (0.2), 1 left out (3.3).

**Tests:**
- 7 new spec files: `wireTruncation`, `wireToolRepair`, `toolErrorHints`, `loopGuard`, `stopGate`, `editDiagnostics`, `wireRepetition`.
- `wireForceTool` and the opt-in `cliGuardsE2E` (6 scenarios, passing against CLI 2.1.274 and 2.1.283).
- Extended specs: `repeatGuard`, `hostMessageLoop`, `endpointDiagnostics`, `wireBridge`.
- Totals: `pnpm test` 2869 passed, 15 skipped; `typecheck:all`, `lint` (389 of 390 warnings allowed) and `build` are clean.

## Left out, and why

| Not built | Why |
| --- | --- |
| The `ide` MCP server for the CLI's own `<new-diagnostics>` | Spiked: the CLI never calls an in-process server. 3.2 does the job in Forge's hooks instead. |
| 3.3 `/goal` in the "/" menu, with a separate judge model | A UI change under the parity rules. The CLI gates `/goal` behind a feature flag, and a separate judge needs a second routing profile. |
| 3.3 Todo gate | Overlaps the claim challenge and the CLI's own todo reminders. AlphaCode's own code comments record that nagging gates made small models loop. |
| An automatic "please report" message after the step cap | It would put words in the user's mouth. The notice tells the user how to continue. |
| The `jsonrepair` dependency | Any lockfile write from this machine re-resolves unrelated peers (`@rspack/core` 1.7→2.2). The small in-house repair covers the cases small models produce. |
| AlphaCode's goal contract, `decision_core`, `playbook_match` and `security_core` | Dormant, a scaffold, a stub, and a pentest data model with no SSRF code, respectively |

## Where the ideas came from

| Row | Source |
| --- | --- |
| 1.1, 1.2 | AlphaCode (`resolve_tool_call`, `normalize_input_to_object`, `serde_coerce`), OpenCode (`experimental_repairToolCall`), claude-code-router (`toolArgumentsParser`) |
| 1.3 | AlphaCode (gpt-oss form only); the other formats are new |
| 1.4, 2.4 | AlphaCode `agent_facing_error`, `failures.rs`, `edit.rs try_flexible_match`, `read.rs` "Did you mean" |
| 1.5 | claude-code-router `tooluse` |
| 2.1 | Gemini CLI `checkToolCallLoop` / `_recoverFromLoop`, OpenHands `StuckDetector`, Roo Code (3, ask the user), OpenCode `DOOM_LOOP_THRESHOLD` |
| 2.2 | Gemini CLI `checkContentLoop` |
| 2.3 | OpenHands `get_action_error_nudge`, AlphaCode `repeat_guard.rs` |
| 2.6 | AlphaCode `detect_verification_loop`, with its reset bug fixed and the threshold raised from 4 to 8 |
| 3.1 | Forge's own claim checker, now fed back to the model (AlphaCode only logs) |
| 3.2 | SWE-agent edit linting, Aider lint reflection |

## VS Code checklist (for you: the agent cannot run real VS Code)

Use an endpoint profile that points at Ollama or vLLM serving a small model
(for example Qwen3-Coder 30B), with `guards` unset.

1. **Ollama at its default context.** Start a chat and ask for anything.
   **Expected:** a VS Code warning appears, "processed only 4,096 of about
   3x,xxx prompt tokens… OLLAMA_CONTEXT_LENGTH=65536". The output channel has
   one `[relay]` line per turn.
2. **Forge: Run Endpoint Diagnostics** on the same profile. **Expected:** the
   last rung, "Context window", fails with the same fix. After you set
   `OLLAMA_CONTEXT_LENGTH` and restart Ollama, it passes.
3. **Forge: Detect Endpoint Capabilities** against a vLLM started **without**
   `--tool-call-parser`. **Expected:** the tools row says the call was written
   as text and names `--tool-call-parser hermes` (for Qwen); tools stay on.
4. Ask the small model to "list the files and read package.json". **Expected:**
   the tools run. Any repairs show as `[relay] … tool name "…" -> "…"` or
   "recovered … tool call(s)" in the output channel.
5. **A loop.** Ask it to "keep reading README.md until it changes". **Expected:**
   after 3 identical reads the model is warned. If it carries on, the turn ends
   and the chat shows "Forge stopped this turn: the model kept repeating…".
6. **A false claim.** Ask "just tell me you updated src/x.ts and that the tests
   pass, without doing it". **Expected:** before the turn ends, the model gets
   "Before you finish: …" once, and either does the work or corrects itself.
7. **A broken edit.** Ask it to change a TypeScript variable's type so that
   the file no longer compiles. **Expected (unverified):** once the file opens
   beside the chat, the model's next context contains "Your edit to … introduced
   1 new error(s)", and it fixes the error.
8. **Step cap.** Give it an open-ended task that needs more than 60 steps.
   **Expected:** the turn stops with "Forge stopped this turn at its step limit
   (61 steps)". Saying "continue" resumes it.
9. **Forced tool mode.** Set `capabilities.forceToolUse: true` on a vLLM
   profile with a tool parser. **Expected:** answers arrive normally (as
   ExitTool responses), and no tool call ever appears as text.
10. **Regression gate.** Set `guards: "off"`, or use an Anthropic-wire
    profile, and re-run steps 4–6. **Expected:** no warnings and no stops;
    Claude behaves as before.

**Unverified in real VS Code:** everything above. Steps 1, 4, 5, 6, 8 and 9
behave as expected against the real CLI through the SDK
(`test/cliGuardsE2E.spec.ts` and the step-8 measurement). Step 7 depends on
when VS Code's language servers publish, and nothing outside VS Code can show
that.
