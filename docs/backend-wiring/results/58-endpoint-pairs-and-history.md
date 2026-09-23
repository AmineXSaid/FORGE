# 58: endpoint and model pairs, the setup flow, and the history side bar

2026-09-23, branch `claude/endpoint-model-health-ebc111`, on top of `9a8745c`.
Plan: `~/.claude/plans/piped-hugging-dusk.md`.

Asked for:
- **Left side bar.** "Still having trouble with the window close up of the left side window, the purple button for creating new conv sucks."
- **No Anthropic defaults.** "Remove anthropic defaults models. [The] user must set an endpoint and a model together like genesis."
- **Setup.** "Fix endpoints setup issues." Asked which ones, the user answered: all four (the first message fails; the endpoint is not active after setup; local-server problems; models dead or the wrong list).

Decided with the user: switching the pair mid-conversation takes effect from the next message.

## Result

| row | request | host result | UI effect | verdict |
| --- | --- | --- | --- | --- |
| Chat model menu | `get_claude_state`, `sdk_probe` | one row per endpoint profile (`pairRow`); CLI table and `unavailable_models` never served; `[]` with no profile | pairs only, each "model / endpoint · host · last check" | **works**: harness and isolated VS Code |
| Pick a pair | `set_model {value: <profile>}` | writes `forge.endpointProfile` (`selection.ts`), no channel needed, never `~/.claude/settings.json`; unknown name refused | pill shows the model; next message goes to it | **works**: real VS Code, next message sent `model=llama3.2` |
| Launch model | `launch_claude` | model = the pair's model; `relayEnvironment` sets `ANTHROPIC_MODEL`, the three `ANTHROPIC_DEFAULT_*_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL` | first message answered | **works**: real VS Code, only `qwen3-coder` reached the stub |
| Endpoint that cannot start | (launch) | `EndpointUnavailableError`; no fallback to api.anthropic.com | error in the chat | **spec only** (not driven in VS Code) |
| Switch mid-conversation | config change | channels not mid-turn closed; mid-turn ones retired after `result`; webview resumes with `--resume` | same conversation continues on the new pair | **works**: real VS Code |
| Add endpoint (local runtime) | `run_endpoint_action add` | start picker detects it; name, then model (embeddings dropped); pair checked; saved and selected | chat replaces the welcome page | **works**: real VS Code, 4 of 4 symptoms |
| Add endpoint (gateway) | same | name, URL, API, key, then model listed *with* the key, ids probed, answering first; check; save | same | **spec** (`endpointSetupFlow.spec.ts`); not driven against a live gateway |
| Another model from an endpoint | same | copies address and `${secret:…}` ref; asks model and name; saves beside it | second pair in the menu | **works**: real VS Code (`ollama-llama3.2`) |
| Anthropic-wire URLs | relay, probes, listing | one builder (`urls.ts`), both base spellings; `anthropic-version` on probes and listing; `modelMap` applied; `chatPath` only for messages | health checks match what the chat hits | **spec** (`endpointUrls.spec.ts`) |
| Health sweep | `sync_endpoint_health`, schedule | one probe per endpoint (its model), no listing; `syncDue` runs one pass at a time; picker refreshed on change | "answered in …" / "did not answer: …" on each row | **spec**; the real-VS-Code rows showed "answered in 130ms" |
| Select Endpoint command | `forge.selectEndpoint` | pairs only, no "Default (Anthropic)"; written via `selectEndpointProfile` | | **spec** (selection target); not driven |
| Detect capabilities | `forge.detectCapabilities` | writes back to the scope that owns the profile | | **not run** (code change only) |
| History: open a row | `reveal_chat {sessionId, fromView}` | id validated (B3); `ui_command open_session` | chat opens that conversation; bar closes | **works**: real VS Code |
| History: reopen | `visibility_changed` (host push) | sent from `onDidChangeVisibility` / `onDidChangeViewState` | view comes back usable (opacity 1, clickable) | **works**: real VS Code and harness |
| History: New session / Back to chat | `reveal_chat` | new conversation / reveal only; editor-tab page never closes a side bar | | **works**: harness (payloads), real VS Code (row) |
| History: look | (none) | | official "New session" row, back glyph, plain empty text | **0 structural diffs**, 19/19 clean (`probe-oracle.js`, `.fg-sessions__root`) |
| Settings > Models | `sdk_probe`, `set_model`, `update_extension_config` | | pairs, In use, Use, hide switch, effort for the pair in use, limits | **works**: harness screenshot |
| Memory tab | `open_config_file` | `user-/project-/local-claude-md` map to the CLI's CLAUDE.md files, created empty when missing; unknown types refused | agents rows link to the Agents tab | **spec** (`openConfigHelp.spec.ts`) |

Counts: 18 rows. 10 verified in the harness or in the isolated VS Code. 7 verified by spec only. 1 not run.

Deliberately left out:
- Anthropic direct, with no endpoint. The user asked for no Anthropic defaults, so `api.anthropic.com` is reachable only as an endpoint profile with a key.
- Free-standing custom models. A model is added together with the endpoint that serves it.

## Gates

- `pnpm test`: 1854 passed, 8 skipped.
- `pnpm run typecheck:all`: clean.
- `pnpm run lint:forge`: clean.
- Builds: `pnpm run build:webview` and `pnpm run build:extension`.

## Checklist for your VS Code (unverified until you run it)

1. Install the build, reload, and open Forge with no `forge.endpoints` set.
   - Expected: the welcome page. The model pill has no Claude tiers (the menu is empty).
2. Start Ollama with at least one chat model and one embedding model, then click **Set up an endpoint**.
   - Expected: Ollama shows "running now".
   - Picking it asks for a name, then the model. It never asks for an address or a key.
   - The embedding model is not offered.
3. Pick a chat model.
   - Expected: a "Checking … on localhost:11434" notification, then "where to save". After you answer, a "… is ready" toast.
   - `settings.json` has `forge.endpoints.<name>` with `model` and `forge.endpointProfile: <name>`.
   - Do not click the toast: the chat must already show the composer.
4. Send "hi".
   - Expected: an answer.
   - In the Forge output channel, the relay line names your model, and no `claude-…` id reaches Ollama.
5. Run **Forge: Add Endpoint Profile**, choose "Another model from <name>" and pick a second model.
   - Expected: a second entry `<name>-<model>`, selected.
6. In the open conversation, switch the model menu back to the first pair and send a message.
   - Expected: the reply comes from that model, in the same conversation.
7. Add your omniroute gateway as a gateway: base URL `http://localhost:20128/v1`, bearer key.
   - Expected: the model list loads (the key was asked before it). Answering models are listed first, with their timing, and `auto` is among them.
   - After saving, a message is answered.
8. Open Past Conversations in the left bar and click a conversation.
   - Expected: the chat opens that conversation, and the left bar closes.
   - Reopen the left bar: it shows its list and responds to clicks (it used to come back blank).
9. Open **Forge: Past Conversations** as an editor tab and click "New session".
   - Expected: a new conversation in the chat. Explorer (or whatever is in the left bar) stays open.
10. In Settings > Endpoints, point `forge.endpointProfile` at a name that does not exist, then send a message.
    - Expected: an error in the chat saying Forge could not find that endpoint. Nothing is sent to Anthropic.

## Addendum: "please login", bypass permissions, and the hand-off

Asked for after the above:
- "When chatting with the extension I got the msg please login", then "maybe opening the cli can trigger this issue please verify".
- "The button 'by pass permission' cant be selected, please make it selectable and the logic behind it must be there."
- "Speed up the closing of the left window to move to the right windows (right window must also appear with premium transition not from the no where and it must be fast)."

Root causes:
- **Login.** Reproduced with the bundled CLI. "Open Forge in Terminal" started the CLI with no endpoint environment, and a CLI with no key and no relay answers "Not logged in · Please run /login". Separately, a custom `ANTHROPIC_API_KEY` in `forge.environmentVariables` was applied after the relay's token and replaced it.
- **Bypass.** Forge had no `allowDangerouslySkipPermissions` setting and never passed the SDK option of that name (sdk.d.ts:1894). It had not ported the official launch downgrade either. The CLI refused the switch and the menu snapped back.

| row | request | host result | UI effect | verdict |
| --- | --- | --- | --- | --- |
| Open Forge in Terminal | `open_claude_in_terminal` | the terminal gets the chat's relay address, token and model (`terminalEnvironment`); the user's own variables are kept, but never over the relay token; with no endpoint, refused with `TERMINAL_NEEDS_ENDPOINT` and no terminal created | a terminal that answers on the endpoint, or an error saying to set one up | **spec** (`openClaudeInTerminal.spec.ts`, 51 passed); not run in VS Code |
| Chat launch env | `launch_claude` | `mergeLaunchEnvironment`: the endpoint keys win over custom variables, the shadowed keys are logged by name, and the values are redacted | no "please login" from a stale custom key | **spec** (`cliLaunch.spec.ts`) |
| Bypass, setting off | `enable_bypass_permissions` | modal warning; on yes, `forge.allowDangerouslySkipPermissions: true` at Global (machine scope); on no, nothing written | declined: stays Manual. Accepted: the pill reads "Bypass permissions" with the red composer border | **works**: harness (2 requests, decline then accept); spec 8/8 |
| Bypass, launch | `launch_claude` | SDK `allowDangerouslySkipPermissions: true` when allowed; a bypass launch while it is off becomes `default`, and the webview is told (`system/status`) | | **spec** (`bypassPermissions.spec.ts`) |
| Bypass, Shift+Tab | (none) | | the cycle includes bypass only when allowed: Manual → Edit automatically → Plan → Bypass → Manual | **works**: harness |
| Bypass, managed policy | `enable_bypass_permissions` | refused without asking | row hidden, cycle skips it | **works**: harness (`?bypassPolicy=disable`); spec |
| Mode menu look | (none) | | | **0 structural diffs**, 41/41 clean (`probe-oracle.js`, `.fg-menu__menuPopup`, bypass row present) |
| History exit | `reveal_chat {sessionId, fromView}` | the host waits `70 - elapsed` ms, then closes the side bar | fades out in 70ms (from a row: 0.76 at 29ms … 0 at 96ms) | **works**: harness, per frame. The row path used to start ~130ms late (the leaving view loaded the transcript); fixed in `SessionsPage.vue`. Sessions view with rows: 39/39 clean after removing a scoped override |
| Chat entrance | `ui_command arrive` (host push), then `visibility_changed` | `arrive` goes out before the reveal (spec: order) | held at its first frame while hidden; plays on show: 0.78 at 40ms, 0.94 at 70ms, done by 170ms | **works**: harness, per frame; `openConfigHelp.spec.ts` (order) |

Counts: 9 rows. 6 verified in the harness (and 3 of them by spec too). 3 by spec only. None of the 9 observed in real VS Code.

## Gates (after the addendum)

- `pnpm test`: 1868 passed, 8 skipped.
- `pnpm run typecheck:all`: clean.
- `pnpm run build`: passes (lint:brand, lint:tokens, lint:commands clean).

## Checklist, continued (unverified until you run it)

11. With an endpoint set, open the "/" menu and choose **Open Forge in Terminal**, then type "hi".
    - Expected: the CLI answers from your endpoint's model. It never prints "Not logged in · Please run /login".
12. Remove every endpoint, then choose **Open Forge in Terminal** again.
    - Expected: an error saying to set up an endpoint first, and no terminal opens.
13. With `forge.allowDangerouslySkipPermissions` unset, open the mode menu and choose **Bypass permissions**, then press Cancel.
    - Expected: a modal warning; after Cancel the mode stays as it was and user `settings.json` is unchanged.
14. Choose **Bypass permissions** again and accept, then ask for a command that would normally prompt (e.g. "run `ls`").
    - Expected: user `settings.json` has `"forge.allowDangerouslySkipPermissions": true`, the composer has the red border, and the command runs with no permission prompt from the next message.
15. With the chat in the right side bar, open Past Conversations in the left bar and click a conversation.
    - Expected: the left bar is gone almost at once, and the chat slides in from the left with a short fade rather than appearing all at once. The chat shows that conversation.
