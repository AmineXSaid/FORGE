# Step 22: Unread and status dot

**Group:** 5  **Depends on:** 21

> **Corrected against the bundle while implementing.** Three claims below were
> wrong; each is marked and the real behaviour is given. See
> `results/22-sessions-unread-status.md` for the extracted source.

## Official

- `vG` is the dot, rendered as the **first child of the row button**, before the
  name span, and only when `openState` is defined:
  `T&&F(vG,{state:T,ring:E!==void 0&&T!=="unread",title:dH0(T,E)})`.
  It is one `<span>` with `data-status-dot` and the module's own classes
  (`statusDot_BIoFGQ` + a per-state modifier); no wrapper, no text.
- `{type:"set_session_unread", sessionKey, unread}`. `sessionKey` is
  `c$(sessionId, isRemote)` — the id, or `remote:<id>` — **not** a UUID. The
  host validates it as a 1..200 character string (`bJ()`).
- The host answers a bare `{type:"set_session_unread_response"}` in the base
  dispatcher; the webview-provider subclass does the work
  (`this.onSetSessionUnread?.($.request.sessionKey,$.request.unread)`), which
  writes `globalState` under `sessionUnread:<scope root>` and then
  `broadcastSessionStates()` — **only when the set actually changed**.
- The feed comes back as the `session_states_update` push
  (`sendSessionStates($,Q,X,J,Y)` → `{sessions, activeSessionId, openSessionIds,
  unreadSessionKeys, liveElsewhereSessions}`). The receiver assigns
  `openSessionIds` / `unreadSessionKeys` / `liveElsewhereSessions` **only when
  the push carries them**, so a partial update never clears a feed.

## Today

`SessionsPage.vue` tracks unread locally (`loadUnread` / `toggleUnread`) in
`~/.forge.json` under `unreadSessionIds`.

## Six places (B2)

- Handler: validate `sessionKey` and that `unread` is a boolean; store the way
  the official does.
- `test/sessionUnread.spec.ts`.

## Tasks

- [x] Move unread tracking to the host, and delete the local version.
- [x] ~~The host derives working and needs-input from live channels (busy,
      pending permission) and pushes updates.~~
      **Wrong — the bundle does the opposite.** The host supplies only
      `openSessionIds`, `unreadSessionKeys` and `liveElsewhereSessions`. The
      **webview** derives the state, in `lH0`, from the session's own `busy` and
      `pendingInput` signals:

          function lH0($,J,Z,Y,X){
            if(!$&&X===void 0) return Y?"unread":void 0;
            let Q=$?Z:X==="waiting", G=$?J:X==="running";
            if(Q) return "waiting";
            if(G) return "running";
            return Y?"unread":"idle" }

      Confirmed with the user before implementing: follow the bundle.
- [x] Use the same unread and read triggers as the official. Port `vG`.

### The triggers, as the bundle has them

There are two, and neither is "opening a session clears it" on its own:

1. **Automatic**, in an effect over the active session: a turn that finishes
   **while the webview is hidden** marks it unread; the webview **becoming
   visible** marks it read. `reportActiveSessionUnread` refuses unless
   `sessionIdFromCli` is set, and answers `"feed_not_ready"` (retried later)
   while `unreadSessionKeys` is still undefined.
2. **Manual**: a "Mark as unread" / "Mark as read" row in the row **context
   menu** (`mH0`) — a menu that also carries multi-select, groups and "Add to
   group", all out of scope. Forge has no context menu, so by the user's
   decision this became a row action button beside Rename and Archive.

## Validate

- [x] Gates pass.
- [x] Harness: seed each state. ~~All four dots render.~~ **Four states are
      reachable in Forge** (`unread`, `idle`, `running`, `waiting`); `failed` is
      in the official's class map but `lH0` never returns it, and the
      `statusDotElsewhere` ring needs a second surface Forge does not have.
      Opening an unread session clears it and sends the request. Oracle: 0
      structural diffs.

## VS Code checklist for the user

1. Run a turn in tab A while viewing tab B. **Expected:** A shows working, then
   unread. Opening A clears it.
   *(Forge is a single webview, so the equivalent is: start a turn, hide the
   Forge view, let the turn finish, reopen — the row shows the unread dot until
   the view becomes visible.)*
