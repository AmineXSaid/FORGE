# Step 17: Plan-mode labels

**Group:** 4  **Depends on:** 16

## Today
Forge relabels to "Yes, and auto-accept" / "No, keep planning" whenever the **session** is in plan mode.

## Official (`y5`)
- The plan flag (`G`) belongs to the **ExitPlanMode request**.
- Option 2 then reads "Yes, and manually approve edits".
- When the user types feedback (`U`), the reject label becomes "Send feedback and keep planning".
- Read `y5` for every variant and what each option sends (the resulting permission mode).

## Tasks
- [ ] Use the official condition for the labels, not the session mode.
- [ ] Copy every label variant exactly.
- [ ] Each option sends the official response and mode change.
- [ ] Spec: the label choice (pure function) for ordinary, ExitPlanMode and feedback-typed requests.

## Validate
- [ ] Gates pass.
- [ ] Harness: seed an ExitPlanMode request and an ordinary request while in plan
      mode. Only ExitPlanMode uses the plan labels. Type feedback and the label
      changes. Record what each option sends. Oracle: 0 structural diffs.

## VS Code checklist for the user
1. In plan mode, let Claude finish a plan, then choose each option in turn.
   **Expected:** the mode afterwards matches the official behaviour for that option.
