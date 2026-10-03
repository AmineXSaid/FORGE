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
 * were applied: a refused or failed one never opens anything. Where the change
 * sits comes from the tool's own result (`structuredPatch`, typed as
 * `FileEditOutput` / `FileWriteOutput` in the SDK's `sdk-tools.d.ts`), not
 * from searching the file for the new text, which found the wrong line
 * whenever that text already appeared higher up and nothing for a deletion.
 *
 * Filmed in code-server (e2e scenario 29), the first version also opened the
 * edited file over the editor the user was typing in, and the keystrokes that
 * followed went nowhere. It now opens beside an editor in use.
 */
import * as path from 'path';
import * as vscode from 'vscode';

/** The tools whose success means a file on disk changed. */
export const FOLLOWED_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] as const;

/**
 * How long the changed lines stay highlighted. Doubled on 2026-10-03 ("hard
 * time tracking changed rows in dark mode"): four seconds was gone before the
 * eye had found the tab the edit opened in.
 */
export const HIGHLIGHT_MS = 8000;

/** How long the gutter bar stays after the highlight goes: a stepped fade. */
export const TRAIL_MS = 6000;

/**
 * Forge's own theme colours for followed edits (`contributes.colors`).
 *
 * The highlight used the diff editor's `diffEditor.insertedLineBackground`,
 * which dark themes keep faint on purpose -- a diff is mostly green -- so a
 * single changed line in an ordinary editor barely showed (reported
 * 2026-10-03). These default to a stronger tint, a solid bar and a red rule,
 * and a user can retune them in `workbench.colorCustomizations`.
 */
export const EDIT_COLORS = {
    addedBackground: 'forge.followEdits.addedBackground',
    addedBorder: 'forge.followEdits.addedBorder',
    removedBorder: 'forge.followEdits.removedBorder',
} as const;

/** An editor the user clicked or typed in this recently is theirs: never cover it. */
export const USER_BUSY_MS = 10_000;

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

/** Where an applied edit sits in the file's new text, all 0-based. */
export interface PatchLines {
    /** Lines added or rewritten. */
    changed: LineRange[];
    /** Lines text was removed before (the line count: removed at the end). */
    deleted: number[];
    /** A line whose new text is known, to tell when an open document has reloaded. */
    probe?: { line: number; text: string };
}

interface Hunk {
    newStart?: unknown;
    lines?: unknown;
}

/**
 * The lines an Edit or Write changed, from its result's `structuredPatch`.
 *
 * Each hunk counts from `newStart` (1-based): a context line (' ') or an added
 * one ('+') is a line of the new file, a removed one ('-') is not. A run of
 * removals with no addition after it is a deletion point. A Write that created
 * the file has no patch: all of it is new. `undefined` when the result carries
 * no patch (MultiEdit, NotebookEdit, an older CLI): the caller falls back to
 * `changedLines`.
 */
export function patchLines(toolName: string, response: unknown): PatchLines | undefined {
    const result = (response ?? {}) as { type?: unknown; content?: unknown; structuredPatch?: unknown };
    if (toolName === 'Write' && result.type === 'create' && typeof result.content === 'string') {
        const count = result.content.replace(/\r?\n$/, '').split(/\r?\n/).length;
        const firstLine = result.content.split(/\r?\n/)[0] ?? '';
        return result.content
            ? { changed: [{ start: 0, end: count - 1 }], deleted: [], probe: { line: 0, text: firstLine } }
            : { changed: [], deleted: [] };
    }
    if (!Array.isArray(result.structuredPatch)) return undefined;
    const changed: LineRange[] = [];
    const deleted: number[] = [];
    let probe: PatchLines['probe'];
    for (const hunk of result.structuredPatch as Hunk[]) {
        if (typeof hunk?.newStart !== 'number' || !Array.isArray(hunk.lines)) return undefined;
        let line = Math.max(0, hunk.newStart - 1);
        let removing = false;
        for (const raw of hunk.lines) {
            if (typeof raw !== 'string') continue;
            const mark = raw[0];
            const text = raw.slice(1);
            if (mark === '-') {
                removing = true;
                continue;
            }
            if (mark === '+') {
                const last = changed.at(-1);
                if (last && last.end === line - 1) last.end = line;
                else changed.push({ start: line, end: line });
                probe ??= { line, text };
            } else if (mark === ' ') {
                if (removing) {
                    deleted.push(line);
                    probe ??= { line, text };
                }
            } else {
                continue; // "\ No newline at end of file"
            }
            removing = false;
            line++;
        }
        if (removing) deleted.push(line);
    }
    return { changed, deleted, probe };
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
 * The column to open an edited file in, never over the chat, and never over
 * the editor the user is working in (`busyColumn`).
 *
 * The group of the text editor in use, if it is not the chat's or the user's;
 * else any other group showing text; else, when the user is busy, any other
 * group that is not the chat's, or a new column after the last; else the
 * column beside a Forge tab; else the first.
 */
export function followColumn(
    groups: readonly GroupView[],
    activeTextColumn: number | undefined,
    busyColumn?: number,
): number {
    const usable = groups.filter((g) => !g.showsForge && g.viewColumn !== busyColumn);
    if (activeTextColumn !== undefined && usable.some((g) => g.viewColumn === activeTextColumn)) return activeTextColumn;
    const withText = usable.find((g) => g.showsText);
    if (withText) return withText.viewColumn;
    if (busyColumn !== undefined) return usable[0]?.viewColumn ?? Math.max(busyColumn, ...groups.map((g) => g.viewColumn)) + 1;
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

/** The decorations a followed edit uses, all in theme colours. */
interface Marks {
    /** The changed lines: the diff editor's inserted-line colour and a gutter bar. */
    added: vscode.TextEditorDecorationType;
    /** What stays once the highlight goes: the bar alone. */
    trail: vscode.TextEditorDecorationType;
    /** A line text was removed before: a rule above it. */
    removed: vscode.TextEditorDecorationType;
    /** Text removed at the end of the file: a rule under the last line. */
    removedAtEnd: vscode.TextEditorDecorationType;
}

function createMarks(): Marks {
    const bar = {
        isWholeLine: true,
        borderStyle: 'solid',
        borderWidth: '0 0 0 4px',
        borderColor: new vscode.ThemeColor(EDIT_COLORS.addedBorder),
    };
    const rule = (width: string) => vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        borderStyle: 'solid',
        borderWidth: width,
        borderColor: new vscode.ThemeColor(EDIT_COLORS.removedBorder),
        overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.deletedForeground'),
        overviewRulerLane: vscode.OverviewRulerLane.Left,
    });
    return {
        added: vscode.window.createTextEditorDecorationType({
            ...bar,
            backgroundColor: new vscode.ThemeColor(EDIT_COLORS.addedBackground),
            overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.addedForeground'),
            overviewRulerLane: vscode.OverviewRulerLane.Left,
        }),
        trail: vscode.window.createTextEditorDecorationType(bar),
        removed: rule('3px 0 0 0'),
        removedAtEnd: rule('0 0 3px 0'),
    };
}

/**
 * Opens and highlights each applied edit, one at a time, in the order the
 * edits happened.
 */
export class EditFollower {
    private queue: Promise<void> = Promise.resolve();
    private marks: Marks | undefined;
    /** Each editor's pending fade steps, so a newer edit keeps its own. */
    private readonly fades = new Map<vscode.TextEditor, ReturnType<typeof setTimeout>[]>();
    /** The last time the user clicked or typed in a text editor, and where. */
    private lastUser: { at: number; column: number | undefined; file: string } | undefined;
    private watchers: vscode.Disposable[] = [];

    constructor(
        private readonly enabled: () => boolean = () =>
            vscode.workspace.getConfiguration('forge').get<boolean>('followEdits', true) !== false,
        private log: (line: string) => void = () => {},
        private readonly now: () => number = () => Date.now(),
    ) {}

    /** Where a file that could not be shown is reported (Forge's output channel). */
    setLog(log: (line: string) => void): void {
        this.log = log;
    }

    /**
     * Notice the user working in an editor: a click or a keystroke that moves
     * the cursor, or typing. A followed file never opens over that editor.
     */
    watchUser(): void {
        if (this.watchers.length) return;
        const note = (editor: vscode.TextEditor | undefined) => {
            if (editor) this.lastUser = { at: this.now(), column: editor.viewColumn, file: editor.document.uri.fsPath };
        };
        this.watchers.push(
            vscode.window.onDidChangeTextEditorSelection((e) => {
                if (e.kind === vscode.TextEditorSelectionChangeKind.Keyboard || e.kind === vscode.TextEditorSelectionChangeKind.Mouse) {
                    note(e.textEditor);
                }
            }),
            vscode.workspace.onDidChangeTextDocument((e) => {
                const editor = vscode.window.activeTextEditor;
                if (e.contentChanges.length && editor && editor.document === e.document) note(editor);
            }),
        );
    }

    /** Follow one applied edit. Never throws: this is a view, not the edit. */
    follow(toolName: string, input: unknown, cwd: string | undefined, response?: unknown): Promise<void> {
        const file = editedFile(toolName, input);
        if (!file || !this.enabled()) return this.queue;
        // Held for the machine owner to review: nothing changed on disk.
        if ((response as { staged?: unknown } | undefined)?.staged === true) return this.queue;
        this.queue = this.queue.then(() => this.show(toolName, input, file, cwd, response)).catch((error) => {
            this.log(`[FollowEdits] could not show ${file}: ${error instanceof Error ? error.message : String(error)}`);
        });
        return this.queue;
    }

    private async show(toolName: string, input: unknown, file: string, cwd: string | undefined, response: unknown): Promise<void> {
        const uri = vscode.Uri.file(path.isAbsolute(file) || !cwd ? file : path.join(cwd, file));
        if (toolName === 'NotebookEdit') {
            await vscode.commands.executeCommand('vscode.open', uri, { preserveFocus: true, preview: false });
            return;
        }
        const shown = vscode.window.visibleTextEditors.find((e) => samePath(e.document.uri.fsPath, uri.fsPath));
        // Not a preview: each file a turn edits stays open as its own tab.
        const editor = shown
            ? await vscode.window.showTextDocument(shown.document, { viewColumn: shown.viewColumn, preserveFocus: true })
            : await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), {
                viewColumn: this.column(uri.fsPath),
                preserveFocus: true,
                preview: false,
            });

        const patch = patchLines(toolName, response);
        // An open document reloads from disk a moment after the CLI writes
        // it; wait for it briefly, so the marks land on the new text.
        const ready = () => {
            const text = editor.document.getText();
            if (patch) return !patch.probe || text.split(/\r?\n/)[patch.probe.line] === patch.probe.text;
            return changedLines(toolName, input, text).length > 0;
        };
        for (let attempt = 0; !ready() && (patch || toolName !== 'Write') && attempt < 4; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
        const changed = patch?.changed ?? changedLines(toolName, input, editor.document.getText());
        const deleted = patch?.deleted ?? [];
        if (!changed.length && !deleted.length) {
            if (toolName === 'Write') editor.revealRange(new vscode.Range(0, 0, 0, 0), vscode.TextEditorRevealType.AtTop);
            return;
        }

        const lineCount = editor.document.getText().split(/\r?\n/).length;
        const ranges = changed.map((r) => new vscode.Range(r.start, 0, r.end, Number.MAX_SAFE_INTEGER));
        const above = deleted.filter((l) => l < lineCount).map((l) => new vscode.Range(l, 0, l, 0));
        const atEnd = deleted.some((l) => l >= lineCount)
            ? [new vscode.Range(lineCount - 1, 0, lineCount - 1, 0)]
            : [];
        const first = Math.min(...changed.map((r) => r.start), ...deleted.map((l) => Math.min(l, lineCount - 1)));
        editor.revealRange(
            new vscode.Range(first, 0, first, 0),
            toolName === 'Write' && patch?.changed[0]?.start === 0 && first === 0
                ? vscode.TextEditorRevealType.AtTop
                : vscode.TextEditorRevealType.InCenterIfOutsideViewport,
        );

        const marks = (this.marks ??= createMarks());
        for (const step of this.fades.get(editor) ?? []) clearTimeout(step);
        editor.setDecorations(marks.trail, []);
        editor.setDecorations(marks.added, ranges);
        editor.setDecorations(marks.removed, above);
        editor.setDecorations(marks.removedAtEnd, atEnd);
        this.fades.set(editor, [
            // The highlight goes, the gutter bar stays a moment longer...
            setTimeout(() => {
                editor.setDecorations(marks.added, []);
                editor.setDecorations(marks.trail, ranges);
            }, HIGHLIGHT_MS),
            // ...then everything goes.
            setTimeout(() => {
                this.fades.delete(editor);
                editor.setDecorations(marks.trail, []);
                editor.setDecorations(marks.removed, []);
                editor.setDecorations(marks.removedAtEnd, []);
            }, HIGHLIGHT_MS + TRAIL_MS),
        ]);
    }

    private column(file: string): number {
        const groups: GroupView[] = vscode.window.tabGroups.all.map((g) => ({
            viewColumn: g.viewColumn,
            showsForge: isForgeTab(g.activeTab?.input),
            showsText: g.activeTab?.input instanceof vscode.TabInputText,
        }));
        // Busy: the user clicked or typed there lately, and it is still on screen.
        const user = this.lastUser;
        const busy = user
            && this.now() - user.at < USER_BUSY_MS
            && !samePath(user.file, file)
            && vscode.window.visibleTextEditors.some((e) => e.viewColumn === user.column && samePath(e.document.uri.fsPath, user.file))
            ? user.column
            : undefined;
        return followColumn(groups, vscode.window.activeTextEditor?.viewColumn, busy);
    }

    dispose(): void {
        for (const steps of this.fades.values()) for (const step of steps) clearTimeout(step);
        this.fades.clear();
        for (const mark of Object.values(this.marks ?? {})) mark.dispose();
        this.marks = undefined;
        for (const watcher of this.watchers.splice(0)) watcher.dispose();
    }
}

/** The follower the extension host uses. */
export const editFollower = new EditFollower();
