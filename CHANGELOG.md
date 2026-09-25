# Changelog

## 0.1.1 (unreleased)

### Fixes

- A Forge panel whose files cannot be read no longer stays blank. On Windows,
  both the side bar and the editor tab were empty. VS Code could not read
  `dist/media/main.js` and `style.css` from the installed folder, although the
  VSIX carries both. Now:
  - the host checks for the two files before it builds a panel; when they are
    missing, the panel lists them and says how to reinstall, and the Forge
    output log records the same;
  - a file that fails to load after that is reported in the page, as is a
    startup error, in the official `#claude-error` sentinel.
- The version is now 0.1.1, so this build installs into a new
  `msaid.forge-0.1.1` folder and never reuses a damaged `0.1.0` one.
- Every model behind `gpt.technica-engineering.net` follows strict rules,
  whatever the profile is called and whatever the URL's path. The rules ship
  with Forge (`resources/endpoint-rules/gpt.technica-engineering.net.md`) and
  are added to Claude Code's system prompt for sessions on that host:
  - answer directly and briefly, and stop when done;
  - use Read, Grep and Glob, not `cat`/`grep`/`find` in Bash;
  - run one command per call, with no subagents unless asked;
  - never repeat a read, a search or a failing call.
  To cover another gateway, add a file named after its host.
- Loops are stopped, not only discouraged. Within one answer, the same tool
  call with identical input may succeed twice; the third is refused, and the
  model is told to use the result it already has. A file edit resets the
  count, because reading again after a change is right. Polling and `sleep`
  commands are never counted.
- New, opt-in: `forge.autoApproveSafeCommands`. When it's on, in Edit
  automatically, shell commands that Forge's risk check finds harmless run
  without asking: reads, searches, `git log`, `git diff`, `git show`, alone or
  chained. Anything that deletes or overwrites, uses `sudo`, rewrites or
  pushes git history, publishes a package or pipes a download into a shell
  still asks. Manual always asks, and Plan is unchanged. Forge also follows
  the session's current mode for this, not the mode it launched in. Editing
  gets a green pass, deleting never does: a redirect into a project file
  (`> file`, `sed -i`) runs, while `rm`, `git rm`, `mv`, `truncate` and
  `find -delete` always ask.
- In Edit automatically, deleting a file now asks first, whatever
  `forge.autoApproveSafeCommands` says. Claude Code itself runs `rm` on a
  project file without asking in this mode, because it auto-accepts file
  commands inside the project. So the rule above only held for commands the CLI
  asked about. Forge now answers the CLI's PreToolUse hook with `ask` for any
  command that deletes or moves files (`rm`, `rmdir`, `git rm`, `mv`,
  `truncate`, `find -delete`, `git clean`), or that rewrites or pushes git
  history. Reads and edits run as before.
- New: edits show as they happen (`forge.followEdits`, on by default). When
  Claude edits or writes a file, the file opens beside the chat, or comes to
  the front if it is already open, without taking focus from the chat. The
  changed lines scroll into view and are highlighted for a moment; a new file
  opens at its top. It works in every mode, and only for edits that were
  applied, so a refused or failed edit opens nothing. This is Forge's own: the
  official extension shows a diff only for an edit it asks you about.
- In a Dev Container that runs as root, bypass permissions no longer stops
  every session from launching. Claude Code refuses bypass as root unless
  `IS_SANDBOX=1`, and it refuses the "allow bypass" option alone, in any mode.
  Forge now applies the same rule (ported from the CLI). There it ignores
  `forge.allowDangerouslySkipPermissions`, leaves the Bypass row out, and
  explains why instead of turning the setting on.
- A model that delegates to subagents no longer fills the chat with the
  prompts it wrote for them, drawn as if you had typed them. A message carries
  its `parent_tool_use_id` again, as the official keeps it. A subagent's
  prompt and tool results draw no row of their own: its prompt still shows
  under the Agent tool's "IN". It is also left out of the rewind list, and in
  Focus view it neither starts a turn nor counts as the answer.
- Running `vsce package` directly makes a complete VSIX. The build used to
  live only in `pnpm run package`, so a plain `vsce package` zipped 24 files
  (5.7 MB). That VSIX had no `dist/media`, which gave the blank panel, and no
  Claude Code binary ("Unsupported platform: win32-x64"). The build is now
  `vscode:prepublish`, which vsce runs before every package.

## 0.1.0 (test build)

First packaged build: **one VSIX for Windows x64 and Linux x64** (glibc),
carrying both platforms' Claude Code binary and ripgrep.

### Safety

- Forge no longer writes `~/.claude/settings.json` at startup. Its defaults
  (attribution off, `skipWebFetchPreflight`, three environment variables) reach
  only the sessions Forge launches, through `~/.claude/forge.json` and the
  launch environment, and only for keys none of your settings set.
- A settings file that does not parse (a comment, a trailing comma) is left
  exactly as it is and the write is refused, instead of being replaced.
  Settings writes are atomic.
- Requests from the webview are validated: no arbitrary command (`exec` is
  gone), web and mail links only, session ids and profile names checked before
  they become paths, the Settings page limited to the keys it owns, no network
  or device paths for file opens.
- `forge.cliArgs`, `forge.endpoints`, `forge.environmentVariables` and
  `forge.endpointProfilesDir` are machine settings a repository cannot set;
  bypass permissions can only be turned on by `forge.allowDangerouslySkipPermissions`.
  Forge does not run in Restricted Mode.

### Fixes

- Picking another model in a new conversation, before the first message, no
  longer fails with "No conversation found with session ID": the relaunch on
  the new endpoint starts the conversation fresh, since there is nothing on
  disk to resume.
- A launch that fails (no binary, wrong platform) or a CLI that stops mid-turn
  shows in the chat's error banner, with a link to the output logs.
- A permission prompt whose panel closes is answered as a denial, so the turn
  does not hang.
- Ctrl+Esc (blur) and Ctrl+N (new conversation) fire again, and Ctrl+Esc in
  the chat returns focus to the editor, as the official does.
- A message sent while the chat is still starting is no longer lost.
- Closing a Forge tab ends its conversations' Claude Code processes, as the
  official does; they used to keep running.
- Alt+K ("Insert @-Mention Reference") puts the mention in the composer; a
  mention sent while the chat is hidden arrives when it shows (within 15 s).
- A damaged install on Windows says the Claude Code binary is missing, not
  "Unsupported platform: win32-x64".
- When Claude Code exits on launch, the chat says why, in the CLI's own last
  line (an unknown `forge.cliArgs` flag, a refused bypass), not only the exit
  code.
- A message with an `@browser` tab that cannot be attached no longer vanishes:
  the chat says why (the browser server's own words, e.g. the Claude in Chrome
  extension is not connected) and the text goes back into the composer. The
  "install the extension" notification no longer holds the message up.
- Effort reaches an OpenAI-compatible endpoint as `reasoning_effort` (the CLI
  now sends it in `output_config`), and turning Thinking off sends the weakest
  rung instead of changing nothing.
- An open conversation between turns no longer gets a "this turn has produced
  no output" warning.
- Typing a full slash command and pressing Enter runs that command: the exact
  name ranks first ("/compact" no longer picks "/autocompact").
- Slash command descriptions keep Anthropic's product names ("the Claude
  API", not "the Forge API").
- The chat view no longer shows three text-only title-bar actions over its
  header.
- "Forge: Select Agent" works (its settings are declared).
- A chat in an editor tab is retitled after its conversation and opens new
  conversations as tabs; MCP server status and the Forge mark come from the
  right place.
- `@` file search finds the bundled ripgrep.

### Added

- The model picker lists only the endpoints whose model answered its last
  check, each with its ping (green under 1 s, neutral under 3 s, orange above).
  The model in use stays, greyed with the reason, when it stops answering. A
  refresh button beside "Select a model" checks every endpoint now and keeps
  the menu open while the list updates. The check runs every 5 minutes by
  default (`forge.endpointHealth.syncIntervalMinutes`, was 60); it used to skip
  every other tick, so the interval was really twice the setting.
- Bypass permissions shows in Pajamas deep red (the send button, the working
  indicator, the focus ring and the mode's glyph); `auto` keeps its colour.
- An **Expert** mode, first in the mode menu and in the Shift+Tab cycle, in
  gold: the `forge:Expert` output style for this conversation only (the
  session's flag layer; no settings file changes), re-applied when the CLI
  relaunches. It asks before each edit, as Manual does.
- The left window is the official session manager: a collapsible "Session
  manager" section, "New session", and the full sessions list with **session
  groups** (new, rename, delete, collapse, add or remove sessions by menu or by
  dragging, "Start new session in this group"), Ungrouped and Archived
  sections, the status dot and unread, the status filter and "Active · N",
  multi-select, and a search that folds away. Groups and every collapsed
  section survive a reload. With no endpoint it shows the endpoint setup.
