/**
 * Forge Desktop's shell (src/webview/src/desktop): the Changes pane's rows
 * and the title bar's totals.
 */
import { describe, expect, it } from 'vitest';
import { changeTotals, fileDiffRows, numberRows, reviewMessage, type ChangedFile, type ReviewComment } from '../src/webview/src/desktop/desktopHost';

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

describe('numberRows', () => {
  it('numbers both sides: removed lines by HEAD, added by the working tree', () => {
    const rows = numberRows(fileDiffRows('a\nb\nc\n', 'a\nB\nc\nd\n'));
    expect(rows).toEqual([
      { kind: 'equal', text: 'a', before: 1, after: 1 },
      { kind: 'removed', text: 'b', before: 2 },
      { kind: 'added', text: 'B', after: 2 },
      { kind: 'equal', text: 'c', before: 3, after: 3 },
      { kind: 'added', text: 'd', after: 4 },
    ]);
  });
});

describe('reviewMessage', () => {
  const c = (path: string, line: number, body: string, side: 'before' | 'after' = 'after', code = 'x'): ReviewComment => ({
    id: `${path}${line}`, path, line, side, code, body,
  });

  it('groups by file, orders by line, and quotes the code', () => {
    const text = reviewMessage([c('b.ts', 9, 'rename this'), c('a.ts', 3, 'handle null', 'after', 'return x.y;'), c('b.ts', 2, 'why removed?', 'before')]);
    expect(text).toBe([
      'Review comments on the working tree. Address each one:',
      '',
      'b.ts',
      '- removed line 2 (`x`): why removed?',
      '- line 9 (`x`): rename this',
      '',
      'a.ts',
      '- line 3 (`return x.y;`): handle null',
    ].join('\n'));
  });

  it('skips empty comments, and sends nothing when none are left', () => {
    expect(reviewMessage([c('a.ts', 1, '   ')])).toBe('');
    expect(reviewMessage([])).toBe('');
  });

  it('shortens a long line of code', () => {
    const text = reviewMessage([c('a.ts', 1, 'too long', 'after', 'y'.repeat(200))]);
    expect(text).toContain(`${'y'.repeat(77)}...`);
  });
});
