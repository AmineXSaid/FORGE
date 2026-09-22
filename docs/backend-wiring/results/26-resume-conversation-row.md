# Step 26: "Resume conversation" row — results

One registry row. **No request, no handler, no SDK call** — this is the one step
of the four with no B2 work, so there is nothing to wire in six places and
nothing to validate against the bundle beyond the row's own data and what it
does when clicked.

## What the bundle actually says

Quoted verbatim from `index.js` @5195048, inside the same `e(()=>{…})` as its
two neighbours:

```js
J.commandRegistry.registerAction({
  id:"resume-conversation",
  label:"Resume conversation",
  description:"Continue a previous conversation",
  filterOnly:!0
},"Context",()=>{z(!0)})
```

`z(!0)` sets the same state the header's history button toggles, so the row
opens the **existing** dropdown rather than a second surface. Forge's
`ChatPage.sessionsOpen` is that state, and the row now sets it.

### The copy check the step brief asked for

The brief asked whether Forge's `clear-conversation` / `new-conversation` rows
had drifted from the official's copy, and said to **report** a mismatch rather
than silently fix it. **There is no mismatch.** Both match the bundle verbatim:

| Row | Official (`index.js` @5194674, @5194834) | Forge | Match |
| --- | --- | --- | --- |
| `clear-conversation` | "Clear conversation" / "Start a new conversation", not `filterOnly` | same | yes |
| `new-conversation` | "New conversation" / "Open a new conversation in a new tab", `filterOnly:!0` | same | yes |

So nothing was changed about them, and `test/commandMenuContextRows.spec.ts`
now pins that copy so a future drift fails a gate.

### Order within the Context section

Registration order decides the order in the section, and it comes from **two**
effects. A child's effect runs before its parent's, and the composer is a child
of the chat page, so the composer's rows come first:

| # | Row | Registered by | `filterOnly` |
| --- | --- | --- | --- |
| 1 | `attach-file` | composer effect (`index.js` @5119056) | no |
| 2 | `mention-file` | composer effect (@5119222) | no |
| 3 | `rewind` | composer effect (@5120476) | no |
| 4 | `clear-conversation` | chat-page effect (@5194674) | no |
| 5 | `new-conversation` | chat-page effect (@5194834) | yes |
| 6 | `resume-conversation` | chat-page effect (@5195048) | yes |

Forge builds all six from one array, so the array is written in that order and
the spec asserts it.

## Results

> **Harness pass completed 2026-09-20.** The row was clicked; see "Oracle".

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| "Resume conversation" hidden until filtered | **none** — no request exists for this row | **none** — no handler, so B2 does not apply | the unfiltered "/" menu shows **15** rows and this is **not** among them | works |
| Typing `resume` in the filter | none | — | exactly **one** row remains: "Resume conversation" | works |
| Clicking it | none | — | the menu closes (`menuOpen: false`) and the **sessions dropdown opens** with its rows — the same surface the header clock opens, not a second one | works |
| Its copy and `filterOnly` flag | — | — | matches the bundle verbatim | works |
| `clear-conversation` / `new-conversation` copy | — | — | unchanged, and now pinned by a spec | works |
| Context row order | — | — | attach, mention, **rewind**, clear, new, resume — the composer effect's rows first, then the chat page's | works |

**Counts:** works 6 · spec-verified 0 · partial 0 · broken 0 · left out 0


## SDK surface

**None.** This row makes no SDK call and sends no request. There is no
`resume_conversation` request type in the official bundle — the row is pure
webview state. Recorded here rather than inventing a request, as the step brief
asked.

## Gates

- `pnpm test`: `Test Files 28 passed (28) · Tests 664 passed (664)`
- `pnpm run typecheck:all`: both projects clean, exit 0
- `pnpm run build`: exit 0; `lint:forge` clean

## Oracle

Run on the step-26 build at **800×900**, `/index.html?mockSessions`, driving
Chrome over the DevTools Protocol because the Browser-pane tool had been removed
from the session (the method is described in
[25-fork-and-message-actions.md](25-fork-and-message-actions.md#oracle)). The
"/" menu was opened with a **real** click on the footer button.

| Window (root selector) | Baseline | Measured | Structural diffs |
| --- | --- | --- | --- |
| `.fg-commandmenu__menuPopup` ("/" menu, **15 rows**) | 79/79 at 14 rows | **82/82** | **0** |
| `.fg-sessionsdropdown__dropdown` (opened *by this row*) | 43/43 at 3 rows | **57/57** at 4 rows | **0** |

**The "/" menu baseline has moved, and on purpose.** 14 rows → 15, the new one
being `rewind` (step 25). `resume-conversation` is `filterOnly` and so is *not*
among the 15 — which is itself the evidence that the flag works. **82/82 is the
number group 6 compares against.**

The 15 rows, in order, exactly as the official registers them:

    Attach file…
    Mention file from this project…
    Rewind                      <- step 25
    Clear conversation
    Switch model…               Default (recommended)
    Effort                      (Medium)
    Thinking
    MCP servers
    Hooks
    Permissions
    Slash commands
    Manage plugins
    Open Forge in Terminal
    General config…
    View help docs


## Specs added

`test/commandMenuContextRows.spec.ts` (5 cases) — reads the real row array out
of `ButtonArea.vue` and compares it against the registry quoted from the bundle:
every Context row with its id, label, description and `filterOnly` flag, in
order; `resume-conversation` specifically being `filterOnly`; `rewind`
specifically **not** being; the two neighbours' copy pinned; and both new rows
being wired to an action rather than left inert.

A source-reading spec rather than a component test, because `menuCommands` is a
computed inside an SFC with a dozen props. The trade-off is stated plainly: it
catches copy, flags, order and wiring — which is all this step has — and it
would not catch a change that kept the literal but broke the rendering. That
part is covered by the harness click recorded under "Oracle".

## Rows deliberately left out and why

None. Every row the official registers in the Context section is now present.

## Outstanding

Nothing. All four items are closed:

1. ~~"Resume conversation" is not among the visible rows.~~ Confirmed — 15 rows,
   and it is not one of them.
2. ~~Typing `resume` reveals it.~~ Confirmed — the filter leaves exactly one row.
3. ~~Clicking it closes the menu and opens the sessions dropdown.~~ Confirmed.
4. ~~Re-measure `.fg-commandmenu__menuPopup`.~~ Done — **82/82 at 15 rows**,
   0 structural diffs.


## VS Code checklist for the user (unverified)

1. Type `/` then `resume` in the composer's command filter and choose the row.
   **Expected:** past conversations open in the dropdown under the header.
2. Open the "/" menu without typing. **Expected:** "Resume conversation" is
   **not** in the list — only filtering reveals it — while "Rewind" is.
