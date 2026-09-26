/**
 * Following edits: the file Claude has just changed comes to the front, beside
 * the chat, with the changed lines scrolled into view and briefly highlighted.
 *
 * Asked for on 2026-09-25: "when the LLM or Forge is editing files I want to
 * see it in real time, values change and files open in real time". Forge-only.
 * The official extension opens a diff for an edit it asks about (Manual mode,
 * `open_diff`, which Forge ports in `diff/proposedDiff.ts`), but it applies an
 * auto-accepted edit silently: only a file already on screen shows the change.
 * Here every applied edit opens or reveals its file, in any mode, without
 * taking focus from the chat. `forge.followEdits` turns it off.
 *
 * Driven by the CLI's PostToolUse hook, so it follows exactly the edits that
 * were applied: a refused or failed one never opens anything.
 */
import * as path from 'path';
import * as vscode from 'vscode';

/** The tools whose success means a file on disk changed. */
export const FOLLOWED_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] as const;

/** How long the changed lines stay highlighted. */
export const HIGHLIGHT_MS = 2500;

/** A 0-based, inclusive line range. */
export interface LineRange {
    start: number;
    end: number;
}

/** The file a followed tool changed, from its input. */
export function editedFile(toolName: string, input: unknown): string | undefined {
    if (!(FOLLOWED_TOOLS as readonly string[]).includes(toolName)) return undefined;
    const record = (input ?? {}) as { file_path?: unknown; notebook_path?: unknown };
    const file = toolName === 'NotebookEdit' ? record.notebook_path : record.file_path;
    return typeof file === 'string' && file.trim() ? file : undefined;
}

function lineOf(text: string, offset: number): number {
    let line = 0;
    for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
    return line;
}

/**
 * Where the edit landed in the file's new text: the lines each `new_string`
 * now occupies (every occurrence for `replace_all`, else the first). Empty
 * when there is nothing to point at -- a deletion (`new_string` is ""), a
 * `Write` (the whole file is new), or text that is not in the file (yet).
 */
export function changedLines(toolName: string, input: unknown, text: string): LineRange[] {
    const record = (input ?? {}) as { new_string?: unknown; replace_all?: unknown; edits?: unknown };
    const edits: Array<{ new_string?: unknown; replace_all?: unknown }> =
        toolName === 'MultiEdit' && Array.isArray(record.edits)
            ? (record.edits as Array<{ new_string?: unknown; replace_all?: unknown }>)
            : toolName === 'Edit'
                ? [record]
                : [];
    const ranges: LineRange[] = [];
    for (const edit of edits) {
        const needle = typeof edit.new_string === 'string' ? edit.new_string : '';
        if (!needle) continue;
        let from = 0;
        for (;;) {
            const at = text.indexOf(needle, from);
            if (at < 0) break;
            ranges.push({ start: lineOf(text, at), end: lineOf(text, at + needle.length - 1) });
            if (edit.replace_all !== true) break;
            from = at + needle.length;
        }
    }
    return ranges.sort((a, b) => a.start - b.start);
}

/** An editor group, as far as choosing one needs to know. */
export interface GroupView {
    viewColumn: number;
    /** The group's active tab shows Forge (its chat or a Forge page). */
    showsForge: boolean;
    /** The group shows a text editor. */
    showsText: boolean;
}

/**
 * The column to open an edited file in, never over the chat.
 *
 * The group of the text editor in use, if it is not the chat's; else any
 * group showing text; else the column beside a Forge tab; else the first.
 */
export function followColumn(groups: readonly GroupView[], activeTextColumn: number | undefined): number {
    const usable = groups.filter((g) => !g.showsForge);
    if (activeTextColumn !== undefined && usable.some((g) => g.viewColumn === activeTextColumn)) return activeTextColumn;
    const withText = usable.find((g) => g.showsText);
    if (withText) return withText.viewColumn;
    const forge = groups.find((g) => g.showsForge);
    if (forge) return forge.viewColumn + 1;
    return usable[0]?.viewColumn ?? 1;
}

/** The same file: Windows paths differ only in case more often than not. */
function samePath(a: string, b: string): boolean {
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isForgeTab(input: unknown): boolean {
    return input instanceof vscode.TabInputWebview && /forge/i.test(input.viewType);
}

/**
 * Opens and highlights each applied edit, one at a time, in the order the
 * edits happened.
 */
export class EditFollower {
    private queue: Promise<void> = Promise.resolve();
    private decoration: vscode.TextEditorDecorationType | undefined;
    /** Each editor's pending "clear the highlight", so a newer edit keeps its own. */
    private readonly fades = new Map<vscode.TextEditor, ReturnType<typeof setTimeout>>();

    constructor(
        private readonly enabled: () => boolean = () =>
            vscode.workspace.getConfiguration('forge').get<boolean>('followEdits', true) !== false,
        private log: (line: string) => void = () => {}
    ) {}

    /** Where a file that could not be shown is reported (Forge's output channel). */
    setLog(log: (line: string) => void): void {
        this.log = log;
    }

    /** Follow one applied edit. Never throws: this is a view, not the edit. */
    follow(toolName: string, input: unknown, cwd: string | undefined): Promise<void> {
        const file = editedFile(toolName, input);
        if (!file || !this.enabled()) return this.queue;
        this.queue = this.queue.then(() => this.show(toolName, input, file, cwd)).catch((error) => {
            this.log(`[FollowEdits] could not show ${file}: ${error instanceof Error ? error.message : String(error)}`);
        });
        return this.queue;
    }

    private async show(toolName: string, input: unknown, file: string, cwd: string | undefined): Promise<void> {
        const uri = vscode.Uri.file(path.isAbsolute(file) || !cwd ? file : path.join(cwd, file));
        if (toolName === 'NotebookEdit') {
            await vscode.commands.executeCommand('vscode.open', uri, { preserveFocus: true, preview: true });
            return;
        }
        const shown = vscode.window.visibleTextEditors.find((e) => samePath(e.document.uri.fsPath, uri.fsPath));
        const editor = shown
            ? await vscode.window.showTextDocument(shown.document, { viewColumn: shown.viewColumn, preserveFocus: true })
            : await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), {
                viewColumn: this.column(),
                preserveFocus: true,
                preview: true,
            });

        // An open document reloads from disk a moment after the CLI writes
        // it; look again briefly before giving up on pointing at the change.
        let lines = changedLines(toolName, input, editor.document.getText());
        for (let attempt = 0; !lines.length && toolName !== 'Write' && attempt < 4; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            lines = changedLines(toolName, input, editor.document.getText());
        }
        if (!lines.length) {
            if (toolName === 'Write') editor.revealRange(new vscode.Range(0, 0, 0, 0), vscode.TextEditorRevealType.AtTop);
            return;
        }
        const ranges = lines.map((r) => new vscode.Range(r.start, 0, r.end, Number.MAX_SAFE_INTEGER));
        editor.revealRange(ranges[0]!, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        const decoration = (this.decoration ??= vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
            overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.addedForeground'),
            overviewRulerLane: vscode.OverviewRulerLane.Left,
        }));
        editor.setDecorations(decoration, ranges);
        clearTimeout(this.fades.get(editor));
        this.fades.set(editor, setTimeout(() => {
            this.fades.delete(editor);
            editor.setDecorations(decoration, []);
        }, HIGHLIGHT_MS));
    }

    private column(): number {
        const groups: GroupView[] = vscode.window.tabGroups.all.map((g) => ({
            viewColumn: g.viewColumn,
            showsForge: isForgeTab(g.activeTab?.input),
            showsText: g.activeTab?.input instanceof vscode.TabInputText,
        }));
        return followColumn(groups, vscode.window.activeTextEditor?.viewColumn);
    }

    dispose(): void {
        for (const fade of this.fades.values()) clearTimeout(fade);
        this.fades.clear();
        this.decoration?.dispose();
        this.decoration = undefined;
    }
}

/** The follower the extension host uses. */
export const editFollower = new EditFollower();
