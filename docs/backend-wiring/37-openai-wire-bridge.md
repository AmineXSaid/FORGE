# Step 37: The OpenAI wire bridge

**Group:** 6 (self-hosted endpoints)  **Depends on:** 36

## Problem
`relay.ts` forwards bytes; it does not translate. `grep wire src/services/endpoints/relay.ts`
returned nothing before this step. So Anthropic-wire gateways worked and
OpenAI-wire endpoints did not, because the CLI only ever emits `/v1/messages`.

The goal is to keep 100% of the Anthropic client logic and swap only the model.
A CLI experiment already established the key fact: pointing `ANTHROPIC_BASE_URL`
at a custom endpoint leaves the feature set intact, because effort, thinking,
ultracode and workflows are **client-side**, driven by the CLI's own model
table. The CLI therefore needs no modification at all — only a translation layer.

## Official
No official analogue. The reference for the message shapes is Genesis's outbound
packer, `kryptonite/src/providers/client.ts` — `packOpenAiMessages` (:711),
`toOpenAiMessage` (:732), `openAiStream` (:846). Genesis runs those outbound from
its own loop; the relay needs the inverse parse as well.

## Tasks
- [x] `wire/toOpenAI.ts` — Anthropic request → `chat/completions`: system per
      `capabilities.systemRole`, content blocks, `tool_use` → `tool_calls`,
      `tool_result` → `role: "tool"`, `input_schema` → `parameters`, sampling,
      `extraBody`.
- [x] `wire/fromOpenAI.ts` — OpenAI SSE → Anthropic SSE, as an explicit state
      machine, plus `SseDecoder` for network chunk boundaries.
- [x] `wire/anthropicServer.ts` — serve `/v1/messages` and
      `/v1/messages/count_tokens`; the latter answered locally because OpenAI
      has no such route and a 404 makes the CLI treat the context as unbounded.
- [x] `wire/errors.ts` — error-shape mapping, with HTTP statuses passed through.
- [x] `relay.ts` branches on `profile.wire`; `anthropic` keeps today's
      passthrough.
- [x] Model-id diagnostic: every distinct id the relay receives is logged once,
      flagged as mapped or unmapped, so `modelMap` is filled in from evidence
      rather than guesswork.
- [x] Specs: `test/wireBridge.spec.ts` (53), `test/wireServer.spec.ts` (42),
      `test/endpointE2E.spec.ts` (5, opt-in against a live gateway).

### The two gotchas the plan called out
**Tool-call streaming fidelity.** OpenAI fragments `function.arguments` on a
*tool* index; Anthropic wants `input_json_delta` inside a *block*-indexed
`tool_use`. The two index spaces differ — OpenAI tool 0 is Anthropic block 1
when a text block took index 0 first. Arguments arriving before the function
name are buffered, because the block cannot open without a name.

**`stop_reason`.** `finish_reason: "tool_calls"` → `stop_reason: "tool_use"`.
Additionally, a turn that *did* emit tool calls reports `tool_use` even when the
gateway wrongly says `stop` — observed behaviour, and trusting it strands the
call.

### One bug the fixtures missed
Usage arrives **after** `finish_reason`, which is the ordinary OpenAI shape:

```
{"choices":[{"delta":{},"finish_reason":"stop"}]}
{"choices":[],"usage":{"prompt_tokens":60,"completion_tokens":31}}
[DONE]
```

Emitting `message_delta` on `finish_reason` reported **zero tokens for every
streamed turn**, so auto-compaction would never fire and a long session would
die on a context-overflow 400. Caught against the live gateway, not by a
fixture. Content blocks now close at `finish_reason`; the message frames wait
for the stream to end. Pinned by three regression specs.

## Validate
- [x] Gates pass: `vitest` 701 passed / 5 skipped, `typecheck:all`,
      `lint:forge`, `build`.
- [x] Live E2E against omniroute (`http://localhost:20128/v1`, model
      `auto/best-fast` → `qwen3.8-omni-flash`): 5/5 — `count_tokens`, a
      non-streamed turn, a streamed turn with non-zero `input_tokens` **and**
      `output_tokens`, a real tool call whose reassembled fragments parse as
      JSON and report `stop_reason: tool_use`, and an upstream failure passed
      through with its status intact.

## VS Code checklist for the user
Unverified against the real CLI — the agent cannot observe VS Code, and these
steps exercise the spawned `claude` binary rather than the relay alone.

1. Put a profile in `settings.json` pointing at your gateway, set
   `forge.endpointProfile` to its name, and start a conversation.
   **Expected:** the output channel shows `[relay] <name>: http://127.0.0.1:<port> -> <baseUrl>`.
2. Ask "list the files here". **Expected:** the Read/Bash tool actually runs, the
   loop continues, and the turn ends normally. This is the tool-call translation
   working end to end.
3. Check the output channel for `model "<id>" sent through unmapped`.
   **Expected:** one line per distinct id. Any id your gateway rejects goes in
   `modelMap`.
4. Run a long conversation until it compacts. **Expected:** compaction fires —
   which proves the `usage` passthrough, since compaction is driven by it.
5. Point a profile at a wrong port. **Expected:** the error names
   `ECONNREFUSED` and says nothing is listening, rather than a generic failure.
6. Unset `forge.endpointProfile`. **Expected:** the full existing
   `docs/backend-wiring/` checklist still passes unchanged.
