---
name: ui-parity
description: Measure Forge's webview against the real Claude Code VS Code extension, element by element, instead of eyeballing it. Use whenever changing or reviewing any Forge UI surface (composer, chat, menus, permission dialog, sessions), when asked whether something "matches" or "looks the same", or when a UI change needs proof rather than a claim. Triggers - "does this match", "same as the real one", "UI parity", "compare to Claude Code", "pixel check", "button to button".
---

# UI parity: measure, do not assert

Forge's UI target is the **real Claude Code VS Code extension**, not an approximation
of it. This skill exists because looking at a screenshot and saying "that matches"
is unreliable — it hides wrong fonts, wrong spacing, missing elements and wrong
icons. Every parity claim must come from a measurement produced here.

The reference extension lives at `../Real_Claude_Code_VSCODE_extension_files/`
(configurable). Its `webview/index.css` is the style spec and `webview/index.js`
is the component spec — **both are readable**, so never guess at structure.

## Rules — these are not optional

**1. If the code exists, read it. Never guess.**
The reference implementation is on disk and readable. So is every repo in this
workspace. Inferring structure from appearance when the source is sitting there
is the single most expensive mistake available here: it has already produced a
`<fieldset>` built as a `<div>`, a `<legend>` built as a positioned span, and a
whole menu built from the wrong component. Grep the bundle. Read the function.
Copy the values.

**2. "Clone it" means per-pixel, and it means looping until it is done.**
When asked to mimic or clone a surface, match *all* of it: layout, spacing,
typography, font, logo, icons, text rendering, copy, states, and every sub-window
(menus, popups, dialogs, banners). Then check implementation against source
1-vs-1, element by element, and repeat until nothing differs. One pass is never
a clone. Stopping at "close enough" is not finishing.

**3. When steps or code are provided, execute them — do not re-derive them.**
If the user hands over a path, a snippet, a screenshot or an exact sequence, use
it directly and efficiently. Re-reasoning from scratch about something already
supplied wastes the user's time and invites drift from what they asked for.

**4. Match the small things, because they are what "the same" means.**
Icons must be the *same glyphs*, not lookalikes — extract them from the bundle
with `scripts/extract-icons.mjs` rather than substituting a codicon that is
roughly the right shape. Text size, font family and weight must match, and that
starts at the base: the official webview sets `body { font-size:
var(--vscode-chat-font-size, 13px) }` and everything sizes in `em` off it, so a
wrong base silently scales the whole UI. Spacing must match too — the gap
between an icon and its label, the padding inside a row, the gap between footer
controls. These are the differences that read as "yours looks off" even when the
structure is right, and they are all measurable: read them out of
`reference.json` and compare with `scripts/probe-styles.js`. Never override a
ported rule with a scoped style "to make it look better" — that is how a 10px
gap silently becomes 6px.

**5. Repeating a correction is a signal you are getting it wrong.**
If the user raises the same point more than once, stop and change approach —
do not restate the plan, do not narrate what you "now see", and do not promise a
fix in prose. Go read the source, make the change, measure it, and show the
measurement. Narration without a diff is the failure mode this skill exists to
prevent. Users get (reasonably) frustrated when the same issue survives several
rounds of confident-sounding replies; treat a repeat as a hard stop on guessing.

**6. Every button's window must do what the official one does, item for item.**
A control is not "the same" because its button looks the same. Open it in both
and compare what is inside: every row, its label and description (the `title`
tooltip), its section and order, its trailing control (toggle, slider, model
name, icon), whether choosing it closes the menu, what it actually does, and
which rows only appear while filtering. The official builds these from data you
can read -- e.g. the "/" menu is a registry of
`registerAction({id,label,description,trailingComponent,keepMenuOpen,filterOnly}, section, handler)`
calls, and the "+" menu pushes `{id,label,title,icon}` items behind
capability checks. Extract that list, then:
- wire each row to the real Forge action that does the same thing;
- if Forge genuinely cannot do it, leave the row out -- the official itself only
  registers actions its host can serve (effort disappears for models without
  effort, remote control only exists when available). A row that does nothing is
  worse than no row;
- click every row in the harness and confirm the effect (state change, menu
  stays open or closes), and list the rows left out and why.
Looking right while doing the wrong thing is a parity failure: choosing an
effort level once silently toggled thinking off, and "Open Claude in Terminal"
ran `claude --help`.

> Do not tell the user something matches unless a command in this skill printed
> evidence that it does. If a check is not run, say it is not run.

## 1. Build and boot the harness

The harness runs Forge's **real built webview** with a stubbed extension host, so
what is measured is what ships — not a hand-written mock of it. Hand-written mock
pages are banned here: they silently drop Vue scoped styles and so report parity
that the real app does not have.

```bash
cd <forge-root>
pnpm run build
node .claude/skills/ui-parity/scripts/harness.mjs --port 8733
```

`harness.mjs` copies `dist/media/*` next to the stub host and serves it. It prints
the URL. Open it with the Browser pane (`preview_start`, or `tabs_create` +
`navigate`), then **wait ~3s and confirm the stylesheet actually parsed** before
trusting anything:

```js
[...document.styleSheets].map(s => { try { return s.cssRules.length } catch { return 'ERR' } })
```

A `0` means the CSS had not loaded yet and every measurement below is garbage.
This has caused false readings before — check it every time.

### If the Browser pane is not available

The Browser-pane tools (`mcp__Claude_Browser__*`) vanish when the MCP server
reloads mid-session. That is not a reason to skip the pass — B7 says a row is
"works" only once it has been clicked. Drive Chrome directly instead:

```js
import { launch, ORACLE } from './.claude/skills/ui-parity/scripts/cdp-driver.mjs';

const page = await launch({ width: 800, height: 900 });
await page.navigate('http://127.0.0.1:8741/index.html?mockSessions');
console.log(await page.eval(ORACLE('.fg-commandmenu__menuPopup')));
await page.hover(x, y);          // reveals hover-only controls
await page.click(x, y);          // a real mousePressed/mouseReleased pair
await page.close();
```

No dependencies: Chrome is installed and Node 24 has a built-in `WebSocket`.
Measure element boxes with `page.eval` (`getBoundingClientRect`) and click their
centres, so the coordinates come from the page rather than from a screenshot.

**Two traps, both of which have produced wrong answers:**

- **Check whose harness you are measuring.** Other worktrees leave harnesses
  listening on 8733–8736. Pick a free port, and byte-compare the served
  `/main.js` against `dist/media/main.js` before trusting a number. A pass was
  once run against another worktree's build, which had none of the code under
  test.
- **Use real input, not `element.click()`.** The official closes its popups on
  `mousedown`, which a synthetic click never fires — so a popup that looks wrong
  is often just the previous one still open.


### Every surface at once

`scripts/drive-all.mjs --port <p>` clicks every "/", "+", mode, model and
sessions row, the message actions, the permission options, the welcome states,
the sessions page, all 15 Settings tabs and the plan preview; records what each
sent and whether the stub answered it for real (`__forgeFallbacks`); runs the
oracle on every window against `baselines/oracle.json` (a new structural row
fails); and prints the table. `--write-baseline` records the current rows, only
after each has been matched to a divergence in `docs/forge-design.md`.

### End to end: the real extension in a real VS Code

The harness stubs the host. `e2e/launch.mjs` installs the VSIX into an
isolated VS Code (desktop on Windows, code-server on Linux), drives it over
CDP against a real or stub gateway, and checks 19 scenarios by what landed on
disk, at the gateway or in the DOM. See `e2e/README.md`. A behaviour claim
about the real CLI needs a scenario run, or it is listed as unverified.

## 2. Coverage: which official elements do we render?

```bash
node .claude/skills/ui-parity/scripts/extract-reference.mjs
```

This reads the official `index.css`, groups classes by their CSS-module hash, and
writes `reference.json` (class -> declarations). Then in the browser run
`scripts/probe-coverage.js` to list which official classes the running app never
renders. A class the real UI has and Forge does not is a missing piece of
interface — the "button to button" gap.

Expect legitimate absences (an empty transcript has no message rows, a closed
menu has no popup). Drive the app into the state first, then re-probe.

## 3. Geometry and typography diff

With the app in the state under test, run `scripts/probe-styles.js` in the
browser. For each element it reports the computed values that decide whether
something "looks the same":

`font-family, font-size, font-weight, line-height, letter-spacing, color,
background-color, border, border-radius, padding, margin, gap, width, height,
min/max-height, display, align-items, justify-content`

Compare against `reference.json`. Anything structural that differs is a bug in
Forge's markup, because the ported stylesheet copies the official rules 1:1 and
only re-points colour.

**Font is the usual culprit.** Forge bundles its own faces and must never fall
back to a system font. If `font-family` computes to anything but a `Forge *`
family, that is a defect — see `scripts/check-brand.mjs`.

## 3b. Oracle diff: let the official stylesheet decide

`probe-styles.js` shows numbers; `probe-oracle.js` says which numbers are wrong.
It clones the live DOM into an offscreen iframe, translates every
`fg-<module>__<local>` class back to the official `<local>_<hash>`, loads only
what the real extension renders with (VS Code's host stylesheet, the theme
variables, the official `index.css`) and diffs every element's computed styles.

```js
// in the Browser pane, with the app driven into the state under test
window.__oracle = { maxRows: 80 };           // optional: { root: '.fg-...', colours: true }
eval(await (await fetch('/probes/probe-oracle.js')).text())
```

Markup is identical on both sides by construction, so a structural difference is
Forge CSS: a lossy port, a scoped/global override, or a drifted token. It does
not catch wrong markup (a `<span>` where the official has a `<button>` is wrong on
both sides) -- that still comes from reading `index.js`. Colour is listed
separately because it differs by design.

What it has already caught: Tailwind preflight. The official webview has no CSS
reset -- text rows are `line-height: normal`, boxes `content-box`, `<svg>` inline,
`<button>` keeps native padding. Preflight changed all four globally: 1 of 56
elements on the chat screen matched, the header was 44px tall instead of 28px.
Forge now imports Tailwind without preflight (Settings keeps a scoped copy).

The harness also loads `harness/vscode-default.css`, copied verbatim from VS
Code's webview host page, because the real extension renders inside it (10px
scrollbars, `code`/`kbd` defaults).

## 3c. Surface inventory -- open every one of these

| Control | Official component (index.js) | Forge | Window contents |
| --- | --- | --- | --- |
| `+` | `pV0`, module `Lu5mZA` | `forge/AddMenu.vue` | Upload from computer / Add context / Browse the web (only with browser integration) |
| `/` | `TV0` + registry, `G_S7FQ`, `90gk3A` | `forge/CommandMenu.vue` | Filter actions...; Context, Model, Customize, Settings, Slash Commands (filter only), Support; toggles `Xj` (`0c4GDA`), effort slider `ko` (`P1HaRA`); "Report a problem" + version row |
| model pill | `HF1` + `aV0`, `G8AMvA` | `ModelSelect.vue` | "Select a model"; rows = displayName + description; check on current; Effort row (`QF1`) with slider |
| mode | `$H0`, `8RAulQ` | `ModeSelect.vue` | Modes header + "shift+tab to switch"; rows with `iconV2`; effort row. Footer button uses `iconV2Small` |
| permission prompt | `y5` (`qlaBag`) | `PermissionRequestModal.vue` | fold button, numbered buttons, contenteditable reject field, "Esc to cancel" |

Glyph sizes are a trap: the official ships two sets per mode -- `iconV2` fills
the 20px box (menu rows), `iconV2Small` is drawn smaller inside it (footer
button). The wrong set reads as "the icon is too big".

`extract-icons.mjs` takes `ComponentName=bundleFunction` pairs, in that order.

## 4. Visual diff

Screenshot the same region in both, at the same viewport width, and compare
side by side. The reference screenshots the user supplies are authoritative; the
extension also ships real ones at `resources/walkthrough/*.png`.

Sizing matters: compare at the width the user actually runs (a sidebar is
~380-800px). A component judged at the wrong width will look wrong for reasons
that have nothing to do with the code.

## 5. Report honestly

Report as a table: element, expected, actual, verdict. State the count that
matched and the count that did not. Never round a partial result up to "matches".

Colour is the one intended difference: Forge is Pajamas purple where Claude Code
is orange. That is by design and is not a parity failure — but **everything
else** (structure, spacing, typography, iconography, copy, states) should be
indistinguishable, and should be measured.

## Reference extraction cheat-sheet

The official bundle is minified but very readable once you know the shape.

- **Find a module's classes**: class names are `name_HASH`; the hash identifies
  the source module. Group by hash to recover component boundaries.
- **Find the markup for a module**: its CSS-module map is a single object
  literal, e.g. `var Q7={inputWrapper:"inputWrapper_cKsPxg",...}`. Grep for the
  map variable (`Q7.`) to find the JSX that uses it. That gives exact element
  tags, attributes and nesting order.
- **Find an icon**: icons are small components returning inline `<svg>`. Grep the
  component name and pull the `d:"..."` path data.
- **Find copy**: string literals are intact. Grep the visible text.

Structure recovered this way is authoritative. Structure inferred from CSS alone
is a guess, and guesses have been wrong here — a `<fieldset>` read as a `<div>`,
a `<legend>` read as an absolutely positioned span.
