# Step 18: `persist_session_permission_mode`

Group 4, eighth step. Before this step, every conversation opened in Manual, whatever
mode it was left in. Settings › General › "Default Permission Mode" ("Permission mode
for new sessions") was saved but nothing read it.

## What the bundle says, and where the step file was wrong

Host (`extension.js`), the request and the settings store `C1$`:

```js
async persistSessionPermissionMode($,Q,X,J){ let Y=y0($); if(!Y) return {type:"persist_session_permission_mode_response"};
  let z=X?y0(X):null, K=Q==="bypassPermissions"&&!(J===!0&&z!==null&&z!==Y)&&!this.bypassPersistGateOpen();
  if(K&&!(z&&z!==Y)) return {...};
  if(z&&z!==Y){ if(J) return await this.settings.moveSessionPermissionMode(z,Y,{bypassBarredByHost:!this.bypassPersistGateOpen()}),{...};
                if(await this.settings.clearSessionPermissionMode(z),K) return {...}; pH(Q)?set(Y,Q):clear(Y); return {...} }
  pH(Q)?set(Y,Q):clear(Y); return {...} }
// zo$ = ["default","acceptEdits","auto","bypassPermissions"]; pH = zo$.includes
// key "sessionPermissionMode:"+id, value {mode, updatedAt}; Cl$: finite updatedAt <= now+1 day, pH(mode)
// gatedSessionMode: <= 30 days old (El$), bypass only if allowed; prune to 200 (Il$)
// list_sessions: U.permissionMode = getSessionPermissionModes()[U.id], bypass skipped when disableBypassPermissionsMode==="disable"
// getInitialPermissionMode(): setting initialPermissionMode ("manual"->"default") || globalState defaultPermissionMode; bypass -> default unless allowed
```

Webview (`index.js`), `SL1` (the session's `modePersist`) and the session:
`setPermissionMode(mode, push, userInitiated)` calls `deliberateCycle` then
`flushSessionModePersist`, and an effect flushes whenever the session id or
connection changes. `tryCommit` sends only when the intent needs it (accepted by
the CLI, applied by the launch, or privilege-reducing). `confirmCliSessionId` runs
on each `system/init` and moves the kept mode when the CLI replaces the id. A listed
session adopts `restorableSessionMode(summary)`, else `initialPermissionMode`. The
CLI's init overrules a restore it did not take.

**Where the step file was wrong.** Its checklist expected "A reopens in Plan". The
official never keeps Plan: plan and dontAsk *clear* the entry. The step file is
corrected ([18-persist-session-permission-mode.md](../18-persist-session-permission-mode.md)).

## Results

Harness (`?mockSessions`: two listed sessions; the stub host's store survives a
reload the way `globalState` survives a window reload).

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| Modes → Edit automatically, in listed session A (live CLI) | `set_permission_mode {mode:"acceptEdits", userInitiated:true}` → `success:true`, **then** `{type:"persist_session_permission_mode", sessionId:A, mode:"acceptEdits"}` | stored `sessionPermissionMode:A = {mode:"acceptEdits", updatedAt}` | footer **Edit automatically**; menu closes | works |
| Modes → Plan, in session B | `persist_session_permission_mode {sessionId:B, mode:"plan"}` **before** the push (lowers privilege, as the official), then `set_permission_mode` | B's entry cleared | footer **Plan** | works |
| switch A → B → A | none | — | A still Edit automatically | works |
| reload, reopen A | `list_sessions_response` row A has `permissionMode:"acceptEdits"`; `launch_claude {resume:A, permissionMode:"acceptEdits"}`; no persist | — | footer **Edit automatically**; the CLI starts in it | works |
| reload, reopen B | `launch_claude {resume:B, permissionMode:"default"}` | — | footer **Manual** (Plan is never kept) | works |
| message in restored A → CLI init (same id) | none | — | mode unchanged | works |
| new conversation → Edit automatically → first message | push accepted, **nothing** persisted (no id yet); the CLI's init names it → `persist {sessionId:<new uuid>, mode:"acceptEdits"}` | stored under the new id | — | works |
| A: Edit automatically → Manual | `persist {sessionId:A, mode:"default"}` after the push is accepted | stored `default` | footer Manual | works |
| the CLI replaces A's id (init with a new `session_id`) | `persist {sessionId:<new>, mode:"default", previousSessionId:A, carriedFromStore:true}` | **moved**: A's key gone, the new key holds the mode | — | works |
| Settings › "Default Permission Mode" → Plan (the host's `extension_config_changed` broadcast) | the webview re-asks `init`; its `initialPermissionMode` becomes `plan` | — | New conversation → footer **Plan**, `launch_claude {permissionMode:"plan"}` | works |
| rejections | bad ids (`"abc"`, `"../../x"`, `42`, a UUID plus a space, an object), bad modes (`"yolo"`, `""`, `42`, `"toString"`, `"__proto__"`), bypass with the gate closed, `carriedFromStore:"yes"`, a bad `previousSessionId` | bare response; nothing written or cleared (the carried-`"yes"` case is a plain set) | — | works (spec) |

**Counts:** works 11 · partial 0 · broken 0 · left out 2 (below)

## Every SDK or host field this step touched

| API / field | Surfaced? | Where / why not |
| --- | --- | --- |
| `SDKSystemMessage` init `session_id` | yes | `confirmCliSessionId`: commits a pending pick, or moves a kept mode on a new id |
| `SDKSystemMessage` init `permissionMode` | yes | a restored mode gives way to what the CLI reports |
| `Options.permissionMode` (the launch) | yes | restored and initial modes reach the CLI through `launch_claude` |
| `Settings.permissions.disableBypassPermissionsMode` (`sdk.d.ts` L6416) | yes | `claudeSettings` snapshot: the host bypass gate, the list filter, and the webview's `restorableSessionMode` |
| `Query.getSettings()` (runtime only) | yes | kept on the host as `cachedClaudeSettings` (config probe, and after settings writes), as the official |
| `PermissionMode` `plan`, `dontAsk` | sent, not kept | the host clears the entry (official) |
| `PermissionMode` `auto` | no | Forge keeps Auto out (user decision, step 17): neither stored nor an initial mode |
| init `initialPermissionMode`, `allowDangerouslySkipPermissions` | yes | new sessions start in the first; a kept bypass is restored only with the second |
| `list_sessions` row `permissionMode` | yes | restore on open; reconcile on a refresh for sessions not yet launched |

## Changes

- `src/services/claude/sessionPermissionModes.ts` (new): the store (`C1$`: key, entry
  check `Cl$`, 30-day age, the 200-entry prune, the move with the official's re-reads),
  `y0`, `bypassPersistGateOpen`, the request logic, the list filter, and
  `initialPermissionModeFrom`.
- `ClaudeSdkService`: `getSessionPermissionModeStore()` over the extension's `globalState`.
- `ClaudeAgentService`: the `persist_session_permission_mode` case (no channel),
  `cachedClaudeSettings` (`noteClaudeSettings` / `getCachedClaudeSettings`, set by the
  config probe and every applied-settings read).
- `handlers.ts`: `list_sessions` attaches the modes; `init` returns
  `initialPermissionMode` and `allowDangerouslySkipPermissions`; the config probe
  caches the settings read.
- `claudeSettings.ts`: the snapshot carries `effective.permissions.disableBypassPermissionsMode`.
- `messages.ts`: the request and response, the list row's `permissionMode`, the two
  init fields, the snapshot field.
- Webview: `core/modePersist.ts` (new), a port of `SL1`, plus `restorableSessionMode`
  and `bypassGateDecidablyOpen`. `Session`: `modePersist`, the flush effect,
  `setPermissionMode` recording deliberate picks, `adoptPersistedSessionMode`,
  `reconcilePersistedSessionMode`, `confirmCliSessionId`, the init handling.
  `SessionStore`: the initial mode for new sessions (before they launch), restore and
  reconcile from the list. `BaseTransport`: `persistSessionPermissionMode`, the two
  init fields (also on `update_state`), and a fresh `init` read when "Default
  Permission Mode" changes.
- Harness mock host: `?mockSessions` (two listed sessions, a stub CLI that answers the
  first message with `system/init`), the store in `localStorage`, the request with
  the host's checks, `__forgePersisted`, `__forgeSessionModes`,
  `__forgeResetSessionModes`, `__forgeSetDefaultPermissionMode`. Without
  `?mockSessions` the list stays empty, so every other window's baseline is unchanged.

## Gates

- `pnpm test`: `Test Files 21 passed (21) · Tests 472 passed (472)`
- `pnpm run typecheck:all`: `tsc --noEmit` and `vue-tsc -p src/webview/tsconfig.json --noEmit`, both silent
- `pnpm run build`: `✓ built in 5m 35s` · exit 0. `Forge brand guardrail: clean (320 files scanned)` ·
  `Forge token check: clean (238 tokens used, 383 defined)` · `Forge command check: clean (20 commands, 13 references)`

## Oracle

No markup changed in this step; the affected windows were re-measured with sessions listed.

| Window (root selector) | Structural diffs | Note |
| --- | --- | --- |
| `.fg-composer__inputWrapper` (idle) | 3, **30/33** | = the design baseline (the sparks' opacity, `docs/forge-design.md`) |
| `.fg-menu__menuPopup` (Modes menu, session restored in Edit automatically) | **0**, 41/41 | = baseline (a first read mid-entrance showed the popup's `opacity: 0`; re-read after the animation: clean) |
| `.fg-shell__header` | **0**, 15/15 | = baseline |

## Specs added

`test/persistPermissionMode.spec.ts`, 44 cases. Negative controls: removing the
dispatcher case, the `pushResolved` call, the restore on the list, the
`confirmCliSessionId` call, the mode check, the list attachment, the transport's
`init` re-read, or the new-session initial mode each fails its spec.

- host: `y0` (11 bad ids, including path-traversal shapes); `Cl$` (the one-day skew,
  NaN, Infinity, string timestamps, plan / dontAsk / auto / junk modes); the key and
  value shape; read-back gating (stale, junk, bypass by the allow flag); the prune
  (junk, stale, 200 newest, the one being written kept, other keys untouched); the
  move, and a move with nothing live to move;
- the request: store; plan, dontAsk and auto clear; bad ids and bad modes change
  nothing; bypass needs the gate; a replaced id without carry-over clears the old
  one and sets the new; carry-over moves the *stored* mode; `carriedFromStore` must
  be `true`; a bad previous id is not a move; a carried bypass dropped while barred;
  a refused bypass on a replaced id still clears the old entry; the gate; the
  snapshot field;
- the dispatcher (no channel; bare response; the gate reads the cached settings);
  `list_sessions` (attached, bypass filtered by the settings and by the allow flag);
  `init` (`default`, `plan`, bypass gated both ways, junk omitted);
  `initialPermissionModeFrom`;
- webview `SL1`: commit only after the CLI accepts; refused not kept; no live CLI
  commits at once; leaving bypass and Plan commit before the answer; a swallowed flush
  re-offered; a failed commit restores the mirror and owes the old id; a replaced id
  clears (pending) or moves (kept); `restorableSessionMode`; `bypassGateDecidablyOpen`;
- `Session`: live pick kept after acceptance; a pick before launch kept at once and
  passed to the launch; Plan sent; refused and prompt answers not sent; a new
  conversation kept once the CLI names it; restore into the mode and the launch; the
  CLI's init overruling a restore; the id move;
- `SessionStore`: kept mode, else the initial mode, bypass not restored unless allowed;
  a new conversation starts in the initial mode before it launches; a refreshed list
  moves an unlaunched restore;
- transport: the official payload with no channel; the init fields; the `init`
  re-read on a "Default Permission Mode" change, and not on other keys.

## Deviations from the official, deliberate

1. **Auto is neither stored nor restored**, nor accepted as an initial mode: Forge
   keeps Auto out (the user's decision in step 17).
2. **The host is stricter with the webview (B3)**: a `mode` that is not a permission
   mode at all is ignored, where the official would clear the entry, and
   `carriedFromStore` must be exactly `true`, where the official moves on any truthy value.
3. **The initial mode's source.** The official reads `claudeCode.initialPermissionMode`
   (unset by default), then the last mode the user picked (`persistDefaultPermissionMode`
   in `globalState`). Forge's equivalent setting is Settings › General › "Default
   Permission Mode" (`~/.forge.json`), which always has a value (the extension
   config merges its defaults, and any settings write saves them). With the setting
   set, the official never reads the remembered pick, so Forge doesn't port that
   layer. As a result, "unset = the CLI decides" doesn't exist in Forge: new sessions
   start in the setting's mode (Manual by default), as before this step.
4. Forge's session mode is never unset, so where the official's `reconcilePersistedSessionMode`
   would clear the shown mode, Forge shows Manual.

## Left out, and why

1. **`persistDefaultPermissionMode`** (the official remembers a user-picked Manual,
   Edit automatically or Auto as the default for new sessions): unreachable in Forge,
   see deviation 3.
2. **The heuristic session-id adoption** (`adoptHeuristicSessionId`,
   `seedRestoredModeForHeuristicAdoption`, `sessionIdHeuristic`): the official uses
   it for panel tabs restored across a window reload before the CLI confirms the id.
   Forge has no such tab restore. Its session ids always come from the list or from
   the CLI.

Out of scope, unchanged: see the table in [16-permission-destination.md](16-permission-destination.md#rows-deliberately-left-out).

## Open issue

`~/.forge.json` gains every default key on the first settings write, so Forge can't
tell "never set" from "set to Default". A Settings option for "unset" (let the CLI
decide, as the official's default) would need a Settings-page change, so it belongs
with step 31 (Settings tabs).

## VS Code checklist for the user (**unverified**: not run against the real CLI)

1. In session A pick **Edit automatically**, send a message; in session B pick
   **Plan**. Reload the window (Developer: Reload Window) and reopen each from the
   sessions menu. **Expected:** A opens in Edit automatically and its first edit is
   applied without a prompt; B opens in Manual.
2. **Expected on disk:** Forge's `globalState` (VS Code's `state.vscdb` for the
   extension) holds `sessionPermissionMode:<A's id>` = `{"mode":"acceptEdits", …}`
   and no entry for B.
3. Settings › General › Default Permission Mode → **Accept Edits**, then New
   conversation. **Expected:** the new conversation shows Edit automatically.
4. In A, switch back to **Manual**, reload, reopen A. **Expected:** Manual.
