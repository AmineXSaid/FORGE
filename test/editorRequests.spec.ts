/**
 * `open_content` and `open_diff`, the happy paths (production audit, Phase 2;
 * the refusals are webviewPaths.spec.ts).
 *
 * - `open_content` read-only: an untitled document with the content, in
 *   preview. Editable: a temp file, answered with its text when it is saved or
 *   closed, or with what it holds when the webview cancels.
 * - `open_diff`: the proposed edits applied to the file on disk, shown against
 *   it; Accept returns the edits for the CLI to apply, Reject returns none.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

const review = vi.hoisted(() => ({ decision: 'accept' as 'accept' | 'reject', calls: [] as any[] }));
vi.mock('../src/services/diff/proposedDiff', () => ({
  reviewProposedDiff: vi.fn(async (...args: any[]) => { review.calls.push(args); return review.decision; }),
  closeDiffEditor: vi.fn(async () => {}),
}));

import { handleOpenContent, handleOpenDiff } from '../src/services/claude/handlers/handlers';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-editor-'));
  review.calls = [];
  review.decision = 'accept';
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const log = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('open_content', () => {
  it('read-only: an untitled document in preview, in the language its name implies', async () => {
    const open = vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue({ uri: 'untitled' } as any);
    const show = vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue({} as any);
    const response = await handleOpenContent(
      { type: 'open_content', content: 'match 1\nmatch 2', fileName: 'Grep output', editable: false },
      { logService: log(), fileSystemService: {} } as any,
      new AbortController().signal,
    );
    expect(response).toEqual({ type: 'open_content_response' });
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ content: 'match 1\nmatch 2' }));
    expect(show).toHaveBeenCalledWith({ uri: 'untitled' }, { preview: true });
  });

  it('editable: a temp file, answered with its text when saved', async () => {
    const file = path.join(dir, 'plan.md');
    fs.writeFileSync(file, 'draft');
    const uri = vscode.Uri.file(file);
    const doc = { uri, getText: () => 'draft' };
    vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue(doc as any);
    vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue({} as any);
    let onSave: ((d: any) => void) | undefined;
    vi.spyOn(vscode.workspace, 'onDidSaveTextDocument').mockImplementation(((listener: any) => { onSave = listener; return { dispose() {} }; }) as any);
    const createTempFile = vi.fn(async () => file);

    const answer = handleOpenContent(
      { type: 'open_content', content: 'draft', fileName: 'plan.md', editable: true },
      { logService: log(), fileSystemService: { createTempFile } } as any,
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(onSave).toBeDefined());
    onSave!({ uri, getText: () => 'edited plan' });

    expect(await answer).toEqual({ type: 'open_content_response', updatedContent: 'edited plan' });
    expect(createTempFile).toHaveBeenCalledWith('plan.md', 'draft');
  });

  it('editable: a cancel from the webview answers what the document holds', async () => {
    const uri = vscode.Uri.file(path.join(dir, 'x.txt'));
    vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue({ uri, getText: () => 'as opened' } as any);
    vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue({} as any);
    const controller = new AbortController();
    const answer = handleOpenContent(
      { type: 'open_content', content: 'as opened', fileName: 'x.txt', editable: true },
      { logService: log(), fileSystemService: { createTempFile: async () => uri.fsPath } } as any,
      controller.signal,
    );
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    expect(await answer).toEqual({ type: 'open_content_response', updatedContent: 'as opened' });
  });
});

describe('open_diff', () => {
  function context(temps: Array<{ name: string; content: string }>) {
    return {
      logService: log(),
      workspaceService: { getDefaultWorkspaceFolder: () => ({ uri: { fsPath: dir } }) },
      fileSystemService: {
        resolveFilePath: (p: string, cwd: string) => (path.isAbsolute(p) ? p : path.join(cwd, p)),
        pathExists: async (p: string) => fs.existsSync(p),
        createTempFile: async (name: string, content: string) => {
          temps.push({ name, content });
          const file = path.join(dir, `tmp-${temps.length}-${name}`);
          fs.writeFileSync(file, content);
          return file;
        },
      },
    } as any;
  }
  const edits = [{ oldString: 'const a = 1;', newString: 'const a = 2;' }];

  it('shows the edits applied to the file on disk, and Accept returns them', async () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'const a = 1;\nexport { a };\n');
    const temps: any[] = [];
    const response = await handleOpenDiff(
      { type: 'open_diff', originalFilePath: 'a.ts', newFilePath: '', edits, supportMultiEdits: false },
      context(temps),
      new AbortController().signal,
    );
    expect(response).toEqual({ type: 'open_diff_response', newEdits: edits });
    expect(temps).toEqual([{ name: 'a.ts.claude', content: 'const a = 2;\nexport { a };\n' }]);
    // The left side is the real file; the title names it.
    const [left, , title] = review.calls[0];
    expect(left.fsPath).toBe(path.join(dir, 'a.ts'));
    expect(title).toBe('a.ts (Forge)');
  });

  it('Reject returns no edits, so the CLI applies nothing', async () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'const a = 1;\n');
    review.decision = 'reject';
    const response = await handleOpenDiff(
      { type: 'open_diff', originalFilePath: 'a.ts', newFilePath: '', edits, supportMultiEdits: false },
      context([]),
      new AbortController().signal,
    );
    expect(response).toEqual({ type: 'open_diff_response', newEdits: [] });
  });

  it('a new file: an empty left side, the content on the right', async () => {
    const temps: any[] = [];
    await handleOpenDiff(
      { type: 'open_diff', originalFilePath: '', newFilePath: 'new.ts', edits: [{ oldString: '', newString: 'export {};\n' }], supportMultiEdits: false },
      context(temps),
      new AbortController().signal,
    );
    expect(temps).toEqual([
      { name: 'new.ts.claude', content: 'export {};\n' },
      { name: 'new.ts', content: '' },
    ]);
  });

  it('an already-cancelled request answers the edits unreviewed and opens nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    const temps: any[] = [];
    expect(
      await handleOpenDiff({ type: 'open_diff', originalFilePath: 'a.ts', newFilePath: '', edits, supportMultiEdits: false }, context(temps), controller.signal),
    ).toEqual({ type: 'open_diff_response', newEdits: edits });
    expect(temps).toEqual([]);
    expect(review.calls).toEqual([]);
  });
});
