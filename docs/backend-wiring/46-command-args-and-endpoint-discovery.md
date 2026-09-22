# Step 46: The "/" rows finally land, and setup starts from what is running

**Group:** 7 (post-install bug report)

> fix the [/] window when clicking element of it it must direct me directly to
> the element in the setting not take me to "general window"
>
> and be creatif about the welcome page of setting up the endpoints!

The first half is the **third** report of the same defect. Rule 5 says a repeat
is a hard stop on guessing, so this one was traced instead of re-fixed.

## Why it survived two "fixes" and a green harness

The chain is five links long:

```
"/" row → open_settings {section} → handleOpenSettings → executeCommand("forge.openSettings", section)
        → impls['forge.openSettings'](section) → openEditorPage(page, title, id, section)
        → FORGE_BOOTSTRAP.section  /  postMessage show_section → SettingsPage.activeTab
```

Steps 42 and 45 fixed and measured **the first three**. The harness stubs
`open_settings`, records the section and stops there, so it kept reporting
`mcp-servers → mcp-servers` while the real install kept opening General.

The break was in link four:

```ts
vscode.commands.registerCommand(command, async (...args: unknown[]) => {
  await impls[command as ForgeCommandId]();   // called with nothing
  ...
  void args;                                   // and the arguments discarded
});
```

Every Forge command ran with **no arguments at all**. `forge.openSettings`
therefore always saw `section === undefined` and always opened General — and
the same was true of any other command that ever takes one.

The typechecker could not see it either, because the map was declared
`Record<ForgeCommandId, () => unknown>`: a handler written `(section?: unknown)`
is assignable to a zero-argument signature, so nothing complained.

### The fix, and the test that had to exist

```ts
const impls: Record<ForgeCommandId, (...args: unknown[]) => unknown> = { … };
await impls[command as ForgeCommandId](...args);
```

`test/commandArguments.spec.ts` drives the layer the harness cannot reach: it
registers the **real** commands against the vscode mock, executes
`forge.openSettings` with each section, and asserts the value arrives at
`openEditorPage`'s fourth argument. It then follows the last link too — the
bootstrap of a panel being created, the `show_section` push to one already
open, and that revealing an open panel does not drag it into the code group.

Proof it catches the original defect: restoring `impls[…]()` + `void args`
fails **7** of its tests; the fixed code passes all 20.

One more thing found while reading: the already-open branch called
`existing.reveal(vscode.ViewColumn.Active)`, which *moves* the Settings panel
into whatever group the user is editing code in — undoing step 42's column
choice on every second click. It reveals in place now.

## The setup page starts from what is running

The card's action used to open five questions. For the most common first
endpoint — an Ollama or an LM Studio the user already has open — four of those
answers are knowable without asking: the base URL is a documented default port,
the wire is OpenAI, there is no token, and the runtime will name its own models.

`services/endpoints/discover.ts` probes five runtimes at once, unauthenticated,
with a 1.5s timeout, reusing `listModels`:

| Runtime | Default |
| --- | --- |
| Ollama | `http://localhost:11434/v1` |
| LM Studio | `http://localhost:1234/v1` |
| vLLM | `http://localhost:8000/v1` |
| llama.cpp | `http://localhost:8080/v1` |
| Jan | `http://localhost:1337/v1` |

The picker then leads with what answered:

```
✓ Ollama            running now     4 models on http://localhost:11434/v1
○ LM Studio         not detected    Its local server, on port 1234.
○ vLLM              not detected    A self-hosted vLLM server, on port 8000.
  A gateway or hosted endpoint…     A company gateway, a relay, anything…
  Edit settings.json instead        TLS, proxies, header maps, capabilities.
```

- **A detected runtime**: the name is pre-filled (`ollama`, `ollama-2`…), the
  base URL and wire are the preset's, and the model becomes a **pick from the
  runtime's own list** rather than free text. Two keystrokes.
- **A preset that is not running**: base URL and wire pre-filled, the rest asked.
- **A gateway**: the original five questions, unchanged.

Picking the model from the list is the part that matters most. A wrong model id
does not fail cleanly — it either 404s about the *route*, which sends you
looking at `baseUrl`, or it is listed and still not servable and the request
hangs until the timeout.

Probes are concurrent, keep `LOCAL_RUNTIMES` order rather than completion order
so the picker does not reshuffle between runs, and every candidate is loopback —
this never reaches off the machine.

## Results

| Row | Before | After | Verdict |
| --- | --- | --- | --- |
| "/" ▸ MCP servers | Settings on **General** | Settings on MCP Servers | **works** (spec drives the real command layer) |
| "/" ▸ Hooks / Manage plugins / Endpoints | General | their own tab | **works** (same) |
| Second click on an open Settings panel | panel dragged into the code group | revealed in place, section pushed | **works** (spec) |
| Any command taking an argument | argument discarded | forwarded | **works** (spec; fails 7 tests against the old code) |
| Add endpoint, local runtime running | 5 questions | name + model, both pre-filled | **works** (spec); unverified against a real Ollama |
| Add endpoint, nothing running | 5 questions | presets, then 5 questions | **works** (spec) |
| Endpoint setup card | notice, 11/12 clean | **12/12, 0 structural diffs** | **works** (probe-oracle) |

**Counts:** 1378 tests (52 files, up from 1342), `typecheck:all`, `lint:forge`,
`build` clean.

`scripts/check-commands.mjs` was matching the impls map on its exact old
signature, so the change made it report all 25 commands as unimplemented. It
matches the signature loosely now and fails loudly if it cannot find the map at
all — a guard that silently matches nothing is not a guard.

## VS Code checklist for the user

Unverified — the agent cannot observe real VS Code.

1. "/" ▸ **MCP servers**. *Expect:* Settings opens on **MCP Servers**.
2. Without closing it, "/" ▸ **Hooks**. *Expect:* the same panel switches to
   **Hooks**, and does **not** jump into your code editor group.
3. Repeat for **Manage plugins** and **Endpoints**.
4. **Forge: Open Settings** from the palette. *Expect:* General — the no-argument
   case still works.
5. With Ollama (or LM Studio) running, Settings ▸ Endpoints ▸ **Add…**.
   *Expect:* a picker headed "Found 1 model server running here", with that
   runtime first and marked *running now*.
6. Pick it. *Expect:* the name pre-filled, no base-URL or wire question, and the
   model step is a **list of its models**, not a text box.
7. Stop the runtime and run **Add…** again. *Expect:* "Nothing running locally",
   every runtime listed as *not detected*, and picking one still pre-fills its
   base URL.
