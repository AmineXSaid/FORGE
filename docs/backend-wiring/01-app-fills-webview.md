# Step 01: App fills the webview

**Group:** 1 (Part A.1)  **Depends on:** nothing  **Type:** frontend, CSS only

## Problem
In the harness, the body measures 460px but `#app` measures only 412px. The
sessions dropdown uses the official right-anchor formula, so it clips off the left edge.

## Official
`REF/webview/index.css`: `#root{display:flex;flex:1;min-width:0;max-width:100%}`.
Grep `#root{` and copy the declaration exactly.

## Tasks
- [ ] In `src/webview/src/styles/forge-fonts.css`, next to the other official
      globals, add the same declaration for `#app`.
- [ ] No scoped overrides anywhere else.

## Validate
- [ ] `pnpm run typecheck:all`, `pnpm test` and `pnpm run build` pass.
- [ ] Harness, chat page, at the default width and at ~320px: `#app` width
      equals the body content width.
- [ ] Open the sessions dropdown (the header clock). Its position must equal the
      official `QW0` formula: `width:min(400px,100vw - 32px)`, right-anchored at
      `max(16, clientWidth - button.right)`. At 460px it's fully on screen. At
      320px the official formula itself puts the left edge at −6px, so Forge
      must match that and not clamp it.
- [ ] Harness `?page=sessions` and `?page=settings`: the layout isn't broken
      (take screenshots, and check `#app` width).
- [ ] Oracle on the header and composer: 0 structural diffs.

## VS Code checklist for the user
1. Open Forge in the sidebar at a narrow width and open past conversations.
   **Expected:** the dropdown is fully visible, not cut off on the left.
