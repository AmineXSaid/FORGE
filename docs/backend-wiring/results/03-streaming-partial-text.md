# Results, step 03: Streaming text marked partial

Harness `--port 8735`, started from this build and restarted after the final
rebuild (checked: `window.__forgeSent` is an array; stylesheets `[1, 5, 9819]`;
the served `main.js` contains the assembler and the 50px pin rule). The prompt
was typed into the composer and sent (`io_message` user text
"Show me a code block and a table"). The stream was then driven with
`{type:'from-extension', message:{type:'io_message', channelId, message:{type:'stream_event', event, parent_tool_use_id}}}`.
No request is involved, so B2's six places don't apply, and `mock-host.js` is unchanged.

## What the bundle showed (the step file was incomplete)
Forge had no partial state at all: the host forwards `stream_event`, the webview
dropped it, and `ContentBlockWrapper` had no `partial`. Passing the prop alone
would always pass `false`. The step file is corrected. Ported: `y51`/`pR1`
(assembler), `Bj0` (deltas), `Kj0` (tool input JSON), `kJ.partial/complete/updated`,
`ZM` (final message replaces the row), `_Z.isEmpty`, `retireAbandonedStreamedRows`,
`Nn0`'s partial rules, and the chat view's 50px pin rule.

## Row checks

| # | Case | Request / event | Host result | UI effect | Verdict |
| --- | --- | --- | --- | --- | --- |
| T1 | `content_block_start` (empty text) | `stream_event` | — | no assistant row rendered (blank text row is `isEmpty`) | works |
| T2 | chunk "Here is a code block:" | `text_delta` | — | `<p>Here is a code block:</p>` (single paragraph shown whole, per `wL0`) | works |
| T3 | chunk ends inside an unclosed ```` ```ts ```` fence | `text_delta` | — | still only `<p>Here is a code block:</p>`; `pre` 0 | works |
| T4 | chunk closes the fence, ends inside a table | `text_delta` ×2 | — | code block + "And a table:" rendered; `table` 0 | works |
| T5 | `content_block_stop` | `stream_event` | — | full markdown: `pre` 1, `table` 1 (Name/Value, a 1, b 2) | works |
| T6 | final `assistant` (uuid, same `message.id`) | `io_message` | — | row replaced, not duplicated: 1 assistant row, 2 transcript rows | works |
| T7 | thinking stream | `thinking_delta` | — | label "Thinking..." and content grows; after stop "Thought process" | works |
| T8 | `tool_use` stream (`input_json_delta` split mid-string) | `stream_event` | — | hidden while partial (rows 3); visible after stop (4); final message replaces (4); tool_result attaches, row reads "Read / forge-tokens.css" | works |
| T9 | abandoned stream (`msg_B` then `message_start msg_C`) | `stream_event` | — | "STUCK attempt" row removed; "Retry text" shown | works |
| T10 | subagent stream (`parent_tool_use_id: toolu_task`) | `stream_event` | — | row streams "Subagent says hi", final message replaces it (1 row) | works |
| T11 | pinned at bottom, 40 paragraphs streamed | `text_delta` ×40 | — | gap to bottom 0, 0, 0, -1, -1, -1 (was 924px before the pin rule) | works |
| T12 | scrolled up (`scrollTop` 200), 20 paragraphs streamed | `text_delta` ×20 | — | `scrollTop` stays 200 (not yanked down) | works |
| R1 | composer send | `io_message` user | accepted | user row appears, busy (stop button, waiting indicator) | works (no regression) |
| R2 | `__forgeSeedTranscript` (non-streamed, no uuid) | `io_message` ×2 | — | +2 rows, text rendered | works (no regression) |
| R3 | copy button on the streamed code block | none | — | icon did not change; `navigator.clipboard` is denied in the pane (`NotAllowedError`) | not verifiable in harness |

**Counts:** works 14 · partial 0 · broken 0 · not verifiable 1 (R3) · rows left out 0.

## Specs added
`test/streamingPartialText.spec.ts`, 33 tests:
- `stablePartialText` (`wL0`): one paragraph, two, unclosed fence, half table, blank-line normalisation, a fence containing a blank line (literal official split), empty text.
- `applyDelta` / `finishToolInput` (`Bj0` / `Kj0`): text, thinking, signature, citations; tool JSON across chunks; invalid JSON kept as a string with an error; no input; **rejections**: mismatched delta types, `thinking_delta` on `redacted_thinking`, unknown delta.
- `StreamAssembler`: partial row, growth, revision, completion; **events before `message_start` / after `message_stop` ignored**; unknown index, `ping`, `undefined` ignored; one row per block; partial `tool_use` empty until stop; `redacted_thinking` gets no row but keeps indexes aligned; root and subagent streams kept apart, `onMessageStart` root only.
- `processAndAttachMessage` (`ZM`): replace a partial row; multi-block message; same uuid; **no replacement** when not streaming, without a uuid, for a different `message.id`, for blank final text or a blank row, or for a row with no API message id (a local user row); drop a message with no renderable content.
- `retireStreamedRows`, `Message.isEmpty` (blank, `(no content)`, partial `tool_use`, mixed).

## Gates
- `pnpm test`: 5 files, **59 tests** passed (33 new).
- `pnpm run typecheck:all`: `tsc --noEmit` and `vue-tsc` clean (exit 0).
- `pnpm run build`: exit 0. `Forge brand guardrail: clean (283 files scanned)`,
  `Forge token check: clean (180 tokens used, 344 defined)`,
  `Forge command check: clean (20 commands, 13 references)`, webview built, extension built.

## Oracle
| Window (root selector) | Checked | Structural diffs | Note |
| --- | --- | --- | --- |
| streamed assistant message (`[data-testid="assistant-message"]`, code block + table) | 23 | 1 row | `pre` font-family `"Forge Mono", ui-monospace` vs official `monospace` |
| non-streamed assistant message with a code block (control) | 10 | 1 row | the same `pre` row, so it already existed and isn't from this step |

The one row is the brand rule (code on GitLab Mono, never a system font); no CSS
was changed in this step. No classes outside the official CSS.

## Decisions and deviations
- `Bj0` throws on a mismatched delta; Forge **ignores** it so one malformed event
  can't end the `readMessages` loop (spec covers it).
- Rows are built only for `text`, `thinking` and `tool_use`. The official skips only
  `fallback`, but Forge's final-message parser drops `redacted_thinking` and shows
  other types as JSON text, so streaming them would leave rows the final message can't replace.
- Not ported (Forge has no consumer): thinking-token estimates, `message_delta`
  usage, `adoptTimingFrom` durations, prompt-cache records.
- Vue re-render: the official re-keys a row on each update; Forge bumps a
  `revision` signal, keys blocks by wrapper id, and `MessageRenderer` re-evaluates `isEmpty`.
- **Scope note:** the 50px pin rule in `ChatPage.vue` was added because enabling
  streaming made T11 fail (924px below the fold). It is the official rule, but it
  goes beyond "pass the flag". Revert that hunk if you want it as its own step.

## Issues that already existed, found but not fixed
- The status dot stays `dotProgress` after `content_block_stop` until the final message
  arrives: `AssistantMessage.vue` reads `isPartial` in a non-reactive computed. Step 04 rewrites that rule.
  **Fixed in step 04** (results/04, D8–D9: text rows get no status class, tool rows follow `p85`).
- `ThinkingBlock` labels: Forge says "Thought process"; official `rf1` says
  "Thought for Ns" or "Thinking", and renders a `div` (not `details`) when the thinking is empty.
- The empty state shows a "Meet Ultracode" card with "Try Ultracode". Ultracode is out of scope (`out-of-scope.md`).
- The count watcher in `ChatPage.vue` still scrolls on every new row even when the user has scrolled up (the official only does that within 50px).

## VS Code checklist for the user (unverified)
1. Ask for a long answer with a code block and a table. **Expected:** text streams
   in paragraph by paragraph; a half-written fence or table never appears; once the
   block finishes, the full code block and table render.
2. While it streams, stay at the bottom. **Expected:** the view follows the new text.
   Scroll up mid-stream. **Expected:** the view stays where you put it.
3. Ask something that reads a file. **Expected:** the Read row appears only once its
   input is complete (no half-empty tool row), then shows its result.
4. With thinking on, send a prompt. **Expected:** "Thinking..." while it streams, then the collapsed thought.
5. Reload the conversation from history. **Expected:** the same transcript, with no duplicated or missing rows.
