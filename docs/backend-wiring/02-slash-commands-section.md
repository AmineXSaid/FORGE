# Step 02: Slash Commands section gets data

**Group:** 1 (Part A.2)  **Depends on:** nothing  **Status:** done (see `results/02-slash-commands-section.md`)

## Problem
`ButtonArea.vue` accepted `slashCommands`, but `ChatInputBox.vue` never passed it,
so the section was always empty. The host also renamed the CLI's `commands` field
to `slashCommands`.

## Official (read from the bundle, not the spec)
- **Data:** the host's `get_claude_state` answers with the CLI initialize response,
  and the webview reads `claudeConfig.commands` (SDK `SDKControlInitializeResponse.commands`,
  a `SlashCommand[]`).
- **`Y55`:** a duplicated name is invoked by its alias ending in `:<name>`.
- **`qz0`:** each command registers as `{id:"slash-command-<inv>", label:"/<inv>", description}`
  in "Slash Commands". The registry sorts that section by label.
- **`n65` / `s65`:** the section is hidden in the unfiltered menu, and shown once
  the filter has text or starts with `/`.
- **`TV0` keys:** Enter or Tab without Shift picks the active row, and Tab is passed on (`KZ(cmd, isTab)`).
- **`KZ`** (menu opened from the `/` button):
  - Tab on a slash command (`Uz0`): `D0("<label> ")` replaces the draft, caret at the end;
  - click or Enter: `executeCommand`, then `W5("/<inv>")`, which **sends** the command as a message.
    (The original spec said "inserts"; that is wrong.)
- **Handlers for `context` / `usage`:** open the context view and run `account-usage`.
  Both are out of scope, so these rows are left out.

## Done in Forge
- Host `loadConfig` returns `commands` (was `slashCommands`), typed `ClaudeConfig` in `messages.ts`.
- `components/forge/slashCommands.ts` ports `Y55`, `qz0` and `KZ`.
- The data flows `ChatPage` → `ChatInputBox` → `ButtonArea` → `CommandMenu`.
  `useRuntime` registers the same rows for the composer's `/` completion.
- `CommandMenu`: Tab/Enter handling, and the `/` prefix reveals the section.
- `ButtonArea` → `ChatInputBox`: `setInput` (Tab) and `sendCommand` (click/Enter).
- Mock host sends CLI-shaped `commands`, and logs every outgoing message to `window.__forgeSent`.
- `test/slashCommands.spec.ts` (11 cases).

## Known gaps, not in this step
- A send while a turn is running is dropped: `ChatPage` returns when busy and
  doesn't handle `queueMessage`. The official sends immediately. This affects
  every submit, not just slash rows.
- Shift+Tab in the menu filter cycles the permission mode, through Forge's
  capture-phase keybinding (`ChatPage.vue` ~L569). This was already the case before this step.
- Filter ranking is Forge's own; the official uses Fuse (`o65`).
- The composer's inline `/` completion is a separate Forge dropdown; the official
  uses the same `TV0` menu with `hasSlashQuery`.
