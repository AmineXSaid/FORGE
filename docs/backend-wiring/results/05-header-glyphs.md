# Results, step 05: Header glyphs (closed, re-measured only)

No code changed. The user's `d496deb` glyphs and order are kept on purpose
(see the step file). This is a re-measure on `dc98afd` (steps 03 and 04 applied),
harness `--port 8735` started from that build (checked: `window.__forgeSent`
is an array; stylesheets `[1, 5, 9819]`). Viewport emulated at 460×900, then 320×900.

## Official, for reference
`index.js` header: `x9 {ariaLabel:"Session history", iconSize:20} → En`, then
`x9 {ariaLabel:"New session", iconSize:20} → fX0`. Forge deliberately uses
New session, then Session history (user decision in `d496deb`).

## Measurements

| # | Check | 460px | 320px | Same as the `d496deb` record? |
| --- | --- | --- | --- | --- |
| H1 | Button order (DOM, left → right) | New session, Session history | New session, Session history | yes |
| H2 | New session box | x 394–422, 28×28 | x 254–282, 28×28 | yes (460 recorded) |
| H3 | Session history box | x 426–454, 28×28 | x 286–314, 28×28 | yes (460 recorded) |
| H4 | Glyph paths | New session `M12 3H5a2 2 0 0 0-2 2v14…` + `M18.375 2.625a1 1 0 0 1 3 3l-9.013…`; history `M3 12a9 9 0 1 0 9-9 9.75…`, `M3 3v5h5`, `M12 7v5l4 2` | same DOM | yes (the `d496deb` stroked glyphs, not reverted) |
| H5 | Oracle `.fg-shell__header` | 15 checked, 15 clean, **0 structural** | 15 checked, 15 clean, **0 structural** | yes |
| H6 | Sessions dropdown (click Session history) | `top: 38px; right: 16px`, x 44–444, width 400 | `top: 38px; right: 16px`, x 16–304, width 288, no overhang | yes |
| H7 | Oracle `.fg-sessionsdropdown__dropdown` (empty list from the mock host) | not run | 15 checked, 15 clean, **0 structural**, no unknown classes | — (not in the earlier record) |
| H8 | Click Session history again | dropdown closes | — | toggle works |

**Counts:** 8 checks · 7 match the earlier record or pass · 1 not run (H7 at 460px) · 0 differ.

## Gates
Not re-run for this step (no code change). The same tree was built and tested for
step 04: `pnpm test` 69 passed, `pnpm run typecheck:all` exit 0, `pnpm run build`
exit 0 with brand/tokens/commands clean.

## Open points for the user (unchanged)
- `CLAUDE.md` rule 4 still says header icons must be the extracted official
  glyphs; add an exception, or this step will be flagged again.
- The paths match Lucide's `history` and `square-pen` (ISC licence: keep its notice).
- The sessions dropdown was measured with an empty session list only (the mock host
  returns `sessions: []`); rows inside it were not measured here.

## VS Code checklist for the user (unverified)
1. Look at the panel header. **Expected:** New session (pen-in-square) on the left, Session history (clock) on the right.
2. Click Session history in a narrow sidebar (~320px). **Expected:** the dropdown opens under the header, 16px from both edges, without overhanging.
