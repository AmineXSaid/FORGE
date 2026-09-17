# Step 03: Streaming text marked partial

**Group:** 1 (Part A.3)  **Depends on:** nothing  **Type:** frontend wiring

## Problem
`TextBlock.vue` has `isPartialText` (~L28, `stablePart` ~L84), which implements
the official `wL0` rule, but `ContentBlock.vue` never passes it.

## Official
Read `wL0` and its call site in `REF/webview/index.js`. Confirm which flag
drives it (the content wrapper's partial or streaming state).

## Tasks
- [ ] In `ContentBlock.vue`, pass the wrapper's partial flag to `TextBlock` as `is-partial-text`.
- [ ] Check that the flag clears when the block completes, so the final render parses the full text.

## Validate
- [ ] Gates pass.
- [ ] Harness: stream a text block through the mock host in chunks that end
      inside an unclosed code fence and inside a table. Mid-stream, only the stable
      part renders. After completion, the full markdown renders.
- [ ] Oracle on the message: 0 structural diffs.

## VS Code checklist for the user
1. Ask for a long answer with a code block. **Expected:** no flashing half-rendered fences while streaming.
