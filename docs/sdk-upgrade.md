# Agent SDK upgrade: 0.1.77 → 0.3.274

Step 07 of `docs/backend-wiring/` (backend rule B5), done 2026-09-17.

## Versions

| Package | Before | After (resolved in `pnpm-lock.yaml`) | Why |
| --- | --- | --- | --- |
| `@anthropic-ai/claude-agent-sdk` | `^0.1.76` → 0.1.77 | `^0.3.274` → **0.3.274** (`claudeCodeVersion` 2.1.274) | latest on npm (`npm view … version`, published 2026-09-16T22:38Z) |
| `@anthropic-ai/claude-agent-sdk-win32-x64` | — | **0.3.274** (optional dependency, `claude.exe` 233,691,808 bytes, `--version` → `2.1.274 (Claude Code)`) | the CLI now ships as a per-platform native binary |
| `@anthropic-ai/sdk` | `^0.71.2` → 0.71.2 | `^0.126.0` → **0.126.0** | SDK peer `>=0.93.0` (types for `BetaMessage`, `BetaRawMessageStreamEvent`) |
| `@modelcontextprotocol/sdk` | `^1.25.1` → 1.30.0 | `^1.30.0` → **1.30.0** | SDK peer `^1.29.0` |
| `zod` | `^3.25.76` → 3.25.76 | `^4.6.5` → **4.6.5** | SDK peer `^4.0.0` (`sdk.d.ts` imports `zod/v4`) |

Nothing in Forge imports `zod`, `@anthropic-ai/sdk` or `@modelcontextprotocol/sdk` directly; they are there for
the SDK's types. For reference, the official extension 2.1.270 on disk bundles SDK 0.3.270
(`CLAUDE_AGENT_SDK_VERSION="0.3.270"` in `extension.js`).

**Lockfile.** `pnpm-lock.yaml` has been tracked since `a74df01`, so the resolved versions above are also committed there.

**Supply-chain note.** pnpm's default `minimumReleaseAge` is one day, and 0.3.274 was about 12 hours old at install
time. `pnpm install` therefore wrote `minimumReleaseAgeExclude` entries to `pnpm-workspace.yaml` for exactly the
nine `@anthropic-ai/claude-agent-sdk*@0.3.274` packages. They are pinned to that version, so nothing else is exempt.
Delete them once 0.3.274 is older than a day, or pin `^0.3.273` if you'd rather not carry the exemption.

`pnpm peers check` afterwards reports only the old `vite ^7` peer of `@vue-vine/vite-plugin`.

Changelog read: `anthropics/claude-agent-sdk-typescript` `CHANGELOG.md`, every entry from 0.1.77 up to 0.3.274.

## Breaking changes and how each was handled

Line numbers refer to `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (0.3.274, 9368 lines).
The 0.1.77 typings were spread over `entrypoints/sdk/{coreTypes,runtimeTypes}.d.ts`.

| # | Change (version) | Effect on Forge | Handling |
| --- | --- | --- | --- |
| 1 | **The CLI is a native binary** from a per-platform optional dependency, not bundled JS (0.2.113). The SDK's flags follow its own CLI release. | Forge fell back to the tracked `resources/claude-code/cli.js`, which is **CLI 2.0.76**. It has no `--thinking` option and rejects unknown options (`_allowUnknownOption=!1`). The new SDK turns `maxThinkingTokens: 0` into `--thinking disabled`, so the SDK probe and every session with Thinking off would fail to start. | `src/services/claude/cliLaunch.ts` ports the official `xh0` / `o1$` / `jh0`. It looks in `resources/native-binaries/<platform>-<arch>[-musl]/claude[.exe]`, then `win32-x64` on win32-arm64, then `resources/native-binary/claude[.exe]`, and otherwise throws `Unsupported platform: …` (`errorClass: unsupported_platform`). **The cli.js fallback is removed.** `esbuild.ts` copies the binary the installed SDK would run (resolved from the SDK's own directory, in the SDK's `AG` order) to `resources/native-binary/` when it's missing or a different size. That path is gitignored and is packaged, since `.vscodeignore` doesn't exclude `resources/`. The old `copyClaudeCliPlugin` (for `@anthropic-ai/claude-code/cli.js`, not installed) is gone. |
| 2 | **Peer dependencies** `@anthropic-ai/sdk >=0.93`, `@modelcontextprotocol/sdk ^1.29`, `zod ^4` (0.3.143, `package.json`) | The typings import `zod/v4` and `@anthropic-ai/sdk/resources/beta/messages/messages.mjs`. | Bumped in `package.json` (table above). |
| 3 | **`PermissionMode`** lost `'delegate'` and gained `'auto'` (0.2.91; L2366). `set_permission_mode` rejects unknown modes (0.3.214). | `ExtensionConfig.defaultPermissionMode` still listed `'delegate'`. The Settings UI never offers it. | `src/services/configurationService.ts` now types it as the SDK's `PermissionMode`. |
| 4 | **SDK sessions use Task tools instead of `TodoWrite`** (0.3.142, breaking). Todo tools are also off by default on newer models (0.3.233, 0.3.268). | Forge's todo list (`Session.processMessage`) and the official port's `TodoWriteRenderer` only read `TodoWrite`. The official webview has no Task-tool renderer either. | Ported the official host's `l3` defaults: `CLAUDE_CODE_ENABLE_TASKS=0` and `MCP_CONNECTION_NONBLOCKING=true` (`OFFICIAL_CLI_ENV_DEFAULTS`). They're applied after `process.env` and before the endpoint and user variables, in the official order. The CLI binary checks `CLAUDE_CODE_ENABLE_TASKS===!1`. |
| 5 | **MCP servers connect in the background** (0.3.142, breaking) | Slow servers report `pending` in `init`. | `MCP_CONNECTION_NONBLOCKING=true`, as the official host sets it (same as the new default). |
| 6 | **`SDKMessage` grew from 11 to 39 members** (L5002): 28 `system` subtypes, plus `tool_use_summary`, `rate_limit_event`, `prompt_suggestion`, `conversation_reset` | `Message.fromRaw` only builds rows for `user` / `assistant`. `Session.ts:492` stores `session_id` from every `system` frame. | No code change. `test/sdkMessageStream.spec.ts` lists the whole union with a `tsc` exhaustiveness check, proves no new frame adds a row (streaming or not), and checks at type level that `session_id` is required on every `system` member. |
| 7 | **New fields on `SDKAssistantMessage`** (L3383): `timestamp` (ISO string, 0.3.211), `aborted` (0.3.214), `error`, `user_message_uuid(s)`, `supersedes`, `request_id`. **On `SDKPartialAssistantMessage`** (L5147): `ttft_ms`, `user_message_uuid(s)`. | Replacement is by `uuid` / `message.id`, which is unchanged. Nothing in the webview reads `.timestamp`. | No code change. The spec proves a final message carrying these fields still replaces the streamed row (step 03). **Not handled (feature, not regression):** `supersedes` (refusal-fallback eviction) and `conversation_reset`. |
| 8 | **Argument builder** (sdk.mjs `ProcessTransport.initialize`). New flags derived from Options: `--thinking`, `--thinking-display`, `--effort`, `--task-budget`, `--agent`, `--debug` / `--debug-file`, `--permission-prompts`, `--channels`, `--include-hook-events`, `--session-mirror`, `--plugin-dir-no-mcp`, `--await-initialize`, `--resume-drops-turn=`, `--session-id=`, `--managed-settings`. `--resume=`, `--setting-sources=` and `--resume-session-at=` are now equals-form. The SDK no longer emits `--debug-to-stderr`. `Options.settings` overrides `extraArgs.settings`. | The gate knew 5 protocol flags and 7 "managed" names, several of which aren't derived by the SDK at all. Forge still passes `--debug-to-stderr` itself: CLI 2.1.274 still parses it (`toStderr=i.includes("--debug-to-stderr")` in the binary). | `src/services/claude/cliArgs.ts` rebuilt. **PROTOCOL** adds `permission-prompt-tool`, which is the `canUseTool` channel (`stdio`). **`SDK_DERIVED_FLAGS`** is the complete list (40 flags, each keyed to its `Options` field). A configured flag is always applied, and warned about only when the SDK really emits it on that launch: `buildExtraArgs` gets the launch's `Options`, so `ClaudeSdkService` builds `extraArgs` after the Options object. Flags that replace Forge's own `--debug` / `--settings`, and `--system-prompt` / `--append-system-prompt` (which overlap the `systemPrompt` sent in `initialize`), are warned too. `test/cliArgs.spec.ts` re-reads the installed `sdk.mjs` and fails if the builder emits a flag the table doesn't list, or stops emitting one it does. |
| 9 | **`maxThinkingTokens` and `Query.setMaxThinkingTokens` are deprecated** (L1816, L2726) in favour of `thinking` (L1794). On adaptive models the value acts as on/off. `setMaxThinkingTokens` gained a `thinkingDisplay` argument. | Forge passes 31999 / 0 and calls `setMaxThinkingTokens(maxTokens)`. It still works: 0 becomes `--thinking disabled`, N becomes `--max-thinking-tokens N`. | Done in step 14: launches pass `Options.thinking` (the official `m$$`: `{type:'enabled', budgetTokens:31999, display?}` or `{type:'disabled'}`), and the toggle calls `setMaxThinkingTokens(31999, display ?? null)` / `setMaxThinkingTokens(0)`. |
| 10 | **`CanUseTool`** (L213): options gain `requestId` (required, set by the SDK), `toolUseID`, `agentID`, `mcpServer`, `defaultToNo`, `suppressAlwaysAllowRule`, `title`, `displayName`, `description`, `matchedAskRule`. It may return `null`. | Forge's callback reads `options.suggestions` only. | Compatible. No change. |
| 11 | **`PermissionResult`** (L2389): `updatedInput` is optional; adds `toolUseID` and `decisionClassification`. `PermissionUpdate` (L2408) and `PermissionUpdateDestination` (L2437) are unchanged. | `PermissionRequest.accept` always sends `updatedInput`. | Compatible. No change. |
| 12 | **`Query.interrupt()`** returns a receipt or `undefined` (L2668). `close()` added (L3015). v2 session API removed (0.3.142). | Forge awaits `interrupt()` and calls `return()`. It never used the v2 API. | Compatible. No change. |
| 13 | **`options.env` replaces `process.env`** (0.2.113). `settingSources` omitted now means all sources. | Forge passes the full merged env and explicit `settingSources` (`['user','project','local']`; `[]` for the probe). | No change. |
| 14 | **`SlashCommand`** gains `aliases?` (L8843). **`ModelInfo`** gains `resolvedModel`, `supportsEffort`, `supportedEffortLevels`, `supportsAdaptiveThinking`, `supportsFastMode`, `supportsAutoMode` (L1313). | Step 02 already reads `aliases` (the `Y55` rule). | No change. Step 12 uses the new model fields. |

## Consumers re-verified against the new `.d.ts`

`pnpm run typecheck:all` (`tsc --noEmit` + `vue-tsc`) passes. Each import was also read against the new typings:

| File | SDK symbols used | Verdict |
| --- | --- | --- |
| `src/services/claude/ClaudeSdkService.ts` | `Options`, `Query`, `CanUseTool`, `PermissionMode`, `SDKUserMessage`, `HookCallbackMatcher` (L898), `query` (L3018); Query methods `supportedCommands` L2801, `supportedModels` L2807, `mcpServerStatus` L2819, `accountInfo` L2906, `interrupt` L2668 | changed: binary resolution (#1), env defaults (#4, #5), `extraArgs` built from the Options (#8) |
| `src/services/claude/ClaudeAgentService.ts` | `SDKMessage`, `SDKUserMessage`, `Query`, `PermissionResult`, `PermissionUpdate`, `CanUseTool`, `PermissionMode`; `setMaxThinkingTokens` L2726, `setPermissionMode` L2675, `setModel` L2703, `return()` | compatible (#9, #10, #12) |
| `src/services/claude/cliArgs.ts` | none (reads the builder behaviour) | changed (#8) |
| `src/services/claude/handlers/handlers.ts` | `PermissionMode`, `SDKUserMessage` (L5847, `session_id` optional since 0.2.86) | compatible |
| `src/shared/messages.ts` | `SDKMessage`, `SDKUserMessage`, `PermissionResult`, `PermissionUpdate`, `PermissionMode`, `SlashCommand`, `ModelInfo`, `AccountInfo` (L23) | compatible (the types only widened) |
| `src/services/configurationService.ts` | `PermissionMode` (new import) | changed (#3) |
| `src/webview/src/transport/BaseTransport.ts` | `PermissionResult`, `PermissionMode` | compatible |
| `src/webview/src/core/Session.ts` | `PermissionMode`; stream `type` / `subtype` / `session_id` | compatible (#6, #7) |
| `src/webview/src/core/PermissionRequest.ts` | `PermissionUpdate`, `PermissionResult` | compatible (#11) |
| `src/webview/src/composables/useSession.ts` | `PermissionMode` | compatible |
| `src/webview/src/models/StreamAssembler.ts` | `stream_event.event` (`BetaRawMessageStreamEvent` from `@anthropic-ai/sdk` 0.126) | compatible: unknown blocks and deltas are still ignored, so no rows for them (step 03 spec) |
| `src/webview/src/utils/messageUtils.ts` | assistant `uuid` / `message.id` / content; user `tool_result` | compatible (#7) |
| `ButtonArea.vue`, `ChatInputBox.vue`, `ModeSelect.vue`, `WaitingIndicator.vue`, `ChatPage.vue` | `PermissionMode` | compatible (`ModeIcon.vue` already handles `'auto'` and `'dontAsk'`) |
| `src/webview/src/components/forge/slashCommands.ts` | `SlashCommand` | compatible (#14) |

## APIs later steps use, as 0.3.274 spells them

| API | `.d.ts` | Signature / notes | Step |
| --- | --- | --- | --- |
| `Query.rewindFiles` | L2915 (`RewindFilesResult` L3124) | `rewindFiles(userMessageId: string, options?: { dryRun?: boolean }): Promise<RewindFilesResult>`, returning `{ canRewind, error?, filesChanged?, insertions?, deletions?, skippedLinks? }`. Fails when nothing could be restored (0.3.260). | 24 |
| `Options.enableFileCheckpointing` | L1605 | `boolean`; required for `rewindFiles` | 24 |
| `forkSession` (function) | L770 (`ForkSessionOptions` L775, `ForkSessionResult` L785) | `forkSession(sessionId, { upToMessageId?, title?, dir? }): Promise<{ sessionId }>` | 25 |
| `Options.forkSession` / `resumeSessionAt` / `resumeDropsTurn` | L1621 / L1988 / L2039 | fork on resume; resume up to a message uuid; declare the dropped turn | 25 |
| `Query.setMaxThinkingTokens` | L2726 (deprecated) | `setMaxThinkingTokens(maxThinkingTokens: number \| null, thinkingDisplay?: 'summarized' \| 'omitted' \| null): Promise<void>` | 14 |
| `Options.thinking` | L1794 (`ThinkingConfig` L9127: `ThinkingAdaptive` L9119, `ThinkingDisabled` L9132, `ThinkingEnabled` L9139) | `{ type: 'adaptive', display? } \| { type: 'enabled', budgetTokens?, display? } \| { type: 'disabled' }` | 14 |
| `Options.effort` | L1807 (`EffortLevel` L623) | `'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'` becomes `--effort` | 13 |
| `Settings.effortLevel` | L8472 | `'low' \| 'medium' \| 'high' \| 'xhigh'` (persisted settings exclude `max`) | 11, 13 |
| `Query.applyFlagSettings` | L2749 | merges into the flag-settings layer mid-session; `effortLevel` also accepts `'max'`; `null` clears a key. "Flag settings sit above user/project/local and below managed policy settings" (L2729), which is the B6 precedence fact for `--settings forge.json`. | 11, 13 |
| `Query.updateSettings` | L2762 | `updateSettings(source: 'localSettings', settings)`; allowlist is `outputStyle` only | 29 |
| `resolveSettings` (function) | L3085 | effective merged settings without spawning the CLI | 11 |
| `Options.settings` / `managedSettings` / `settingSources` | L2099 / L2123 / L2134 | `settings?: string \| Settings` (overrides `extraArgs.settings`) | 11 |
| `Query.supportedModels` / `ModelInfo` | L2807 / L1313 | `value`, `resolvedModel?`, `displayName`, `description`, `supportsEffort?`, `supportedEffortLevels?`, `supportsAdaptiveThinking?`, `supportsFastMode?`, `supportsAutoMode?` | 12, 15 |
| `Settings.fastMode` / `fast_mode_state` | L8508 / L5594 (init), L4309 (initialize response) | fast-mode setting and state | 15 |
| `Settings.alwaysThinkingEnabled` | L8468 | persisted thinking default | 14 |
| `Query.initializationResult` | L2769 (`SDKControlInitializeResponse` L4282) | `commands`, `agents`, `output_style`, `available_output_styles`, `models`, `account`, `fast_mode_state?`, … | 02, 12, 29 |
| `Query.setPermissionMode` / `PermissionMode` | L2675 / L2366 | `'default' \| 'acceptEdits' \| 'bypassPermissions' \| 'plan' \| 'dontAsk' \| 'auto'` | 17, 18 |
| `PermissionUpdate` / `PermissionUpdateDestination` | L2408 / L2437 | `addRules \| replaceRules \| removeRules \| setMode \| addDirectories \| removeDirectories`; `'userSettings' \| 'projectSettings' \| 'localSettings' \| 'session' \| 'cliArg'` | 16 |
| `renameSession` / `tagSession` / `deleteSession` / `listSessions` / `getSessionInfo` / `getSessionMessages` | L3029 / L9076 / L600 / L1024 / L799 / L829 | session-file helpers (`{ dir? }`) | 20–23 |
| `SDKSystemMessage` (`init`) | L5549 | `effort?` (0.3.234), `fast_mode_state?`, `slash_commands`, `terminal_slash_commands?`, `output_style`, `skills`, `permissionMode` | 12–15 |

## SDK capability now reachable, and where Forge surfaces it

Every flag-based option in `SDK_DERIVED_FLAGS` is usable through `forge.cliArgs` today. Nothing is blocked
except the six protocol flags. The typed APIs below have no Forge UI yet; the right column says which step adds one.

| Capability | API | Forge today | Planned |
| --- | --- | --- | --- |
| Effort levels | `effort`, `applyFlagSettings({effortLevel})` | `forge.cliArgs: { "effort": "high" }` | step 13 (official slider) |
| Adaptive / fixed thinking, display | `thinking`, `setMaxThinkingTokens(budget, display)` | the official on/off with a 31999 budget; summaries follow `showThinkingSummaries` (step 14) | done |
| Fast mode | `Settings.fastMode`, `ModelInfo.supportsFastMode` | — | step 15 |
| Auto permission mode | `PermissionMode 'auto'`, `ModelInfo.supportsAutoMode`, `setMcpPermissionModeOverride` (L2692) | typed, not offered in the mode menu | not in any step: needs a scope decision (the official mode menu is ported in step 17) |
| Rewind files | `rewindFiles`, `enableFileCheckpointing` | — | step 24 |
| Fork / resume at | `forkSession`, `resumeSessionAt` | — | step 25 |
| Output styles | `updateSettings('localSettings', {outputStyle})`, `initializationResult` | — | step 29 |
| Fallback model, max turns, budget, task budget, extra dirs, betas | `fallbackModel` L1596, `maxTurns` L1821, `maxBudgetUsd` L1826, `taskBudget` L1834, `additionalDirectories` L1453, `betas` L1628 | `forge.cliArgs` only | not in any step |
| Background tasks, stop task, agents list, MCP toggles | `backgroundTasks` L3006, `stopTask` L2991, `supportedAgents` L2813, `toggleMcpServer` L2950, `setMcpServers` L2979, `reloadPlugins` L2882 | — | not in any step |
| Context usage | `getContextUsage` L2830 | — | out of scope (usage / context meter) |
| New stream frames | `prompt_suggestion`, `rate_limit_event`, `conversation_reset`, `tool_use_summary`, `supersedes` | ignored (no rows) | not in any step |

## Re-checking the type-level spec on the next upgrade

The project `tsconfig.json` excludes `*.spec.ts`, and vitest strips types, so check
`test/sdkMessageStream.spec.ts` on its own. From the repo root, with a throwaway tsconfig:

```json
{ "compilerOptions": { "module": "ES2022", "target": "ES2022", "lib": ["ES2022", "DOM"], "moduleResolution": "Bundler",
  "strict": true, "noEmit": true, "skipLibCheck": true, "esModuleInterop": true, "types": ["node"] },
  "files": ["test/sdkMessageStream.spec.ts"] }
```

`npx tsc -p <that file>` must exit 0. On 2026-09-17 it did. A negative control (deleting `'informational'` from the
subtype list, and asserting `'plan'` is not a mode) failed with `TS2322` on exactly those two assertions.
