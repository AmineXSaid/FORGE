# Forge end to end: 2026-10-06T15:38:00.203Z

- Host: code-server (linux-x64)
- Gateway: stub-gateway, model `qwen3-coder`
- VSIX: `forge.vsix`
- Isolated root: `/tmp/claude-0/e2e/run2`

**pass 6 · partial 0 · fail 0 · unverified 0 · skipped 0**

| # | Scenario | Verdict | Evidence |
| --- | --- | --- | --- |
| 2 | First message: a streamed reply from the endpoint, recorded in the session .jsonl | pass | sent "hello from e2e 1791301028916"; assistant row shows the stub reply; gateway saw 1 request(s), model ids: qwen3-coder, streamed: true; session file: .claude/projects/-tmp-claude-0-e2e-run2-workspace/61e8cfe4-f8d3-4cee-aa1b-185b37f81c19.jsonl; ~/.claude/settings.json still absent after the first turn |
| 15 | Restricted Mode: Forge stays off until the workspace is trusted, then activates | pass | status bar: Restricted Mode; palette: no Forge command in Restricted Mode (untrustedWorkspaces.supported: false); no Forge webview in Restricted Mode; trusted through the Workspace Trust editor (real click); palette: Forge commands present once trusted |
| 35 | 48a: a Write cut off by the output token limit is never run, and the model is told why | pass | cutoff-1791301033237.ts is byte-for-byte unchanged after the cut-off Write; the next request's tool result carries: "Hint: nothing was written to /tmp/claude-0/e2e/run2/workspace/cutoff-1791301033237." |
| 36 | 48b: Alpha mode in a running conversation: persisted, the rules on the next message, no relaunch, retracted when off | pass | ~/.forge.json: alphaMode true; the next request carries _alpha.md as UserPromptSubmit context; no relaunch: 3 launch line(s) in Forge.log before and after; switched off: the next request carries the one-line retraction |
| 37 | 48b: a new conversation launched with Alpha mode on has the rules in its system prompt | pass | the stub gateway received _alpha.md in the system prompt |
| 38 | 48b: the 60-step cap is enforced, launched with Alpha on (maxTurns) and switched on mid-conversation (host counter) | pass | launched with Alpha on: 60 model requests, then "Forge stopped this turn at Alpha mode's step limit"; switched on mid-conversation: 60 model requests, then the same notice |
