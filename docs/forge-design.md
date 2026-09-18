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
