# Forge's own design: where it departs from the official UI on purpose

Forge's webview is a port of the official Claude Code UI, measured element by
element against the official stylesheet (`CLAUDE.md` rules 2, 4 and 6). The places
listed here differ **on purpose**. Each one was the user's decision. A parity pass
must not "fix" them back: measure them against the baselines below instead.

The long-standing ones, for completeness: colour (Pajamas purple where Claude Code
is orange), Forge's fonts (Anthropic Sans, GitLab Mono), the terminal surface for
tool input and output (`forge-terminal.css`), Mermaid diagrams, markdown link and
blockquote colour, and the effort heat tint.

## 2026-09-19: the user's design requests

Four of the five depart from the official; the first one returns to it. The rules live in `src/webview/src/styles/forge-design.css`, loaded last. The
markup changes are in the components named below.

| # | What | Official | Forge | Where |
| --- | --- | --- | --- | --- |
| 1 | Header icons | History, then New session | **the same** -- Forge had them the other way round (an earlier reference); the swap returns to the official order | `pages/ChatPage.vue` |
| 2 | Send button glyph | a thin up arrow | a **forged arrowhead with three sparks** at its foot; on hover the arrow lifts and the sparks flare (no motion under reduced motion) | `forge/icons/ForgeSendIcon.vue`, `forge-design.css` |
| 3 | Model menu: effort row | no divider, no icon | a **divider** above it and the **effort (barbell) glyph** before "Effort", as the official *Modes* menu's effort row has them | `ModelSelect.vue` |
| 4 | Model menu: rows | name and description | **capability chips** after the name: Max, Ultracode, Fast, only where the CLI lists them (`forge/effort.ts` `modelCapabilities`); the current model gets a brand edge and a heavier name | `ModelSelect.vue`, `forge-design.css` |
| 5 | Composer placeholder | "Ask Claude to edit…" / "ctrl esc to focus or unfocus Claude" / "Queue another message…" | the same three states in Forge's voice ("What shall we forge today?", a rotating line plus "ctrl esc toggles focus", "The iron’s hot — queue another message…") with a slow **glint** through the text | `forge/composerVoice.ts`, `forge-design.css` |

What stays official in all five: the elements' own classes and sizes (the send
icon keeps `sendIcon`, the rows keep `modelItem`), the rows and what they do, and
the placeholder's three states and shortcut.

## 2026-09-22: the endpoint welcome gate

Ported from the official login page (module `Eg8KCQ`), whose `fg-welcome__*`
rules are used as written. Everything Forge adds sits on `forge-welcome__*`
classes that match the ported geometry **by value** rather than overriding it
(rule 4).

| # | What | Official | Forge | Where |
| --- | --- | --- | --- | --- |
| 6 | The terminal command | a bare `<code>claude</code>` | `$ forge` in a hairline chip, the sigil dimmer than the command | `EndpointWelcome.vue` |
| 7 | The gate's summary | no equivalent; the official gates on login, and a login either worked or it did not | a two-column table of **endpoints and how many of their models answered**, above the buttons | `EndpointWelcome.vue`, `forge-welcome__report*` |
| 8 | The gate's exits | one: log in | three, by state: set one up, check health, or **skip to chat**, the last two carrying drawn marks | `EndpointWelcome.vue`, `utils/endpointWelcome.ts`, `SignalIcon.vue`, `ArrowRightIcon.vue` |
| 9 | First-run gate on the empty state | the first screen is always the fixed opening tip | the endpoint **setup card beats** the gate; the topic rotation still waits | `utils/announcements.ts`, `nextWelcomeCard` |

The `$` is furniture rather than something you type, so it sits at 0.55 opacity
and is `aria-hidden`: a screen reader should hear "Run forge in terminal", not
"Run dollar forge in terminal".

Forge's gate asks a question the official's cannot: *is there anything at the
other end?* An endpoint can exist, parse, resolve and connect, and still serve
nothing. One aggregating account listed 101 model ids of which 28 answered, 60
returned 404 and 10 accepted the request and never replied. "You have an
endpoint" is not an answer to that, so the page reports what was measured.

**A table, because it is a measurement.** A bare `0` says nothing about what it
is `0` out of, and a list gives the reader no column to compare down. It is a
real `<table>` with a `<thead>`, the count as `n of m`, tabular figures so the
column does not wobble, and a status dot on the Pajamas hues. The heading
`ANSWERING` is the part that makes the number mean something.

**The zero is the verdict, so the zero carries the colour.** A dead row is
`--forge-danger` on the count and the dot; a live one `--forge-success`; an
unchecked one recedes to the secondary foreground. All three resolve through the
token layer, because `lint:brand` fails the build on a colour named in a
component.

**Three slabs are not three equal choices.** One sets an endpoint up; the other
two are what you do about the one you have. The primary keeps the official's
`.fg-welcome__fullWidthButton`; the other two sit side by side on Forge-only
classes. **Check health** leads with a signal glyph, arcs radiating from a
point, because the action reaches out to the table above and waits to hear back.
**Skip to chat** trails with an arrow, because it moves you past the page rather
than acting on it.

**"Skip to chat" softens a gate that was deliberately hard.** A gate keyed on a
measurement can be held up by a *wrong* measurement, and a hard gate on a wrong
verdict strands the user worse than not checking at all. So the skip is
remembered per workspace and **lapses the moment a later sweep finds anything
healthy**, which keeps it from silencing a real verdict that arrives later. The
composer stays live behind it on purpose: a model marked dead may well answer,
and one that does not reports it through the same path every send failure uses.

**The setup card beats the first-run gate** because a brand-new install with no
endpoint is exactly who it is for, and a setup prompt that waits until after the
first message arrives after the failure it was meant to prevent. It does not
advance the rotation, and it retires for good on dismiss: running against
Anthropic directly is a normal way to use Forge and a permanent nag would be
wrong.

### Baseline for this page (2026-09-22, harness, `probe-oracle.js`, `.fg-welcome__container` at 900x1000)

| What was measured | Result |
| --- | --- |
| Every **official** element, Forge-only ones removed from the DOM | **10/10 clean, 0 structural rows** |
| The page as it ships | 35 checked, 7 clean, **17 structural rows**, 7 colour |

All 17 rows are the three Forge-only additions above and nothing else: the
report table with its `thead`/`tbody`/`th`/`td`/`span`/`code`, the two
`forge-welcome__action` buttons with their SVGs, and the `$ forge` chip with its
sigil. The official page has no element in any of those positions, so every
property of them reads as a diff by construction.

Three rows name an official element (`fg-welcome__baseState`,
`fg-welcome__methodSelection`, `fg-welcome__terminalNote`) and differ **in
`height` only**, which is those additions taking up space, not a styling
divergence. Removing them returns all three to clean, which is the control.

`welcome` had to be added to `MODULES` in `scripts/port-official-css.mjs`
(hash `Eg8KCQ`) for any of this to mean anything. Without it the harness serves
no `fg-welcome__* -> *_Eg8KCQ` mapping, the oracle compares the page against
browser defaults, and reports 23 structural rows with nothing clean -- an
entirely spurious number.

## Baselines after these changes (2026-09-19, harness, `probe-oracle.js`)

The oracle clones Forge's DOM into a page that loads only the official
stylesheet, so a Forge-only element (a chip, a spark) is drawn there unstyled and
reads as a diff. What must stay clean is every **official** element.

| Window | Result | What the non-clean rows are |
| --- | --- | --- |
| `.fg-shell__header` | **15/15** | none -- the official order |
| `.fg-composer__inputWrapper` (idle, Send disabled) | **30/33** | the three sparks' opacity (0.35 while Send is disabled: `forge-design.css`). The placeholder is a pseudo-element, which the oracle does not measure. |
| `.fg-commandmenu__menuPopup`, model menu, chips set aside (`display:none` on `.forge-model-chips`, which travels with the clone) | Sonnet **53/73** · Opus **56/76** · Haiku **37/57** | the hidden chips' own styling, and the current model's name at weight 600. Every official element -- popup, list, rows, the divider, the effort label and glyph -- is clean. |

A row with chips is exactly as tall as one without (39.2px in the harness): the
chips sit inside the name's line box.
