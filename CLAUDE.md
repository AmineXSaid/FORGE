# Forge — working rules

Forge is Claude Code in VS Code: the **real Claude Code extension's UI**, the
Pajamas brand, the Claude Code CLI as the backend, plus Hermes agents and custom
endpoints. Claudix supplies the engine and two small marks (the brain icon, the
agent avatar) — **not the look**.

## Rules — these are not optional

**1. If the code exists, read it. Never guess.**
The reference implementation is on disk and readable:
`../Real_Claude_Code_VSCODE_extension_files/webview/` — `index.css` is the style
spec, `index.js` is the component spec (minified but greppable). Every repo in
this workspace is readable too. Inferring structure from appearance when the
source is right there is the most expensive mistake available here: it has
already produced a `<fieldset>` built as a `<div>`, a `<legend>` built as a
positioned span, and a whole menu built from the wrong component. Grep the
bundle. Read the function. Copy the values.

**2. "Clone it" means per-pixel, and it means looping until it is done.**
When asked to mimic or clone a surface, match *all* of it: layout, spacing,
typography, font, logo, icons, text rendering, copy, states, and every
sub-window (menus, popups, dialogs, banners). Then check implementation against
source 1-vs-1, element by element, and repeat until nothing differs. One pass is
never a clone. Stopping at "close enough" is not finishing.

**3. When steps or code are provided, execute them — do not re-derive them.**
If the user hands over a path, a snippet, a screenshot or an exact sequence, use
it directly and efficiently.

**4. Match the small things, because they are what "the same" means.**
Same icons (extract the real glyphs — never substitute a lookalike codicon),
same text size, same font family and weight, same spacing between icons and
their labels, same padding inside rows, same gaps between controls. The base
matters most: the official webview sets `body { font-size:
var(--vscode-chat-font-size, 13px) }` and everything sizes in `em` off it, so a
wrong base scales the entire UI at once. Never override a ported official rule
with a scoped style — that is how a 10px gap silently becomes 6px.

**5. Repeating a correction is a signal you are getting it wrong.**
If the user raises the same point more than once, stop and change approach — do
not restate the plan, do not narrate what you "now see", and do not promise a fix
in prose. Go read the source, make the change, measure it, and show the
measurement. Narration without a diff is the failure mode to avoid.

**6. Do not claim parity without a measurement.**
Use the `ui-parity` skill. If a check was not run, say it was not run.
`probe-oracle.js` diffs every element against the official stylesheet itself.

**7. Every button's window must work like the official one, row for row.**
Open each control in both and match its contents and behaviour: items, labels,
descriptions, sections, order, toggles/sliders/trailing text, what each row does,
whether the menu stays open. Read the list out of `index.js` (the "/" menu is a
`registerAction(...)` registry). Wire every row to a real Forge action; if Forge
cannot do one, omit it -- as the official omits rows its host cannot serve --
and say so. Then click every row in the harness to prove it.

## Current task: the backend behind the official-clone frontend

The composer, its menus, the permission prompt, the sessions dropdown and the
transcript already use the official DOM. The per-feature spec is
`docs/prompts/backend-wiring.md`: for each surface it gives the official request,
the official host handler, what Forge has today, and what to build. **Where that
spec and this file disagree, this file wins** (scope was decided after the spec
was written).

### Scope (decided — do not widen or narrow it)

**In scope:**
- **Frontend defects first** (spec Part A):
  - `#app` doesn't fill the webview.
  - The Slash Commands section gets no data.
  - `isPartialText` is never passed to `TextBlock`.
  - The status dot must follow the official `p85`: text-only messages get no dot.
  - The header glyphs are codicons, not the official ones.
- **The SDK upgrade** (see backend rule B5). It comes before any feature work.
- **Dispatcher:** re-enable `open_claude_in_terminal`, with the official `JI0`
  validation and `location`. It is commented out in `ClaudeAgentService.ts`,
  but the "/" menu already calls it.
- **Model & permissions:**
  - real effort levels: `apply_settings` with the official whitelist, persisted,
    and reaching the CLI;
  - a Thinking toggle separate from effort;
  - Ultracode, built the official way (added to scope by the user on 2026-09-18):
    `enableUltracode` sets effort to `xhigh` and sends
    `apply_settings {ultracode:true}` to the session-scoped flag layer; choosing
    another level clears the flag first. It's offered only when the model lists
    `xhigh` and workflows aren't disabled;
  - model metadata: `supportsEffort`, `supportedEffortLevels`, unavailable models;
  - "Toggle fast mode", only when the model supports it;
  - the permission prompt's second option with its save destination
    (`add_permission_rules`, `list_permission_rules`, `remove_permission_rule`);
  - `persist_session_permission_mode`.
- **Conversations:**
  - `rename_session`, `archive_session`, `unarchive_session`, and
    `set_session_unread` with the status dot;
  - git-branch search;
  - `rewind_code`, with a dry-run confirmation;
  - `fork_conversation`, plus "Fork conversation and rewind code", via the
    user-message "Message actions" button;
  - the "Resume conversation" row (filterOnly).
- **Browser & views:**
  - @browser tabs (`ensure_chrome_mcp_enabled`, `create_new_browser_tab`,
    `disable_chrome_mcp`; the "Browse the web" row in the + menu only when
    supported);
  - Output styles (`get_output_style`, `get_output_style_locations`,
    `create_output_style`);
  - Focus view (`set_focus_view` plus transcript filtering).
- **Rows that are live but unfinished:**
  - MCP servers, Hooks, Permissions and Manage plugins must open the matching
    Settings tab;
  - replace the `open_config_file` `command:` allow-list with typed `open_config`
    and `open_help` requests.

**Out of scope. Don't build these; their rows and buttons stay out of the UI:**
- **Microphone / speech-to-text:** `start_speech_to_text`,
  `stop_speech_to_text`, the audio-capture binary.
- **Account & cloud:**
  - login / "Switch account" (`login`, `get_auth_status` and
    `submit_oauth_code` stay commented out);
  - "Account & usage…" and the footer usage/context meter (`get_usage`,
    `get_context_usage`, `open_account_usage`, `request_usage_update`);
  - Remote Control (`toggle_remote_control`, `remoteControlAtStartup`,
    `/remote-control`);
  - feedback: `submit_feedback`, `/feedback`, `/bug`, and **"Report a problem"**.
    The button is live today (it opens logs, which is not what the official
    does), so remove it and keep the version text.
- **Also out:** thumbs rating (`message_rated`), "Switch models when a message is
  flagged" (gated by Anthropic experiment flags Forge never receives), and `/btw`
  (`side_question`).

**Order:** Part A, then the SDK upgrade, then the dispatcher, then Model &
permissions, then Conversations, then Browser & views. Finish, verify and report
each group before starting the next.

## Backend rules — these are not optional

**B1. The official host is the spec for behaviour, as `index.js` is for markup.**
For every request, read two things before writing code:
- the sender in `webview/index.js` (`sendRequest({type:"<type>", ...})`);
- the handler in `../Real_Claude_Code_VSCODE_extension_files/extension.js`
  (`case"<type>"`, then the method it calls).

Use the **same request type names and payload shapes**, and the same response
fields. Don't design a protocol when one exists.

**B2. A request lives in six places. Do all six, every time.**
1. The request and response types in `src/shared/messages.ts`.
2. The transport method in `src/webview/src/transport/BaseTransport.ts`.
3. The dispatcher `case` in `src/services/claude/ClaudeAgentService.ts`.
4. The handler in `src/services/claude/handlers/handlers.ts`.
5. The harness answer in `.claude/skills/ui-parity/harness/mock-host.js`.
6. A spec under `test/`.

A dispatcher case that is commented out while the UI calls it is a bug, not a
placeholder.

**B3. The webview is untrusted input.**
Validate every request the way the official does:
- settings writes go through a whitelist with per-key layer and type (the
  official `tu$`: `effortLevel`→userSettings, `outputStyle`→localSettings, ...),
  and unknown keys are rejected;
- terminal launches only accept what `JI0` accepts (a bare slash command, or
  `--resume <sessionId>`);
- session ids are checked before they touch the filesystem.

Never let the webview run arbitrary commands, paths or processes. `handleExec`
already spawns processes, so don't route new features through it.

**B4. A row appears only when its backend works.**
This is rule 7 applied to the host. Register the row, show the toggle or the
option only when the feature is in scope **and** the handler works against the
real CLI. Out-of-scope rows stay out of the UI, and a feature that exists but is
unsupported for the current model or session hides its row (the official
unregisters `effort-level` for models without effort).

**B5. Upgrade the SDK first, then build on its real APIs.**
`@anthropic-ai/claude-agent-sdk` is 0.1.77. It was 0.3.273 on npm when this was
written; take the latest. Before any feature work:
- read the changelog between the two versions;
- update `package.json`;
- re-verify every place that consumes SDK types or the message stream:
  `src/services/claude/ClaudeSdkService.ts`, `ClaudeAgentService.ts`,
  `cliArgs.ts`, `handlers/handlers.ts`, `src/shared/messages.ts`,
  `src/webview/src/transport/BaseTransport.ts`, `core/Session.ts`,
  `core/PermissionRequest.ts`, `composables/useSession.ts`, and the `.vue` files
  that import SDK types (`ButtonArea`, `ChatInputBox`, `ModeSelect`,
  `WaitingIndicator`, `ChatPage`);
- write down the version, the breaking changes found and how each was handled
  in `docs/sdk-upgrade.md`.

After that, use SDK APIs the way the official host does (`query.rewindFiles`,
`forkSession` / `resumeSessionAt`, `setMaxThinkingTokens(budget, display)`,
settings APIs) instead of workarounds. Any CLI flag still passed by hand goes
through `src/services/claude/cliArgs.ts`, whose PROTOCOL / MANAGED / FREE gate
and tests exist because a bad flag can corrupt the stream protocol.

**B6. Write settings where the official writes them, and check precedence.**
The official layers are:
- `userSettings`: `~/.claude/settings.json`
- `localSettings`: `.claude/settings.local.json`
- flag settings

Forge also launches the CLI with `--settings ~/.claude/forge.json` for profile
hot-reload. Before persisting anything (e.g. `effortLevel`), confirm how the
forge.json flag settings rank against user settings, so a profile doesn't
silently override the user's choice. Test that case.

**B7. Behaviour, not labels.**
A control that changes its label but not the model's behaviour is broken. Effort
must reach the CLI (the `effortLevel` setting, `--effort`, or the SDK option) and
show up in what the CLI reports. Thinking must change the thinking budget. Rewind
must change files on disk. Verify the effect, not the UI state.

**B8. Definition of done, for every feature.**
1. A vitest spec for each new handler, rejection cases included (bad keys, bad
   ids, disallowed args). Specs are `test/*.spec.ts`; the `vscode` mock is
   `test/mocks/vscode.ts`.
2. `pnpm test`, `pnpm run typecheck:all` and `pnpm run build` all pass.
3. Harness: the mock host answers the new requests, every affected row is
   clicked, and `probe-oracle.js` shows **0 structural diffs** on each affected
   window.
4. A **VS Code checklist for the user**: numbered steps against the real CLI,
   each with the exact expected result (a file changed, a setting written, a
   session renamed on disk). The agent can't observe real VS Code, so it must not
   claim real-CLI behaviour it has not seen. It hands over the checklist and says
   which steps are unverified.

**B9. Report as a table.**
Columns: **row | request | host result | UI effect | verdict**, with counts, the
rows deliberately left out and why, and the checklist from B8. Never round a
partial result up to "works".

## Where the pieces are

| Concern | File |
| --- | --- |
| Request / response types | `src/shared/messages.ts` |
| Webview → host calls | `src/webview/src/transport/BaseTransport.ts` |
| Host dispatcher | `src/services/claude/ClaudeAgentService.ts` (the `switch` on `request.type`) |
| Host handlers | `src/services/claude/handlers/handlers.ts` |
| SDK launch, `--settings forge.json`, probes | `src/services/claude/ClaudeSdkService.ts` |
| CLI flag gate | `src/services/claude/cliArgs.ts` + `test/cliArgs.spec.ts` |
| VS Code commands (source of truth) | `src/commands/forgeCommands.ts` |
| "/" menu rows and handlers | `src/webview/src/components/ButtonArea.vue` (`menuCommands`, `runCommand`) |
| "/" menu, "+" menu, sessions dropdown | `src/webview/src/components/forge/{CommandMenu,AddMenu,SessionsDropdown}.vue` |
| Model picker, mode menu, permission prompt | `ModelSelect.vue`, `ModeSelect.vue`, `PermissionRequestModal.vue` |
| Transcript | `components/Messages/{UserMessage,AssistantMessage,ContentBlock}.vue`, `blocks/TextBlock.vue` |
| Harness stub host | `.claude/skills/ui-parity/harness/mock-host.js` |

## How to extract from the reference bundle

- **Classes → component**: class names are `name_HASH`; the hash identifies the
  source module. Group by hash to recover component boundaries.
- **Markup**: each module has a CSS-module map object, e.g.
  `var Q7={inputWrapper:"inputWrapper_cKsPxg",...}`. Grep the map variable
  (`Q7.`) to find the JSX that uses it — exact tags, attributes, nesting order.
- **Icons**: small components returning inline `<svg>`. Extract with
  `.claude/skills/ui-parity/scripts/extract-icons.mjs` (pairs are
  `ComponentName=bundleFunction`).
- **Copy**: string literals are intact. Grep the visible text.
- **Requests**: in `index.js`, grep `type:"<request_type>"` to find the sender
  method and its payload. In `extension.js`, grep `case"<request_type>"` for the
  handler, then the method it calls. Validators and whitelists sit next to the
  handlers (e.g. `tu$`, `JI0`).

## Build gates

`pnpm run build` fails if any gate fails.

```bash
pnpm run lint:brand      # no raw colour or system font outside the token layer
pnpm run lint:tokens     # no undefined design tokens
pnpm run lint:commands   # package.json matches the command registry
pnpm run lint:forge      # all three
pnpm test                # vitest (test/*.spec.ts)
pnpm run typecheck:all   # extension host + webview
```

- **Brand**: every colour resolves through `src/webview/src/styles/forge-tokens.css`.
  Components may not name a hex, `rgb()`, a named colour, or a `--pajamas-*`
  primitive. Colour is the one intended difference from Claude Code: Forge is
  Pajamas purple where Claude Code is orange.
- **Fonts**: Forge bundles Anthropic Sans (text) and GitLab Mono (code) and must
  **never** fall back to a system font. `--vscode-*font-family` and generic
  families are build errors. The sans cuts are generated from the upstream OTF
  release by `node scripts/gen-fonts.mjs --src <dir>`; there is no Anthropic Mono
  in that release, which is why code stays on GitLab Mono.
- **No global CSS reset**: Tailwind is imported without preflight, because the
  official webview has none. Only the Settings page keeps a scoped copy.
- **Commands**: `src/commands/forgeCommands.ts` is the source of truth;
  `node scripts/sync-commands.mjs` regenerates the manifest.

## Regenerating

```bash
pnpm run tokens:pajamas                   # palette primitives from @gitlab/ui
pnpm run ui:port                          # re-port the official CSS onto Forge tokens (add modules to MODULES)
pnpm run marks                            # logo SVG + PNG from the icon geometry
node scripts/gen-settings-preflight.mjs   # Settings-only scoped Tailwind preflight
```
