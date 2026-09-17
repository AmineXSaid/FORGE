# Step 06: Checkpoint, group 1 report (done)

**Depends on:** 01–05  **Result:** [results/01-frontend.md](results/01-frontend.md)

- [x] Re-run all gates on the combined result.
- [x] Re-run the harness checks from steps 01–05 together, to catch interactions.
- [x] Write `docs/backend-wiring/results/01-frontend.md` from `report-template.md`.
- [x] Hand the VS Code checklist items from steps 01–05 to the user, marked unverified.
- [x] Don't start group 2 until this report is written.

## Notes from the checkpoint
- The base `forge/backend-wiring` (`a74df01`) also contains the user's merge of the
  ui-parity transcript branch (`fe6833f`), so the harness checks ran on steps 01–05
  **plus** that merge. Two recorded values changed for official reasons: the thinking
  label after a stream is "Thinking" (official `rf1`, no duration), and the dot's `top`
  is 15px on a row that isn't first in its turn (`--message-padding-top` 8px + 7px).
- Re-run T12 with the scroll **after** the streamed row exists. Scrolling up before
  `message_start` hits ChatPage's row-count watcher, which is a separate issue that already existed.
