/**
 * Settings > Plugins: the four handlers pluginManager.spec.ts did not reach
 * through the dispatcher's own entry points (production audit, Phase 2).
 *
 * Each is the official one-liner (`case"uninstall_plugin":return await
 * this.pluginManager.uninstallPlugin($.request.pluginId,this.cwd)`, and the
 * same for the three marketplace requests): a fixed subcommand, `--`, the one
 * value the webview supplied, run in the workspace folder, answered in the
 * official shape. A value that cannot be real is refused before any process
 * starts.
 */
import { describe, expect, it } from 'vitest';
import { PluginManager, type PluginExecFile } from '../src/services/claude/pluginManager';
import {
  handleAddMarketplace,
  handleRefreshMarketplace,
  handleRemoveMarketplace,
  handleUninstallPlugin,
} from '../src/services/claude/handlers/handlers';
import { OFFICIAL_DIR, readOfficial } from './helpers/officialBundle';

const BINARY = { pathToClaudeCodeExecutable: 'C:/forge/claude.exe', executableArgs: [], env: {} };

function cli(fail?: { code: number; stderr: string }) {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  const exec: PluginExecFile = (_command, args, options, callback) => {
    calls.push({ args, cwd: options.cwd });
    if (fail) callback(Object.assign(new Error('failed'), { code: fail.code }), '', fail.stderr);
    else callback(null, '', '');
    return undefined;
  };
  return { manager: new PluginManager(async () => BINARY, () => {}, exec), calls };
}

const context = { workspaceService: { getDefaultWorkspaceFolder: () => ({ uri: { fsPath: 'C:/repo' } }) } } as any;

describe('uninstall_plugin', () => {
  it('runs `plugin uninstall -- <id>` in the workspace and asks for a restart', async () => {
    const { manager, calls } = cli();
    expect(await handleUninstallPlugin({ type: 'uninstall_plugin', pluginId: 'formatter@acme' }, context, manager)).toEqual({
      type: 'uninstall_plugin_response',
      needsRestart: true,
    });
    expect(calls).toEqual([{ args: ['plugin', 'uninstall', '--', 'formatter@acme'], cwd: 'C:/repo' }]);
  });

  it.each(['--all', '-y', '../x', 'a b', '', 42])('refuses %j before a process starts', async (pluginId) => {
    const { manager, calls } = cli();
    await expect(handleUninstallPlugin({ type: 'uninstall_plugin', pluginId } as any, context, manager)).rejects.toThrow(/Not a plugin id/);
    expect(calls).toEqual([]);
  });

  it("reports the CLI's own failure", async () => {
    const { manager } = cli({ code: 1, stderr: 'Error: Plugin "x@y" is not installed' });
    await expect(handleUninstallPlugin({ type: 'uninstall_plugin', pluginId: 'x@y' }, context, manager)).rejects.toThrow(/not installed/);
  });
});

describe('add_marketplace', () => {
  it.each([
    'https://github.com/acme/plugins.git',
    'acme/plugins',
    'C:\\plugins\\local',
  ])('adds %s as the one positional value', async (source) => {
    const { manager, calls } = cli();
    expect(await handleAddMarketplace({ type: 'add_marketplace', source }, context, manager)).toEqual({ type: 'add_marketplace_response' });
    expect(calls[0].args).toEqual(['plugin', 'marketplace', 'add', '--', source]);
  });

  it.each(['', '   ', '--help', 'a\nb', 'a\u0007b', 'x'.repeat(3000), 7])('refuses %j before a process starts', async (source) => {
    const { manager, calls } = cli();
    await expect(handleAddMarketplace({ type: 'add_marketplace', source } as any, context, manager)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe.each([
  ['remove_marketplace', handleRemoveMarketplace, 'remove', 'remove_marketplace_response'],
  ['refresh_marketplace', handleRefreshMarketplace, 'update', 'refresh_marketplace_response'],
] as const)('%s', (type, handler, verb, responseType) => {
  it(`runs \`plugin marketplace ${verb} -- <name>\``, async () => {
    const { manager, calls } = cli();
    expect(await (handler as any)({ type, marketplaceId: 'acme-tools' }, context, manager)).toEqual({ type: responseType });
    expect(calls).toEqual([{ args: ['plugin', 'marketplace', verb, '--', 'acme-tools'], cwd: 'C:/repo' }]);
  });

  it.each(['', '-x', '--all', 'a/b', 'a b', '../x'])('refuses %j before a process starts', async (marketplaceId) => {
    const { manager, calls } = cli();
    await expect((handler as any)({ type, marketplaceId }, context, manager)).rejects.toThrow(/Not a marketplace name/);
    expect(calls).toEqual([]);
  });
});

describe('the official handlers', () => {
  it.skipIf(!OFFICIAL_DIR)('are the same four one-liners', () => {
    const host = readOfficial('extension.js');
    expect(host).toContain('case"uninstall_plugin":return await this.pluginManager.uninstallPlugin($.request.pluginId,this.cwd)');
    expect(host).toContain('case"add_marketplace":return await this.pluginManager.addMarketplace($.request.source,this.cwd)');
    expect(host).toContain('case"remove_marketplace":return await this.pluginManager.removeMarketplace($.request.marketplaceId,this.cwd)');
    expect(host).toContain('case"refresh_marketplace":return await this.pluginManager.refreshMarketplace($.request.marketplaceId,this.cwd)');
    expect(host).toContain('async uninstallPlugin($,Q){return await this.runClaudeCommandRaw(WJ.positional(["plugin","uninstall"],[],$),Q)');
    expect(host).toContain('WJ.positional(["plugin","marketplace","update"],[],$)');
  });
});
