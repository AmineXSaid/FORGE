# Step 07: Upgrade the Agent SDK to the latest version (done)

**Group:** 2 (B5)  **Depends on:** 06  **Blocks:** every feature step
**Result:** [results/07-sdk-upgrade.md](results/07-sdk-upgrade.md), [docs/sdk-upgrade.md](../sdk-upgrade.md)

## Facts
- Installed: `@anthropic-ai/claude-agent-sdk` 0.1.77 (package.json `^0.1.76`).
- `CLAUDE.md` notes 0.3.273 on npm when it was written. **Take the latest** (`npm view @anthropic-ai/claude-agent-sdk version`).

## Tasks
- [x] Read the changelog between 0.1.77 and the target version. List every
      breaking change to types, `query()` options, `Query` methods and the message stream.
- [x] Update `package.json` and the lockfile (`pnpm install`).
- [x] Re-verify every consumer against the new `.d.ts` (read it; don't assume):
  - `src/services/claude/ClaudeSdkService.ts`
  - `src/services/claude/ClaudeAgentService.ts`
  - `src/services/claude/cliArgs.ts`
  - `src/services/claude/handlers/handlers.ts`
  - `src/shared/messages.ts`
  - `src/webview/src/transport/BaseTransport.ts`
  - `core/Session.ts`, `core/PermissionRequest.ts`, `composables/useSession.ts`
  - the `.vue` files that import SDK types: `ButtonArea`, `ChatInputBox`,
    `ModeSelect`, `WaitingIndicator`, `ChatPage`
- [x] Update `cliArgs.ts` PROTOCOL / MANAGED sets if the new SDK derives more
      flags from options. Update `test/cliArgs.spec.ts` to match.
- [x] Record the APIs later steps use, exactly as the new `.d.ts` spells them:
      `rewindFiles`, `forkSession`/`resumeSessionAt`,
      `setMaxThinkingTokens(budget, display)`, settings APIs, effort option,
      `supportedModels` fields, `enableFileCheckpointing`.
- [x] Write `docs/sdk-upgrade.md`: from/to versions, each breaking change and how
      it was handled, and the API table above with `.d.ts` line references.

## Validate
- [x] Gates pass (`pnpm test`, `typecheck:all`, `build`).
- [x] Harness: the chat renders, the canned transcript streams, and the "/",
      model, mode and permission windows open with 0 structural diffs (no regression).

## VS Code checklist for the user
1. Install the build, send a message that uses a tool, and approve the permission.
   **Expected:** streaming, tool output and the result all render, with no errors in the Forge log.
2. Resume an old session. **Expected:** the history loads.

## Corrections found while doing it (the SDK and the installed files disagree with this file)
- **The upgrade is not "package.json plus types".** Since SDK 0.2.113 the CLI is a native binary in a per-platform
  optional dependency, and 0.3.x passes flags only its own CLI knows (`--thinking disabled` for `maxThinkingTokens: 0`).
  Forge's fallback `resources/claude-code/cli.js` is CLI 2.0.76 and rejects that flag. Binary resolution (the official
  `xh0`) and a build step that copies the SDK's binary are part of this step.
- **Consumers the list above missed:** `src/services/configurationService.ts` (typed `'delegate'`, which the SDK removed),
  `src/webview/src/components/forge/slashCommands.ts` (`SlashCommand`), `esbuild.ts` (CLI copy), and the webview
  stream consumers `models/StreamAssembler.ts` and `utils/messageUtils.ts`.
- **`setMaxThinkingTokens(budget, display)`** is spelled `setMaxThinkingTokens(maxThinkingTokens: number | null,
  thinkingDisplay?: 'summarized' | 'omitted' | null)` and is **deprecated** in favour of the `thinking` option.
- **Settings APIs** are `applyFlagSettings` (flag layer), `updateSettings('localSettings', …)` (allowlist:
  `outputStyle` only) and the `resolveSettings()` function. There is no generic user-settings writer.
- **The flag gate** now lists every flag the SDK derives (40), not only the ones Forge sets. The user asked on
  2026-09-17 to maximise what Forge can reach.
