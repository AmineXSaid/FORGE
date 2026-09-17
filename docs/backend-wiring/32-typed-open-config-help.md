# Step 32: Typed `open_config` / `open_help` replace the `command:` allow-list

**Group:** 6  **Depends on:** 31

## Problem
`handleOpenConfigFile` (handlers.ts ~L811–830) runs `configType:"command:<id>"`
from an allow-list. The webview must not name VS Code commands.

## Official
- `{type:"open_config", searchString}` → `workbench.action.openSettings` with the search.
- `{type:"open_help"}` → `https://code.claude.com/docs/en/vs-code`.

## Six places (B2) for both requests
- `open_config`: `searchString` is a string and length-capped.
- `test/openConfigHelp.spec.ts`, including a check that a `command:` config type is rejected.

## Tasks
- [ ] Rewire `config` → `open_config` (copy the official search string, then decide
      the Forge brand string and write it down) and `help` → `open_help`.
- [ ] Remaining `command:` users (`forge.showLogs`, `forge.newConversation`) get
      typed requests or are removed if nothing in scope uses them.
- [ ] **Delete the `command:` branch.**

## Validate
- [ ] Gates pass. `grep -rn "command:" src/webview/src` finds no config-type usage.
- [ ] Harness: the `config` and `help` rows send the typed requests. A posted
      `open_config_file {configType:"command:workbench.action.quit"}` is rejected.

## VS Code checklist for the user
1. "/" → General config…. **Expected:** VS Code settings open, filtered.
2. "/" → View help docs. **Expected:** the docs URL opens.
