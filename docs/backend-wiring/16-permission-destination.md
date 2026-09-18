# Step 16: Permission option 2 with its save destination

**Group:** 4  **Depends on:** 11

> **Corrected in step 16 against the bundle** (see
> [results/16-permission-destination.md](results/16-permission-destination.md)).
> The original text had three things wrong:
> 1. Option 2 does **not** send `add_permission_rules`. It answers the prompt with
>    `updatedPermissions`: the suggestions, each re-targeted to the chosen
>    destination (`i1` in `EU0`); the CLI writes the settings file itself. The host
>    keeps only updates the prompt offered (`QI0`).
> 2. `session` is not a destination of `add_permission_rules`: the host accepts
>    only `userSettings | projectSettings | localSettings` (`Wo$`). A session grant
>    is an `updatedPermissions` entry with `destination: "session"`.
> 3. The three requests belong to the **"Permission rules" dialog** (`kU0`), opened
>    from "/" → Customize → Permissions. The user decided (2026-09-18) to port that
>    dialog in this step, so the row opens it instead of the Settings page.

## Today
`PermissionRequestModal.vue` option 2 is the static text "Yes, and don't ask again".

## Official
- `L45({suggestions, destination, onDestinationChange})`: the suggestion text plus a
  `destinationLink` (dotted underline) cycling `localSettings` → `userSettings` →
  `projectSettings` → `session` (`by`, `uK1`). The start is the remembered choice
  (`localStorage["claude-vscode-permission-destination"]`), else the broadest
  suggested destination (`O45`), else `session`.
- Option 2 answers `accept(inputs, suggestions.map(s => ({...s, destination: s.type === "setMode" ? s.destination : chosen})))`.
  A session-scoped `setMode` among them is mirrored in the webview first
  (`setPermissionMode(mode, false, false)`), not pushed.
- `{type:"add_permission_rules", rules, behavior, destination}`,
  `{type:"list_permission_rules"}`, `{type:"remove_permission_rule", rule, behavior, source}`:
  sent by `kU0` only. The host validates the shape (in-band `error: "invalid request"`),
  runs `claude edit-permission-rules --json` in the session's cwd, and re-reads
  `query.listPermissionRules()` up to 14 × 300 ms (`pending` if not yet listed).

## Six places (B2), for each of the three requests
- Handler checks: `behavior` in `allow | deny | ask`; destination one of the three
  settings files; 1–100 rules of ≤ 10 000 characters; the CLI writes the file.
- `test/permissionRules.spec.ts`: the checks, the write, the re-read, the prompt
  filter, and every rejection.

## Tasks
- [x] Port `L45` into the modal (DOM, class, copy).
- [x] Option 2 answers the request with the re-targeted `updatedPermissions`.
- [x] Port the "Permission rules" dialog (`kU0`) and open it from "/" → Permissions.
- [x] Mock host: `__forgeSeedPermission()` with suggestions; record the answers and the rules.

## Validate
- [x] Gates pass.
- [x] Harness: seed a prompt, change the destination (the copy changes to the
      official strings), and choose option 2. Record the answer.
      Oracle on the prompt and on the dialog: 0 structural diffs.

## VS Code checklist for the user
1. Trigger a Bash permission, set the destination to "this project (shared)", and
   choose option 2. **Expected:** the rule is in `<workspace>/.claude/settings.json`,
   and the same command isn't asked about again.
2. "/" → Permissions. **Expected:** the rule from step 1 is listed under Allow,
   "From shared project settings", with Remove.
