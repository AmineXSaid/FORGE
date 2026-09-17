# Step 23: Git-branch search

**Group:** 5  **Depends on:** 22

## Official
The search matches the title **or** `session.gitBranch` (case-insensitive). While
loading, "Loading sessions…" shows the spinner glyph `JW0`. Clicking a row only
closes the dropdown for local sessions.

## Tasks
- [ ] `list_sessions_response` includes `gitBranch`, read from the transcript the way the official does.
- [ ] Extend the dropdown filter. The highlighting matches the official.
- [ ] Extract `JW0` with `extract-icons.mjs` for the loading state (same surface, rule 4).
- [ ] Spec: branch extraction from a transcript fixture, and the filter function.
- [ ] Out of scope (don't build): the worktree pill and `generate_session_title`.

## Validate
- [ ] Gates pass.
- [ ] Harness: search by a branch name (mixed case) and the session matches. A
      slow mock list shows the official spinner. Oracle: 0 structural diffs.

## VS Code checklist for the user
1. Search past conversations for a branch name. **Expected:** the sessions from that branch are listed.
