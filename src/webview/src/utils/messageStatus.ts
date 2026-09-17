/**
 * The assistant row's status dot, ported from the official `p85(message, busy)`
 * (REF/webview/index.js) and the class pick in `u85`.
 */

import type { Message } from '../models/Message';

export type MessageStatus = 'success' | 'failure' | 'progress' | null;

/**
 * Only the first tool_use decides: without a result it is in progress while the
 * session is busy and a failure once it is not; with a result it fails when the
 * result is an error and succeeds otherwise. A message with no tool_use (plain
 * text, thinking) has no status.
 */
export function messageStatus(message: Message, busy: boolean): MessageStatus {
  if (message.type !== 'assistant') return null;
  const content = message.message.content;
  if (!Array.isArray(content)) return null;
  for (const wrapper of content) {
    if (wrapper.content.type !== 'tool_use') continue;
    const result = wrapper.toolResult();
    if (!result) return busy ? 'progress' : 'failure';
    return result.is_error ? 'failure' : 'success';
  }
  return null;
}

/** The official `u85` class pick; no status adds no class (the base grey dot stays). */
export function statusDotClass(status: MessageStatus): string {
  switch (status) {
    case 'success':
      return 'fg-chat__dotSuccess';
    case 'failure':
      return 'fg-chat__dotFailure';
    case 'progress':
      return 'fg-chat__dotProgress';
    default:
      return '';
  }
}
