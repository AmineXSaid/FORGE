/**
 * B3: the paths and contents the webview hands to `open_file`, `open_diff`,
 * `open_content` and `stat_path_request`.
 *
 * These are Forge's own rules (production audit, 2026-09-24); the official
 * bundle was not on disk when they were written, so they are not a copy of its
 * checks. The paths come from rendered model output (file links, tool cards),
 * so they are not trusted:
 *
 * - a UNC or device path (`\\host\share\x`, `//host/share`, `\\?\`, `\\.\`) is
 *   refused: on Windows even a `stat` of one makes the OS authenticate to that
 *   host, handing it the user's NTLM hash;
 * - a URI (`file:`, `vscode:`, `command:`, ...) is refused; a drive letter
 *   (`C:\x`) is not a scheme;
 * - a NUL byte, an empty string or an absurd length is refused.
 *
 * Any other local path may be opened or stat-ed, inside the workspace or not:
 * the model legitimately points at files outside it (`~/.claude/settings.json`,
 * a temp file), and opening one in an editor runs nothing.
 */

export const MAX_PATH_LENGTH = 4096;
export const MAX_STAT_PATHS = 1000;
export const MAX_CONTENT_LENGTH = 10 * 1024 * 1024;
export const MAX_DIFF_EDITS = 1000;
export const MAX_FILE_NAME_LENGTH = 255;

/** Why `path` may not be used, or undefined when it may. */
export function localPathProblem(value: unknown): string | undefined {
    if (typeof value !== 'string') return 'is not a string';
    if (value.length === 0) return 'is empty';
    if (value.length > MAX_PATH_LENGTH) return 'is too long';
    if (value.includes('\0')) return 'contains a NUL byte';
    if (/^[\\/]{2}/.test(value)) return 'is a network or device path';
    if (/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(value)) return 'is a URI, not a path';
    return undefined;
}

export function isLocalPath(value: unknown): value is string {
    return localPathProblem(value) === undefined;
}

/** Throws `<what> <problem>` for a path the host must not touch. */
export function assertLocalPath(value: unknown, what: string): asserts value is string {
    const problem = localPathProblem(value);
    if (problem) throw new Error(`${what} ${problem}.`);
}

/** `open_diff`'s edits: at most MAX_DIFF_EDITS, each two strings and an optional boolean. */
export function assertDiffEdits(edits: unknown): asserts edits is Array<{ oldString: string; newString: string; replaceAll?: boolean }> {
    if (!Array.isArray(edits)) throw new Error('open_diff: edits is not a list.');
    if (edits.length > MAX_DIFF_EDITS) throw new Error('open_diff: too many edits.');
    let total = 0;
    for (const edit of edits) {
        if (typeof edit !== 'object' || edit === null) throw new Error('open_diff: an edit is not an object.');
        const { oldString, newString, replaceAll } = edit as Record<string, unknown>;
        if (typeof oldString !== 'string' || typeof newString !== 'string') {
            throw new Error('open_diff: an edit needs oldString and newString.');
        }
        if (replaceAll !== undefined && typeof replaceAll !== 'boolean') {
            throw new Error('open_diff: replaceAll must be a boolean.');
        }
        total += oldString.length + newString.length;
    }
    if (total > MAX_CONTENT_LENGTH) throw new Error('open_diff: the edits are too large.');
}

/** `open_content`'s payload: a bounded string, a plain file name, a boolean. */
export function assertOpenContent(content: unknown, fileName: unknown, editable: unknown): void {
    if (typeof content !== 'string') throw new Error('open_content: content is not a string.');
    if (content.length > MAX_CONTENT_LENGTH) throw new Error('open_content: content is too large.');
    if (fileName !== undefined && fileName !== null) {
        if (typeof fileName !== 'string') throw new Error('open_content: fileName is not a string.');
        if (fileName.length > MAX_FILE_NAME_LENGTH) throw new Error('open_content: fileName is too long.');
    }
    if (editable !== undefined && typeof editable !== 'boolean') throw new Error('open_content: editable is not a boolean.');
}
