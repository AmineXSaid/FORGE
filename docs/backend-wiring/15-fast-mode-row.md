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
