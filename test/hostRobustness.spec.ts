/**
 * The host settles what it starts: no promise left hanging, none left
 * rejecting with nobody listening.
 *
 * Production audit (2026-09-24):
 * - a permission prompt whose panel closed was never answered, so the CLI's
 *   turn waited forever;
 * - `reveal_chat`'s side-bar close was only awaited after the reveal, so a
 *   reveal that failed left it rejecting unobserved;
 * - the webview message loop, the stall notice and each channel's output loop
 *   were started without a catch;
 * - an unhandled rejection from Forge's own code reached only the extension
 *   host's log.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ClaudeAgentService, WebviewGoneError } from '../src/services/claude/ClaudeAgentService';
import { WebViewService } from '../src/services/webViewService';
import { handleRevealChat } from '../src/services/claude/handlers/handlers';
import { describeRejection, isFromExtension, watchUnhandledRejections } from '../src/services/unhandledRejections';

const log = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), show: vi.fn() });

describe('a permission prompt whose panel closes', () => {
  function service() {
    let fire: ((id: string) => void) | undefined;
    const webViewService = {
      onDidDisposeWebview: (listener: (id: string) => void) => { fire = listener; return { dispose: () => { fire = undefined; } }; },
      postMessage: vi.fn(),
    };
    const sdkService = { getAllowDangerouslySkipPermissions: () => false };
    const endpointHealthService = { onDidChangeHealth: () => ({ dispose() {} }) };
    const s = new (ClaudeAgentService as any)(
      log(), {}, { getDefaultWorkspaceFolder: () => undefined }, {}, {}, {}, {}, sdkService, {}, webViewService, {}, endpointHealthService,
    );
    const sent: any[] = [];
    s.transport = { send: (m: any) => sent.push(m) };
    // The owner map `launch_claude` fills from the webview id.
    s.channelOwners.set('c1', 'editor:chat:tab-1');
    s.channelOwners.set('c2', 'sidebar:chat:forge.chatView');
    // Only the subscription part of start(): no message loop, no watchers.
    s.disposables.push(webViewService.onDidDisposeWebview((id: string) => s.settleRequestsOf(id)));
    return { s, sent, dispose: (id: string) => fire?.(id) };
  }

  it('is answered with a denial, so the CLI turn moves on', async () => {
    const { s, sent, dispose } = service();
    const answer = s.requestToolPermission('c1', 'Bash', { command: 'ls' }, []);
    expect(sent).toHaveLength(1);
    expect(sent[0].request.type).toBe('tool_permission_request');

    dispose('editor:chat:tab-1');

    await expect(answer).resolves.toEqual({ behavior: 'deny', message: new WebviewGoneError().message });
    expect(s.outstandingRequests.size).toBe(0);
  });

  it("leaves another panel's prompt waiting for its own answer", async () => {
    const { s, sent, dispose } = service();
    const other = s.requestToolPermission('c2', 'Bash', { command: 'ls' }, []);
    dispose('editor:chat:tab-1');
    expect(s.outstandingRequests.size).toBe(1);

    s.handleResponse({ type: 'response', requestId: sent[0].requestId, response: { type: 'tool_permission_response', result: { behavior: 'allow', updatedInput: {} } } });
    await expect(other).resolves.toMatchObject({ behavior: 'allow' });
  });

  it('still reports a real failure as a failure', async () => {
    const { s, sent } = service();
    const answer = s.requestToolPermission('c1', 'Bash', {}, []);
    s.handleResponse({ type: 'response', requestId: sent[0].requestId, response: { type: 'error', error: 'boom' } });
    await expect(answer).rejects.toThrow('boom');
  });
});

describe('WebViewService.onDidDisposeWebview', () => {
  function withWebview(id: string) {
    const svc = new (WebViewService as any)({ subscriptions: [] }, log());
    const webview = {};
    const config = { host: 'editor', page: 'chat', id };
    svc.webviews.add(webview);
    svc.webviewConfigs.set(webview, config);
    svc.webviewIdMap.set(svc.getWebviewId(config), webview);
    return { svc, webview, config };
  }

  it('fires with the routing id when a webview goes away', () => {
    const { svc, webview } = withWebview('tab-1');
    const seen: string[] = [];
    svc.onDidDisposeWebview((id: string) => seen.push(id));
    svc.removeWebview(webview);
    expect(seen).toEqual(['editor:chat:tab-1']);
  });

  it('does not fire when a replacement already holds the id', () => {
    const { svc, webview, config } = withWebview('tab-1');
    const replacement = {};
    svc.webviewIdMap.set(svc.getWebviewId(config), replacement);
    const seen: string[] = [];
    svc.onDidDisposeWebview((id: string) => seen.push(id));
    svc.removeWebview(webview);
    expect(seen).toEqual([]);
  });

  it('stops after the listener is disposed, and survives a listener that throws', () => {
    const { svc, webview } = withWebview('tab-1');
    const later = vi.fn();
    svc.onDidDisposeWebview(() => { throw new Error('bad listener'); });
    const sub = svc.onDidDisposeWebview(later);
    sub.dispose();
    expect(() => svc.removeWebview(webview)).not.toThrow();
    expect(later).not.toHaveBeenCalled();
  });
});

describe('reveal_chat', () => {
  afterEach(() => vi.restoreAllMocks());

  it('observes the side-bar close even when the reveal fails', async () => {
    // With the chat in the secondary side bar, `closing` starts before the
    // reveal is awaited. Both fail here; vitest fails the run on any
    // unhandled rejection, so reaching the end is the assertion.
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get: () => 'secondary' } as any);
    vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async (id: string) => {
      throw new Error(`${id} failed`);
    });
    const context = { logService: log(), agentService: { notifyClient: vi.fn() } } as any;

    await expect(handleRevealChat({ type: 'reveal_chat', fromView: true } as any, context)).rejects.toThrow('forge.sidebar.open failed');
    await new Promise((r) => setTimeout(r, 80));
    expect(context.logService.warn).toHaveBeenCalledWith(expect.stringMatching(/could not close the side bar/));
  });
});

describe('the loops the host starts are caught', () => {
  const source = readFileSync(join(__dirname, '../src/services/claude/ClaudeAgentService.ts'), 'utf8');

  it('the webview message loop', () => {
    expect(source).toMatch(/this\.readFromClient\(\)\.catch\(/);
  });

  it('the stall notice', () => {
    expect(source).toMatch(/this\.onChannelStalled\(report\)\.catch\(/);
    expect(source).not.toMatch(/void this\.onChannelStalled\(report\)/);
  });

  it("each channel's output loop", () => {
    expect(source).toMatch(/\}\)\(\)\.catch\(\(error\) => \{\s*\/\/ Only a failure inside the handlers above/);
  });
});

describe('unhandled rejections from Forge reach its output channel', () => {
  const EXT = 'C:\\Users\\me\\.vscode\\extensions\\msaid.forge-0.1.0';

  it("recognises Forge's own stack, whatever the slashes and case", () => {
    const error = new Error('x');
    error.stack = 'Error: x\n    at run (c:/users/me/.vscode/extensions/msaid.forge-0.1.0/dist/extension.cjs:1:2)';
    expect(isFromExtension(error, EXT)).toBe(true);
  });

  it("ignores another extension's, and anything without a stack", () => {
    const error = new Error('x');
    error.stack = 'Error: x\n    at run (C:\\Users\\me\\.vscode\\extensions\\other.ext-1.0.0\\out\\main.js:1:2)';
    expect(isFromExtension(error, EXT)).toBe(false);
    expect(isFromExtension('a string', EXT)).toBe(false);
    expect(isFromExtension(new Error('x'), '')).toBe(false);
  });

  it('logs only Forge rejections, and stops when disposed', () => {
    const listeners = new Set<(reason: unknown) => void>();
    const target = { on: (_: string, l: any) => listeners.add(l), off: (_: string, l: any) => listeners.delete(l) };
    const lines: string[] = [];
    const watch = watchUnhandledRejections(EXT, (m) => lines.push(m), target as any);

    const ours = new Error('ours');
    ours.stack = `Error: ours\n    at ${EXT}\\dist\\extension.cjs:1:1`;
    for (const l of listeners) { l(ours); l(new Error('theirs')); }
    expect(lines).toEqual([`Unhandled promise rejection: ${ours.stack}`]);

    watch.dispose();
    expect(listeners.size).toBe(0);
  });

  it('describes a non-Error reason', () => {
    expect(describeRejection({ code: 1 })).toBe('{"code":1}');
    expect(describeRejection('text')).toBe('text');
    const circular: any = {};
    circular.self = circular;
    expect(describeRejection(circular)).toBe('[object Object]');
  });

  it('is installed at activation', () => {
    const extension = readFileSync(join(__dirname, '../src/extension.ts'), 'utf8');
    expect(extension).toMatch(/context\.subscriptions\.push\(\s*watchUnhandledRejections\(context\.extensionPath/);
  });
});
