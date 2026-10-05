/**
 * "Copy responses" (Forge, asked for 2026-10-05): everything the model wrote
 * on the chat page, as one block of markdown -- the text of every top-level
 * assistant message, in order, separated by a blank line. Subagents' own
 * messages, tool calls, tool output and thinking are not the model's reply to
 * you, so they are left out.
 *
 * Pure, so the spec drives it without a webview.
 */

interface SourceBlock {
  content: { type?: string; text?: string };
}

export interface SourceMessage {
  type: string;
  parentToolUseId?: string | null;
  sdkParentToolUseId?: string | null;
  message: { content: unknown };
}

/** The CLI's placeholder for a turn with no text (the official `S_1`). */
const NO_CONTENT = '(no content)';

export function responsesText(messages: readonly SourceMessage[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.type !== 'assistant') continue;
    if (message.parentToolUseId || message.sdkParentToolUseId) continue;
    const content = message.message.content;
    if (typeof content === 'string') {
      if (content.trim() && content.trim() !== NO_CONTENT) parts.push(content.trim());
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const block of content as SourceBlock[]) {
      const text = block?.content?.type === 'text' ? block.content.text?.trim() : undefined;
      if (text && text !== NO_CONTENT) parts.push(text);
    }
  }
  return parts.join('\n\n');
}
