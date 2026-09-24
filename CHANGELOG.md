# Changelog

## 0.1.0 (unreleased)

First packaged build, for **Windows x64 only**.

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
- Ctrl+Esc (blur) and Ctrl+N (new conversation) fire again.
- "Forge: Select Agent" works (its settings are declared).
- A chat in an editor tab is retitled after its conversation and opens new
  conversations as tabs; MCP server status and the Forge mark come from the
  right place.
- `@` file search finds the bundled ripgrep.
