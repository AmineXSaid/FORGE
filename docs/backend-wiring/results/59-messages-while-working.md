# 59: messages sent while the model is working

2026-09-23, branch `claude/endpoint-model-health-ebc111`.

Asked for: "Implement how claude deals with user inputs when llm is working, how
they treat the pending messages", with `/backend-parity`.

## What the official does (read, not assumed)

- **Submit** (`index.js` `e0`, then `W5`): no busy check anywhere.
  - The trimmed text is capped at 50,000 characters with
    "[Message truncated - exceeded 50,000 character limit]", and the box is cleared.
  - Then `session.send(text, attachments, !isSlash, {kind:"human"})`.
- **Send** (`Session.send`):
  - The user row is appended at once, busy or not.
  - The message goes straight to the CLI: `sendInput(channel, U, false)` with
    `U={type:"user",uuid,session_id:"",parent_tool_use_id:null,origin,message}`.
  - The webview keeps no queue.
- **The CLI does the queueing.** A message that arrives mid-turn is folded into the
  running turn between tool rounds, or runs as the next turn.
  - It is echoed back when taken: with `--replay-user-messages`,
    `SDKUserMessageReplay` (`isReplay: true`, the same uuid, sdk.d.ts:5923).
  - The turn's `result` lists what it consumed (`user_message_uuid(s)`,
    sdk.d.ts:5368-5372, 5402-5403).
  - The webview drops the echo of a row it already shows (by uuid).
- **Send button:** `if(busy&&!X) Stop else "Send message"`; `disabled:!busy&&!X`.
  So Stop appears only while a turn runs *and* the box is empty.
- **Escape:** the bootstrap's `document.body` keydown.
  - A plain Escape that nothing took (`Az0`) calls `interrupt()`, unless a
    permission prompt owns the key (`wo`).
  - Then focus goes back to the composer (`T`).
- **Slash commands:** a `/…` sent by the user is recorded (`slashSendUuids`). The
  re-read of what the CLI applied is armed when its echo arrives, i.e. when the
  CLI actually takes it.
- **Interrupt:** the official host sends a plain `query.interrupt()`, so queued
  messages survive it and run (the receipt's `still_queued`). It never uses
  `cancel_queued` or `cancel_async_message`.

## What Forge did

A message typed during a turn was **lost**:
- `ChatInputBox` diverted it to a `queueMessage` event after clearing the box, and
  nothing listened.
- `ChatPage.handleSubmit` also returned early while busy.
- The queue UI (`InputExtraBox`, `MessageQueueList`) was never mounted.

The rest:
- The send button was Stop for the whole turn.
- Escape did nothing.
- `origin` was never sent, and neither was the editor selection.
- A `/model` sent mid-turn re-read the settings at the end of the turn it was sent
  during, before it had run.
- The host treated one `result` as idle, so an endpoint switch could close a
  channel with a message still queued in the CLI.

## Result

| row | request | host result | UI effect | verdict |
| --- | --- | --- | --- | --- |
| Send during a turn | `io_message` (user, uuid, `origin: {kind:"human"}`) | written to the CLI at once; the channel records the uuid as pending (`pendingInputs.ts`) | row appears, box clears, nothing lost | **works**: harness (`__forgeIo` shows `duringTurn: true`); spec |
| Queued message runs as the next turn | CLI echo + `result.user_message_uuids` | pending cleared only when consumed | its reply follows; one row per message | **works**: harness ("Noted: first", "Noted: second"; one row each) |
| Queued message folded into the running turn | echo mid-turn | consumed by that turn | one reply covers both; no duplicate row | **works**: harness (`__forgeFoldQueued`; "Noted: third / fourth, folded") |
| Send button | none | none | idle and empty: disabled "Send message". Idle with text: Send. Turn and empty: Stop. Turn with text: Send | **works**: harness, all four states |
| Escape | `interrupt_claude` | plain interrupt; queued messages survive | Escape that closes a menu does not stop the turn; the next Escape stops it and focus returns to the composer | **works**: harness, with real mouse and key input |
| 50,000-character cap | none | none | text cut, with the official note | **spec** |
| `/…` sent mid-turn | echo arms the re-read | `get_applied_settings` after the turn that ran it | settings shown are the ones the command set | **spec** (fails on the old code) |
| Editor selection | `<ide_selection>` block | none | the footer chip shows "12 lines selected" and follows a change ("5 lines selected"); the first typed message carries lines 22-33, an unchanged selection is not sent again, and the next message after a change carries lines 40-44; slash commands never carry it | **works**: harness, and spec. The feed was broken: a Vue `watch` (and a Vue `computed`) over an alien signal never fired, so there was no chip and no context |
| Selection chip look | none | none | its remove control is the official icon button with the `f9` glyph (`a75`), not a footer button with a codicon | **composer: 37/40 clean, 1 structural diff**, the send icon's sparks (forge-design.md row 2, intended) |
| Endpoint switch with a message queued | `forge.endpointProfile` change | the channel stays until the queued message has had its turn, then relaunches | nothing lost across a switch | **spec** (host driven through its real output loop) |

Counts: 10 rows. 7 verified in the harness. 3 by spec only. None observed against
the real CLI.

Not ported:
- **`replayInsertIndex` placement** (`localTurnStarted`, `turnHadToolRound`,
  `foldedIntoTurn`). It decides where a replayed message *the webview never sent*
  lands, such as one typed into the same session from another client. Forge's CLI
  process has one client, so such messages only come from the CLI itself (hooks,
  task notifications), and they are appended. Unchanged from step 24.
- **`promptInputActive`**: Forge's permission prompt has no such flag, so with a
  prompt up, Escape always belongs to the prompt.

One difference in mechanics, not behaviour:
- The Escape handler reads `defaultPrevented` after the event has finished
  dispatching, from `window`, rather than on `body`. Some of Forge's overlays
  (the "+" menu, the flyout, the Mermaid viewer) listen on `document` or
  `window`, where a `body` listener would run before them.
- The "+" menu and the flyout now claim the Escape they use.

## Gates

- `pnpm test`: 1885 passed, 8 skipped (`pendingMessages.spec.ts` 15 new).
- `pnpm run typecheck:all`, `pnpm run lint:forge` and `pnpm run build`: clean.

## Checklist for your VS Code (unverified until you run it)

1. Ask for something that takes a while (e.g. "read every file in src and summarise
   them"). While it works, type "also list the tests" and press Enter.
   - Expected: the message appears at once in the transcript and the box clears.
   - The model takes it into account: at the next tool step, or as its own turn
     right after.
   - It appears once, never twice.
2. During a turn, with the box empty, look at the send button.
   - Expected: Stop. Type a letter: it turns into Send.
3. During a turn, press Escape.
   - Expected: the turn stops, and the cursor is back in the composer.
   - Open the `/` menu during a turn and press Escape: only the menu closes, and
     the turn keeps going.
4. Send `/effort high` while a turn runs.
   - Expected: after the turn that runs it, the effort pill shows High.
5. Select some lines in an editor, then send "what does this do?".
   - Expected: the footer shows "N lines selected", and the answer refers to those
     lines.
   - Sending `/compact` never carries the selection.
6. Start a long turn, send a second message, then switch the endpoint pair in the
   model menu before it finishes.
   - Expected: the second message still gets its answer, and the message after
     that goes to the new pair.
