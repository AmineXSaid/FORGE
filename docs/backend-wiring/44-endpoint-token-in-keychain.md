# Step 44: Paste the token, not an environment variable name

**Group:** 7 (post-install bug report)

> change the env variable to directly putting token not env variable

The guided "Add endpoint" flow (step 42) asked for the **name of an environment
variable** and wrote `${env:VAR}` into `settings.json`. That kept the key out of
a synced, committable file, but it put a chore in front of the one step someone
came to do: go set an env var, restart the editor so VS Code inherits it, come
back.

## The decision

Asked, because the two readings land the key in very different places. Chosen:
**the token is typed directly and stored in VS Code's `SecretStorage`** — the OS
keychain, per machine, never synced — with `settings.json` holding
`${secret:<key>}`. Same flow the request asked for, without the key in a file
that Settings Sync copies and git can pick up.

## What `${secret:…}` was doing before

`interpolate` already understood three forms:

```ts
value.replace(/\$\{(env|file|secret):([^}]+)\}/g, (_m, kind, key) => {
  if (kind === "env") return process.env[key] ?? "";
  if (kind === "secret") return secrets(key) ?? "";
  ...
});
```

but every caller passed `secrets: (key) => process.env[key]`. So `${secret:K}`
was an alias for `${env:K}` and nothing was stored anywhere. Five call sites did
this: `endpointService`, and the diagnostics ladder, capability probe and model
list in `forgeCommands`.

## What changed

**`services/endpoints/secretStore.ts`** — the plumbing:

- `secretKeyFor(name)` → `forge.endpoint.<name>.token`, so two profiles cannot
  collide on one token.
- `collectSecretKeys(profile)` → every `${secret:…}` the profile refers to,
  scanning **only** the strings `applyAuth` actually interpolates: `auth.value`,
  and the exchange block's `url`, `headers` and `body`. Scanning fields that are
  never interpolated would read more of the keychain than the request needs.
- `secretLookupFor(profile, storage)` → awaits those keys once and returns a
  synchronous lookup, because `interpolate` is sync and `SecretStorage.get` is
  not. One await per relay start; a profile names a handful of secrets at most.

**`IEndpointService.secretsFor(profile)`** exposes that lookup, and all five
call sites now use it. A diagnostic that cannot see the credential only ever
reports the wrong failure, so the ladder, the probe and the model list get the
same lookup a real request gets.

**The flow** asks for the token in a `password: true` box, with
`ignoreFocusOut` so clicking away does not discard it. The secret is written
**before** the settings write, because a profile referencing a key the keychain
does not hold would authenticate with an empty string and fail confusingly.

### Compatibility

- `${env:VAR}` is untouched. Existing profiles keep working; `interpolate`
  resolves `env:` from `process.env` directly and never through the lookup.
- `${secret:K}` falls back to `process.env[K]` when the keychain has no such
  key, which is exactly what it did before. The keychain wins when both hold
  the same name.
- A keychain that refuses to open yields `undefined` rather than throwing, so
  the failure surfaces as an auth error against the endpoint instead of an
  exception before the request is built.

### Not done

Removing a profile from `settings.json` by hand leaves its keychain entry
behind. Harmless — an orphaned secret nothing references — but a "Remove
endpoint" command would be the place to clean it up, and there isn't one yet.

## Results

| Surface | Before | After | Verdict |
| --- | --- | --- | --- |
| Add endpoint ▸ auth | "name of an environment variable" | the token, in a password box | **works** (spec); unverified in real VS Code |
| What `settings.json` holds | `${env:VAR}` | `${secret:forge.endpoint.<name>.token}` | **works** (spec) |
| Where the token lives | an env var you set up | VS Code SecretStorage | **works** (spec); unverified in real VS Code |
| `${secret:…}` resolution | `process.env[key]` — an env alias | keychain first, env fallback | **works** (spec) |
| Diagnostics / probe / model list | `process.env[key]` | the same lookup a request gets | **works** (spec); unverified against a real gateway |
| Existing `${env:VAR}` profiles | — | unchanged | **works** (spec) |

**Counts:** 1329 unit tests (47 files, up from 1314), `typecheck:all`,
`lint:forge` and `build` clean.

## VS Code checklist for the user

Unverified — the agent cannot observe real VS Code.

1. Settings ▸ Endpoints ▸ **Add…**. Answer `kc-test`,
   `https://gateway.example.com/v1`, `openai`, `gpt-4o`, **Bearer token**, and
   paste any string as the token. Save to **All workspaces**.
   *Expect:* the token box masks what you type.
2. Open `settings.json`.
   *Expect:* `"auth": { "kind": "bearer", "value": "${secret:forge.endpoint.kc-test.token}" }`
   — and **no trace of the token itself** anywhere in the file.
3. Run **Forge: Run Endpoint Diagnostics** against `kc-test`.
   *Expect:* it fails at the network rung against the fake host, **not** at the
   authentication rung with an empty credential. That is what proves the
   keychain value reached the request.
4. In the token box, paste `${env:SOMETHING}`.
   *Expect:* "Paste the token itself — Forge stores it in the OS keychain for
   you."; the flow does not continue.
5. Check an existing profile that uses `${env:VAR}`.
   *Expect:* it still resolves from the environment exactly as before.
6. Restart VS Code and run the diagnostics again.
   *Expect:* the same result — the token survived, because it is in the
   keychain rather than in memory.
