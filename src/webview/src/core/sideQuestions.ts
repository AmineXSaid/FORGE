/**
 * `/btw` side questions: the panel's state, ported from the official webview
 * (index.js `tG0`, `e05`, `$55`, `KK1`, `Po`, `DK1`). The panel itself is
 * Forge's own -- a floating card you can drag, minimise and close -- but what
 * it holds and how a question becomes an answer follow the official.
 */
import type { SideQuestionHistoryItem, SideQuestionResponse } from '../../../shared/messages';

/** The official `FK1`: the thread keeps the last 20 exchanges. */
export const MAX_THREAD = 20;

/** The official copy. */
export const SIDE_COPY = {
  title: 'Side question',
  empty: 'Ask a quick side question below without interrupting the conversation.',
  placeholder: 'Ask a side question',
  pending: 'Answering…',
  noAnswer: "Claude didn't return an answer for this side question.",
  cancelled: 'Cancelled.',
  clear: 'Clear side questions',
  send: 'Send side question',
  failed: (message: string) => `Failed to get an answer: ${message}`,
  /** The "/" row (official registerAction). */
  rowDescription: 'Ask a quick side question without interrupting the main conversation',
} as const;

export type SideItem =
  | { kind: 'answer'; question: string; response: string; fallbackNotice?: string }
  | { kind: 'synthetic'; question: string; notice: string }
  | { kind: 'no-answer'; question: string }
  | { kind: 'error'; question: string; message: string }
  | { kind: 'cancelled'; question: string };

export interface SideState {
  visible: boolean;
  /** Forge: folded to its title bar, still asking and answering. */
  minimized: boolean;
  /** One-shot: focus the input on the next render (official `focusRequested`). */
  focusRequested: boolean;
  thread: Array<{ id: number; item: SideItem }>;
  pending: { question: string } | null;
}

export const EMPTY_SIDE_STATE: SideState = {
  visible: false,
  minimized: false,
  focusRequested: false,
  thread: [],
  pending: null,
};

/** The official `tG0`: `/btw` and its question, or null for anything else. */
export function parseBtw(text: string): { question: string } | null {
  const match = text.trim().match(/^\/btw(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  return { question: match[1]?.trim() ?? '' };
}

/** The official `e05`: what goes back as context -- answered exchanges only. */
export function toHistory(thread: SideState['thread']): SideQuestionHistoryItem[] {
  return thread.flatMap(({ item }) =>
    item.kind === 'answer'
      ? [{ question: item.question, response: item.response, ...(item.fallbackNotice && { fallbackNotice: item.fallbackNotice }) }]
      : []
  );
}

/** The official `$55`: the host's answer as a thread item. */
export function itemFrom(question: string, response: SideQuestionResponse): SideItem {
  const text = response.response != null && response.response.trim() !== '' ? response.response : null;
  if (response.error) return { kind: 'error', question, message: response.error };
  if (text == null) return { kind: 'no-answer', question };
  if (response.synthetic) return { kind: 'synthetic', question, notice: text };
  return { kind: 'answer', question, response: text, ...(response.fallbackNotice && { fallbackNotice: response.fallbackNotice }) };
}

let nextId = 0;

/** The official `KK1`: append, keep the last 20, settle the matching pending. */
export function appendItem(state: SideState, item: SideItem): SideState {
  const pendingQuestion = state.pending?.question;
  return {
    ...state,
    thread: [...state.thread, { id: nextId++, item }].slice(-MAX_THREAD),
    pending: pendingQuestion === item.question && item.kind !== 'cancelled' ? null : state.pending,
  };
}

/** The official `DK1`: show it and focus the input. Forge also unfolds it. */
export function openPanel(state: SideState): SideState {
  return { ...state, visible: true, minimized: false, focusRequested: true };
}

interface NamedCommand {
  name: string;
  description: string;
  argumentHint: string;
  aliases?: string[];
}

/** The official `jK1(commands,"btw")`: the CLI has a `/btw` of its own. */
export function cliHasBtw(commands: readonly { name?: unknown }[] | undefined): boolean {
  return Array.isArray(commands) && commands.some((c) => c?.name === 'btw');
}

/**
 * The CLI's commands, plus the official `/btw` row (id `slash-command-btw`,
 * "[question]") when the CLI has none of its own: the "/" menu row and typed
 * completion both come from this list. Picking the row sends `/btw`, which
 * the send path turns into the panel, as the official row's `DK1` does.
 */
export function withSideQuestionCommand<T extends NamedCommand>(commands: readonly T[] | undefined): T[] {
  const list = Array.isArray(commands) ? commands : [];
  // The official registers the row from the webview itself, so it is there
  // before (and without) the CLI's list; a CLI `/btw` replaces it.
  if (cliHasBtw(list)) return [...list];
  return [...list, { name: 'btw', description: SIDE_COPY.rowDescription, argumentHint: '[question]' } as T];
}
