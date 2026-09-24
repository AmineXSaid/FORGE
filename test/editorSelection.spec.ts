/**
 * The open file and the selected lines reach the chat, and stay there.
 *
 * The user asked: "make sure the extension sees my opened files and selected
 * lines". The producer (`Ri`) and the message block (`dR1`) were already the
 * official ones (ideContext.spec.ts); what lost the selection was the tracking
 * around them, which the official `xd0` does differently in four places:
 *
 * - focus moving to something that is not a text editor (the chat opened as an
 *   editor tab, a terminal) **keeps** the selection while a text editor is
 *   still visible. Forge cleared it, so clicking into the chat to type wiped
 *   the file and the lines just selected;
 * - an ignored editor (output, comments, a diff pane) getting focus changes
 *   nothing. Forge cleared the selection;
 * - closing the tracked file clears it. Forge kept a stale one;
 * - `get_current_selection` answers with the tracked selection, not with
 *   `window.activeTextEditor`, which is `undefined` while a chat tab has focus.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  getTrackedSelection,
  resetTrackedSelection,
  trackEditorSelection,
  type EditorSelectionSource,
} from '../src/services/claude/editorSelection';
import { handleGetCurrentSelection } from '../src/services/claude/handlers/handlers';

type Listener<T> = (value: T) => void;

function emitter<T>() {
  const listeners: Listener<T>[] = [];
  const event = (listener: Listener<T>) => {
    listeners.push(listener);
    return { dispose: () => listeners.splice(listeners.indexOf(listener), 1) };
  };
  return { event, fire: (value: T) => listeners.forEach((l) => l(value)) };
}

function editor(file: string, opts: { scheme?: string; start?: [number, number]; end?: [number, number]; text?: string } = {}) {
  const start = opts.start ?? [9, 0];
  const end = opts.end ?? start;
  const scheme = opts.scheme ?? 'file';
  return {
    document: {
      fileName: file,
      isClosed: false,
      uri: { scheme, toString: () => `${scheme}:///${file}` },
      getText: () => opts.text ?? '',
    },
    selection: {
      isEmpty: start[0] === end[0] && start[1] === end[1],
      start: { line: start[0], character: start[1] },
      end: { line: end[0], character: end[1] },
    },
  } as unknown as vscode.TextEditor;
}

function harness(initial?: vscode.TextEditor) {
  const selection = emitter<vscode.TextEditorSelectionChangeEvent>();
  const active = emitter<vscode.TextEditor | undefined>();
  const closed = emitter<vscode.TextDocument>();
  const state = { active: initial, visible: initial ? [initial] : [] as vscode.TextEditor[] };
  const source: EditorSelectionSource = {
    get activeTextEditor() { return state.active; },
    get visibleTextEditors() { return state.visible; },
    onDidChangeTextEditorSelection: selection.event as any,
    onDidChangeActiveTextEditor: active.event as any,
    onDidCloseTextDocument: closed.event as any,
  };
  const fired: unknown[] = [];
  const disposables = trackEditorSelection(source, (s) => fired.push(s));

  return {
    fired,
    disposables,
    /** The user focuses `e` (or nothing, with `visible` editors still on screen). */
    focus(e: vscode.TextEditor | undefined, visible: vscode.TextEditor[] = e ? [e] : []) {
      state.active = e;
      state.visible = visible;
      active.fire(e);
    },
    select(e: vscode.TextEditor) {
      selection.fire({ textEditor: e, selections: [e.selection] } as any);
    },
    close(e: vscode.TextEditor) {
      (e.document as any).isClosed = true;
      closed.fire(e.document);
    },
  };
}

beforeEach(() => resetTrackedSelection());
afterEach(() => vi.restoreAllMocks());

describe('the official xd0', () => {
  it('keeps the file and lines when focus moves into the chat tab', () => {
    const file = editor('src/app.ts', { start: [4, 0], end: [9, 2], text: 'const a = 1;' });
    const h = harness();
    h.focus(file);
    h.select(file);
    const before = h.fired.length;

    // The chat opened as an editor tab takes focus: no text editor is
    // active, but the file is still on screen beside it.
    h.focus(undefined, [file]);

    expect(h.fired.length).toBe(before);
    expect(getTrackedSelection()).toMatchObject({
      filePath: 'src/app.ts',
      startLine: 5,
      endLine: 10,
      selectedText: 'const a = 1;',
    });
  });

  it('clears when no text editor is left on screen', () => {
    const file = editor('src/app.ts');
    const h = harness();
    h.focus(file);
    h.focus(undefined, []);

    expect(h.fired.at(-1)).toBeNull();
    expect(getTrackedSelection()).toBeUndefined();
  });

  it('ignores an output channel or a diff pane taking focus', () => {
    const file = editor('src/app.ts');
    const h = harness();
    h.focus(file);
    const before = h.fired.length;

    h.focus(editor('Forge', { scheme: 'output' }));
    h.focus(editor('proposed.ts', { scheme: 'forge-diff-right' }));

    expect(h.fired.length).toBe(before);
    expect(getTrackedSelection()?.filePath).toBe('src/app.ts');
  });

  it('follows the file the user switches to, and the lines they select in it', () => {
    const a = editor('a.ts');
    const b = editor('b.ts', { start: [0, 0], end: [2, 5], text: 'x' });
    const h = harness();
    h.focus(a);
    h.focus(b);
    h.select(b);

    expect(h.fired.at(-1)).toMatchObject({ filePath: 'b.ts', startLine: 1, endLine: 3, selectedText: 'x' });
  });

  it('ignores selection events from an editor that is not the focused one', () => {
    const a = editor('a.ts');
    const background = editor('background.ts', { start: [1, 0], end: [3, 0], text: 'y' });
    const h = harness();
    h.focus(a);
    const before = h.fired.length;
    h.select(background);

    expect(h.fired.length).toBe(before);
    expect(getTrackedSelection()?.filePath).toBe('a.ts');
  });

  it('clears when the tracked file is closed, and only then', () => {
    const a = editor('a.ts');
    const other = editor('other.ts');
    const h = harness();
    h.focus(a);

    h.close(other);
    expect(getTrackedSelection()?.filePath).toBe('a.ts');

    h.close(a);
    expect(h.fired.at(-1)).toBeNull();
    expect(getTrackedSelection()).toBeUndefined();
  });

  it('starts from the file already open when tracking begins', () => {
    // The official waits for the first event; a file open before activation
    // would be unknown until clicked. Seeded, without a push.
    const h = harness(editor('already-open.ts'));
    expect(h.fired).toEqual([]);
    expect(getTrackedSelection()?.filePath).toBe('already-open.ts');
  });

  it('stops listening once disposed', () => {
    const a = editor('a.ts');
    const h = harness();
    h.disposables.forEach((d) => d.dispose());
    h.focus(a);
    expect(h.fired).toEqual([]);
  });
});

describe('get_current_selection answers from the tracker', () => {
  it('still names the file while the chat tab has focus', async () => {
    const file = editor('src/app.ts');
    const h = harness();
    h.focus(file);
    h.focus(undefined, [file]);
    vi.spyOn(vscode.window, 'activeTextEditor', 'get').mockReturnValue(undefined);

    const response = await handleGetCurrentSelection({} as any);
    expect(response.selection?.filePath).toBe('src/app.ts');
  });
});
