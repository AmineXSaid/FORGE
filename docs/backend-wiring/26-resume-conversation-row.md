# Step 26: "Resume conversation" row

**Group:** 5  **Depends on:** 25

> **Checked against the bundle while implementing.** This file was accurate;
> the only thing it left unsaid is that the step has **no request and no
> handler**, so B2 does not apply. See
> [results/26-resume-conversation-row.md](results/26-resume-conversation-row.md).

## Official
Registry row: `resume-conversation` | "Resume conversation" | section Context |
`filterOnly`. It opens past conversations. Copy the description. Verbatim:

```js
registerAction({id:"resume-conversation",label:"Resume conversation",
  description:"Continue a previous conversation",filterOnly:!0},"Context",()=>{z(!0)})
```

The brief also asked whether Forge's `clear-conversation` / `new-conversation`
copy had drifted, and to report rather than fix. **It had not** — both match the
bundle verbatim, and a spec now pins them.

## Tasks
- [ ] Add the row with `filterOnly: true`.
- [ ] `runCommand`: close the menu and open `SessionsDropdown` through an event
      (the same state as the header clock).

## Validate
- [ ] Gates pass.
- [ ] Harness: the row is hidden until you filter. Typing "resume" shows it.
      Clicking it closes the menu and opens the dropdown.

## VS Code checklist for the user
1. Type `/resume` in the "/" filter and choose the row. **Expected:** past conversations open.
