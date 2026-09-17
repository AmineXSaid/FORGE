# Step 04: Assistant status dot follows `p85`

**Group:** 1 (Part A.4)  **Depends on:** nothing  **Type:** frontend logic

## Problem
`AssistantMessage.vue` (~L54) falls back to `fg-chat__dotSuccess` for every message.

## Official `p85(message, busy)`
Read it in `REF/webview/index.js` and port it literally:

| Message | Result |
| --- | --- |
| text only (no `tool_use`) | `null`: no dot class |
| `tool_use`, no result, not busy | failure |
| `tool_use`, no result, busy | progress |
| `toolResult.is_error` | failure |
| otherwise | success |

## Tasks
- [ ] Link each tool_use `id` to its tool_result (reuse the existing store mapping if there is one).
- [ ] Pass the session's `busy` flag into `AssistantMessage.vue`.
- [ ] Add a pure `messageStatus(message, busy)` that returns the ported class or nothing.
- [ ] `test/messageStatus.spec.ts`: one case for each table row.

## Validate
- [ ] Gates pass, and the new spec passes.
- [ ] Harness: seed text-only, pending (busy), pending (idle), error and ok
      messages. The classes match the table, and the text-only message has no `:before` dot.
- [ ] Oracle on `.fg-chat__timelineMessage`: 0 structural diffs.

## VS Code checklist for the user
1. Run a turn that uses a tool. **Expected:** the dot pulses while it runs, then
   turns success. A plain text reply has no dot.
