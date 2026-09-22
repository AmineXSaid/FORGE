# Step 25: Fork and "Message actions" — results

Wires `fork_conversation` through the SDK, ports `HU0` (the per-message actions
button and its three options), and — carried over from step 24 — registers the
`rewind` row and mounts the `yH0` picker now that its fork leg exists.

## What the bundle actually says

| Piece | Source | Code |
| --- | --- | --- |
| Sender | `index.js` @3320431 | `async forkConversation($,J){return(await this.sendRequest({type:"fork_conversation",forkedFromSession:$,resumeSessionAt:J})).sessionId}` |
| Handler | `extension.js` @3073850 | `case"fork_conversation":return{type:"fork_conversation_response",sessionId:await(await U6.load(this.cwd,this.logger)).forkSession($.request.forkedFromSession,$.request.resumeSessionAt)}` |
| Store | `extension.js` @3012223 | `async forkSession($,Q){if(!sY($))throw Error("invalid session id");…if(!Y)throw Error(\`Session ${'$'} not found\`);…throw Error(\`Message ${'Q'} not found in session ${'$'}\`);let G=sv.randomUUID(),…}` |
| Context method | `index.js` @4702703 | `async forkConversation($,J,Z){let Y=this.comms.connection.value;if(Y){let X=Y.config.value?.openNewInTab,Q=await Y.forkConversation($,Z);if(X)this.startNewConversationTab(J,Q);else this.viewSession(Q,J)}return ""}` |
| `viewSession` | `index.js` @5218822 | `new gB1(z,Z,async(E,I)=>{await q.activateSessionFromServer(E,I)},…)` |
| Activate | `index.js` @3568192 | `activateSessionFromServer($,J,Z){let Y=()=>{…if(J)V.initialPrompt.value=J;…};if(Y())return!0;let X=await this.getConnection(),Q=await X.listSessions("activate");…}` |
| `HU0` | `index.js` @4905000 | the button, the popup, `m` / `S` / `B1` / `G1` / `Y1` / `i` / `s` |
| Mount | `index.js` @5144300 | `R("div",{className:u0.userMessageContainer,children:[!V&&F(HU0,{session:J,message:Z,context:X,containerRef:H,promptText:K,onCreateNewSession:U,onRewindError:q}),R("div",{className:u0.userMessage,…})]})` |
| `rewind` row | `index.js` @5120476 | `registerAction({id:"rewind",label:"Rewind",description:"Restore code and conversation to an earlier point"},"Context",()=>{z0(!0)})` |
| Picker mount | `index.js` @5139808 | `d&&F(yH0,{session:$,context:J,onCreateNewSession:Z,onRewindError:D,onClose:()=>{z0(!1),z.current?.focus()}})` |

### Four step-file claims corrected

1. **"Read `HU0` for option visibility."** The gate is `let y=Z.uuid` — the
   message's uuid, nothing else. This was on the prompt's list of things to
   raise with the user in case `y` turned out to be a capability Forge could not
   evaluate; it is not, so there was nothing to raise and the rows are shown
   exactly when the official shows them.
2. **"`forkedFromSession` is a known session; `resumeSessionAt` is a message in
   it."** The host cannot check either — it holds no transcript. The official's
   *store* raises those two errors when it reads the session file. Forge
   validates the shapes (B3) and lets the SDK raise the rest.
3. **"Fork through the upgraded SDK."** True, but the file did not mention that
   the official host does **not**: it goes through its own store with a
   positional `forkSession(sessionId, upToMessageId)`, while the SDK takes an
   options object and returns `{sessionId}`. Raised with the user before
   building; the user chose the SDK, consistent with step 20.
4. **The order option 3 runs in** was in the prompt but not the step file, and
   it is the part most easily got wrong: `if(await i() && w) s()` — a failed
   rewind must **not** fork. Three spec cases cover exactly that.

## Scope decisions

| Decision | Why |
| --- | --- |
| Fork through the SDK's `forkSession`, not a port of the official's store | The user's decision, asked before building. `resumeSessionAt` → `upToMessageId`, `dir: cwd` the way the lister passes it, and `.sessionId` unwrapped from the result. |
| The `rewind` row lands here, not in step 24 | Also the user's decision. The row's own flow rewinds *and* forks, so its backend was not complete until this step (B4). |
| `AppContext.forkConversation`'s `openNewInTab` branch is **not** ported | It needs `new_conversation_tab` to carry the forked `sessionId` (`{type:"new_conversation_tab",initialPrompt:$,sessionId:J}`). Forge's request has no such field, its handler only focuses the chat view, and its host hardcodes `openNewInTab: false`. A branch that cannot be reached and would open the wrong conversation if it ever were is worse than one that is absent. Revert by adding `sessionId` to the request, the handler and the branch. |

## Results

> **Harness pass completed 2026-09-20.** Every row below was clicked in the
> harness with its request read back out of `__forgeSent`, except the three
> rejection rows, which were driven straight at the host because no control can
> produce them. See "Oracle" for how the harness was driven after the
> Browser-pane tool was removed from the session.

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| "Message actions" button on a user message | — | — | mounted as the **first child of the inner** `fg-chat__userMessageContainer`, next sibling `fg-chat__userMessage`; `title="Message actions"`, `aria-expanded="false"`, `opacity: 0` until the row is hovered, then `fg-messageactions__subtleVisible`; the rewind-arrow `path` is `M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3` at `stroke-width="3"` | works |
| Opening the popup | — | — | `fg-messageactions__popup fg-messageactions__popupVisible`, button gains `fg-messageactions__visible`, `aria-expanded="true"`; three `popupOption` buttons each wrapping a `span.optionText` | works |
| Closing it by clicking away | — | — | a real **mousedown** outside closes it (a synthetic `click()` does not — the official listens on `mousedown`) | works |
| "Fork conversation from here" (message 2+) | `{type:"fork_conversation",forkedFromSession:<live id>,resumeSessionAt:"2222…0001"}` — the **previous** message's uuid, not the picked one | the SDK forks; `{sessionId}` | `list_sessions_request` then `get_session_request` for the **new** id, and the composer holds "Split the settings loader into its own module." | works |
| "Fork conversation from here" (first message) | **none at all** | — | `onCreateNewSession`: a fresh conversation seeded with that prompt | works |
| "Rewind code to here" | `rewind_code` `dryRun:true`, then on confirm `rewind_code` with **no `dryRun` key** | as step 24 | the `mo` dialog titled **"Rewind code"**, then a `meta` row; **`__forgeForks` stays empty** | works |
| "Fork conversation and rewind code" | `rewind_code` `dryRun:true` → `rewind_code` → `fork_conversation` | both | dialog titled **"Fork and rewind"** with the fork note; the three requests arrive **in that order** | works |
| A rewind that cannot run, in option 3 | `rewind_code` `dryRun:true` only | `canRewind:false` | the primary button is **disabled**, so the confirm cannot be reached and **no `fork_conversation` is ever sent** | works |
| "Never mind" | nothing after the dry run | — | the dialog closes; nothing else sent | works |
| Options 2 and 3 on a **uuid-less** message | — | — | **not rendered** — only "Fork conversation from here" is offered, which is the official's `y = Z.uuid` gate | works |
| "/" → Rewind | — | — | the "Rewind to…" picker: `role="listbox"`, `tabindex="0"`, prompts **newest first** with relative times, `role="option"`/`aria-selected` per row, and the `↑ ↓ Enter Esc` hints | works |
| Keyboard in the picker | — | — | ArrowDown moves `fg-rewind__focused` to index 1; Enter opens the confirm dialog | works |
| Picking a message in the picker | `rewind_code` `dryRun:true` | — | the `mo` dialog with `willForkAfter: true` — title **"Fork and rewind"**, primary **"Continue"** | works |
| A bad source id | `{forkedFromSession:"../../etc/passwd"}` | refused before the SDK | `{type:"error",error:"invalid session id"}` | works — driven at the host |
| A bad `resumeSessionAt` | `{forkedFromSession:A,resumeSessionAt:"nope"}` | refused | `{type:"error",error:"invalid session id"}` | works — driven at the host |
| An unknown source session | `{forkedFromSession:"9999…0099"}` | the store raises; the handler does not swallow it | `{type:"error",error:"Session 9999…0099 not found"}` | works — driven at the host |
| A whole-conversation fork (no `resumeSessionAt`) | `{forkedFromSession:A}` | forks the lot | `{type:"fork_conversation_response",sessionId:"ab0605eb…"}` | works — driven at the host |

**Counts:** works 17 · spec-verified 0 · partial 0 · broken 0 · left out 3 (below)

### One mock-host gap found and fixed

The first run of these clicks failed every fork with
`Failed to fork conversation: Session <id> not found` — and that was the **stub's**
fault, not Forge's: `launch_claude` minted a session id for the live channel but
never added it to `MOCK_SESSIONS`, so the conversation you were actually in was
not forkable. A live session has a transcript on disk like any other, so the stub
now registers it. Worth recording because the failure looked exactly like a Forge
bug, and the error path it accidentally exercised is itself evidence: the
notification read `Failed to fork conversation: Session … not found`, which is
the official's `.catch` wording reaching the user correctly.


## SDK surface

Every field and option on the fork path, with a verdict.

### `forkSession` (sdk.d.ts:770) and `ForkSessionOptions` (775)

| Part | SDK line | Official passes | Forge surfaces | Where / why not |
| --- | --- | --- | --- | --- |
| `_sessionId: string` | 770 | yes | **yes** | `forkedFromSession`, uuid-checked first |
| `upToMessageId?: string` | 777 | yes (positionally) | **yes** | `resumeSessionAt`; absent means a full copy |
| `title?: string` | 779 | **no** | **yes** | the host and transport accept it, capped at 200 and trimmed the way `GX` caps a rename. No UI sends one, because the official has no control for it — the SDK then derives `<original> (fork)`, which is what the official always gets. Surfaced rather than dropped, per the standing direction. |
| `dir?: string` (from `SessionMutationOptions`) | 6074 | n/a — the official's store is already scoped to `this.cwd` | **yes** | the workspace, the same value `sessionListOptions(cwd)` gives the lister. Without it the SDK searches **every** project directory. |
| `sessionStore?: SessionStore` (from `SessionMutationOptions`, `@alpha`) | 6080 | no | **no** | an alpha hook for reading/writing session data somewhere other than the filesystem. Forge has no such store, and wiring one would be a storage backend, not a fork. |
| `ForkSessionResult.sessionId` | 787 | yes | **yes** | unwrapped to the bare string the official's response field holds |

### The *other* fork: `Options.forkSession` (sdk.d.ts:1621)

| Option | SDK line | Forge surfaces | Why |
| --- | --- | --- | --- |
| `forkSession?: boolean` | 1621 | **no** | A different mechanism: it forks **on resume**, giving a resumed session a new id instead of continuing the old one. `fork_conversation` copies a transcript without running anything. Forge's `cliArgs.ts` already knows the flag it produces (`fork-session`, from `option: 'forkSession'`), so if a later step wants resume-forking the gate is ready. Not in scope here. |
| `resumeSessionAt?: string` | 1988 | **no** | Its resume-time twin: replay only up to a message. Same reason. Note the **name collision** with the request field, which means the opposite thing — the request's `resumeSessionAt` becomes `upToMessageId`, not this option. |
| `resumeDropsTurn?: string` | 2039 | **no** | Fork-point guidance for the resume path; only meaningful with the two above. |
| `sessionId?: string` | 1980 | **no** | "Cannot be used with `continue` or `resume` unless `forkSession` is also set" — i.e. it names the *forked* session's id. Only reachable through the resume-fork path. |

**Forked sessions start without undo history** (sdk.d.ts:763): file-history
snapshots are not copied. So a fork cannot be rewound to a point before the
fork. Worth knowing, and why the official rewinds **before** it forks.

## Gates

- `pnpm test`: `Test Files 27 passed (27) · Tests 659 passed (659)` (no unhandled errors)
- `pnpm run typecheck:all`: both projects clean, exit 0
- `pnpm run build`: exit 0; `lint:forge` clean on its own

## Oracle

Run on the step-26 build at **800×900** with `--ref` the official `index.css`,
page `/index.html?mockSessions`, after seeding a transcript.

### How the harness was driven without the Browser pane

The Browser-pane tool was removed from this session by an MCP reload, which is
why this file first shipped with its harness work outstanding. Rather than leave
the debt, the harness was driven by talking to Chrome over the DevTools Protocol
directly — Chrome is installed, and Node 24 has a built-in `WebSocket`, so
`Runtime.evaluate` plus `Input.dispatchMouseEvent` give evaluation in the page
and **real** mouse input. Every click above is a real `mousePressed` /
`mouseReleased` pair at measured coordinates; the keyboard cases in the picker
dispatch `KeyboardEvent`s, which is stated rather than glossed.

A harness from another worktree was already listening on 8735 serving a
different build; this pass runs on **8741**, whose `/main.js` was byte-compared
with `dist/media/main.js` first (1 919 610 bytes, all six markers present).

| Window (root selector) | Baseline | Measured | Structural diffs |
| --- | --- | --- | --- |
| `.fg-chat__userMessageContainer` **with** the actions button | 7/7 without it (step 24) | **11/11** | **0** — the four new elements are the container, the button, its `svg` and `path` |
| `.fg-messageactions__popup`, three options open | new | **7/7** | **0** |
| `.fg-dialog__overlay` — the `mo` confirm dialog | new | **20/20** | **0** |
| `.fg-dialog__overlay` — the "Rewind to…" picker | new | **21/21** | **0** |
| `.fg-commandmenu__menuPopup` ("/" menu, **now 15 rows**) | 79/79 at 14 rows | **82/82** | **0** |
| `.fg-composer__inputWrapper` (idle) | 30/33 | **30/33** | 1, by design |
| `.fg-shell__header` | 15/15 | **15/15** | 0 |
| `.fg-menu__menuPopup` (Modes) | 41/41 | **41/41** | 0 |
| `.fg-commandmenu__menuPopup` (model menu) | 53/73 | **53/73** | 4, by design |
| `.fg-sessionsdropdown__dropdown` | 43/43 at 3 rows | **57/57** at 4 rows | 0 |

No unknown classes in any of them.

**The "/" menu baseline has moved on purpose:** 79/79 at 14 rows → **82/82 at 15
rows**, the new row being `rewind`. `resume-conversation` is `filterOnly`, so it
is not among the 15. 82/82 is what group 6 compares against.


## Specs added

`test/forkConversation.spec.ts` (28 cases) —

- **the validator**: a bare session id; `resumeSessionAt` mapped to
  `upToMessageId`; 12 bad sources and 7 bad `resumeSessionAt` values; four
  non-object requests; the title capped at 200, trimmed, dropped when empty or
  whitespace, and refused when it is not a string;
- **the handler**: the plan and the cwd reaching `forkSession`, the workspace
  passed as `dir`, a bad id **throwing** rather than answering, a fork failure
  propagating instead of being swallowed, and the dispatcher case;
- **the transport**: not channel-scoped, the bare `sessionId` unwrapped, and
  `title` omitted unless given;
- **`AppContext.forkConversation`**: the fork point and prompt passed through,
  the result opened via `viewSession`, and nothing done without a connection;
- **`activateSessionFromServer`**: an already-loaded session; the **re-list**,
  which is the normal path for a fresh fork; giving up when the re-list does not
  have it; not setting a prompt that was not given; and not clearing a draft
  that is already waiting;
- **the ordering rules**: the fork point is the message *before* the one picked,
  `undefined` on the first message, walking back past uuid-less rows, agreeing
  with the picker's own `resumeAtMessageId`; and option 3 forking only after a
  successful rewind (three cases: success, failure, rewind-only).

**Mutation check — 15 deliberate breaks, 15 caught:** source id check removed;
`resumeSessionAt` uuid check removed; `resumeSessionAt` made mandatory; title
not capped; empty title still forwarded; non-string title accepted; handler
swallows a bad plan; handler drops the cwd; transport returns the response
instead of the id; transport becomes channel-scoped; context forks but never
opens the result; context drops the prompt text; context passes the wrong fork
point; activate never re-lists; activate sets the prompt even when none was
given.

(The last was **missed** on the first run — the spec only checked that no prompt
appears from nowhere, not that an existing draft survives. A case for that was
added, and it is caught.)

## Rows deliberately left out and why

| Row | Reason |
| --- | --- |
| `message_rated` / the thumbs (`WU0`) | `out-of-scope.md`. It is the function immediately after `HU0` and was read past twice while extracting this step. Not built. |
| The official's `messageHovered` class | `VZ` has no such key and `index.css` has no such rule; the official renders the literal class `undefined` while a user message is hovered. Inert, and omitted. |
| `AppContext.forkConversation`'s `openNewInTab` branch | See "Scope decisions". |
| `SessionMutationOptions.sessionStore` | `@alpha`, and a storage backend rather than a fork. |

## Pre-existing issues found (not fixed here)

- `handleNewConversationTab` is a stub that focuses the chat view and ignores
  `initialPrompt`; `openNewInTab` is hardcoded `false` in `handleInit`. Both
  predate this step and are why the multi-tab branch is left out.
- The composer's inline error surface is still unported (step 24's note);
  `onRewindError` continues to route to `showNotification`.

## VS Code checklist for the user (unverified — the harness cannot prove the CLI side)

1. In a conversation with at least three prompts, hover the **second** user
   message and click the button that appears at its top-right. **Expected:**
   three options.
2. Choose "Fork conversation from here". **Expected:** a new conversation opens
   holding the history up to the message **before** the one you picked, with
   that message's text waiting in the composer, and the original conversation
   unchanged on disk. Check `~/.claude/projects/<project>/` for a new `.jsonl`
   whose name is the new session id.
3. Open "Past conversations". **Expected:** the fork is listed, titled
   `<original> (fork)` — the SDK derives that when no title is passed.
4. Choose "Fork conversation and rewind code" on a message after a file edit.
   **Expected:** the dialog is titled "Fork and rewind" and says a new forked
   conversation will be created; confirming restores the files **and then**
   opens the fork.
5. Make the rewind fail (pick a message with no checkpoint — e.g. one from
   before this build, since checkpointing only started in step 24).
   **Expected:** an error, and **no** fork is created. That ordering is the one
   thing most worth checking by hand.
6. Hover the **first** user message and choose "Fork conversation from here".
   **Expected:** a brand-new empty conversation seeded with that prompt, not a
   fork — there is nothing before it to fork from.
7. Run "/" → Rewind. **Expected:** a "Rewind to…" list of your past prompts,
   newest first, with relative times; ↑/↓ and Enter work; picking one opens the
   "Fork and rewind" dialog.
