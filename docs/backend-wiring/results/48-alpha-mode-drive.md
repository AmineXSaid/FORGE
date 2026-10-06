# 48b: drive-all, "/" menu and chat surfaces (2026-10-06, harness, `--no-oracle`)

`node .claude/skills/ui-parity/scripts/drive-all.mjs --port 8791 --no-oracle --only '"/" menu,chat surfaces'` against the build of this commit (`/main.js` byte-compared with `dist/media/main.js`). The oracle did not run: the official stylesheet is not in this container.

| Surface | Row | Sent | Host answer | UI effect | Verdict |
| --- | --- | --- | --- | --- | --- |
| "/" menu | rows and sections | — |  | 21 rows; sections Context, Model, Customize, Settings, Support | PASS |
| "/" menu | Attach file… | (none) | real | file chooser opened; menu closes | PASS |
| "/" menu | Mention file from this project… | list_files_request | real | "@" inserted in the composer; menu closes | PASS |
| "/" menu | Rewind | (none) | real | rewind picker open; menu closes | PASS |
| "/" menu | Clear conversation | launch_claude | real | empty state (in place); menu closes | PASS |
| "/" menu | Switch model… | (none) | real | model menu open; menu stays open | PASS |
| "/" menu | Effort | apply_settings | real | menu stays open | PASS |
| "/" menu | Thinking | set_thinking_level | real | menu stays open | PASS |
| "/" menu | Toggle fast mode |  |  | not registered for this model (as the official) | LEFT OUT |
| "/" menu | Alpha mode | set_alpha_mode | real | toggle on; host state true; menu stays open | PASS |
| "/" menu | Output styles | get_output_style | real | output style picker open; menu closes | PASS |
| "/" menu | MCP servers | open_forge_settings{tab:mcp-servers} | real | menu closes | PASS |
| "/" menu | Hooks | open_forge_settings{tab:hooks} | real | menu closes | PASS |
| "/" menu | Permissions | list_permission_rules | real | permission rules dialog open; menu closes | PASS |
| "/" menu | Endpoints | open_forge_settings{tab:endpoints} | real | menu closes | PASS |
| "/" menu | Slash commands | open_forge_settings{tab:slash-commands} | real | menu closes | PASS |
| "/" menu | Manage plugins | open_forge_settings{tab:plugins} | real | menu closes | PASS |
| "/" menu | Open Forge in Terminal | (none) | real | paused: greyed with "(soon)", aria-disabled, sends nothing; menu stays open | LEFT OUT |
| "/" menu | Focus view | set_focus_view | real | menu stays open | PASS |
| "/" menu | General config… | open_config | real | menu closes | PASS |
| "/" menu | View help docs | open_help | real | menu closes | PASS |
| "/" menu | New conversation (filter only) | launch_claude | real | side bar: starts over in place, no new tab; hidden until typed: yes | PASS |
| "/" menu | Resume conversation (filter only) | list_sessions_request | real | past conversations dropdown open; hidden until typed: yes | PASS |
| "/" menu | /btw | (none) |  | side-question card open | PASS |
| "/" menu | CLI command /compact | io_message |  | sent as a message | PASS |
| chat | guard note (forge_guard_note) | — |  | 1 note row(s): "The last edit introduced 1 error(s); sent back to fix them…" | PASS |
| chat | header, composer and transcript render | — |  | 2 turns | PASS |

**Counts:** PASS 25 · FAIL 0 · LEFT OUT 2

**Oracle: NOT RUN** (`--no-oracle`): 5 windows were not measured against the official stylesheet.

| Window | Root | Checked | Clean | Structural | New vs baseline | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| "/" menu (open) | `.fg-commandmenu__menuPopup` | — | — | — | — | NOT RUN |
| header | `.fg-shell__header` | — | — | — | — | NOT RUN |
| composer (idle) | `.fg-composer__inputWrapper` | — | — | — | — | NOT RUN |
| transcript | `.fg-chat__messagesContainer` | — | — | — | — | NOT RUN |
| transcript (with a guard note) | `.fg-chat__messagesContainer` | — | — | — | — | NOT RUN |
