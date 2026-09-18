# Step 17: Plan-mode labels, what each plan answer sends, and the plan preview

Group 4, seventh step. Before: the prompt used the plan labels whenever the
**session** was in plan mode, including on a Bash prompt, and showed "Do you want to
proceed with ExitPlanMode?" plus the JSON. Every answer behaved like an ordinary one.
`set_permission_mode` carried no `userInitiated` and always answered
`success: true`.

## What the bundle says, and where the step file was wrong

`EU0` (the prompt) and `dT` (the ExitPlanMode renderer), from `index.js`:

```js
G = $.toolName === BF;                               // "ExitPlanMode": the request, not the session
U = G && J.getPlanComments($.channelId).length > 0;  // a plan with comments -- NOT "feedback typed"
z = G || !$.suppressAlwaysAllowRule && $.suggestions?.length > 0;
d0 = G ? "Yes, and auto-accept" : q ? "Submit answers" : "Yes";
v0 = G ? (U ? "Send feedback and keep planning" : "No, keep planning") : "No";
// option 2 on a plan: "Yes, and manually approve edits"; !U hides buttons 1 and 2;
// the reject button is numbered U ? "1" : z ? "3" : "2"
C  = async () => { if (G) { await Z("acceptEdits", true); /* comments -> userFeedback */ } $.accept(inputs) };
i1 = async () => { J5 = (G ? [MU0] : suggestions).map(...); /* MU0 = setMode default, session */ ... };
d  = () => { $0 = typed ? `${wM} ${typed}` : G ? _61 : AS; /* + "Comments on the plan:" */ $.reject($0, !typed && !comments) };
// dT.permissionRequest: [comments list] + "Accept this plan?" / "Continue planning"
//   + "Select text in the preview to add comments" / "N comment(s) will be included as feedback"
// MW0 (on every permission request): ExitPlanMode -> openMarkdownPreview(plan, jW0(plan) ?? PW0, true),
//   and closePlanPreview() once the answer is allow
```

Plan comments come from the **plan preview**: a panel the official host opens
beside the chat (`yS`, view type `claudePlanPreview`). The user selects text in it
and comments, and the host pushes each comment to the webview (`plan_comment`).
It's not in `CLAUDE.md`'s scope list. **The user decided (2026-09-18) to build it in
this step.** The step file is corrected ([17-plan-mode-labels.md](../17-plan-mode-labels.md)).

The strings the brief asked to account for: "keep planning" (2×) and "Send
feedback and keep planning" (1×) are all `v0`. "auto-accept" (4×) is `d0` once;
the other three are the onboarding checklist's `auto-accept` milestone (its id,
the trigger when the mode is `acceptEdits`, and its image), which has nothing to
do with the prompt.

## Results

| Row | Request | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- |
| Modes menu → Plan | `{type:"set_permission_mode", mode:"plan", userInitiated:true}` | `{success:true}` (host: `ou$`, bypass gate, `query.setPermissionMode`) | footer **Plan**; the mode sticks | works |
| Bash prompt while in Plan | `tool_permission_request {toolName:"Bash"}` | — | "1 Yes / 2 No", "Do you want to proceed with Bash?": **no** plan labels | works |
| ExitPlanMode prompt | `tool_permission_request {toolName:"ExitPlanMode", inputs:{plan}}` → `{type:"open_markdown_preview", channelId, content:<plan>, title:"Refactor the settings loader", enableComments:true}` | preview panel opened | "1 Yes, and auto-accept / 2 Yes, and manually approve edits / 3 No, keep planning"; "Accept this plan?" / "Select text in the preview to add comments" | works |
| Same, with the session in **Manual** | same | — | the same plan labels: they come from the request | works |
| 1 Yes, and auto-accept | `set_permission_mode {mode:"acceptEdits", userInitiated:false}`, then `close_plan_preview {channelId}`, then the answer `{behavior:"allow", updatedInput, updatedPermissions:[]}` | stub CLI mode `acceptEdits`; preview closed | footer **Edit automatically** | works |
| 2 Yes, and manually approve edits | the answer `{…, updatedPermissions:[{type:"setMode", mode:"default", destination:"session"}]}` + `close_plan_preview`; **no** `set_permission_mode` | stub CLI mode `default` (the host filter allows `jf$`: spec) | footer **Manual** (mirrored, not pushed) | works |
| 3 No, keep planning | `{behavior:"deny", message:"User chose to stay in plan mode and continue planning", interrupt:true}` | — | preview stays open; mode unchanged | works |
| typed reason | `{behavior:"deny", message:"<wM>  also add tests", interrupt:false}` (the official double space) | — | — | works |
| 2 plan comments arrive | `plan_comment {channelId, comment}` ×2 | — | "Comments (2)", each quoted (cut at 80 characters + "…") with ×; "Continue planning"; "2 comments will be included as feedback"; only **"1 Send feedback and keep planning"** | works |
| × on a comment | `{type:"remove_plan_comment", channelId, commentId:"comment-1"}` | host forgets it, unmarks it in the preview (spec) | "1 comment will be included as feedback" | works |
| Enter on "Send feedback and keep planning" | `remove_plan_comment {…comment-2}`, then `{behavior:"deny", message:"User chose to stay in plan mode and continue planning\n\nComments on the plan:\n[Re: \"…\"] Name it readSettingsLayer", interrupt:false}` | — | preview open, mode unchanged | works (**deviation**, see below) |
| Plan preview page (`?page=plan-preview`) | page → panel `{type:"ready"}` | panel → `updateContent {html}` + `setCommentsEnabled {enabled:true}` | "Ready for review / Select text to add comments on the plan"; the plan rendered; no chat runtime, no transport requests | works |
| select text → Add Comment → Enter | page → panel `{type:"comment", id, selectedText:"Cache the merged result", sectionHeading:"Steps", comment}` | host pushes `plan_comment` (spec) | button under the selection; box with the preview, textarea focused; text marked, indicator "1" with the comment as title | works |
| host `removeComment` | panel → page `{type:"removeComment", commentId}` | — | mark unwrapped, text intact | works |
| hostile plan HTML | `updateContent` with `onclick`, `style`, `<script>`, `javascript:` (two spellings), `<foo><img onerror>`, `<iframe>` | — | all stripped; `<script>` text kept as text (official); nothing ran | works |
| a prompt on a channel nobody shows | a pending request on `ghost-channel` | — | the visible session's prompt still appears and answers (**pre-existing defect fixed**, below) | works |
| rejections | `set_permission_mode {mode:"yolo" / "" / 3 / undefined}`; bypass while not allowed; unknown channel; malformed `open_markdown_preview` | `success:false` in-band; `Channel not found`; `open_markdown_preview: malformed request` | the pick reverts (harness: Bypass refused) | works (spec + harness) |

**Counts:** works 17 · partial 0 · broken 0 · left out 2 (the AskUserQuestion branch and the Edit/Write diff branch of `MW0`, below)

## Every SDK field on the objects this step touched

| API / field | Surfaced? | Where / why not |
| --- | --- | --- |
| `PermissionMode` (L2366): `default`, `acceptEdits`, `plan`, `bypassPermissions` | yes | the Modes menu; the host checks all six (`ou$`) |
| `PermissionMode` `dontAsk`, `auto` | accepted, no row | the host accepts them as the official does. No Auto row (the user's decision, 2026-09-18). The official has a "Don't ask" entry in its mode table and draws its rows from a list of available modes; Forge's Modes menu rows are not changed by this step (not verified which modes that list holds) |
| `Query.setPermissionMode` (L2675) | yes | `set_permission_mode`, now answering `success` in-band |
| `set_permission_mode` `userInitiated` | yes | sent (`true` for a pick, `false` for a prompt answer or when leaving `dontAsk`); its host effect (`persistDefaultPermissionMode`) is step 18 |
| `PermissionUpdate` `setMode` / `destination: "session"` | yes | option 2 on a plan (`MU0`) |
| ExitPlanMode input `plan` | yes | the preview's content and title |
| ExitPlanMode input `planFilePath` | no | the official prompt and preview don't read it (only the transcript header, which Forge already renders) |
| `PermissionResult` allow `updatedInput.userFeedback` / `userComments` | yes | an accepted plan with comments (the official `C`/`i1`; spec) |

## Changes

- `src/services/claude/planPreview.ts` (new): `yS` as `PlanPreviewPanel`
  (`ready` → content + comments switch; the comment check; `setTitle`,
  `updateContent`, `setCommentsEnabled`, `removeComment`, `detach`, `dispose`),
  `renderPlanHtml` (`marked`, the official `Yh0`), the `claudePlanPreview` view type.
- `src/services/claude/permissionMode.ts` (new): `ou$`.
- `ClaudeAgentService`: the official `setPermissionMode(channel, mode, userInitiated)`
  (in-band `success`, the bypass gate), and `open_markdown_preview`,
  `get_plan_comments`, `remove_plan_comment`, `close_plan_preview` with the per-channel
  comments, the `plan_comment` push and detach-on-shutdown.
- `WebViewService`: `createPagePanel` (a Forge page on its own message channel) and
  `planPreviewColumn` (after the chat's editor tab, else column one, as the official).
- `messages.ts`: `userInitiated`, the four requests and responses, `PlanComment`,
  `PlanCommentMessage`.
- `BaseTransport`: `planCommentsByChannel`, `plan_comment`, `openMarkdownPreview`,
  `removePlanComment`, `closePlanPreview`, `setPermissionMode(…, userInitiated)`.
  `VSCodeTransport.postRaw` for the preview page.
- `Session` / `useSession`: `setPermissionMode(mode, push, userInitiated)`,
  `planComments`, `openMarkdownPreview`, `closePlanPreview`, `removePlanComment`.
- `core/planPreview.ts` (new): `jW0`, `PW0`, `MW0`'s ExitPlanMode branch, `AS`,
  `_61`, `wM`, the feedback format, the labels. `useRuntime` subscribes `MW0`.
- `PermissionRequestModal.vue`: `G`/`U`/`z`/`H` as the official computes them, the
  `dT` body, the three plan answers, the plan comments. The session-mode prop is gone.
- `pages/PlanPreviewPage.vue` (new) and `core/planPreviewPage.ts` (new): the `zd$`
  page (markup, ids, copy, script) and its sanitiser. `App.vue` routes `plan-preview`.
- `forge-tokens.css`: `--forge-shadow-heavy` (the official 0.3 shadow).
- Harness: `harness.mjs` serves the official `zd$` template at `/oracle/plan-preview.html`
  when the reference folder is present. The new `probe-planpreview.js` diffs Forge's
  preview page against it, drawing both in Forge's fonts and reporting colour apart.
  The mock host answers `set_permission_mode` (fixing step 16's snap-back), records
  the previews, pushes `plan_comment` (`__forgeSeedPlanComment`), plays the panel for
  `?page=plan-preview`, and the harness page defines the theme variables the preview uses.

## Scope notes (pre-existing defects this step had to fix)

1. **The webview's message loop awaited every host request** (`case "request":
   await this.processRequest(…)`). A permission request settles only when it's
   answered, so a pending prompt held up every other message: other sessions'
   streams, plan comments, and the reply to the prompt's own `set_permission_mode`.
   That made "Yes, and auto-accept" deadlock. The official doesn't await it
   (`case"request":this.processRequest($);break;`). Ported, with a spec whose
   negative control (putting `await` back) times out.
2. **`Session.onPermissionRequested` never attached.** It returned a no-op when
   the session had no connection yet, and the store subscribes at creation, so
   store-level permission events never fired. That covers `MW0`, and also the
   store's existing "switch to the session that asks". It now attaches once the
   connection is set. Spec, with a negative control.

Both are the minimum change; revert them and the plan flow stops working.

## Gates

- `pnpm test`: `Test Files 19 passed (19) · Tests 423 passed (423)`
- `pnpm run typecheck:all`: `tsc --noEmit` and `vue-tsc -p src/webview/tsconfig.json --noEmit`, both silent
- `pnpm run build`: `✓ built in 5m 36s` · exit 0. `Forge brand guardrail: clean (315 files scanned)` ·
  `Forge token check: clean (238 tokens used, 383 defined)` · `Forge command check: clean (20 commands, 13 references)`

## Oracle

| Window (root selector) | Structural diffs | Note |
| --- | --- | --- |
| permission prompt, ExitPlanMode | **0**, 20/20 | new |
| permission prompt, plan with 2 comments | **0**, 28/28 | new |
| permission prompt, Bash with 1 rule (step 16) | **0**, 30/30 | = step 16 |
| plan preview page (`probe-planpreview.js`), content | **0**, 29/29 | colour only: `code`/`blockquote` host defaults via Forge tokens |
| plan preview page, with the comment button and box | **0**, 36/36 | colour only: the two buttons are Forge purple |
| "Permission rules" dialog `.fg-dialog__dialog` | **0**, 61/61 | `.fg-dialog__overlay` at a 673.6px pane: 61/62, the overlay's own width 658.4 vs 659.2 (a fixed full-viewport box at a fractional width; 74/74 at 800px in step 16) |
| `.fg-composer__inputWrapper` (idle) | **0**, 29/29 | = baseline |
| `.fg-menu__menuPopup` (Modes menu) | **0**, 41/41 | = baseline |
| `.fg-commandmenu__menuPopup` model menu | Sonnet 50/50 · Opus 53/53 · Haiku 38/38 | = baseline |
| `.fg-commandmenu__menuPopup` "/" menu | Sonnet 79/79 · Opus with the fast-mode row 85/85 | = baseline |
| `.fg-shell__header` | **0**, 15/15 | = baseline |
| `.fg-markdown__root` (one-code-block message) | **1**, 8/9 | the known `codeBlockWrapper pre` font-family artifact |

## Specs added

`test/planPreview.spec.ts`, 30 cases:

- host panel: `marked` rendering; content and the comments switch on `ready` (on
  and off); comments passed on, and 9 malformed ones ignored (missing or empty id,
  text or comment, wrong types, other types, non-objects); title, removal, detach
  (no more comments, switch off), dispose;
- `ou$` (6 modes; `Plan`, `delegate`, `toString`, `constructor`, … refused);
  `set_permission_mode`: success; four bad modes refused in-band before the channel
  is looked up; bypass needs the flag; a CLI failure is `success:false`; a missing
  channel throws;
- the preview requests through the dispatcher: the panel (view type, title or
  default, page, column from the requesting webview); a comment stored and pushed
  as `plan_comment`; `get_plan_comments` per channel; a second plan reuses the
  panel and resets comments; remove and close; detached after shutdown; three
  malformed opens refused before anything is created;
- webview: `jW0` (7 cases); `MW0` opens with comments and closes on allow, not on
  deny, not without a plan, not for other tools; the labels for plan, plan with
  comments and ordinary prompts; `MU0`; the reject texts (`AS`, `_61`, `wM` and its
  double space); comments as feedback and never interrupting; the sanitiser's
  allowlists (51 tags, 20 attributes, handlers, `style`, `javascript:` in two
  spellings);
- transport: **a pending prompt does not hold up other messages**; the official
  payloads for the four requests and `userInitiated`; `plan_comment` accumulating,
  removal at once, clearing on a comment-less open;
- session: user pick `true`, prompt answer `false`, leaving `dontAsk` `false`;
  **a permission listener added before the connection exists still fires**; the
  session's own channel for the preview calls.

## Deviations from the official, deliberate

1. **Enter on "Send feedback and keep planning".** With plan comments the official
   leaves only the reject button, at focus index 0, and its Enter handler maps index
   0 to `C`. That *accepts* the plan and switches to acceptEdits, the opposite of the
   button's label. Forge's Enter does what the focused button says.
2. **The preview page is Forge's own bundle**, not the official's inline HTML. The
   official template names `rgba(0,0,0,0.3)`, a hex fallback and the host's fonts,
   which the brand gate refuses. Same markup, ids, copy and behaviour; fonts are
   Forge's, the shadows are a token (`--forge-shadow-heavy`), and the page is its
   own scroll container.
3. **The sanitiser also cleans the children of an element it drops.** The official
   moves them up unvisited, so `<foo><img onerror=…></foo>` kept its handler.
   Forge's CSP blocks inline handlers anyway; this closes the gap in the sanitiser too.
4. The preview's default title is "Forge’s Plan", matching Forge's transcript
   header (the official `PW0` is "Claude’s Plan").

## Left out, and why

1. **AskUserQuestion's branch of `EU0`** (`q`: "Submit answers", no fold button, no
   reject, and the question form from `BY("AskUserQuestion").permissionRequest`).
   Forge has no question form, so switching to those labels would leave the prompt
   unanswerable. Pre-existing gap: Forge's AskUserQuestion prompt is still the
   generic "Yes / No".
2. **`MW0`'s other branches**: the "Claude is requesting permission to use …"
   notification, and opening Edit / Write in a diff view. They're separate features
   (notifications, the diff panel), not plan labels.

Out of scope, unchanged: see the table in [16-permission-destination.md](16-permission-destination.md#rows-deliberately-left-out).

## VS Code checklist for the user — **unverified**

1. In Plan mode, ask for a plan and let Claude finish it. **Expected:** a tab named
   after the plan's heading (or "Forge’s Plan") opens beside the chat with the plan
   and "Ready for review"; the prompt reads "Accept this plan?".
2. Select a sentence in that tab → "Add Comment" → type → Enter. **Expected:** the
   text is highlighted with "1"; the prompt now shows "Comments (1)", "Continue
   planning", and a single "1 Send feedback and keep planning".
3. Click it. **Expected:** Claude keeps planning and its next plan addresses the
   comment; the highlight disappears; the mode stays Plan.
4. On the next plan, choose "Yes, and auto-accept". **Expected:** the preview tab
   closes, the mode becomes Edit automatically, Claude starts editing without asking.
5. Repeat and choose "Yes, and manually approve edits". **Expected:** mode Manual;
   Claude asks before each edit.
6. Repeat and choose "No, keep planning". **Expected:** the mode stays Plan; the
   preview stays open.
7. On an ordinary Bash prompt while in Plan mode. **Expected:** "Yes / No", no plan wording.
