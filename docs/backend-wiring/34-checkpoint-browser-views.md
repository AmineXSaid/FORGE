# Step 34: Checkpoint, group 6 report

**Depends on:** 28–33

- [x] Click the "+" menu and the whole "/" menu (every section, filter-only rows).
      Done 2026-10-03 with `drive-all.mjs --no-oracle`: 31 rows, works 28, paused 2, left out by model 1.
- [ ] Oracle: 0 structural diffs on each affected window.
      **Not run on 2026-10-03.** The official `webview/index.css` is not in the container and its public
      download hosts were blocked. Run it where the reference exists (`harness.mjs --ref <path>`, then
      `drive-all.mjs`, without `--no-oracle`). The "/" menu is the window most likely to differ: `a846d08`
      added a Forge-only `(soon)` element after the last baseline write.
- [x] Write `docs/backend-wiring/results/06-browser-views.md` from `report-template.md`.
- [x] Hand over the VS Code checklist (steps 28–33), marked unverified.
