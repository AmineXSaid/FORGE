# Launch gate: the release QA prompt for Forge

Paste everything below the line into a fresh agent session opened on the Forge
repository (Claude Code, with shell, file and browser tools). It is written to
find what would become a bug report after launch, prove each finding, and end in
a GO / NO-GO. It changes nothing in the product.

---

You are the release gate for **Forge**, a VS Code extension that runs the real
Claude Code CLI behind a clone of the official Claude Code UI, against endpoints
the user sets up (Ollama, LM Studio, vLLM, llama.cpp, Jan, company gateways,
Anthropic-compatible APIs). Your job is to decide whether this build can ship
to users without generating bug reports, and to prove every statement you make.

## Ground rules

1. **Report, don't fix.** Change no product file. You may write scratch scripts
   under a temp folder. If you find a defect, reproduce it, record it, move on.
2. **Evidence or it did not happen.** Every PASS needs one of: a passing spec
   you ran, a request/response you captured, a DOM or file state you read, a
   screenshot you took. A claim without evidence is UNVERIFIED, never PASS.
3. **Real product, isolated.** Test the packaged VSIX in an isolated VS Code:
   its own `--user-data-dir` and `--extensions-dir`, and `HOME`/`USERPROFILE`
   set to a temp folder (Forge writes `~/.claude/forge.json` and the CLI reads
   `~/.claude/projects`, so without it you test the developer's history, not a
   fresh install). Never touch or close the developer's own VS Code windows:
   close your instance by its exact window title only.
4. **Read before you judge.** `CLAUDE.md` defines scope and the official-parity
   rules. The official extension is on disk at
   `../Real_Claude_Code_VSCODE_extension_files/` (`webview/index.js`,
   `webview/index.css`, `extension.js`). Out-of-scope features
   (`docs/backend-wiring/out-of-scope.md`: login, usage meter, remote control,
   feedback, speech) must be *absent*, not broken.
5. **No secrets in logs or reports.** If you use a real gateway key, pass it by
   environment variable and never print it.

## Phase 0: the build is what it claims to be

Run and record the output of each:

```
pnpm install --frozen-lockfile
pnpm run lint:forge
pnpm run typecheck:all
pnpm test
pnpm run build
pnpm run lint:dist
pnpm exec vsce package --no-dependencies -o <tmp>/forge.vsix
```

Gate: all pass. Note the test count and any skipped specs, and read why each
skip exists.

## Phase 1: fresh install, first run (the first five minutes decide retention)

Environment: isolated VS Code as above, one empty workspace folder, and a stub
OpenAI-compatible server on `127.0.0.1:11434` (Ollama's port) that serves
`/v1/models` (two chat models and one embedding model) and
`/v1/chat/completions` (stream and non-stream), logging the `model` of every
request. Answer 404 for any model it does not serve, so a wrong id is visible.
Drive the workbench and the webviews over CDP (`--remote-debugging-port`,
`Target.setAutoAttach {flatten:true}`, reconnect after a view opens; webviews
are out-of-process frames).

Check, and capture evidence for each:
1. The Forge chat opens on the welcome page with "Set up an endpoint". No
   model menu offers Claude tiers anywhere.
2. "Set up an endpoint": the local server is detected ("running now"); choosing
   it asks a name, then the model; no address, no key. The embedding model is
   not offered.
3. After choosing the model: a check runs, the profile is saved in user
   `settings.json` as `forge.endpoints.<name>` with `model`, and
   `forge.endpointProfile` is set without clicking any toast.
4. The chat replaces the welcome page. Send "hi": an answer arrives, and the
   stub's log shows only the chosen model id (never `claude-*`).
5. Reload the window: still on the chat, same pair selected, history listed.
6. Remove all endpoints: the welcome page returns, sending is impossible, and
   nothing reaches `api.anthropic.com` (block it at the firewall or check the
   CLI log).
7. Point `forge.endpointProfile` at a name that does not exist and send: a
   clear error in the chat, no silent fallback, no "Please run /login".
8. "Open Forge in Terminal" (the "/" menu row and the `$ forge` banner): the
   terminal CLI answers on the same endpoint. It must never print
   "Not logged in · Please run /login". With no endpoint, it must refuse with a
   message instead of starting a CLI.

## Phase 2: every surface, row by row

For each surface, open it in the product and in the official extension's source,
and walk every row: label, description, what it does, what it sends, what comes
back, whether the menu stays open. Record a table
`surface | row | action | expected | observed | verdict`.

- Composer: "+" menu (Upload, Add context, Browse the web only when
  supported), "/" menu (every `registerAction` row the official has and Forge
  keeps; the dynamic slash-command rows), model menu (endpoint + model pairs
  only; effort only for pairs that support it; Ultracode only with `xhigh`;
  fast mode only when supported), mode menu (Manual, Edit automatically, Plan,
  Bypass permissions).
- Bypass permissions: with `forge.allowDangerouslySkipPermissions` off,
  choosing it shows a modal warning; declining changes nothing; accepting writes
  the setting to user settings and the conversation continues in bypass from
  the next message (a command runs with no prompt). A managed policy with
  `disableBypassPermissionsMode: "disable"` hides the row. Shift+Tab cycles
  through bypass only when it is allowed.
- Permission prompt: allow once, allow always with each save destination
  (verify the rule landed in the right settings file), deny; the rules dialog
  lists, adds and removes rules.
- Conversations: sessions dropdown (search by title and git branch, rename,
  archive, unarchive, unread dot and its tooltip), message actions (fork, rewind
  code with the dry-run preview; verify files on disk actually changed), resume.
- Left side bar "Past conversations": "New session" row, a row opens that exact
  conversation in the chat and the side bar closes; reopening it shows a live,
  clickable list; opened as an editor tab it never closes Explorer. Time the
  hand-off: the history should be gone in under ~0.15s and the chat should
  arrive with a short entrance, not pop in.
- Settings: every tab (General, Models, Profiles, Plugins, Environments, Memory
  and Rules, Permissions, Sandbox, Network, Hooks, Skills, Agents, MCP Servers,
  Slash Commands, Endpoints). For each control: change it, confirm the right key
  in the right file (`~/.claude/settings.json`, `.claude/settings.json`,
  `.claude/settings.local.json`, the profile file, or VS Code settings), reload,
  confirm it persisted. No "Coming soon", no greyed-out control that does
  nothing, no dead button. Plugins: list the marketplace, install to each scope,
  enable/disable, update, uninstall, add/refresh/remove a marketplace (a plugin
  that needs to run a command must be refused with its reason, never
  auto-approved). Hooks: add one of each shape, confirm the `hooks` JSON, remove
  it. Slash Commands: create one, confirm the file, see it in the "/" menu.
- Endpoints: add a gateway with a bearer key (key asked *before* the model
  list; listed models probed, answering ones first), "Another model from" an
  existing endpoint, switch pairs mid-conversation (the next message goes to the
  new model, same conversation), diagnostics, detect capabilities (writes to the
  scope that owns the profile), list models, status.

## Phase 3: parity with the official UI

Start the harness (`node .claude/skills/ui-parity/scripts/harness.mjs --port
8771 --ref <official index.css>`, run from the repository you are testing) and
run `probe-oracle.js` on each ported surface: composer, "/" menu, model menu,
mode menu, sessions dropdown, sessions view, permission prompt, transcript,
welcome. Gate: 0 structural diffs, or each diff listed in `docs/forge-design.md`
as an intended divergence. Colour differences are expected (Pajamas purple).

## Phase 4: security (the webview is untrusted input)

For every request in the dispatcher `switch` of
`src/services/claude/ClaudeAgentService.ts`, post malformed and hostile
payloads from the webview side (path traversal in ids and file names, leading
`-` in CLI arguments, unknown enum values, oversized strings, prototype keys
like `__proto__`) and confirm a refusal with no side effect. Specifically:

- `exec`: confirm what it will run and from whom. It was reported to accept any
  command and arguments from the webview. Treat an unrestricted process spawn
  reachable from the webview as a **blocker** unless proven unreachable.
- Workspace settings: a repository's `.vscode/settings.json` can set
  `forge.endpoints` (including `exec` credential helpers and transform
  modules), `forge.cliArgs` and `forge.environmentVariables`. Open such a
  repository in an untrusted window and report what runs.
- Secrets: tokens are in the OS keychain, `settings.json` holds only
  `${secret:…}` references, and no token appears in the Forge output channel
  (custom environment variables included).
- `open_config_file`, `open_file`, `reveal_chat`, `rename_session`,
  `rewind_code`, `fork_conversation`, `open_claude_in_terminal`, plugin and
  marketplace requests: each validates before touching disk, a process or a
  shell.

## Phase 5: robustness (what users will actually do)

- Endpoint down mid-reply, endpoint slow (30s+), endpoint returns 401 / 404 /
  429 / 500 / malformed SSE: the chat shows a clear, specific message and
  recovers on the next message; nothing hangs; no "Please run /login" for a bad
  gateway key.
- A large local model that takes 20s to load: setup's check does not falsely
  fail it, or says why.
- Two windows, two workspaces, one with a workspace-scoped endpoint.
- No workspace folder open: setup, Settings and the chat all work (no write to
  Workspace settings).
- Windows paths with spaces and non-ASCII characters; PowerShell, cmd and Git
  Bash as the default terminal.
- Reduced motion on: no animation plays; nothing is stuck mid-transition.
- High-contrast theme, light theme, a 300px-wide side bar.
- Kill the CLI process mid-turn; restart VS Code mid-turn; resume afterwards.

## Phase 6: the verdict

Write `docs/backend-wiring/results/launch-gate-<date>.md` with:

1. Build facts: versions, test counts, the VSIX size.
2. A findings table: `id | severity (blocker / major / minor / cosmetic) |
   surface | steps to reproduce | expected | observed | evidence (file, log
   line, screenshot)`.
3. Coverage: every row from Phase 2 with its verdict (PASS / FAIL /
   UNVERIFIED), and counts per verdict.
4. **GO** only if there are zero blockers, zero majors in Phases 1 and 4, and
   every Phase 1 item is PASS with evidence. Otherwise **NO-GO**, with the
   shortest list of fixes that would flip it.

Do not round up. "Mostly works" is NO-GO.
