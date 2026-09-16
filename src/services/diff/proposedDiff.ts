/**
 * Interactive review for a proposed diff.
 *
 * When Claude proposes an edit, Forge opens a diff editor and waits for the user
 * to accept or reject it from the editor title bar, mirroring the official
 * extension. The decision is communicated back through the `open_diff` response:
 * accepting returns the proposed edits, rejecting returns none, and the CLI
 * applies whatever comes back.
 *
 * Without this the diff is purely informational -- it opens, and the edit is
 * applied regardless of what the user does with the window.
 *
 * Only one review can be outstanding at a time. A second proposal supersedes the
 * first, which resolves as rejected so its caller is never left hanging.
 */
import * as vscode from 'vscode';
import { setProposedDiffHandler } from '../../commands/forgeCommands';
import type { ILogService } from '../logService';

export type DiffDecision = 'accept' | 'reject';

interface Pending {
  settle(decision: DiffDecision): void;
  rightUri: vscode.Uri;
}

let pending: Pending | undefined;

/** True while a proposal is on screen awaiting a decision. */
export function hasPendingDiff(): boolean {
  return pending !== undefined;
}

/**
 * Open a diff and resolve once the user decides.
 *
 * Resolves `'reject'` if the user closes the diff without choosing, if the
 * request is aborted, or if another proposal replaces this one -- the caller
 * always gets an answer.
 */
export async function reviewProposedDiff(
  leftUri: vscode.Uri,
  rightUri: vscode.Uri,
  title: string,
  signal: AbortSignal,
  logService: ILogService,
): Promise<DiffDecision> {
  // A new proposal supersedes any outstanding one.
  pending?.settle('reject');

  await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title, { preview: true });

  return new Promise<DiffDecision>((resolve) => {
    const disposables: vscode.Disposable[] = [];
    let settled = false;

    const settle = (decision: DiffDecision, why: string) => {
      if (settled) return;
      settled = true;
      pending = undefined;
      for (const d of disposables) {
        try { d.dispose(); } catch { /* already gone */ }
      }
      setProposedDiffHandler(undefined);
      logService.info(`[Diff] ${title} -> ${decision} (${why})`);
      resolve(decision);
    };

    pending = { settle: (d) => settle(d, 'superseded by a newer proposal'), rightUri };

    // Title-bar buttons, surfaced by the forge.viewingProposedDiff context key.
    setProposedDiffHandler({
      accept: () => settle('accept', 'accepted'),
      reject: () => settle('reject', 'rejected'),
    });

    // Closing the diff without choosing means "no".
    disposables.push(
      vscode.window.tabGroups.onDidChangeTabs((e) => {
        for (const tab of e.closed) {
          const input = tab.input;
          if (
            input instanceof vscode.TabInputTextDiff &&
            input.modified.toString() === rightUri.toString()
          ) {
            settle('reject', 'diff closed without a decision');
          }
        }
      }),
    );

    if (signal.aborted) {
      settle('reject', 'request already aborted');
      return;
    }
    const onAbort = () => settle('reject', 'request aborted');
    signal.addEventListener('abort', onAbort, { once: true });
    disposables.push({ dispose: () => signal.removeEventListener('abort', onAbort) });
  });
}

/** Close the diff editor for a finished review, if it is still open. */
export async function closeDiffEditor(rightUri: vscode.Uri): Promise<void> {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (
        input instanceof vscode.TabInputTextDiff &&
        input.modified.toString() === rightUri.toString()
      ) {
        try { await vscode.window.tabGroups.close(tab, false); } catch { /* user may have closed it */ }
      }
    }
  }
}
