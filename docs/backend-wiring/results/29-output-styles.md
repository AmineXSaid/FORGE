# Step 29 results: output styles

## Results

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| "/" → Output styles | `{type:"get_output_style"}` (channel-scoped) | `{type:"get_output_style_response", outputStyle?, availableStyles?}` — `outputStyle` omitted unless the CLI reports a string; `availableStyles` prefers `channel.outputStyles` over the session's `available_output_styles` | menu **closes**, the picker opens showing "Loading output styles…" then the list, tick on the current style | works |
| picker row | `{type:"apply_settings", settings:{outputStyle}, scope:"localSettings"}` | `apply_settings_response`; the whitelist accepts `outputStyle` only at `localSettings` | picker closes, tick moves, the value survives a re-open | works |
| picker → "Build a custom style ›" | `{type:"get_output_style_locations"}` | `{project:".claude/output-styles", user:"~/.claude/output-styles"}` — project relative, user tildified | picker closes, the wizard opens on "Step 1 of 4"; both "Save to" rows show the full file path | works |
| wizard → Save | `{type:"create_output_style", draft, level, replace}` | `{result:{kind:"saved", filePath, availableStyles?}}`; the file is written with `O_EXCL` + `O_NOFOLLOW` inside the chosen folder | dialog closes; with "Switch to this style now" on, `apply_settings {outputStyle}` follows | works |
| wizard → Save on a name already on disk | same, `replace:false` | `{result:{kind:"exists"}}` — nothing overwritten | "A style file named `<name>.md` already exists here." and the button relabels to **Replace** | works |
| wizard → Replace | same, `replace:true` | `{result:{kind:"saved"}}` via temp-file + rename | dialog closes | works |
| wizard → Save when the CLI cannot reload | same | `{kind:"saved"}` with no `availableStyles`, plus a host warning log | "Saved. The style will appear in the Output styles menu in new sessions." and a single **Done** button; **no** `apply_settings` is sent | works |

**Counts:** works 7 · partial 0 · broken 0 · left out 0

Keyboard, also driven in the harness: ArrowDown / ArrowUp walk the styles and
wrap onto the build row, Enter picks the active style, Escape closes. The caret
never leaves the composer, so the composer input carries
`aria-controls="output-style-list"` and `aria-activedescendant`, which tracked
`output-style-list-option-0…4` and `output-style-list-build` correctly.

## Gates

- `pnpm test`: `Test Files 30 passed (30) · Tests 758 passed (758)`
- `pnpm run typecheck:all`: `tsc --noEmit` and `vue-tsc -p src/webview/tsconfig.json --noEmit`, both clean
- `pnpm run build` (lint:brand, lint:tokens, lint:commands): `✓ built in 6m 49s`, then `[watch] build finished`

## Oracle

Harness on `127.0.0.1:8791`, stylesheets parsed (`[1, 5, 9869]`).

| Window (root selector) | Structural diffs | Colour diffs (expected, brand) |
| --- | --- | --- |
| picker, `.fg-outputstyle__menuPopup` (24 elements) | 0 | 5 |
| wizard step 1, `.fg-dialog__overlay` (15) | 0 | not listed |
| wizard step 3, `.fg-dialog__overlay` (20) | 0 | not listed |
| wizard step 4, `.fg-dialog__overlay` (30) | 0 | not listed |

`classesNotInOfficialCss: []` and `missingTwin: 0` on every one of them.

## What was ported

- CSS modules added to `scripts/port-official-css.mjs`: `outputstyle` (`GCcFcA`,
  11 rules), `stylewizard` (`6c6QYQ`, 8 rules) and `dialoginput` (`-FIyPw`, 3
  rules — the text input the wizard's fields use).
- Webview: `forge/OutputStylePicker.vue` (the official `DH0`),
  `forge/OutputStyleWizard.vue` (`jU0`), `forge/outputStyle.ts` (the copy `f6`,
  the steps `lo`, the label formatter `$85` and the three checks `FU0`/`AU0`/`DU0`).
- `core/Session.ts`: `outputStyle`, `outputStyleList` and the official
  write-sequence bookkeeping, plus `refreshOutputStyleForPicker`,
  `getOutputStyleLocations`, `createOutputStyle` and `setOutputStyle`.
- Host: `services/claude/outputStyles.ts` and `ClaudeAgentService`'s three
  methods and dispatcher cases; `outputStyle` added to the step 11 whitelist at
  the `localSettings` layer.

## Specs added

`test/outputStyles.spec.ts` (47 cases):

- the name check — empty, every separator (`/ \ : * ? " < > |`), `..` and
  `.hidden`, control characters, Windows device names, `---`, and a name already
  taken case-insensitively;
- the description fence and the file name;
- the YAML front matter, including a one-letter name being quoted (the official
  plain-scalar shape needs two characters);
- `userOutputStylesDirFrom` accepting only an absolute, normalised path named
  `output-styles`, and `tildify`;
- `effectiveOutputStyle` / `availableOutputStyles` rejecting the wrong shapes;
- the write: `createExclusive` refusing a second write, `replaceViaTemp` leaving
  no temp file, `assertProjectFolderSafe` refusing a folder outside the session
  cwd, and `probeOutputStyleFolder` refusing a symlinked `.claude` (skipped on a
  Windows host that cannot create links);
- the three requests, including every rejection (`Invalid output style name`,
  `… description`, `… level`), `{kind:"exists"}` not overwriting, `replace:true`
  overwriting, the no-reload warning, and all three being channel-scoped;
- `apply_settings {outputStyle}` accepted only at `localSettings`;
- **a table run through both the webview's and the host's checks**, asserting
  they agree on 24 names, 5 descriptions and 3 file names — so one side cannot
  drift from the other.

`test/applySettings.spec.ts` updated: the two cases that said "until step 29
adds it" now assert the localSettings-only behaviour.

## Rows deliberately left out and why

None for this step. The picker offers exactly what the CLI listed, and the build
row appears only once the list has loaded (the official `K = Z !== void 0 && !!G`).

## VS Code checklist for the user (unverified until the user runs it)

The agent cannot observe real VS Code; every step below was proved against the
mock host only.

1. Open a conversation, press "/", choose **Output styles**.
   **Expected:** the menu closes and a popup opens above the composer listing the
   styles the CLI knows (at least `default`), with a tick on the current one.
2. Pick a style other than the current one.
   **Expected:** `.claude/settings.local.json` in the project gains
   `"outputStyle": "<name>"`, and the next reply follows that style.
3. Re-open "/" → Output styles.
   **Expected:** the tick is on the style picked in step 2.
4. "/" → Output styles → **Build a custom style ›**, name it `Diagrams first`,
   leave the description blank, give it one line of instructions, keep "Include
   the coding instructions" on, choose **Project**, keep "Switch to this style
   now" on, press **Save**.
   **Expected:** `.claude/output-styles/Diagrams first.md` exists with front
   matter `name: Diagrams first` and `keep-coding-instructions: true`;
   `.claude/settings.local.json` now says `"outputStyle": "Diagrams first"`; and
   the style appears in the picker.
5. Repeat step 4 with the same name.
   **Expected:** "A style file named Diagrams first.md already exists here." and
   the button reads **Replace**. Press **Replace**: the file's instructions are
   the new ones, and no `.tmp` file is left in the folder.
6. Try to name a style `../escape` or `a/b`.
   **Expected:** "A name can't contain / \ : * ? " < > | or ---", **Next** does
   not advance, and nothing is written anywhere.
