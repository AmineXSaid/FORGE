# Settings precedence: where `effortLevel` lives, and why

Written for step 11 (`apply_settings`), as `CLAUDE.md` B6 requires: *"Before
persisting anything (e.g. `effortLevel`), confirm how the forge.json flag
settings rank against user settings, so a profile doesn't silently override the
user's choice. Test that case."*

## The layers

The CLI resolves settings in this order, lowest first:

| Layer | File | Who writes it |
| --- | --- | --- |
| `userSettings` | `~/.claude/settings.json` | the user, and `apply_settings` |
| `projectSettings` | `.claude/settings.json` | the repo |
| `localSettings` | `.claude/settings.local.json` | `query.updateSettings('localSettings', …)` |
| **flag settings** | whatever `--settings` points at | **highest priority** |

> "Flag settings sit above user/project/local" — `sdk.d.ts` L2729.

Forge launches the CLI with `--settings ~/.claude/forge.json`
(`ClaudeSdkService.ts`, the `extraArgs.settings` entry), so **forge.json is the
flag layer**. The official extension has no equivalent file.

## The problem

`ConfigurationService.syncProfileToForge()` wrote the active profile's entire
contents into forge.json. Profiles are ordinary settings files
(`~/.claude/settings.<name>.json`), so a profile that happened to contain
`effortLevel` would pin it in the highest-priority layer.

The user then picks an effort level in the UI, `apply_settings` writes it to
`~/.claude/settings.json` — the *lowest* layer — and nothing changes. Worse, it
looks like it worked, because the control keeps its new label. That is exactly
the failure `CLAUDE.md` B7 is about: "A control that changes its label but not
the model's behaviour is broken."

## How the official resolves it

`tu$` puts `effortLevel` in `userSettings`. `writeUserSettingsAndPush` then does
two things, in order:

1. merge the patch into `~/.claude/settings.json`;
2. `await query.applyFlagSettings(settings)`.

`applyFlagSettings` is **session-scoped** (`sdk.d.ts` L2749): it sets the flag
layer of the running CLI only, and writes no file. So in the official the flag
layer is a live-apply channel, never a store, and `effortLevel` is owned by user
settings at all times.

## The decision

**Match that: strip the keys `apply_settings` owns from the forge.json profile
sync.**

- `settingsWhitelist.ts` exports `FLAG_SETTINGS_RESERVED_KEYS`, derived from
  `WEBVIEW_WRITABLE_SETTINGS` so the two cannot drift apart.
- `syncProfileToForge()` passes the profile through `stripFlagReservedKeys()`.
  Everything else a profile carries — `model`, `env`, `permissions`,
  `mcpServers` — still overlays as before; that is what profiles are for.
- `ClaudeAgentService.applySettings()` writes `~/.claude/settings.json` and then
  calls `query.applyFlagSettings(settings)`, in the official's order.

The result, for a user who picks `high` while a profile is active:

| When | Where `effortLevel` comes from | Value |
| --- | --- | --- |
| before the change | forge.json (flag layer) | the profile's, the user's ignored |
| now, immediately | `applyFlagSettings` on the live session | `high` |
| now, next launch | `~/.claude/settings.json` (forge.json no longer pins it) | `high` |

The rejected alternative was to keep writing `effortLevel` into forge.json and
treat the flag layer as the store. It would work, but it diverges from the
official layering, it makes the value invisible to anything reading
`settings.json`, and it would mean a profile switch silently changes effort.

## What is covered by tests

`test/applySettings.spec.ts`:

- `stripFlagReservedKeys` removes `effortLevel` and `ultracode` (since step 13) and nothing else;
- `FLAG_SETTINGS_RESERVED_KEYS` stays equal to the whitelist's keys, so adding
  `outputStyle` in step 29 cannot reintroduce the bug;
- the whitelist refuses `effortLevel` aimed at the flag layer (`flagsOnly: true`)
  or at `localSettings`, so the layer cannot be chosen by the webview.

## Still unverified

Whether the value reaches the model's behaviour (B7) can only be seen against the
real CLI, and the control that sends it arrives in step 13. The checklist item is
in `docs/backend-wiring/results/04-model-permissions.md` when that group closes;
until then, step 11's own checklist covers the file write and the precedence.

## Step 13: `ultracode` joins the reserved keys

Ultracode came into scope on 2026-09-18 and `ultracode` joined the whitelist on
the `flags` layer, so `FLAG_SETTINGS_RESERVED_KEYS` now holds it too and profile
sync strips it from forge.json.

That is deliberate. `Settings.ultracode` is session-scoped ("typically provided
via --settings or the apply_flag_settings control request; interactive toggles
never persist it", `sdk.d.ts` L8496). If a profile could pin `ultracode: true`
in forge.json, the effort slider's `{ultracode: null}` would clear the live flag
layer but the next launch would turn it straight back on -- the same "label
changes, behaviour doesn't" trap as `effortLevel`. Ultracode now exists only while
the session has it switched on, exactly as in the official, where the flag layer
is `applyFlagSettings` and nothing else.

`effortLevel` itself is unchanged: user settings, pushed live. One consequence
of porting the official value check literally: `'max'` is accepted and written
to `~/.claude/settings.json`, where the CLI's own schema
(`effortLevel: low | medium | high | xhigh`) drops it on the next launch. The
running session keeps Max (`applyFlagSettings` accepts it, L2749); a new one
starts at the model's default. The official host behaves identically.
