/**
 * Following edits: the file Claude has just changed opens beside the chat, its
 * changed lines in view and highlighted for a moment.
 *
 * Asked for on 2026-09-25: "when the LLM or Forge is editing files I want to
 * see it in real time, values change and files open in real time". Driven by
 * the CLI's PostToolUse hook, so only an edit that was applied is shown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    changedLines,
    editedFile,
    EditFollower,
    followColumn,
    HIGHLIGHT_MS,
    patchLines,
    TRAIL_MS,
    USER_BUSY_MS,
} from '../src/services/editor/followEdits';

const ROOT = path.join(__dirname, '..');

describe('the file an edit changed', () => {
    it('is file_path for Edit, Write and MultiEdit, notebook_path for NotebookEdit', () => {
        expect(editedFile('Edit', { file_path: '/w/a.py', old_string: 'x', new_string: 'y' })).toBe('/w/a.py');
        expect(editedFile('Write', { file_path: '/w/b.py', content: '' })).toBe('/w/b.py');
        expect(editedFile('MultiEdit', { file_path: '/w/c.py', edits: [] })).toBe('/w/c.py');
        expect(editedFile('NotebookEdit', { notebook_path: '/w/d.ipynb', new_source: '' })).toBe('/w/d.ipynb');
    });

    it('is nothing for a tool that does not edit, or an input without a path', () => {
        expect(editedFile('Read', { file_path: '/w/a.py' })).toBeUndefined();
        expect(editedFile('Bash', { command: 'sed -i s/a/b/ a.py' })).toBeUndefined();
        expect(editedFile('Edit', {})).toBeUndefined();
        expect(editedFile('Edit', { file_path: '  ' })).toBeUndefined();
        expect(editedFile('Edit', { file_path: 42 })).toBeUndefined();
        expect(editedFile('NotebookEdit', { file_path: '/w/d.ipynb' })).toBeUndefined();
        expect(editedFile('Edit', null)).toBeUndefined();
    });
});

describe('the lines an edit changed, found in the new text', () => {
    const TEXT = ['import os', 'TLS = "1.2"', 'def f():', '    return TLS', 'TLS_ALT = "1.2"', ''].join('\n');

    it('are the lines the new_string now occupies', () => {
        expect(changedLines('Edit', { new_string: 'def f():\n    return TLS' }, TEXT)).toEqual([{ start: 2, end: 3 }]);
    });

    it('are the first occurrence only, unless replace_all', () => {
        expect(changedLines('Edit', { new_string: '"1.2"' }, TEXT)).toEqual([{ start: 1, end: 1 }]);
        expect(changedLines('Edit', { new_string: '"1.2"', replace_all: true }, TEXT)).toEqual([
            { start: 1, end: 1 },
            { start: 4, end: 4 },
        ]);
    });

    it('are every edit of a MultiEdit, in file order', () => {
        const input = { edits: [{ new_string: 'TLS_ALT' }, { new_string: 'import os' }] };
        expect(changedLines('MultiEdit', input, TEXT)).toEqual([
            { start: 0, end: 0 },
            { start: 4, end: 4 },
        ]);
    });

    it('end on the last character of the new text, not the line after it', () => {
        expect(changedLines('Edit', { new_string: 'import os\n' }, TEXT)).toEqual([{ start: 0, end: 0 }]);
    });

    it('are none for a deletion, a Write, or text not in the file (yet)', () => {
        expect(changedLines('Edit', { new_string: '' }, TEXT)).toEqual([]);
        expect(changedLines('Write', { content: TEXT }, TEXT)).toEqual([]);
        expect(changedLines('Edit', { new_string: 'not there' }, TEXT)).toEqual([]);
        expect(changedLines('MultiEdit', { edits: 'nonsense' }, TEXT)).toEqual([]);
    });
});

/**
 * Tool results as the real CLI (2.1.274) hands them to a PostToolUse hook,
 * captured with a scripted model: `tool_response.structuredPatch`.
 */
const context = (from: number, to: number, name: string) =>
    Array.from({ length: to - from + 1 }, (_, i) => ` ${name}_${from + i} = ${from + i}`);
const CLI = {
    // Line 80 edited; its new text "retries = 3" is also line 5.
    duplicate: {
        filePath: '/w/dup.py', oldString: 'retries = 1', newString: 'retries = 3', originalFile: '', userModified: false, replaceAll: false,
        structuredPatch: [{ oldStart: 77, oldLines: 7, newStart: 77, newLines: 7, lines: [...context(77, 79, 'line'), '-retries = 1', '+retries = 3', ...context(81, 83, 'line')] }],
    },
    // Line 85 deleted.
    deletion: {
        filePath: '/w/del.py', oldString: 'DEBUG = True\n', newString: '', originalFile: '', userModified: false, replaceAll: false,
        structuredPatch: [{ oldStart: 82, oldLines: 7, newStart: 82, newLines: 6, lines: [...context(82, 84, 'item'), '-DEBUG = True', ...context(86, 88, 'item')] }],
    },
    // A whole-file Write that changed lines 40 and 41.
    rewrite: {
        type: 'update', filePath: '/w/upd.py', content: '', originalFile: '', userModified: false,
        structuredPatch: [{ oldStart: 37, oldLines: 8, newStart: 37, newLines: 8, lines: [...context(37, 39, 'u'), '-u_40 = 40', '-u_41 = 41', '+u_40 = 4000', '+u_41 = 4100', ...context(42, 44, 'u')] }],
    },
    created: { type: 'create', filePath: '/w/new.py', content: 'print("forged")\nprint("twice")\n', structuredPatch: [], originalFile: null, userModified: false },
};

describe('the lines an edit changed, from the CLI\'s own patch', () => {
    it('is the line the edit was made on, even when its new text also sits higher up', () => {
        expect(patchLines('Edit', CLI.duplicate)).toEqual({ changed: [{ start: 79, end: 79 }], deleted: [], probe: { line: 79, text: 'retries = 3' } });
    });

    it('is a deletion point where lines were removed', () => {
        expect(patchLines('Edit', CLI.deletion)).toEqual({ changed: [], deleted: [84], probe: { line: 84, text: 'item_86 = 86' } });
    });

    it('is the rewritten lines of a whole-file Write', () => {
        expect(patchLines('Write', CLI.rewrite)?.changed).toEqual([{ start: 39, end: 40 }]);
    });

    it('is every line of a file the Write created', () => {
        expect(patchLines('Write', CLI.created)?.changed).toEqual([{ start: 0, end: 1 }]);
        expect(patchLines('Write', { ...CLI.created, content: '' })?.changed).toEqual([]);
    });

    it('is a deletion at the end when the last lines went', () => {
        const patch = { structuredPatch: [{ newStart: 9, lines: [' a', ' b', '-c', '-d', '\\ No newline at end of file'] }] };
        expect(patchLines('Edit', patch)?.deleted).toEqual([10]);
    });

    it('is unknown without a patch, so the new-text search stands in', () => {
        expect(patchLines('MultiEdit', undefined)).toBeUndefined();
        expect(patchLines('Edit', { structuredPatch: 'nonsense' })).toBeUndefined();
        expect(patchLines('Edit', { structuredPatch: [{ lines: [] }] })).toBeUndefined();
    });
});

describe('where an edited file opens', () => {
    const chat = (viewColumn: number) => ({ viewColumn, showsForge: true, showsText: false });
    const text = (viewColumn: number) => ({ viewColumn, showsForge: false, showsText: true });
    const other = (viewColumn: number) => ({ viewColumn, showsForge: false, showsText: false });

    it('is the editor in use, when it is not the chat', () => {
        expect(followColumn([text(1), chat(2), text(3)], 3)).toBe(3);
    });

    it('is a column showing text, never the chat', () => {
        expect(followColumn([chat(1), text(2)], undefined)).toBe(2);
        expect(followColumn([text(1), chat(2)], 2)).toBe(1);
    });

    it('is beside the chat when nothing else is open', () => {
        expect(followColumn([chat(1)], undefined)).toBe(2);
        expect(followColumn([other(1), chat(2)], undefined)).toBe(3);
    });

    it('is never the editor the user is working in', () => {
        // Typing in column 1: another text column, else a new one after the last.
        expect(followColumn([text(1), text(2)], 1, 1)).toBe(2);
        expect(followColumn([text(1)], 1, 1)).toBe(2);
        expect(followColumn([text(1), chat(2)], 1, 1)).toBe(3);
        expect(followColumn([chat(1), text(2)], 2, 2)).toBe(3);
        // An empty group beside it is used before a new one is made.
        expect(followColumn([text(1), other(2)], 1, 1)).toBe(2);
    });

    it('is the first column when the chat is in a side bar', () => {
        expect(followColumn([other(1)], undefined)).toBe(1);
        expect(followColumn([], undefined)).toBe(1);
    });
});

describe('following an applied edit in the editor', () => {
    const FILE = '/w/tls/config.py';
    const TEXT = ['import os', 'TLS = "1.3"', ''].join('\n');
    let document: { uri: { fsPath: string }; getText: () => string };
    let editor: { document: typeof document; viewColumn: number; revealRange: any; setDecorations: any };
    let show: ReturnType<typeof vi.fn>;
    let open: ReturnType<typeof vi.fn>;
    let execute: ReturnType<typeof vi.fn>;
    let decorate: ReturnType<typeof vi.fn>;
    const saved = {
        createTextEditorDecorationType: vscode.window.createTextEditorDecorationType,
        showTextDocument: vscode.window.showTextDocument,
        openTextDocument: vscode.workspace.openTextDocument,
        executeCommand: vscode.commands.executeCommand,
        visibleTextEditors: vscode.window.visibleTextEditors,
        tabGroups: vscode.window.tabGroups.all,
    };

    beforeEach(() => {
        vi.useFakeTimers();
        document = { uri: { fsPath: FILE }, getText: () => TEXT };
        editor = { document, viewColumn: 2, revealRange: vi.fn(), setDecorations: vi.fn() };
        show = vi.fn(async () => editor);
        open = vi.fn(async () => document);
        execute = vi.fn(async () => undefined);
        (vscode.window as any).showTextDocument = show;
        (vscode.workspace as any).openTextDocument = open;
        (vscode.commands as any).executeCommand = execute;
        // Each decoration type remembers how it was made, so a test can tell
        // the highlight (a background) from the bar and the deletion rules.
        decorate = vi.fn((options: any) => ({ options, dispose: vi.fn() }));
        (vscode.window as any).createTextEditorDecorationType = decorate;
        (vscode.window as any).visibleTextEditors = [];
        // The chat is an editor tab in column 1.
        (vscode.window.tabGroups as any).all = [
            { viewColumn: 1, activeTab: { input: new (vscode as any).TabInputWebview('mainThreadWebview-forge.chat') } },
        ];
    });

    afterEach(() => {
        vi.useRealTimers();
        (vscode.window as any).showTextDocument = saved.showTextDocument;
        (vscode.workspace as any).openTextDocument = saved.openTextDocument;
        (vscode.commands as any).executeCommand = saved.executeCommand;
        (vscode.window as any).createTextEditorDecorationType = saved.createTextEditorDecorationType;
        (vscode.window as any).visibleTextEditors = saved.visibleTextEditors;
        (vscode.window.tabGroups as any).all = saved.tabGroups;
    });

    const edit = { file_path: FILE, old_string: 'TLS = "1.2"', new_string: 'TLS = "1.3"' };

    type Kind = 'highlight' | 'bar' | 'removed' | 'removedAtEnd';
    const kindOf = (type: any): Kind =>
        type.options.backgroundColor ? 'highlight'
            : type.options.borderWidth === '2px 0 0 0' ? 'removed'
                : type.options.borderWidth === '0 0 2px 0' ? 'removedAtEnd' : 'bar';
    /** The lines each kind of mark covers now (the last call per kind). */
    const marks = () => {
        const now: Partial<Record<Kind, number[]>> = {};
        for (const [type, ranges] of editor.setDecorations.mock.calls) now[kindOf(type)] = ranges.map((r: any) => r.start.line);
        return now;
    };

    it('opens the file beside the chat without taking focus, and highlights the changed line', async () => {
        const follower = new EditFollower(() => true);
        await follower.follow('Edit', edit, '/w');

        expect(open).toHaveBeenCalledWith(expect.objectContaining({ fsPath: FILE }));
        // Not a preview: the next file edited does not close this one.
        expect(show).toHaveBeenCalledWith(document, { viewColumn: 2, preserveFocus: true, preview: false });
        const [range] = editor.revealRange.mock.calls[0]!;
        expect(range.start.line).toBe(1);
        expect(editor.revealRange.mock.calls[0]![1]).toBe(vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        expect(marks()).toMatchObject({ highlight: [1], bar: [] });

        // A stepped fade: the highlight goes, the bar stays, then it goes too.
        vi.advanceTimersByTime(HIGHLIGHT_MS);
        expect(marks()).toMatchObject({ highlight: [], bar: [1] });
        vi.advanceTimersByTime(TRAIL_MS);
        expect(marks()).toMatchObject({ highlight: [], bar: [] });
    });

    it('marks the line the CLI edited, not an earlier line with the same text', async () => {
        const lines = Array.from({ length: 100 }, (_, i) => (i === 4 || i === 79 ? 'retries = 3' : `line_${i + 1} = ${i + 1}`));
        document.getText = () => lines.join('\n') + '\n';
        await new EditFollower(() => true).follow('Edit', { file_path: FILE, old_string: 'retries = 1', new_string: 'retries = 3' }, '/w', CLI.duplicate);
        expect(editor.revealRange.mock.calls[0]![0].start.line).toBe(79);
        expect(marks().highlight).toEqual([79]);
    });

    it('marks where lines were deleted, and scrolls there', async () => {
        const lines = Array.from({ length: 99 }, (_, i) => `item_${i < 84 ? i + 1 : i + 2} = ${i < 84 ? i + 1 : i + 2}`);
        document.getText = () => lines.join('\n') + '\n';
        await new EditFollower(() => true).follow('Edit', { file_path: FILE, old_string: 'DEBUG = True\n', new_string: '' }, '/w', CLI.deletion);
        expect(editor.revealRange.mock.calls[0]![0].start.line).toBe(84);
        expect(marks()).toMatchObject({ highlight: [], removed: [84], removedAtEnd: [] });
        vi.advanceTimersByTime(HIGHLIGHT_MS + TRAIL_MS);
        expect(marks()).toMatchObject({ removed: [] });
    });

    it('highlights all of a file it created, from the top', async () => {
        document.getText = () => CLI.created.content;
        await new EditFollower(() => true).follow('Write', { file_path: FILE, content: CLI.created.content }, '/w', CLI.created);
        expect(editor.revealRange.mock.calls[0]![1]).toBe(vscode.TextEditorRevealType.AtTop);
        expect(marks().highlight).toEqual([0]);
        expect(editor.setDecorations.mock.calls.find(([type]: any) => kindOf(type) === 'highlight')![1][0].end.line).toBe(1);
    });

    it('follows nothing the CLI held back for review', async () => {
        await new EditFollower(() => true).follow('Edit', edit, '/w', { ...CLI.duplicate, staged: true });
        expect(open).not.toHaveBeenCalled();
    });

    it('opens beside the editor the user is typing in, not over it', async () => {
        let selection: (e: any) => void = () => {};
        const saved = { sel: vscode.window.onDidChangeTextEditorSelection, groups: vscode.window.tabGroups.all };
        (vscode.window as any).onDidChangeTextEditorSelection = (fn: any) => { selection = fn; return { dispose() {} }; };
        let clock = 1_000;
        const follower = new EditFollower(() => true, () => {}, () => clock);
        follower.watchUser();
        const mine = { document: { uri: { fsPath: '/w/mine.txt' } }, viewColumn: 1 };
        // The chat is in the side bar; the user's file is the only editor.
        (vscode.window.tabGroups as any).all = [{ viewColumn: 1, activeTab: { input: new (vscode as any).TabInputText({ fsPath: '/w/mine.txt' }) } }];
        const active = vi.spyOn(vscode.window, 'activeTextEditor', 'get').mockReturnValue(mine as any);
        (vscode.window as any).visibleTextEditors = [mine];
        try {
            selection({ textEditor: mine, kind: vscode.TextEditorSelectionChangeKind.Keyboard });
            await follower.follow('Edit', edit, '/w');
            expect(show.mock.calls[0]![1].viewColumn).toBe(2);

            // A while later the user is not busy any more: the editor in use again.
            clock += USER_BUSY_MS;
            await follower.follow('Edit', edit, '/w');
            expect(show.mock.calls[1]![1].viewColumn).toBe(1);

            // Forge's own moves (a command) are not the user.
            selection({ textEditor: mine, kind: vscode.TextEditorSelectionChangeKind.Command });
            await follower.follow('Edit', edit, '/w');
            expect(show.mock.calls[2]![1].viewColumn).toBe(1);

            // Busy, but the user's editor has since been closed: nothing to protect.
            selection({ textEditor: mine, kind: vscode.TextEditorSelectionChangeKind.Mouse });
            (vscode.window as any).visibleTextEditors = [];
            await follower.follow('Edit', edit, '/w');
            expect(show.mock.calls[3]![1].viewColumn).toBe(1);
        } finally {
            active.mockRestore();
            (vscode.window as any).onDidChangeTextEditorSelection = saved.sel;
            (vscode.window.tabGroups as any).all = saved.groups;
            follower.dispose();
        }
    });

    it('keeps the newest edit highlighted for the full time when edits follow each other', async () => {
        const follower = new EditFollower(() => true);
        await follower.follow('Edit', edit, '/w');
        vi.advanceTimersByTime(HIGHLIGHT_MS - 500);
        await follower.follow('Edit', edit, '/w');
        vi.advanceTimersByTime(500);
        // The first edit's fade would have cleared the second edit's highlight here.
        expect(marks().highlight).toEqual([1]);
        vi.advanceTimersByTime(HIGHLIGHT_MS + TRAIL_MS);
        expect(marks()).toMatchObject({ highlight: [], bar: [] });
    });

    it('brings a file already on screen forward where it is, rather than opening it again', async () => {
        (vscode.window as any).visibleTextEditors = [{ document, viewColumn: 3 }];
        await new EditFollower(() => true).follow('Edit', edit, '/w');
        expect(open).not.toHaveBeenCalled();
        expect(show).toHaveBeenCalledWith(document, { viewColumn: 3, preserveFocus: true });
    });

    it('resolves a relative path against the session folder', async () => {
        await new EditFollower(() => true).follow('Edit', { ...edit, file_path: 'tls/config.py' }, '/w');
        expect(open).toHaveBeenCalledWith(expect.objectContaining({ fsPath: path.join('/w', 'tls/config.py') }));
    });

    it('shows the top of a file it wrote whole', async () => {
        await new EditFollower(() => true).follow('Write', { file_path: FILE, content: TEXT }, '/w');
        expect(editor.revealRange.mock.calls[0]![0].start.line).toBe(0);
        expect(editor.revealRange.mock.calls[0]![1]).toBe(vscode.TextEditorRevealType.AtTop);
        expect(editor.setDecorations).not.toHaveBeenCalled();
    });

    it('waits for an open document to reload before marking the CLI\'s patch', async () => {
        let text = 'x\n';
        document.getText = () => text;
        const done = new EditFollower(() => true).follow('Edit', edit, '/w', CLI.duplicate);
        await vi.advanceTimersByTimeAsync(150);
        expect(editor.setDecorations).not.toHaveBeenCalled();
        text = Array.from({ length: 100 }, (_, i) => (i === 79 ? 'retries = 3' : `l${i}`)).join('\n');
        await vi.advanceTimersByTimeAsync(150);
        await done;
        expect(marks().highlight).toEqual([79]);
    });

    it('waits for an open document to reload before pointing at the change', async () => {
        let text = 'import os\nTLS = "1.2"\n';
        document.getText = () => text;
        const done = new EditFollower(() => true).follow('Edit', edit, '/w');
        await vi.advanceTimersByTimeAsync(150);
        text = TEXT; // VS Code picked up the CLI's write
        await vi.advanceTimersByTimeAsync(150);
        await done;
        expect(marks().highlight).toEqual([1]);
    });

    it('opens a notebook through VS Code, without taking focus', async () => {
        await new EditFollower(() => true).follow('NotebookEdit', { notebook_path: '/w/a.ipynb', new_source: 'x' }, '/w');
        expect(execute).toHaveBeenCalledWith('vscode.open', expect.objectContaining({ fsPath: '/w/a.ipynb' }), {
            preserveFocus: true,
            preview: false,
        });
        expect(show).not.toHaveBeenCalled();
    });

    it('does nothing when forge.followEdits is off, or for a tool that does not edit', async () => {
        await new EditFollower(() => false).follow('Edit', edit, '/w');
        await new EditFollower(() => true).follow('Read', { file_path: FILE }, '/w');
        expect(open).not.toHaveBeenCalled();
        expect(show).not.toHaveBeenCalled();
    });

    it('logs a file it cannot show and carries on with the next edit', async () => {
        const log = vi.fn();
        open.mockRejectedValueOnce(new Error('cannot open'));
        const follower = new EditFollower(() => true, log);
        await follower.follow('Edit', edit, '/w');
        await follower.follow('Edit', edit, '/w');
        expect(log).toHaveBeenCalledWith(`[FollowEdits] could not show ${FILE}: cannot open`);
        expect(show).toHaveBeenCalledTimes(1);
    });

    it('shows edits one at a time, in the order they happened', async () => {
        const order: string[] = [];
        open.mockImplementation(async (uri: { fsPath: string }) => {
            order.push(uri.fsPath);
            return { uri, getText: () => TEXT };
        });
        const follower = new EditFollower(() => true);
        const first = follower.follow('Write', { file_path: '/w/1.py', content: '' }, '/w');
        const second = follower.follow('Write', { file_path: '/w/2.py', content: '' }, '/w');
        await Promise.all([first, second]);
        expect(order).toEqual(['/w/1.py', '/w/2.py']);
    });
});

describe('the setting and the hook', () => {
    it('watches the user from activation, and disposes with the extension', () => {
        const source = fs.readFileSync(path.join(ROOT, 'src/extension.ts'), 'utf8');
        expect(source).toMatch(/editFollower\.watchUser\(\);\s*context\.subscriptions\.push\(editFollower\);/);
    });

    it('forge.followEdits is declared, on by default', () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        const setting = manifest.contributes.configuration.properties['forge.followEdits'];
        expect(setting.type).toBe('boolean');
        expect(setting.default).toBe(true);
    });

    it('is driven by PostToolUse for every file-changing tool, and not awaited', () => {
        const source = fs.readFileSync(path.join(ROOT, 'src/services/claude/ClaudeSdkService.ts'), 'utf8');
        const post = source.slice(source.indexOf('PostToolUse: [{'));
        expect(post).toMatch(/matcher: "Edit\|Write\|MultiEdit\|NotebookEdit",\s*hooks: \[async \(input\) => \{\s*if \('tool_name' in input && input.hook_event_name === 'PostToolUse'\) \{\s*void editFollower\.follow\(input\.tool_name, input\.tool_input, input\.cwd, input\.tool_response\);/);
    });
});
