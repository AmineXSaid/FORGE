# Step 11: `apply_settings` whitelist and precedence

**Group:** 4  **Depends on:** 10

## Official
- Sender: `{type:"apply_settings", settings, flagsOnly?, scope?}`.
- `tu$` in `extension.js` is the whitelist. Each key has a layer:
  `effortLevel`→userSettings, `ultracode`→flags, `switchModelsOnFlag`→userSettings,
  `outputStyle`→localSettings, `remoteControlAtStartup`→userSettings.
  Unknown keys are rejected.
- Read `applySettings` for value validation, `flagsOnly`, `scope`, how it writes,
  and how it pushes to the running CLI (the SDK settings API; use the upgraded SDK's real call).

## Scope adjustment
Forge's whitelist holds only in-scope keys: `effortLevel` now, and `outputStyle`
in step 29. `ultracode`, `switchModelsOnFlag` and `remoteControlAtStartup` are
out of scope, so they're rejected.

## Precedence (B6)
`ClaudeSdkService.ts` (~L201–230, ~L363) launches with `--settings ~/.claude/forge.json`,
which is **flag settings, the highest priority**. Before persisting:
- [ ] Find out whether profile sync can write `effortLevel` or `outputStyle` into
      `forge.json`. If it can, a profile silently overrides the user's choice.
      Fix it so the user's choice wins: strip these keys from the forge.json sync,
      or write them to the flag layer consistently. Pick the option that matches
      how the official layers resolve, and write down the choice.
- [ ] A spec covers this case.

## Six places (B2)
1. Types. 2. Transport `applySettings(settings, opts)`. 3. Dispatcher case.
4. Handler: whitelist, type check per key, atomic merge-write to the layer file
   (keep other keys), push live through the SDK API from `docs/sdk-upgrade.md`.
5. Mock host: the same whitelist. 6. `test/applySettings.spec.ts`:
   - unknown key rejected, bad enum rejected, out-of-scope keys rejected;
   - the right file is written and other keys are kept;
   - the forge.json precedence case.

## Validate
- [ ] Gates pass.
- [ ] Harness: from devtools, post `{effortLevel:"high"}` (accepted) and
      `{apiKeyHelper:"x"}` / `{ultracode:true}` (rejected). Check the mock-host log.
      (The UI that uses it arrives in step 13.)

## VS Code checklist for the user
1. After step 13, change effort. **Expected:** `~/.claude/settings.json` has the new
   `effortLevel`, other keys are unchanged, and `forge.json` doesn't override it.
