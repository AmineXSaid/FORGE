# Step 22: Unread and status dot

**Group:** 5  **Depends on:** 21

## Official
- `vG` dot at the start of the row when `openState` is set (open / working /
  needs-input / unread).
- `{type:"set_session_unread", sessionKey, unread}`. Read when sessions become unread or read.

## Today
`SessionsPage.vue` tracks unread locally (`loadUnread` / `toggleUnread`).

## Six places (B2)
- Handler: validate `sessionKey` and that `unread` is a boolean; store the way the official does.
- `test/sessionUnread.spec.ts`.

## Tasks
- [ ] Move unread tracking to the host, and delete the local version.
- [ ] The host derives working and needs-input from live channels (busy, pending
      permission) and pushes updates.
- [ ] Use the same unread and read triggers as the official. Port `vG`.

## Validate
- [ ] Gates pass.
- [ ] Harness: seed each state. All four dots render. Opening an unread session
      clears it and sends the request. Oracle: 0 structural diffs.

## VS Code checklist for the user
1. Run a turn in tab A while viewing tab B. **Expected:** A shows working, then unread. Opening A clears it.
