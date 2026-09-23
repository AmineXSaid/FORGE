/**
 * "Bypass permissions" in the mode menu (2026-09-23).
 *
 * Reported: the row could not be selected. The official offers it only once
 * `claudeCode.allowDangerouslySkipPermissions` is on; Forge had no such setting
 * (only a hidden `forge.cliArgs` flag), never passed the SDK's
 * `allowDangerouslySkipPermissions` option at launch (sdk.d.ts:1894), and did
 * not port the official launch downgrade -- so the CLI refused the switch and
 * the menu snapped back.
 *
 * Now: the official setting (`forge.allowDangerouslySkipPermissions`), the
 * official launch downgrade, and a Forge-only `enable_bypass_permissions` the
 * menu sends when the setting is off, which writes it only after a modal "yes".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ALLOW_BYPASS_ACTION, handleEnableBypassPermissions } from '../src/services/claude/handlers/handlers';
import { ClaudeAgentService } from '../src/services/claude/ClaudeAgentService';

const originalGetConfiguration = vscode.workspace.getConfiguration;
let updates: Array<[string, unknown, unknown]>;
let warn: ReturnType<typeof vi.spyOn>;

function context(options: { allowed?: boolean; policy?: 'disable' } = {}) {
  return {
    logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    sdkService: { getAllowDangerouslySkipPermissions: () => options.allowed === true },
    agentService: {
      getCachedClaudeSettings: () =>
        options.policy ? { effective: { permissions: { disableBypassPermissionsMode: options.policy } } } : undefined,
    },
  } as any;
}

beforeEach(() => {
  updates = [];
  (vscode.workspace as any).getConfiguration = () => ({
    get: (_k: string, fallback?: unknown) => fallback,
    update: (key: string, value: unknown, target: unknown) => {
      updates.push([key, value, target]);
      return Promise.resolve();
    },
  });
});

afterEach(() => {
  (vscode.workspace as any).getConfiguration = originalGetConfiguration;
  warn?.mockRestore();
});

describe('enable_bypass_permissions', () => {
  it('writes the setting only after the modal`s explicit yes, in the user`s settings', async () => {
    warn = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(ALLOW_BYPASS_ACTION as never);
    expect(await handleEnableBypassPermissions({ type: 'enable_bypass_permissions' }, context())).toEqual({
      type: 'enable_bypass_permissions_response',
      enabled: true,
    });
    // Modal, with the official setting's warning.
    expect(warn.mock.calls[0][1]).toMatchObject({ modal: true });
    expect(String((warn.mock.calls[0][1] as any).detail)).toContain('sandboxes with no internet access');
    // Machine scope, as the official declares it: never a workspace a repository could ship.
    expect(updates).toEqual([['allowDangerouslySkipPermissions', true, vscode.ConfigurationTarget.Global]]);
  });

  it('writes nothing when the user dismisses or declines', async () => {
    warn = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined as never);
    expect((await handleEnableBypassPermissions({ type: 'enable_bypass_permissions' }, context())).enabled).toBe(false);
    expect(updates).toEqual([]);
  });

  it('honours a managed policy that disables bypass, without asking', async () => {
    warn = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(ALLOW_BYPASS_ACTION as never);
    expect((await handleEnableBypassPermissions({ type: 'enable_bypass_permissions' }, context({ policy: 'disable' }))).enabled).toBe(false);
    expect(warn.mock.calls.some((c) => (c[1] as any)?.modal)).toBe(false);
    expect(updates).toEqual([]);
  });

  it('answers yes at once when it is already allowed', async () => {
    warn = vi.spyOn(vscode.window, 'showWarningMessage');
    expect((await handleEnableBypassPermissions({ type: 'enable_bypass_permissions' }, context({ allowed: true }))).enabled).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });
});

describe('the official launch downgrade', () => {
  function host(allowed: boolean) {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const s = new (ClaudeAgentService as any)(
      log, {}, { getDefaultWorkspaceFolder: () => undefined }, {}, {}, {}, {},
      { getThinkingLevel: () => 'off', getAllowDangerouslySkipPermissions: () => allowed }, {}, {},
      { getStatus: () => ({}) },
      { onDidChangeHealth: () => ({ dispose() {} }) },
    );
    const sent: any[] = [];
    s.setTransport({ send: (m: any) => sent.push(m), onMessage: () => {} });
    s.getShowThinkingSummaries = async () => undefined;
    let launchedWith: string | undefined;
    s.spawnClaude = async (_in: unknown, _resume: unknown, _cb: unknown, _model: unknown, _cwd: unknown, mode: string) => {
      launchedWith = mode;
      return { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }), return() {} };
    };
    return { s, sent, launched: () => launchedWith };
  }

  it('launches bypass as default while it is off, and tells the webview', async () => {
    const { s, sent, launched } = host(false);
    await s.launchClaude('c1', null, '/repo', null, 'bypassPermissions', null);
    expect(launched()).toBe('default');
    expect(sent).toContainEqual(expect.objectContaining({
      type: 'io_message',
      channelId: 'c1',
      message: { type: 'system', subtype: 'status', permissionMode: 'default' },
    }));
  });

  it('launches bypass as bypass once it is allowed', async () => {
    const { s, launched } = host(true);
    await s.launchClaude('c2', null, '/repo', null, 'bypassPermissions', null);
    expect(launched()).toBe('bypassPermissions');
  });

  it('downgrades a mode it does not recognise, as the official does', async () => {
    const { s, launched } = host(true);
    await s.launchClaude('c3', null, '/repo', null, 'rootMode', null);
    expect(launched()).toBe('default');
  });
});

describe('the setting', () => {
  it('is declared as the official declares it', async () => {
    const pkg = JSON.parse((await import('node:fs')).readFileSync('package.json', 'utf8'));
    const props = pkg.contributes.configuration.properties ?? Object.assign({}, ...pkg.contributes.configuration.map((c: any) => c.properties));
    expect(props['forge.allowDangerouslySkipPermissions']).toEqual({
      type: 'boolean',
      default: false,
      scope: 'machine',
      description: 'Allow bypass permissions mode. Recommended only for sandboxes with no internet access.',
    });
  });
});
