/**
 * Four requests that answered without doing anything (production audit,
 * 2026-09-24), now wired the way the official host does them:
 *
 * - `rename_tab` retitles the editor tab the chat is in (`panelTab.title=GX(title)`);
 * - `get_mcp_servers` answers from the channel CLI's `mcpServerStatus()`;
 * - `get_asset_uris` resolves the mark under the extension, not `process.cwd()`;
 * - `openNewInTab` is `!!panelTab`: true for a chat in an editor tab.
 *
 * And the two requests that follow from `openNewInTab`: `new_conversation_tab`
 * opens a tab, and the "/" row reaches it only where the official does.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  MAX_TAB_TITLE_LENGTH,
  handleGetAssetUris,
  handleGetMcpServers,
  handleInit,
  handleNewConversationTab,
  handleRenameTab,
  isEditorTabChat,
} from '../src/services/claude/handlers/handlers';
import { WebViewService } from '../src/services/webViewService';
import { OFFICIAL_DIR, readOfficial } from './helpers/officialBundle';

const log = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), show: vi.fn() });
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

afterEach(() => vi.restoreAllMocks());

describe('rename_tab', () => {
  const context = () => ({ webViewService: { renamePanel: vi.fn(() => true) } }) as any;

  it('retitles the panel of the webview that asked', async () => {
    const ctx = context();
    expect(await handleRenameTab({ type: 'rename_tab', title: 'Fix the login bug' }, ctx, 'editor:chat:chat-1')).toEqual({
      type: 'rename_tab_response',
    });
    expect(ctx.webViewService.renamePanel).toHaveBeenCalledWith('editor:chat:chat-1', 'Fix the login bug');
  });

  it('keeps the first 200 code points, as the official GX does', async () => {
    const ctx = context();
    const long = '😀'.repeat(250);
    await handleRenameTab({ type: 'rename_tab', title: long }, ctx, 'editor:chat:chat-1');
    const title = ctx.webViewService.renamePanel.mock.calls[0][1] as string;
    expect([...title]).toHaveLength(MAX_TAB_TITLE_LENGTH);
    expect(MAX_TAB_TITLE_LENGTH).toBe(200);
  });

  it.each([42, null, undefined, { toString: () => 'x' }])('ignores a title that is not a string (%j)', async (title) => {
    const ctx = context();
    expect(await handleRenameTab({ type: 'rename_tab', title } as any, ctx, 'editor:chat:chat-1')).toEqual({ type: 'rename_tab_response' });
    expect(ctx.webViewService.renamePanel).not.toHaveBeenCalled();
  });

  it('does nothing without a webview to rename', async () => {
    const ctx = context();
    await handleRenameTab({ type: 'rename_tab', title: 'x' }, ctx, undefined);
    expect(ctx.webViewService.renamePanel).not.toHaveBeenCalled();
  });

  it('WebViewService renames only the panel with that id', () => {
    const svc = new (WebViewService as any)({ subscriptions: [] }, log());
    const panel = { webview: {}, title: 'Forge' };
    svc.editorPanels.set('chat-1', panel);
    svc.webviewConfigs.set(panel.webview, { host: 'editor', page: 'chat', id: 'chat-1' });

    expect(svc.renamePanel('editor:chat:chat-2', 'no')).toBe(false);
    expect(panel.title).toBe('Forge');
    expect(svc.renamePanel('editor:chat:chat-1', 'Fix the login bug')).toBe(true);
    expect(panel.title).toBe('Fix the login bug');
  });

  it.skipIf(!OFFICIAL_DIR)('is the official handler', () => {
    const host = readOfficial('extension.js');
    expect(host).toContain('else if($.request.type==="rename_tab"){if(this.panelTab&&typeof $.request.title==="string")this.panelTab.title=GX($.request.title)');
    expect(host).toContain('function GX($){return Ix($,ls$)}');
    expect(host).toMatch(/ls\$=200\b/);
  });
});

describe('get_mcp_servers', () => {
  const statuses = [
    { name: 'github', status: 'connected' },
    { name: 'claude-vscode', status: 'connected' },
    { name: 'broken', status: 'failed', error: 'spawn ENOENT' },
  ];

  it("answers the channel CLI's statuses, minus the official's own server", async () => {
    const mcpServerStatusFor = vi.fn(() => async () => statuses);
    const response = await handleGetMcpServers({ type: 'get_mcp_servers' }, { agentService: { mcpServerStatusFor }, logService: log() } as any, 'c1');
    expect(mcpServerStatusFor).toHaveBeenCalledWith('c1');
    expect(response).toEqual({
      type: 'get_mcp_servers_response',
      mcpServers: [statuses[0], statuses[2]],
    });
  });

  it('answers an error field when the CLI cannot answer', async () => {
    const context = { agentService: { mcpServerStatusFor: () => async () => { throw new Error('CLI gone'); } }, logService: log() } as any;
    expect(await handleGetMcpServers({ type: 'get_mcp_servers' }, context, 'c1')).toEqual({
      type: 'get_mcp_servers_response',
      error: 'CLI gone',
    });
    expect(context.logService.error).toHaveBeenCalled();
  });

  it('refuses a request with no channel, or a channel that does not exist', async () => {
    const context = {
      agentService: { mcpServerStatusFor: (id: string) => { throw new Error(`Channel not found: ${id}`); } },
      logService: log(),
    } as any;
    await expect(handleGetMcpServers({ type: 'get_mcp_servers' }, context, undefined)).rejects.toThrow(/a channel is required/);
    await expect(handleGetMcpServers({ type: 'get_mcp_servers' }, context, 'nope')).rejects.toThrow('Channel not found: nope');
  });

  it.skipIf(!OFFICIAL_DIR)('is the official handler', () => {
    expect(readOfficial('extension.js')).toContain(
      'mcpServers:(await Q.query.mcpServerStatus()).filter((J)=>J.name!=="claude-vscode")}}catch(X){return this.logger.error("Failed to get MCP server status",String(X)),{type:"get_mcp_servers_response",error:X instanceof Error&&X.message||String(X)}}',
    );
  });
});

describe('get_asset_uris', () => {
  it('resolves the mark under the extension folder, not the process cwd', async () => {
    const asWebviewUri = vi.fn((uri: vscode.Uri) => ({ toString: () => `webview:${uri.fsPath}` }));
    const context = {
      webViewService: { getWebView: () => ({ asWebviewUri }) },
      sdkService: { asAbsolutePath: (p: string) => join('/ext/forge', p) },
    } as any;

    const response = await handleGetAssetUris({ type: 'get_asset_uris' }, context);

    const expected = `webview:${join('/ext/forge', '.', 'resources', 'forge-logo-brand.svg')}`;
    expect(response).toEqual({ type: 'asset_uris_response', assetUris: { forge: { light: expected, dark: expected } } });
    expect(expected.startsWith(`webview:${process.cwd()}`)).toBe(false);
  });

  it('answers nothing when no webview is up', async () => {
    const response = await handleGetAssetUris({ type: 'get_asset_uris' }, { webViewService: { getWebView: () => undefined } } as any);
    expect(response.assetUris).toEqual({});
  });
});

describe('openNewInTab', () => {
  it('is true for a chat in an editor tab, and only there', () => {
    expect(isEditorTabChat('editor:chat:chat-1')).toBe(true);
    expect(isEditorTabChat('editor:chat:chat-last')).toBe(true);
    expect(isEditorTabChat('sidebar:chat:forge.chatView')).toBe(false);
    expect(isEditorTabChat('editor:settings:settings')).toBe(false);
    expect(isEditorTabChat(undefined)).toBe(false);
  });

  it('init answers it for the webview that asked', async () => {
    const context = {
      logService: log(),
      agentService: { sendSessionStates: vi.fn() },
      configService: { getExtensionConfig: async () => ({ defaultPermissionMode: 'default', focusView: false }) },
      workspaceService: { getDefaultWorkspaceFolder: () => undefined },
      endpointService: { resolveActiveProfile: () => undefined, listProfiles: () => ({ profiles: [] }) },
      endpointHealthService: { getAllHealth: () => [] },
      sdkService: {
        getThinkingLevel: () => 'default_on',
        getAllowDangerouslySkipPermissions: () => false,
        isBrowserIntegrationSupported: () => false,
      },
    } as any;
    expect((await handleInit({ type: 'init' }, context, 'editor:chat:chat-1')).state.openNewInTab).toBe(true);
    expect((await handleInit({ type: 'init' }, context, 'sidebar:chat:forge.chatView')).state.openNewInTab).toBe(false);
  });

  it('a broadcast update_state keeps the webview\'s own value', () => {
    expect(read('src/webview/src/transport/BaseTransport.ts')).toMatch(/openNewInTab: this\.config\(\)\?\.openNewInTab \?\? false,/);
  });

  it.skipIf(!OFFICIAL_DIR)('is !!panelTab in the official host', () => {
    const host = readOfficial('extension.js');
    // `class r8 extends kD` passes `!!Z` (Z = the panel) as kD's `openNewInTab`.
    expect(host).toMatch(/class kD\{cwd;logger;settings;openNewInTab;/);
    expect(host).toContain('super(Q,QX(Y),X,!!Z,');
    expect(host).toContain('this.panelTab=Z;');
  });
});

describe('new_conversation_tab', () => {
  it('opens a new chat tab, as the official editor.open does', async () => {
    const executeCommand = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    expect(await handleNewConversationTab({ type: 'new_conversation_tab' }, {} as any)).toEqual({ type: 'new_conversation_tab_response' });
    expect(executeCommand).toHaveBeenCalledWith('forge.editor.open');
  });

  it('the "/" row and the header button reach it only through openNewInTab', () => {
    const buttons = read('src/webview/src/components/ButtonArea.vue');
    expect(buttons).toMatch(/case 'new-conversation': return emit\('newConversation'\)/);
    expect(buttons).not.toMatch(/transport\.startNewConversationTab/);
    const page = read('src/webview/src/pages/ChatPage.vue');
    expect(page).toMatch(/@clear-conversation="clearConversation"/);
    expect(page).toMatch(/@new-conversation="createNew"/);
    expect(page).toMatch(/async function createNew\(\): Promise<void> \{\s*if \(!runtime\) return;\s*if \(runtime\.appContext\.startNewConversationTab\(\)\) \{\s*return;\s*\}\s*await clearConversation\(\);/);
  });

  it.skipIf(!OFFICIAL_DIR)('matches the official rows', () => {
    const bundle = readOfficial('webview/index.js');
    expect(bundle).toContain('registerAction({id:"clear-conversation",label:"Clear conversation",description:"Start a new conversation"},"Context",()=>{$.createSession()})');
    expect(bundle).toContain('registerAction({id:"new-conversation",label:"New conversation",description:"Open a new conversation in a new tab",filterOnly:!0},"Context",()=>{if(!J.startNewConversationTab())$.createSession()})');
  });
});
