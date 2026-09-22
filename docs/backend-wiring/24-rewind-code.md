# Step 24: Rewind code with a dry-run confirmation

**Group:** 5  **Depends on:** 23

> **Corrected against the bundle and the installed SDK while implementing.** The
> five places this file was wrong are marked **[was:]** below; the reasoning is
> in [results/24-rewind-code.md](results/24-rewind-code.md).

## Official
- `{type:"rewind_code", userMessageId, dryRun}` → `query.rewindFiles(id, {dryRun})` →
  `{canRewind, filesChanged, insertions, deletions, skippedLinks}`.
  **Channel-scoped**: the sender is `sendRequest({…}, channelId)` and the handler
  is `this.withChannel($.channelId, …)`. It is the only channel-scoped request in
  group 5.
- **[was: "`dryRun` is a boolean".]** It is `boolean | undefined`. The sender is
  `{...,dryRun:Z?.dryRun}`, so `rewindCode(id)` with no options puts the key on
  the wire as `undefined` — and that is the **real** run.
- **[was: "official error mapping".]** There is no shaped error: the official
  **throws** (`if(z.error)throw Error(z.error)`), so the webview sees a rejected
  request. Forge's host already maps a thrown handler error onto
  `{type:"error",error}` and its transport rejects on that, so the semantics
  carry over untouched.
- The confirm dialog is `mo`. Registry row: `rewind` | "Rewind" |
  description "Restore code and conversation to an earlier point" | section
  Context | **not** filterOnly.
- **[was: the file did not mention the picker.]** The row does not open `mo`. It
  opens `yH0`, a "Rewind to…" **message picker** (module `cO8y_Q`); picking a row
  then opens `mo` with `willForkAfter: true`, and confirming runs the rewind
  **and then forks**. So the row cannot work before step 25.

## Six places (B2)
- Handler: **[was: "`userMessageId` belongs to this channel's transcript".]** The
  official validates nothing at all — the CLI owns the transcript and the host
  cannot check membership. Forge validates the **uuid shape** instead (B3), the
  same `SD0`-style check the session-id validator uses, and refuses a non-boolean
  `dryRun`. A refusal answers `canRewind:false` rather than throwing.
- Launch with `enableFileCheckpointing` (sdk.d.ts:1605) or `rewindFiles` has
  nothing to restore.
- **[not in this file at all, and it blocks the whole feature:]** Forge had no
  user-message uuids. The loader (`convertMessage`) threw them away, and a live
  turn never minted one. Fixed by minting the uuid client-side the way the
  official does, passing `--replay-user-messages`, dropping the CLI's echo of a
  prompt already on screen, and carrying `uuid` / `session_id` separately out of
  the loader. See the results file's "The blocker found mid-step".
- `test/rewindCode.spec.ts`: dry run, real run, rejection of a malformed id, a
  closed channel, and the throwing error path.

## Tasks
- [x] Launch queries with file checkpointing enabled — `Options` in
      `ClaudeSdkService.query()`, on for every session (the user's decision).
- [x] Build the rewind flow: the request, the `mo` dialog, the `yH0` picker,
      `insertMetaMessage` and the `meta` transcript row.
- [ ] **[was: "Add the `rewind` row".]** Moved to **step 25** (the user's
      decision), because the row's own flow forks and `fork_conversation` is
      step 25. B4: a row appears only when its backend works.

## Validate
- [x] Gates pass.
- [ ] Harness: "/" → Rewind → pick a message. **[was: "Confirm sends
      `dryRun:false`".]** Confirm sends `dryRun: undefined`; only the dialog's
      opening preview sends `dryRun:true`. Cancel sends nothing. Oracle:
      0 structural diffs. **Runs in step 25**, with the row.

## VS Code checklist for the user (B7: files on disk)
1. Ask Claude to edit `a.txt`, then rewind to before that message and confirm.
   **Expected:** `a.txt` is back to its previous content on disk.
