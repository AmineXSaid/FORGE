# Step 36: The endpoint configuration surface

**Group:** 6 (self-hosted endpoints)  **Depends on:** —

## Problem
`endpointService.ts` reads `forge.endpointProfile` and `forge.endpointProfilesDir`
through `getConfiguration`, but **neither is declared in `package.json`
contributes**. They are invisible in the Settings UI, get no IntelliSense, and a
typo in either is silent. The only declared endpoint entry is
`forge.endpointStatus`, which is a command.

Profiles themselves could only be YAML files in a directory, which is a poor fit
for the primary case: one gateway, described once, in the same `settings.json`
the rest of Forge is configured from.

## Official
No official analogue — the Claude Code extension talks to `api.anthropic.com`
and has no profile concept. The contract copied here is Genesis's, from
`kryptonite/src/endpoints/profile.ts`: the same required fields, the same
`AuthSpec` / `TlsSpec` / `ProxySpec`, and the same `DEFAULT_CAPS` merge.

## Tasks
- [x] Split `loadProfile(file)` into `parseProfile(doc, source)` plus a thin file
      wrapper, so settings and YAML share one validator and one defaults merge.
- [x] `parseProfileMap()` for the settings map: the map key supplies `name`, and
      one bad entry does not hide the others.
- [x] Declare `forge.endpoints`, `forge.endpointProfile` and
      `forge.endpointProfilesDir` in contributes, with a full JSON schema —
      enums on `wire`, `auth.kind`, `systemRole`, `promptCaching`,
      `reasoningField`, and hover docs on every field.
- [x] Precedence: `forge.endpoints` first, then the YAML directory. A duplicate
      name logs a warning and settings wins.
- [x] Add the four capability fields that gate Anthropic-logic UI: `effort`,
      `effortLevels`, `reasoningField`, `fastMode`.
- [x] Extend `forge.endpointStatus` to re-scan both sources and report the active
      profile, its origin, the resolved transport, the gating capabilities, and
      every profile that failed to parse.
- [x] Spec: `test/endpointProfile.spec.ts`, including a schema drift guard.

**Secrets stay out of configuration.** `settings.json` syncs between machines
and tends to get committed, so `auth.value` documents `${env:VAR}`,
`${file:path}` and `${secret:KEY}`, all resolved at request time by
`interpolate()`.

## Validate
- [x] Gates pass: `vitest` 701 passed, `typecheck:all`, `lint:forge`, `build`.
- [x] 30 specs, including: both sources merged, settings winning a collision
      with a logged warning, a malformed entry isolated, and the schema's
      capability list and defaults matching `DEFAULT_CAPS` exactly.

## VS Code checklist for the user
Unverified against real VS Code — the agent cannot observe the Settings UI.

1. Open `settings.json` and type `"forge.endpoints"`. **Expected:** IntelliSense
   offers the setting; opening an entry offers `wire`, `baseUrl`, `model`, and
   `wire` autocompletes to exactly `openai`, `anthropic`, `raw`.
2. Set `"wire": "grpc"`. **Expected:** a squiggle on the value.
3. Omit `model` from an entry. **Expected:** a squiggle naming the missing
   required property.
4. Hover `contextWindow`. **Expected:** the description explaining that it drives
   compaction and output filtering.
5. Run **Forge: Show Endpoint Status** with a profile that has a typo.
   **Expected:** the output channel lists the profile under "profiles that
   failed to parse" with the field named, not a silent omission.
6. Define the same profile name in both `forge.endpoints` and a YAML file.
   **Expected:** the status output shows it once, sourced from `settings`, and
   the channel carries the "defined both in" warning.
7. With `forge.endpointProfile` unset, start a conversation. **Expected:** no
   `ANTHROPIC_BASE_URL` line in the output channel; the Anthropic path is
   untouched.
