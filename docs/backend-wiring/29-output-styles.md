# Step 29: Output styles

**Group:** 6  **Depends on:** 28

## Official
- Registry row: `output-style` | "Output styles" | section Customize.
- `get_output_style` → `{outputStyle, availableStyles}`; `get_output_style_locations`;
  `create_output_style`. Selecting a style → `apply_settings {outputStyle}` (localSettings).
- Read the handlers for the discovery directories and the created file format, and the picker UI.

## Six places (B2) for each request
- `create_output_style`: the name has no separators or `..`, and the file is written only inside the official locations.
- Add `outputStyle` to the step 11 whitelist, validated against `availableStyles`.
- `test/outputStyles.spec.ts`: discovery, creation, path-traversal rejection, bad style rejection.

## Tasks
- [ ] Build the picker (DOM, copy) and add the row.

## Validate
- [ ] Gates pass.
- [ ] Harness: open it, pick a style (`apply_settings` is sent), create a style.
      Record whether the menu closes. Oracle: 0 structural diffs.

## VS Code checklist for the user
1. Pick a style. **Expected:** `.claude/settings.local.json` has `outputStyle`, and the next reply follows it.
