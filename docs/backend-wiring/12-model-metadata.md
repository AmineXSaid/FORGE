# Step 12: Model metadata

**Group:** 4 (B4 of spec)  **Depends on:** 11

## Today
`sdk_probe {capabilities:["supportedModels"]}` returns `data.supportedModels[]`.
`ModelSelect.vue` reads `value`, `displayName` and `description`.

## Official
- Entries: `displayName` (e.g. "Default (recommended)") and `description`
  (e.g. "Sonnet 5 · Efficient for routine tasks"). The pill shows the part before `" · "`.
- Per model: `supportsEffort`, `supportedEffortLevels`, and whatever
  `currentModelSupportsFastMode` reads (needed in step 15).
- Unavailable models are greyed with `unavailableModelItem`.
- `set_model` handles `default` with `lastServedModel` through `wC(...)`.
- Read how `extension.js` builds the model list and grep these field names in both bundles.

## Tasks
- [ ] Pass through the upgraded SDK's `supportedModels()` entries **in SDK order**,
      with the SDK's own field names. Don't invent fields: if the SDK lacks one,
      derive it only the way `extension.js` does.
- [ ] Unavailable models: sourced the way the official does, rendered with the ported class.
- [ ] `set_model`: port `wC` (the `default` / `lastServedModel` logic), and validate
      against the supported list.
- [ ] Mock host: realistic entries (one without effort, one unavailable, one with fast mode).
- [ ] `test/modelMetadata.spec.ts`: order kept, `set_model` rejects unknown values,
      `wC` default handling.

## Validate
- [ ] Gates pass.
- [ ] Harness: the picker rows, their order and the greyed row match. The pill
      text is correct. Oracle on the popup: 0 structural diffs.

## VS Code checklist for the user
1. Open the model picker. **Expected:** the same models, order and descriptions as Claude Code.
2. Pick Default and send a turn. **Expected:** the pill reflects the served model.
