import type * as vscode from 'vscode';
import type { SelectionRange } from '../../shared/messages';

/**
 * The file the user has open and the lines they selected, as the chat sees them.
 *
 * A port of the official host's `xd0` (with `Ri`, `MV`/`fI4` and `NO$`), which
 * keeps one tracked selection (`FK`, and `lF`, the uri of its document) and
 * fires it to every chat:
 *
 *   onDidChangeTextEditorSelection: not the active editor, or an ignored
 *     scheme -> nothing; no selections -> fire undefined; else FK=Ri(...), fire.
 *   onDidChangeActiveTextEditor(undefined): **retain** while any text editor is
 *     still visible (`NO$`), else clear and fire undefined. An ignored scheme
 *     -> nothing. Else FK=Ri(...), fire.
 *   onDidCloseTextDocument: the tracked document closed -> clear, fire undefined.
 *
 * and answers `get_current_selection` with `FK`, never with
 * `window.activeTextEditor`.
 *
 * Forge used to clear the selection whenever the active editor became
 * `undefined` or an ignored one, and to answer `get_current_selection` from
 * `activeTextEditor`. Both are exactly the moment the user clicks into a chat
 * opened as an editor tab: the file and the lines they had just selected were
 * wiped before they typed, and a chat opened or reloaded with focus had no file
 * at all.
 */

/**
 * The official `fI4`, ported as a **denylist** rather than the
 * `scheme !== "file"` allowlist this used to apply. The difference is not
 * cosmetic: an allowlist of `file` also throws away untitled buffers and
 * virtual documents the user is genuinely working in, while letting nothing
 * else through. What actually needs excluding is the editors that are not the
 * user's document at all -- diff panes Forge itself opened, output channels,
 * comment editors.
 */
export const IGNORED_EDITOR_SCHEMES = new Set([
    'comment',
    'output',
    // The official lists its own diff-view schemes here. Forge's equivalents go
    // beside them, so a proposed-diff pane never reads as the open file.
    'forge-diff',
    'forge-diff-left',
    'forge-diff-right',
]);

/** The official `MV(scheme)`. */
export function isIgnoredEditorScheme(scheme: string): boolean {
    return IGNORED_EDITOR_SCHEMES.has(scheme);
}

/**
 * The official host's `Ri(editor, redact)`.
 *
 * The empty-selection branch is the whole point: with only a cursor in the
 * file, the official still returns the file -- same `startLine` and `endLine`,
 * and **no `selectedText`** -- where Forge used to return `null` and tell the
 * model nothing. That is why "what file am I seeing rn?" got
 * "I don't have visibility into what file you're currently viewing".
 */
export function selectionFromEditor(editor: vscode.TextEditor): SelectionRange | null {
    const document = editor.document;
    if (isIgnoredEditorScheme(document.uri.scheme)) return null;

    const selection = editor.selection;
    // `document.fileName`, as the official does -- `uri.fsPath` is empty for a
    // document that has no file behind it yet.
    const filePath = document.fileName;
    const sourceUri = document.uri.toString();

    if (selection.isEmpty) {
        return {
            filePath,
            sourceUri,
            startLine: selection.start.line + 1,
            endLine: selection.start.line + 1
        };
    }

    return {
        filePath,
        sourceUri,
        startLine: selection.start.line + 1,
        endLine: selection.end.line + 1,
        startColumn: selection.start.character,
        endColumn: selection.end.character,
        selectedText: document.getText(selection)
    };
}

/** What `trackEditorSelection` listens to: `vscode.window` and `vscode.workspace`, as one seam. */
export interface EditorSelectionSource {
    readonly activeTextEditor: vscode.TextEditor | undefined;
    readonly visibleTextEditors: readonly vscode.TextEditor[];
    onDidChangeTextEditorSelection: vscode.Event<vscode.TextEditorSelectionChangeEvent>;
    onDidChangeActiveTextEditor: vscode.Event<vscode.TextEditor | undefined>;
    onDidCloseTextDocument: vscode.Event<vscode.TextDocument>;
}

/** The official `FK` and `lF`: one per extension host. */
let tracked: SelectionRange | undefined;
let trackedUri: string | undefined;

/** The official `()=>FK`, what `get_current_selection` answers. */
export function getTrackedSelection(): SelectionRange | undefined {
    return tracked;
}

/** Forgets the tracked selection, so a spec starts clean. */
export function resetTrackedSelection(): void {
    tracked = undefined;
    trackedUri = undefined;
}

/**
 * The official `xd0`: keep the tracked selection current and hand every
 * change to `fire` (the host sends it to the chats as `selection_changed`).
 *
 * One addition: the editor already active when tracking starts is taken as the
 * first selection, without firing. The official waits for the first event, so
 * a file open before the extension activated is unknown until the user clicks
 * in it; "make sure it sees my opened files" is exactly that case.
 */
export function trackEditorSelection(
    source: EditorSelectionSource,
    fire: (selection: SelectionRange | null) => void
): vscode.Disposable[] {
    const take = (editor: vscode.TextEditor) => {
        tracked = selectionFromEditor(editor) ?? undefined;
        trackedUri = editor.document.uri.toString();
    };

    const initial = source.activeTextEditor;
    if (initial && !isIgnoredEditorScheme(initial.document.uri.scheme) && !initial.document.isClosed) {
        take(initial);
    }

    return [
        source.onDidChangeTextEditorSelection((event) => {
            // A background diff scrolling is not the user looking somewhere else.
            if (event.textEditor !== source.activeTextEditor) return;
            if (isIgnoredEditorScheme(event.textEditor.document.uri.scheme)) return;
            if (event.textEditor.document.isClosed) return;
            if (event.selections.length === 0) {
                fire(null);
                return;
            }
            take(event.textEditor);
            fire(tracked ?? null);
        }),
        source.onDidChangeActiveTextEditor((editor) => {
            if (!editor) {
                // The official `NO$`: focus went to something that is not a
                // text editor (a chat tab, a terminal). While a text editor is
                // still on screen, what the user was looking at stands.
                if (source.visibleTextEditors.length !== 0) return;
                resetTrackedSelection();
                fire(null);
                return;
            }
            if (isIgnoredEditorScheme(editor.document.uri.scheme)) return;
            if (editor.document.isClosed) return;
            take(editor);
            fire(tracked ?? null);
        }),
        source.onDidCloseTextDocument((document) => {
            if (document.uri.toString() !== trackedUri) return;
            resetTrackedSelection();
            fire(null);
        }),
    ];
}
