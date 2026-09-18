# Step 17: Plan-mode labels

**Group:** 4  **Depends on:** 16

> **Corrected in step 17 against the bundle** (see
> [results/17-plan-mode-labels.md](results/17-plan-mode-labels.md)):
> 1. `U` is **"the ExitPlanMode request has plan comments"**
>    (`G && J.getPlanComments($.channelId).length > 0`), not "the user typed
>    feedback". Plan comments are made in the **plan preview**, a panel the
>    official opens beside the chat for every ExitPlanMode prompt
>    (`open_markdown_preview`, `plan_comment`, `remove_plan_comment`,
>    `close_plan_preview`). The user decided (2026-09-18) to build it in this step.
> 2. The plan prompt's body is its own (`dT.permissionRequest`): "Accept this
>    plan?" / "Select text in the preview to add comments", or the comments plus
>    "Continue planning" / "N comments will be included as feedback".
> 3. What each option sends is part of the step: option 1 pushes `acceptEdits`
>    with `set_permission_mode {mode, userInitiated:false}`; option 2 answers with
>    `setMode default` for the session; "No, keep planning" sends the official
>    `_61` text.

## Today
Forge relabels to "Yes, and auto-accept" / "No, keep planning" whenever the **session** is in plan mode.

## Official (`EU0`, `dT`, `MW0`)
- `G = toolName === "ExitPlanMode"`: the labels belong to the request.
- Option 1 `d0`: "Yes, and auto-accept" (plan) / "Submit answers" (AskUserQuestion) / "Yes".
- Option 2 on a plan: "Yes, and manually approve edits".
- Reject `v0`: "Send feedback and keep planning" (plan with comments) / "No, keep planning" (plan) / "No".
- `!U` hides buttons 1 and 2; the reject button is then numbered 1.
- `MW0`: an ExitPlanMode prompt opens the plan preview (title from the plan's
  `# heading`, else "Claude’s Plan"; comments on) and closes it when the plan is accepted.

## Tasks
- [x] Use the official condition for the labels, not the session mode.
- [x] Copy every label variant exactly.
- [x] Each option sends the official response and mode change.
- [x] The plan prompt body and the plan preview with comments.
- [x] Spec: the label choice for ordinary, ExitPlanMode and commented plans; the answers; the preview requests.

## Validate
- [x] Gates pass.
- [x] Harness: seed an ExitPlanMode request and an ordinary request while in plan
      mode. Only ExitPlanMode uses the plan labels. Add a plan comment and the
      label changes. Record what each option sends. Oracle: 0 structural diffs.

## VS Code checklist for the user
1. In plan mode, let Claude finish a plan. **Expected:** the plan opens in a
   "Forge’s Plan" (or the plan's heading) tab beside the chat, with "Ready for review".
2. Choose each option in turn (on three plans). **Expected:** "Yes, and
   auto-accept" → mode Edit automatically; "Yes, and manually approve edits" →
   Manual; "No, keep planning" → stays in Plan.
