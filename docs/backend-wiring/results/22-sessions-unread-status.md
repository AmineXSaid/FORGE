# Step 22: Unread and status dot — results

Wires `set_session_unread` and the `session_states_update` feed, ports the
official status dot (`vG`), and deletes Forge's own `~/.forge.json` unread.

## What the bundle actually says

Extracted with `extract-protocol.mjs` where it applies, and by byte offset for
the pushes (the extractor assumes webview→host, so it reports 0 sites for a host
push — noted in the skill's limits below).

| Piece | Source | Code |
| --- | --- | --- |
| Sender | `index.js` | `setSessionUnread($,J){return this.sendRequest({type:"set_session_unread",sessionKey:$,unread:J})}` |
| Base dispatcher | `extension.js` | `case"set_session_unread":return{type:"set_session_unread_response"}` |
| Subclass | `extension.js` | `else if($.request.type==="set_session_unread")return this.onSetSessionUnread?.($.request.sessionKey,$.request.unread),{type:"set_session_unread_response"}` |
| Host push | `extension.js` | `sendSessionStates($,Q,X,J,Y){…request:{type:"session_states_update",sessions:$,activeSessionId:Q,openSessionIds:X,unreadSessionKeys:J,liveElsewhereSessions:Y}}` |
| Receiver | `index.js` | assigns `sessions` / `activeSessionId` always; `openSessionIds`, `unreadSessionKeys`, `liveElsewhereSessions` **only when `!==void 0`** |
| Key | `index.js` | `function c$($,J){if(!$)return;return J?`remote:${$}`:$}` |
| Membership | `index.js` | `function SF1($,J,Z,Y){if(!Y)return!1;…}` (own key, or the remote key it was teleported from) |
| State | `index.js` | `function lH0($,J,Z,Y,X){if(!$&&X===void 0)return Y?"unread":void 0;let Q=$?Z:X==="waiting",G=$?J:X==="running";if(Q)return"waiting";if(G)return"running";return Y?"unread":"idle"}` |
| Dot | `index.js` | `function vG({state:$,ring:J=!1,title:Z,className:Y}){return F("span",{className:…,"data-status-dot":$,title:Z})}` |
| Row | `index.js` | `T&&F(vG,{state:T,ring:E!==void 0&&T!=="unread",title:dH0(T,E)})` — **first child** of the row button |
| Store | `extension.js` | `sessionUnread:<scope root>` in `globalState`; key is `bJ()` = a 1..200 char string; `TS=500` keys, oldest evicted |
| Scope root | `extension.js` | `A7$($)` strips a trailing `/.claude/worktrees/<name>`, so a worktree shares the main checkout's list |

### Three step-file claims corrected

1. **"The host derives working and needs-input from live channels."** It does
   not. The host sends only `openSessionIds` / `unreadSessionKeys` /
   `liveElsewhereSessions`; the **webview** derives the state in `lH0` from the
   session's own `busy` / `pendingInput`. Raised with the user, who chose
   "follow the bundle".
2. **"All four dots render."** Five states exist in the class map
   (`running`, `waiting`, `idle`, `unread`, `failed`) but `lH0` never returns
   `failed`, and the `statusDotElsewhere` ring needs a second surface Forge does
   not have. Four are reachable in Forge.
3. **"Opening an unread session clears it"** is only half the trigger set. The
   official's automatic rule is *visibility*-driven: a turn finishing while the
   webview is **hidden** marks the active conversation unread; the webview
   becoming **visible** marks it read. The manual toggle is a context-menu row.

## Results

> **Harness pass done on 2026-09-19**, at the start of the steps 24–27 session,
> on the step-23 tree built from `c4d34a2` (`dist/media/main.js` 1 905 183 bytes,
> confirmed to contain `set_session_unread` and `gitBranch` and **not**
> `rewind_code`). Every row below was either clicked in `?mockSessions` with its
> request read back out of `__forgeSent`, or driven as an explicit payload; the
> two rows that cannot be clicked are labelled for what they are. The verdicts
> are no longer provisional.

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| Mark as unread (row action) | `{type:"set_session_unread",sessionKey:"aaaaaaaa-0000-4000-8000-000000000001",unread:true}` | `__forgeUnreadLog` `changed:true`; key written to `forge.mock.unreadSessionKeys`; feed rebroadcast | row gains `fg-statusdot__statusDot fg-statusdot__statusDotUnread`, `title="Unread"`; title flips to "Mark as read"; **dropdown stays open** | works |
| Mark as read (row action) | `{type:"set_session_unread",…,unread:false}` | `changed:true`; key removed; feed rebroadcast | dot element gone; dropdown stays open | works |
| Open an unread row | **none** | — | conversation opens, dropdown closes, **the dot stays** | works — *see the correction below; the earlier claim that this sends `unread:false` was wrong* |
| Turn finishes while hidden | `{type:"set_session_unread",…,unread:true}` | key appended | row shows `unread` | spec-verified (`test/sessionUnread.spec.ts`); not clickable — the harness pane cannot be hidden while a stub turn runs |
| Webview becomes visible | `{type:"set_session_unread",…,unread:false}` | key removed | dot clears | spec-verified; same reason |
| Feed not ready | — | nothing sent; `reportActiveSessionUnread` answers `"feed_not_ready"` | no dot at all | works — before any feed arrives every row rendered `<!---->` in the dot slot |
| Feed pushed without `unreadSessionKeys` | `{type:"session_states_update",sessions:[],openSessionIds:[]}` | — | the dot **survives**: the receiver only assigns a feed when `!== undefined` | works |
| Reload with a mark set | none on load (0 `set_session_unread` sent) | the mark is in the host store | the dot is re-rendered from the feed | works |
| Repeat the same mark | `{type:"set_session_unread",…,unread:true}` on an already-unread key | `changed:false`; **no** rebroadcast; nothing written | nothing changes | works |
| Bad key / non-boolean | `{type:"set_session_unread",sessionKey:"",unread:"yes"}` | refused, `changed:false`, nothing written, bare response | nothing changes | works |

**Counts:** works 8 · spec-verified only 2 · partial 0 · broken 0 · left out 4 (below)

### Correction: opening a conversation does **not** clear unread

The earlier table claimed the row action "Open an unread row" sends
`unread:false`. The harness shows it sends nothing, and the bundle says it
should send nothing. Every `setSessionUnread` call site in `index.js` is one of
four: the transport method (`@3322067`), `SessionStore.setSessionUnread`
(`@3560470`), `reportActiveSessionUnread` (`@3560158`, the visibility effect),
and the list's bulk callback `s=H0((Y0,d0)=>{for(let v0 of Y0)$.setSessionUnread(v0,d0)})`
(`@5209046`, the manual mark). Nothing in the open path touches unread, and
Forge's ported effect only clears on `visible && hasUnseenCompletion`. **Forge's
code was right and the results row was an untested assumption** — this is a docs
fix, not a code change. The file's own "Three step-file claims corrected" §3
already said as much; the table contradicted it.

Two rows were driven as explicit payloads through `acquireVsCodeApi().postMessage`
rather than by a click, because no control can produce them: the repeat mark and
the bad payload. Those two exercise the **mock host's** port of the rule; the
real host's copy is covered by `test/sessionUnread.spec.ts` and its mutation run.

## SDK surface

Unread is **not an SDK concept**. `@anthropic-ai/claude-agent-sdk@0.3.274`
exposes nothing for it: there is no unread field on `SDKSessionInfo`, no option
on `ListSessionsOptions` / `GetSessionInfoOptions` / `SessionMutationOptions`,
and nothing on `Query`. The official keeps it entirely in the extension's
`globalState`, and so does Forge. Checked by `--sdk` search for `unread`,
`sessionKey` and `states`: no matches outside unrelated symbols.

`SDKSessionInfo` fields as they stand after step 20 (which put the lister on the
SDK), with where each one surfaces:

| Field | Surfaced | Where / why not |
| --- | --- | --- |
| `sessionId` | yes | row id, unread key, permission-mode key |
| `lastModified` | yes | row sort and the relative time |
| `summary` | yes | row title (`kR`) |
| `customTitle` | yes | step 20; wins over `summary` |
| `firstPrompt` | yes | falls back into `summary` as the SDK's `Nu` does |
| `gitBranch` | yes | step 23's filter |
| `cwd` | yes | drives `worktree` and `isCurrentWorkspace` |
| `fileSize` | yes | carried on the row and `Session.fileSize` |
| `createdAt` | yes | carried on the row |
| `tag` | yes | carried on `Session.tag` (`tagSession` itself is not in scope) |

## Gates

- `pnpm test`: `Test Files 25 passed (25) · Tests 574 passed (574)` (no unhandled errors)
- `pnpm run typecheck:all`: `tsc --noEmit` and `vue-tsc -p src/webview/tsconfig.json --noEmit`, both clean
- `pnpm run build`: **exit 0** on exactly this step's tree:

      $ tsx esbuild.ts --production
      [watch] build started
      [watch] build finished
      exit=0

  Note for later steps: the build takes ~17 minutes, and the profile says why —
  `vite:svg-icons load (99%, 1031.7s, 3927 calls)` and
  `@tailwindcss/vite:generate:build transform (90%, 938.2s, 63 calls)`. That is
  a build-tooling problem, not a Forge one, but it dominates every gate run.

## Outstanding

Nothing. Both items are closed:

1. ~~`pnpm run build` to completion on the step-23 tree.~~ **Done** — a clean
   run on the final committed tree exited 0, and `lint:brand` / `lint:tokens` /
   `lint:commands` were run on their own and reported clean. See
   [23-sessions-branch-search.md](23-sessions-branch-search.md#gates).
2. ~~Harness pass with `--ref`, on `?mockSessions`.~~ **Done 2026-09-19** — see
   the Results table and the Oracle section. The sessions-dropdown baseline is
   now recorded (it had never been captured), every clickable row was clicked,
   and the parity baselines were re-measured unchanged.

## Oracle

Run with `harness.mjs --port 8735 --ref …/webview/index.css`, page
`/index.html?mockSessions`, viewport **800×900**. Stylesheets parsed:
`[1, 5, 9823]` = 9 829 rules; the probe matched 2 557 official rules.

| Window (root selector) | Structural diffs | Colour diffs (expected, brand) |
| --- | --- | --- |
| Sessions dropdown, rows listed, no dot (`.fg-sessionsdropdown__dropdown`) | **0** (43 checked / 43 clean) | 4 |
| Sessions dropdown, one row unread (dot rendered) | **0** (44 / 44) | 5 |
| Sessions dropdown, loading state (`__forgeListDelayMs=4000`, spinner + "Loading sessions…") | **0** (44 / 44) | 5 |

`classesNotInOfficialCss: []`, `missingTwin: 0`, `truncated: false` on all three.
`modulesWithoutHash: ["wordmark"]` is the Forge logo module and is expected.

**This is the sessions-dropdown-with-rows baseline** the later steps compare
against: **43/43 plain, 44/44 with a status dot.**

### Parity baselines re-measured on this tree (all unchanged)

| Root | Baseline | Measured |
| --- | --- | --- |
| `.fg-composer__inputWrapper` (idle, Sonnet) | 30/33 | **30/33** — the 3 are `fg-footer__sendIcon > path` opacity `0.35` vs `1`, the send sparks, by design |
| `.fg-menu__menuPopup` (Modes menu) | 41/41 | **41/41** |
| `.fg-commandmenu__menuPopup` (model menu, Sonnet) | 53/73 | **53/73** |
| `.fg-commandmenu__menuPopup` ("/" menu, Sonnet) | 79/79 | **79/79** (14 rows) |
| `.fg-shell__header` | 15/15 | **15/15** |

The permission prompt, the "Permission rules" dialog, the plan preview and
`.fg-markdown__root` need their own seeding and are untouched by steps 22–23;
they are re-measured in the group-5 checkpoint
([05-conversations.md](05-conversations.md)).

## Specs added

`test/sessionUnread.spec.ts` — the host store (scope root incl. worktree
stripping, the key, `bJ()` bounds at 0/1/200/201 and non-strings, junk and
duplicate filtering, add / remove / no-op, bad key and non-boolean rejection,
500-key eviction oldest-first, `remote:` round-trip), the handler (write +
rebroadcast, no rebroadcast when unchanged, seven rejection payloads, a throwing
store logged not surfaced), the dispatcher case, `getOpenSessionIds` dedupe and
the `sendSessionStates` shape, the ported pure functions (`c$`, `SF1` incl. the
teleport origin, the full `lH0` truth table, `dH0`), the transport (payload,
both feeds starting undefined, partial pushes not clearing a feed, an empty list
being a real answer), and `SessionStore` (`reportActiveSessionUnread`'s four
outcomes, the visibility effect in all four directions, the retry once the feed
lands, a failed write logged not thrown).

**Mutation check — 12 deliberate breaks, 12 caught:** no-op guard removed;
boolean check removed; key-length check removed; worktree stripping removed;
unconditional rebroadcast; `waiting`/`running` order swapped; closed-session
branch removed; remote prefix dropped; unconditional feed assignment;
`sessionIdFromCli` guard removed; feed-readiness guard removed; effect marking
unread while visible.

## Rows deliberately left out and why

| Row | Reason |
| --- | --- |
| `liveElsewhereSessions` / the `statusDotElsewhere` ring | Needs a second surface (another window, terminal, Claude Desktop). Forge is one webview; the official's own receiver ignores the field when absent, so this is the official's no-second-surface behaviour. |
| `sessions` (the per-tab state list) and `activeSessionId` | The official's session **tabs**. Forge has no session tabs; `update_session_state` and the tab badge are the multi-surface half of this step. |
| `statusDotFailed` | In the official's class map, but `lH0` never returns `failed`. Shipping the class without a producer would be a row with no backend (rule 7). |
| Session groups, multi-select, "Add to group" | `out-of-scope.md`; they are the rest of the context menu the unread row lives in. |

## Scope note the user can revert

The official's manual toggle is a **context-menu row** (`mH0`). Forge's dropdown
has no context menu, and porting one would drag in multi-select and groups. On
the user's decision the toggle is a **row action button** beside Rename and
Archive, using `UnreadIcon.vue` — heroicons `envelope`, the same family and
metrics as the ported `ArchiveIcon`, but **not an official glyph**. One icon for
both directions, with only the title flipping, mirrors the official's single
menu row. Revert by deleting the button block in `SessionsDropdown.vue` and
`SessionsPage.vue` and the icon; the dot and both automatic triggers are
untouched by that.

## Pre-existing issues found (not fixed here)

- `test/persistPermissionMode.spec.ts` was **failing on this branch** before I
  started: `ddca50c` made `handleInit` call `agentService.sendSessionStates()`,
  and that spec's fake `agentService` had no such method. Fixed by completing
  the fake (one line), since the real service always has it.
- Step 21 never wired the `session_archive_changed` push into the webview; a
  single-window Forge updates its own store, so nothing is broken, but a second
  surface would not see archives.
- The other open items from steps 16–19 are unchanged.

## VS Code checklist for the user (unverified — the harness cannot prove the CLI side)

1. Open a conversation, send a prompt, and hide the Forge view before the turn
   finishes. **Expected:** when you reopen the view, that row carried an unread
   dot, and showing the view clears it.
2. In the dropdown, click the envelope on any row. **Expected:** the row gains
   an unread dot; the title flips to "Mark as read"; the dropdown stays open.
3. Reload the window. **Expected:** the unread dot is still there — it is in
   `globalState`, not in the webview.
4. Open the same repo from a `.claude/worktrees/<name>` checkout. **Expected:**
   the same unread list, because `A7$` strips the worktree segment.
5. Confirm `~/.forge.json` no longer gains an `unreadSessionIds` key.
