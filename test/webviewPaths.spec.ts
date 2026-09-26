/**
 * B3 for the requests that take a path or content from the webview:
 * `open_file`, `open_diff`, `open_content` and `stat_path_request`.
 *
 * The official host opens whatever path it is given (`openFile` resolves and
 * calls `showTextDocument`, no checks). Forge is stricter, on purpose
 * (production audit, 2026-09-24): these paths come from rendered model output,
 * and on Windows even a `stat` of `\\host\share\x` sends the user's NTLM hash
 * to that host. So network and device paths, URIs, NUL bytes and absurd sizes
 * are refused; any other local path still opens, inside the workspace or not.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  handleOpenContent,
  handleOpenDiff,
  handleOpenFile,
  handleStatPath,
} from '../src/services/claude/handlers/handlers';
import {
  MAX_CONTENT_LENGTH,
  MAX_DIFF_EDITS,
  MAX_PATH_LENGTH,
  MAX_STAT_PATHS,
  assertDiffEdits,
  assertOpenContent,
  isLocalPath,
  localPathProblem,
} from '../src/services/claude/webviewPaths';
import { FileSystemService } from '../src/services/fileSystemService';

afterEach(() => vi.restoreAllMocks());

const HOSTILE_PATHS: Array<[string, string]> = [
  ['a UNC path', '\\\\attacker.example\\share\\x.ts'],
  ['a forward-slash UNC path', '//attacker.example/share/x.ts'],
  ['a device path', '\\\\?\\C:\\Windows\\win.ini'],
  ['a DOS device', '\\\\.\\PhysicalDrive0'],
  ['a file URI', 'file:///etc/passwd'],
  ['a command URI', 'command:workbench.action.terminal.new'],
  ['a vscode URI', 'vscode://file/c:/x'],
  ['a NUL byte', 'src/a.ts\0.png'],
  ['an empty string', ''],
];

describe('localPathProblem', () => {
  it.each(HOSTILE_PATHS)('refuses %s', (_what, value) => {
    expect(localPathProblem(value)).toBeDefined();
    expect(isLocalPath(value)).toBe(false);
  });

  it.each([
    ['a relative path', 'src/app.ts'],
    ['a dot path', './src/app.ts'],
    ['a POSIX absolute path', '/home/me/project/app.ts'],
    ['a Windows drive path', 'C:\\Users\\me\\project\\app.ts'],
    ['a drive path with forward slashes', 'C:/Users/me/project/app.ts'],
    ['a home path', '~/.claude/settings.json'],
    ['a path outside the workspace', '../other/readme.md'],
  ])('accepts %s', (_what, value) => {
    expect(localPathProblem(value)).toBeUndefined();
  });

  it('refuses a non-string and an absurd length', () => {
    expect(localPathProblem(42)).toBe('is not a string');
    expect(localPathProblem(undefined)).toBe('is not a string');
    expect(localPathProblem('a'.repeat(MAX_PATH_LENGTH + 1))).toBe('is too long');
    expect(localPathProblem('a'.repeat(MAX_PATH_LENGTH))).toBeUndefined();
  });
});

describe('open_file', () => {
  const context = () => ({
    logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    workspaceService: { getDefaultWorkspaceFolder: () => undefined },
    fileSystemService: { findFiles: vi.fn(async () => []), resolveExistingPath: vi.fn() },
  }) as any;

  it.each(HOSTILE_PATHS)('refuses %s before searching or touching the disk', async (_what, filePath) => {
    const ctx = context();
    await expect(handleOpenFile({ type: 'open_file', filePath }, ctx)).rejects.toThrow(/^open_file: filePath /);
    expect(ctx.fileSystemService.findFiles).not.toHaveBeenCalled();
    expect(ctx.fileSystemService.resolveExistingPath).not.toHaveBeenCalled();
  });

  it('opens a real local file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-open-'));
    const file = path.join(dir, 'a.ts');
    fs.writeFileSync(file, 'x');
    const ctx = context();
    ctx.fileSystemService.resolveExistingPath = vi.fn(async () => file);
    const show = vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue({ revealRange() {}, selection: undefined } as any);
    vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue({} as any);

    expect(await handleOpenFile({ type: 'open_file', filePath: file }, ctx)).toEqual({ type: 'open_file_response' });
    expect(show).toHaveBeenCalled();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('stat_path_request', () => {
  const context = () => ({
    workspaceService: { getDefaultWorkspaceFolder: () => undefined },
    fileSystemService: { normalizeAbsolutePath: vi.fn((p: string, cwd: string) => (path.isAbsolute(p) ? p : path.join(cwd, p))) },
  }) as any;

  it('reports a network path as "other" without stat-ing it', async () => {
    const ctx = context();
    const stat = vi.spyOn(fs.promises, 'stat');
    const response = await handleStatPath({ type: 'stat_path_request', paths: ['\\\\attacker\\share\\x', '//h/s/x', 'file:///x'] }, ctx);
    expect(response.entries).toEqual([
      { path: '\\\\attacker\\share\\x', type: 'other' },
      { path: '//h/s/x', type: 'other' },
      { path: 'file:///x', type: 'other' },
    ]);
    expect(stat).not.toHaveBeenCalled();
    expect(ctx.fileSystemService.normalizeAbsolutePath).not.toHaveBeenCalled();
  });

  it('still stats local paths', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-stat-'));
    fs.writeFileSync(path.join(dir, 'f.txt'), '');
    const response = await handleStatPath({ type: 'stat_path_request', paths: [path.join(dir, 'f.txt'), dir, path.join(dir, 'missing')] }, context());
    expect(response.entries.map((e) => e.type)).toEqual(['file', 'directory', 'not_found']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it(`answers at most ${MAX_STAT_PATHS} paths`, async () => {
    const paths = Array.from({ length: MAX_STAT_PATHS + 50 }, (_, i) => `//h/s/${i}`);
    const response = await handleStatPath({ type: 'stat_path_request', paths }, context());
    expect(response.entries).toHaveLength(MAX_STAT_PATHS);
  });

  it('ignores a paths field that is not a list', async () => {
    expect((await handleStatPath({ type: 'stat_path_request', paths: 'x' } as any, context())).entries).toEqual([]);
  });
});

describe('open_diff', () => {
  const context = () => ({
    logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    workspaceService: { getDefaultWorkspaceFolder: () => undefined },
    fileSystemService: { resolveFilePath: vi.fn(), pathExists: vi.fn(), createTempFile: vi.fn() },
  }) as any;
  const signal = new AbortController().signal;
  const edit = { oldString: 'a', newString: 'b' };

  it.each([
    ['a network original', { originalFilePath: '\\\\h\\s\\x', newFilePath: '', edits: [edit] }, /originalFilePath is a network/],
    ['a URI new file', { originalFilePath: 'a.ts', newFilePath: 'file:///x', edits: [edit] }, /newFilePath is a URI/],
    ['no path at all', { originalFilePath: '', newFilePath: '', edits: [edit] }, /no file path/],
    ['edits that are not a list', { originalFilePath: 'a.ts', newFilePath: '', edits: 'x' }, /edits is not a list/],
    ['an edit without strings', { originalFilePath: 'a.ts', newFilePath: '', edits: [{ oldString: 1, newString: 'b' }] }, /needs oldString and newString/],
    ['a non-boolean replaceAll', { originalFilePath: 'a.ts', newFilePath: '', edits: [{ ...edit, replaceAll: 'yes' }] }, /replaceAll must be a boolean/],
  ])('refuses %s before reading anything', async (_what, fields, message) => {
    const ctx = context();
    await expect(handleOpenDiff({ type: 'open_diff', supportMultiEdits: false, ...fields } as any, ctx, signal)).rejects.toThrow(message);
    expect(ctx.fileSystemService.resolveFilePath).not.toHaveBeenCalled();
    expect(ctx.fileSystemService.pathExists).not.toHaveBeenCalled();
  });

  it('bounds the number and the size of the edits', () => {
    expect(() => assertDiffEdits(Array.from({ length: MAX_DIFF_EDITS + 1 }, () => edit))).toThrow(/too many edits/);
    expect(() => assertDiffEdits([{ oldString: 'a'.repeat(MAX_CONTENT_LENGTH), newString: 'b' }])).toThrow(/too large/);
    expect(() => assertDiffEdits([edit, { ...edit, replaceAll: true }])).not.toThrow();
  });
});

describe('open_content', () => {
  it.each([
    ['content that is not a string', 42, 'x.txt', false, /content is not a string/],
    ['content too large', 'a'.repeat(MAX_CONTENT_LENGTH + 1), 'x.txt', false, /content is too large/],
    ['a file name that is not a string', 'x', 42, false, /fileName is not a string/],
    ['a file name too long', 'x', 'a'.repeat(300), false, /fileName is too long/],
    ['editable that is not a boolean', 'x', 'x.txt', 'yes', /editable is not a boolean/],
  ])('refuses %s', async (_what, content, fileName, editable, message) => {
    const createTempFile = vi.fn();
    await expect(
      handleOpenContent({ type: 'open_content', content, fileName, editable } as any, { logService: { info: vi.fn() }, fileSystemService: { createTempFile } } as any, new AbortController().signal),
    ).rejects.toThrow(message);
    expect(createTempFile).not.toHaveBeenCalled();
  });

  it('accepts the shape the tool cards send', () => {
    expect(() => assertOpenContent('output', 'Grep output', false)).not.toThrow();
    expect(() => assertOpenContent('output', undefined, undefined)).not.toThrow();
  });

  it('a temp file name can never leave the temp folder', () => {
    const fsService = new (FileSystemService as any)();
    for (const name of ['..', '.', '../../evil', 'a/b\\c', 'C:\\x']) {
      const cleaned = fsService.sanitizeFileName(name);
      expect(cleaned).not.toMatch(/[\\/]/);
      expect(cleaned).not.toMatch(/^\.+$/);
    }
  });
});
