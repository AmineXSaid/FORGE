# Results, step 04: Assistant status dot follows `p85`

Harness `--port 8735`, started from this build (checked: `window.__forgeSent` is
an array; stylesheets `[1, 5, 9819]`; the served `main.js` has the step 03
assembler). Each turn began with a real composer send (`io_message` user text
"Run the build and read two files" and "Now stream a reply with a tool"), so
the session was busy (spinner row present). Messages were then posted as
`{type:'from-extension', message:{type:'io_message', channelId, message}}`; a
`result` ended the turn. No request is involved, so B2's six places don't apply,
and `mock-host.js` is unchanged.

## Official
`p85($, busy)`: for an assistant message, the **first** `tool_use` returns
`progress` / `failure` (no result, busy / idle) or `failure` / `success`
(`is_error` / not); no `tool_use` returns `null`. `u85` maps it to
`dotSuccess` / `dotFailure` / `dotProgress` / `""`. The `.timelineMessage:before`
dot is drawn for every row; the classes only recolour or blink it.

## Row checks

| # | Seeded message | Busy | Class | `::before` measured | Verdict |
| --- | --- | --- | --- | --- | --- |
| D1 | text only ("Plain text reply.") | yes | none | drawn: `""`, 7×7px, grey `rgb(157,157,157)`, no animation | works |
| D2 | `Bash` tool_use, no result | yes | `dotProgress` | animation `blink` | works |
| D3 | `Read` tool_use + `is_error: true` result | yes | `dotFailure` | red | works |
| D4 | `Read` tool_use + ok result | yes | `dotSuccess` | green | works |
| D5 | `Read` tool_use, then its ok result arrives | yes | `dotProgress` → `dotSuccess` | — | works (reactive) |
| D6 | text + pending `Bash` + ok `Read` (first tool decides) | yes | `dotProgress` | — | works |
| D7 | after `result` (idle): D1 / D2 / D3 / D4 / D5 / D6 | no | none / `dotFailure` / `dotFailure` / `dotSuccess` / `dotSuccess` / `dotFailure` | all animations `none` | works |
| D8 | streamed text row (step 03 path) | yes | none while streaming and after | — | works |
| D9 | streamed `tool_use`: partial → stop → final message → result → turn end | yes→no | hidden → `dotProgress` → `dotProgress` → `dotSuccess` → `dotSuccess` | — | works |
| R1 | composer send ×2 | — | user row + busy spinner; spinner gone after `result` | — | works (no regression) |

Dot geometry on every row: `position: absolute`, `left 9px`, `top 7px`, `7×7px`,
`border-radius 50%`. These are the ported official values, and `top` resolves
through the official `--message-padding-top` rule.

**Counts:** works 9 · partial 0 · broken 0 · rows left out 0.

## Specs added
`test/messageStatus.spec.ts`, 10 tests: one per table row (text only, busy and idle; pending idle →
failure; pending busy → progress; `is_error` → failure while busy and idle; ok → success),
the first tool deciding (3 orders), thinking + text → null, **rejections** (a user
message with a tool_use, string content, empty content → null), the result
attaching through `processAndAttachMessage`, and `statusDotClass` for all four.

## Gates
- `pnpm test`: 6 files, **69 tests** passed (10 new).
- `pnpm run typecheck:all`: `tsc --noEmit` and `vue-tsc` clean (exit 0).
- `pnpm run build`: exit 0. `Forge brand guardrail: clean (284 files scanned)`,
  `Forge token check: clean (180 tokens used, 344 defined)`,
  `Forge command check: clean (20 commands, 13 references)`, webview and extension built.

## Oracle
| Window (root) | Checked | Structural diffs | Note |
| --- | --- | --- | --- |
| text-only `.fg-chat__timelineMessage` (no class) | 3 | **0** | clean |
| `Read package.json` row, class none / `dotSuccess` / `dotFailure` / `dotProgress` | 11 each | 8 rows each, identical output | the dot class changes nothing structural |
| other tool rows (`Bash`, `Read` error, `Read` ok, mixed) | 8–23 | 6–11 rows | all inside the tool components (`fg-chat__message > > button/span/div`, `pre`), plus the row's size, which follows from them |

The tool-row diffs already existed: they are Forge's tool components (not ported
from official markup), and the oracle output is byte-identical whichever dot class
the row carries. `probe-oracle.js` doesn't diff `::before`, so the dot itself was
measured directly (table above). Colour differs by design (brand tokens `--forge-success`, `--forge-danger`).

## Rows deliberately left out and why
None. `dotWarning` exists in the official CSS but `p85` never returns it.

## Issues that already existed, found but not fixed
- The tool components inside assistant rows (`Bash`, `Read`, …) differ structurally
  from the official tool rows (oracle rows above). Not in group 1's scope.
- A whole-turn oracle also flags `h3.fg-chat__screenReaderTurnHeading` (Forge
  visually-hidden styles vs official static). Not touched here.

## VS Code checklist for the user (unverified)
1. Ask Claude to run a shell command (e.g. "run `git status`"). **Expected:** the
   Bash row's dot blinks while it runs, then turns green.
2. Ask it to read a file that does not exist. **Expected:** that row's dot is red.
3. Ask a plain question with no tools. **Expected:** the reply keeps the plain grey dot (no colour, no blink).
4. Start a tool that needs permission and press Esc / stop the turn. **Expected:**
   once the turn ends, the unanswered tool row's dot is red, not blinking.
5. Reopen an older conversation from history. **Expected:** completed tools show
   green or red, text replies grey; nothing blinks.
