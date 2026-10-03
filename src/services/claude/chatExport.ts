/**
 * Export a conversation as JSON, and import one back so the model can carry
 * on with it (asked for on 2026-10-03).
 *
 * The export is the CLI's own transcript -- every JSONL row, untouched --
 * wrapped with a little metadata. Keeping the rows as they are is what makes
 * an import resumable: written back as `<id>.jsonl` in this workspace's
 * project folder, it is a conversation the CLI `--resume`s like any other.
 *
 * On import every row gets a fresh session id and fresh row uuids (so the
 * copy never collides with the original, if both live on this machine) and
 * this workspace's `cwd`, which is where the CLI looks for it.
 *
 * The file is untrusted input (B3): its shape is checked, its size bounded,
 * and nothing in it chooses a path -- the host picks the file name.
 *
 * Kept free of `vscode` so the spec can import it.
 */
import * as crypto from 'node:crypto';

export const CHAT_EXPORT_FORMAT = 'forge-chat';
export const CHAT_EXPORT_VERSION = 1;
/** Bounds on an imported file. */
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 200_000;

export interface ChatExport {
    format: typeof CHAT_EXPORT_FORMAT;
    version: number;
    exportedAt: string;
    title?: string;
    sessionId: string;
    cwd?: string;
    /** The CLI transcript, one object per JSONL row. */
    transcript: Record<string, unknown>[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse a transcript file's text into rows, skipping lines that are not JSON objects. */
export function parseTranscript(text: string): Record<string, unknown>[] {
    const rows: Record<string, unknown>[] = [];
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
            const row = JSON.parse(line);
            if (row && typeof row === 'object' && !Array.isArray(row)) rows.push(row);
        } catch {
            // A torn last line (the CLI was writing) is not worth failing the export.
        }
    }
    return rows;
}

/** The title a transcript shows: its latest custom title, else its first prompt. */
export function transcriptTitle(rows: readonly Record<string, unknown>[]): string | undefined {
    for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i]!;
        if (row.type === 'custom-title' && typeof row.customTitle === 'string') return row.customTitle;
    }
    for (const row of rows) {
        if (row.type !== 'user' || row.isMeta) continue;
        const content = (row.message as { content?: unknown } | undefined)?.content;
        const text = typeof content === 'string'
            ? content
            : Array.isArray(content)
                ? content.map((b: { type?: string; text?: string }) => (b?.type === 'text' ? b.text ?? '' : '')).join(' ')
                : '';
        if (text.trim() && !text.trim().startsWith('<')) return text.trim().slice(0, 80);
    }
    return undefined;
}

export function buildExport(sessionId: string, rows: Record<string, unknown>[], cwd?: string, now = new Date()): ChatExport {
    return {
        format: CHAT_EXPORT_FORMAT,
        version: CHAT_EXPORT_VERSION,
        exportedAt: now.toISOString(),
        title: transcriptTitle(rows),
        sessionId,
        ...(cwd && { cwd }),
        transcript: rows,
    };
}

/** A file name for the save dialog: the title, made safe, then `.forge-chat.json`. */
export function exportFileName(title: string | undefined, sessionId: string): string {
    const base = (title ?? '')
        .replace(/[<>:"/\\|?*]/g, ' ')
        .split('').filter((ch) => ch.charCodeAt(0) >= 32).join('')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
    return `${base || `conversation-${sessionId.slice(0, 8)}`}.forge-chat.json`;
}

/** Validate an imported file. Throws with a reason the user can act on. */
export function parseImport(text: string): ChatExport {
    if (Buffer.byteLength(text) > MAX_IMPORT_BYTES) throw new Error('the file is larger than 200 MB');
    let doc: unknown;
    try {
        doc = JSON.parse(text);
    } catch {
        throw new Error('the file is not JSON');
    }
    const d = doc as Partial<ChatExport>;
    if (!d || typeof d !== 'object' || d.format !== CHAT_EXPORT_FORMAT) {
        throw new Error('the file is not a Forge chat export (format "forge-chat")');
    }
    if (typeof d.version !== 'number' || d.version > CHAT_EXPORT_VERSION) {
        throw new Error(`unsupported export version ${String(d.version)}; update Forge`);
    }
    if (!Array.isArray(d.transcript) || d.transcript.length === 0) throw new Error('the export has no messages');
    if (d.transcript.length > MAX_IMPORT_ROWS) throw new Error('the export has too many rows');
    if (d.transcript.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
        throw new Error('the export has a malformed row');
    }
    if (!d.transcript.some((row) => row.type === 'user' || row.type === 'assistant')) {
        throw new Error('the export has no messages');
    }
    return d as ChatExport;
}

/** The row fields that hold another row's uuid. */
const UUID_LINKS = ['uuid', 'parentUuid', 'logicalParentUuid', 'leafUuid'] as const;

/**
 * The transcript, re-keyed for this machine: a new session id everywhere, new
 * row uuids (links kept consistent), this workspace's cwd, and a title that
 * says it was imported.
 */
export function rekeyTranscript(
    exported: ChatExport,
    newSessionId: string,
    cwd: string,
    newUuid: () => string = () => crypto.randomUUID(),
): Record<string, unknown>[] {
    const map = new Map<string, string>();
    const remap = (value: unknown): unknown => {
        if (typeof value !== 'string' || !UUID.test(value)) return value;
        let next = map.get(value);
        if (!next) {
            next = newUuid();
            map.set(value, next);
        }
        return next;
    };
    const rows = exported.transcript.map((row) => {
        const out: Record<string, unknown> = { ...row };
        for (const key of UUID_LINKS) if (key in out && out[key] != null) out[key] = remap(out[key]);
        if ('sessionId' in out) out.sessionId = newSessionId;
        if ('cwd' in out) out.cwd = cwd;
        return out;
    });
    const title = `${(exported.title ?? transcriptTitle(exported.transcript) ?? 'Conversation').slice(0, 180)} (imported)`;
    rows.push({ type: 'custom-title', customTitle: title, sessionId: newSessionId });
    return rows;
}

/** JSONL text for a transcript file. */
export function toJsonl(rows: readonly Record<string, unknown>[]): string {
    return rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
}
