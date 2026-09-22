# Step 54 — the open file, and uploads that arrive

Two reports. Both turned out to be the same shape of bug: the official
feature was **half ported** — the webview side was already in place, the
producer that feeds it never was. In each case the receiving code had been
sitting there unused, which is why neither failed loudly.

## The file the user is looking at

With `generate_files.ps1` open at Ln 27, Col 17:

> **what file am I seeing rn ?**
> I don't have visibility into what file you're currently viewing in your editor
> or terminal.

### Three missing halves

| # | Where | Official | Forge before |
| --- | --- | --- | --- |
| 1 | `handleGetCurrentSelection` | `Ri`: an empty selection still returns the file — same start/end line, **no `selectedText`** | returned `null` whenever `editor.selection.isEmpty` |
| 2 | `Session.buildUserMessage` | `dR1`: `selectedText ? <ide_selection> : <ide_opened_file>` | had the first arm only |
| 3 | host | `xd0`: `onDidChangeTextEditorSelection` + `onDidChangeActiveTextEditor` push the new selection | **nothing ever sent `selection_changed`** |

Defect 3 is the one that made the other two invisible. `BaseTransport` has
always handled `selection_changed` and fed it to `appContext.currentSelection`,
but no sender existed — and the declared payload was `{start, end}` positions
the receiver could not have consumed anyway. So the selection was whatever
`get_current_selection` returned **once**, at panel load, and every file opened
afterwards was invisible no matter what the handler would have said if asked.

Measured in the user's own log: `selection_changed` appears **0 times**,
`get_current_selection` **4** (once per webview).

### The scheme rule flipped

`scheme !== "file"` was an allowlist, and it threw away untitled buffers — real
documents the user is working in. The official `MV`/`fI4` is a **denylist** of
editors that are not the user's document at all: `comment`, `output`, and its
own diff-view schemes. Forge's diff schemes go beside them.

### Already ported, just starved

`ButtonArea.selectionLabel` already read *"with only a cursor position it falls
back to the file name"*, and `parseOpenedFile` already turned
`<ide_opened_file>` into a transcript block. Both were waiting on a payload the
host never produced — which is the clearest possible confirmation that the fix
belongs on the producer side and not in the UI.

## Uploads

Intake was never the problem: `+` → "Upload from computer", drag-and-drop and
paste all reached `handleAddAttachment`. What happened next was.

Every file was converted into a chip with no filtering, and then
`buildUserMessage` accepted exactly three things — the four image types,
`text/plain`, and `application/pdf`. Everything else hit
`console.error('Unsupported attachment type')` and was dropped. The user saw an
attachment, sent the message, and nothing arrived.

| File | Chip before | Sent before | Sent now |
| --- | --- | --- | --- |
| `.png` / `.jpg` / `.gif` / `.webp` | ✅ | ✅ | ✅ |
| `.pdf` | ✅ | ✅ | ✅ |
| `.txt` | ✅ | ✅ | ✅ |
| `.ts` / `.py` / `.ps1` / `.json` / `.md` / `.vue` / `.sql` … | ✅ | ❌ **dropped** | ✅ |
| `LICENSE`, `README`, `Dockerfile`, `Makefile` | ✅ | ❌ **dropped** | ✅ |
| `.zip`, `.exe`, `.mp4` | ✅ | ❌ **dropped silently** | ❌ **refused, and said so** |

The source-file row is the important one. Browsers label most source files
`application/octet-stream` — and `.ts` is commonly `video/mp2t` — so a rule that
compares MIME types exactly rejects precisely the files a coding agent is most
likely to be handed. The official classifies on the file **name** as well:
`Mj0` checks `text/*`, then the 14-entry `Pj0` list, then a ~150-entry extension
set `cR1`, then bare `license`/`readme`/`changelog`/`authors`/`contributors`/
`copying`.

Three things changed, all ported rather than invented:

- **`classifyAttachment` = `lR1`**, taking `(mediaType, fileName)`.
- **The gate moved to pick time** (`isSupportedAttachment` = `jj0`, applied the
  way `$v` does), so an unsupported file never becomes a chip, and the rejected
  names are shown in a warning instead of dying in the console.
- **Text decodes through `TextDecoder`**, as the official's text branch does.
  Bare `atob` returns one byte per character, so every non-ASCII source file was
  arriving mojibake'd.

`.zip` is still refused, and that is correct. Refusing *quietly* was the bug.

`Session.ts` also had a private second copy of `IMAGE_MEDIA_TYPES`; it now uses
the one set the classifier uses.

## What was checked and found already correct

- **`@` file mentions work.** `@` → `list_files_request` → `findFiles`, and the
  path is passed through as plain text for the CLI to resolve — which is exactly
  what the official does. Confirmed handled in the user's log (2026-09-20 10:19).
- **The "Browse the web" row is not a B4 violation.** It is gated on
  `browserIntegrationSupported`, which defaults to `false` and is passed by no
  parent, so the row does not render. (An earlier note in this session said
  otherwise; that was wrong.)
- **`@terminal:`** is not implemented and is not in scope.

## B9 report

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| Cursor in a file, nothing selected | `get_current_selection` | file + line, no `selectedText` | chip shows the file name; `<ide_opened_file>` sent | **Fixed** (spec) |
| Text highlighted | `get_current_selection` | full range + text | chip shows "N lines selected"; `<ide_selection>` sent | **Unchanged, still correct** (spec) |
| Switching files mid-conversation | `selection_changed` | pushed on both editor events | selection follows the editor | **Fixed** (unverified in VS Code) |
| Diff / output / comment editor focused | `selection_changed` | `null` | no false context | **Fixed** (spec) |
| Untitled buffer | `get_current_selection` | reported | now included | **Fixed** (spec) |
| Attach `.ps1` / `.ts` / `.json` | — | — | attaches and is sent as a text document | **Fixed** (spec) |
| Attach `.zip` | — | — | refused at pick time with a named warning | **Fixed** (spec) |
| Attach non-ASCII source | — | — | decoded as UTF-8, not Latin-1 | **Fixed** (spec) |
| `@` file completion | `list_files_request` | `findFiles` | dropdown lists files | **Already worked** (log) |
| "Browse the web" row | — | — | not rendered | **Correctly hidden** |

Counts: **31 new specs** (11 IDE context, 21 attachments — one file has both
describe blocks), suite **1456 passed, 8 skipped, 0 failed**, up from 1435.
`typecheck:all` and `lint:forge` clean.

Deliberately left out: `@terminal:` and the `<browser …>` producer — out of
scope, and their rows are already absent.

## Checklist for VS Code (unverified by the agent)

1. Install and reload:
   `code --install-extension forge-0.1.0.vsix --force`, then
   **Developer: Reload Window**.
2. Open any file, click into it **without selecting anything**. Expected: a chip
   above the composer showing the **file name**.
3. Ask "what file am I seeing?" — expected: it names the file. This is the
   report that started this.
4. **Switch to a different file** and ask again without touching the chat.
   Expected: it names the new file. Before this change the answer would have
   been the file that was open when the panel loaded, or nothing.
5. Select a few lines. Expected: the chip changes to "N lines selected", and the
   model quotes the selection.
6. Focus an output channel or a diff pane. Expected: the chip does **not**
   change to it.
7. Drag a `.ps1` or `.ts` file onto the composer. Expected: it attaches, and the
   model can read its contents.
8. Drag a `.zip`. Expected: **no chip**, and a warning naming the file. Before,
   it attached and silently never arrived.
9. Attach a file containing accented or non-Latin characters. Expected: they
   come through intact.
