/**
 * The chat opens as an editor tab by default, as Claude Code's does.
 *
 * The official `claudeCode.preferredLocation` defaults to "panel": the history
 * opens a conversation with `claude-vscode.editor.open`, which puts it in an
 * editor tab in a column of its own (`createPanel`, `findUnusedColumn`), locks
 * the column, and leaves the history where it is. VS Code gives the new column
 * half the editor area, which is the size the chat opens at. Forge opened it
 * in the secondary side bar, which VS Code keeps narrow (the user, 2026-09-26:
 * "a size that shows how good the UI, not a minimized window", then "Open as
 * editor tab a panel with the right size").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { chatLocationFrom, DEFAULT_CHAT_LOCATION } from '../src/shared/chatLocation';
import { handleRevealChat } from '../src/services/claude/handlers/handlers';

const SESSION = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('the setting', () => {
    it('defaults to an editor tab, and keeps the side-bar values it had', () => {
        expect(DEFAULT_CHAT_LOCATION).toBe('panel');
        expect(chatLocationFrom('secondary')).toBe('secondary');
        expect(chatLocationFrom('primary')).toBe('primary');
        expect(chatLocationFrom('panel')).toBe('panel');
    });

    it('reads anything else as the default', () => {
        for (const bad of [undefined, null, '', 'sidebar', 'PANEL', 42, {}]) {
            expect(chatLocationFrom(bad)).toBe('panel');
        }
    });
});

describe('the history hands off to an editor tab', () => {
    let executeCommand: ReturnType<typeof vi.fn>;
    let openEditorPage: ReturnType<typeof vi.fn>;
    let notifyClient: ReturnType<typeof vi.fn>;
    let context: any;

    beforeEach(() => {
        // The mock returns each setting's in-code fallback: the default location.
        executeCommand = vi.fn(async () => undefined);
        (vscode.commands as any).executeCommand = executeCommand;
        openEditorPage = vi.fn();
        notifyClient = vi.fn();
        context = {
            logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
            agentService: { notifyClient, setPendingGroup: vi.fn() },
            webViewService: { openEditorPage },
        };
    });

    it('opens a row`s conversation in a tab of its own, keyed by the session', async () => {
        const response = await handleRevealChat({ type: 'reveal_chat', sessionId: SESSION, fromView: true }, context);

        expect(response).toEqual({ type: 'reveal_chat_response' });
        // The same key twice reveals the same tab (`sessionPanels`), not a second one.
        expect(openEditorPage).toHaveBeenCalledWith('chat', 'Forge', `session-${SESSION}`, { sessionId: SESSION });
    });

    it('leaves the history on screen: no side bar opened, none closed', async () => {
        await handleRevealChat({ type: 'reveal_chat', sessionId: SESSION, fromView: true }, context);
        await handleRevealChat({ type: 'reveal_chat', newConversation: true, fromView: true }, context);

        expect(executeCommand).not.toHaveBeenCalled();
        // No side-bar entrance to play either.
        expect(notifyClient).not.toHaveBeenCalled();
    });

    it('opens a fresh tab for each new session, as the official`s createPanel does', async () => {
        await handleRevealChat({ type: 'reveal_chat', newConversation: true, fromView: true }, context);
        await handleRevealChat({ type: 'reveal_chat', newConversation: true, fromView: true }, context);

        const keys = openEditorPage.mock.calls.map((call) => call[2]);
        expect(keys).toHaveLength(2);
        expect(new Set(keys).size).toBe(2);
        for (const key of keys) expect(key).toMatch(/^chat-new-\d+$/);
    });

    it('brings the last chat tab forward when asked for no conversation in particular', async () => {
        await handleRevealChat({ type: 'reveal_chat' }, context);
        expect(openEditorPage).toHaveBeenCalledWith('chat', 'Forge', 'chat-last');
    });

    it('refuses a session id that is not one before opening anything (B3)', async () => {
        for (const bad of ['../../x', '</script>', 'abc', 42, '']) {
            await expect(
                handleRevealChat({ type: 'reveal_chat', sessionId: bad } as any, context),
            ).rejects.toThrow('reveal_chat: sessionId is not a session id');
        }
        expect(openEditorPage).not.toHaveBeenCalled();
    });
});

describe('a chat tab opened on a conversation', () => {
    let ext: string;

    beforeEach(() => {
        ext = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-tab-'));
        fs.mkdirSync(path.join(ext, 'dist', 'media'), { recursive: true });
        for (const file of ['main.js', 'style.css']) fs.writeFileSync(path.join(ext, 'dist', 'media', file), 'x');
    });

    afterEach(() => {
        fs.rmSync(ext, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    async function build() {
        const panels: any[] = [];
        vi.spyOn(vscode.window as any, 'createWebviewPanel').mockImplementation(() => {
            const panel = {
                viewColumn: 2,
                webview: { options: {}, html: '', cspSource: 'vscode-resource:', postMessage: vi.fn(), onDidReceiveMessage: vi.fn(), asWebviewUri: (u: any) => u },
                reveal: vi.fn(),
                onDidDispose: vi.fn(),
                onDidChangeViewState: vi.fn(),
            };
            panels.push(panel);
            return panel as never;
        });
        const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() };
        const { WebViewService } = await import('../src/services/webViewService');
        const service = new WebViewService({ extensionPath: ext, extensionMode: 1, subscriptions: [], globalState: { get: () => undefined } } as any, log as any);
        return { service, panels };
    }

    const bootstrapOf = (html: string) => JSON.parse(/window\.FORGE_BOOTSTRAP = (\{.*?\});/s.exec(html)![1]);

    it('carries the session in its bootstrap, since it is not listening yet', async () => {
        const { service, panels } = await build();
        service.openEditorPage('chat', 'Forge', `session-${SESSION}`, { sessionId: SESSION });

        expect(panels).toHaveLength(1);
        expect(bootstrapOf(panels[0].webview.html)).toMatchObject({ host: 'editor', page: 'chat', sessionId: SESSION });
    });

    it('is revealed, not duplicated, when the same conversation is opened again, and told to show it', async () => {
        const { service, panels } = await build();
        service.openEditorPage('chat', 'Forge', `session-${SESSION}`, { sessionId: SESSION });
        service.openEditorPage('chat', 'Forge', `session-${SESSION}`, { sessionId: SESSION });

        expect(panels).toHaveLength(1);
        expect(panels[0].reveal).toHaveBeenCalledWith(2);
        expect(panels[0].webview.postMessage).toHaveBeenCalledWith({
            type: 'from-extension',
            message: expect.objectContaining({
                type: 'request',
                request: { type: 'ui_command', command: 'open_session', sessionId: SESSION },
            }),
        });
    });

    it('carries no session when none was asked for', async () => {
        const { service, panels } = await build();
        service.openEditorPage('chat', 'Forge', 'chat-last');
        expect(bootstrapOf(panels[0].webview.html).sessionId).toBeUndefined();
    });
});
