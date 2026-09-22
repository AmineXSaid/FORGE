# Step 39: Endpoint diagnostics and capability probes

**Group:** 6 (self-hosted endpoints)  **Depends on:** 38

## Problem
Two different questions had no answer in Forge:

- **"Why doesn't this endpoint work?"** A bad key, a wrong port and an expired
  certificate all present identically as "the endpoint did not answer".
- **"What can this endpoint actually do?"** The capability block is a set of
  promises the UI relies on, and it was entirely guesswork. Declare
  `tools: true` against a gateway that drops the field and every turn silently
  falls back to text; declare `effort: true` against one that ignores
  `reasoning_effort` and the user gets four rungs that produce the same answer.

## Official
No official analogue. Ported from Genesis: `src/endpoints/check.ts`,
`src/endpoints/detect.ts`, `src/diagnostics/ladder.ts`.

## Tasks
- [x] `src/services/diagnostics/ladder.ts` — Profile → Certificates → DNS → TCP
      → TLS → Authentication → Completion → Streaming, each emitting live, each
      failure carrying a `fix`.
- [x] TLS-inspector recognition from the re-signing root (Zscaler, Kaspersky,
      FortiGate, mitmproxy, …).
- [x] `src/services/endpoints/check.ts` — `checkEndpoint`, `listModels`,
      `keepServable`.
- [x] `src/services/endpoints/detect.ts` — seven probes.
- [x] `src/services/endpoints/probeClient.ts` — runs requests through the same
      `toOpenAI` the relay uses, so a probe describes the real path.
- [x] Commands: `forge.runEndpointDiagnostics`, `forge.detectCapabilities`,
      `forge.listEndpointModels`.
- [x] Specs: `test/endpointDiagnostics.spec.ts` (29), against a real loopback
      gateway rather than a mocked dispatcher.

### The two probes beyond Genesis's five
**`reasoningField`** — which delta field carries reasoning. vLLM and
DeepSeek-shaped APIs use `reasoning_content`; OpenRouter and several
aggregators use `reasoning`. Guessing wrong renders a turn that spent its whole
budget thinking as an empty reply.

**`effort`** — the same prompt at `low` and at `high`, comparing reasoning
tokens (falling back to output tokens). If the amount of thinking barely moves,
the endpoint accepts `reasoning_effort` and ignores it, and the rows must be
hidden rather than shown and inert. Only the two rungs actually measured are
proposed: claiming `xhigh` from evidence about `high` would be inventing the
thing that decides whether Ultracode is offered.

### Why `keepServable` exists
Listing is not an answer. Genesis measured one NVIDIA account: of 101 ids from
`/v1/models`, 28 answered, 60 returned 404, 10 accepted the request and never
replied, 3 errored. The same shape appeared immediately on the test gateway —
602 models listed, and the first four providers tried returned 502 (missing
Playwright binary), 500, 403 and 502. A picker built on the raw list looks
authoritative while being wrong most of the time, and the hanging ids cost a
full timeout each to find by hand.

### Probes propose; they never write
`forge.detectCapabilities` shows the diff and writes only on **Apply**, and only
for settings-defined profiles — a YAML profile is not Forge's to rewrite, so the
block is handed over instead. The profile stays the source of truth.

## Validate
- [x] Gates pass: `vitest` 774 passed / 6 skipped, `typecheck:all`,
      `lint:forge` (23 commands).
- [x] Live sweep against omniroute produced
      `{"streaming":true,"tools":true,"parallelToolCalls":true,"vision":false,
      "reasoningField":"reasoning_content","effort":false}` — independently
      reproducing the 142-vs-143 reasoning-token measurement taken by hand in
      step 38, and matching the `reasoning_content` field seen in the raw SSE.

## VS Code checklist for the user
Unverified against real VS Code.

1. **Forge: Run Endpoint Diagnostics** against a working endpoint.
   **Expected:** every rung passes, filling in one at a time.
2. Point `baseUrl` at a wrong port. **Expected:** TCP fails with
   "Nothing is listening on port N", and DNS above it still passes — the first
   failure is the real one.
3. Break the credential. **Expected:** **Authentication** or **Completion**
   fails with a 401, not a generic timeout.
4. Run it from behind corporate antivirus. **Expected:** the TLS rung warns and
   names the product, with advice about streaming stalls.
5. **Forge: Detect Endpoint Capabilities** against an endpoint with no tool
   support. **Expected:** it proposes `tools: false` and writes nothing until
   you choose **Apply**.
6. Choose **Apply**. **Expected:** `forge.endpoints.<name>.capabilities` gains
   exactly the proposed keys, and the relay restarts.
7. **Forge: List Endpoint Models**, pick one. **Expected:** the id is verified
   with a real request before being recommended; a listed-but-dead id is
   reported as not answering rather than offered.
