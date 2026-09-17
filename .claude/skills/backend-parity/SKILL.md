---
name: backend-parity
description: Wire Forge's extension host to the real Claude Code protocol and the real @anthropic-ai/claude-agent-sdk API by copying from the official extension.js and the SDK's .d.ts — never by inventing request shapes, SDK methods, options or fields. Use whenever implementing or reviewing a webview→host request, a dispatcher case, a handler, a settings write, an SDK call, or any step in docs/backend-wiring/. Triggers - "wire the backend", "implement the request", "SDK call", "host handler", "backend parity", "does the host do what the official does".
---

# Backend parity: copy the protocol, do not invent it

This is the backend counterpart of `ui-parity`, and every rule there applies
here by analogy. `ui-parity` makes the webview look and behave like the official
one by measuring it. `backend-parity` makes the host **do** what the official
host does, by reading the official host and the real SDK typings and wiring them 1:1.

There are three sources of truth, and all of them are on disk:

| Source | Path | What it decides |
| --- | --- | --- |
| Official webview | `../Real_Claude_Code_VSCODE_extension_files/webview/index.js` | request **type names and payloads** (`type:"<t>"`), when they are sent |
| Official host | `../Real_Claude_Code_VSCODE_extension_files/extension.js` | the **handler** (`case"<t>"`), validation (`tu$`, `JI0`), responses, which SDK call is made |
| Real SDK | `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (and `entrypoints/`) | **what actually exists**: methods, option names, field names, signatures |

In a worktree, the reference folder sits next to the **main checkout**
(`C:\Users\med-a\Music\Real_Claude_Code_VSCODE_extension_files`), not next to the worktree.

## Rules — these are not optional

**1. If the code exists, read it. Never guess.**
Before writing any request, handler or SDK call, print the real code with
`scripts/extract-protocol.mjs` (below) and read it. A request type, a payload
field, an SDK method or an option that you did not see in one of the three
sources is a hallucination, even if the name "sounds right". Grep the bundle,
read the `.d.ts`, and copy the names.

**2. Copy-paste or wire. Do not redesign.**
The official protocol is the spec. Use the same `type` strings, the same payload
and response fields, the same whitelist entries and the same validator logic,
ported literally (renaming minified variables is fine; changing behaviour is not).
If Forge's existing code disagrees with the official, the official wins, unless
`CLAUDE.md` scopes the feature differently.

**3. The SDK is what the installed `.d.ts` says, not what you remember.**
Check each method, option and field against the installed version's typings
before you use it. Cite the `.d.ts` line in the code comment or in
`docs/sdk-upgrade.md`. If the SDK lacks something the official host uses:
- first check whether the official host gets it another way (read the call site);
- then use that exact mechanism (a CLI flag through `src/services/claude/cliArgs.ts`,
  an env var, a settings file);
- if neither exists, the feature is **not buildable**. Leave the row out (rule 6)
  and say so. Never stub a fake API or a fake response in the real host.

**4. When steps or code are provided, execute them.**
The step files in `docs/backend-wiring/` are the plan. Do exactly one step at a
time, in order. Don't re-derive the plan and don't widen the scope
(`docs/backend-wiring/out-of-scope.md`).

**5. Match the small things.**
Validation is part of behaviour: the same accepted values, the same rejections,
the same error response, the same settings layer and file, the same order of
side effects (for example, answer the permission request, *then* add the rule).
Persistence location matters as much as the value.

**6. A row exists only when its backend works (rule 7 of `CLAUDE.md`).**
Register a menu row, toggle or option only after its handler works. If the
feature is out of scope or the host can't serve it, leave it out, and list it with the reason.

**7. Repeating a correction means the approach is wrong.**
Stop, re-read the official handler and the `.d.ts`, change the code, and show the
evidence. Narration without a diff and a passing check is the failure mode.

**8. Don't claim it works without evidence.**
Evidence is: a passing spec, a request and response captured in the harness, and
a UI state change seen in the Browser pane. Behaviour against the real CLI can
only be claimed if it was observed. Otherwise hand the user a checklist item
marked **unverified**.

## 1. Extract the real protocol for a request

```bash
node .claude/skills/backend-parity/scripts/extract-protocol.mjs <request_type> [--ref <dir>] [--ctx 600]
node .claude/skills/backend-parity/scripts/extract-protocol.mjs --sdk <symbol>   # e.g. rewindFiles, supportedModels, effort
```

For a request it prints every sender site in `index.js` (`type:"<t>"`) and the
handler in `extension.js` (`case"<t>"`), with surrounding code. Follow the method
the case calls (grep its name again) until you reach the SDK call or the file write.
For `--sdk` it prints each match in the installed SDK's `.d.ts` files, with line numbers.

Paste the relevant excerpt (a few lines) into your working notes for the step, so
the wiring can be checked against it.

## 2. Wire it in six places (B2)

1. `src/shared/messages.ts`: the request and response types, with official field names.
2. `src/webview/src/transport/BaseTransport.ts`: the transport method.
3. `src/services/claude/ClaudeAgentService.ts`: the dispatcher `case`.
4. `src/services/claude/handlers/handlers.ts`: the handler, with the validation ported literally.
5. `.claude/skills/ui-parity/harness/mock-host.js`: the answer with the **official response shape**.
6. `test/<name>.spec.ts`: the happy path and every rejection (bad keys, bad ids,
   disallowed args, path traversal). The `vscode` mock is `test/mocks/vscode.ts`.

Webview input is untrusted. Whitelists and validators come from the official host
and sit next to its handlers. Session ids are checked before touching the
filesystem. Never route through `handleExec`.

## 3. Prove it in the UI (the `ui-parity` harness)

```bash
pnpm test && pnpm run typecheck:all && pnpm run build
node .claude/skills/ui-parity/scripts/harness.mjs --port 8735 --ref C:/Users/med-a/Music/Real_Claude_Code_VSCODE_extension_files/webview/index.css
```

Open `http://127.0.0.1:8735/index.html` in the Browser pane, wait about 3s, and
confirm `cssRules.length > 0`. Then, for every affected row:
- click it and capture the outgoing request (the mock-host log or `read_console_messages`);
- confirm the response and the UI state change;
- confirm whether the menu stays open (`keepMenuOpen`);
- post the rejection payloads and confirm the error responses;
- run `probe-oracle.js` on the window: **0 structural diffs**.

The harness proves the webview↔host contract, not the real CLI. For CLI
behaviour, write a numbered VS Code checklist with exact expected results
(a file changed, a setting written) and mark it unverified.

## 4. Report

Use the table **row | request | host result | UI effect | verdict** with counts,
the rows left out and why, and the checklist (`docs/backend-wiring/report-template.md`).
Never round a partial result up to "works".
