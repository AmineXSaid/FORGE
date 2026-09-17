# Step 25: Fork and "Message actions"

**Group:** 5  **Depends on:** 24

## Official
- `HU0`: the "Message actions" button on user messages (rewind-arrow icon, shown on hover). Options:
  1. "Fork conversation from here": `{type:"fork_conversation", forkedFromSession, resumeSessionAt}` → `{sessionId}`
  2. "Rewind code to here": `rewind_code` (step 24)
  3. "Fork conversation and rewind code"
- Read `HU0` for option visibility and order, and the host handler for `forkSession` / `resumeSessionAt`.

## Six places (B2)
- Handler: `forkedFromSession` is a known session; `resumeSessionAt` is a message in it;
  fork through the upgraded SDK; return `{sessionId}`.
- `test/forkConversation.spec.ts`: happy path, and rejection of unknown ids.

## Tasks
- [ ] After a fork, open the new session where the official does.
- [ ] Option 3 runs fork and rewind in the official order.
- [ ] Port the `HU0` button and menu into `UserMessage.vue` with the extracted icon.

## Validate
- [ ] Gates pass.
- [ ] Harness: hover a user message, click each option, and record the requests
      and the resulting session. Oracle: 0 structural diffs.

## VS Code checklist for the user
1. Fork from the second message. **Expected:** a new session holds history up to
   that message, and the original is unchanged on disk.
