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

## 2026-09-19: the permission prompt's risk reason (A3)

| # | What | Official | Forge | Where |
| --- | --- | --- | --- | --- |
| 6 | Permission prompt | says only *that* it is asking | a **risk note** naming what is dangerous and which path triggered it, when the command-risk classifier found something | `PermissionRequestModal.vue`, `forge-design.css` |

The official host has no risk classifier, so there is nothing to match here.
"Would remove `~/.ssh`, a credential store" is actionable where a generic
warning is not.

Three things keep it from becoming noise or breaking the port:

- **It appears almost never.** Ordinary work assesses as Safe and renders
  nothing. A banner on every prompt would be wallpaper within a day.
- **Warning, not danger.** The catastrophic cases never reach a prompt — they
  are refused outright — so everything that gets here is a real question rather
  than a verdict.
- **No ported selector changes.** The note is a sibling inside the existing
  description block, because `permission.css` reaches for
  `> .permissionRequestHeader` and first-child chains; an extra wrapper would
  quietly stop those rules matching. It sizes in `em` off the inherited chat
  font size for the same reason rule 4 gives.

A risky command also pre-selects the declining button, by passing the
classifier's `suggestedDefault` through the official `defaultToNo` flag rather
than adding a second mechanism.

## 2026-09-19: the claim-check badge (A4)

| # | What | Official | Forge | Where |
| --- | --- | --- | --- | --- |
| 7 | Final assistant message | nothing | a **claim-check note** — "3 of 4 claims verified — no tool call for `src/c.ts`" — when the closing summary claims work that has no matching tool call | `Messages/AssistantMessage.vue`, `pages/ChatPage.vue`, `core/claimCheck.ts`, `forge-design.css` |

The official host has no equivalent. This matters most on self-hosted models: a
32B model claims completion it did not achieve far more often than Claude does.

What keeps it from becoming noise:

- **It appears only on disagreement.** No claims, or every claim verified, and
  nothing renders. A badge on every message is decoration.
- **Only the final message of a finished turn.** Mid-turn it would flag work
  that has not happened yet.
- **Only cheap, high-signal claims** — files edited and tests run, not NLP over
  prose. A checker wrong often enough is not trusted when it is right.
- **Honest failures are never flagged.** "I could not update `config.ts`" and
  "you should update `config.ts`" are not claims, and flagging either would
  accuse the model of lying for telling the truth.
- It is quiet by design: a note beside a finished answer, not an alarm. It says
  what is missing and leaves the judgement to the reader, because the checker
  knows what tools ran, not what was true.

The badge sits inside the message row so the timeline rail's sibling rules
(`.timelineMessage + .timelineMessage`) are untouched, and sizes in `em` off the
inherited chat font size.

## 2026-09-20: the welcome page's three scoped overrides

Found by measuring, not by reading: the empty state reported **6 structural
diffs out of 122 elements**, and every one of them traced to a Vue **scoped
style** outranking a ported official rule. A scoped selector carries an extra
attribute, so `.fg-wordmark[data-v-…]` is (0,2,0) and beats
`.fg-emptystate__logo svg` at (0,1,1) — which is precisely the trap `CLAUDE.md`
rule 4 describes. All three are intended; none was written down, so the oracle
kept reporting them as defects.

| # | What | Official | Forge | Where |
| --- | --- | --- | --- | --- |
| 8 | Wordmark size | the logo slot fixes its SVG at `width: 120px` → 120 × 34.78 | the SVG keeps its own `138 × 40`, **15% larger** | `ForgeWordmark.vue` |
| 9 | Mascot shrink | `flex-shrink: 1` | `flex-shrink: 0`, so the hammer does not squash in a narrow panel | `RandomTip.vue` (`.fg-hammer`) |
| 10 | Terminal banner | `position: static` | `position: relative; z-index: 3`, lifting it over the composer's gradient | the empty state's banner container |

### Why #8 is right, with the measurement

Scaling the wordmark to the official 120px is ×0.8696, and the mark is drawn
with `shape-rendering: crispEdges` on whole user units. Tested at the two common
device-pixel ratios: at **dpr 1 and 2 the native 138px lands every voxel edge on
a whole device pixel, and 120px lands none of them**. The `<text>` beside the F
is resampled at the same time, so "orge" stops matching the rasterisation of the
rest of the UI's text. The cost of parity here is a visibly softer mark, which
is the wrong trade for a logo.

Neutralising the override confirms the rest of the port is exact: every
measurement snaps to the official value (svg 120 × 34.78 vs 34.775, logo box
39.88 vs 39.875, `main` 441.84 vs 441.837) and the oracle goes from 6 diffs to
2. So the 15% is the *only* thing that differs, and it differs on purpose.

### What stays official

The layout itself is untouched, including the part that looks like a defect and
is not: `main { flex: 1; justify-content: center }` centres the mascot in all
remaining space, which at a tall viewport leaves **60% of the page empty**
(measured: 164.7px above the tip block, 172.8px below, over a 559.7px canvas).
The official does exactly the same. All three masses share one optical axis
(wordmark 289.6, mascot 289.65, tip 289.6, viewport centre 289.5), and the tip
block sits 7.5px below the canvas centre, which is below the threshold of
noticing.

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

| `.fg-emptystate__container` (welcome page) | **120/122** | divergences #9 and #10 above (the mascot's `flex-shrink`, the banner's `z-index`). With #8's override also neutralised the count is 120/122; with it in place, 116/122. Every other official element is clean. |

## 2026-09-20: code blocks, and the Endpoints row

| # | What | Official | Forge | Where |
| --- | --- | --- | --- | --- |
| 11 | Markdown code blocks | no highlighter at all, no header | **syntax highlighting** plus a header carrying the **language** and a **soft-wrap toggle** | `utils/codeHighlight.ts`, `blocks/TextBlock.vue`, `forge-design.css` |
| 12 | "/" menu, Customize | no endpoint concept | an **Endpoints** row, beside MCP servers and Hooks | `ButtonArea.vue` |

### #11, and why it is a divergence rather than a fix

Measured before changing anything: the official bundle contains **zero**
highlighters (no hljs, shiki, prism or refractor) and its entire code-block
module is four CSS rules, none of which colours a token. The 59 "highlight"
matches in `index.js` are all Monaco *editor settings* strings. So a flat
monospace fence is faithful — it is simply also the first thing anyone notices
in a tool whose main output is code.

Three things keep it safe and in-theme:

- **Escaping is unconditional.** A fence is untrusted model output, and
  treating the highlighted and unhighlighted paths differently is how an
  injection gets through. Both return escaped HTML.
- **No auto-detection.** `highlightAuto` guesses, and a wrong guess colours a
  shell script as Perl — which reads as a bug rather than as the absence of a
  feature. An unknown fence stays plain.
- **Colour goes through the token layer.** `highlight.js` decides *what* a
  token is; `--forge-code-*` decides what colour, aliased onto the terminal's
  own stops so a `for` loop is the same purple in a fence as in a shell row.
  `lint:brand` still passes.

Languages are registered individually rather than through the barrel, which
would pull ~190 grammars into the webview bundle.

One bug this introduced and fixed in place: moving the copy button into the
header made `button.parentElement.querySelector('pre')` look in the wrong
element, so copy silently returned "". It uses `closest(...)` now.

### #12

The official host has no endpoint concept, so there is no row to match. It sits
in Customize beside MCP servers and Hooks because it is the same kind of
thing — where the session's capabilities come from. It opens the endpoint
picker, which lists every profile that parses and carries an
"Add or edit endpoints…" entry into `settings.json`; without that the picker is
a dead end for anyone who has not written a profile yet, which is everyone the
first time. `forge.selectEndpoint` was added to the `open_config_file`
allow-list, which is what keeps the webview from being a general command runner
(B3); the command opens a picker and cannot write anything on its own.

## 2026-09-20: permission rule text

| # | What | Official | Forge | Where |
| --- | --- | --- | --- | --- |
| 13 | Permission rules dialog, rule text | `var(--app-monospace-font-size)` → `var(--vscode-editor-font-size, 12px)`, line-height `normal` | capped at **0.92em** with a 1.45 line-height and -0.01em tracking; the source and reason lines step down to 0.88em | `forge-design.css` |

The port itself is exact -- `probe-oracle` reports **62 of 62 clean** on the
open dialog -- and it still read badly, which is the interesting part. The
official sizes rule text from the *editor* font size, and VS Code's default for
that is **14**, so the pattern rendered larger than the 13px body around it.
Monospace is already wider per character than the sans beside it, and
`overflow-wrap: anywhere` then broke patterns mid-token:
`WebFetch(domain:docs.anthro` / `pic.com)`.

Measured after: rule text 14px → **11.96px**, and rules that wrap went from
several to **0 of 7**. The dialog now fits its own content, so the explanatory
footer is visible without scrolling for the first time.

The font stays GitLab Mono. These are literal match patterns where `:*` and the
exact spacing carry meaning, and setting them in Anthropic Sans would make a
pattern read as prose. Sized in `em` rather than px, so it still follows the
chat base per rule 4.

## 2026-09-20: the endpoint setup card, and the cube in VS Code's chrome

| # | What | Official | Forge | Where |
| --- | --- | --- | --- | --- |
| 13 | Empty state, no endpoint | no endpoint concept | an **endpoint setup card** holds the card slot until an endpoint exists or it is dismissed | `utils/announcements.ts`, `ENDPOINT_SETUP_CARD` |
| 14 | First-run gate | the first screen is always the fixed opening tip | the setup card **beats** the gate; the rotation still waits | `utils/announcements.ts`, `nextWelcomeCard` |
| 15 | Chrome icons | one solid `claude-logo.svg` | the **voxel** cube, the same `markPaths(0.35)` the wordmark draws | `scripts/gen-cube-icon.ts` |

### #13 and #14, and why setup is not an announcement

`WELCOME_CARDS` rotate, alternate with tips, and exist to introduce a feature --
so the official's first-run gate is right for them: the very first screen should
be the opening tip, not a feature pitch. Setup is a different kind of thing. A
brand-new install with no endpoint is exactly who the card is for, and a prompt
that waits until after the first message arrives after the failure it was meant
to prevent. So it is checked *before* the gate, and it does not advance the
rotation cursor, so the feature cards resume from the start once it is gone.

It retires permanently on dismiss, because running against Anthropic directly is
a normal way to use Forge and a permanent nag would be wrong. It also disappears
on its own the moment `init` reports a profile, with no dismissal needed.

Measured with `probe-oracle.js` against the notice it is built on: **11/12
clean**, the one row being the identity `transform` left by finishing the
entrance animation before probing -- an artifact of the measurement, not a diff.

### #15, with the measurement

Asked for by name: the mark in VS Code's chrome should be the mark people see on
the welcome page. It is a real trade and it is worth writing down. Masked and
compared at 16 / 20 / 24 / 32px, the voxel gaps are sub-pixel below about 24px,
so the mark reads as texture rather than as three clean faces; `markPaths(0)`
stays crisper there. Brand identity won: a mark nobody recognises is worse than
one that is slightly soft at 16px.

## 2026-09-21: the welcome gate's terminal line

| # | What | Official | Forge | Where |
| --- | --- | --- | --- | --- |
| 16 | The terminal command | a bare `<code>claude</code>` | `$ forge` in a hairline chip, the sigil dimmer than the command | `EndpointWelcome.vue` |

The `$` is furniture rather than something you type, so it sits at 0.55 opacity
and is `aria-hidden`: a screen reader should hear "Run forge in terminal", not
"Run dollar forge in terminal". The chip is a new `forge-welcome__*` class, not
a scoped override of the ported `.fg-welcome__terminalLink code`, which is left
exactly as the port wrote it.

## 2026-09-21: the side-bar hand-off

| # | What | Official | Forge | Where |
| --- | --- | --- | --- | --- |
| 17 | Leaving the sessions view for the chat | the official *does* have an activity-bar session list (`KW0`, module `djirOA`), but it opens a session in an editor tab and never closes a side bar | the history eases out towards the chat's side while the host reveals it, then the panel closes | `App.vue`, `forge-design.css`, `handleRevealChat` |

(Row 17 first said the official had no activity-bar history. It has one; see
the 2026-09-23 section below for what that changed.)

Forge puts Past Conversations in its own activity-bar container, so "New
conversation" is a move *between two panels*: the chat appears in the secondary
side bar and the history should stop taking up the primary one. Closing it in
the same tick made that read as two unrelated snaps — something appearing on
the right, something vanishing on the left, the editor jumping between them.

VS Code animates neither event and exposes no hook to, so the only part of the
move a webview can draw is its own exit. The history does that: 110ms, a 10px
drift to the right and a slight recede from the far edge.

**110ms, revised down from 190ms** after the first install that could actually
run it: "the closing time is kinda long". 190ms had been tuned so the fade
could be *seen*, and that was the wrong target — every millisecond of it is a
millisecond the side bar is still there after you asked it to go. Because the
transform is front-loaded (below), the travel still lands early inside the
shorter window; what was cut is the tail nobody was waiting on.

The two properties ride different curves, and measuring is what found it.
Transform uses `cubic-bezier(0.32, 0.72, 0, 1)`: front-loaded, 8px of the 10px
inside the first 50ms, so the move is over before it can feel like a wait.
Opacity is **linear**. The first attempt shared the front-loaded curve, and
sampling it frame by frame showed opacity already at 0.07 by 86ms: the panel
emptied out and then sat there for another 100ms before closing. An even fade
reaches zero exactly as the panel is taken away, so there is no dead beat in
the middle.

Two things keep it honest:

- **The host waits.** `SIDEBAR_HANDOFF_MS` in `handlers.ts` is paired with
  `--forge-handoff-duration`; closing sooner would cut the fade off mid-way and
  reintroduce the snap. The pairing is asserted in `openConfigHelp.spec.ts`,
  which reads the duration out of the CSS rather than pinning a number — that
  is what makes the value above safe to retune.
- **The request goes out in the same frame as the animation**, not after it, so
  the exit never adds to how long the click takes to do anything.

Under `prefers-reduced-motion` there is no fade and no travel — the history
stays put until the panel closes. Fading it instantly instead would leave an
empty side bar for the length of the hand-off, which is worse than no
transition.

The exit is deliberately one-sided: the chat gets no matching entrance, because
its webview is often already alive and merely revealed, so a mount animation
would play on some clicks and not others.

## 2026-09-21: Forge introduces itself as Forge

Asked "hi", it replied *"Hello! I'm Claude, an AI assistant created by
Anthropic."* Nothing was wrong with the wiring — that is simply the
`claude_code` preset's own identity, and Forge was appending editor context to
it without ever naming itself.

`VS_CODE_APPEND_PROMPT` in `ClaudeSdkService.ts` now opens with an Identity
section: **Forge, made by Lemino**, with a sample greeting in the product's own
voice ("What are we forging today?") offered as spirit rather than a script, so
it does not recite the same sentence every time.

It leads the append rather than trailing it. The preset's version of who it is
arrives first, and the paragraph that contradicts it should not be sitting
three sections below the markdown-link formatting rules.

**Branding, not deception.** The same block tells it to answer honestly when
asked which underlying model it runs on. Forge is the product; the model is not
a secret, and a coding agent that dodges a direct question about what it is
would be a worse tool. `test/identityPrompt.spec.ts` asserts that sentence
specifically, so the honest half cannot be dropped while the branding half
stays.

**Who Lemino is** (added 2026-09-24, in the user's words): "Lemino is Mohamed
Amine Said, who works at KPIT Tunisia. Lemino created Forge, the coding agent
you are, which runs inside Visual Studio Code to help with software engineering
tasks. When asked who Lemino is, say so." It sits in the same Identity section,
after the honesty sentence, and the spec checks it is there, whole.

## 2026-09-21: the spinner says when the endpoint is not answering

Reported by pulling the wifi and sending a message. The log:

```
[relay] omni-routing: upstream HTTP 502
[SDK ERROR] API error (attempt 4/11): 502 … ENOTFOUND opencode.ai
… 13 of these, over several minutes …
[engine] turn 5 end (… stop=end_turn resultLen=0)
[Watchdog] This turn has produced no output for 370s.
```

The UI, throughout: a randomly chosen verb. Then, once a provider finally
answered with an empty completion, the CLI's own
`[Your previous response had no visible output. Please continue and produce a
user-visible response.]` nudge, rendered in a user bubble — so it read as
something the user had typed, twice.

| # | What | Official | Forge |
| --- | --- | --- | --- |
| 12 | Working indicator during an API retry | the verb, unchanged — `api_retry` is ignored | **the status and the attempt count**, in warning colour, replacing the verb | `WaitingIndicator.vue`, `core/retryStatus.ts`, `forge-design.css` |

Every one of those 13 retries had already arrived in the webview as
`system`/`api_retry` (`SDKAPIRetryMessage`, `sdk.d.ts` L3361), carrying
`attempt`, `max_retries` and `error_status`. `Session` handled only
`subtype === 'init'` and dropped the rest.

**Why diverge here.** Ignoring the subtype is defensible for the official, whose
endpoint is `api.anthropic.com`. Forge's entire purpose is pointing the CLI at
gateways and self-hosted servers, where a dead upstream is an ordinary Tuesday
— the same reasoning that justifies the claim-check badge (#7) on self-hosted
models.

Three choices worth keeping:

- **The HTTP status leads.** "502" is the difference between "my gateway is
  down" and "my gateway's upstream is down", and the user is the only one who
  can act on that. `error_status` is `null` for connection errors that never got
  a response, and then the wording changes to "not responding" rather than
  inventing a code.
- **Warning, not danger.** The CLI is still retrying and may well succeed. This
  is "something is wrong", not "it has failed".
- **No typing animation.** The verb types itself in because it is a mood; this
  is a fact, and a fact that performs is harder to read.

Cleared on the first `stream_event`, not on `result` — the first streamed chunk
is the moment the endpoint came back and the notice stopped being true.

**Not addressed here:** the empty-completion nudge is the CLI's own text and
Forge renders it faithfully; and the watchdog's "no output for 370s" is still
log-only.

## 2026-09-22: the welcome page's endpoint health table

| # | What | Official | Forge | Where |
| --- | --- | --- | --- | --- |
| 18 | The gate's summary | no equivalent; the official gates on login, and a login either worked or it did not | a two-column table of **endpoints and how many of their models answered**, above the buttons | `EndpointWelcome.vue`, `forge-welcome__report*` |
| 19 | The gate's exits | one: log in | three, by state: set one up, check health, or **skip to chat**, the last two carrying drawn marks | `EndpointWelcome.vue`, `utils/endpointWelcome.ts`, `SignalIcon.vue`, `ArrowRightIcon.vue` |

Forge's gate asks a question the official's cannot: *is there anything at the
other end?* An endpoint exists, parses, resolves and connects, and still serves
nothing. One aggregating account listed 101 model ids of which 28 answered, 60
returned 404 and 10 accepted the request and never replied. "You have an
endpoint" is not an answer to that, so the page reports what was measured.

**A table, because it is a measurement.** The first cut was a description list,
on the argument that two columns of name-and-number need no heading. That was
wrong twice over: a bare `0` says nothing about what it is `0` out of, and a
list gave the reader no column to compare down. It is now a real `<table>` with
a `<thead>`, the count as `n of m`, tabular figures so the column does not
wobble, and a status dot on the Pajamas hues. The heading `ANSWERING` is the
part that makes the number mean something.

**The zero is the verdict, so the zero carries the colour.** A dead row is
`--forge-danger` on the count and the dot; a live one is `--forge-success`; an
unchecked one recedes to the secondary foreground. All three resolve through the
token layer onto Pajamas, because `lint:brand` fails the build on a colour named
in a component.

**Three slabs are not three equal choices.** Stacking "Set up an endpoint",
"Check health" and "Skip to chat" as identical full-width buttons said they
were, and they are not: one sets an endpoint up, the other two are what you do
about the one you have. The primary keeps the official's
`.fg-welcome__fullWidthButton`; the other two sit side by side on Forge-only
classes that match its geometry by value rather than overriding it (rule 4).

Each carries one drawn Heroicons-24-outline mark in the idiom `CheckIcon.vue`
already uses, positioned to say what kind of action it is. **Check health**
leads with a signal glyph, arcs radiating from a point, because the action
reaches out to the table above and waits to hear back; a heart or a stethoscope
would be a metaphor about the word rather than about the work. **Skip to chat**
trails with an arrow, because it moves you past the page rather than acting on
it, and it is the one thing here that moves: 2px on hover, on the same
front-loaded curve the side-bar hand-off uses. Hovering the check tints it
`--forge-accent`, Pajamas blue, which is what interactive means everywhere else
in the token layer.

**Copy cut to the bone**, at the user's request: one line of explanation per
state, one note under the actions naming the cost, and nothing else. The page is
a decision point, not a document; every line is one the reader clears before
they can act.

**"Skip to chat" softens a gate that was deliberately hard.** `ChatPage.vue`
said so in as many words: *"Neither dismisses it. It is a gate."* The health
verdict is the reason to add an exit. A gate keyed on a measurement can be held
up by a *wrong* measurement (the gateway was down for the minute the sweep ran,
the token had expired, the laptop was on the wrong network) and a hard gate on a
wrong verdict strands the user worse than not checking at all. So the skip is
remembered per workspace and **lapses the moment a later sweep finds anything
healthy**, which keeps it from silencing a real verdict that arrives later. The
composer stays live behind it on purpose: a model marked dead may well answer,
and one that does not reports it through the same path every send failure uses.

### #17: the welcome art is a light/dark pair

`ForgeWelcomeArt.vue` renders two `<img class="fg-welcomeart">` inside the
official `.fg-welcome__asciiArtContainer`, one per theme, and hides the one that
does not match (`display: none`). The official renders a single `<img>` there
and sizes it `width: 100%; height: auto`, which is what Forge's visible image
does too. The oracle's official side has no `.fg-welcomeart` rules, so it shows
*both* images and the container comes out two images tall (2 x 189.48px plus
the inline gaps = 387.34px, against Forge's 189.48px). That height reaches
`fg-welcome__baseState`. The `width: 100%` on the Forge side is the hidden
image's specified value, not a sizing difference. Forge-only classes on
Forge-only elements, so no ported rule is overridden (rule 4).

**The pair is cut from one drawing** (2026-09-24, the hammer-and-cube art the
user supplied on a black background): `python scripts/gen-welcome-art.py
<source.png>` writes both PNGs at 1500px wide. The coloured objects (cube,
fragments, hammer, handle) are kept as drawn and opaque in both cuts, dark faces
included, found by colour and then filled solid; everything else is ink whose
opacity is its brightness, white in the dark cut and black in the light one. A
256-colour palette keeps each file near 200 KB. The drawing is 1500x643 where
the previous one was 1500x646, so the container heights measured above are the
old art's, off by about a pixel.

### Baseline after this change (2026-09-23, harness, `probe-oracle.js`, `.fg-welcome__container` at 900x1000)

| What was measured | Result |
| --- | --- |
| The page as it ships (`?endpoints=2&health=none`) | 37 checked, 6 clean, **19 structural rows**, 7 colour |
| Forge-only elements removed from the DOM | 12 checked, 8 clean, **3 structural rows** |
| Control: `.fg-shell__header` | **15/15 clean, 0 structural** |

Of the 19, **14** are Forge-only elements: the report table with its
`thead`/`tbody`/`tr`/`th`/`td`/`span`/`code`, the `forge-welcome__actions` row
with its buttons, SVGs and paths, and the `$ forge` chip with its sigil. The
official page has no element in any of those positions, so every property of
them reads as a diff by construction.

The other **5** name an official element. Two of them, `fg-welcome__methodSelection`
and `fg-welcome__terminalNote`, differ in `height` only and go clean once the
Forge-only elements are removed, so they are those additions taking up space.
The three that survive the control are all #17: the art `img`, and the height it
gives `fg-welcome__asciiArtContainer` and `fg-welcome__baseState`. So every
`fg-welcome__*` rule the port wrote matches the official stylesheet.

`welcome` must be registered in `MODULES` in `scripts/port-official-css.mjs`
(hash `Eg8KCQ`) for any of this to mean anything. Without it the harness serves
no `fg-welcome__* -> *_Eg8KCQ` mapping, the oracle compares the page against
browser defaults and reports a large structural count with nothing clean. The
header control is what proves the mapping is live.

## 2026-09-23: the first-run page, the composer's controls, motion and Settings

Asked for directly: the welcome page redesigned "with the Anthropic design
system's UI/UX and the Pajamas palette", the footer buttons made one premium
set, transitions on everything that opens and closes, and a Settings page whose
text no longer crowds its buttons. Each is a Forge divergence; the structure
underneath stays the official one wherever a ported module exists.

| # | What | Official | Forge | Where |
| --- | --- | --- | --- | --- |
| 20 | Welcome page | login page (`Eg8KCQ`): art, two paragraphs, stacked buttons, a bare terminal line | same skeleton; a headline / lede / question hierarchy, `claude` and `settings.json` as chips, provider chips, the keychain promise on its own line with a lock, a busy state on the primary, the terminal offer as the chat page's banner in a card | `EndpointWelcome.vue`, `TerminalBanner.vue` (`command`, `card`), `LockIcon.vue`, `--forge-welcome-*` |
| 21 | Composer controls | "+" square, "/" circle, pill, bare-text mode; three hover styles | one set on the official geometry: "/" takes the "+" button's 5px square instead of a circle, and all four share one hover tint, a brand-tinted **open** state keyed on `aria-expanded`, one press (`scale(.94)`) and one focus ring | `forge-design.css` ("footer controls"), `aria-expanded` on "+" and "/" |
| 22 | Motion | `fadeIn .15s` on menu mount, nothing on close | menus rise 6px and settle on open and fall back faster on close (`forge-pop`), dialogs fade their scrim and lift their panel (`forge-dialog`), the sessions dropdown drops in; one curve (`--forge-ease-out`), three durations; all of it opacity-only under reduced motion | `forge-design.css` ("open and close"), `<Transition>` in `ButtonArea`, `ModelSelect`, `AddMenu`, `ForgeFlyout`, `ChatInputBox`, `ChatPage` |
| 23 | Settings controls | (Settings is Forge's own page) | 24px between a setting's text and its control, a 62ch measure, controls centred on label and description; buttons one geometry (28px, 6px corners, weight 500) with brand primary, quiet secondary, outline tertiary; switches on the accent, not success green | `SettingsCell.vue`, `Common/Button.vue`, `Common/Switch.vue` |
| 24 | Skills, Agents, MCP | none in the webview | list what the CLI will load and create it in a few prompts: **Create skill**, **Add from folder…**, **Create agent**, **Add server** | `ForgeItemsList.vue`, `SettingsTabSkills.vue`, `SettingsTabAgents.vue`, `SettingsTabMCPServers.vue`, `commands/customizationCommands.ts` |
| 25 | The line under the hammer | the opening tip until the first message is ever sent, then random tips | a different tip (or card) on **every** new conversation, never the one just shown; drawn from the existing tips and cards, nothing new written | `RandomTip.vue` (`rotate`), `utils/tipRotation.ts`, `nextWelcomeCard(…, { newConversation })` |

### #20, in the palette it was specified in

The page names Pajamas stops, so the tokens do too: purple-500 for the brand
and the primary fill, purple-400 for its hover on dark (purple-600 on light,
where white on the lighter stop drops under 4.5:1), gray-950 for the ground,
gray-900 for surfaces, gray-50 (`#ececef`) for text. gray-50 is not in today's
`neutral` scale, so `gen-pajamas-tokens.mjs` vendors it by name. High contrast,
dark and light, hands ground, text and borders back to the host.

The ported `fg-welcome__*` rules are not overridden: the page re-points the
tokens they paint with (`--app-primary-background`, `--forge-brand-strong`, …)
inside its own subtree, so the official rules still do the painting. The one
rule Forge does replace is the primary's hover, a brightness filter in the
official, because the specified hover is a Pajamas stop.

The illustration is kept as drawn. It gains a low purple glow where the drawing
already puts its purple, which breathes slowly once the page has settled: the
page's one authored motion. The copy rises in three short beats on first paint.
Everything stops under `prefers-reduced-motion`.

### Copy

Every spaced em dash in user-facing strings was replaced (27 strings: the
composer's placeholders, the retry notice, session status titles, endpoint and
diagnostics messages, Settings tooltips), including the sessions list's status
titles, which the official writes with one. That one is a deliberate departure.

Later the same day the user asked for the status-dot tooltips back as the
official has them, and for every em dash gone from the UI. Asked which should
win, they chose the official words joined by a comma: "Unread", "Open in a
tab", "Open in a tab, running", "Open in a tab, awaiting input" (the official
`dH0` uses a spaced em dash; the colon from the first sweep is gone). The sweep then went
past `src/`: the setting descriptions in `package.json`, the walkthrough's
first page, the claim badge's detail (now "· no tool call for …"), the
artifact line ("Published · Open artifact ↗") and the permission dialog's
settings-load error, which now puts the message in parentheses where the
official puts a dash. Code comments keep theirs; the model-facing browser
prompt copied from the official stays verbatim, since it is not UI.

## 2026-09-23: endpoint and model pairs, and the history side bar

Asked for directly: "remove anthropic defaults models. [the] user must set an
endpoint and a model together like genesis", "fix endpoints setup issues",
and "still having trouble with the window close up of the left side window,
the purple button for creating new conv sucks".

| # | What | Official | Forge | Where |
| --- | --- | --- | --- | --- |
| 26 | The model menu | the CLI's model table (Claude tiers, aliases, unavailable rows) | one row per endpoint profile, each the endpoint with its one model: the model's id as the label, the profile and host and its last health check as the description. No CLI table, no aliases, no custom models, no fallback to Anthropic | `pairRow` (`endpoints/models.ts`), `endpointModelRows` (`handlers.ts`), `ModelSelect.vue` |
| 27 | Picking a model | `set_model` writes `model` to `~/.claude/settings.json` and switches the live CLI | `set_model` selects that endpoint (`forge.endpointProfile`, `selection.ts`), with or without a channel; an open conversation resumes on it from its next message (`recycleIdleChannels`, `retireIfStale`) | `ClaudeAgentService.ts`, `Session.setModel` |
| 28 | Adding an endpoint | (none) | where it runs, name, address, API, key, then the model: listed with the key, embeddings dropped, a remote gateway's ids checked with one tiny request each, answering ones first; then one real check of the pair; then save and select. "Another model from <endpoint>" copies the connection and key | `setupFlow.ts`, `startPicker.ts`, `forge.addEndpoint` |
| 29 | Settings > Models | (Forge's page) | the pairs, with "In use", Use, and a switch that hides a pair from the menu; effort for the pair in use; limits. The Anthropic default-model dropdown, custom models and the alias routing section are gone | `SettingsTabModels.vue` |
| 30 | The history's "new" control | a borderless full-width "New session" row with the solid plus under a hairline (`D7.headerRow` / `newSessionButton`), plain-text empty list | the same row, ported (`fg-sessionmanager__*`), replacing the filled purple "Start a conversation" button and the header's new icon | `SessionsPage.vue`, `styles/official/sessionmanager.css`, `NewSessionRowIcon.vue` |

### Why the launch had to change, not only the menu

The profile's model never reached the CLI: the session launched with `default`,
and the relay forwarded that Claude id to a gateway that did not serve it. That
is the "first message fails" report. The launch now takes the pair's model
(`ClaudeSdkService.query`), and `relayEnvironment` puts it in every slot the CLI
picks a model from (`ANTHROPIC_MODEL`, the three `ANTHROPIC_DEFAULT_*_MODEL`
tiers, `CLAUDE_CODE_SUBAGENT_MODEL`), so background and subagent calls go to
the same endpoint. A selected endpoint that cannot start is an error the chat
shows (`EndpointUnavailableError`); it used to fall back to api.anthropic.com
without a word.

### The history hand-off, fixed rather than retuned

- The exit was set and never cleared, and the view is retained while hidden, so
  the history came back blank and dead. It is cleared when the view is shown
  again (`visibility_changed`, now sent by the host as the official does, with
  the page's own `visibilitychange` as the fallback), and at once if the reveal
  fails.
- A row dropped its session id: `reveal_chat` carries `sessionId` now, and the
  chat opens it with `activateSessionFromServer`.
- "Back to chat" started a new conversation; it now only reveals the chat.
- The side bar closes only when the request comes from the activity-bar view
  (`fromView`). The same page opened as an editor tab used to close Explorer.
- The host subtracts the time already spent revealing the chat from its wait,
  so a slow reveal no longer leaves an empty panel on screen.

### Copy

The status-dot tooltips use the official words with a comma where the official
has a spaced em dash ("Open in a tab, running"), the user's choice when asked.

## 2026-09-23: bypass permissions, a faster hand-off, and Settings buttons

Asked for directly: "the button 'by pass permission' cant be selected, please
make it selectable and the logic behind it must be there", and "speed up the
closing of the left window to move to the right windows (right window must also
appear with premium transition not from the no where and it must be fast)".

| # | What | Official | Forge | Where |
| --- | --- | --- | --- | --- |
| 31 | "Bypass permissions" in the mode menu | the row appears only once `claudeCode.allowDangerouslySkipPermissions` is on; the launch passes the SDK's `allowDangerouslySkipPermissions`, and a bypass launch while it is off is downgraded to `default` | the row is always there (hidden only by a managed `disableBypassPermissionsMode: "disable"`). Choosing it while the setting is off sends `enable_bypass_permissions`: the host asks with a modal warning (the official setting's own words), writes `forge.allowDangerouslySkipPermissions` to user settings on yes, and the conversation continues in bypass from its next message. The setting, the launch option and the downgrade are the official ones, ported | `ModeSelect.vue`, `ChatPage.vue` `handleModeSelect`, `handleEnableBypassPermissions`, `ClaudeAgentService.launchClaude`, `ClaudeSdkService` |
| 32 | The history's exit | (the official never closes a side bar) | 70ms, down from 110ms: opacity linear to 0, 10px travel towards the chat | `forge-design.css` `.forge-handoff`, `SIDEBAR_HANDOFF_MS` |
| 33 | The chat's entrance | (none) | when the history hands off, the chat arrives from the side the history left: a fade from 35% and 8px of travel, 170ms, front-loaded. The host says `arrive` before it reveals the view; the entrance is held at its first frame until the view is shown, then plays. Nothing plays under reduced motion | `forge-design.css` `.forge-arrive`, `App.vue`, `handleRevealChat` |
| 34 | Settings buttons | (Settings is Forge's own page) | the forge-style set: primary is the one accent, flat, with the bottom-only 8px radius; secondary is outlined with an 8px radius; tertiary is a text button. No shadows or glows. This replaces row 23's geometry for colour and corners | `Common/Button.vue` |

### Measured (harness, `?page=sessions&mockSessions`, sampled every frame)

- The exit, from a click on a conversation row: opacity 0.76 at 29ms, 0.52 at
  46ms, 0.29 at 62ms, 0.05 at 79ms, 0 at 96ms (one frame of latency after the
  click, then the 70ms fade).
- A conversation row used to hold that first frame back by about 130ms (frames
  at 17ms, then 151ms), while "New session" faded on time: the history view
  activated the session itself, which loaded its whole transcript into the
  view that was leaving. The standalone view now only hands the id over
  (`SessionsPage.vue` `openSession`); the chat opens it.
- The populated list (`?mockSessions`) had one structural diff, a scoped
  `align-items: center` over the ported `.sessionActions` rule. Removed: 39/39
  clean.
- The entrance, from the show signal: opacity 0.78 and 2.7px left at 40ms, 0.94
  at 70ms, 1 at 170ms, the class cleared by 260ms.

## 2026-09-24: the welcome art, and a button cut from it

Asked for directly: "update the initial welcome page image with this one" (a
new hammer-and-cube drawing on black), then "the button shape color doesnt
match the welcome page".

| # | What | Official | Forge | Where |
| --- | --- | --- | --- | --- |
| 35 | Welcome art | `welcome-art-dark.svg` / `-light.svg` | the user's drawing, cut into a dark and a light PNG by `scripts/gen-welcome-art.py` (see #17). The light cut is now actually shown on light themes: the scoped `:global(body.vscode-light) .fg-welcomeart--dark` compiled to `body.vscode-light` alone, so light themes had the white-ink cut | `resources/forge-welcome-*.png`, `ForgeWelcomeArt.vue` |
| 36 | The primary action | the ported `fullWidthButton primary`: the theme's button colour, 2px corners | a block of the art's cube: square corners, the cube's face colour with its lit top edge and shaded bottom edge (inset 2px / 3px), and its violet glow. Hover lightens the face, lifts 1px and widens the glow; pressing moves the shade to the top edge and sinks 1px. The provider chips lose their pill ends for the small radius the inline code chips use | `EndpointWelcome.vue`, `--forge-welcome-cta-*` |

### #36, colours sampled from the drawing

Not Pajamas stops, on purpose: the button has to read as part of the picture,
and Pajamas purple-500 (`#7b58cf`) is a softer, bluer lavender than the cube.
The cube's pixels, averaged by lightness band: face `rgb(106 42 182)`, lit edge
`rgb(185 84 243)`, shade `rgb(61 28 113)`. They live in `forge-tokens.css`
(the one layer allowed to name `rgb()`), the same on light and dark, as the
cube is. White on the face is 8.0:1, on the hover face `rgb(125 50 208)` 6.5:1.
High contrast keeps its brand fill and contrast border, with no bevel or glow.

The fill is not an override: the page re-points `--forge-brand-strong` (which
the ported `.fullWidthButton.primary` paints with) at the face token, as it
already did for purple-500. An override on `.forge-welcome__cta` lost to the
ported rule (same specificity, later in the cascade); measured, the button
stayed `rgb(123 88 207)` until the token moved.

**Measured** (harness, 2026-09-24): fill `rgb(106, 42, 182)` on dark and light,
text contrast 8.02:1, radius 0, height 36px; hover `rgb(125, 50, 208)`,
`translateY(-1px)`, glow 26px. `probe-oracle.js` on `.fg-welcome__container`
(no endpoint): 43 checked, 7 clean, 27 structural rows, all on the page's
Forge-only hierarchy (#20); the button's rows are this change (radius 0 vs 2px,
height 36 vs 29.6px).

## 2026-09-24: the welcome line, the hand-off, and the open file

Asked for directly: the line under the headline changed to "a definition of the
product in general"; "minimize the windows transition time from left to right
window, very very fast"; "make sure the extension sees my opened files and
selected lines".

| # | What | Official | Forge | Where |
| --- | --- | --- | --- | --- |
| 37 | Welcome lede | (login page copy) | "A coding agent in VS Code that reads, edits and runs your code, on the models you choose." (was "It does not have to talk to api.anthropic.com.") | `EndpointWelcome.vue` |
| 38 | The history's exit and the chat's entrance (#32, #33) | (none) | the side bar closes 30ms after the click **while** the chat is being revealed, not after the reveal (a slow reveal no longer adds its length). Exit 30ms, 6px; entrance 90ms from 80% opacity and 4px, played on the next frame instead of after 30ms | `handleRevealChat`, `SIDEBAR_HANDOFF_MS`, `forge-design.css`, `App.vue` |
| 39 | The open file at start | `FK` is empty until the first editor event | the editor already active when tracking starts is the first selection (no push), so a file open before the extension activated reaches the first message | `editorSelection.ts` `trackEditorSelection` |

The rest of the selection work is parity, not divergence: `editorSelection.ts`
ports `xd0` (keep the selection while focus is in a chat tab and a text editor
is still visible; ignore output, comment and diff editors; clear when the file
closes) and `get_current_selection` answers from it (`()=>FK`). The composer's
selection mention follows the official `oO`: lines as `Ri` reports them (they
are already 1-based; Forge added one again), and no range for a bare cursor.

## 2026-09-24: the production audit, Phase 1

Host behaviour where Forge is stricter than the official 2.1.270 on purpose.
The UI added here is parity, not divergence: the chat's error banner is the
official `errorBanner` markup read from `index.js` (`D0&&R("div",{className:u0.errorBanner,…})`),
measured with `probe-oracle.js` at 0 structural diffs (6 and 7 elements).

| # | What | Official | Forge | Where |
| --- | --- | --- | --- | --- |
| 40 | `open_url` | `openExternal` for any scheme | http, https and mailto only: links come from rendered model output, and `file:` or `command:` there must not run anything | `handleOpenURL`, `isOpenableUrl` |
| 41 | `open_file`, `open_diff`, `open_content`, `stat_path_request` | opens or stats whatever it is given | refuses UNC and device paths (a `stat` of `\\host\share` sends the NTLM hash on Windows), URIs, NUL bytes, oversized input | `webviewPaths.ts` |
| 42 | `apply_settings` to `userSettings` | a `settings.json` that does not parse is replaced by the patch | refused, file left byte-identical; writes are atomic | `writeUserSettings`, `settingsFile.ts` |
| 43 | ripgrep for `@` search | `rg` from PATH | the bundled `resources/ripgrep/x64-win32/rg.exe`, else `rg` from PATH | `resolveRipgrep` |
| 44 | Bypass permissions | the `claudeCode.allowDangerouslySkipPermissions` setting | `forge.allowDangerouslySkipPermissions` alone; `forge.cliArgs` refuses both bypass flags | `SETTING_OWNED_FLAGS` |
| 45 | `new_conversation_tab` | `editor.open(sessionId, initialPrompt)` | `forge.editor.open` with no arguments: an empty tab (the fork-into-a-tab branch is not ported) | `handleNewConversationTab` |

Matches the official, recorded so it is not "fixed" back: `untrustedWorkspaces.supported: false`
(the official's own declaration); `openNewInTab` is `!!panelTab`; "/" →
New conversation goes through `startNewConversationTab()` and Clear
conversation is always in place; `rename_tab` keeps 200 code points.

## 2026-09-24: the working indicator (recorded by the Phase 3 harness pass)

| # | What | Official | Forge | Where |
| --- | --- | --- | --- | --- |
| 46 | The working indicator | an animated glyph in `monospace`, in a 31px row | the voxel cube struck from stock (`ForgeCube.vue`), a canvas coloured from hidden CSS probes, so it takes the permission-mode tint; the row is 24.6px, 6.4px shorter | `WaitingIndicator.vue`, `ForgeCube.vue` |

`probe-oracle.js` on `.fg-chat__messagesContainer` with a transcript: 48
checked, 34 clean, 8 structural, all in the spinner row (its height, the
cube's canvas and probes). The row height is the one open question.

## 2026-09-24: the production audit, Phase 4 (the end-to-end run)

The run found eleven defects (see `docs/backend-wiring/results/63-production-audit-phase4.md`).
Most were Forge not doing what the official does, and now match it: Ctrl+Esc
blur (`focusFirstEditorGroup`), the @-mention subscription and its hidden-chat
hold, closing a disposed webview's channels, the "/" completion order, no
`view/title` menu. Two concern behaviour with no official counterpart:

| # | What | Official | Forge | Where |
| --- | --- | --- | --- | --- |
| 47 | Slash command descriptions | the CLI's text | "Claude Code" becomes "Forge"; "Claude" too, except Anthropic's products (the Claude API, Agent SDK, Developer Platform, Console), domains, and text about the model family (anything naming Anthropic) | `forgeVoice.ts` |
| 48 | Effort and thinking on an OpenAI-wire endpoint | no relay | `output_config.effort` becomes `reasoning_effort`; a request naming an effort without `thinking` (Thinking off) sends the endpoint's weakest rung | `wire/toOpenAI.ts`, `wire/reasoning.ts` |

## 2026-09-24: the production audit, Phase 6

| # | What | Official | Forge | Where |
| --- | --- | --- | --- | --- |
| 49 | Bypass permissions colour | the error foreground (with `auto`) on the send button's fill, the working indicator and the composer's focus ring | Pajamas deep red, its own role: `--forge-bypass` (red-700) for the glyph, ring and mode-menu tint, `--forge-bypass-strong` (red-800) for the fill; `auto` keeps the official colour | `forge-design.css` (bypass colour), `forge-tokens.css`, `ModeSelect.vue` |
| 50 | The Expert mode row | no such row: the mode menu is Manual, Edit automatically, Plan, Bypass permissions (plus Auto where offered) | an Expert row, first, with a mortarboard glyph in `--forge-expert` (Pajamas orange-400, gold; orange-300 in dark), a place first in the Shift+Tab cycle, and `set_expert_mode {channelId, enabled}` calling `applyFlagSettings({outputStyle: 'forge:Expert' \| null})`: the session's flag layer, no file written, re-applied after a relaunch. Expert runs in the `default` permission mode (it asks before each edit). Off mid-conversation, the CLI keeps its memoized system prompt and sends "The output style was reset to the default" instead (CLI 2.1.274) | `ModeSelect.vue`, `ChatPage.vue` (`handleModeSelect`, the cycle), `Session.ts` (`expertMode`, `expertApply`), `handlers.ts` (`handleSetExpertMode`), `forge/icons/ModeExpert*Icon.vue` |
| 51 | The left window | the session manager `KW0` (module djirOA): the login page (`In`) until signed in; an "Account & usage" section (`f95`); a collapsible "Session manager" section; "New session"; the shared list `At` in its list-only mount (groups, Ungrouped / Archived, the status dot, the status filter and "Active · N", "New group", row and group menus, multi-select, drag into a group) | the same, from the same markup, with three differences: no endpoint stands where the official has no login, so the endpoint setup (the welcome's state A) is shown instead of `In`; the usage section is out of scope (account & usage) and never renders; a row, "New session" and "Start new session in this group" hand off to the chat side bar instead of opening an editor tab (#17), so the pending group is kept by the host and given to the first fresh conversation the CLI names after the request (the official keys it by the tab it opened). The worktree pill and "create worktree" are left out: Forge's host cannot open a folder in a new window | `pages/SessionsPage.vue`, `forge/SessionList.vue`, `SessionRow.vue`, `SessionGroupHeader.vue`, `SessionContextMenu.vue`, `shared/sessionGroups.ts`, `core/sessionListMenus.ts`, `sessionGroupStore.ts`, `ClaudeAgentService.assignPendingGroup` |
| 52 | The "Past conversations" dropdown | `QW0` mounts `At` with no groups and no status feeds: search, rename, archive, unarchive, Archived collapsed in component state | now exactly that. It used to carry the status dot and a "Mark as unread" row action (step 22), which the official has only in the session manager; both moved there. The left window's own recency buckets ("Today", "Yesterday", …), its "Back to chat" header and its error state with Retry are gone: none is official | `forge/SessionsDropdown.vue` |
| 53 | A failed `@browser` attach | `ensureChromeMcpEnabled` awaits the "Install the browser extension" notification before connecting; `createNewBrowserTab` `JSON.parse`s the tab server's reply, so its plain-text refusal becomes `SyntaxError: Unexpected token 'B'`; the composer's `send` handler catches and says nothing (`catch(t){}`) | the prompt is offered without holding the attach (a notification folds into the centre within seconds; the end-to-end run sat two minutes on it with an empty chat); a non-JSON reply is thrown as its own words; the send stops with `Couldn't attach a browser tab: <reason>` in the chat's error banner, the typed text goes back into an empty composer, and the next send clears the banner. The reason from CLI 2.1.274 without the extension: "Browser extension is not connected. Please ensure the Claude browser extension is installed and running (https://claude.ai/chrome), and that you are logged into claude.ai with the same account as Claude Code. …" | `ClaudeAgentService.ensureChromeMcpEnabled`, `chromeMcpClient.parseNewTabResult`, `core/browserMentions.ts` (`BrowserAttachError`), `Session.send`, `ChatPage.handleSubmit` |

## 2026-09-25: the model picker lists what answers

The user's request: only models that respond, each with its ping, checked every
five minutes, and a refresh in the picker for when the model in use stops
answering. The official picker has none of this (its rows are the CLI's five
Claude tiers), so everything below is Forge's own, built on the official
markup and measured against it.

| # | What | Official | Forge | Where |
| --- | --- | --- | --- | --- |
| 54 | Which rows the model picker lists, the ping, the refresh | `aV0`: `claudeConfig.models`, then the CLI's greyed `unavailable_models`; a "Select a model" header; no refresh | one rule, `shared/pairHealth.ts` (`pairCheck`, `isOffered`), shared by host and webview: an endpoint whose model answered its last check, or has not been checked yet, is a row; one that did not answer, or whose check could not be sent (a refused key, DNS), is an official `unavailable_models` row (`disabled`, the reason in the description), and the chat picker shows that row only while it is the model in use, so the pill still names it and says why. Settings (`sdk_probe`) still lists every pair. Each answering row has a ping chip after its name, as a Pajamas badge: success under 1 s, neutral under 3 s, warning above (new `--forge-badge-*` tokens: 100 fill and 700 text per ramp, from `@gitlab/ui` 137.2.2's `--gl-badge-*`; a low-alpha fill and the 200 stop in dark; the host foreground in high contrast), in tabular figures. The header gains a refresh: the official bare icon button (`fg-iconbutton`, module YKLzCw, 24px box, 16px glyph) with Heroicons 2.2.0 `16/solid/arrow-path`, the set the official's own glyphs come from (its search-clear is byte-identical to Heroicons `x-mark`). It floats beside the header (its margins take the header's measured 25.55px height), so the official header keeps its box; it sends `sync_endpoint_health` for every endpoint, spins (`aria-busy`) while checking, keeps the menu open, and the rows re-render from the host's `update_state` push as answers land. The welcome gate's healthy count follows the same rule. The periodic check defaults to every 5 minutes, not 60, and a check is due slightly before one interval has passed (`isSweepDue`), because it is dated when it finishes: without that, every other tick skipped it and 5 minutes meant 10 | `shared/pairHealth.ts`, `endpoints/models.ts` (`pairRow`), `handlers.ts` (`endpointModelRows`), `healthStore.ts` (`DEFAULT_SYNC_INTERVAL_MINUTES`, `isSweepDue`), `ModelSelect.vue`, `forge/icons/RefreshIcon.vue`, `forge-design.css`, `forge-tokens.css` |

Measured in the harness (`drive-all.mjs`, model menu): 3 of 4 pairs listed,
the dead one out; pings 820ms fast, 1.4s fair, 3.2s slow; the refresh 24x24,
16px glyph, centred on the header (±0.0px), header width = list width (676px);
refresh sends `sync_endpoint_health` with no profile, `aria-busy` true then
false, the menu stays open, the recovered pair appears with 640ms. The oracle,
with Forge's chips and refresh taken out of the DOM: 1 structural row on each
window, the current model's name at weight 600 (Forge's rule, above).
