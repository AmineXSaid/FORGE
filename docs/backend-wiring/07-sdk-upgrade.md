# Step 07: Upgrade the Agent SDK to the latest version

**Group:** 2 (B5)  **Depends on:** 06  **Blocks:** every feature step

## Facts
- Installed: `@anthropic-ai/claude-agent-sdk` 0.1.77 (package.json `^0.1.76`).
- `CLAUDE.md` notes 0.3.273 on npm when it was written. **Take the latest** (`npm view @anthropic-ai/claude-agent-sdk version`).

## Tasks
- [ ] Read the changelog between 0.1.77 and the target version. List every
      breaking change to types, `query()` options, `Query` methods and the message stream.
- [ ] Update `package.json` and the lockfile (`pnpm install`).
- [ ] Re-verify every consumer against the new `.d.ts` (read it; don't assume):
  - `src/services/claude/ClaudeSdkService.ts`
  - `src/services/claude/ClaudeAgentService.ts`
  - `src/services/claude/cliArgs.ts`
  - `src/services/claude/handlers/handlers.ts`
  - `src/shared/messages.ts`
  - `src/webview/src/transport/BaseTransport.ts`
  - `core/Session.ts`, `core/PermissionRequest.ts`, `composables/useSession.ts`
  - the `.vue` files that import SDK types: `ButtonArea`, `ChatInputBox`,
    `ModeSelect`, `WaitingIndicator`, `ChatPage`
- [ ] Update `cliArgs.ts` PROTOCOL / MANAGED sets if the new SDK derives more
      flags from options. Update `test/cliArgs.spec.ts` to match.
- [ ] Record the APIs later steps use, exactly as the new `.d.ts` spells them:
      `rewindFiles`, `forkSession`/`resumeSessionAt`,
      `setMaxThinkingTokens(budget, display)`, settings APIs, effort option,
      `supportedModels` fields, `enableFileCheckpointing`.
- [ ] Write `docs/sdk-upgrade.md`: from/to versions, each breaking change and how
      it was handled, and the API table above with `.d.ts` line references.

## Validate
- [ ] Gates pass (`pnpm test`, `typecheck:all`, `build`).
- [ ] Harness: the chat renders, the canned transcript streams, and the "/",
      model, mode and permission windows open with 0 structural diffs (no regression).

## VS Code checklist for the user
1. Install the build, send a message that uses a tool, and approve the permission.
   **Expected:** streaming, tool output and the result all render, with no errors in the Forge log.
2. Resume an old session. **Expected:** the history loads.
