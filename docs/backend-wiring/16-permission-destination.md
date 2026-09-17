# Step 16: Permission option 2 with its save destination

**Group:** 4  **Depends on:** 11

## Today
`PermissionRequestModal.vue` option 2 is the static text "Yes, and don't ask again".

## Official
- `L45({suggestions, destination, onDestinationChange})`: the suggestion text plus a
  `destinationLink` (dotted underline) that chooses `session` / `localSettings` /
  `projectSettings` / `userSettings`. Read `L45` for the exact copy, the
  switching behaviour and the default.
- `{type:"add_permission_rules", rules, behavior, destination}`, plus
  `list_permission_rules` and `remove_permission_rule`. Read all three handlers.

## Six places (B2), for each of the three requests
- Handler checks: `behavior` in the official set; `destination` one of the four;
  rules well-formed; write to the destination's file (`session` = in memory);
  apply to the running query through the SDK.
- `test/permissionRules.spec.ts`: each destination writes the right place;
  bad `behavior`, destination or rule is rejected.

## Tasks
- [ ] Port `L45` into the modal (DOM, class, copy).
- [ ] Option 2 answers the request **and** sends `add_permission_rules`, in the official order.
- [ ] Mock host: `__forgeSeedPermission()` with suggestions; record the rules.

## Validate
- [ ] Gates pass.
- [ ] Harness: seed a prompt, change the destination (the copy changes to the
      official strings), and choose option 2. Record both messages.
      Oracle on the prompt: 0 structural diffs.

## VS Code checklist for the user
1. Trigger a Bash permission, set the destination to project, and choose option 2.
   **Expected:** the rule is in `<workspace>/.claude/settings.json`, and the same
   command isn't asked about again.
