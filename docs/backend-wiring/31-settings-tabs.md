# Step 31: Customize rows open the matching Settings tab

**Group:** 6  **Depends on:** 30

## Today
MCP servers, Hooks, Permissions and Manage plugins all open Settings on General
(`open_config_file` `command:forge.openSettings`).

## Tasks
- [ ] `forge.openSettings` (`src/commands/forgeCommands.ts` ~L206) takes an optional `tab`.
      Run `node scripts/sync-commands.mjs` and `lint:commands`.
- [ ] `webViewService.openEditorPage` (~L51) carries the initial `{tab}`. Settings
      selects it on mount **and** when an existing panel is refocused.
- [ ] Typed request `open_forge_settings {tab}` (six places), with `tab` from the real
      tab ids in `components/settings/tabs`. An unknown tab falls back to General and runs nothing else.
- [ ] Rewire the four rows (and the Slash commands browse row) to it.
- [ ] `test/openForgeSettings.spec.ts`: each tab, plus the rejection and fallback case.

## Validate
- [ ] Gates pass.
- [ ] Harness: each row sends the typed request with the right tab, and the menu closes.
      `?page=settings` with each tab renders that tab.

## VS Code checklist for the user
1. "/" → MCP servers, Hooks, Permissions and Manage plugins, one at a time.
   **Expected:** Settings opens on that tab each time.
