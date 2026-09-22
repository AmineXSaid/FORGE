# Step 43: The activity bar opens your history, not a second chat

**Group:** 7 (post-install bug report)

Reported from the install of the step-42 VSIX:

> the left side button must be when clicked opens the history like the claude
> code vs code not twice the window

The screenshot shows it exactly: a Forge chat in the primary side bar on the
left, and another Forge chat in an editor group on the right. Clicking the
activity-bar cube gave a second copy of the thing already on screen.

## What the official does

From its activation, verbatim:

```js
let V = vscode.version.split(".").map(Number);
let B = V[0] ?? 0, H = V[1] ?? 0;
let q = B > 1 || (B === 1 && H >= 106);
if (!q) commands.executeCommand("setContext", "claude-code:doesNotSupportSecondarySidebar", true);
commands.executeCommand("setContext", "claude-vscode.sessionsListEnabled", true);
commands.executeCommand("setContext", "claude-vscode.primaryEditorEnabled", true);
```

and from its manifest:

| Container | Where | `when` |
| --- | --- | --- |
| `claude-sidebar` (chat) | activity bar | `claude-code:doesNotSupportSecondarySidebar` |
| `claude-sessions-sidebar` (history) | activity bar | `claude-vscode.sessionsListEnabled` |
| `claude-sidebar-secondary` (chat) | secondary side bar | `!claude-code:doesNotSupportSecondarySidebar` |

So on VS Code 1.106 or newer — which is every current build; the reporter runs
**1.138.0** — the chat container in the activity bar is **not contributed at
all**. The chat lives in the secondary side bar, and the activity-bar button is
the **sessions list**. `sessionsListEnabled` is set unconditionally, so that
button always exists.

Both activity-bar containers are titled `"Claude Code"`, and the sessions view
has `name: ""` so the workbench draws the container title alone instead of
stacking a second header under it.

## What Forge did

| | Forge before | Official |
| --- | --- | --- |
| Chat container gate | `config.forge.preferredLocation == 'primary'`, **default `primary`** | a version check |
| Sessions container gate | `config.forge.showSessionsSidebar`, **default `false`** | always on |
| Sessions container title | `"Forge Sessions"` | same as the chat's |
| Sessions view name | `"Past Conversations"` | `""` |

Two settings standing in for one version check, both defaulted the wrong way
round: the activity bar got the chat and the history was switched off. There
was also a quiet disagreement — `package.json` declared `preferredLocation`
default `"primary"` while `revealSidebar` read it with a `'secondary'` fallback
that could therefore never apply.

## What changed

`applySidebarContextKeys()` in `forgeCommands.ts`, called first thing in
`activate()` because container `when` clauses are static and are resolved before
anything else runs:

- `forge:doesNotSupportSecondarySidebar` — set **only** when
  `supportsSecondarySidebar(vscode.version)` is false, like the official. An
  absent key is falsy, so the negated clause is true on a modern build without
  setting anything.
- `forge:sessionsListEnabled` — always set.

The manifest now reads:

| Container | `when` |
| --- | --- |
| `forge-sidebar` (chat, activity bar) | `forge:doesNotSupportSecondarySidebar \|\| config.forge.preferredLocation == 'primary'` |
| `forge-sidebar-secondary` (chat, secondary) | `!forge:doesNotSupportSecondarySidebar && config.forge.preferredLocation != 'primary'` |
| `forge-sessions-sidebar` (history) | `forge:sessionsListEnabled && config.forge.showSessionsSidebar` |

with `preferredLocation` defaulting to `secondary` and `showSessionsSidebar` to
`true`. The setting is kept rather than deleted — it is the only way to ask for
the chat on the left — but it is now an override on top of the version check
instead of the thing that decides. A build too old for the secondary side bar
falls back on its own, which is what the setting's old description asked the
user to do by hand.

`revealSidebar` takes the same two inputs in the same order, so it tries the
view that actually exists rather than leaning on its fallback loop.

The sessions container is titled `Forge` and its view name is `""`, matching
the official.

## Found while checking the view: the row timestamps were in Chinese

Driving the sessions page in the harness to confirm what the activity bar would
now open printed:

```
Past conversations
Today
1
New Conversation
刚刚
```

`SessionsPage.vue` carried its own relative-time function — `刚刚`, `5分钟前`,
`3天前`, then `toLocaleDateString('zh-CN')` after a week — inside an otherwise
English UI. It is the text on every row of the list, so it is the first thing
anyone reads there.

Replaced with the official's `K95`, floor for floor:

```js
function K95($){let Z=Date.now()-$,Y=Math.floor(Z/1000),X=Math.floor(Y/60),
  Q=Math.floor(X/60),G=Math.floor(Q/24),z=Math.floor(G/30),q=Math.floor(G/365);
  if(q>0)return`${q}y`;if(z>0)return`${z}mo`;if(G>0)return`${G}d`;
  if(Q>0)return`${Q}h`;if(X>0)return`${X}m`;return"now"}
```

`now`, `5m`, `3h`, `2d`, `4mo`, `1y` — no "ago". Floor rather than round is the
part that matters: rounding showed "2h" thirty-one minutes in, so a
conversation you had just left claimed to be hours old. It moved to
`utils/relativeTime.ts` because `<script setup>` cannot export, and a formatter
with six boundaries deserves a spec.

## Results

| Surface | Before | After | Verdict |
| --- | --- | --- | --- |
| Activity-bar button | a second chat | Past Conversations | **works** (manifest + context-key specs); unverified in real VS Code |
| Chat | primary side bar | secondary side bar | **works** (same); unverified in real VS Code |
| Old VS Code (< 1.106) | chat in the primary bar only if the user set it | chat falls back to the primary bar automatically | **works** (spec) |
| `preferredLocation: "primary"` | the only way to get the chat | still forces the chat left | **works** (spec) |
| Two chat containers at once | possible in principle | impossible | **works** (spec evaluates both clauses over all four inputs) |
| Session row age | `刚刚` / `5分钟前` / `zh-CN` date | `now` / `5m` / `2d` / `1y` | **works** (spec, 23 cases); harness shows the page rendering |

**Counts:** 1314 unit tests (46 files, up from 1267), `typecheck:all`,
`lint:forge` and `build` clean.

## VS Code checklist for the user

Unverified — the agent cannot observe real VS Code.

1. Install the VSIX and reload.
   *Expect:* the activity bar shows **one** Forge cube. Clicking it opens
   **Past Conversations**, not a chat.
2. Look at the right-hand panel.
   *Expect:* the Forge chat is there. If the secondary side bar is closed,
   `Ctrl+Alt+B` (`Cmd+Alt+B`) opens it — or run **Forge: Open in Side Bar**.
3. Confirm there is no second chat.
   *Expect:* the activity bar has no separate "Forge" chat entry; the only
   chats are the secondary side bar and any editor tab you opened yourself.
4. Set `"forge.preferredLocation": "primary"` and reload.
   *Expect:* the chat moves back to the activity bar, the secondary side bar
   entry disappears, and the history container stays. Two Forge entries in the
   activity bar is correct here — chat and history — and this is the only
   configuration where that happens.
5. Set it back to `"secondary"` (or delete the key) and reload.
   *Expect:* step 1's arrangement returns.
6. In Past Conversations, look at the right-hand column of any row.
   *Expect:* `now`, `12m`, `3h`, `2d` — never `刚刚` or `分钟前`, and never a
   date in `2026/9/20` form.
7. Set `"forge.showSessionsSidebar": false` and reload.
   *Expect:* the activity bar has no Forge entry at all, and the chat is still
   in the secondary side bar. That is the documented consequence of turning it
   off.
