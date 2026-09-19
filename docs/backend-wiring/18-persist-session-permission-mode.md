# Step 18: `persist_session_permission_mode`

**Group:** 4  **Depends on:** 17

## Official
`{type:"persist_session_permission_mode", sessionId, mode, previousSessionId, carriedFromStore}`.
Read the handler for the storage key, and how `previousSessionId` and
`carriedFromStore` carry the mode over. Read the webview senders for when it's sent.

What the bundle says (read 2026-09-19; the original checklist below was wrong):

- **Host** (`extension.js`, `persistSessionPermissionMode` + the settings store `C1$`):
  one `globalState` entry per session, key `sessionPermissionMode:<id>`, value
  `{mode, updatedAt}`. Only `pH` modes are kept (`zo$ = default, acceptEdits, auto,
  bypassPermissions`); **plan and dontAsk clear the entry**. Ids must match `y0`
  (a UUID) or the request is a no-op. Bypass is kept only while
  `bypassPersistGateOpen()` (allowed, and the CLI's settings don't set
  `permissions.disableBypassPermissionsMode: "disable"`). With `previousSessionId`
  and `carriedFromStore` the old entry **moves** to the new id; without
  `carriedFromStore` the old one is cleared. Entries expire after 30 days, the
  newest 200 are kept. `list_sessions` attaches each entry as `permissionMode`.
- **Webview** (`index.js`, `SL1` = the session's `modePersist`): sent after a
  deliberate pick (`setPermissionMode(mode, push, userInitiated=true)`) once the
  CLI accepted it, or at once when there is no live CLI (the launch applies it),
  or at once when it lowers privilege; again when the CLI's init names (or
  renames) the session. On open, a listed session adopts its stored mode
  (`adoptPersistedSessionMode`), else `initialPermissionMode`; the launch then
  starts the CLI in it, and the CLI's init overrules a restore it did not take.

**Forge's choices** (see `results/18-persist-session-permission-mode.md`):
Auto is kept out of Forge (user decision, step 17), so it is neither stored nor
restored. The initial mode is Settings > General > "Default Permission Mode", the
Forge equivalent of `claudeCode.initialPermissionMode`; because Forge's setting
always has a value, the official's second layer (`persistDefaultPermissionMode`,
the last mode picked) would never be read, and is not ported.

## Six places (B2)
- Handler: `mode` in the official enum; ids in session-id format; store the way the official does.
- `test/persistPermissionMode.spec.ts`: store, restore, carry-over, and rejection of a bad mode or id.

## Tasks
- [x] Send it from the same trigger points as the official.
- [x] On open or resume, restore into the mode control and the query (the launch's `permissionMode`).

## Validate
- [x] Gates pass.
- [x] Harness: set a kept mode in one session, Plan in another, reload, reopen
      each. The kept mode is restored, Plan is not, and the requests are recorded.

## VS Code checklist for the user
1. Set **Edit automatically** in session A and **Plan** in session B, then reload
   the window and reopen each from the sessions menu.
   **Expected:** A reopens in Edit automatically; B reopens in the initial mode
   (Settings > General > Default Permission Mode, normally Manual), because the
   official never keeps Plan.
