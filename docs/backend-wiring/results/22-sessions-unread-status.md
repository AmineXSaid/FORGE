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

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| Mark as unread (row action) | `{type:"set_session_unread",sessionKey,unread:true}` | key appended to `sessionUnread:<root>`; `session_states_update` rebroadcast | unread dot appears on the row; dropdown stays open | works |
| Mark as read (row action) | `{type:"set_session_unread",sessionKey,unread:false}` | key removed; feed rebroadcast | dot clears (or becomes `idle` when the session is open) | works |
| Open an unread row | `{type:"set_session_unread",…,unread:false}` | key removed; feed rebroadcast | dot clears, conversation opens | works |
| Turn finishes while hidden | `{type:"set_session_unread",…,unread:true}` | key appended | row shows `unread` | works |
| Webview becomes visible | `{type:"set_session_unread",…,unread:false}` | key removed | dot clears | works |
| Feed not ready | — | nothing sent; `reportActiveSessionUnread` answers `"feed_not_ready"`, retried when the feed lands | no dot rendered at all | works |
| Repeat the same mark | `{type:"set_session_unread",…}` | store returns `false`; **no** rebroadcast | nothing changes | works |
| Bad key / non-boolean | `{type:"set_session_unread",sessionKey:"",unread:"yes"}` | refused; nothing written; bare response | nothing changes | works |

**Counts:** works 8 · partial 0 · broken 0 · left out 3 (below)

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
