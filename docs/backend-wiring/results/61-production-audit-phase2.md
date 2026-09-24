# Production audit, Phase 2: a spec for every request that had none

Each request below had no spec before this phase (or only a manager-level
one). Every spec covers the happy path and the refusals; where the official
handler is readable, the spec also pins it against
`../Real_Claude_Code_VSCODE_extension_files` (reported as skipped when that
folder is absent).

## Results

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| MCP status | `get_mcp_servers` | `mcpServerStatus()` minus `claude-vscode`; `{error}` on failure; no channel / unknown channel throws | — | works (spec, `stubsWired`) |
| Forge mark | `get_asset_uris` | under the extension folder | — | works (spec) |
| File links | `open_file` | opens a local file; refuses network/device/URI/NUL | — | works (spec, `webviewPaths`) |
| Diff | `open_diff` | edits applied to the file on disk; Accept returns them, Reject none; a new file has an empty left side; a cancelled request opens nothing | — | works (spec, `editorRequests`) |
| Tool output | `open_content` | read-only: untitled preview; editable: temp file, answered on save, or with its text on cancel; bad payloads refused | — | works (spec) |
| Notices | `show_notification` | severity picks the API; the button chosen comes back; a non-string message refused; only string buttons, at most 5 | — | works (spec, `settingsHandlers`) |
| New tab | `new_conversation_tab` | `forge.editor.open` | — | works (spec + harness, Phase 1) |
| Tab title | `rename_tab` | the panel's title, 200 code points | — | works (spec + harness, Phase 1) |
| Links | `open_url` | http/https/mailto only | — | works (spec, `untrustedInput`) |
| Health sweep | `sync_endpoint_health` | all, one known profile, cancel; an unknown profile refused before anything runs; no service → `[]` | — | works (spec) |
| Settings | `get_settings` | merged settings, per-key layers, profiles, `hasWorkspace` | — | works (spec) |
| Settings writes | `update_setting`, `reset_setting` | whitelist + types + layer | — | works (spec, `untrustedInput`) |
| Profiles | `switch_profile`, `create_profile`, `delete_profile` | switch throws on a bad name; create/delete answer `success:false` with the reason | — | works (spec + `settingsSafety` on disk) |
| Forge config | `get_extension_config`, `update_extension_config` | answers the config; a write broadcasts `extension_config_changed`, a refused key broadcasts nothing | — | works (spec) |
| History | `get_session_request`, `stat_path_request` | session id only; local paths only, 1000 at most | — | works (spec) |
| Plugins | `uninstall_plugin`, `add_marketplace`, `remove_marketplace`, `refresh_marketplace` | the official one-liners: fixed subcommand, `--`, the value; refusals before a process starts; the CLI's failure passed on | — | works (spec, `pluginHandlers`) |
| Stop | `interrupt_claude` | runs after work queued on the channel; unknown channel warns; a failure is logged | — | works (spec, `channelControl`) |
| Give up | `cancel_request` | aborts that request's signal; unknown id ignored | — | works (spec) |
| Push | `visibility_changed` | the envelope the transport reads; a gone webview drops it | the webview follows it and ignores @-mentions while hidden | works (spec) |
| Push | `sdk_error` | reaches the channel's stream | in a turn an `llm_error` row and the turn ends; outside one a notification | works (spec) |

**Counts:** works 20 · partial 0 · broken 0.

## The mock host

It now answers each of these with the real response shape and the real
validation, instead of the `<type>_response` fallback: the Settings store
(three layers, profiles, `~/.forge.json`), `get_session_request` (an id, or
the "Couldn't open this session." path via `__forgeFailSessionLoad`),
`stat_path_request`, `open_file`, `open_diff`, `open_content`, `rename_tab`,
`get_mcp_servers` (was `servers:[]`, a field that does not exist) and
`get_asset_uris` (was `{}`). New helpers: `__forgeSdkError`,
`__forgeCloseChannel`, `__forgeFailNextLaunch`, `?editorTab`.
`protocolDrift.spec.ts` fails if a request type loses its mock case, and pins
the mock's settings whitelist to `SETTINGS_PAGE_KEYS`. The browser pass over
these answers is Phase 3.

## Found while writing the specs

- `show_notification` spread whatever `buttons` held (the official does too),
  so a string became one button per letter. Fixed: string buttons only.
- The official `show_notification` also honours `onlyIfNotVisible` and reveals
  the chat when a button is clicked. Forge's webview sends neither, so both
  branches would be unreachable; not ported, recorded here.

## Gates

- `pnpm test`: 2405 passed, 8 skipped (96 files).
- `pnpm run typecheck:all`: clean. `pnpm run lint`: 0 errors, 390 warnings (cap 390).

## Specs added

`pluginHandlers`, `settingsHandlers`, `channelControl`, `editorRequests`
(plus Phase 1's `stubsWired`, `webviewPaths`, `untrustedInput`).
