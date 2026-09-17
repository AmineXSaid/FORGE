# Step 05: Header glyphs (superseded by the user's decision)

**Group:** 1 (Part A.5)  **Status:** closed, no work

## History
- The spec said the header used codicons. At `b6f21be` it didn't:
  `forge/icons/HistoryIcon.vue` (`En`) and `NewSessionIcon.vue` (`fX0`) were
  already extracted from the official bundle.
- Commit `d496deb` ("fixing webview", by the user) **deliberately** replaced them
  with stroked glyphs drawn to a reference image supplied for Forge, and swapped
  the order to **New session, then Session history**. The official `index.js`
  order is `Session history` (`En`), then `New session` (`fX0`).

## Decision
The user's reference wins for the Forge header. Don't revert to `En` / `fX0`
or to the official order.

## Measured on `d496deb` (harness, 460px)
- Header buttons: New session x 394–422, Session history x 426–454, both 28×28.
- Oracle `.fg-shell__header`: 15 checked, 15 clean, **0 structural diffs**.
- Because history is now the rightmost button, the sessions dropdown anchors
  `right:16px`: 44 → 444 at 460px and **16 → 304 at 320px** (it no longer overhangs).

## Open points for the user
- `CLAUDE.md` rule 4 still says header icons must be the extracted official
  glyphs. Add an exception there, or this step will be flagged again.
- The new paths are identical to Lucide's `history` and `square-pen` icons.
  Lucide is ISC-licensed, which asks for its copyright notice to be kept.
