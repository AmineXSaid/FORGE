/**
 * Forge Desktop's shell (src/webview/src/desktop): the Changes pane's rows
 * and the title bar's totals.
 */
import { describe, expect, it } from 'vitest';
import { changeTotals, fileDiffRows, type ChangedFile } from '../src/webview/src/desktop/desktopHost';

describe('fileDiffRows', () => {
  it('shows a new file as its lines added, with no phantom removed line', () => {
    expect(fileDiffRows('', 'a\nb\n')).toEqual([
      { kind: 'added', modified: 'a' },
      { kind: 'added', modified: 'b' },
    ]);
  });

  it('shows a deleted file as its lines removed', () => {
    expect(fileDiffRows('x\n', '')).toEqual([{ kind: 'removed', original: 'x' }]);
  });

  it('aligns an edit and ignores the final newline', () => {
    const rows = fileDiffRows('one\ntwo\nthree\n', 'one\nTWO\nthree\n');
    expect(rows.map((r) => r.kind)).toEqual(['equal', 'removed', 'added', 'equal']);
  });

  it('treats CRLF files like LF files', () => {
    expect(fileDiffRows('a\r\nb\r\n', 'a\r\nb\r\n').every((r) => r.kind === 'equal')).toBe(true);
  });

  it('shows an empty file both sides as nothing', () => {
    expect(fileDiffRows('', '')).toEqual([]);
  });
});

describe('changeTotals', () => {
  const file = (additions: number, deletions: number): ChangedFile => ({
    path: 'f', originalPath: null, status: 'modified', additions, deletions, binary: false,
  });
  it('adds up every file', () => {
    expect(changeTotals([file(3, 1), file(2, 0)])).toEqual({ additions: 5, deletions: 1 });
    expect(changeTotals([])).toEqual({ additions: 0, deletions: 0 });
  });
});
