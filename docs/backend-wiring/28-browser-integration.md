# Step 28: @browser tabs and "Browse the web"

**Group:** 6  **Depends on:** 27  **Done** — [results](results/28-browser-integration.md)

## Official
- The "+" row "Browse the web" shows only when `browserIntegrationSupported`, and inserts `@browser:`.
  It is **not** a `registerAction`: `pV0` (index.js @5001250) pushes it into its own
  array behind a plain `if`.
- Requests: `ensure_chrome_mcp_enabled`, `create_new_browser_tab`, `disable_chrome_mcp`.
  The first and last are channel-scoped and throw `channelId is required for …`
  without one; `create_new_browser_tab` is not scoped, because it opens its own
  MCP stdio connection to `claude --claude-in-chrome-mcp` rather than using the
  session's query.
- `browserIntegrationSupported` is a **host field on the init state**
  (`extension.js` @3061483), not something the webview computes. The official
  sets it from `authManager.getAuthStatus()?.authMethod === "claudeai"`.

## Corrections to the earlier draft of this file
1. ~~"Compute `browserIntegrationSupported` the way the official does."~~ It is
   not computed in the webview, and the official's own test reads an auth status
   Forge deliberately does not have. Forge gates on a resolvable Claude binary
   instead — the browser MCP server *is* that binary. See the results file.
2. ~~"Wire `@browser:` tab mentions."~~ A bare `@browser:` is **not** a mention:
   the official regex does not match it. The row inserts that prefix so the
   composer's `@` dropdown — fed by `findFiles`'s `browser:` branch — can
   complete it into `@browser:<group>:<id>:<url>`. Wiring the mention therefore
   also means wiring the `list_files` browser rows.

## Six places (B2) for each request — done
- Handlers enable only `claude-in-chrome`, with a command the **host** builds
  (`chromeMcpServerConfig`). No MCP config or command comes from the webview;
  none of the three requests carries a payload at all.
- `test/browserIntegration.spec.ts`: support detection, enable/disable, the
  extension probe, the mention expander and the `findFiles` ordering.

## Tasks
- [x] Add `browserIntegrationSupported` to `InitResponse.state`, set it in
      `handleInit` from `sdkService.isBrowserIntegrationSupported()`, and thread
      it Session → useSession → ChatPage → ChatInputBox → ButtonArea → `AddMenu.vue`.
- [x] Wire `@browser:` tab mentions the way the official does: the `findFiles`
      browser branch on the host, the globe-iconed rows in the composer's `@`
      dropdown, and `browserMentionBlocks` (the official `Oj0`) at send time.

## Validate
- [x] Gates pass.
- [x] Harness, supported: the row shows, inserts `@browser:`, lists the tabs and
      sends the official requests in the official order. Unsupported: no row.
      Oracle on "+": 0 structural diffs (16/16 with the row, 11/11 without).

## VS Code checklist for the user
See the results file — eight numbered steps, all unverified.
