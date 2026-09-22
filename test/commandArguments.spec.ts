/**
 * Commands receive the arguments they were invoked with.
 *
 * This is the test that was missing, and its absence cost three rounds. The
 * "/" menu rows kept opening Settings on **General** no matter which row was
 * clicked, and the harness kept reporting them fixed -- because the harness
 * stubs `open_forge_settings` and records the tab, and the section was being
 * dropped one layer further down, in VS Code's command plumbing:
 *
 *     vscode.commands.registerCommand(command, async (...args) => {
 *       await impls[command]();   // called with nothing
 *       void args;                // and the arguments discarded
 *     });
 *
 * `Record<ForgeCommandId, () => unknown>` hid it from the typechecker too: a
 * handler declaring `(section?: unknown)` is assignable to a zero-argument
 * signature, so nothing ever complained.
 *
 * So this test drives the layer the harness cannot reach: register the real
 * commands against the vscode mock, execute one the way `handleOpenForgeSettings`
 * does, and assert the argument arrived at the service call at the end.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { registerForgeCommands } from '../src/commands/forgeCommands';

type Registered = Map<string, (...args: unknown[]) => unknown>;

/** Everything `registerForgeCommands` pulls out of the DI container. */
function services(openEditorPage: ReturnType<typeof vi.fn>) {
  return {
    logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), show: vi.fn() },
    webViewService: { openEditorPage, createPagePanel: vi.fn(), planPreviewColumn: () => 1 },
    agentService: { notifyClient: vi.fn() },
    sdkService: {},
    hermesAgents: {},
    endpointService: { listProfiles: () => ({ profiles: [], errors: [] }), reset: vi.fn() },
  };
}

/** Register the real commands and hand back what VS Code would have. */
function register(openEditorPage: ReturnType<typeof vi.fn>): Registered {
  const registered: Registered = new Map();
  vi.spyOn(vscode.commands, 'registerCommand').mockImplementation(
    ((id: string, handler: (...args: unknown[]) => unknown) => {
      registered.set(id, handler);
      return { dispose: () => {} };
    }) as never,
  );

  const svc = services(openEditorPage);
  const instantiationService = {
    invokeFunction: (fn: (accessor: { get: (id: unknown) => unknown }) => unknown) =>
      fn({
        get: (id: any) => {
          // The DI decorators carry the service name they were created with.
          const name: string = id?.toString?.() ?? '';
          if (name.includes('logService')) return svc.logService;
          if (name.includes('webViewService')) return svc.webViewService;
          if (name.includes('claudeAgentService')) return svc.agentService;
          if (name.includes('claudeSdkService')) return svc.sdkService;
          if (name.includes('agentService')) return svc.hermesAgents;
          if (name.includes('endpointService')) return svc.endpointService;
          return {};
        },
      }),
  };

  registerForgeCommands({ subscriptions: [], secrets: { store: vi.fn() } } as any, instantiationService as any);
  return registered;
}

let openEditorPage: ReturnType<typeof vi.fn>;
let commands: Registered;

beforeEach(() => {
  vi.restoreAllMocks();
  openEditorPage = vi.fn();
  commands = register(openEditorPage);
});

describe('forge.openSettings carries its tab all the way through', () => {
  it('registers the command at all', () => {
    expect(commands.has('forge.openSettings')).toBe(true);
  });

  it.each([
    'mcp-servers',
    'hooks',
    'plugins',
    'endpoints',
    'permissions',
    'slash-commands',
  ])('executeCommand("forge.openSettings", %j) opens Settings on that tab', async (tab) => {
    await commands.get('forge.openSettings')!(tab);

    // (page, title, instanceId, options) -- the tab rides in the fourth, which
    // step 31 turned from a bare string into `{ tab }`.
    expect(openEditorPage).toHaveBeenCalledTimes(1);
    expect(openEditorPage.mock.calls[0][0]).toBe('settings');
    expect(openEditorPage.mock.calls[0][3]).toEqual({ tab });
  });

  it('opens General when invoked with nothing, the way the palette does', async () => {
    await commands.get('forge.openSettings')!();
    expect(openEditorPage.mock.calls[0][3]).toEqual({ tab: 'general' });
  });

  it.each([undefined, null, '', 42, {}, []])(
    'falls back to General for the non-tab %j rather than passing it on',
    async (bad) => {
      await commands.get('forge.openSettings')!(bad);
      expect(openEditorPage.mock.calls[0][3]).toEqual({ tab: 'general' });
    },
  );
});

describe('and the tab survives the rest of the chain', () => {
  it('reaches the bootstrap of a panel being created', async () => {
    // `getHtmlForWebview` serialises the whole bootstrap with JSON.stringify,
    // so the field only has to arrive here -- but "only has to" is what was
    // said about the command layer too.
    const { WebViewService } = await import('../src/services/webViewService');
    const panels: any[] = [];
    vi.spyOn(vscode.window as any, 'createWebviewPanel').mockImplementation((...a: any[]) => {
      const panel = {
        viewColumn: 2,
        webview: { options: {}, html: '', postMessage: vi.fn(), onDidReceiveMessage: vi.fn(), asWebviewUri: (u: any) => u },
        reveal: vi.fn(),
        onDidDispose: vi.fn(),
        iconPath: undefined,
        args: a,
      };
      panels.push(panel);
      return panel as never;
    });

    const service = new WebViewService(
      { extensionPath: '/ext', extensionMode: 1, subscriptions: [] } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    );
    service.openEditorPage('settings', 'Forge Settings', undefined, { tab: 'hooks' });

    expect(panels).toHaveLength(1);
    expect(panels[0].webview.html).toContain('"tab":"hooks"');
  });

  it('is pushed to a panel that is already open', async () => {
    const { WebViewService } = await import('../src/services/webViewService');
    const post = vi.fn();
    vi.spyOn(vscode.window as any, 'createWebviewPanel').mockImplementation(() => ({
      viewColumn: 2,
      webview: { options: {}, html: '', postMessage: post, onDidReceiveMessage: vi.fn(), asWebviewUri: (u: any) => u },
      reveal: vi.fn(),
      onDidDispose: vi.fn(),
    }) as never);

    const service = new WebViewService(
      { extensionPath: '/ext', extensionMode: 1, subscriptions: [] } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    );
    service.openEditorPage('settings', 'Forge Settings', undefined, { tab: 'hooks' });
    post.mockClear();

    // Second click, different row: the panel exists, so the tab has to travel
    // as a message -- revealing does not re-run the bootstrap. Step 31 sends it
    // as a `select_settings_tab` request rather than an ad-hoc `show_section`.
    service.openEditorPage('settings', 'Forge Settings', undefined, { tab: 'mcp-servers' });
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'request',
        request: { type: 'select_settings_tab', tab: 'mcp-servers' },
      }),
    );
  });

  it('reveals an open panel where it already is, not in the code group', async () => {
    const { WebViewService } = await import('../src/services/webViewService');
    const reveal = vi.fn();
    vi.spyOn(vscode.window as any, 'createWebviewPanel').mockImplementation(() => ({
      viewColumn: 3,
      webview: { options: {}, html: '', postMessage: vi.fn(), onDidReceiveMessage: vi.fn(), asWebviewUri: (u: any) => u },
      reveal,
      onDidDispose: vi.fn(),
    }) as never);

    const service = new WebViewService(
      { extensionPath: '/ext', extensionMode: 1, subscriptions: [] } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    );
    service.openEditorPage('settings', 'Forge Settings', undefined, { tab: 'hooks' });
    service.openEditorPage('settings', 'Forge Settings', undefined, { tab: 'hooks' });

    // `reveal(ViewColumn.Active)` would drag the panel into whatever group the
    // user is editing code in, undoing the column it was created in.
    expect(reveal).toHaveBeenCalledWith(3);
  });
});

describe('the wrapper itself', () => {
  it('forwards every argument, not just the first', async () => {
    // The defect was structural -- arguments collected and discarded -- so the
    // guard belongs on the wrapper, not on one command that happens to use one.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/commands/forgeCommands.ts', import.meta.url), 'utf8'),
    );
    expect(source).toContain('impls[command as ForgeCommandId](...args)');
    expect(source).not.toContain('void args;');
  });

  it('types the implementations as taking arguments', () => {
    // `Record<ForgeCommandId, () => unknown>` is what let the drop compile.
    const source = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', 'src/commands/forgeCommands.ts'),
      'utf8',
    ) as string;
    expect(source).toContain('Record<ForgeCommandId, (...args: unknown[]) => unknown>');
  });

  it('still reports a failing command instead of swallowing it', async () => {
    const error = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined as never);
    openEditorPage.mockImplementation(() => {
      throw new Error('boom');
    });

    await expect(commands.get('forge.openSettings')!('hooks')).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});
