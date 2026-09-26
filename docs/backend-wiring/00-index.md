# Backend wiring: step index

The source is `CLAUDE.md` ("Current task" and the backend rules B1–B9), and it
**wins** over [`docs/prompts/backend-wiring.md`](../prompts/backend-wiring.md).
The scope is decided. Don't widen or narrow it. Anything not listed here is in
[out-of-scope.md](out-of-scope.md), with the reason.

Every step file is one mini-task. Work in order. **Finish, verify and report
each group before starting the next.** Each group ends with a checkpoint step
that uses [report-template.md](report-template.md).

## Paths

| Short name | Path |
| --- | --- |
| `REF` | `C:\Users\med-a\Music\Real_Claude_Code_VSCODE_extension_files\` |
| types | `src/shared/messages.ts` |
| transport | `src/webview/src/transport/BaseTransport.ts` |
| dispatcher | `src/services/claude/ClaudeAgentService.ts` (the `switch` on `request.type`, ~L660–810) |
| handlers | `src/services/claude/handlers/handlers.ts` |
| SDK launch | `src/services/claude/ClaudeSdkService.ts` (`--settings ~/.claude/forge.json`, probes) |
| CLI flag gate | `src/services/claude/cliArgs.ts` + `test/cliArgs.spec.ts` |
| "/" rows | `src/webview/src/components/ButtonArea.vue` (`menuCommands`, `runCommand`) |
| mock host | `.claude/skills/ui-parity/harness/mock-host.js` |
| specs | `test/*.spec.ts`, with the vscode mock in `test/mocks/vscode.ts` |

## How to build every request (B1, B2, B3)
1. Read the sender in `REF/webview/index.js` (`type:"<type>"`) and the handler in
   `REF/extension.js` (`case"<type>"`, then the method it calls). Use the same
   type names, payloads and response fields.
2. Change all **six places**: types, transport, dispatcher case, handler,
   mock-host answer, and a spec in `test/`.
3. Validate like the official: whitelists (`tu$`), validators (`JI0`), and a
   session-id check before touching the filesystem. Never route through `handleExec`.
4. Hand-passed CLI flags go through `cliArgs.ts` (the PROTOCOL / MANAGED / FREE gate).
5. Register the row only when its handler works (B4).

## Definition of done for every feature (B7, B8)
- [ ] The **behaviour** is verified, not just the label (the effort reaches the
      CLI, the thinking budget changes, the files on disk change).
- [ ] A vitest spec for each new handler, including rejection cases.
- [ ] `pnpm test`, `pnpm run typecheck:all` and `pnpm run build` all pass
      (`lint:brand`, `lint:tokens`, `lint:commands`).
- [ ] Harness (`node .claude/skills/ui-parity/scripts/harness.mjs --port 8735`,
      wait 3s, check that `cssRules.length > 0`): the mock host answers, every affected
      row is clicked, and `probe-oracle.js` shows **0 structural diffs** on each affected window.
- [ ] VS Code checklist items for the user: numbered, against the real CLI,
      each with the exact expected result. The agent can't observe real VS Code,
      so these are marked **unverified** until the user runs them.

## Steps

### Group 1: frontend defects (spec Part A)
- [01: App fills the webview](01-app-fills-webview.md)
- [02: Slash Commands section gets data (done)](02-slash-commands-section.md)
- [03: Streaming text marked partial (done)](03-streaming-partial-text.md)
- [04: Status dot follows `p85` (done)](04-assistant-status-dot.md)
- [05: Header glyphs (closed: superseded by the user's `d496deb`; re-measured, done)](05-header-glyphs.md)
- [06: Checkpoint, group 1 report (done: results/01-frontend.md)](06-checkpoint-frontend.md)

### Group 2: SDK upgrade (B5)
- [07: Upgrade the Agent SDK to the latest version (done: 0.3.274, see results/07-sdk-upgrade.md)](07-sdk-upgrade.md)
- [08: Checkpoint, group 2 report (done: results/02-sdk.md)](08-checkpoint-sdk.md)

### Group 3: dispatcher
- [09: Re-enable `open_claude_in_terminal` (done)](09-open-claude-in-terminal.md)
- [10: Checkpoint, group 3 report (done: results/03-dispatcher.md)](10-checkpoint-dispatcher.md)

### Group 4: model and permissions
- [11: `apply_settings` whitelist and precedence (done: results/11-apply-settings.md)](11-apply-settings.md)
- [12: Model metadata (done: results/12-model-metadata.md)](12-model-metadata.md)
- [13: Effort end to end, and Ultracode (done: results/13-effort.md)](13-effort.md)
- [14: Thinking toggle separate from effort (done: results/14-thinking-toggle.md)](14-thinking-toggle.md)
- [15: "Toggle fast mode" row (done: results/15-fast-mode-row.md)](15-fast-mode-row.md)
- [16: Permission option 2 with save destination, and the "Permission rules" dialog (done: results/16-permission-destination.md)](16-permission-destination.md)
- [17: Plan-mode labels, plan answers and the plan preview (done: results/17-plan-mode-labels.md)](17-plan-mode-labels.md)
- [18: `persist_session_permission_mode` (done: results/18-persist-session-permission-mode.md)](18-persist-session-permission-mode.md)
- [19: Checkpoint, group 4 report (done: results/04-model-permissions.md)](19-checkpoint-model-permissions.md)

### Group 5: conversations
- [20: Rename session (done)](20-sessions-rename.md) — [results](results/20-sessions-rename.md)
- [21: Archive / Unarchive (done)](21-sessions-archive.md) — [results](results/21-sessions-archive.md)
- [22: Unread and status dot (done)](22-sessions-unread-status.md) — [results](results/22-sessions-unread-status.md)
- [23: Git-branch search (done)](23-sessions-branch-search.md) — [results](results/23-sessions-branch-search.md)
- [24: Rewind code with a dry-run confirmation (done; the `rewind` row is registered in step 25)](24-rewind-code.md) — [results](results/24-rewind-code.md)
- [25: Fork and "Message actions" (done)](25-fork-and-message-actions.md) — [results](results/25-fork-and-message-actions.md)
- [26: "Resume conversation" row (done)](26-resume-conversation-row.md) — [results](results/26-resume-conversation-row.md)
- [27: Checkpoint, group 5 report (done)](27-checkpoint-conversations.md) — [results](results/05-conversations.md)

### Group 6: browser and views, plus live rows to finish
- [28: @browser tabs and "Browse the web" (done)](28-browser-integration.md) — [results](results/28-browser-integration.md)
- [29: Output styles (done)](29-output-styles.md) — [results](results/29-output-styles.md)
- [30: Focus view (done)](30-focus-view.md) — [results](results/30-focus-view.md)
- [31: Customize rows open the matching Settings tab (done)](31-settings-tabs.md) — [results](results/31-settings-tabs.md)
- [32: Typed `open_config` / `open_help` replace the `command:` allow-list (done)](32-typed-open-config-help.md) — [results](results/32-typed-open-config-help.md), [endpoints-line results](results/32-33-typed-open-config-help.md)
- [33: Remove "Report a problem" (done as part of step 32: its only implementation was the `command:` branch)](33-remove-report-a-problem.md) — [results](results/32-typed-open-config-help.md), [endpoints-line results](results/32-33-typed-open-config-help.md)
- [34: Checkpoint, group 6 report](34-checkpoint-browser-views.md)

### Final
- [35: Final report and VS Code checklist handover](35-final-report.md)

### Group 7: defects reported from a real VSIX install
- [42: Five install defects — the packaging skew, the Settings tabs, adding an
  endpoint from the UI, and the mark in VS Code's chrome](42-vsix-install-defects.md)
- [43: The activity bar opens your history, not a second chat](43-sidebar-arrangement.md)
- [44: Paste the token, not an environment variable name](44-endpoint-token-in-keychain.md)
- 45: The endpoint setup card, and the welcome page's cube in the chrome — recorded as divergences #13-#15 in [forge-design.md](../forge-design.md)
- [46: The "/" rows finally land, and setup starts from what is running](46-command-args-and-endpoint-discovery.md)

### Group 8: small models
- [47: Small-model guards: hallucination and endless loops](47-small-model-guards.md)

## Constraints on every step
- Every colour goes through `styles/forge-tokens.css`. Fonts are Anthropic Sans
  and GitLab Mono only.
- No global preflight. No scoped `<style>` overrides on ported official classes.
  New CSS modules go in `scripts/port-official-css.mjs` `MODULES`.
- Don't bring back the composer's star/effort legend.
