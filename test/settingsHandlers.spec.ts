/**
 * The Settings page's requests, handler by handler (production audit,
 * Phase 2): what each answers, what it writes through the configuration
 * service, and what it refuses. The configuration service's own behaviour on
 * disk is settingsSafety.spec.ts; the whitelists are untrustedInput.spec.ts.
 *
 * Also here: `show_notification` and `sync_endpoint_health`, the two other
 * requests the Settings page and the welcome page send that had no spec.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  MAX_NOTIFICATION_BUTTONS,
  handleCreateProfile,
  handleDeleteProfile,
  handleGetExtensionConfig,
  handleGetSettings,
  handleShowNotification,
  handleSwitchProfile,
  handleSyncEndpointHealth,
  handleUpdateExtensionConfig,
} from '../src/services/claude/handlers/handlers';

afterEach(() => vi.restoreAllMocks());

function configService(over: Record<string, unknown> = {}) {
  return {
    activeProfile: 'work',
    hasWorkspace: true,
    getAllSettings: vi.fn(async () => ({ model: 'opus', env: { A: '1' } })),
    inspectAll: vi.fn(async () => ({
      model: { key: 'model', value: 'opus', effectiveScope: 'local', values: { local: 'opus', global: 'sonnet' } },
    })),
    getProfiles: vi.fn(async () => ['work', 'home']),
    switchProfile: vi.fn(async () => {}),
    createProfile: vi.fn(async () => {}),
    deleteProfile: vi.fn(async () => {}),
    getExtensionConfig: vi.fn(async () => ({ focusView: false, completionSound: true })),
    updateExtensionConfig: vi.fn(async () => {}),
    ...over,
  };
}

describe('get_settings', () => {
  it('answers the merged settings, each key\'s layers, the profiles and whether a folder is open', async () => {
    const config = configService();
    expect(await handleGetSettings({ type: 'get_settings' }, { configService: config } as any)).toEqual({
      type: 'get_settings_response',
      settings: { model: 'opus', env: { A: '1' } },
      metadata: { model: { effectiveScope: 'local', values: { local: 'opus', global: 'sonnet' } } },
      activeProfile: 'work',
      profiles: ['work', 'home'],
      hasWorkspace: true,
    });
  });
});

describe('switch_profile', () => {
  it('switches, and to the default with null', async () => {
    const config = configService();
    expect(await handleSwitchProfile({ type: 'switch_profile', profile: 'home' }, { configService: config } as any)).toEqual({
      type: 'switch_profile_response',
      success: true,
    });
    await handleSwitchProfile({ type: 'switch_profile', profile: null }, { configService: config } as any);
    expect(config.switchProfile.mock.calls).toEqual([['home'], [null]]);
  });

  it("passes the service's refusal on as an error (a name that is not a profile name)", async () => {
    const config = configService({ switchProfile: vi.fn(async () => { throw new Error('Invalid profile name.'); }) });
    await expect(handleSwitchProfile({ type: 'switch_profile', profile: '../x' }, { configService: config } as any)).rejects.toThrow('Invalid profile name.');
  });
});

describe.each([
  ['create_profile', handleCreateProfile, 'createProfile'],
  ['delete_profile', handleDeleteProfile, 'deleteProfile'],
] as const)('%s', (type, handler, method) => {
  it('answers success', async () => {
    const config = configService();
    expect(await (handler as any)({ type, name: 'work_2' }, { configService: config })).toEqual({ type: `${type}_response`, success: true });
    expect((config as any)[method]).toHaveBeenCalledWith('work_2');
  });

  it('answers success:false with the reason, rather than throwing, as the page expects', async () => {
    const config = configService({ [method]: vi.fn(async () => { throw new Error('Invalid profile name. Use only alphanumeric characters, underscores, and hyphens.'); }) });
    expect(await (handler as any)({ type, name: '../../x' }, { configService: config })).toEqual({
      type: `${type}_response`,
      success: false,
      error: 'Invalid profile name. Use only alphanumeric characters, underscores, and hyphens.',
    });
  });
});

describe('get_extension_config / update_extension_config', () => {
  it('answers the ~/.forge.json config', async () => {
    const config = configService();
    expect(await handleGetExtensionConfig({ type: 'get_extension_config' }, { configService: config } as any)).toEqual({
      type: 'get_extension_config_response',
      config: { focusView: false, completionSound: true },
    });
  });

  it('writes, then tells every page', async () => {
    const config = configService();
    const postMessage = vi.fn();
    const response = await handleUpdateExtensionConfig(
      { type: 'update_extension_config', key: 'completionSound', value: false },
      { configService: config, webViewService: { postMessage } } as any,
    );
    expect(response).toEqual({ type: 'update_extension_config_response', success: true });
    expect(config.updateExtensionConfig).toHaveBeenCalledWith('completionSound', false);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'request',
      request: { type: 'extension_config_changed', key: 'completionSound', value: false },
    }));
  });

  it('broadcasts nothing when the service refuses the key', async () => {
    const config = configService({ updateExtensionConfig: vi.fn(async () => { throw new Error('Unknown Forge setting: apiKey'); }) });
    const postMessage = vi.fn();
    await expect(
      handleUpdateExtensionConfig({ type: 'update_extension_config', key: 'apiKey', value: 'x' }, { configService: config, webViewService: { postMessage } } as any),
    ).rejects.toThrow('Unknown Forge setting: apiKey');
    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe('show_notification', () => {
  it.each([
    ['error', 'showErrorMessage'],
    ['warning', 'showWarningMessage'],
    ['info', 'showInformationMessage'],
    [undefined, 'showInformationMessage'],
  ] as const)('%s uses %s and answers the button chosen', async (severity, method) => {
    const show = vi.spyOn(vscode.window, method as 'showErrorMessage').mockResolvedValue('Retry' as any);
    expect(
      await handleShowNotification({ type: 'show_notification', message: 'Rewind skipped 2 links', severity: severity as any, buttons: ['Retry'] }, {} as any),
    ).toEqual({ type: 'show_notification_response', buttonValue: 'Retry' });
    expect(show).toHaveBeenCalledWith('Rewind skipped 2 links', 'Retry');
  });

  it('refuses a message that is not a string', async () => {
    const show = vi.spyOn(vscode.window, 'showInformationMessage');
    await expect(handleShowNotification({ type: 'show_notification', message: { x: 1 }, severity: 'info' } as any, {} as any)).rejects.toThrow(/message is not a string/);
    expect(show).not.toHaveBeenCalled();
  });

  it('keeps only string buttons, a few at most; a string is not a list of buttons', async () => {
    const show = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);
    await handleShowNotification({ type: 'show_notification', message: 'm', severity: 'warning', buttons: 'Yes' } as any, {} as any);
    await handleShowNotification(
      { type: 'show_notification', message: 'm', severity: 'warning', buttons: ['a', 1, 'b', null, 'c', 'd', 'e', 'f', 'g'] } as any,
      {} as any,
    );
    expect(show.mock.calls[0]).toEqual(['m']);
    expect(show.mock.calls[1]).toEqual(['m', 'a', 'b', 'c', 'd', 'e']);
    expect(show.mock.calls[1].length - 1).toBe(MAX_NOTIFICATION_BUTTONS);
  });
});

describe('sync_endpoint_health', () => {
  const health = [{ profileName: 'gw', models: [] }];
  function context() {
    return {
      logService: { info: vi.fn() },
      endpointService: { listProfiles: () => ({ profiles: [{ name: 'gw' }, { name: 'local' }] }) },
      endpointHealthService: {
        syncProfile: vi.fn(async () => {}),
        syncAll: vi.fn(async () => {}),
        cancelSync: vi.fn(),
        getAllHealth: vi.fn(() => health),
      },
    } as any;
  }

  it('sweeps every profile, then answers the stored verdicts', async () => {
    const ctx = context();
    expect(await handleSyncEndpointHealth({ type: 'sync_endpoint_health' } as any, ctx)).toEqual({ type: 'sync_endpoint_health_response', health });
    expect(ctx.endpointHealthService.syncAll).toHaveBeenCalledTimes(1);
    expect(ctx.endpointHealthService.syncProfile).not.toHaveBeenCalled();
  });

  it('sweeps one known profile', async () => {
    const ctx = context();
    await handleSyncEndpointHealth({ type: 'sync_endpoint_health', profileName: ' gw ' } as any, ctx);
    expect(ctx.endpointHealthService.syncProfile).toHaveBeenCalledWith('gw');
  });

  it('cancels, without sweeping', async () => {
    const ctx = context();
    await handleSyncEndpointHealth({ type: 'sync_endpoint_health', profileName: 'local', cancel: true } as any, ctx);
    expect(ctx.endpointHealthService.cancelSync).toHaveBeenCalledWith('local');
    expect(ctx.endpointHealthService.syncAll).not.toHaveBeenCalled();
  });

  it.each(['nope', '../gw', 'gw; rm'])('refuses a profile the host does not know (%j)', async (profileName) => {
    const ctx = context();
    await expect(handleSyncEndpointHealth({ type: 'sync_endpoint_health', profileName } as any, ctx)).rejects.toThrow(/Unknown endpoint profile/);
    expect(ctx.endpointHealthService.syncProfile).not.toHaveBeenCalled();
    expect(ctx.endpointHealthService.syncAll).not.toHaveBeenCalled();
  });

  it('answers an empty list when the health service is not up', async () => {
    expect(await handleSyncEndpointHealth({ type: 'sync_endpoint_health' } as any, { endpointService: {} } as any)).toEqual({
      type: 'sync_endpoint_health_response',
      health: [],
    });
  });
});
