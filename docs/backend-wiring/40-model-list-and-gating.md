# Step 40: Model list and capability-driven gating

**Group:** 6 (self-hosted endpoints)  **Depends on:** 39

## Problem
With a profile active, the model picker still showed the CLI's built-in table —
Claude tiers that a private gateway does not serve. Picking one offered the user
a model that cannot answer. Worse, every capability gate hung off those rows, so
the effort and fast-mode controls described Anthropic models rather than the
endpoint actually in use.

## Official
`sdk.d.ts:1313` (`ModelInfo`), and `Session.ts:184-226`, which already derives
every gate from one place:

```
currentModelSupportsEffort    ← currentModelInfo()?.supportsEffort
currentModelSupportsFastMode  ← currentModelInfo()?.supportsFastMode
isUltracodeAvailable(...)     ← currentModelInfo()?.supportedEffortLevels
```

**The gating mechanism already exists and needs no change.** It needed a
different source, not different logic — so `Session.ts` is untouched by this
step, and the rows use the SDK's field names exactly (`value`, `displayName`,
`description`, …) so the webview cannot tell the difference.

## Tasks
- [x] `models[]` on the profile, with schema: `id` (required), `displayName`,
      `description`, `supportsEffort`, `supportedEffortLevels`,
      `supportsFastMode`, `contextWindow`, `unavailable`.
- [x] `src/services/endpoints/models.ts` — `profileModelRows`, applying the
      intersection; `contextWindowFor`.
- [x] `handleSdkProbe` returns the profile's rows for `supportedModels` when a
      profile is active, and drops the CLI's now-unused probe error.
- [x] `endpointService` added to `HandlerContext`; `getStatus()` falls back to
      the *selected* profile so the first probe during init is not answered
      from the CLI table and then swapped.
- [x] Spec: `test/endpointModels.spec.ts` (22).

### The intersection rule
A model entry is a **claim**; the capability block is **evidence**; evidence
wins.

- `supportsEffort: true` on a model, `capabilities.effort: false` on the
  endpoint → greyed. This is the live-gateway case from step 38: the endpoint
  accepts `reasoning_effort` and ignores it, and without the intersection the
  user would get four rungs that all produce the same answer.
- The reverse also holds: a capable endpoint does not grow effort on a model
  that has none.
- Levels intersect too, which is what decides Ultracode —
  `isUltracodeAvailable` reads `supportedEffortLevels`, so a model claiming
  `xhigh` against an endpoint that stops at `high` cannot offer it.
- A model that says nothing **inherits** the endpoint-wide value, which is the
  common single-model case.

### No profile, no change
With `forge.endpointProfile` unset, `getStatus().profile` is undefined and
`handleSdkProbe` returns the CLI's answer untouched.

## Validate
- [x] Gates pass: `vitest` 796 passed / 6 skipped, `typecheck:all`,
      `lint:forge`.
- [x] The row shape is asserted against the SDK field names, so a rename in
      either place fails the build rather than silently un-gating the UI.

## VS Code checklist for the user
Unverified against real VS Code.

1. With a profile active, open the model picker. **Expected:** it lists your
   gateway's model ids, not Claude tiers.
2. Run **Forge: List Endpoint Models** and copy ids into `models[]`.
   **Expected:** each appears in the picker with its context window.
3. Set `capabilities.effort: false`. **Expected:** the effort rows disappear.
4. Set `capabilities.effort: true` with `effortLevels: ["low","medium","high"]`
   and a model entry claiming `supportedEffortLevels: ["low","high","xhigh"]`.
   **Expected:** the effort rows return, but **Ultracode is not offered** —
   `xhigh` did not survive the intersection.
5. Add `xhigh` to `capabilities.effortLevels`. **Expected:** Ultracode appears.
6. Set a model `unavailable: true`. **Expected:** it is greyed, not hidden.
7. Unset `forge.endpointProfile` and reload. **Expected:** the picker returns to
   the CLI's own model list, unchanged.
