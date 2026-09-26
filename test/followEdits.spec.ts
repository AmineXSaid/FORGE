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
    const saved = {
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
        (vscode.window as any).visibleTextEditors = saved.visibleTextEditors;
        (vscode.window.tabGroups as any).all = saved.tabGroups;
    });

    const edit = { file_path: FILE, old_string: 'TLS = "1.2"', new_string: 'TLS = "1.3"' };

    it('opens the file beside the chat without taking focus, and highlights the changed line', async () => {
        const follower = new EditFollower(() => true);
        await follower.follow('Edit', edit, '/w');

        expect(open).toHaveBeenCalledWith(expect.objectContaining({ fsPath: FILE }));
        expect(show).toHaveBeenCalledWith(document, { viewColumn: 2, preserveFocus: true, preview: true });
        const [range] = editor.revealRange.mock.calls[0]!;
        expect(range.start.line).toBe(1);
        expect(editor.revealRange.mock.calls[0]![1]).toBe(vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        const [, ranges] = editor.setDecorations.mock.calls[0]!;
        expect(ranges.map((r: any) => [r.start.line, r.end.line])).toEqual([[1, 1]]);

        // The highlight goes after a moment; the file stays open.
        vi.advanceTimersByTime(HIGHLIGHT_MS);
        expect(editor.setDecorations.mock.calls.at(-1)![1]).toEqual([]);
    });

    it('keeps the newest edit highlighted for the full time when edits follow each other', async () => {
        const follower = new EditFollower(() => true);
        await follower.follow('Edit', edit, '/w');
        vi.advanceTimersByTime(HIGHLIGHT_MS - 500);
        await follower.follow('Edit', edit, '/w');
        vi.advanceTimersByTime(500);
        // The first edit's fade would have cleared the second edit's highlight here.
        expect(editor.setDecorations.mock.calls.at(-1)![1]).toHaveLength(1);
        vi.advanceTimersByTime(HIGHLIGHT_MS);
        expect(editor.setDecorations.mock.calls.at(-1)![1]).toEqual([]);
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

    it('waits for an open document to reload before pointing at the change', async () => {
        let text = 'import os\nTLS = "1.2"\n';
        document.getText = () => text;
        const done = new EditFollower(() => true).follow('Edit', edit, '/w');
        await vi.advanceTimersByTimeAsync(150);
        text = TEXT; // VS Code picked up the CLI's write
        await vi.advanceTimersByTimeAsync(150);
        await done;
        expect(editor.setDecorations.mock.calls[0]![1].map((r: any) => r.start.line)).toEqual([1]);
    });

    it('opens a notebook through VS Code, without taking focus', async () => {
        await new EditFollower(() => true).follow('NotebookEdit', { notebook_path: '/w/a.ipynb', new_source: 'x' }, '/w');
        expect(execute).toHaveBeenCalledWith('vscode.open', expect.objectContaining({ fsPath: '/w/a.ipynb' }), {
            preserveFocus: true,
            preview: true,
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
    it('forge.followEdits is declared, on by default', () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        const setting = manifest.contributes.configuration.properties['forge.followEdits'];
        expect(setting.type).toBe('boolean');
        expect(setting.default).toBe(true);
    });

    it('is driven by PostToolUse for every file-changing tool, and not awaited', () => {
        const source = fs.readFileSync(path.join(ROOT, 'src/services/claude/ClaudeSdkService.ts'), 'utf8');
        const post = source.slice(source.indexOf('PostToolUse: [{'));
        expect(post).toMatch(/matcher: "Edit\|Write\|MultiEdit\|NotebookEdit",\s*hooks: \[async \(input\) => \{\s*if \('tool_name' in input && input.hook_event_name === 'PostToolUse'\) \{\s*void editFollower\.follow\(input\.tool_name, input\.tool_input, input\.cwd\);/);
    });
});
