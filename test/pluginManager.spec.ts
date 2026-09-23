/**
 * Settings > Plugins: the official plugin manager's requests, run through the
 * bundled CLI.
 *
 * What is worth pinning: the exact argv (fixed words, then `--`, then the one
 * value the webview supplied, as the official `WJ.positional` builds it), the
 * response shapes the official returns, and that a malformed value is refused
 * before any process starts (B3).
 */
import { describe, expect, it, vi } from 'vitest';
import {
    PluginManager,
    positional,
    toInstalledPlugin,
    validateMarketplaceSource,
    validatePluginId,
    type PluginExecFile,
} from '../src/services/claude/pluginManager';
import {
    handleInstallPlugin,
    handleListMarketplaces,
    handleListPlugins,
    handleSetPluginEnabled,
    handleUpdatePlugin,
} from '../src/services/claude/handlers/handlers';

const BINARY = { pathToClaudeCodeExecutable: 'C:/forge/claude.exe', executableArgs: [], env: { FORGE_TEST: '1' } };

type Answer = { stdout?: string; stderr?: string; code?: number; killed?: boolean };

function fakeCli(answers: Answer[] = [{ stdout: '' }]) {
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const exec: PluginExecFile = (command, args, options, callback) => {
        calls.push({ command, args, cwd: options.cwd });
        const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
        if (answer.code !== undefined || answer.killed) {
            const error = Object.assign(new Error('failed'), { code: answer.code, killed: answer.killed });
            callback(error, answer.stdout ?? '', answer.stderr ?? '');
        } else {
            callback(null, answer.stdout ?? '', answer.stderr ?? '');
        }
        return undefined;
    };
    const manager = new PluginManager(async () => BINARY, () => {}, exec);
    return { manager, calls };
}

const context = (root: string | null = 'C:/repo') =>
    ({
        logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        workspaceService: { getDefaultWorkspaceFolder: () => (root ? { uri: { fsPath: root } } : undefined) },
        sdkService: { getClaudeBinary: async () => BINARY },
    }) as any;

describe('the argv', () => {
    it('puts the value after --, as the official WJ.positional does', () => {
        expect(positional(['plugin', 'install'], ['--scope', 'user'], 'x@y')).toEqual(['plugin', 'install', '--scope', 'user', '--', 'x@y']);
    });

    it('runs each request as its own fixed subcommand, in the workspace folder', async () => {
        const { manager, calls } = fakeCli([{ stdout: 'Done' }]);
        await manager.installPlugin('formatter@acme', 'project', 'C:/repo');
        await manager.uninstallPlugin('formatter@acme', 'C:/repo');
        await manager.setPluginEnabled('formatter@acme', false, 'C:/repo');
        await manager.setPluginEnabled('formatter@acme', true, 'C:/repo');
        await manager.updatePlugin('formatter@acme', 'user', 'C:/repo');
        await manager.addMarketplace('  anthropics/claude-plugins-official ', 'C:/repo');
        await manager.removeMarketplace('acme', 'C:/repo');
        await manager.refreshMarketplace('acme', 'C:/repo');
        expect(calls.map((c) => c.args)).toEqual([
            ['plugin', 'install', '--scope', 'project', '--', 'formatter@acme'],
            ['plugin', 'uninstall', '--', 'formatter@acme'],
            ['plugin', 'disable', '--', 'formatter@acme'],
            ['plugin', 'enable', '--', 'formatter@acme'],
            ['plugin', 'update', '--scope', 'user', '--', 'formatter@acme'],
            ['plugin', 'marketplace', 'add', '--', 'anthropics/claude-plugins-official'],
            ['plugin', 'marketplace', 'remove', '--', 'acme'],
            ['plugin', 'marketplace', 'update', '--', 'acme'],
        ]);
        expect(new Set(calls.map((c) => c.command))).toEqual(new Set(['C:/forge/claude.exe']));
        expect(new Set(calls.map((c) => c.cwd))).toEqual(new Set(['C:/repo']));
    });

    it('never adds consent flags: no -y, no --accept-command', async () => {
        const { manager, calls } = fakeCli();
        await manager.installPlugin('formatter@acme', 'user', 'C:/repo');
        expect(calls[0].args).not.toContain('-y');
        expect(calls[0].args.join(' ')).not.toMatch(/accept-command|--yes/);
    });
});

describe('what is refused before a process starts (B3)', () => {
    it('refuses ids, scopes, names and sources that cannot be real', async () => {
        const { manager, calls } = fakeCli();
        for (const id of ['', '-y', '--help', 'a b', 'x@', '../x', 'x@y@z', 'x;rm', 42, undefined]) {
            await expect(manager.installPlugin(id as any, 'user', 'C:/repo')).rejects.toThrow(/Not a plugin id/);
            await expect(manager.uninstallPlugin(id as any, 'C:/repo')).rejects.toThrow(/Not a plugin id/);
        }
        for (const scope of ['managed', 'global', '', '--scope', undefined]) {
            await expect(manager.installPlugin('x@y', scope as any, 'C:/repo')).rejects.toThrow(/Not an install scope/);
        }
        await expect(manager.setPluginEnabled('x@y', 'yes' as any, 'C:/repo')).rejects.toThrow(/true or false/);
        for (const name of ['', '-x', 'a/b', 'a b']) {
            await expect(manager.removeMarketplace(name, 'C:/repo')).rejects.toThrow(/Not a marketplace name/);
            await expect(manager.refreshMarketplace(name, 'C:/repo')).rejects.toThrow(/Not a marketplace name/);
        }
        for (const source of ['', '   ', '--help', 'a\nb', 'x'.repeat(3000), 7]) {
            await expect(manager.addMarketplace(source as any, 'C:/repo')).rejects.toThrow();
        }
        expect(calls).toEqual([]);
    });

    it('accepts the ids and sources the CLI uses', () => {
        expect(validatePluginId('42crunch-api-security-testing@claude-plugins-official')).toBeTruthy();
        expect(validatePluginId('formatter')).toBe('formatter');
        expect(validateMarketplaceSource('https://github.com/acme/plugins.git')).toBe('https://github.com/acme/plugins.git');
        expect(validateMarketplaceSource('C:\\plugins\\local')).toBe('C:\\plugins\\local');
    });
});

describe('the answers, in the official shapes', () => {
    it('lists installed and available plugins (list_plugins --available)', async () => {
        const { manager, calls } = fakeCli([
            {
                stdout: JSON.stringify({
                    installed: [
                        { id: 'formatter@acme', version: '1.2.0', installPath: 'C:/p/formatter', enabled: true, scope: 'user' },
                        { id: 'shared@acme', enabled: false, scope: 'project', projectPath: 'C:/other-repo' },
                        { id: 'core@builtin', enabled: true, scope: 'user' },
                    ],
                    available: [
                        { pluginId: 'linter@acme', name: 'linter', description: 'Lints.', marketplaceName: 'acme', source: './linter', installCount: 1200 },
                    ],
                }),
            },
        ]);
        const out = await manager.listPlugins('C:/repo', { includeAvailable: true });
        expect(calls[0].args).toEqual(['plugin', 'list', '--json', '--available']);
        expect(out.type).toBe('list_plugins_response');
        expect(out.installed[0]).toEqual({
            name: 'formatter@acme',
            manifest: { name: 'formatter@acme', version: '1.2.0' },
            path: 'C:/p/formatter',
            source: 'formatter@acme',
            enabled: true,
            scope: 'user',
        });
        // Another folder's project install, and a built-in: listed, but no scope to update in.
        expect(out.installed[1].scope).toBeUndefined();
        expect(out.installed[1].enabled).toBe(false);
        expect(out.installed[2].scope).toBeUndefined();
        expect(out.available).toEqual([
            { entry: { name: 'linter', description: 'Lints.' }, marketplaceName: 'acme', pluginId: 'linter@acme', isInstalled: false, source: './linter', installCount: 1200 },
        ]);
    });

    it('lists installed only without includeAvailable', async () => {
        const { manager, calls } = fakeCli([{ stdout: '[]' }]);
        expect(await manager.listPlugins('C:/repo')).toEqual({ type: 'list_plugins_response', available: [], installed: [], errors: [] });
        expect(calls[0].args).toEqual(['plugin', 'list', '--json']);
    });

    it('lists marketplaces with their source', async () => {
        const { manager } = fakeCli([
            { stdout: JSON.stringify([{ name: 'claude-plugins-official', source: 'github', repo: 'anthropics/claude-plugins-official', installLocation: 'C:/m' }, { name: 'local', source: 'directory', path: 'C:/plugins' }]) },
        ]);
        const out = await manager.listMarketplaces('C:/repo');
        expect(out.marketplaces).toEqual([
            { name: 'claude-plugins-official', config: { source: { source: 'github', repo: 'anthropics/claude-plugins-official' }, installLocation: 'C:/m' }, pluginCount: 0, installedCount: 0 },
            { name: 'local', config: { source: { source: 'directory', path: 'C:/plugins' }, installLocation: undefined }, pluginCount: 0, installedCount: 0 },
        ]);
    });

    it('update: ok, unchanged, and a failure as an answer rather than an error', async () => {
        let cli = fakeCli([{ stdout: 'Updating...\nformatter@acme updated from 1.2.0 to 1.3.0\n' }]);
        expect(await cli.manager.updatePlugin('formatter@acme', 'user', 'C:/repo')).toEqual({
            type: 'update_plugin_response',
            outcome: 'ok',
            needsRestart: true,
            message: 'formatter@acme updated from 1.2.0 to 1.3.0',
        });
        cli = fakeCli([{ stdout: 'formatter@acme is already at the latest version (1.3.0).\n' }]);
        expect((await cli.manager.updatePlugin('formatter@acme', 'user', 'C:/repo')).needsRestart).toBe(false);
        cli = fakeCli([{ code: 1, stdout: 'partial', stderr: '\u001b[31m✘ Failed to update plugin "formatter@acme": Failed to clone repository: x\u001b[0m' }]);
        const failed = await cli.manager.updatePlugin('formatter@acme', 'user', 'C:/repo');
        expect(failed).toMatchObject({ type: 'update_plugin_response', outcome: 'failed', needsRestart: false, output: 'partial' });
        expect(failed.reason).toBe('Claude CLI exited with code 1: ✘ Failed to update plugin "formatter@acme": Failed to clone repository: x');
    });

    it("an install failure is the CLI's own message", async () => {
        const { manager } = fakeCli([{ code: 1, stderr: 'Plugin "x" not found in marketplace "y".' }]);
        await expect(manager.installPlugin('x@y', 'user', 'C:/repo')).rejects.toThrow('Claude CLI exited with code 1: Plugin "x" not found in marketplace "y".');
        const slow = fakeCli([{ killed: true }]);
        await expect(slow.manager.uninstallPlugin('x@y', 'C:/repo')).rejects.toThrow(/timed out after 30s/);
    });

    it('maps an installed plugin like the official Wg$', () => {
        expect(toInstalledPlugin({ id: 'a@b', enabled: undefined as any, scope: 'local' }, 'C:/r')).toMatchObject({ enabled: true, scope: 'local', path: '' });
    });
});

describe('the handlers', () => {
    it('run in the workspace folder, or the home folder with none open', async () => {
        const { manager, calls } = fakeCli([{ stdout: '[]' }]);
        await handleListPlugins({ type: 'list_plugins' }, context('C:/repo'), manager);
        await handleListMarketplaces({ type: 'list_marketplaces' }, context(null), manager);
        expect(calls[0].cwd).toBe('C:/repo');
        expect(calls[1].cwd).not.toBe('C:/repo');
        expect(calls[1].cwd.length).toBeGreaterThan(0);
    });

    it('pass the payload through the same checks', async () => {
        const { manager, calls } = fakeCli([{ stdout: '' }]);
        await expect(handleInstallPlugin({ type: 'install_plugin', pluginId: '--dangerously', scope: 'user' }, context(), manager)).rejects.toThrow(/Not a plugin id/);
        await expect(handleSetPluginEnabled({ type: 'set_plugin_enabled', pluginId: 'x@y', enabled: 'true' as any }, context(), manager)).rejects.toThrow();
        await expect(handleUpdatePlugin({ type: 'update_plugin', pluginId: 'x@y', scope: 'everywhere' as any }, context(), manager)).rejects.toThrow(/Not an install scope/);
        expect(calls).toEqual([]);
        await expect(handleInstallPlugin({ type: 'install_plugin', pluginId: 'x@y', scope: 'user' }, context(), manager)).resolves.toEqual({ type: 'install_plugin_response', needsRestart: true });
    });
});
