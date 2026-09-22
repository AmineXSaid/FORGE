# Step 41: Report — Anthropic logic on self-hosted OpenAI-compatible endpoints

**Group:** 6  **Covers:** steps 36–40 and the six alphacode ports (A1–A6)

Per B9. Counts are exact; nothing partial is rounded up to "works".

## What shipped

| Row | Request / entry point | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| `forge.endpoints` map | `settings.json` | `parseProfileMap` → same validator as YAML | IntelliSense, enum validation, hover docs | **works** (specs + schema drift guard) |
| `forge.endpointProfile` | `settings.json` | selects the active profile | picker + relay target | **works** |
| `forge.endpointProfilesDir` | `settings.json` | secondary YAML source | — | **works** |
| Profile precedence | — | settings wins, collision logged | — | **works** (spec) |
| **Forge: Show Endpoint Status** | `forge.endpointStatus` | re-scans both sources; prints profile, transport, gating caps, parse errors | output channel | **works** (unverified in real VS Code) |
| `/v1/messages` (openai wire) | CLI → relay | `toOpenAI` → gateway → `fromOpenAI` | full agent loop | **works** (live E2E) |
| `/v1/messages/count_tokens` | CLI → relay | answered locally, heuristic | compaction decisions | **works** (live E2E) |
| Tool-call streaming | — | fragmented args → `input_json_delta`, index remapped | tools execute | **works** (live E2E) |
| `stop_reason` | — | `tool_calls` → `tool_use` | loop continues | **works** (live E2E) |
| `usage` passthrough | — | read after `finish_reason` | auto-compaction fires | **works** (live E2E) |
| Model-id diagnostic | — | logs each distinct id once, mapped/unmapped | output channel | **works** (unverified against a real CLI session) |
| `modelMap` | profile | rewrites ids outbound | — | **works** (spec) |
| `reasoning_effort` | profile `capabilities.effort` | `effort` → `reasoning_effort`, filtered by `effortLevels` | effort rows | **works** (spec); **endpoint honouring it is per-gateway** |
| Thinking budget | — | mapped to nearest rung | thinking blocks | **works** (spec) |
| `cache_control` stripping | `promptCaching` | removed unless `anthropic`, count logged | — | **works** (spec) |
| **Forge: Run Endpoint Diagnostics** | `forge.runEndpointDiagnostics` | 8-rung ladder, live, each failure with a fix | notification + channel | **works** (unverified in real VS Code) |
| **Forge: Detect Endpoint Capabilities** | `forge.detectCapabilities` | 7 probes → proposed patch | modal diff, writes only on Apply | **works** (live sweep) |
| **Forge: List Endpoint Models** | `forge.listEndpointModels` | `/models` + servability check | quick pick | **works** (unverified in real VS Code) |
| `supportedModels` | `sdk_probe` | profile rows replace the CLI table | picker shows real ids | **works** (spec); **unverified in real VS Code** |
| Capability gating | — | intersection of model claim and capability evidence | effort / fast-mode / Ultracode rows | **works** (spec); **unverified in real VS Code** |
| A6 repeat guard | `PreToolUse` / `PostToolUseFailure` | two-tier refusal with explanation | denial text in transcript | **works** (spec); **unverified against a real CLI** |
| A1 spawn retry | `ClaudeSdkService.query` | transient codes only | — | **works** (spec) |
| A5 smart-stream | `PostToolUse` | budget from `contextWindow`, full copy kept | abridged tool output | **works** (spec); **unverified against a real CLI** |
| A2 watchdog | channel lifecycle | advisory stall notice + Stop action | VS Code notification | **works** (spec); **unverified in real VS Code** |
| A3 command risk | `canUseTool` | assess + gate before the permission RPC | risk note, pre-selected default | **works** (spec); **unverified in real VS Code** |
| A4 claim checker | webview | claims vs tool history | badge on the final message | **works** (spec); **unverified in real VS Code** |

**Counts:** 5 phases, 6 ports, 11 commits, 6 new commands→3 (`runEndpointDiagnostics`,
`detectCapabilities`, `listEndpointModels`), **1087 unit tests + 6 live E2E**,
`typecheck:all` / `lint:forge` / `build` clean.

## Left out deliberately

| Not built | Why |
| --- | --- |
| Cost and spend tracking | Explicitly out of scope: self-hosted models on company servers |
| Real thinking signatures | Anthropic signs and verifies them; a placeholder goes out and is stripped inbound. **Untested against a CLI that validates locally** |
| Anthropic account / OAuth rows | No Anthropic account exists behind a gateway profile |
| `keepServable` over a whole model list | 602 ids would mean 602 completions; wired for the picked id only |
| Fuzzy (Levenshtein) dedup in A5 | Normalised-key dedup catches the real case (counters, timestamps) at a fraction of the cost |
| A4 filesystem verification | Tool history alone covers the high-signal claims; `handleStatPath` remains available if it proves insufficient |

## Measured in the harness and against the real CLI (2026-09-20)

Driven in the ui-parity harness and with the bundled binary, after the first
report was written. Three of these corrected a claim in it.

| Question | Measured | Verdict |
| --- | --- | --- |
| Does the transcript paint 10k lines? | 10,000 lines → **11 DOM line nodes**, body text 711 chars | **No** — `useLineCollapse` slices. The earlier report said otherwise and was **wrong** |
| Does expanding stay bounded? | 4,370 → **24,350 nodes** on "Show 9,990 earlier lines" | **No** — unbounded, no virtualisation (pre-existing) |
| Is the full text parsed before collapse? | `ansiLines(parsed.value.text)` parses all lines, then slices | **Yes** — full parse cost is always paid (pre-existing) |
| Does `updatedToolOutput` change the transcript? | stream carries `ORIGINAL`, not the rewrite | **No** — A5 is model-only; no UI regression |
| Did smart-stream run on Bash? | `tool_response` is `{stdout,stderr,…}`, not a string | **No — it was dead code.** Fixed in `c069024`, verified: 3,111 lines → 134 chars |
| Risk note (#6) oracle | 201→207 checked, 191→186 clean; +10 rows, all its own elements plus a 13.8px cascade | **No regression** to official surfaces |
| Claim badge (#7) | fires on 2-of-4 claims; silent when work was really done, on an honest failure, and on a plan | **Correct both ways** |

The oracle baseline for the permission dialog **without** the risk note is
**8 structural rows / 191 of 201 clean** — all pre-existing and already
documented (Forge wordmark, send-icon sparks, empty-state banner).

## What the agent could not verify

**No step here has been run inside real VS Code.** The agent cannot observe the
extension host, so every row marked *unverified* above rests on specs, the
harness, and the live-gateway E2E.

Two gaps in the original version of this section have since closed: the real
`claude` binary **was** driven end to end (the `updatedToolOutput` probe, which
is what found the A5 bug), and `probe-oracle.js` **was** run against the
permission dialog. What remains unverified:

- the oracle was **not** run on the claim-badge (#7) surface;
- nothing was exercised through the real VS Code extension host — only through
  the harness and direct SDK calls;
- thinking signatures still use a placeholder, untested against a CLI that
  validates them locally.

## Known, not fixed

| Gap | Impact | Pre-existing? |
| --- | --- | --- |
| Expanding a long tool result renders every line (24k nodes for 10k lines) | Jank on very large logs, and only when the user clicks expand | Yes |
| Full output is ANSI-parsed and re-serialised even while collapsed | CPU and memory per render of that message | Yes |
| The webview's collapse limit is a constant, not derived from `contextWindow` | The host-side budget adapts to the endpoint; the UI limit does not | The asymmetry is new, the constant is not |

## VS Code checklist

Each step's own file carries its detailed checklist (36–40). The short path to
convince yourself the core works:

1. Add a profile to `settings.json` pointing at your gateway, set
   `forge.endpointProfile`. **Expected:** IntelliSense while typing; the output
   channel shows the relay line on the next turn.
2. **Forge: Run Endpoint Diagnostics.** **Expected:** all rungs pass.
3. **Forge: Detect Endpoint Capabilities**, accept the patch. **Expected:**
   `capabilities` gains exactly the probed keys.
4. Ask "list the files here". **Expected:** the tool runs and the turn ends
   normally — the whole bridge in one step.
5. Open the model picker. **Expected:** your gateway's ids, not Claude tiers.
6. Run a long session. **Expected:** compaction fires.
7. Type `rm -rf ~` in the composer. **Expected:** refused, with the reason.
8. **Unset `forge.endpointProfile` and re-run the existing steps 1–35
   checklist.** Everything must behave exactly as before — that regression gate
   is the one that matters most.
