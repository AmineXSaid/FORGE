# Step 04: Assistant status dot follows `p85` (done)

**Group:** 1 (Part A.4)  **Depends on:** nothing  **Type:** frontend logic
**Result:** [results/04-assistant-status-dot.md](results/04-assistant-status-dot.md)

## Problem
`AssistantMessage.vue` (~L54) falls back to `fg-chat__dotSuccess` for every message.

## Official `p85(message, busy)`
Read in `REF/webview/index.js` and ported literally. Only the **first** `tool_use`
of the message decides (the loop returns on it). `busy` is the session's
`busy` (`U?.busy ?? $.busy.value` in `Kt`), and `u85` maps the result to a class.

| Message | Result |
| --- | --- |
| no `tool_use` (text, thinking) | `null`: no status class |
| first `tool_use`, no result, not busy | failure |
| first `tool_use`, no result, busy | progress |
| first `tool_use`, `toolResult.is_error` | failure |
| otherwise | success |

**Correction:** a message with no status still has a dot. The official
`.timelineMessage:before` is drawn on every row (7px, `--app-secondary-foreground`);
the status classes only recolour it (`dotSuccess`, `dotFailure`) or make it blink
(`dotProgress`). So "no dot class" means the base grey dot, not "no `:before` dot".

## Tasks
- [x] Link each tool_use `id` to its tool_result: reused `processAndAttachMessage` → `wrapper.setToolResult`.
- [x] Pass the session's `busy` flag into `AssistantMessage.vue` (ChatPage → MessageRenderer, assistant rows only).
- [x] Add a pure `messageStatus(message, busy)` (`utils/messageStatus.ts`) plus `statusDotClass`.
- [x] `test/messageStatus.spec.ts`: one case for each table row, and more.

## Validate
- [x] Gates pass, and the new spec passes.
- [x] Harness: seed text-only, pending (busy), pending (idle), error and ok
      messages. The classes match the table, and the text-only message has no
      status class (the base grey `:before` dot remains, as in the official).
- [x] Oracle on `.fg-chat__timelineMessage`: text-only row 0 structural diffs; tool
      rows show the same diffs with every dot class and with none (tool components that already differed).

## VS Code checklist for the user
1. Run a turn that uses a tool. **Expected:** the dot pulses while it runs, then
   turns success. A plain text reply keeps the plain grey dot.
