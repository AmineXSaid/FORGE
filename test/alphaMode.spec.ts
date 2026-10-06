/**
 * 48b: the Alpha mode switch, in its six places.
 *
 * Host: `ClaudeAgentService.setAlphaMode` -- persist to `~/.forge.json`, cache
 * for the hooks' synchronous reads, broadcast, and close no channel. Config:
 * the key is whitelisted with its type, and lands in Forge's own file, never
 * the CLI's `~/.claude/forge.json`. Init: `alphaModeEnabled` is read back.
 * Webview: the transport patches its config, follows the broadcast, and turns
 * a `forge_guard_note` into one stream event only when the channel has one.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeAgentService } from '../src/services/claude/ClaudeAgentService';
import { handleInit } from '../src/services/claude/handlers/handlers';
import { ConfigurationService } from '../src/services/configurationService';

beforeAll(() => {
    (globalThis as any).window ??= {
        location: new URL('http://localhost/index.html'),
        history: { replaceState: () => {} },
    };
});

const req = (s: any, request: Record<string, unknown>, channelId?: string) =>
    s.processRequest({ type: 'request', requestId: 'r1', channelId, request }, undefined as any);

function hostFor(channels = ['ch1', 'ch2']) {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() };
    const updateExtensionConfig = vi.fn(async () => {});
    const getExtensionConfig = vi.fn(async () => ({ alphaMode: true }));
    const postMessage = vi.fn();
    const s = new (ClaudeAgentService as any)(
        log,
        { updateExtensionConfig, getExtensionConfig },
        {}, {}, {}, {}, {}, {}, {},
        { postMessage }
    );
    s.channels = new Map(channels.map((id) => [id, { query: { applyFlagSettings: vi.fn() } }]));
    const closeChannel = vi.spyOn(s, 'closeChannel').mockImplementation(() => {});
    return { s, updateExtensionConfig, getExtensionConfig, postMessage, closeChannel };
}

describe('set_alpha_mode (host)', () => {
    it('persists, updates the cache, broadcasts, and closes no channel', async () => {
        const { s, updateExtensionConfig, postMessage, closeChannel } = hostFor();
        expect(s.isAlphaMode()).toBe(false);
        expect(await req(s, { type: 'set_alpha_mode', enabled: true })).toEqual({ type: 'set_alpha_mode_response' });
        expect(updateExtensionConfig).toHaveBeenCalledWith('alphaMode', true);
        expect(s.isAlphaMode()).toBe(true);
        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage.mock.calls[0][0]).toMatchObject({
            type: 'request',
            request: { type: 'extension_config_changed', key: 'alphaMode', value: true },
        });
        expect(closeChannel).not.toHaveBeenCalled();
        expect(s.channels.size).toBe(2);
        await req(s, { type: 'set_alpha_mode', enabled: false });
        expect(s.isAlphaMode()).toBe(false);
    });

    it('refuses anything but a boolean, before writing (B3)', async () => {
        for (const enabled of [undefined, null, 'true', 1, 0, {}, []]) {
            const { s, updateExtensionConfig, postMessage } = hostFor(['ch1']);
            await expect(req(s, { type: 'set_alpha_mode', enabled })).rejects.toThrow('set_alpha_mode: enabled must be a boolean');
            expect(updateExtensionConfig).not.toHaveBeenCalled();
            expect(postMessage).not.toHaveBeenCalled();
            expect(s.isAlphaMode()).toBe(false);
        }
        const { s } = hostFor(['ch1']);
        await expect(req(s, { type: 'set_alpha_mode' })).rejects.toThrow();
    });

    it('loads the persisted value at startup', async () => {
        const { s, getExtensionConfig } = hostFor([]);
        await s.loadAlphaMode();
        expect(getExtensionConfig).toHaveBeenCalled();
        expect(s.isAlphaMode()).toBe(true);
    });
});

describe('~/.forge.json, never the CLI settings', () => {
    let home: string;
    let saved: Record<string, string | undefined>;
    beforeEach(() => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-alpha-'));
        saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
        process.env.HOME = home;
        process.env.USERPROFILE = home;
    });
    afterEach(() => {
        process.env.HOME = saved.HOME;
        process.env.USERPROFILE = saved.USERPROFILE;
        fs.rmSync(home, { recursive: true, force: true });
    });
    const fileSystem = {
        pathExists: async (p: string) => fs.existsSync(p),
        readFile: async (uri: { fsPath: string }) => new Uint8Array(fs.readFileSync(uri.fsPath)),
        readDirectory: async () => [],
        createDirectory: async (uri: { fsPath: string }) => { fs.mkdirSync(uri.fsPath, { recursive: true }); },
        writeFile: async (uri: { fsPath: string }, data: Uint8Array) => fs.writeFileSync(uri.fsPath, data),
    } as any;

    it('set -> ~/.forge.json -> read back at init; the CLI flag layer never sees it', async () => {
        const config = new ConfigurationService(fileSystem);
        await (config as any)._ready;
        await config.updateExtensionConfig('alphaMode', true);
        expect(JSON.parse(fs.readFileSync(path.join(home, '.forge.json'), 'utf8')).alphaMode).toBe(true);
        expect((await config.getExtensionConfig()).alphaMode).toBe(true);
        const cliFlags = path.join(home, '.claude', 'forge.json');
        if (fs.existsSync(cliFlags)) expect(fs.readFileSync(cliFlags, 'utf8')).not.toMatch(/alphaMode/);
        const settings = path.join(home, '.claude', 'settings.json');
        if (fs.existsSync(settings)) expect(fs.readFileSync(settings, 'utf8')).not.toMatch(/alphaMode/);

        const init = await handleInit({ type: 'init' } as any, {
            logService: { info: () => {}, warn: () => {}, error: () => {}, trace: () => {} },
            configService: config,
            workspaceService: { getDefaultWorkspaceFolder: () => ({ uri: { fsPath: home } }) },
            sdkService: { getThinkingLevel: () => 'default_on', getAllowDangerouslySkipPermissions: () => false, isBrowserIntegrationSupported: () => false },
            agentService: { sendSessionStates: () => {} },
            endpointService: { listProfiles: () => ({ profiles: [] }), resolveActiveProfile: () => undefined },
        } as any);
        expect(init.state.alphaModeEnabled).toBe(true);
    });

    it('rejects a wrong type and an unknown key', async () => {
        const config = new ConfigurationService(fileSystem);
        await (config as any)._ready;
        await expect(config.updateExtensionConfig('alphaMode', 'true' as any)).rejects.toThrow();
        await expect(config.updateExtensionConfig('alphaMod' as any, true as any)).rejects.toThrow();
    });
});
