# Step 35: Final report and VS Code checklist handover

**Depends on:** 06, 08, 10, 19, 27, 34

- [ ] Merge the six group reports into `docs/backend-wiring/results/final.md`
      using the B9 table (row | request | host result | UI effect | verdict), with counts.
- [ ] Add the "left out" section: the whole of `out-of-scope.md`, plus any rows
      hidden per model or session.
- [ ] Add the gate output (`pnpm test`, `typecheck:all`, `build`) and the per-window oracle summary.
- [ ] Add the full numbered VS Code checklist for the user. Each item is marked
      **unverified** until the user reports back. Never round a partial result up to "works".
