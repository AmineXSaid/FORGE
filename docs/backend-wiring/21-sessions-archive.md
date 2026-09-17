# Step 21: Archive / Unarchive

**Group:** 5  **Depends on:** 20

## Official
- Row actions: `H21` (archive) and `B21` (unarchive) icons.
- `{type:"archive_session"|"unarchive_session", sessionId}`, stored in extension settings.
- Archived rows go under an "Archived sessions" group header. Read its position and collapse behaviour.

## Six places (B2) for both requests
- Handler: validate the id, and store the set the way the official does.
- `test/archiveSession.spec.ts`: archive, unarchive, and bad-id rejection.

## Tasks
- [ ] `list_sessions_response` carries the archived flag.
- [ ] The dropdown gets the actions (extracted icons) and the group header.

## Validate
- [ ] Gates pass.
- [ ] Harness: archive moves the row under the header, and unarchive moves it
      back. Oracle: 0 structural diffs.

## VS Code checklist for the user
1. Archive a session and reload. **Expected:** it's still under "Archived sessions".
