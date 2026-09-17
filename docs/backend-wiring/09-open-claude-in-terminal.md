# Step 09: Re-enable `open_claude_in_terminal`

**Group:** 3  **Depends on:** 08

## Problem
The "/" row `terminal` sends `open_claude_in_terminal`, but the dispatcher case is
commented out (~L793), so it throws `Unknown request type`. Per B2, that's a bug.

## Official
- Sender in `index.js`: `{type:"open_claude_in_terminal", prompt?, args?, location?}`
  (the menu passes `location:"bottom"`).
- `JI0` in `extension.js`: `prompt` must be a bare slash command; `args` must be
  `[]` or `["--resume", <sessionId>]`.
- The host runs `claude-vscode.terminal.open` with a named terminal, the extension
  icon and `location`. Read that command for the name, `iconPath`, the location
  mapping and how the command line is built.

## Six places (B2)
1. Types: request and response.
2. Transport: `openClaudeInTerminal(prompt?, args?, location?)`.
3. Dispatcher: uncomment and route.
4. Handler: port `JI0` literally, then create the terminal the way the official does.
5. Mock host: log the request and answer the official response.
6. `test/openClaudeInTerminal.spec.ts`: accepts `{}`, `/fast`, and
   `["--resume", validId]`; rejects `"/x; rm"`, `"hello"`, unknown flags,
   `["--resume","../x"]` and extra args.

## Validate
- [ ] Gates pass.
- [ ] Harness: click "/" → the terminal row. Exactly one request with the
      official payload, and the menu closes.
- [ ] Harness: post the rejection payloads from devtools. Each gets an error response.

## VS Code checklist for the user
1. "/" → the terminal row. **Expected:** a terminal opens in the bottom panel,
   named like the official, with the Forge icon, running `claude`.
