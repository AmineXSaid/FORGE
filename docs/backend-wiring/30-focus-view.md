# Step 30: Focus view

**Group:** 6  **Depends on:** 29

## Official
- Registry row: `toggle-focus-view` | "Focus view" | section Settings | toggle, `keepMenuOpen`.
- `{type:"set_focus_view", enabled}`. The transcript shows only prompts and responses.
- Read the handler (storage, broadcast) and the exact webview filter (which block types are hidden).

## Six places (B2)
- Handler: boolean only; persist and broadcast the way the official does.
- `test/focusView.spec.ts`, plus a spec for the transcript filter function.

## Tasks
- [ ] Apply the official filter in the transcript, and add the toggle row.

## Validate
- [ ] Gates pass.
- [ ] Harness: toggle it. The request is sent, the menu **stays open**, and tool
      and thinking blocks hide or show exactly as in the official filter.

## VS Code checklist for the user
1. Turn on Focus view and reload. **Expected:** still on; only prompts and responses are visible.
