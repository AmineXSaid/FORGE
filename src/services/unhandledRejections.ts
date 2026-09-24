/**
 * Unhandled promise rejections that come from Forge, in Forge's output channel.
 *
 * The extension host is one Node process shared by every extension, and it
 * already reports unhandled rejections in its own log, where nobody debugging
 * Forge looks. This listener adds nothing to that behaviour except a line in
 * the Forge channel, and only for a rejection whose stack runs through Forge's
 * own files: another extension's rejections are not Forge's to report
 * (production audit, 2026-09-24).
 */

/** Whether the rejection's stack names a file under the extension's folder. */
export function isFromExtension(reason: unknown, extensionPath: string): boolean {
  const stack = reason instanceof Error ? reason.stack : undefined;
  if (!stack || !extensionPath) return false;
  const normalize = (value: string) => value.replace(/\\/g, '/').toLowerCase();
  return normalize(stack).includes(normalize(extensionPath));
}

/** One line for the log: the message, then the stack when there is one. */
export function describeRejection(reason: unknown): string {
  if (reason instanceof Error) return reason.stack ?? `${reason.name}: ${reason.message}`;
  try {
    return typeof reason === 'string' ? reason : JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

export interface ProcessLike {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
}

/** Listen until the returned disposable is disposed (on deactivation). */
export function watchUnhandledRejections(
  extensionPath: string,
  log: (message: string) => void,
  target: ProcessLike = process,
): { dispose(): void } {
  const listener = (reason: unknown) => {
    if (isFromExtension(reason, extensionPath)) {
      log(`Unhandled promise rejection: ${describeRejection(reason)}`);
    }
  };
  target.on('unhandledRejection', listener);
  return { dispose: () => { target.off('unhandledRejection', listener); } };
}
