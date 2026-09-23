/**
 * What the composer does with input while the model is working, ported from
 * the official webview.
 *
 * The official has no queue of its own. A message typed during a turn is sent
 * at once, exactly like any other: it is appended to the transcript and written
 * to the CLI, and the CLI holds it and folds it into the running turn between
 * tool rounds (or runs it as the next turn). Its echo (`isReplay`, same uuid)
 * is then dropped by the replay guard in `processAndAttachMessage`.
 *
 * Forge used to divert such a message to a `queueMessage` event nothing
 * listened to, after clearing the box, so it was lost.
 */

/** The official composer's cap (`K0=50000` in its submit, `e0`). */
export const MAX_PROMPT_CHARS = 50000;

/**
 * The official `e0`: over the cap, the text is cut and says so.
 *
 *   if(H1.length>K0)w0=H1.slice(0,K0)+`\n\n[Message truncated - exceeded 50,000 character limit]`
 */
export function capPrompt(text: string): string {
  if (text.length <= MAX_PROMPT_CHARS) return text;
  return `${text.slice(0, MAX_PROMPT_CHARS)}\n\n[Message truncated - exceeded 50,000 character limit]`;
}

export type SendButtonState = 'stop' | 'enabled' | 'disabled';

/**
 * The official send button:
 *
 *   if($.busy.value&&!X)E=F($21,…),I="Stop";else E=F(bo,…),I="Send message";
 *   F("button",{type:"submit",disabled:!$.busy.value&&!X,…,
 *     onClick:(Y0)=>{if($.busy.value&&!X)Y0.preventDefault(),$.interrupt()}})
 *
 * `X` is `canSendMessage` (`!!input.trim()`). So Stop only while a turn runs
 * and the box is empty; with text in it the button sends, turn or not.
 */
export function sendButtonState(busy: boolean, hasText: boolean): SendButtonState {
  if (busy && !hasText) return 'stop';
  if (!busy && !hasText) return 'disabled';
  return 'enabled';
}

/** The official accessible names for the two faces of the button. */
export function sendButtonLabel(state: SendButtonState): string {
  return state === 'stop' ? 'Stop' : 'Send message';
}

/**
 * The official `Az0`: a plain Escape that nothing else has handled.
 *
 *   if($.key!=="Escape"||$.defaultPrevented)return!1;if($.repeat)return!1;
 *   if($.altKey||$.ctrlKey||$.metaKey||$.shiftKey)return!1;
 *   return!$.isComposing&&$.keyCode!==229
 */
export function isInterruptKey(event: Pick<KeyboardEvent,
  'key' | 'defaultPrevented' | 'repeat' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'isComposing' | 'keyCode'>): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented) return false;
  if (event.repeat) return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  return !event.isComposing && event.keyCode !== 229;
}

/**
 * The official `wo`: a permission prompt is up and owns Escape.
 *
 *   function wo($){return $.permissionRequests.value.length>0&&!$.promptInputActive.value}
 *
 * Forge has no `promptInputActive` (the official's flag for typing into the
 * prompt's own feedback field), so it is taken as false: with a prompt up,
 * Escape always belongs to the prompt.
 */
export function permissionOwnsEscape(pendingPermissionCount: number, promptInputActive = false): boolean {
  return pendingPermissionCount > 0 && !promptInputActive;
}
