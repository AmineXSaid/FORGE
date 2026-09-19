# Step 21: Archive / Unarchive

**Group:** 5  **Depends on:** 20

## Official
- Row actions: `H21` (archive) and `B21` (unarchive) icons.
  **Both are heroicons-style wrappers** (`H21 = k0(Ww0)`, `B21 = k0(Pw0)`), not
  the inline-`<svg>` component form `extract-icons.mjs` reads — it reports
  "no drawable children". They are copied out by hand instead, attribute for
  attribute. `H21` is a **trash** glyph and `B21` an **arrow-uturn-left**.
- `{type:"archive_session"|"unarchive_session", sessionId}`, stored in extension settings.
  Both answer a **bare response** (`{type:"archive_session_response"}`) and never
  error: `if(y0($)===null) return {type:"…_response"}`.
- Archived rows go under an "Archived sessions" group header (`uF1`), which is
  the last thing in the list, **starts collapsed** (`zF.archivedCollapsed = !0`),
  and is **not collapsible while a search is active**
  (`onToggleCollapsed: V1 ? void 0 : …`, and `n = !V1 && k1.archivedCollapsed`,
  so a search always expands it).
- The header's chevron is `AF1` — a chevron pointing **right**, rotated 90° by
  `.groupChevronExpanded`.

## Storage (the official settings store)
- `hiddenSessionIds`: a deduped array in `globalState`.
- `sessionUnarchivedAt`: `{id: ms}` in `globalState`, pruned to the last
  **14 days** (`uA0=14`, `Hf$=86400000`) on every write. Written even when the id
  was not in `hiddenSessionIds`.

## Not built, and why
- **Auto-archive** (`archiveInactiveSessions`, `qf$`, `Nf$`, `sweepInactiveSessions`)
  — not in `CLAUDE.md`'s scope list (user decision).
- **Session groups** (`get_session_groups`, `update_session_groups`,
  `tY(getSessionGroups(), …)` inside `unarchiveSession`) — not in the scope list,
  so there is no group to prune the unarchived id out of.
- **`session_archive_changed`** — the official pushes it from
  `broadcastSessionArchiveChanged`, which sends **only to other webviews**
  (`if(!J.isChatSurface && J.comms!==$)`). Forge has one webview and no
  auto-archive sweep, so nothing would ever produce it. Left out rather than
  shipped dead (B4).
- **Multi-select archive** (`archiveSelection` in the context menu) — Forge's
  dropdown has no selection model, and the context menu is not in scope.

## Six places (B2) for both requests
- Handler: validate the id with `y0`, then store the set the way the official does.
- `test/archiveSession.spec.ts`: archive, unarchive, and bad-id rejection.

## Tasks
- [x] `list_sessions_response` carries the archived flag.
- [x] The dropdown gets the actions (hand-copied icons) and the group header.

## Validate
- [x] Gates pass.
- [x] Harness: archive moves the row under the header, and unarchive moves it
      back. Oracle: 0 structural diffs.

## VS Code checklist for the user
1. Archive a session and reload. **Expected:** it's still under "Archived sessions".
