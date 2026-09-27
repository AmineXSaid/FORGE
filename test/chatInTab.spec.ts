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
    let showChatTab: ReturnType<typeof vi.fn>;
    let notifyClient: ReturnType<typeof vi.fn>;
    let context: any;

    beforeEach(() => {
        // The mock returns each setting's in-code fallback: the default location.
        executeCommand = vi.fn(async () => undefined);
        (vscode.commands as any).executeCommand = executeCommand;
        showChatTab = vi.fn();
        notifyClient = vi.fn();
        context = {
            logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
            agentService: { notifyClient, setPendingGroup: vi.fn() },
            webViewService: { showChatTab },
        };
    });

    it('opens a row`s conversation in the chat tab', async () => {
        const response = await handleRevealChat({ type: 'reveal_chat', sessionId: SESSION, fromView: true }, context);

        expect(response).toEqual({ type: 'reveal_chat_response' });
        expect(showChatTab).toHaveBeenCalledWith({ sessionId: SESSION });
    });

    it('starts New session in the chat tab', async () => {
        await handleRevealChat({ type: 'reveal_chat', newConversation: true, fromView: true }, context);
        expect(showChatTab).toHaveBeenCalledWith({ newConversation: true });
    });

    it('brings the chat tab forward when asked for no conversation in particular', async () => {
        await handleRevealChat({ type: 'reveal_chat' }, context);
        expect(showChatTab).toHaveBeenCalledWith({});
    });

    it('leaves the history on screen: no side bar opened, none closed', async () => {
        await handleRevealChat({ type: 'reveal_chat', sessionId: SESSION, fromView: true }, context);
        await handleRevealChat({ type: 'reveal_chat', newConversation: true, fromView: true }, context);

        expect(executeCommand).not.toHaveBeenCalled();
        // No side-bar entrance to play either.
        expect(notifyClient).not.toHaveBeenCalled();
    });

    it('refuses a session id that is not one before opening anything (B3)', async () => {
        for (const bad of ['../../x', '</script>', 'abc', 42, '']) {
            await expect(
                handleRevealChat({ type: 'reveal_chat', sessionId: bad } as any, context),
            ).rejects.toThrow('reveal_chat: sessionId is not a session id');
        }
        expect(showChatTab).not.toHaveBeenCalled();
    });
});

describe('the chat tab the history uses', () => {
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
            const panel: any = {
                viewColumn: 2,
                webview: { options: {}, html: '', cspSource: 'vscode-resource:', postMessage: vi.fn(), onDidReceiveMessage: vi.fn(), asWebviewUri: (u: any) => u },
                reveal: vi.fn(),
                onDidDispose: vi.fn((listener: () => void) => { panel.dispose = listener; }),
                onDidChangeViewState: vi.fn((listener: (e: any) => void) => { panel.viewState = listener; }),
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
    const posted = (panel: any) => panel.webview.postMessage.mock.calls.map((c: any[]) => c[0].message.request).filter((r: any) => r?.type === 'ui_command');

    it('opens one when none is open, carrying the conversation in its bootstrap', async () => {
        const { service, panels } = await build();
        service.showChatTab({ sessionId: SESSION });

        expect(panels).toHaveLength(1);
        expect(bootstrapOf(panels[0].webview.html)).toMatchObject({ host: 'editor', page: 'chat', sessionId: SESSION });
    });

    it('reuses the open one for every later conversation: no new webview, just a message', async () => {
        // 478-793 ms for a new webview in code-server, 32 ms to reuse one.
        const { service, panels } = await build();
        service.showChatTab({ sessionId: SESSION });
        service.showChatTab({ sessionId: 'c9bf9e57-1685-4c89-bafb-ff5af830be8a' });
        service.showChatTab({ newConversation: true });
        service.showChatTab();

        expect(panels).toHaveLength(1);
        expect(panels[0].reveal).toHaveBeenCalledTimes(3);
        expect(panels[0].reveal).toHaveBeenCalledWith(2);
        expect(posted(panels[0])).toEqual([
            { type: 'ui_command', command: 'open_session', sessionId: 'c9bf9e57-1685-4c89-bafb-ff5af830be8a' },
            { type: 'ui_command', command: 'new_conversation_here' },
        ]);
    });

    it('reuses the chat tab that was active last', async () => {
        const { service, panels } = await build();
        service.openEditorPage('chat', 'Forge', 'chat-1');
        service.openEditorPage('chat', 'Forge', 'chat-2');
        panels[0].viewState({ webviewPanel: { visible: true, active: true } });

        service.showChatTab({ sessionId: SESSION });
        expect(panels).toHaveLength(2);
        expect(posted(panels[0])).toEqual([{ type: 'ui_command', command: 'open_session', sessionId: SESSION }]);
        expect(posted(panels[1])).toEqual([]);
    });

    it('opens a new one once the last is closed', async () => {
        const { service, panels } = await build();
        service.showChatTab();
        panels[0].dispose();
        service.showChatTab({ sessionId: SESSION });

        expect(panels).toHaveLength(2);
        expect(bootstrapOf(panels[1].webview.html).sessionId).toBe(SESSION);
    });

    it('never reuses a page that is not the chat', async () => {
        const { service, panels } = await build();
        service.openEditorPage('settings', 'Forge Settings');
        service.showChatTab({ sessionId: SESSION });

        expect(panels).toHaveLength(2);
        expect(bootstrapOf(panels[1].webview.html)).toMatchObject({ page: 'chat', sessionId: SESSION });
    });
});
