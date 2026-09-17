# Step 20: Rename session

**Group:** 5  **Depends on:** 19

## Official
- Row action "Rename session" (`bn` icon) with inline editing (read `QW0` / `At` /
  `V95` for the Enter, Escape and blur behaviour).
- `{type:"rename_session", sessionId, title}`. The host appends
  `{"type":"custom-title","sessionId","customTitle"}` to the session's `.jsonl`.

## Six places (B2)
- Handler:
  - `sessionId` in id format **and** resolves to an existing transcript in the
    project's sessions directory, with no raw path joins;
  - `title` trimmed, length-capped, newlines stripped;
  - append one line, never rewrite the file.
- `test/renameSession.spec.ts`: the append; rejection of `../x`, an unknown id and an empty title.

## Tasks
- [ ] The `list_sessions_response` title prefers the latest `customTitle`, as the official does.
- [ ] Add the row action with the extracted `bn` icon and the inline editor to `SessionsDropdown.vue`.

## Validate
- [ ] Gates pass.
- [ ] Harness: rename, and the title updates and is searchable. Escape sends
      nothing. Oracle on the dropdown: 0 structural diffs.

## VS Code checklist for the user
1. Rename a session and reload. **Expected:** the new title is shown, and its
   `.jsonl` ends with a `custom-title` line.
