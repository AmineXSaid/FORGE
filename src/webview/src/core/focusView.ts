/**
 * Step 30: Focus view -- the transcript with only your prompts and Forge's
 * replies, and one fold row standing in for each run of hidden steps.
 *
 * Ported from the official `DL1` and its helpers (index.js @3465127) and the
 * fold row's labels `EK1` / `Cq0` (@4854511). The official's shape, verbatim:
 *
 *   x8 = focusViewEnabled ? DL1(messages, busy, isToolHidden, teleported) : null
 *   rows: {kind:"message",idx,msg} | {kind:"fold",fold} | {kind:"todo",idx,content}
 *
 * A row is **visible** (`f` in the official `mj0`) when:
 *
 *   msg.type === "user" ? BL1(msg)
 *                       : vj0(msg) || (msg.type === "assistant" && S51(msg) …)
 *
 * -- a real user prompt, a meta/compact row, or an assistant message that has
 * non-blank text. Everything else (tool calls, tool results, thinking, blank
 * assistant turns) folds.
 *
 * ## What is not ported, and why
 *
 * The official algorithm also threads four things Forge's transcript model has
 * no counterpart for, so porting them would mean inventing fields (backend
 * parity rule 3):
 *
 * - **subagent spans** (`uj0` / `PL1` / `gj0`, and the `IK1` subagent rows):
 *   Forge has no `subagentTasks` feed. The per-message tests are ported,
 *   though: a message carrying `parentToolUseId` / `sdkParentToolUseId` (`Xv`)
 *   is a subagent's, and neither starts a turn nor draws a row of its own;
 * - **synthetic messages** (`isSynthetic`) and `origin`-based user filtering
 *   (`FL1` / `AL1`): Forge's `Message` carries neither, so the user-side test
 *   is `!isEmpty` plus the meta check;
 * - **teleported messages** (`teleportedMessageCount` and the branch banner);
 * - **thinking duration**: `ContentBlock` never receives `durationMillis` in
 *   Forge, so a thinking-only fold reads "Thinking" rather than "Thought for
 *   Ns". The `thinkingMillis` field is kept and stays null.
 *
 * Everything else -- the run grouping, the retried-attempt test (`B` / `K` via
 * `betaMessageId`), the live / provisionallySettled / settled progress, the
 * counts, the pending tool name, the TodoWrite lift-out and the fold key -- is
 * the official's.
 *
 * Kept free of Vue so `test/focusView.spec.ts` can drive it directly.
 */

import { isSubagentMessage, type Message } from '../models/Message';
import type { ContentBlockWrapper } from '../models/ContentBlockWrapper';

/** The official `JM`: the tool whose output is lifted out of the fold. */
export const TODO_TOOL = 'TodoWrite';

/** The official `fJ`: the tool that asks the user, not the filesystem. */
export const ASK_USER_QUESTION_TOOL = 'AskUserQuestion';

export interface FocusFold {
  /** The official `focus-fold-<turnKey>-<blockKey>`, unique within the transcript. */
  key: string;
  /** The messages this row stands in for, in transcript order. */
  messages: Array<{ idx: number; msg: Message }>;
  toolCallCount: number;
  errorCount: number;
  /** Messages that would have drawn something (the official `y`). */
  hiddenRenderableCount: number;
  thinkingOnly: boolean;
  /** Always null in Forge; see the header. */
  thinkingMillis: number | null;
  thinkingStreaming: boolean;
  /** The tool the run is waiting on, while it is live. */
  pendingToolName?: string;
  progress: 'live' | 'provisionallySettled' | 'settled';
  firstIdx: number;
}

export type FocusRow =
  | { kind: 'message'; idx: number; msg: Message }
  | { kind: 'fold'; fold: FocusFold }
  | { kind: 'todo'; idx: number; content: ContentBlockWrapper };

/** The blocks of a message, or `[]` for the string form. */
function blocks(msg: Message): ContentBlockWrapper[] {
  const content = msg.message.content;
  return Array.isArray(content) ? content : [];
}

/** The official `GU`: text that is only whitespace draws nothing. */
function isBlankText(block: { type: string; text?: string }): boolean {
  return block.type === 'text' && (block.text ?? '').trim().length === 0;
}

/** The official `S51`: the message has at least one non-blank text block. */
export function hasVisibleText(msg: Message): boolean {
  return blocks(msg).some((w) => w.content.type === 'text' && !isBlankText(w.content as any));
}

/** The official `vj0`, restricted to the row types Forge builds. */
export function isMetaRow(msg: Message): boolean {
  return msg.type === 'meta';
}

/**
 * The official `BL1` (`!$.isEmpty&&!$.parentToolUseId&&!$.isSynthetic&&!pj0($)`),
 * minus the `isSynthetic` / origin tests Forge's model does not carry: a user
 * row survives when it is not empty and not a subagent's. `isEmpty` is already
 * the official `_Z.isEmpty`, so a row of only tool results is excluded here
 * exactly as it is there.
 */
export function isUserPrompt(msg: Message): boolean {
  return !msg.isEmpty && !msg.parentToolUseId;
}

/** The official `f` in `mj0`: does this message draw a row of its own? */
export function isFocusVisible(msg: Message): boolean {
  if (msg.type === 'user') return isUserPrompt(msg);
  if (isMetaRow(msg)) return true;
  // `!Xv(I)&&S51(I)`: a subagent's text folds into the turn.
  return msg.type === 'assistant' && !isSubagentMessage(msg) && hasVisibleText(msg);
}

/** The official `Qv`: a turn starts at a user message carrying typed text. */
function startsTurn(msg: Message): boolean {
  // `if($.isEmpty||$.parentToolUseId||$.isSynthetic)return!1`
  if (msg.type !== 'user' || msg.isEmpty || msg.parentToolUseId) return false;
  const content = msg.message.content;
  if (typeof content === 'string') return content.length > 0;
  return content.some((w) => w.content.type === 'text');
}

/** The official `KL1`: the TodoWrite input's `todos`, when there are any. */
function todosOf(input: unknown): unknown[] | undefined {
  return typeof input === 'object' && input !== null && 'todos' in input && Array.isArray((input as any).todos)
    ? ((input as any).todos as unknown[])
    : undefined;
}

/**
 * The official `cj0`: the last assistant message holding a settled, non-error
 * TodoWrite call with a non-empty list. Its block is lifted out of the fold and
 * drawn on its own, so the todo list stays visible in focus view.
 */
function findTodoBlock(
  messages: Message[]
): { idx: number; content: ContentBlockWrapper } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type !== 'assistant') continue;
    const found = blocks(msg)
      .filter(
        (w) =>
          w.content.type === 'tool_use' &&
          (w.content as any).name === TODO_TOOL &&
          !w.isPartial &&
          w.toolResult()?.is_error !== true &&
          todosOf((w.content as any).input) !== undefined
      )
      .at(-1);
    if (found === undefined) continue;
    const todos = todosOf((found.content as any).input);
    return todos !== undefined && todos.length > 0 ? { idx: i, content: found } : undefined;
  }
  return undefined;
}

export interface FocusViewOptions {
  /** The session is working (`$.busy.value`). */
  busy: boolean;
  /** `BY(name, context).hidden`: a tool whose renderer draws nothing. */
  isToolHidden: (toolName: string) => boolean;
}

/**
 * The official `DL1`: split the transcript into turns, then fold each turn.
 */
export function focusViewRows(messages: Message[], options: FocusViewOptions): FocusRow[] {
  const todo = findTodoBlock(messages);
  // The official `G`: the last assistant message in the whole transcript.
  let lastAssistant = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === 'assistant') {
      lastAssistant = i;
      break;
    }
  }
  const rows: FocusRow[] = [];
  let start = 0;
  while (start < messages.length) {
    let end = start + 1;
    while (end < messages.length && !startsTurn(messages[end])) end++;
    foldTurn(rows, messages, start, end, options, lastAssistant, todo);
    start = end;
  }
  return rows;
}

/** The official `mj0`, for one turn. */
function foldTurn(
  out: FocusRow[],
  messages: Message[],
  start: number,
  end: number,
  options: FocusViewOptions,
  lastAssistant: number,
  todo: { idx: number; content: ContentBlockWrapper } | undefined
): void {
  const { busy, isToolHidden } = options;

  // `V`: this turn is the one still running.
  let live = busy && (end === messages.length || (lastAssistant >= start && lastAssistant < end));

  // `H` / `W`: the last assistant message in this turn that actually said
  // something, and its API message id. Anything before it that belongs to a
  // *different* API message is a retried attempt, and its unfinished tool calls
  // are not failures (`K`) and do not keep the turn live (`B`).
  let lastSpeaking = -1;
  if (live) {
    for (let i = end - 1; i >= start; i--) {
      const msg = messages[i];
      if (msg.type === 'assistant' && !isSubagentMessage(msg) && hasVisibleText(msg)) {
        lastSpeaking = i;
        break;
      }
    }
  }
  const speakingId = lastSpeaking === -1 ? undefined : messages[lastSpeaking].betaMessageId;
  // `B=(E,I)=>I<H&&!Xv(E)`
  const beforeLastSpeaking = (msg: Message, idx: number): boolean => idx < lastSpeaking && !isSubagentMessage(msg);
  const isRetriedAttempt = (msg: Message, idx: number): boolean =>
    beforeLastSpeaking(msg, idx) &&
    speakingId !== undefined &&
    msg.betaMessageId !== undefined &&
    msg.betaMessageId !== speakingId;

  // `D`: the turn looked live, but nothing in it is actually pending, and a
  // later turn exists -- so it is settled as far as anyone can tell, without
  // claiming it finished cleanly.
  let provisionallySettled = false;
  if (live && end < messages.length) {
    let pending = false;
    for (let i = start; i < end && !pending; i++) {
      const msg = messages[i];
      if (msg.type !== 'assistant') continue;
      for (const w of blocks(msg)) {
        if (w.content.type === 'tool_use') {
          if (w.toolResult() === undefined && !isRetriedAttempt(msg, i)) {
            pending = true;
            break;
          }
        } else if (w.isPartial && !beforeLastSpeaking(msg, i)) {
          pending = true;
          break;
        }
      }
    }
    if (!pending) {
      live = false;
      provisionallySettled = true;
    }
  }

  // A user prompt after the last assistant message ends the turn's liveness.
  if ((live || provisionallySettled) && lastAssistant >= start && lastAssistant < end) {
    for (let i = lastAssistant + 1; i < end; i++) {
      const msg = messages[i];
      if (msg.type === 'user' && isUserPrompt(msg)) {
        live = false;
        provisionallySettled = false;
        break;
      }
    }
  }

  // `P` / `M`: which rows survive, and which fold.
  const hiddenRuns: Array<{ idx: number; msg: Message }> = [];
  const visible: boolean[] = [];
  for (let i = start; i < end; i++) {
    const msg = messages[i];
    const shown = isFocusVisible(msg);
    visible.push(shown);
    if (!shown) hiddenRuns.push({ idx: i, msg });
  }

  if (hiddenRuns.length === 0) {
    for (let i = start; i < end; i++) out.push({ kind: 'message', idx: i, msg: messages[i] });
    return;
  }

  // `w`: the lifted todo block, when it belongs to a message in this turn that
  // is itself folded away.
  const lifted = todo !== undefined && todo.idx >= start && todo.idx < end && !visible[todo.idx - start] ? todo : undefined;

  // `N`: consecutive hidden messages become one fold.
  const runs: Array<Array<{ idx: number; msg: Message }>> = [];
  for (const entry of hiddenRuns) {
    const last = runs.at(-1);
    if (last !== undefined && last.at(-1)!.idx === entry.idx - 1) last.push(entry);
    else runs.push([entry]);
  }

  const turnKey = messages[start].uuid ?? String(start);
  const usedKeys = new Set<string>();
  const foldByFirstIdx = new Map<number, FocusFold>();

  for (const run of runs) {
    let toolCallCount = 0;
    let errorCount = 0;
    let hiddenRenderableCount = 0;
    let pendingToolName: string | undefined;
    let nonThinking = false;
    let thinkingMillis: number | null = null;
    let thinkingStreaming = false;

    for (const { idx, msg } of run) {
      if (msg.type !== 'assistant') {
        // A user row that is hidden but would have drawn something still counts.
        if (msg.type === 'user' && !msg.isEmpty && !msg.parentToolUseId) {
          hiddenRenderableCount++;
          nonThinking = true;
        }
        continue;
      }
      const renderable = !msg.isEmpty;
      let drewSomething = false;
      for (const w of blocks(msg)) {
        if (lifted !== undefined && w === lifted.content) continue;
        if (w.content.type !== 'tool_use') {
          // The official also tests `redacted_thinking`; Forge's `ContentBlock`
          // union has no such member, so there is nothing to match.
          if (w.content.type === 'thinking') {
            drewSomething = true;
            if (renderable && w.isPartial && !beforeLastSpeaking(msg, idx)) thinkingStreaming = true;
          } else if (w.content.type !== 'text' || isBlankText(w.content as any)) {
            drewSomething = true;
            if (renderable) nonThinking = true;
          }
          continue;
        }
        if (isToolHidden((w.content as any).name)) continue;
        const result = w.toolResult();
        if (live && result === undefined && !isRetriedAttempt(msg, idx)) {
          pendingToolName = (w.content as any).name;
        }
        if (!renderable) continue;
        drewSomething = true;
        toolCallCount++;
        if (result?.is_error || (result === undefined && (!busy || isRetriedAttempt(msg, idx)))) errorCount++;
      }
      if (renderable && drewSomething) hiddenRenderableCount++;
    }

    // Nothing worth standing in for: the run simply disappears.
    if (!(hiddenRenderableCount > 0 || toolCallCount > 0 || (live && pendingToolName !== undefined))) continue;

    const withoutLifted =
      lifted === undefined
        ? run
        : run.flatMap(({ idx, msg }) => (blocks(msg).includes(lifted.content) && blocks(msg).length === 1 ? [] : [{ idx, msg }]));
    const anchor = withoutLifted[0] ?? run[0];
    const firstBlock = blocks(anchor.msg)[0]?.content as { type?: string; id?: string } | undefined;
    const blockKey =
      firstBlock?.type === 'tool_use' || firstBlock?.type === 'server_tool_use'
        ? `t${firstBlock.id}`
        : (anchor.msg.betaMessageId ?? anchor.msg.uuid ?? `i${anchor.idx - start}`);
    let key = `focus-fold-${turnKey}-${blockKey}`;
    if (usedKeys.has(key)) key = `${key}-i${anchor.idx - start}`;
    usedKeys.add(key);

    foldByFirstIdx.set(run[0].idx, {
      key,
      messages: withoutLifted,
      toolCallCount,
      errorCount,
      hiddenRenderableCount,
      thinkingOnly: toolCallCount === 0 && hiddenRenderableCount > 0 && !nonThinking,
      thinkingMillis,
      thinkingStreaming: live && thinkingStreaming,
      pendingToolName: live ? pendingToolName : undefined,
      progress: live ? 'live' : provisionallySettled ? 'provisionallySettled' : 'settled',
      firstIdx: (withoutLifted[0] ?? run[0]).idx,
    });
  }

  for (let i = start; i < end; i++) {
    if (visible[i - start]) {
      out.push({ kind: 'message', idx: i, msg: messages[i] });
      continue;
    }
    const fold = foldByFirstIdx.get(i);
    if (fold !== undefined) out.push({ kind: 'fold', fold });
    if (lifted !== undefined && i === lifted.idx) out.push({ kind: 'todo', idx: i, content: lifted.content });
  }
}

/** The official `NY`. */
const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many);

/** The official `EK1`: the fold row's label. */
export function foldLabel(fold: FocusFold): string {
  if (fold.toolCallCount > 0) {
    const calls = `${fold.toolCallCount} ${plural(fold.toolCallCount, 'tool call')}`;
    return fold.errorCount > 0 ? `${calls} · ${fold.errorCount} failed` : calls;
  }
  if (fold.thinkingOnly) {
    if (fold.thinkingStreaming) return 'Thinking…';
    return fold.thinkingMillis !== null
      ? `Thought for ${Math.max(1, Math.round(fold.thinkingMillis / 1000))}s`
      : 'Thinking';
  }
  const hidden = Math.max(fold.hiddenRenderableCount, 1);
  return `${hidden} ${plural(hidden, 'hidden step')}`;
}

/** The official `Cq0`: the pulsing line, only while the fold is live. */
export function foldRunningLabel(fold: FocusFold, permissionPending: boolean): string | null {
  if (fold.progress !== 'live') return null;
  if (fold.pendingToolName !== undefined) {
    if (permissionPending) return 'Waiting for permission…';
    if (fold.pendingToolName === ASK_USER_QUESTION_TOOL) return 'Waiting for your answer…';
    return `Running ${fold.pendingToolName}…`;
  }
  return fold.thinkingStreaming ? 'Thinking…' : null;
}

/** The official `L25`: which timeline dot the row gets. */
export function foldDotState(fold: FocusFold, permissionPending: boolean): 'progress' | 'failure' | 'success' {
  if (foldRunningLabel(fold, permissionPending) !== null || fold.thinkingStreaming) return 'progress';
  return fold.errorCount > 0 ? 'failure' : 'success';
}

export const FOLD_DOT_CLASS: Record<'progress' | 'failure' | 'success', string> = {
  progress: 'fg-chat__dotProgress',
  failure: 'fg-chat__dotFailure',
  success: 'fg-chat__dotSuccess',
};

/**
 * The official `ML1`: which folds open themselves. A fold that is still running
 * opens so the work is watchable; once it settles its key is remembered in
 * `settled`, so it never auto-opens again and collapses back to its summary.
 * `settled` is mutated, as the official mutates its ref.
 */
export function autoExpandedFolds(rows: FocusRow[] | null, settled: Set<string>): Set<string> {
  const open = new Set<string>();
  if (!rows) return open;
  for (const row of rows) {
    if (row.kind !== 'fold') continue;
    if (row.fold.progress === 'settled') settled.add(row.fold.key);
    else if (!settled.has(row.fold.key)) open.add(row.fold.key);
  }
  return open;
}

/**
 * The official `jL1`: toggling focus view clears what the user had opened, and
 * a key that stopped auto-opening is dropped from the set.
 */
export function reconcileExpanded(
  expanded: Set<string>,
  focusViewToggled: boolean,
  noLongerAuto: readonly string[]
): Set<string> {
  if (focusViewToggled) return expanded.size > 0 ? new Set<string>() : expanded;
  let next: Set<string> | undefined;
  for (const key of noLongerAuto) {
    if (expanded.has(key)) {
      next ??= new Set(expanded);
      next.delete(key);
    }
  }
  return next ?? expanded;
}

/** The official `wL1`: forget keys for folds that are no longer in the transcript. */
export function pruneSettled(settled: Set<string>, rows: FocusRow[] | null): void {
  if (!rows) return;
  const live = new Set<string>();
  for (const row of rows) if (row.kind === 'fold') live.add(row.fold.key);
  for (const key of settled) if (!live.has(key)) settled.delete(key);
}
