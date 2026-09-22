# Step 25: Fork and "Message actions"

**Group:** 5  **Depends on:** 24

> **Corrected against the bundle and the installed SDK while implementing.** The
> corrections are marked **[was:]**; the reasoning is in
> [results/25-fork-and-message-actions.md](results/25-fork-and-message-actions.md).

## Official
- `HU0`: the "Message actions" button on user messages (rewind-arrow icon, shown
  on hover). It mounts as the **first child of the inner
  `div.userMessageContainer`**, and its `containerRef` is the **outer** row,
  whose hover reveals it. Options:
  1. "Fork conversation from here": `{type:"fork_conversation", forkedFromSession, resumeSessionAt}` → `{sessionId}`
  2. `uuid &&` "Rewind code to here": `rewind_code` (step 24)
  3. `uuid &&` "Fork conversation and rewind code"
- **[was: "Read `HU0` for option visibility".]** Now read: the gate is
  `let y=Z.uuid` — the **message's own uuid**, not a capability. A message
  without one has no checkpoint to rewind to and no point to fork at.
- Option 3's order is `G1`: `M(!1); if(await i() && w) s(); N(!1)` — rewind
  first, **fork only if the rewind succeeded**.
- `resumeSessionAt` is **not** the picked message. It is `I`, the nearest
  *earlier* user-or-assistant message with a uuid, so the fork stops before the
  prompt you picked and that prompt lands in the new conversation's composer.
  `!I` (the first message) means "start a new conversation" instead.

## Six places (B2)
- **[was: "fork through the upgraded SDK".]** Right, but the signatures differ
  and the step file did not say so: the official host goes through **its own
  store**, `forkSession(sessionId, upToMessageId)` — positional; the SDK's is
  `forkSession(sessionId, {dir?, upToMessageId?, title?})` returning
  `{sessionId}` (sdk.d.ts:770). Raised with the user, who chose the SDK.
- Handler: **[was: "`forkedFromSession` is a known session; `resumeSessionAt` is
  a message in it".]** The host cannot check either — it has no transcript. The
  official's *store* raises `Session … not found` / `Message … not found in
  session …` when it reads the file. Forge validates the **shapes** (B3) and
  lets the SDK raise the rest.
- `test/forkConversation.spec.ts`: happy path, and rejection of unknown ids.

## Tasks
- [x] After a fork, open the new session where the official does
      (`viewSession(newSessionId, promptText)` → `activateSessionFromServer`).
- [x] Option 3 runs fork and rewind in the official order.
- [x] Port the `HU0` button and menu into `UserMessage.vue` with the extracted icon.
- [x] **Carried over from step 24:** register the `rewind` row and mount the
      `yH0` picker, now that fork exists (B4).

## Validate
- [x] Gates pass.
- [x] Harness: hover a user message, click each option, and record the requests
      and the resulting session. Oracle: 0 structural diffs.

## VS Code checklist for the user
1. Fork from the second message. **Expected:** a new session holds history up to
   that message, and the original is unchanged on disk.
