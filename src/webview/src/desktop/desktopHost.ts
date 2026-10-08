/**
 * The desktop app's own calls, for the `desktop` page (DesktopShell.vue).
 *
 * Forge Desktop (AmineXSaid/forge-desktop) puts `window.forgeDesktop` on the
 * page before it loads; in VS Code there is none and the desktop page is never
 * booted. Forge's chat, sessions and settings keep talking to the host through
 * the transport as everywhere else; only what has no VS Code equivalent goes
 * through here: the project folder, the working tree's changes, the window.
 */

import { diffLines, type DiffRow } from '../components/Messages/tools/lineDiff';

export interface RecentProject {
  path: string;
  name: string;
}

export interface DesktopInfo {
  workspace: string | null;
  name: string | null;
  recent: RecentProject[];
  platform: string;
  version: string;
}

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';

export interface ChangedFile {
  path: string;
  originalPath: string | null;
  status: ChangeStatus;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  files: ChangedFile[];
}

export interface FileDiff {
  path: string;
  status: ChangeStatus;
  original: string;
  modified: string;
  tooLargeOrBinary: boolean;
}

export type WindowAction = 'minimize' | 'toggleMaximize' | 'close' | 'isMaximized';

export interface DesktopHost {
  info(): Promise<DesktopInfo>;
  /** A recent project by path, or the folder picker when none is given. */
  openProject(path?: string): Promise<void>;
  gitStatus(): Promise<GitStatus>;
  gitDiff(path: string): Promise<FileDiff>;
  windowAction(action: WindowAction): Promise<unknown>;
}

declare global {
  interface Window {
    forgeDesktop?: DesktopHost;
  }
}

export function desktopHost(): DesktopHost | undefined {
  return window.forgeDesktop;
}

/** Totals for the header's `+N −M`. */
export function changeTotals(files: ChangedFile[]): { additions: number; deletions: number } {
  return files.reduce(
    (sum, f) => ({ additions: sum.additions + f.additions, deletions: sum.deletions + f.deletions }),
    { additions: 0, deletions: 0 }
  );
}

/**
 * The rows for a whole file's diff. Files end in a newline and may be empty
 * (new or deleted): both are lines, not a phantom blank line to add or remove.
 */
export function fileDiffRows(original: string, modified: string): DiffRow[] {
  const lines = (text: string) => (text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/));
  const before = lines(original);
  const after = lines(modified);
  if (!before.length) return after.map((line): DiffRow => ({ kind: 'added', modified: line }));
  if (!after.length) return before.map((line): DiffRow => ({ kind: 'removed', original: line }));
  return diffLines(before.join('\n'), after.join('\n'));
}
