# Results, step 02: Slash Commands section

Harness `--port 8735`, freshly started from this worktree's build (checked:
`window.__forgeSent` exists; stylesheets `[1, 5, 9819]`). Mock `commands`:
`compact`, `context`, `usage`, `init`, `review`, `review` (alias `team-tools:review`), `security-review`.

## Row checks

| # | Row / action | Request sent | Host / mock result | UI effect | Verdict |
| --- | --- | --- | --- | --- | --- |
| T1 | "/" menu, no filter | none | — | sections Context, Model, Customize, Settings, Support; **no** Slash Commands | pass |
| T2 | filter `/` | none | — | Slash Commands shown: `/compact`, `/init`, `/review`, `/security-review`, `/team-tools:review` (sorted); all other sections kept | pass |
| T3 | filter `/comp` | none | — | `/compact`, `/security-review` (description match) | pass |
| T8 | filter `usage` / `context` | none | — | no `/usage` or `/context` row | pass |
| T8b | filter `review` | none | — | `/review`, `/security-review`, `/team-tools:review` (Y55 alias) | pass |
| T4 | click `/compact`, draft "hello draft" | `io_message` with user text `/compact` | accepted | menu closes; draft still "hello draft" | pass |
| T6 | Enter on `/security-review` (after the turn ended) | `io_message` with `/security-review` | accepted | menu closes | pass |
| T7 | click `/team-tools:review` | `io_message` with `/team-tools:review` | accepted | menu closes | pass |
| T5 | Tab on `/init` | none | — | draft becomes `/init `, composer focused, menu closes | pass |
| T5b | Tab on `/compact`, draft "draft to replace" | none | — | draft `/compact `, caret at offset 9 of 9 | pass |
| R1 | Tab on "Switch model…" | none | — | command menu closes, model picker opens | pass (no regression) |
| R2 | click "Thinking" | `set_thinking_level` | ack | menu **stays open** | pass (no regression) |
| R3 | Enter on "View help docs" | `open_url` | ack | menu closes | pass (no regression) |
| R4 | Shift+Tab in the filter | `set_permission_mode` | ack | menu stays open; mode cycles | issue that already existed (capture-phase keybinding), not from this step |
| — | Enter on a slash row **while busy** (before the turn ended) | none | — | nothing happens | gap that already existed: ChatPage drops sends while busy |

**Counts:** 13 pass · 0 broken · 2 issues that already existed (recorded in the step file) · rows left out: `/context`, `/usage` (out of scope).

## Oracle
`.fg-commandmenu__menuPopup` with the Slash Commands section open: 100 checked,
**100 clean, 0 structural diffs**, 2 colour rows (brand), no unknown classes.

## Gates
- `pnpm test`: 4 files, **26 tests** passed (11 new in `test/slashCommands.spec.ts`).
- `pnpm run typecheck:all`: clean.
- `pnpm run build` (lint:brand, lint:tokens, lint:commands, webview, extension): exit 0.

## VS Code checklist for the user (unverified)
1. Open "/" and look at the list without typing. **Expected:** no "Slash Commands" section.
2. Type `/`. **Expected:** a "Slash Commands" section listing your CLI's commands
   (built-ins, plus anything in `.claude/commands` and plugins) in alphabetical
   order, without `/context` or `/usage`.
3. Click `/init`. **Expected:** the menu closes and `/init` is sent as a message
   (it runs in the transcript), and any draft you had stays in the composer.
4. Open "/", type `init`, press **Tab**. **Expected:** nothing is sent; the
   composer now holds `/init ` with the caret at the end.
5. If two plugins define the same command name. **Expected:** one row is shown as `/<plugin>:<name>`.
