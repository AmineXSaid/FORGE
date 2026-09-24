/**
 * B3: the webview is untrusted input. Requests found in the production audit
 * (2026-09-24) that took commands, paths, keys or schemes straight from it.
 *
 * - `exec` ran any command the webview named. Nothing in the UI sent it; it is
 *   gone from the protocol entirely.
 * - `open_url` handed any scheme to `openExternal` (`file:`, `command:`, ...).
 * - `get_session_request` read a `sessionId` ending in `.jsonl` as a raw path.
 * - `update_setting` / `reset_setting` wrote any key with any value.
 * - `sdk_probe` let the webview choose how long a CLI stays alive.
 *
 * Profile names and extension-config keys are covered in settingsSafety.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import * as handlers from '../src/services/claude/handlers/handlers';
import {
  clampProbeTimeout,
  handleGetSession,
  handleOpenURL,
  handleResetSetting,
  handleSdkProbe,
  handleUpdateSetting,
  isOpenableUrl,
} from '../src/services/claude/handlers/handlers';
import { SETTINGS_PAGE_KEYS } from '../src/services/claude/settingsPageWrites';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('exec is gone', () => {
  it('has no handler, no dispatcher case, no transport method and no message type', () => {
    expect((handlers as Record<string, unknown>).handleExec).toBeUndefined();
    expect(read('src/services/claude/ClaudeAgentService.ts')).not.toMatch(/case\s+"exec"/);
    expect(read('src/webview/src/transport/BaseTransport.ts')).not.toMatch(/type:\s*"exec"/);
    expect(read('src/shared/messages.ts')).not.toMatch(/type:\s*"exec"/);
  });
});

describe('open_url', () => {
  it.each(['https://docs.anthropic.com', 'http://localhost:3000/x', 'mailto:someone@example.com'])(
    'opens %s',
    async (url) => {
      const open = vi.spyOn(vscode.env, 'openExternal').mockResolvedValue(true);
      await handleOpenURL({ type: 'open_url', url }, {} as any);
      expect(open).toHaveBeenCalledTimes(1);
      open.mockRestore();
    },
  );

  it.each([
    'file:///C:/Windows/System32/calc.exe',
    'command:workbench.action.terminal.new',
    'vscode://settings',
    'javascript:alert(1)',
    'C:\\Windows\\notepad.exe',
    '',
    'not a url',
  ])('refuses %j without touching the OS', async (url) => {
    const open = vi.spyOn(vscode.env, 'openExternal').mockResolvedValue(true);
    await expect(handleOpenURL({ type: 'open_url', url }, {} as any)).rejects.toThrow(/http, https and mailto/);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('refuses a non-string', () => {
    expect(isOpenableUrl(42)).toBe(false);
    expect(isOpenableUrl(undefined)).toBe(false);
  });
});

describe('get_session_request', () => {
  const context = () => ({
    logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    workspaceService: { getDefaultWorkspaceFolder: () => undefined },
    sessionService: { getSession: vi.fn(async () => [{ type: 'user' }]) },
  }) as any;

  it.each([
    'C:\\Users\\someone\\secrets.jsonl',
    '../../other-project/abc.jsonl',
    '/etc/passwd',
    '',
    'abc',
    '12345678-1234-1234-1234-1234567890ab/../x',
  ])('refuses %j before it reaches the disk', async (sessionId) => {
    const ctx = context();
    await expect(handleGetSession({ type: 'get_session_request', sessionId } as any, ctx)).rejects.toThrow(/not a session id/);
    expect(ctx.sessionService.getSession).not.toHaveBeenCalled();
  });

  it('reads a real session id', async () => {
    const ctx = context();
    const response = await handleGetSession(
      { type: 'get_session_request', sessionId: '3f2c8a10-5b7e-4d21-9a0c-1e2f3a4b5c6d' } as any,
      ctx,
    );
    expect(ctx.sessionService.getSession).toHaveBeenCalledWith('3f2c8a10-5b7e-4d21-9a0c-1e2f3a4b5c6d', expect.any(String));
    expect(response.messages).toHaveLength(1);
  });
});

describe('sdk_probe timeout', () => {
  it.each([
    [undefined, 10_000],
    [NaN, 10_000],
    ['5000', 10_000],
    [0, 1_000],
    [-5, 1_000],
    [30_000, 30_000],
    [10 * 60_000, 60_000],
    [Infinity, 10_000],
  ])('%j becomes %j ms', (input, expected) => {
    expect(clampProbeTimeout(input)).toBe(expected);
  });

  it('passes the bounded value to the probe', async () => {
    const probe = vi.fn(async () => ({ data: {}, errors: {} }));
    await handleSdkProbe({ type: 'sdk_probe', capabilities: [], timeoutMs: 3_600_000 } as any, {
      sdkService: { probe },
      workspaceService: { getDefaultWorkspaceFolder: () => undefined },
      endpointService: { listProfiles: () => ({ profiles: [] }) },
      logService: { info: vi.fn() },
    } as any);
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 60_000 }));
  });
});

describe('update_setting / reset_setting', () => {
  const context = () => ({
    configService: { updateSetting: vi.fn(async () => {}), resetSetting: vi.fn(async () => {}) },
  }) as any;

  it('writes a key the Settings page owns, with its type', async () => {
    const ctx = context();
    await handleUpdateSetting({ type: 'update_setting', key: 'cleanupPeriodDays', value: 30, target: 'global' }, ctx);
    await handleUpdateSetting({ type: 'update_setting', key: 'effortLevel', value: 'high', target: 'local' }, ctx);
    await handleUpdateSetting({ type: 'update_setting', key: 'env', value: { A: '1' } } as any, ctx);
    expect(ctx.configService.updateSetting).toHaveBeenCalledTimes(3);
    expect(ctx.configService.updateSetting).toHaveBeenLastCalledWith('env', { A: '1' }, 'global');
  });

  it.each([
    ['an unknown key', '__proto__', {}, 'global'],
    ['an unknown key', 'model', 'opus', 'global'],
    ['an unknown key', 'mcpServers', {}, 'global'],
    ['a wrong type', 'cleanupPeriodDays', '30', 'global'],
    ['a fraction for an integer', 'cleanupPeriodDays', 1.5, 'global'],
    ['a value outside the enum', 'effortLevel', 'max', 'global'],
    ['an array for an object', 'env', [], 'global'],
    ['null', 'hooks', null, 'global'],
    ['an unknown layer', 'language', 'en', 'policy'],
  ])('refuses %s (%s)', async (_what, key, value, target) => {
    const ctx = context();
    await expect(
      handleUpdateSetting({ type: 'update_setting', key, value, target } as any, ctx),
    ).rejects.toThrow();
    expect(ctx.configService.updateSetting).not.toHaveBeenCalled();
  });

  it('resets only a key the page owns, in a real layer', async () => {
    const ctx = context();
    await handleResetSetting({ type: 'reset_setting', key: 'hooks', target: 'shared' }, ctx);
    expect(ctx.configService.resetSetting).toHaveBeenCalledWith('hooks', 'shared');

    await expect(handleResetSetting({ type: 'reset_setting', key: 'apiKey', target: 'global' } as any, ctx)).rejects.toThrow();
    await expect(handleResetSetting({ type: 'reset_setting', key: 'hooks', target: '../x' } as any, ctx)).rejects.toThrow();
    expect(ctx.configService.resetSetting).toHaveBeenCalledTimes(1);
  });

  it('owns exactly the keys the Settings page writes', () => {
    // If a tab starts writing a new key, it must be added to the whitelist
    // (and this list) on purpose, not by accident.
    const src = (p: string) => read(p);
    const tabs = [
      'src/webview/src/components/settings/tabs/SettingsTabGeneral.vue',
      'src/webview/src/components/settings/tabs/SettingsTabEnvironments.vue',
      'src/webview/src/components/settings/tabs/SettingsTabHooks.vue',
      'src/webview/src/components/settings/tabs/SettingsTabMCPServers.vue',
    ].map(src).join('\n');
    for (const [, key] of tabs.matchAll(/(?:updateSetting|resetSetting)\(\s*'([A-Za-z0-9_]+)'/g)) {
      expect(SETTINGS_PAGE_KEYS, key).toHaveProperty(key);
    }
  });
});
