# Step 24: Rewind code with a dry-run confirmation — results

Wires `rewind_code` end to end, turns on file checkpointing for every session,
and ports the two surfaces the flow needs: the `mo` confirm dialog and the `yH0`
"Rewind to…" picker. The `rewind` registry row is **not** registered here — see
"Scope decision" below.

## What the bundle actually says

| Piece | Source | Code |
| --- | --- | --- |
| Sender | `index.js` @3320566 | `async rewindCode($,J,Z){return this.sendRequest({type:"rewind_code",userMessageId:J,dryRun:Z?.dryRun},$)}` |
| Handler | `extension.js` @3074036 | `case"rewind_code":{let{userMessageId:X,dryRun:J}=$.request;return this.withChannel($.channelId,async(Y)=>{let z=await Y.query.rewindFiles(X,{dryRun:J});if(z.error)throw Error(z.error);return{type:"rewind_code_response",canRewind:z.canRewind,filesChanged:z.filesChanged,insertions:z.insertions,deletions:z.deletions,skippedLinks:z.skippedLinks}})}` |
| Session method | `index.js` @3527648 | `async rewindCode($,J){if(!this.claudeChannelId||!this.connection.value)throw Error("No active session");return this.connection.value.rewindCode(this.claudeChannelId,$,J)}` |
| Meta row | `index.js` @3438339 | `function I51($){return new _Z("meta",[new kJ({type:"text",text:$})],{uuid:globalThis.crypto.randomUUID()})}` |
| Meta renderer | `index.js` @5146820 | `function m85({message:$}){…return F("div",{className:`${u0.metaMessage} ${u0.metaMessageLines}`,children:Z})}` |
| Skipped-links copy | `index.js` @4902000 | `function TR($){if(!$)return"Code rewind successful";return \`Code rewind completed, but ${'$'} ${'$'}===1?"file was":"files were"} skipped: ${'p_1'}\`}` |
| `p_1` | `index.js` @3411724 | `"the tracked path is (or became) a link or other non-regular file, its directory changed since the checkpoint, or its backup could not be safely read"` |
| Confirm dialog | `index.js` @4902100 | `function mo({session:$,userMessageId:J,willForkAfter:Z,onClose:Y,onConfirm:X})` — module `n2luCQ` |
| Picker | `index.js` @5112400 | `function yH0({session:$,context:J,onClose:Z,onCreateNewSession:Y,onRewindError:X})` — module `cO8y_Q` |
| Registry row | `index.js` @5120476 | `registerAction({id:"rewind",label:"Rewind",description:"Restore code and conversation to an earlier point"},"Context",()=>{z0(!0)})` |

### Five step-file claims corrected

1. **"`dryRun` is a boolean."** It is `boolean \| undefined`. `Z?.dryRun` puts
   the key on the wire with the value `undefined` whenever `rewindCode(id)` is
   called without options — which is the **real** run, fired by both confirm
   paths. Refusing `undefined` would have broken the feature; the mutation
   "undefined dryRun refused" is in the spec run below precisely to keep that
   from creeping back.
2. **"Confirm sends `dryRun:false`."** It does not. `dryRun:true` is sent once,
   by the dialog's opening preview; the confirm sends `dryRun: undefined`.
3. **"`userMessageId` belongs to this channel's transcript."** The official
   validates nothing — it destructures and passes through, and the CLI answers
   `canRewind:false` for an id it does not know. The host has no copy of the
   transcript to check against. Forge validates the **shape** instead (B3): the
   same `SD0` uuid regex the session-id validator uses, since both sides mint
   message uuids with `crypto.randomUUID()`.
4. **"Official error mapping."** There is no mapping: `if(z.error)throw Error(z.error)`.
   The response type therefore carries five fields, not six — `error` never
   reaches the wire. Forge throws in the same place, and the existing
   `handleRequest` → `{type:"error",error}` → `case "response"` → `reject` chain
   reproduces the official webview's view of a failure exactly. **This was
   raised as a question before building; reading Forge's own transport answered
   it, so no user decision was needed.**
5. **The step file never mentions the picker.** "/" → Rewind opens `yH0`, a list
   of past user prompts; choosing one opens `mo` with `willForkAfter: true`, and
   confirming rewinds **and then forks**. That is why the row moves to step 25.

### An official quirk, recorded and not copied

`HU0`'s container className is `` `${VZ.container} ${U?VZ.messageHovered:""}` ``
but `VZ` has no `messageHovered` key and `index.css` has no such rule — checked
both: one occurrence in `index.js`, zero in `index.css`, zero in the module map.
The official therefore renders the literal class `undefined` while a user message
is hovered. Forge omits it. Noted here because step 25 ports that element.

## The blocker found mid-step: Forge had no user-message uuids

`rewind_code` and `fork_conversation` both key off a **user message uuid**, and
Forge produced none. Two independent causes, found by trying to seed a transcript
in the harness:

1. **Loading a conversation lost every uuid.** `convertMessage`
   (`ClaudeSessionService.ts:147`) put the transcript row's uuid into
   `session_id`, and for an assistant row overwrote `uuid` with the API message
   id — which `Message.fromRaw` already derives into `betaMessageId` by itself.
   So a reopened conversation arrived with `uuid: undefined` on every row.
2. **A live turn never got one.** Forge's `buildUserMessage` built the row
   without a uuid, and Forge did not pass `--replay-user-messages`, so the CLI
   never echoed one back either.

Put to the user as a scope question with three options; the user chose **fix
both**. What that took, and why it is smaller than it sounds:

| Change | Official | Forge |
| --- | --- | --- |
| Mint the uuid client-side | `q=crypto.randomUUID(), U={type:"user",uuid:q,session_id:"",parent_tool_use_id:null,message:{…}}` (`index.js` @3497850) | `buildUserMessage` now returns the same shape. The CLI stores the uuid the client supplied — which is why the official's own replay guard matches on it. |
| Pass the flag | `extraArgs:{debug:null,"debug-to-stderr":null,"enable-auth-status":null,"no-chrome":null,"replay-user-messages":null}` (`extension.js` @3309667) | `forgeBaseCliArgs()` in `cliArgs.ts`, used by `ClaudeSdkService.query()`. Not a PROTOCOL flag; Forge leaves out the two account/browser ones (out of scope, and step 28). |
| Drop the echo of a prompt already on screen | `if("uuid"in $&&$.uuid&&J.some((Q)=>Q.uuid===$.uuid)){…}else{…insert…}` (`index.js` @3532789) | the same uuid match in `processAndAttachMessage`, before the append. |
| Fix the loader | — | `convertMessage` carries `uuid: msg.uuid` and `session_id: msg.sessionId` on both row types. |

**Not ported, and why:** the official's `replayInsertIndex` / `localTurnStarted`
/ `turnHadToolRound` bookkeeping, which decides *where* a replayed message the
webview never sent (hook-injected, queued input, a compaction summary) lands
relative to the running turn. Forge appends it. The duplicate-prompt risk — the
thing that made this a scope question — is handled entirely by the uuid guard,
which is the official's own test. Placement is a refinement, and a separate step
if the user wants it.

**What this changes for every session, stated plainly:** each launch now carries
`--replay-user-messages`, so the CLI echoes user messages it processes. The echo
of a prompt the webview sent is dropped; a message the webview did not send now
*appears*, where before it was invisible. That is the official's behaviour, and
it is the only reason a hook-injected or queued prompt shows up at all.

## Scope decision (raised with the user before building)

Three conflicts were put to the user with a recommendation, and all three
recommendations were taken:

| Conflict | Decision |
| --- | --- |
| `enableFileCheckpointing` costs disk on every session and the official exposes no toggle | **Always on, at the SDK `Options` layer** (`ClaudeSdkService.query()`, sdk.d.ts:1605). Not a CLI flag, so `cliArgs.ts`'s PROTOCOL / MANAGED / FREE gate is untouched. |
| The `rewind` row's own flow forks, and fork is step 25 | **Register the row in step 25.** Step 24 ships the request, both dialogs and the specs; step 25 mounts them, adds fork and clicks the row. Honours B4 — a row appears only when its backend works. |
| The official host forks through its own store; the SDK's `forkSession` takes an options object | **SDK**, consistent with step 20. (Applies to step 25; asked here because it changes `RewindPicker`'s shape.) |

The cost the user accepted, stated plainly: **step 24 has no harness click of its
own.** Nothing it adds is reachable from the UI until step 25 mounts it. What
follows is exactly what was verified, and nothing is rounded up.

## Results

> **Harness pass completed 2026-09-20**, once a way to drive the harness without
> the Browser-pane tool was built (see "Oracle"). The clicks this step deferred
> to step 25 — the `rewind` row and both dialogs — have now been made. Every row
> marked **works** below was clicked, with its request read back out of
> `__forgeSent`.

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| Dry run (dialog opens) | `{type:"rewind_code",userMessageId:U1,dryRun:true}` on the channel | `query.rewindFiles(id,{dryRun:true})`; five fields forwarded | the dialog lists 3 cwd-relative files, 42 insertions, 17 deletions | works |
| Real run (confirm) | `{type:"rewind_code",userMessageId:U1}` — **the `dryRun` key absent, not `false`** | `rewindFiles(id,{dryRun:undefined})` | a `meta` row appended, `fg-chat__metaMessage fg-chat__metaMessageLines` / "Code rewind successful" | works — **but the files-on-disk effect is CLI-side and no harness can prove it**; checklist items 7–9 |
| "Never mind" | nothing after the dry run | — | the dialog closes and `__forgeSent` still holds only the dry run | works |
| Nothing to restore | `dryRun:true` answering `filesChanged:[]` | — | "The code **has not changed**, so no code will be restored.", and the primary button **disabled** | works |
| Checkpoint error | `rewind_code` | the host **throws** `result.error` | `.fg-changes__error` reads "No file checkpoint found"; primary disabled | works |
| Closed channel | same, unknown `channelId` | `requireChannel` throws `Channel not found: …` | the request rejects | spec-verified |
| Malformed `userMessageId` | `{…,userMessageId:"../../etc/passwd",dryRun:true}` | refused before the channel lookup; `rewindFiles` never called | `{canRewind:false}` | works — driven at the host |
| Non-boolean `dryRun` | `{…,dryRun:"yes"}` | refused | `{canRewind:false}` | works — driven at the host |
| Skipped links | a real run answering `skippedLinks:n` | five fields forwarded | the meta row reads "Code rewind completed, but n file(s) …", plus a warning notification | spec-verified — reaching it needs a real link-safety refusal |
| A prompt sent live | — | the row carries a client-minted uuid, sent to the CLI with the message | the message becomes a rewind/fork target | works |
| The CLI's echo of that prompt | `isReplay:true`, same uuid | — | **no second row** — the transcript stayed at 4 | works |
| A replayed message the webview never sent | `isReplay:true`, fresh uuid | — | appended — the transcript went to 5 | works |
| A conversation loaded from disk | `get_session_request` | `convertMessage` carries `uuid` and `session_id` separately | every row becomes a rewind/fork target | spec-verified; the disk read is CLI-side — checklist item 12 |

**Counts:** works 10 · spec-verified 3 · partial 0 · broken 0 · left out 3 (below)

## SDK surface

Every field and option the SDK exposes on the rewind path, with a verdict. The
standing direction is to surface everything the SDK has, not only what the
official uses.

### `RewindFilesResult` (sdk.d.ts:3124) — all six fields

| Field | SDK line | Official forwards | Forge surfaces | Where / why not |
| --- | --- | --- | --- | --- |
| `canRewind: boolean` | 3125 | yes | **yes** | gates the dialog's primary button (`rewindConfirmEnabled`), and a `false` from the confirm path becomes "Failed to rewind code" |
| `error?: string` | 3126 | **no — thrown** | **yes, as a rejection** | `if (result.error) throw new Error(result.error)`, then the dialog's `.catch` puts it in `.fg-changes__error`. Adding it to the response instead would have been a protocol change, so it stays thrown. |
| `filesChanged?: string[]` | 3127 | yes | **yes** | the `ul.fileList`, each path through `relativeToCwd` |
| `insertions?: number` | 3128 | yes | **yes** | the green count in the summary line |
| `deletions?: number` | 3129 | yes | **yes** | the red count in the summary line |
| `skippedLinks?: number` | 3133 | yes | **yes** | the meta row's wording and the warning notification. The SDK notes it is *only* populated by a real rewind and never on a dry run; the mock host mirrors that. |

### `Query.rewindFiles` (sdk.d.ts:2915) — the whole signature

| Part | Forge surfaces | Note |
| --- | --- | --- |
| `userMessageId: string` | **yes** | validated as a uuid first (B3) |
| `options?.dryRun?: boolean` | **yes, all three states** | `true` (preview), `false` and `undefined` (both real runs). The official only ever sends `true` and `undefined`; Forge accepts an explicit `false` too, because the type allows it and the transport can produce it. |

There are no other options on `rewindFiles` — the object type is
`{dryRun?: boolean}` and nothing else.

### `SDKUserMessageReplay` (sdk.d.ts:5923) — the type `--replay-user-messages` produces

| Field | Forge surfaces | Where / why not |
| --- | --- | --- |
| `type: 'user'` | yes | routed like any user row |
| `message: MessageParam` | yes | the row's content |
| `uuid: UUID` (**required** here, optional on `SDKUserMessage`) | **yes** | the replay guard's match key, and the rewind/fork target |
| `isReplay: true` | **yes** | the guard only applies to replays; a plain stream row is untouched |
| `session_id: string` | no | Forge tracks the session on `Session`, from `system/init`; a per-row copy adds nothing |
| `parent_tool_use_id: string \| null` | **yes** | already read by `rewindTargets` to skip a subagent's messages |
| `tool_use_result?: unknown` | partly | Forge reads `toolUseResult` (the loader's name) when attaching a tool result; the SDK's snake_case twin on a replay row is not read. Recorded as a gap, not built: no in-scope row needs it. |
| `priority?: 'now' \| 'next' \| 'later'` | no | queued-input ordering; Forge appends replays rather than placing them (see "Not ported" above) |
| `origin?: SDKMessageOrigin` | no | peer / remote origins; Remote Control is out of scope |
| `timestamp?: string` | yes | `Message.fromRaw` reads it for the picker's relative time |
| `file_attachments?: unknown[]` | no | untyped in the SDK (`unknown[]`); Forge renders attachments from the message content blocks instead |

### `enableFileCheckpointing` (sdk.d.ts:1605) and what sits around it

| Option | Forge surfaces | Why |
| --- | --- | --- |
| `enableFileCheckpointing?: boolean` | **yes — `true`, always** | `ClaudeSdkService.query()`. `rewindFiles` is a no-op without it, and the official has no toggle for it. |
| `fallbackModel?: string` (1596, the option immediately before) | no | model selection, group 4, and not part of this feature |
| `toolConfig?: ToolConfig` (1616, immediately after) | no | per-tool configuration; no row in scope asks for it |
| `forkSession?: boolean` (1621, the resume option) | no — **step 25** | it forks *on resume*, a different mechanism from `forkSession()`; covered in step 25's table |

## Gates

- `pnpm test`: `Test Files 26 passed (26) · Tests 631 passed (631)` (no unhandled errors)
- `pnpm run typecheck:all`: `tsc --noEmit` and `vue-tsc -p src/webview/tsconfig.json --noEmit`, both clean, exit 0
- `pnpm run build`: exit 0 — output tail in the commit's run; `build` is
  `lint:forge && build:webview && build:extension`, `&&`-chained, so exit 0
  already implies `lint:brand`, `lint:tokens` and `lint:commands`.

## Oracle

Two passes, both at **800×900** with `--ref` the official `index.css`.

**The first (2026-09-19)** ran on the step-24 build and could only show that the
step moved nothing, because its dialogs were not mounted yet — confirmed rather
than assumed: `fg-rewind__`, `Code rewind successful` and the `p_1` string were
**absent from `main.js`**, Rolldown having dropped components nothing imported.

**The second (2026-09-20)** ran on the step-26 build, where they are mounted and
reachable, and completed the clicks this step had deferred.

### How the harness was driven without the Browser pane

The Browser-pane tool (`mcp__Claude_Browser__*`) was removed from the session by
an MCP reload, which is why this step and steps 25–26 were first written up with
their harness work outstanding. It was paid off by driving Chrome directly over
the DevTools Protocol instead: Chrome is installed, and Node 24 has a built-in
`WebSocket`, so `Runtime.evaluate`, `Input.dispatchMouseEvent` and
`Emulation.setDeviceMetricsOverride` give the same three things the pane gave —
evaluate in the page, dispatch **real** mouse input, and fix the viewport. The
clicks below are real `mousePressed`/`mouseReleased` pairs at measured
coordinates, not `element.click()`, except where noted.

One caution worth recording: a harness was already listening on port 8735 from
another worktree, serving a different build (1 909 943 bytes, none of this
group's markers). Measuring it would have produced confident nonsense. The pass
runs on **port 8741**, whose `/main.js` was byte-compared with `dist/media/main.js`
first.

| Window (root selector) | Baseline | Measured | Structural diffs |
| --- | --- | --- | --- |
| `.fg-dialog__overlay` — the `mo` confirm dialog, "Rewind code" with changes | new | **20/20** | **0** |
| `.fg-dialog__overlay` — the `yH0` "Rewind to…" picker | new | **21/21** | **0** |
| `.fg-composer__inputWrapper` (idle, Sonnet) | 30/33 | **30/33** | 1 — `fg-footer__sendIcon > path` opacity `0.35` vs `1`, the send sparks, by design |
| `.fg-shell__header` | 15/15 | **15/15** | 0 |
| `.fg-menu__menuPopup` (Modes menu) | 41/41 | **41/41** | 0 |
| `.fg-commandmenu__menuPopup` (model menu, Sonnet) | 53/73 | **53/73** | 4 — the four `fg-modelmenu__modelLabel` chips, the user's design change |
| `.fg-sessionsdropdown__dropdown` (4 rows) | 43/43 at 3 rows | **57/57** | 0 — 14 elements per row, so 43 → 57 is the same structure with one more row |
| `.fg-sessionsdropdown__dropdown` (4 rows, one unread) | 44/44 at 3 rows | **58/58** | 0 |

### What the dialogs actually showed

| Case | Dialog |
| --- | --- |
| Rewind-only on a message **with** changes | title "Rewind code", no fork note, the file list, primary **"Rewind"** enabled |
| Rewind-only on a message with **no** changes | title "Rewind code", "The code **has not changed**…", primary **disabled** — the official's `B = canRewind && !loading && (hasChanges \|\| willFork)` |
| Fork-and-rewind on that same message | title **"Fork and rewind"**, the fork note, primary **"Continue" enabled** — because `willForkAfter` makes a no-change rewind worth doing |
| A checkpoint that errors | `.fg-changes__error` "No file checkpoint found", primary disabled |
| Every case | the `.fg-changes__warning` line with its `.fg-changes__warningIcon` (the ported `D21`) |

### Requests recorded

| Click | `__forgeSent` |
| --- | --- |
| Open the dialog | `{type:"rewind_code",userMessageId:"1111…0001",dryRun:true}` |
| Confirm | `{type:"rewind_code",userMessageId:"1111…0001"}` — **no `dryRun` key at all**, which is the step file's "`dryRun:false`" claim disproved in the harness as well as in the spec |
| "Never mind" | nothing further |
| Bad uuid / non-boolean `dryRun`, driven at the host | `{type:"rewind_code_response",canRewind:false}`, `refused:true` in `__forgeRewindLog`, `rewindFiles` never reached |


## Specs added

`test/rewindCode.spec.ts` (42 cases) —

- **the validator**: `validMessageUuid` accepts both cases and refuses 15 shapes
  (empty, whitespace, `../../etc/passwd`, a uuid with a traversal suffix, a NUL,
  a trailing space, one char short, one char long, numbers, `null`, `undefined`,
  objects, arrays, booleans); `planRewindCode` on a bare uuid, `dryRun` true /
  false / explicitly `undefined`, six bad `dryRun` values, three bad ids and four
  non-object requests;
- **the forwarding**: the five fields, `error` never present, zeroes kept
  (`insertions: 0` is a real count, not an absent key);
- **the host**: the id and `dryRun` reaching `rewindFiles` verbatim, the real
  run's `{dryRun: undefined}`, `result.error` rejecting, `requireChannel`
  throwing for an unknown and an absent channel, a bad id refused **before** the
  channel lookup and without calling the SDK;
- **the ported helpers**: `TR` at 0 / undefined / 1 / 3, `VU0` on both
  separators and on a path outside the cwd and with no cwd, `mo`'s enable rule
  in six states, `yH0`'s list (order, resume points, synthetic / subagent /
  uuid-less / empty rows skipped, trimming, walking back past uuid-less rows),
  and `I85`'s eight thresholds;
- **the transport and session**: the channel id on the wire, the `dryRun` key
  present-but-undefined, `Session.rewindCode` throwing without a connection and
  **separately** without a channel, `showNotification` routing, and
  `insertMetaMessage` appending a non-empty `meta` row with a fresh uuid.

- **the uuid work**: `buildUserMessage` minting a fresh uuid per message and
  carrying it onto the row; the replay guard dropping an echo already on screen,
  keeping a replay the webview never sent, keeping a uuid-less replay, leaving
  non-replay rows alone, and still attaching a `tool_result` carried by a dropped
  echo; `convertMessage` on both row types, through `Message.fromRaw`, with the
  meta / system / attachment drops intact; and `forgeBaseCliArgs` asserted
  **as exported** (so deleting the flag in `ClaudeSdkService` fails the spec),
  plus the flag surviving the gate and still being disableable.

**Mutation check, part 1 — 18 deliberate breaks, 18 caught:** uuid check removed;
`dryRun` type check removed; `undefined` `dryRun` refused; `error` forwarded
instead of thrown; zero counts dropped; host stops throwing `result.error`; host
validates after `requireChannel`; `TR` singular/plural swapped; `VU0` keeps the
separator; confirm rule drops `willForkAfter`; confirm rule ignores the loading
flag; picker list not reversed; picker keeps synthetic rows; picker keeps
subagent rows; `I85` threshold off by one; transport drops the channel id;
session stops requiring a channel; meta row loses its uuid.

(The seventeenth was **missed** on the first run — the spec only proved the
"no connection" half of `Session.rewindCode`'s guard. A case with a connection
but no channel was added, and it is caught.)

**Mutation check, part 2 (the uuid work) — 7 deliberate breaks, 7 caught:**
user message loses its minted uuid; replay guard removed; replay guard drops
uuid-less replays too; replay guard applied to normal messages too; user row
uuid back into `session_id`; assistant row uuid overwritten by the API message
id; `replay-user-messages` dropped from the base map.

## Rows deliberately left out and why

| Row | Reason |
| --- | --- |
| The `rewind` registry row | Moved to step 25 by the user's decision: the official row rewinds **and forks**, so its backend is not complete until `fork_conversation` exists. B4. |
| `message_rated` / the thumbs (`WU0`) | `out-of-scope.md`. It is the next function after `HU0` in the bundle, so it was read past while extracting this step; not built. |
| A Forge setting for file checkpointing | The official has none, and the user chose "always on". A setting would also have to hide the Rewind row when off (B4), which is more surface than the feature. |
| The composer's inline error line | The official routes `onRewindError` to `setInputError`, which renders in a composer error surface Forge has not ported (`.fg-chat__errorMessage` / `.fg-chat__errorDismiss` exist in the ported CSS but nothing renders them). Forge routes it to `showNotification` instead — a **deviation**, recorded here rather than hidden, and revertible by porting that surface in a later step. |
| The official's replay **placement** (`replayInsertIndex`, `localTurnStarted`, `turnHadToolRound`, `foldedIntoTurn`) | Ported the uuid guard, not the placement. Forge appends a replayed message the webview never sent; the official inserts it at the replay index unless the local turn has started. Nothing duplicates either way — that is what the uuid guard prevents — so this is ordering, not correctness. A scope note the user can turn into its own step. |

## Pre-existing issues found (not fixed here)

- The composer error surface above: `.fg-chat__errorMessage` and
  `.fg-chat__errorDismiss` are ported but dead. It predates this step.
- The open items from steps 16–23 are unchanged.

## VS Code checklist for the user (unverified — the harness cannot prove the CLI side)

**This step's whole point is files on disk, and that is CLI-side.** The harness
proves the webview↔host contract only. Nothing below has been observed.

1. Open a conversation, ask Claude to edit `a.txt`, and let it finish. Note the
   file's contents. **Expected:** the CLI wrote a checkpoint because the session
   launched with `enableFileCheckpointing: true`.
2. Run "/" → Rewind (available after step 25), choose the message before that
   edit, and read the dialog. **Expected:** it names `a.txt` **relative to the
   workspace root**, and the counts match what the edit did.
3. Confirm. **Expected:** `a.txt` is back to its previous content on disk, and a
   one-line "Code rewind successful" note appears in the transcript.
4. Repeat on a repo where one tracked file is a symlink. **Expected:** the note
   instead reads "Code rewind completed, but 1 file was skipped: the tracked
   path is (or became) a link…", and a warning notification says the same.
5. Check disk cost on a large repo after a long session. **Expected:** the CLI's
   checkpoint backups exist; this is the price of always-on checkpointing, and
   the point at which to come back and ask for a setting if it is too high.
6. **The uuid work, which only the real CLI can confirm.** Send a prompt in a
   live session. **Expected:** it appears **once**, not twice — the CLI's echo
   carries the uuid the webview minted, and the guard drops it. If you ever see
   a prompt doubled, that is this change and the flag is the thing to remove.
7. Close the conversation, reopen it from "Past conversations", and open "/" →
   Rewind. **Expected:** every past prompt is listed. Before this step the list
   would have been empty, because the loader threw the uuids away.
8. Ask Claude to run something that injects a message (a `UserPromptSubmit`
   hook, or queue a second prompt while a turn runs). **Expected:** that message
   now appears in the transcript. It was invisible before the flag. Its
   **position** may differ from the official's, which inserts it at the replay
   index while Forge appends it — that is the one piece deliberately not ported.
