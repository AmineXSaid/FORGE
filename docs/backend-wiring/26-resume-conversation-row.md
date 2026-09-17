# Step 26: "Resume conversation" row

**Group:** 5  **Depends on:** 25

## Official
Registry row: `resume-conversation` | "Resume conversation" | section Context |
`filterOnly`. It opens past conversations. Copy the description.

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
