/**
 * Notice when the project's transcript store gains or loses a conversation.
 *
 * The official host tells its webviews the list on disk moved with a bare
 * `session_store_changed` push, and the webview re-reads the list. Forge sends
 * the same push; this is the half that decides when. A transcript is one
 * `<session id>.jsonl` in the project's directory under the CLI's config home,
 * so a file appearing is a conversation created and a file vanishing is one
 * deleted -- whoever did it, Forge, the CLI in a terminal, or a file manager.
 *
 * Only `rename` events count (Node reports creation and deletion as renames).
 * A transcript is appended to on every message, and re-listing on each of
 * those `change` events would re-read the store dozens of times a turn to
 * learn nothing.
 *
 * On a fresh install the directory does not exist yet: the CLI creates it with
 * the first conversation. So a failed attach is not an error, and `refresh()`
 * tries again -- the host calls it when a conversation's id first becomes
 * known, which is exactly when the directory has just been made.
 *
 * Kept free of `vscode` so the spec can drive it with a fake `watch`.
 */
import * as fs from 'node:fs';

export interface SessionStoreWatcher {
    /** Attach if not attached yet. Cheap when already watching. */
    refresh(): void;
    dispose(): void;
}

export type WatchFn = (
    dir: string,
    listener: (event: string, filename: string | Buffer | null) => void,
) => Pick<fs.FSWatcher, 'close' | 'on'>;

export interface SessionStoreWatcherOptions {
    /** Coalesces a burst (a fork writes one file, the CLI may touch two). */
    debounceMs?: number;
    watch?: WatchFn;
}

export function createSessionStoreWatcher(
    projectDir: string,
    onChange: () => void,
    options: SessionStoreWatcherOptions = {},
): SessionStoreWatcher {
    const debounceMs = options.debounceMs ?? 250;
    const watch: WatchFn = options.watch ?? ((dir, listener) => fs.watch(dir, listener));

    let watcher: Pick<fs.FSWatcher, 'close' | 'on'> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const fire = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = undefined;
            if (!disposed) onChange();
        }, debounceMs);
    };

    const detach = () => {
        try {
            watcher?.close();
        } catch {
            // Already gone.
        }
        watcher = undefined;
    };

    const attach = () => {
        if (disposed || watcher) return;
        try {
            watcher = watch(projectDir, (event, filename) => {
                if (event !== 'rename') return;
                // Some platforms omit the name; a rename we cannot attribute is
                // still worth one re-read.
                if (filename && !String(filename).endsWith('.jsonl')) return;
                fire();
            });
            // The directory itself was removed, or the handle died: let the next
            // `refresh()` start over rather than keep a dead watcher.
            watcher.on('error', detach);
        } catch {
            // Not created yet (fresh install), or not readable. Nothing to do.
            watcher = undefined;
        }
    };

    attach();

    return {
        refresh: attach,
        dispose() {
            disposed = true;
            if (timer) clearTimeout(timer);
            timer = undefined;
            detach();
        },
    };
}
