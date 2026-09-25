# Changelog

## 0.1.0 (unreleased)

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
