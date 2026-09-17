# Group report template (B9)

Copy this into `docs/backend-wiring/results/<group>.md` at each checkpoint. Never
round a partial result up to "works". A row is "works" only if it was clicked in
the harness **and** its behaviour was verified (B7).

## Results

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| … | `{type:"…", …}` | response or error, plus the effect on disk or CLI | state change; menu stays open or closes | works / partial / broken |

**Counts:** works __ · partial __ · broken __ · left out __

## Gates (paste the output tail of each)
- `pnpm test`:
- `pnpm run typecheck:all`:
- `pnpm run build` (lint:brand, lint:tokens, lint:commands):

## Oracle
| Window (root selector) | Structural diffs | Colour diffs (expected, brand) |
| --- | --- | --- |

## Specs added
- `test/<name>.spec.ts`: the cases covered, including rejections

## Rows deliberately left out and why
Copy the relevant rows from `out-of-scope.md`, plus any row hidden because the
current model or session doesn't support it.

## VS Code checklist for the user (unverified until the user runs it)
1. Step. **Expected:** the exact file, setting or session change.
2. …
