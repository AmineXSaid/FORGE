# Step 18: `persist_session_permission_mode`

**Group:** 4  **Depends on:** 17

## Official
`{type:"persist_session_permission_mode", sessionId, mode, previousSessionId, carriedFromStore}`.
Read the handler for the storage key, and how `previousSessionId` and
`carriedFromStore` carry the mode over. Read the webview senders for when it's sent.

## Six places (B2)
- Handler: `mode` in the official enum; ids in session-id format; store the way the official does.
- `test/persistPermissionMode.spec.ts`: store, restore, carry-over, and rejection of a bad mode or id.

## Tasks
- [ ] Send it from the same trigger points as the official.
- [ ] On open or resume, restore into `ModeSelect.vue` and the query (`setPermissionMode`).

## Validate
- [ ] Gates pass.
- [ ] Harness: set Plan mode, switch sessions and come back. The mode is restored
      and the requests are recorded.

## VS Code checklist for the user
1. Set Plan mode in session A and default in session B, then reload.
   **Expected:** A reopens in Plan and B in default.
