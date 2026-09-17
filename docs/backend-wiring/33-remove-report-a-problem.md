# Step 33: Remove "Report a problem"

**Group:** 6  **Depends on:** 32

## Decision (CLAUDE.md)
Feedback is out of scope. The live button opens logs, which isn't what the
official does. Remove it and **keep the version text**.

## Tasks
- [ ] `components/forge/CommandMenu.vue` (~L88): remove the `reportProblemButton`
      and its `reportProblem` emit. Remove the parent handler.
- [ ] Keep the version row's DOM and classes exactly as the official version text
      (read the official version row so removing the button doesn't change its layout).
- [ ] If `forge.showLogs` was only used here, remove its webview path (step 32).

## Validate
- [ ] Gates pass.
- [ ] Harness: "/" shows the version text and no "Report a problem". Oracle on
      the menu footer: 0 structural diffs, apart from the removed button.

## VS Code checklist for the user
1. Open "/". **Expected:** the version text is at the bottom, with no "Report a problem".
