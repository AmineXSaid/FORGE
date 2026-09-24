/**
 * Reading and writing JSON settings files without ever losing the user's data.
 *
 * Found in the production audit (2026-09-24): several writers read a settings
 * file with a helper that answered `{}` when the file did not parse (a comment,
 * a trailing comma, a read while the CLI was writing it), merged a patch into
 * that `{}` and wrote it back, so the user's settings were replaced by the
 * patch. Every read that is followed by a write goes through
 * `readJsonObjectForWrite`, which throws instead, and every write goes through
 * `writeJsonAtomic`, so a crash or a concurrent reader never sees half a file.
 */

import * as fs from 'fs';
import * as path from 'path';

/** A settings file exists but is not a JSON object; it is left untouched. */
export class SettingsFileUnreadableError extends Error {
    constructor(readonly filePath: string, cause: unknown) {
        super(`${filePath} is not valid JSON (${cause instanceof Error ? cause.message : String(cause)}); it was left unchanged.`);
        this.name = 'SettingsFileUnreadableError';
    }
}

/**
 * The object in `filePath`, for a read that will be written back: `{}` only
 * when the file does not exist or is empty. A file that does not parse, or
 * whose top level is not an object, throws `SettingsFileUnreadableError`.
 */
export async function readJsonObjectForWrite(filePath: string): Promise<Record<string, unknown>> {
    let content: string;
    try {
        content = await fs.promises.readFile(filePath, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
        throw error;
    }
    return parseJsonObject(filePath, content);
}

/** `readJsonObjectForWrite` for content already read. */
export function parseJsonObject(filePath: string, content: string): Record<string, unknown> {
    // A UTF-8 byte order mark is not JSON, but editors on Windows write one.
    const text = content.replace(/^﻿/, '');
    if (!text.trim()) return {};
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new SettingsFileUnreadableError(filePath, error);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new SettingsFileUnreadableError(filePath, new Error('the top level is not an object'));
    }
    return parsed as Record<string, unknown>;
}

/**
 * On Windows a rename over a file another process has open (the CLI watching
 * its settings, an antivirus scan) fails for a moment with one of these.
 */
const TRANSIENT_RENAME_ERRORS = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_RETRY_DELAYS_MS = [25, 75, 200];

/**
 * Written whole or not at all: a temp file beside the target, then a rename.
 * Two-space JSON with a trailing newline, as the CLI writes its own files.
 */
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    try {
        await fs.promises.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        for (let attempt = 0; ; attempt++) {
            try {
                await fs.promises.rename(temp, filePath);
                return;
            } catch (error) {
                const code = (error as NodeJS.ErrnoException).code;
                if (attempt >= RENAME_RETRY_DELAYS_MS.length || !code || !TRANSIENT_RENAME_ERRORS.has(code)) throw error;
                await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAYS_MS[attempt]));
            }
        }
    } catch (error) {
        await fs.promises.rm(temp, { force: true }).catch(() => undefined);
        throw error;
    }
}
