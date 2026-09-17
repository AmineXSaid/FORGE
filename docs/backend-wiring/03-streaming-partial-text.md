# Step 03: Streaming text marked partial (done)

**Group:** 1 (Part A.3)  **Depends on:** nothing  **Type:** frontend wiring
**Result:** [results/03-streaming-partial-text.md](results/03-streaming-partial-text.md)

## Problem (corrected against the bundle)
The original statement ("`ContentBlock.vue` never passes `isPartialText`") was
only the visible end of it. There was **no partial state to pass**:
- the host forwards every SDK `stream_event` (`includePartialMessages: true`), but
  `Message.fromRaw` dropped them, so a reply only appeared when its final
  `assistant` message arrived;
- `ContentBlockWrapper` had no `partial` flag, so `isPartialText` could never be true.

## Official
- `Nn0` (content renderer): text → `r$({content, isPartialText: $.isPartial})`;
  `tool_use` → `null` while `isPartial && !toolResult`; thinking →
  `isCurrentlyThinking: $.isPartial`.
- `r$` applies `wL0` (split on `/\n\n+/`, drop the last part) when `isPartialText`.
- `kJ` (content wrapper): `partial`, `complete()`, `updated()`, `key = hash + lastModifiedTime`.
- `y51` / `pR1` (stream assembler, one per `parent_tool_use_id`):
  `message_start` resets; `content_block_start` creates `new kJ(block, true)` in a
  **new assistant row** (`createMessage(message.id, parentToolUseId)`);
  `content_block_delta` applies `Bj0` and calls `updated()`; `content_block_stop`
  calls `complete()` and `Kj0` (parse tool input JSON); `message_stop` clears.
- `ZM(messages, msg, hasStreamingMessages)`: a final `assistant` message with a
  uuid replaces the row with the same uuid, else the first row with the same
  `betaMessageId`, no uuid, the same first block type, and not blank text.
- `_Z.isEmpty`: also empty when every block is a partial `tool_use`, or blank text
  (`GU`: empty or `"(no content)"`).
- Session: `retireAbandonedStreamedRows` on a new root `message_start`, or on a
  final root message for a different API message (retry).
- Chat view: before each `messages` update it records whether the view is within
  50px of the bottom, and after the render it calls `my(Q)` (`scrollTop = scrollHeight`).

## Tasks
- [x] Port the assembler (`models/StreamAssembler.ts`), the wrapper state
      (`ContentBlockWrapper.partial/revision/complete/updated`), `ZM`
      (`processAndAttachMessage`), `isEmpty`, and the abandoned-row retirement (`Session.ts`).
- [x] `ContentBlock.vue` passes the wrapper's partial flag to `TextBlock` as
      `is-partial-text` (and `streaming` to `ThinkingBlock`), and hides a partial `tool_use`.
- [x] The flag clears on `content_block_stop`, and the final message replaces the
      row with a non-partial one, so the final render parses the full text.
- [x] Keep the transcript pinned while text grows (the chat view's 50px rule);
      without it the streamed text grows below the fold.

## Validate
- [x] Gates pass.
- [x] Harness: stream a text block through the mock host in chunks that end
      inside an unclosed code fence and inside a table. Mid-stream, only the stable
      part renders. After completion, the full markdown renders.
- [x] Oracle on the message: 0 structural diffs caused by this step (1 row that
      already existed: `pre` uses the brand mono font; it shows on a non-streamed message too).

## VS Code checklist for the user
1. Ask for a long answer with a code block. **Expected:** no flashing half-rendered fences while streaming.
