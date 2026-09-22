# Step 42: The five defects reported from a real VSIX install

**Group:** 7 (post-install bug report) **Branch:** `forge/openai-compatible-endpoints`

Reported from an installed `forge-0.1.0.vsix`, not from the harness:

1. Every "/" menu row (MCP servers, Hooks, Permissions, Manage plugins,
   Endpoints) opened Forge Settings on **General**.
2. There was no way to add a custom LLM endpoint from the UI — endpoints were
   `settings.json`-only and nothing in the UI led there.
3. The title-bar / activity-bar Forge mark was empty, not the voxel cube.
4. The Forge welcome page opened "like a coding file window", not like Claude
   Code in VS Code.
5. **After the fix for (1) was installed, every "/" row stopped doing anything
   at all.**

(5) is the one that had to be understood first, because it is the one the fix
caused.

## Why (5) happened: the VSIX shipped two halves that disagreed

Measured, not guessed. In the worktree the VSIX was built from:

| File | mtime |
| --- | --- |
| `dist/media/main.js` (webview) | Sep 20 **10:41** |
| `dist/extension.cjs` (host) | Sep 20 **03:04** |
| `forge-0.1.0.vsix` | Sep 20 10:48 |
| installed into `~/.vscode/extensions/msaid.forge-0.1.0` | Sep 20 10:49 |

And in the installed build:

```
grep -o open_settings dist/media/main.js   | wc -l   →  ≥1
grep -o open_settings dist/extension.cjs   | wc -l   →  0
```

The webview sent `open_settings`; the host bundle predated the request type, so
the dispatcher fell to `default: throw new Error(\`Unknown request type: ...\`)`.
The webview called it as `void transport.openSettings(...)`, so the rejection
became an unhandled promise and nothing was drawn. The menu closed, and the row
looked dead.

The cause is the packaging script:

```json
"prepackage": "pnpm run build && cp README.md README.md.bak && sed -i '' 's|…|…|g' README.md",
"package":    "vsce package --no-dependencies",
"postpackage": "mv README.md.bak README.md",
```

Two independent failures:

- **pnpm 12 does not run pre/post hooks for arbitrary script names.** `pnpm run
  package` went straight to `vsce package` and packaged whatever was already in
  `dist/`. Evidence: no `README.md.bak` was left behind and the README was never
  modified, so `prepackage` did not run at all.
- **`sed -i ''` is BSD syntax.** GNU sed reads the `''` as the script and the
  expression as a filename; the step exits 2 on Windows and Linux. Even where
  the hook does run, packaging would have aborted. Verified by running it.

The README rewrite it performed is also dead: the badge URL it replaces is no
longer in `README.md`, and `assets/**` is in `.vscodeignore` so the replacement
path would not have shipped either.

### The fix

```json
"package":   "pnpm run build && pnpm run lint:dist && vsce package --no-dependencies",
"lint:dist": "node scripts/check-dist.mjs",
```

`scripts/check-dist.mjs` fails if either `dist/extension.cjs` or
`dist/media/main.js` is missing or older than the newest file under `src/` or
`package.json`. It guards the *skew* specifically, because a missing bundle
fails loudly while a stale one fails silently.

`runHostAction` (`src/webview/src/core/runtimeTransport.ts`) is the second half:
a row whose request the host rejects now shows an error naming the request
instead of closing the menu. That is what would have made this a one-click
diagnosis.

## (1) The rows open the tab they name

Already fixed in `e662fe1` (`open_settings` with a host-side section
whitelist). It never reached the user because of (5). The spec now imports
`SETTINGS_SECTIONS` and `WEBVIEW_ALLOWED_COMMANDS` from `handlers.ts` instead of
restating them, since a test that restates a list only proves the copy is
self-consistent — which is the same class of bug as (5).

Note on "Permissions": that row opens the **Permission rules dialog**, not a
Settings tab, which is what the official row does (step 16). It is not a
regression.

## (2) Adding an endpoint from the UI

`forge.addEndpoint` asks five questions — name, base URL, wire, model, auth —
and writes `forge.endpoints[name]`. The pure half is
`src/services/endpoints/newProfile.ts`, so the validators and the value it
writes are testable without a workbench.

- **No key is ever asked for or written.** The flow asks for the *name* of an
  environment variable and stores `${env:VAR}`, which `interpolate()` resolves
  at request time. The variable-name validator rejects anything that is not a
  plain identifier, which also rejects a pasted token.
- Only the fields `parseProfile` requires are written. `capabilities`,
  `timeoutMs` and `retries` keep their defaults; guessing a capability block
  before the endpoint has answered would put a number in front of the UI that
  nothing measured. `forge.detectCapabilities` measures it afterwards.
- `wire: raw` is not offered: it requires a `transform` module, so a profile
  created with it here could only be invalid.
- The workspace destination is only offered when a folder is open, because
  `ConfigurationTarget.Workspace` throws otherwise.

`forge.editEndpoints` opens `settings.json` at `forge.endpoints`. It exists
because the Settings row labelled "Opens settings.json" ran the *picker* — a
label that does not match its behaviour, which is B7.

## (3) The mark in VS Code's chrome

### The real cause: every generated SVG was invalid XML

Found by rendering them, not by reading them. Both generator scripts emitted
this banner:

```xml
<!-- GENERATED by scripts/gen-cube-icon.ts -- do not edit by hand. -->
```

XML forbids `--` inside a comment, and SVG is XML. So
`forge-cube.svg`, `forge-cube-brand.svg`, `forge-logo.svg` and
`forge-logo-brand.svg` were all unparseable. Rendered in a browser they came out
as broken-image placeholders; used as a CSS mask — which is how VS Code draws an
activity-bar icon — they came out as **nothing at all**. "The icon was empty"
was literally true, and no amount of choosing the right cut would have helped.

Both generators now write `… gen-cube-icon.ts. Do not edit by hand.` and
`pnpm run marks` was re-run. `test/forgeMarks.spec.ts` checks every SVG under
`resources/` for the same thing, so the class of bug cannot come back silently.

### The geometry: solid, not voxel

With the files finally rendering, the two cuts could be compared for the first
time. Masked at 16 / 20 / 24 / 32px — the sizes VS Code actually draws these at:

| Cut | 16px | 24px |
| --- | --- | --- |
| `markPaths(0.35)` (voxel, ~81 paths) | a textured smudge; the voxel gaps are sub-pixel | still muddy |
| `markPaths(0)` (solid, 3 quadrilaterals) | reads as a cube | reads as a cube |

`e662fe1` had switched these files to the voxel cut for looking more like
Forge. That judgement was made while the files rendered as nothing, so nothing
was being compared. They are back on the solid cut; the voxel cube stays where
it is drawn at 138px, in `ForgeWordmark.vue`.

### Which cut goes where

VS Code draws the two kinds of surface differently, and that decides the fill:

| Surface | How VS Code renders it | Correct cut |
| --- | --- | --- |
| `viewsContainers[].icon` | masked to the theme foreground; only alpha survives | `forge-cube.svg` (`currentColor`) |
| `contributes.commands[].icon` | drawn as an image, colours and all | `forge-cube-brand.svg` (literal `#9d7ee0` / `#7759c2` / `#5b4499`) |
| `WebviewPanel.iconPath` | drawn as an image | `forge-cube-brand.svg` |

In an isolated SVG document `currentColor` resolves to the initial value of
`color`, which is black — invisible on a dark theme. The official ships a
literal `#D97757` for precisely these two surfaces and passes the one file as
both `light` and `dark`:

```js
let W = Uri.joinPath(this.extensionUri, "resources", "claude-logo.svg");
$.iconPath = { light: W, dark: W };
```

So `forge.editor.openLast` now points at the brand cut, and `openEditorPage` /
`createPagePanel` set `panel.iconPath`. The view containers keep the masked cut.

## (4) The welcome page opened in the user's code group

`openEditorPage` passed `vscode.ViewColumn.Active`, so the page landed in
whatever editor group the user was reading code in. The official picks a column
instead (`on$` / `findUnusedColumn`), ported verbatim as `chooseEditorColumn`:

1. reuse the editor group whose tabs are *all* Forge pages — the active one
   first, then any;
2. otherwise take the first column no tab group occupies;
3. only fall back to `Beside` when all nine are taken.

When step 2 created the group, the host runs `workbench.action.lockEditorGroup`,
which is what stops a file opened from the chat landing on top of the chat.
`enableFindWidget: true` was added at the same time, for the same parity reason.

## Results

| Row / surface | Request / entry point | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| MCP servers | `open_settings {section:"mcp-servers"}` | validated, `forge.openSettings("mcp-servers")` | Settings on MCP Servers | **works** (spec; unverified in real VS Code) |
| Hooks | `open_settings {section:"hooks"}` | as above | Settings on Hooks | **works** (spec; unverified in real VS Code) |
| Manage plugins | `open_settings {section:"plugins"}` | as above | Settings on Plugins | **works** (spec; unverified in real VS Code) |
| Endpoints | `open_settings {section:"endpoints"}` | as above | Settings on Endpoints | **works** (spec; unverified in real VS Code) |
| Permissions | `openPermissionRules` (no request) | — | Permission rules dialog | **works** — official behaviour, not a defect |
| A row whose request fails | any | rejection | error notification naming the request | **works** (new) |
| Endpoints ▸ Add… | `open_config_file command:forge.addEndpoint` | 5 prompts → `forge.endpoints[name]` | profile written, offer to select | **works** (spec; unverified in real VS Code) |
| Endpoints ▸ Open | `open_config_file command:forge.editEndpoints` | `workbench.action.openSettingsJson` at `forge.endpoints` | settings.json | **works** (spec; unverified in real VS Code) |
| Every generated SVG | `pnpm run marks` | valid XML — the `--` is gone from the banner | the marks render at all | **works** (rendered and screenshotted; spec guards all four files) |
| Editor-title "Forge: Open" glyph | `contributes.commands[].icon` | brand cut | cube visible on dark themes | **works** (rendered as an image at 16/48/160px; unverified in real VS Code) |
| Forge editor tab icon | `panel.iconPath` | brand cut, light+dark | cube on the tab | **works** (source spec; unverified in real VS Code) |
| Activity-bar container icon | `viewsContainers[].icon` | masked cut, solid geometry | cube legible at 16–32px | **works** (rendered as a CSS mask at 16/20/24/32px; unverified in real VS Code) |
| Forge page column | `chooseEditorColumn()` | own group, locked when new | page no longer lands in the code group | **works** (spec; unverified in real VS Code) |
| `pnpm run package` | — | builds, checks dist skew, then vsce | a VSIX whose halves match | **works** (spec) |

**Deliberately left out:** nothing in scope was skipped. `wire: raw` is absent
from the add flow by design (see above), and "Report a problem" remains as it
was — removing it is its own scope item in CLAUDE.md, not part of this report.

**Counts:** 1253 unit tests (43 files, up from 1168), `typecheck:all`,
`lint:forge` and `build` clean.

## Harness measurements

`node .claude/skills/ui-parity/scripts/harness.mjs --port 8783 --ref …`, against
the real built webview.

Rows clicked, and what the stub host received:

| Row | `__forgeSettingsOpens` / `__forgeConfigOpens` |
| --- | --- |
| "/" ▸ MCP servers | `mcp-servers` |
| "/" ▸ Hooks | `hooks` |
| "/" ▸ Manage plugins | `plugins` |
| "/" ▸ Endpoints | `endpoints` |
| "/" ▸ Permissions | *(nothing)* — opens the Permission rules dialog, confirmed present in the DOM |
| Settings ▸ Endpoints ▸ Select… | `command:forge.selectEndpoint` |
| Settings ▸ Endpoints ▸ Add… | `command:forge.addEndpoint` |
| Settings ▸ Endpoints ▸ Open | `command:forge.editEndpoints` |
| Settings ▸ Endpoints ▸ Run | `command:forge.runEndpointDiagnostics` |
| Settings ▸ Endpoints ▸ Probe | `command:forge.detectCapabilities` |
| Settings ▸ Endpoints ▸ List | `command:forge.listEndpointModels` |
| Settings ▸ Endpoints ▸ Show | `command:forge.endpointStatus` |

The regression itself, reproduced and then caught. With
`window.__forgeRejectRequests.add('open_settings')` the stub answers exactly as
the shipped stale host did, and clicking "/" ▸ MCP servers now produces:

```
{ severity: 'error',
  message: 'Forge could not open MCP Servers — Unknown request type: open_settings' }
```

Before `runHostAction` that click produced nothing at all.

`probe-oracle.js`, animations finished first (the browser pane runs hidden, so
`document.hidden` freezes every entrance animation at `opacity: 0` and the
probe reads it as a diff — call `document.getAnimations().forEach(a => a.finish())`
before probing or the report is noise):

| Window | Result | Non-clean rows |
| --- | --- | --- |
| `.fg-commandmenu__menuPopup` (the "/" menu) | **82/82 — 0 structural diffs** | none |
| `.fg-emptystate__container` (welcome page) | **116/122** | the documented divergences #8, #9, #10 in `docs/forge-design.md`, unchanged. No new rows. |

The harness itself gained three things needed to measure any of this:
`?section=<tab id>` in `index.html`, a `show_notification` answer, and
`__forgeRejectRequests` for simulating an out-of-date host.

## Checklist for the user, in real VS Code

The agent cannot observe real VS Code, so every step below is **unverified**.

1. `pnpm run package` in a clean checkout.
   *Expect:* it builds both bundles, prints
   `check-dist: dist/extension.cjs and dist/media/main.js are both newer than src/.`,
   then writes `forge-0.1.0.vsix`. It must **not** skip the build.
2. Break it on purpose: `touch src/extension.ts && pnpm run lint:dist`.
   *Expect:* exit 1, naming `dist/extension.cjs` and how many minutes stale.
3. Install the VSIX, reload, open Forge.
   *Expect:* the **activity bar** shows a cube (it showed nothing before); the
   editor tab shows the purple cube rather than a generic file glyph; and the
   "Forge: Open" button in the editor title bar shows the cube. Check on a dark
   theme and a light one — the old `currentColor` fill was invisible on dark.
4. With a code file open in a single editor group, run **Forge: Open**.
   *Expect:* Forge opens in a **second** group beside it, and that group is
   locked (opening a file from the chat does not replace the chat).
5. Run **Forge: Open** again.
   *Expect:* it focuses the existing tab; no third group.
6. "/" ▸ **MCP servers**.
   *Expect:* Forge Settings opens on the **MCP Servers** tab, not General.
   Repeat for **Hooks**, **Manage plugins**, **Endpoints** — each lands on its
   own tab.
7. With Settings already open on General, click "/" ▸ **Hooks**.
   *Expect:* the already-open page switches to Hooks (the `show_section` push).
8. "/" ▸ **Permissions**.
   *Expect:* the Permission rules **dialog**, not a Settings tab.
9. Settings ▸ Endpoints ▸ **Add…**. Answer:
   `test-gw`, `http://localhost:11434/v1`, `openai`, `qwen2.5-coder`,
   `No authentication`, save to **All workspaces**.
   *Expect:* `~/.config/Code/User/settings.json` (or the OS equivalent) gains
   `"forge.endpoints": { "test-gw": { "wire": "openai", "baseUrl": "http://localhost:11434/v1", "model": "qwen2.5-coder", "auth": { "kind": "none" } } }`
   and a notification offering **Use it now**.
10. Repeat step 9 choosing **Bearer token from an environment variable** and
    typing `MY_TOKEN`.
    *Expect:* `"auth": { "kind": "bearer", "value": "${env:MY_TOKEN}" }`. The
    box must **reject** a pasted key such as `sk-ant-…` with "That is not an
    environment variable name."
11. Try to add a second profile named `test-gw`.
    *Expect:* "\"test-gw\" already exists." and no write.
12. Settings ▸ Endpoints ▸ **Open** (Edit endpoints by hand).
    *Expect:* `settings.json` opens scrolled to `forge.endpoints`.
13. Simulate the original regression: install a VSIX built from this branch but
    with an older `dist/extension.cjs`, then click "/" ▸ MCP servers.
    *Expect:* an error notification reading
    `Forge could not open MCP Servers — Unknown request type: open_settings`,
    instead of nothing happening. (Optional; `lint:dist` is meant to prevent
    ever producing that VSIX.)
