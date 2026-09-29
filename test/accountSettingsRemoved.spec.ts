/**
 * Settings › General offers no "Login Method" (`forceLoginMethod`) and no
 * "API Key Helper" (`apiKeyHelper`) (the user's decision, 2026-09-29). Both
 * are account authentication, which is out of scope (CLAUDE.md): Forge
 * authenticates to its endpoints itself, with the key in the OS keychain.
 *
 * The host refuses them too. The page is untrusted input (B3), and
 * `apiKeyHelper` names a command the CLI runs, so a page that could still write
 * it could make the CLI run anything.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { handleResetSetting, handleUpdateSetting } from '../src/services/claude/handlers/handlers';
import { SETTINGS_PAGE_KEYS } from '../src/services/claude/settingsPageWrites';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

const REMOVED = [
  { key: 'forceLoginMethod', label: 'Login Method', value: 'console' },
  { key: 'apiKeyHelper', label: 'API Key Helper', value: '/tmp/anything.sh' },
] as const;

const context = () => ({
  configService: { updateSetting: vi.fn(async () => {}), resetSetting: vi.fn(async () => {}) },
}) as any;

describe('account settings are not on the Settings page', () => {
  it('has neither row in any Settings tab', () => {
    const general = read('src/webview/src/components/settings/tabs/SettingsTabGeneral.vue');
    for (const { key, label } of REMOVED) {
      expect(general).not.toMatch(new RegExp(`setting-key="${key}"`));
      expect(general).not.toContain(`label="${label}"`);
    }
    expect(general).not.toContain('loginMethodOptions');
  });

  it('keeps the rest of Advanced: the updates channel', () => {
    const general = read('src/webview/src/components/settings/tabs/SettingsTabGeneral.vue');
    expect(general).toMatch(/<SettingsSection title="Advanced">[\s\S]*setting-key="autoUpdatesChannel"/);
  });

  it('is not in the host whitelist, nor in the harness stub that mirrors it', () => {
    for (const { key } of REMOVED) {
      expect(SETTINGS_PAGE_KEYS).not.toHaveProperty(key);
    }
    const stub = /const SETTINGS_PAGE_KEYS = \[([\s\S]*?)\];/.exec(read('.claude/skills/ui-parity/harness/mock-host.js'))?.[1] ?? '';
    expect(stub).not.toBe('');
    for (const { key } of REMOVED) expect(stub).not.toContain(`'${key}'`);
  });

  it.each(REMOVED.flatMap(({ key, value }) => (['global', 'shared', 'local'] as const).map((target) => [key, value, target] as const)))(
    'refuses to write %s (to %s, in the %s layer)',
    async (key, value, target) => {
      const ctx = context();
      await expect(handleUpdateSetting({ type: 'update_setting', key, value, target } as any, ctx)).rejects.toThrow(
        `The Settings page cannot change "${key}".`,
      );
      expect(ctx.configService.updateSetting).not.toHaveBeenCalled();
    },
  );

  it.each(REMOVED.map(({ key }) => [key] as const))('refuses to reset %s', async (key) => {
    const ctx = context();
    await expect(handleResetSetting({ type: 'reset_setting', key, target: 'global' } as any, ctx)).rejects.toThrow();
    expect(ctx.configService.resetSetting).not.toHaveBeenCalled();
  });
});
