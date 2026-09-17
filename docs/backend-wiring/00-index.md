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
- [10: Checkpoint, group 3 report](10-checkpoint-dispatcher.md)

### Group 4: model and permissions
- [11: `apply_settings` whitelist and precedence](11-apply-settings.md)
- [12: Model metadata](12-model-metadata.md)
- [13: Effort end to end](13-effort.md)
- [14: Thinking toggle separate from effort](14-thinking-toggle.md)
- [15: "Toggle fast mode" row](15-fast-mode-row.md)
- [16: Permission option 2 with save destination](16-permission-destination.md)
- [17: Plan-mode labels](17-plan-mode-labels.md)
- [18: `persist_session_permission_mode`](18-persist-session-permission-mode.md)
- [19: Checkpoint, group 4 report](19-checkpoint-model-permissions.md)

### Group 5: conversations
- [20: Rename session](20-sessions-rename.md)
- [21: Archive / Unarchive](21-sessions-archive.md)
- [22: Unread and status dot](22-sessions-unread-status.md)
- [23: Git-branch search](23-sessions-branch-search.md)
- [24: Rewind code with a dry-run confirmation](24-rewind-code.md)
- [25: Fork and "Message actions"](25-fork-and-message-actions.md)
- [26: "Resume conversation" row](26-resume-conversation-row.md)
- [27: Checkpoint, group 5 report](27-checkpoint-conversations.md)

### Group 6: browser and views, plus live rows to finish
- [28: @browser tabs and "Browse the web"](28-browser-integration.md)
- [29: Output styles](29-output-styles.md)
- [30: Focus view](30-focus-view.md)
- [31: Customize rows open the matching Settings tab](31-settings-tabs.md)
- [32: Typed `open_config` / `open_help` replace the `command:` allow-list](32-typed-open-config-help.md)
- [33: Remove "Report a problem"](33-remove-report-a-problem.md)
- [34: Checkpoint, group 6 report](34-checkpoint-browser-views.md)

### Final
- [35: Final report and VS Code checklist handover](35-final-report.md)

## Constraints on every step
- Every colour goes through `styles/forge-tokens.css`. Fonts are Anthropic Sans
  and GitLab Mono only.
- No global preflight. No scoped `<style>` overrides on ported official classes.
  New CSS modules go in `scripts/port-official-css.mjs` `MODULES`.
- Don't bring back the composer's star/effort legend.
