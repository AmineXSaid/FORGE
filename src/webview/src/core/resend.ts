/**
 * Retry and edit-and-resend on a user message (asked for on 2026-10-03).
 *
 * Both are the official fork (`forkConversation`, step 25) with one change:
 * the forked conversation stops just *before* the message, and instead of
 * leaving the prompt in its composer it sends it -- unchanged for Retry, as
 * edited for Edit. The original conversation is kept as it was, in history.
 *
 * The fork opens the new conversation through `initialPrompt`, which the chat
 * page puts in the composer. `markAutoSend` tells it, once, to send that
 * prompt instead.
 */

interface TranscriptMessage {
  uuid?: string;
  type?: string;
}

let pending: string | undefined;

/** The next `initialPrompt` equal to `text` is sent rather than drafted. */
export function markAutoSend(text: string): void {
  pending = text;
}

/** Whether `prompt` is the one marked: consumes the mark when it is. */
export function takeAutoSend(prompt: string): boolean {
  if (pending === undefined || pending !== prompt) return false;
  pending = undefined;
  return true;
}

/** Forget a mark whose fork failed. */
export function clearAutoSend(): void {
  pending = undefined;
}

/**
 * Where a fork that re-asks `message` resumes: the nearest earlier user or
 * assistant message with a uuid (the official `I` in `HU0`), or undefined for
 * the first message, which has nothing before it.
 */
export function resumePointBefore<T extends TranscriptMessage>(messages: readonly T[], message: T): string | undefined {
  for (let i = messages.indexOf(message) - 1; i >= 0; i--) {
    const earlier = messages[i];
    if (earlier?.uuid && (earlier.type === 'assistant' || earlier.type === 'user')) return earlier.uuid;
  }
  return undefined;
}
