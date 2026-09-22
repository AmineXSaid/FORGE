# Step 31 results: Customize rows open the matching Settings tab

## Results

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| "/" → MCP servers | `{type:"open_forge_settings", tab:"mcp-servers"}` | `{tab:"mcp-servers"}`; `openEditorPage('settings','Forge Settings',undefined,{tab})` | menu closes, Settings opens on MCP Servers | works |
| "/" → Hooks | `…tab:"hooks"` | `{tab:"hooks"}` | menu closes, Settings opens on Hooks | works |
| "/" → Manage plugins | `…tab:"plugins"` | `{tab:"plugins"}` | menu closes, Settings opens on Plugins | works |
| "/" → Slash commands | `…tab:"slash-commands"` | `{tab:"slash-commands"}` | menu closes, Settings opens on Slash Commands | works |
| a tab the host does not know | `…tab:"nope"` / `"command:forge.openSettings"` / `"../../etc/passwd"` / `42` | `{tab:"general"}`, one warning, and **only** `openEditorPage` — no command is run | Settings opens on General | works |
| no tab at all | `{type:"open_forge_settings"}` | `{tab:"general"}`, no warning | Settings opens on General | works |
| Settings panel already open | — | `select_settings_tab` pushed to that panel | the page switches tab in place | works |

**Counts:** works 7 · partial 0 · broken 0 · left out 1 (see below)

### The row this step changed the behaviour of

"/" → **Slash commands** previously emitted `openSlashCommands`, which typed "/"
into the composer and opened the completion list. `31-settings-tabs.md` lists it
with the four Settings rows, so it now opens Settings on **Slash Commands** —
which is what its description, "Browse slash commands", says. The composer's own
"/" completion is unchanged; only this row moved. The dead
`openSlashCommands` emit and `ChatInputBox.openCommandMenu` were removed with it.

### Left out

**"/" → Permissions** is not in this step. Step 16 (the user's decision,
2026-09-18) made it open the official "Permission rules" dialog (`kU0`), as the
official row does, and it still does. `CLAUDE.md`'s scope line still names
Permissions among the rows that should open a Settings tab; that line is now
out of date, and the user may want to update it.

## Gates

- `pnpm test`: `Test Files 32 passed (32) · Tests 802 passed (802)`
- `pnpm run typecheck:all`: clean
- `pnpm run build`: `brand: clean (355 files)`, `tokens: clean (240 used, 383 defined)`, `commands: clean (20 commands, 13 references)`, `✓ built in 6m 6s`
- `node scripts/sync-commands.mjs`: `already in sync (20 commands)` — `forge.openSettings` gained an argument, not a new id, so the manifest is unchanged.

## Oracle

Harness on `127.0.0.1:8791`.

| Window (root selector) | Structural diffs | |
| --- | --- | --- |
| "/" command menu (85 elements) | **0** | `classesNotInOfficialCss: []`, `missingTwin: 0` |

The rows' markup did not change — only what they do — so this is the check that
the rewiring left the menu alone.

## Harness runs

- Each of the four rows clicked: the request carried the right tab
  (`mcp-servers`, `hooks`, `plugins`, `slash-commands`) and the menu closed.
- Four bad tab values posted straight down the transport: every one answered
  `general`, and nothing else ran.
- `?page=settings&tab=hooks` rendered with **Hooks** selected, from the bootstrap.
- `select_settings_tab` pushed for all **13** tabs: each one selected, with the
  right sidebar row active. A push naming `nope` was ignored and left the page
  on the tab it was on.

## What was built

- `src/shared/messages.ts`: `FORGE_SETTINGS_TABS` (the 13 real ids),
  `ForgeSettingsTab`, `isForgeSettingsTab`, and the request / response /
  `select_settings_tab` types. This is the **single source of truth** for tab
  ids: `SettingsPage`'s `tabs` array is typed as `ForgeSettingsTab[]`, so a typo
  is a type error, and the spec asserts the rendered list, the `switch` and the
  shared list are the same set.
- `webViewService.openEditorPage(page, title, instanceId?, {tab})`: a new panel
  gets the tab on its bootstrap; an existing one is **revealed and pushed**,
  because a bootstrap only runs once.
- `forge.openSettings` takes an optional tab argument, validated the same way.
- `handleOpenForgeSettings`: validate, warn on a fallback, open, answer with the
  tab actually opened.
- `SettingsPage`: reads `FORGE_BOOTSTRAP.tab` on mount and subscribes to
  `selectSettingsTab`; the sidebar's event is re-validated before it is taken.

The `open_config_file` `command:` allow-list is **still there** — removing it is
step 32. What changed here is that no row uses it any more for Settings.

## Specs added

`test/openForgeSettings.spec.ts` (11 cases): every tab id accepted and everything
else rejected; the handler opening each of the 13 tabs as a singleton; General
for a missing tab (no warning) and for an unknown one (with a warning) while
calling `openEditorPage` exactly once; the three tab lists agreeing with each
other and with the files in `components/settings/tabs`; and the four rows wired
to the tabs they name, with `command:forge.openSettings` gone from `ButtonArea`.

## VS Code checklist for the user (unverified until the user runs it)

1. "/" → **MCP servers**. **Expected:** the menu closes and Forge Settings opens
   on the **MCP Servers** tab.
2. Without closing Settings, go back to the chat and run "/" → **Hooks**.
   **Expected:** the *same* Settings tab is revealed and switches to **Hooks** —
   not a second panel.
3. Repeat with **Manage plugins** and **Slash commands**.
   **Expected:** Plugins and Slash Commands respectively.
4. "/" → **Permissions**. **Expected:** the "Permission rules" dialog, not
   Settings (this is step 16's behaviour, unchanged).
5. From the command palette, run **Forge: Open Settings**. **Expected:** Settings
   opens on **General**, since the palette passes no tab.
