# Step 52 — the SDK never worked in the packaged extension

Reported after installing the step 51 build: "clicking on start new
conversation doesn't open the right side bar and it hangs there loading in the
left opened window", and "the initial welcome page doesn't exist either".

This time there were real logs. `~/AppData/Roaming/Code/logs/<session>/window1/exthost/msaid.forge/Forge.log`
is where the `Forge` output channel persists, and it settled all of it.

## What the log said

```
13:34:39.754 [info]    [handleGetClaudeState] answered in 128ms with 640 model row(s), provisionally
13:34:39.753 [warning] [endpoints] the CLI config probe failed: Cannot read properties of
                       undefined (reading 'propagation')
13:34:39.770 [error]   [ClaudeSessionService] 加载会话列表失败: hs is not a function
13:34:39.330 [error]   [ClaudeSessionService] 加载会话列表失败: The argument 'filename' must be
                       a file URL object, file URL string, or absolute path string. Received undefined
13:34:39.808 [error]   ❌❌❌ Claude 会话启动失败 ❌❌❌  ... (reading 'propagation')
```

Step 51 works: the handshake answers in **128ms with 640 models**, where it
used to hang. But every `query()` fails, which is why a new conversation hangs
— the session can never start.

`propagation` first appears at **2026-09-20 10:16**, 89 times, a day before any
of this work. It is not a regression from step 51; it is what step 51's
bounding exposed, because the config probe now reports its failure instead of
hanging on it.

## One cause, three faces

The stack pointed at `df.query`, and the bundle at that offset reads:

```js
if ($X.propagation.inject($X.context.active(), wf), "traceparent" in wf) ...
```

`$X` is the OpenTelemetry namespace the SDK vendors, bound as
`$X = __toESM(require_otel(), 1)` — which cannot be `undefined` unless the
module it lives in never finished initialising.

It does not. The SDK is ESM and calls `createRequire(import.meta.url)` at
module scope. **`import.meta.url` has no meaning in CommonJS**, so esbuild
emits `undefined` for it, and `createRequire(undefined)` throws — taking the
rest of that module's initialisation with it. Hence:

| Symptom | Mechanism |
| --- | --- |
| `(reading 'propagation')` on every query | the otel binding in that module was never assigned |
| `hs is not a function` | `listSessions` from the same dynamic import is not a function |
| `'filename' must be a file URL … Received undefined` | the `createRequire(undefined)` call itself, surfacing directly |

### Measured, not reasoned

| Build | Result |
| --- | --- |
| SDK imported from `node_modules` (ESM) | iterates, no error |
| Bundled `--format=cjs --platform=node` (Forge's options) | `createRequire(undefined)` **at load** |
| Same bundle + `import.meta.url` defined | loads; `typeof listSessions === "function"` |

Importing the SDK is enough to reproduce it — no CLI binary, no `query()`.

## The fix

`esbuild.ts` now gives CJS a real `import.meta.url`:

```ts
banner: { js: 'const __forgeImportMetaUrl = require("url").pathToFileURL(__filename).href;' },
define: { 'import.meta.url': '__forgeImportMetaUrl' },
```

## Why the whole suite missed it

Vitest imports the SDK from `node_modules` as ESM, where `import.meta.url` is
real. The defect exists **only in the bundle the user installs**, so 1,418
passing specs said nothing about it. `test/bundleImportMeta.spec.ts` now builds
a CJS bundle the same way and runs it — including the negative case, so the
guard rail is only green while the thing it guards against is still real.

## The welcome page is not a bug

It does not appear because `omni-routing` serves **640 models**. The gate is
`modelCount === 0` — "there is nowhere to send your work" — and with 640 models
there is somewhere. That is step 50's design working, not failing.
**Forge: Welcome** (`forge.welcome`) opens it on demand.

If the intent is an onboarding page on every new conversation rather than a
gate, that is a different feature and a deliberate change to step 50 — it was
not made here.

## The right side bar

The log shows `forge.sessionsView` resolved, and the only chat surface created
was `创建主编辑器 WebView 面板: page=chat, id=chat-last` — the chat as an
**editor tab**. `forge.chatViewSecondary` was never resolved, and `reveal_chat`
**never fired in that window** (it last fired at 11:15, on the previous build).

So the sessions-view hand-off path was not exercised. What the log does show is
enough to explain the hang on any surface: with every `query()` failing, a chat
that cannot start a session looks stuck wherever it opens. That has to be fixed
before the reveal path can be judged — see the checklist.

## B9 report

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| Model picker | `get_claude_state` | 640 rows in 128ms | Models listed | **Fixed in 51, confirmed in their log** |
| Slash Commands | `get_claude_state` | `commands: []` — probe failed | Section empty | **Should populate once the SDK loads; unverified** |
| New conversation | `launch_claude` | `(reading 'propagation')` | Hangs loading | **Root cause fixed; unverified in VS Code** |
| Past conversations | `list_sessions_request` | `hs is not a function` | "No conversations yet" | **Root cause fixed; unverified in VS Code** |
| Welcome page | `get_claude_state` | 640 models | Correctly hidden | **Working as designed** |
| Chat in right side bar | `reveal_chat` | never fired | — | **Not reproduced; needs a retry after install** |

Suite **1418 passed, 8 skipped, 0 failed** (up from 1414; +4 bundle specs).
`typecheck:all` and `lint:forge` clean.

## Checklist for VS Code (unverified by the agent)

1. Install and reload:
   `code --install-extension forge-0.1.0.vsix --force`, then
   **Developer: Reload Window**.
2. Open the Forge output channel. Expected: **no** `propagation`, **no**
   `hs is not a function`, and the probe line should now read
   `answered in <N>ms with 640 model row(s)` **without** `, provisionally`.
3. Type a message and send it. Expected: the session starts — this is the one
   that could not work at all before.
4. **Forge: Past Conversations** — expected: your history lists, not
   "No conversations yet".
5. The "/" menu — expected: the Slash Commands section now has rows, because
   the config probe completes.
6. From Past Conversations, click **+** / **Start a new one** — expected: the
   chat appears in the right side bar and the history fades out behind it. If
   it still opens as an editor tab or nothing happens, say so and send the log
   lines around `[reveal_chat]`; that path did not appear in the last one.
