# Step 28: @browser tabs and "Browse the web"

**Group:** 6  **Depends on:** 27

## Official
- The "+" row "Browse the web" shows only when `browserIntegrationSupported`, and inserts `@browser:`.
- Requests: `ensure_chrome_mcp_enabled`, `create_new_browser_tab`, `disable_chrome_mcp`.
  Read each handler for the MCP server it enables, how support is detected, and the response shapes.

## Six places (B2) for each request
- Handlers enable only the known browser MCP server the official uses. No MCP
  config or command comes from the webview.
- `test/browserIntegration.spec.ts`: support detection, enable/disable, and
  rejection of extra payload fields.

## Tasks
- [ ] Compute `browserIntegrationSupported` the way the official does, and pass
      `browser-integration-supported` to `AddMenu.vue`.
- [ ] Wire `@browser:` tab mentions the way the official does.

## Validate
- [ ] Gates pass.
- [ ] Harness, supported: the row shows, inserts `@browser:` and sends the
      official requests. Unsupported: no row. Oracle on "+": 0 structural diffs.

## VS Code checklist for the user
1. With the browser integration available, "+" → Browse the web and ask Claude to
   open a page. **Expected:** a browser tab opens through the MCP.
