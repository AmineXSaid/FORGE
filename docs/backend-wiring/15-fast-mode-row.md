# Step 15: "Toggle fast mode" row

**Group:** 4  **Depends on:** 09, 12

## Official
Registry row: `fast` | "Toggle fast mode" | section Model. It's registered only
when `currentModelSupportsFastMode`, and it runs
`openClaudeInTerminal("/fast", [], "bottom")`. Copy the description from the registry.

## Tasks
- [ ] Expose `currentModelSupportsFastMode` exactly as the official derives it (step 12 data).
- [ ] Register the row only when it's true. It sends the step 09 request with `prompt:"/fast"`.
- [ ] The spec covers the row gating, and step 09's validator accepting `/fast`.

## Validate
- [ ] Gates pass.
- [ ] Harness: the row shows only for the supporting model. Clicking it sends
      `{prompt:"/fast", args:[], location:"bottom"}`, and the menu closes.

## VS Code checklist for the user
1. With a fast-mode model, "/" → Toggle fast mode. **Expected:** a bottom terminal runs `claude /fast`.

## Notes from implementing (step 15, 2026-09-18)

See [results/15-fast-mode-row.md](results/15-fast-mode-row.md). The file was right;
two things it didn't say:

1. **Where the row goes.** The official registry sorts the Model section by
   `["model","effort-level","toggle-thinking","switch-models-on-flag","account-usage"]`
   and puts ids it doesn't list after those, in registration order, so `fast`
   comes after Thinking.
2. **`fast_mode_state` is not this row's business.** The official shows it only
   in the composer's spark legend (`U85`: "Fast mode enabled" / "Fast mode
   cooling down") and the fieldset's `data-spark`. `00-index.md` forbids bringing
   that legend back, so the state is not surfaced; the row itself carries no state.
