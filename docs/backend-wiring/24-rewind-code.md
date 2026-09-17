# Step 24: Rewind code with a dry-run confirmation

**Group:** 5  **Depends on:** 23

## Official
- `{type:"rewind_code", userMessageId, dryRun}` → `query.rewindFiles(id, {dryRun})` →
  `{canRewind, filesChanged, insertions, deletions, skippedLinks}`.
- The confirm dialog is `mo`. Registry row: `rewind` | "Rewind" | section Context. Read the whole flow.

## Six places (B2)
- Handler: `userMessageId` belongs to this channel's transcript; `dryRun` is a boolean;
  call the upgraded SDK's `rewindFiles`; official error mapping.
- `test/rewindCode.spec.ts`: dry run, real run, rejection of a foreign or unknown id.

## Tasks
- [ ] Launch queries with file checkpointing enabled (the upgraded SDK's option name).
- [ ] Build the rewind flow and the `mo` dialog (DOM, copy). Add the `rewind` row.

## Validate
- [ ] Gates pass.
- [ ] Harness: "/" → Rewind → pick a message. A dry-run request, then the stats in
      the dialog. Confirm sends `dryRun:false`. Cancel sends nothing. Oracle: 0 structural diffs.

## VS Code checklist for the user (B7: files on disk)
1. Ask Claude to edit `a.txt`, then rewind to before that message and confirm.
   **Expected:** `a.txt` is back to its previous content on disk.
