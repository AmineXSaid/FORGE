---
name: forge-style
description: Forge's visual language, the Anthropic style reference (flat tonal surfaces, hairline borders, one accent reserved for the decisive action, sans UI chrome, editorial restraint) rendered in the GitLab Pajamas palette instead of Anthropic's ivory and clay. Use whenever designing or restyling any Forge surface that is not a measured port of the official Claude Code UI: Settings, the welcome page, dialogs, empty states, form fields, lists, cards, buttons. Triggers - "premium", "make it look better", "UI consistency", "restyle", "Pajamas", "Anthropic style", "design system".
---

# Forge style: the Anthropic language, in Pajamas colours

The user's brief (2026-09-23): use the Anthropic style reference for the UI and
UX, but the GitLab Pajamas palette for colour. This file is that brief made
concrete. Ported official Claude Code surfaces (composer, menus, transcript)
stay measured ports; everything Forge draws itself follows this.

## The character

A quiet, editorial tool. Surfaces are flat and separated by tone and a
hairline, never by shadow. One accent, Pajamas purple, appears only where the
user must act, and nowhere else: not on icons, not on hover, not on decoration.
Type carries the hierarchy; colour mostly stays out of the way.

## Colour roles, mapped onto Pajamas

Anthropic's warm neutrals map onto Pajamas' `neutral` ramp, which is itself
warm (`#ecebea`, `#28272d`). Clay becomes purple. Every value is a token in
`src/webview/src/styles/forge-tokens.css` (`--forge-canvas`, `--forge-surface`,
...); components never name a primitive (`lint:brand` enforces it).

| Anthropic role | Anthropic value | Forge token | Light (Pajamas) | Dark (Pajamas) |
| --- | --- | --- | --- | --- |
| Canvas (page) | Ivory Medium `#f0eee6` | `--forge-canvas` | neutral-10 | neutral-950 `#18171d` |
| Card surface | Ivory Light `#faf9f5` | `--forge-surface` | neutral-0 | neutral-900 `#28272d` |
| Deep surface (grouped) | Oat `#e3dacc` | `--forge-surface-deep` | neutral-50 | neutral-800 |
| Featured surface | Manilla `#f5e3c7` | `--forge-surface-feature` | purple-50 | purple-950 mix |
| Primary text | Slate Dark `#141413` | `--forge-text` | neutral-950 | gray-50 `#ececef` |
| Muted text | Cloud Medium `#b0aea5` | `--forge-text-muted` | neutral-600 | neutral-400 |
| Hairline border | Stone `#cccbc8` | `--forge-hairline` | neutral-100 | neutral-800 |
| Outline border | Cloud Dark `#87867f` | `--forge-outline` | neutral-300 | neutral-600 |
| The one accent | Clay `#d97757` | `--forge-action` | purple-500 `#7b58cf` | purple-500 |
| Accent, pressed/hover | Clay Deep `#c6613f` | `--forge-action-hover` | purple-600 | purple-400 `#9475db` |
| Focus ring | (n/a) | `--forge-focus-ring` | blue-500 | blue-400 |

Status (deny, ask, allow, healthy, failing) uses the Pajamas status hues
(`--forge-danger`, `--forge-warning`, `--forge-success`), tinted, never solid
fills. Toggles use the Pajamas accent blue, as Pajamas itself does. High
contrast hands every role back to the host's contrast colours.

## Type

- **Sans for everything** (`Forge Sans`, Anthropic Sans). The reference's
  serif editorial voice is not available: no Anthropic Serif is bundled and the
  fonts gate forbids a system fallback. Hierarchy comes from size and weight.
- Scale for tool surfaces (base 12-13px): caption 11-12px weight 500 with
  -0.02em tracking; body 12-13px regular; row label 12-13px weight 500; section
  title 12px weight 600; page title 18-20px weight 600, -0.01em.
- Mono (`GitLab Mono`) only for code values: rule patterns, paths, ids, env
  names. A field's placeholder stays sans even when its value is mono.

## Shape and space

- Base unit 4px; element gap 8px; card padding 16px (compact) to 24px.
- **Cards**: 12px radius (the reference's 24px, scaled for dense panels), 1px
  hairline, surface fill, **no shadow**.
- **Filled primary button**: the accent fill with the signature **bottom-only
  radius** (`0 0 8px 8px`). One per view: the decisive action.
- **Outlined / secondary buttons**: 1px outline border, 8px radius all round,
  transparent or surface fill.
- **Badges**: weighted text, not boxes: 11px, weight 600, muted or status hue,
  no fill, no radius.
- **Inline links**: persistent 1px underline in the text colour.
- **Fields**: 28px tall, 6px radius, hairline border, surface fill; hover
  strengthens the border; focus is the blue ring.

## Elevation and motion

- No `box-shadow` for elevation, anywhere. Overlays (menus, dropdowns,
  dialogs) sit one tonal step above what they cover, with a hairline.
- Motion is short and functional: 120-240ms ease-out on open, faster on close,
  opacity-only under `prefers-reduced-motion`. No glows, no gradients, except
  the welcome page's art glow, which the user asked for by name.

## Do / don't

- Do keep one accent-filled button per view; everything else outlined or text.
- Do separate layers by tone and hairline.
- Don't colour hover states, icons or empty-state art with the accent.
- Don't grey out controls to mean "unavailable": hide what cannot work (B4), or
  keep it enabled and explain in its description.
- Don't use italics for empty or placeholder states; use the muted tone.
- Don't introduce a colour that is not a Pajamas token.

## Where it lives

- Tokens: `forge-tokens.css` ("Surfaces" and "Form fields").
- Shared controls: `components/Common/{Button,TextInput,NumberInput,Dropdown,ListEditor,Switch,Badge}.vue`.
- Settings chrome: `components/settings/{SettingsTab,SettingsSection,SettingsSubSection,SettingsCell,SettingsSidebar}.vue`, `pages/SettingsPage.vue`.
- Divergences from the official UI are recorded in `docs/forge-design.md`.
