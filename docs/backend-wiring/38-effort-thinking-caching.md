# Step 38: Effort, thinking and caching across the bridge

**Group:** 6 (self-hosted endpoints)  **Depends on:** 37

## Problem
The CLI's effort ladder, thinking toggle and cache breakpoints are all
client-side, so they keep *working* against any endpoint. What they stop doing
is *meaning* anything, unless the request is translated:

- the CLI puts a top-level `effort` on the wire (`sdk.d.ts:1807`), which an
  OpenAI-shaped gateway does not understand under that name;
- it emits `cache_control` breakpoints unconditionally, and a gateway that has
  never heard of the field rejects the whole request because of it;
- a thinking budget has no equivalent on endpoints with no budget knob.

## Official
`sdk.d.ts:1807` (`effort?: EffortLevel`), `:9127` (`ThinkingConfig`), and the
Anthropic effort docs it links. OpenAI's spelling is `reasoning_effort`.

## Tasks
- [x] `wire/reasoning.ts` — `effort` → `reasoning_effort`, filtered through
      `capabilities.effortLevels`; a thinking budget mapped to the nearest rung
      when no effort was named; the field omitted entirely when
      `capabilities.effort` is false.
- [x] `wire/caching.ts` — `stripCacheControl` with structural sharing,
      `keepsCacheControl`, and `prefixStabilityWarnings`.
- [x] `toOpenAI` emits `reasoning_effort`; `extraBody` merges last so a gateway
      that spells the field differently can override it.
- [x] `relay.ts` strips `cache_control` on the anthropic-wire passthrough
      unless the profile says the gateway acts on it, and logs the count.
- [x] Spec: `test/wireReasoning.spec.ts` (44).

### The downgrade direction
An unsupported rung is downgraded, never dropped. Dropping falls back to the
endpoint's default, which is usually weaker than every rung the user could pick
— so `xhigh` on a gateway that stops at `high` would produce *less* reasoning
than `medium`. That is the wrong way round and it would be invisible.

### Ultracode
Needs nothing here. It is `xhigh` plus CLI-side workflows, so it works by virtue
of the rung being in `effortLevels`.

### Why `effort` defaults to false
Measured against the live gateway: the same prompt at `reasoning_effort: low`
and `high` produced **142 and 143 reasoning tokens**. The endpoint accepts the
field and ignores it. A profile that assumed support would offer four rungs
that all produce the same answer, which is why the capability is opt-in and why
step 39's probe measures rather than asks.

## Validate
- [x] Gates pass: `vitest` 745 passed / 5 skipped, `typecheck:all`,
      `lint:forge`.
- [x] Live E2E still 5/5 after the change.
- [x] Prefix stability: an identical request serialises byte-identically, and a
      follow-up turn's body still starts with the previous turn's prefix.

## VS Code checklist for the user
Unverified against the real CLI.

1. Set `capabilities.effort: true` and `effortLevels: ["low","medium","high"]`,
   then switch effort low → high in the composer. **Expected:** the output
   channel shows the request carrying a changing `reasoning_effort`.
2. Set `effortLevels: ["low","medium"]` and pick `xhigh`. **Expected:** a
   warning that it was sent as `medium` — not a silent fallback.
3. Set `capabilities.effort: false`. **Expected:** the effort rows disappear
   from the composer (step 40 wires the gating) and no `reasoning_effort` is
   sent.
4. Run the same prompt at `low` and at `high` against your gateway and compare
   the reply length and latency. **Expected:** if they are identical, your
   endpoint ignores the field — set `effort: false`.
5. With `promptCaching: "none"` on an anthropic-wire profile, start a
   conversation. **Expected:** the channel reports
   `removed N cache_control marker(s)`.
6. With `promptCaching: "prefix"` on a vLLM or SGLang endpoint, run several
   turns. **Expected:** latency to first token drops after the first turn, and
   the server reports prefix-cache hits.
