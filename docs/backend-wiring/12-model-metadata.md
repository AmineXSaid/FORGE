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

## Corrections found while implementing (step 12, 2026-09-18)

The bundle and the SDK contradict this file in four places. What was built
follows the bundle; see [results/12-model-metadata.md](results/12-model-metadata.md).

1. **`wC` is not part of `set_model`.** `wC(selected, lastServedModel, rows)` is a
   *webview* label function: it names the pill and the "/" menu's "Switch model…"
   trailing text, and it switches to the model that actually served the last turn
   when that is another family. The official host's `setModel` is just:
   refuse a row whose `value` is not a string (`"set_model: malformed request"`),
   then `writeUserSettingsAndPush(channel, {model: value === "default" ? null : value})`,
   then answer `{type:"set_model_response"}` (plus `applied` from `getSettings()`).
2. **The official does not validate `set_model` against the supported list.**
   The CLI accepts aliases, full ids, `[1m]` variants and custom ids, and Forge's
   custom models are such ids. Only the malformed-row check was ported.
3. **"Today" was out of date.** `ModelSelect.vue` read the list from a separate
   `sdk_probe` CLI spawn. The official reads `claudeConfig.models` and
   `claudeConfig.unavailable_models` from the initialize response, which Forge
   already fetches at startup (`get_claude_state`). The probe is gone from the picker.
4. **Unavailable models are gated by the entrypoint.** The CLI only sends
   `unavailable_models` when `CLAUDE_CODE_ENTRYPOINT` is `claude-vscode`
   (`UNAVAILABLE_MODELS_HOST_ENTRYPOINTS` in CLI 2.1.274). Forge set that on
   `process.env` *after* building the launch env, so the first launch of every
   window reported `sdk-ts`. It is now stamped last on the env, as the official `l3` does.

`currentModelSupportsFastMode` is `currentModelInfo.supportsFastMode ?? false`,
where `currentModelInfo` matches the selection by value, then without `[1m]`,
then by `resolvedModel` (step 15 reads it).
