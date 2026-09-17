# Results, step 01: App fills the webview

Measured on 2026-09-17 in the ui-parity harness (`--port 8735`, the real built
webview, stylesheets parsed: `[1, 5, 9819]` rules).

## Finding
The official rule `#root{display:flex;flex:1;min-width:0;max-width:100%}` was
**already ported** to `#app` in `src/webview/src/styles/forge-fonts.css` (L163,
commit b6f21be). No CSS change was needed. The step was validated by measurement.

## Measurements

| Check | Expected | Actual | Verdict |
| --- | --- | --- | --- |
| `#app` width, chat page, 1024px | = body (1024) | 1024 | pass |
| `#app` width, chat page, 460px | = body (460) | 460 | pass |
| `#app` width, chat page, 320px | = body (320) | 320 | pass |
| `#app` width, `?page=sessions`, 460px | = body (460) | 460, no horizontal overflow | pass |
| `#app` width, `?page=settings`, 460px | = body (460) | 460, no horizontal overflow | pass |
| Before/after, same page at 460px: rule removed live, then restored | removed < body, restored = body | removed **382.59**, restored **460** | pass (the rule is what fixes it) |
| Sessions dropdown at 460px | fully on screen | left 22, right 422, width 400 | pass |
| Sessions dropdown at 320px | same as the official `QW0` formula | left −6, right 282, width 288 (`right:38px`) | pass: the official formula and CSS are identical (`CF1.dropdown`, `.dropdown_Wc_2Bg`), so the official is also at −6 |
| Oracle `.fg-shell__header` | 0 structural | 12 checked, 12 clean, **0 structural** | pass |
| Oracle `.fg-chat__inputContainer` | 0 structural | 31 checked, **3 structural** | not caused by step 01 (see below) |

## Re-measured after the user's commit `d496deb` (fast-forwarded into this branch)
| Check | Actual | Verdict |
| --- | --- | --- |
| `#app` at 460px / 320px | 460 / 320 | pass |
| Sessions dropdown at 460px | 44 → 444 (`right:16px`, history is now the rightmost button) | pass |
| Sessions dropdown at 320px | **16 → 304**, no overhang | pass |
| Gates: `pnpm test`, `typecheck:all`, `build` | 15/15, clean, exit 0 | pass |

## Gates
- `pnpm test`: 3 files, 15 tests passed.
- `pnpm run typecheck:all`: **was failing before this step** with 2 errors. Fixed
  (type annotations only, no runtime change):
  - `components/forge/CommandMenu.vue`: `let activeEl = null as HTMLElement | null`
    (TypeScript had narrowed it to `null`);
  - `components/forge/ForgeFlyout.vue`: `triggerHaspopup` typed as the ARIA
    `aria-haspopup` union.
  Now passes.
- `pnpm run build` (lint:brand, lint:tokens, lint:commands, webview, extension): passes.

## Defects that already existed, found here and not fixed (outside step 01)
1. Oracle, composer, 3 structural diffs:
   - `div.fg-composer__messageInput`: `overflow-x` is hidden in Forge, auto in the official.
   - `.fg-footer__footerButton span`: `display` is flex in Forge, block in the official.
   - `.fg-footer__footerButton > svg`: `min-height`/`min-width` are auto in Forge, 0px in the official.
2. Oracle, whole `#app`, 6 more structural diffs: the empty-state logo size
   (Forge wordmark), `fg-tip__container svg` `flex-shrink`, and
   `fg-emptystate__terminalBannerContainer` position/z-index.
3. `?page=settings` at 460px: the "General" heading overlaps the User / Workspace / Local tabs.
4. `?page=sessions`: the relative time shows "刚刚" (Chinese for "just now") instead of the official `now`.

None of these belong to a step in `docs/backend-wiring/`. They need their own
ui-parity task.

## VS Code checklist for the user (unverified)
1. Open Forge in the sidebar at about 460px wide. **Expected:** the chat fills
   the whole panel width, with no empty band on the right.
2. Open past conversations (the clock icon). **Expected:** the dropdown sits
   under the icon and is fully visible. In a very narrow sidebar (about 320px) it
   overhangs the left edge by the same few pixels as Claude Code does.
