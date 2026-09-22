import { VSCodeTransport } from '../transport/VSCodeTransport';
import { EventEmitter } from '../utils/events';

// Webview 宿主内的全局 Transport 单例
// 每个 Webview 进程各自拥有一份实例，但在同一宿主中只创建一次
export const atMentionEvents = new EventEmitter<string>();
export const selectionEvents = new EventEmitter<any>();

export const transport = new VSCodeTransport(atMentionEvents, selectionEvents);

/**
 * Fire a host request whose only result is that something opens, and say so
 * when it doesn't.
 *
 * `void transport.openSettings(...)` drops the rejection on the floor, so a
 * menu row whose request the host cannot answer looks exactly like a row that
 * is wired to nothing. That is not hypothetical: a VSIX shipped with a webview
 * newer than its extension host, every "/" row sent `open_settings`, the host
 * threw `Unknown request type`, and the menu simply closed. A visible failure
 * would have named the cause in one click.
 *
 * @param label What the user asked for, used in the message: "Forge could not
 *              open Settings".
 */
export function runHostAction(label: string, action: () => Promise<unknown>): void {
  void action().catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[Forge] ${label} failed:`, error);
    // If even the notification cannot be delivered the host is gone, and the
    // console line above is all there is. Swallowing it here keeps that case
    // from becoming an unhandled rejection on top of the original failure.
    transport
      .showNotification(`Forge could not ${label}. ${detail}`, 'error')
      .catch(() => {});
  });
}

