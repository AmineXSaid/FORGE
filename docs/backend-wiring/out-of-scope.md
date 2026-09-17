# Out of scope: don't build these

This was decided in `CLAUDE.md` ("Current task"). These rows and buttons **stay
out of the UI** (B4). Commented-out dispatcher cases for them stay commented out.
Copy this list into every group report and into the final report.

| Feature | Official requests / ids | UI to keep out | Reason |
| --- | --- | --- | --- |
| Microphone / speech-to-text | `start_speech_to_text`, `stop_speech_to_text`, the `resources/audio-capture` binary | the mic button (ported `micButton` classes stay unused) | out of scope: account and cloud |
| Login / Switch account | `login`, `get_auth_status`, `submit_oauth_code` (stay commented out) | the `login` row | out of scope: account and cloud |
| Account & usage | `get_usage`, `open_account_usage` | the `account-usage` row; the `usage` slash command (its official action is `account-usage`) | out of scope: account and cloud |
| Usage / context meter | `get_context_usage`, `request_usage_update` | the footer `YH0` / `usageButtonV2`; the `context` slash command (its official action opens the context view) | out of scope: account and cloud |
| Remote Control | `toggle_remote_control`, `remoteControlAtStartup`, `/remote-control` | the `remote-control-at-startup` row and the `/remote-control` row | out of scope: account and cloud |
| Feedback | `submit_feedback`, `/feedback`, `/bug`, "Report a problem" | those rows; the live "Report a problem" button is **removed** in step 33, and the version text stays | out of scope: account and cloud |
| Thumbs rating | `message_rated` (`WU0`) | the thumbs | out of scope |
| Switch models when flagged | `switchModelsOnFlag` (`NM1`) | the `switch-models-on-flag` row | gated by Anthropic experiment flags Forge never receives |
| Side question | `/btw`, `side_question` | the `/btw` row | out of scope |
| Ultracode | `ultracode` flag, the `xhigh`+flag mode | any Ultracode option; `ultracode` isn't in Forge's settings whitelist | out of scope |

## Not listed in either scope list (don't widen)
These sessions-dropdown extras are in the spec (B8) but not in `CLAUDE.md`'s in-scope
list, so they aren't built. If you want them, ask for them explicitly.
- the worktree pill ("Open <name> in new window", `open_folder_in_new_window`)
- `generate_session_title` (automatic titles)
