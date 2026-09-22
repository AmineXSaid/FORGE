/**
 * The file the user is looking at reaches the model.
 *
 * Reported from a real install with `generate_files.ps1` open at Ln 27:
 * "what file am I seeing rn?" → "I don't have visibility into what file you're
 * currently viewing in your editor or terminal."
 *
 * Three producer-side defects, all of them a missing half of something the
 * official already does (`Ri` in `extension.js`, `dR1` and `xd0` in
 * `index.js`):
 *
 * 1. `handleGetCurrentSelection` returned `null` whenever
 *    `editor.selection.isEmpty` -- so a cursor with nothing highlighted meant
 *    "no editor". The official returns the file, with no `selectedText`.
 * 2. `buildUserMessage` had the `<ide_selection>` arm and not the
 *    `<ide_opened_file>` arm, so even a non-null empty selection would have
 *    produced no text.
 * 3. Nothing ever sent `selection_changed`. The webview has always listened
 *    for it, so the selection was frozen at whatever it was when the panel
 *    loaded, and files opened afterwards were invisible.
 *
 * The scheme rule flipped too: `scheme !== "file"` was an allowlist that threw
 * away untitled buffers; the official uses a denylist of editors that are not
 * the user's document (diffs, output, comments).
 */
import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { handleGetCurrentSelection, selectionFromEditor } from '../src/services/claude/handlers/handlers';
import { ideContextBlock } from '../src/webview/src/core/ideContext';

/** A `vscode.TextEditor` as far as `selectionFromEditor` is concerned. */
function editor(opts: {
  fileName?: string;
  scheme?: string;
  start?: [number, number];
  end?: [number, number];
  text?: string;
}) {
  const start = opts.start ?? [26, 16];
  const end = opts.end ?? start;
  const isEmpty = start[0] === end[0] && start[1] === end[1];
  const fileName = opts.fileName ?? 'c:\\Users\\med-a\\Desktop\\Scrapy\\generate_files.ps1';

  return {
    document: {
      fileName,
      uri: {
        scheme: opts.scheme ?? 'file',
        toString: () => `${opts.scheme ?? 'file'}:///${fileName.replace(/\\/g, '/')}`,
      },
      getText: () => opts.text ?? '',
    },
    selection: {
      isEmpty,
      start: { line: start[0], character: start[1] },
      end: { line: end[0], character: end[1] },
    },
  } as unknown as vscode.TextEditor;
}

describe('selectionFromEditor — the official `Ri`', () => {
  it('reports the open file when nothing is highlighted', () => {
    // The defect, exactly: this used to be `null`.
    const result = selectionFromEditor(editor({}));

    expect(result).not.toBeNull();
    expect(result!.filePath).toContain('generate_files.ps1');
    expect(result!.startLine).toBe(27);
    expect(result!.endLine).toBe(27);
    expect(result!.selectedText).toBeUndefined();
  });

  it('omits selectedText rather than sending an empty string', () => {
    // `''` is falsy so it would pick the right arm today, but the official
    // omits the key and the message builder's branch reads more honestly for
    // it. Keep the shapes identical.
    expect(selectionFromEditor(editor({}))).not.toHaveProperty('selectedText');
  });

  it('reports the highlighted range when there is one', () => {
    const result = selectionFromEditor(
      editor({ start: [21, 0], end: [32, 4], text: '$jsonOk = $true' }),
    );

    expect(result!.startLine).toBe(22);
    expect(result!.endLine).toBe(33);
    expect(result!.startColumn).toBe(0);
    expect(result!.endColumn).toBe(4);
    expect(result!.selectedText).toBe('$jsonOk = $true');
  });

  it('carries sourceUri, as the official does', () => {
    expect(selectionFromEditor(editor({}))!.sourceUri).toMatch(/^file:/);
  });

  it('ignores editors that are not the user’s document', () => {
    // The official `fI4`/`MV` denylist: a diff pane Forge opened is not "the
    // file you are looking at".
    for (const scheme of ['output', 'comment', 'forge-diff', 'forge-diff-left']) {
      expect(selectionFromEditor(editor({ scheme })), scheme).toBeNull();
    }
  });

  it('keeps an untitled buffer, which the old allowlist threw away', () => {
    // `scheme !== 'file'` rejected this; it is a real document the user is
    // working in.
    expect(selectionFromEditor(editor({ scheme: 'untitled' }))).not.toBeNull();
  });
});

describe('handleGetCurrentSelection', () => {
  it('answers null when there is no active editor at all', async () => {
    vi.spyOn(vscode.window, 'activeTextEditor', 'get').mockReturnValue(undefined);

    const response = await handleGetCurrentSelection({} as any);

    expect(response.type).toBe('get_current_selection_response');
    expect(response.selection).toBeNull();
  });

  it('answers with the file when one is open but nothing is selected', async () => {
    vi.spyOn(vscode.window, 'activeTextEditor', 'get').mockReturnValue(editor({}));

    const response = await handleGetCurrentSelection({} as any);

    expect(response.selection).not.toBeNull();
    expect(response.selection!.selectedText).toBeUndefined();
  });
});

describe('ideContextBlock — the official `dR1`', () => {
  it('sends <ide_opened_file> for a cursor with nothing highlighted', () => {
    const block = ideContextBlock({
      filePath: 'generate_files.ps1',
      startLine: 27,
      endLine: 27,
    });

    // Word for word from the official bundle; the transcript parser and the
    // model both key off this phrasing.
    expect(block!.text).toBe(
      '<ide_opened_file>The user opened the file generate_files.ps1 in the IDE. ' +
        'This may or may not be related to the current task.</ide_opened_file>',
    );
  });

  it('sends <ide_selection> when there is highlighted text', () => {
    const block = ideContextBlock({
      filePath: 'a.ts',
      startLine: 1,
      endLine: 2,
      selectedText: 'const x = 1;',
    });

    expect(block!.text).toContain('<ide_selection>The user selected the lines 1 to 2 from a.ts:');
    expect(block!.text).toContain('const x = 1;');
    expect(block!.text).toContain('</ide_selection>');
  });

  it('sends nothing when there is no editor', () => {
    expect(ideContextBlock(undefined)).toBeUndefined();
  });
});
