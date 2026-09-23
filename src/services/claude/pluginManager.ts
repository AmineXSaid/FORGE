/**
 * Plugins and marketplaces, through the bundled CLI: the official host's
 * `pluginManager` (class `WJ` in extension.js), ported.
 *
 * Every request is one `claude plugin ...` subcommand. The argv is fixed; the
 * one value the webview supplies (a plugin id, a marketplace name or source)
 * goes last, after `--`, exactly as the official's `WJ.positional` puts it, so
 * a value that starts with `-` is an argument and never a flag. Forge adds the
 * validation the official leaves to the CLI (B3: the webview is untrusted), so
 * a malformed value is refused before any process starts.
 *
 * Nothing here consents on the user's behalf. A plugin whose marketplace
 * installs it by running a command needs `--accept-command` or `-y`; the
 * official passes neither, the CLI refuses, and the refusal is shown. Forge
 * does the same.
 *
 * Kept free of `vscode` so the spec drives it with a stand-in `execFile`.
 */
import { execFile as nodeExecFile } from 'node:child_process';
import type {
    AvailablePlugin,
    InstalledPlugin,
    ListMarketplacesResponse,
    ListPluginsResponse,
    Marketplace,
    MarketplaceSource,
    PluginInstallScope,
    UpdatePluginResponse,
} from '../../shared/messages';
import { claudeCommand, type ClaudeBinary } from './permissionRules';

export const PLUGIN_INSTALL_SCOPES: readonly PluginInstallScope[] = ['user', 'project', 'local'];

/** The official `bR0`: scopes an installed plugin can be updated in. */
const UPDATABLE_SCOPES = ['user', 'project', 'local', 'managed'];

/** `name@marketplace`, or a bare name; the characters plugin and marketplace names use. */
const PLUGIN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}(@[A-Za-z0-9][A-Za-z0-9._-]{0,127})?$/;
const MARKETPLACE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function validatePluginId(value: unknown): string {
    if (typeof value !== 'string' || !PLUGIN_ID.test(value)) {
        throw new Error(`Not a plugin id: ${JSON.stringify(value)}`);
    }
    return value;
}

export function validateInstallScope(value: unknown): PluginInstallScope {
    if (typeof value !== 'string' || !(PLUGIN_INSTALL_SCOPES as readonly string[]).includes(value)) {
        throw new Error(`Not an install scope: ${JSON.stringify(value)}`);
    }
    return value as PluginInstallScope;
}

export function validateMarketplaceName(value: unknown): string {
    if (typeof value !== 'string' || !MARKETPLACE_NAME.test(value)) {
        throw new Error(`Not a marketplace name: ${JSON.stringify(value)}`);
    }
    return value;
}

/**
 * A marketplace source as the user types it: `owner/repo`, a git or https URL,
 * or a local path. The CLI decides what it means; this only refuses what
 * cannot be one (empty, multi-line, control characters, absurdly long), and a
 * leading `-` is harmless after `--` but never a real source either.
 */
export function validateMarketplaceSource(value: unknown): string {
    if (typeof value !== 'string') throw new Error('A marketplace source is required.');
    const source = value.trim();
    if (!source) throw new Error('A marketplace source is required.');
    if (source.length > 2048) throw new Error('That marketplace source is too long.');
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(source)) throw new Error('A marketplace source is one line with no control characters.');
    if (source.startsWith('-')) throw new Error(`Not a marketplace source: ${source}`);
    return source;
}

/** The official `WJ.positional`: fixed words, then options, then `--`, then the value. */
export function positional(words: string[], options: string[], value: string): string[] {
    return [...words, ...options, '--', value];
}

/** The official `N$$`: the part of an id after its last `@`. */
function marketplaceOf(id: string): string | undefined {
    const at = id.lastIndexOf('@');
    if (at < 0) return undefined;
    const rest = id.slice(at + 1);
    return rest === '' ? undefined : rest;
}

interface CliInstalledPlugin {
    id: string;
    version?: string;
    description?: string;
    installPath?: string;
    enabled?: boolean;
    scope?: string;
    projectPath?: string;
    mcpServers?: Record<string, unknown>;
}

interface CliAvailablePlugin {
    pluginId: string;
    name: string;
    description?: string;
    marketplaceName: string;
    source?: unknown;
    installCount?: number;
}

interface CliMarketplace {
    name: string;
    source: string;
    repo?: string;
    url?: string;
    path?: string;
    package?: string;
    installLocation?: string;
}

/**
 * The official `fR0`: the scope an installed plugin reports, or none for a
 * built-in one, an unknown scope, or a project install that belongs to a
 * different folder than this one.
 */
function scopeOf(plugin: CliInstalledPlugin, cwd: string): InstalledPlugin['scope'] {
    if (marketplaceOf(plugin.id) === 'builtin') return undefined;
    if (!plugin.scope || !UPDATABLE_SCOPES.includes(plugin.scope)) return undefined;
    if (plugin.projectPath !== undefined && !samePath(plugin.projectPath, cwd)) return undefined;
    return plugin.scope as InstalledPlugin['scope'];
}

function samePath(a: string, b: string): boolean {
    const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').normalize('NFC');
    const ci = process.platform === 'win32' || process.platform === 'darwin';
    return ci ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

/** The official `Wg$`. */
export function toInstalledPlugin(plugin: CliInstalledPlugin, cwd: string): InstalledPlugin {
    return {
        name: plugin.id,
        manifest: {
            name: plugin.id,
            ...(plugin.version !== undefined && { version: plugin.version }),
            ...(plugin.description !== undefined && { description: plugin.description }),
        },
        path: plugin.installPath ?? '',
        source: plugin.id,
        enabled: plugin.enabled !== false,
        scope: scopeOf(plugin, cwd),
        ...(plugin.projectPath !== undefined && { projectPath: plugin.projectPath }),
        ...(plugin.mcpServers !== undefined && { mcpServers: plugin.mcpServers }),
    };
}

/** The official `buildMarketplaceSource`. */
export function toMarketplaceSource(m: CliMarketplace): MarketplaceSource {
    switch (m.source) {
        case 'github':
            return { source: 'github', repo: m.repo ?? '' };
        case 'git':
            return { source: 'git', url: m.url ?? '' };
        case 'url':
            return { source: 'url', url: m.url ?? '' };
        case 'directory':
            return { source: 'directory', path: m.path ?? '' };
        case 'file':
            return { source: 'file', path: m.path ?? '' };
        case 'npm':
            return { source: 'npm', package: m.package ?? '' };
        default:
            return { source: 'url', url: '' };
    }
}

/**
 * The official `gR0`/`uR0`, for `plugin update`: the CLI's result line, and
 * whether it says nothing changed (so no reload is needed).
 */
function lastLine(stdout: string): string | undefined {
    const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.length ? lines[lines.length - 1] : undefined;
}

function isUnchanged(message: string): boolean {
    return /^[^\s"]+ is already at the latest version (?:\(|satisfying )/.test(message) || /^Skipped — /.test(message);
}

/** The slice of `child_process.execFile` used here, so a spec can stand in for it. */
export type PluginExecFile = (
    command: string,
    args: string[],
    options: { cwd: string; env: Record<string, string | undefined>; encoding: 'utf-8'; timeout: number; maxBuffer: number; windowsHide: boolean },
    callback: (error: (Error & { code?: unknown; killed?: boolean; signal?: string | null; syscall?: string }) | null, stdout: string, stderr: string) => void,
) => unknown;

export class PluginManager {
    constructor(
        private readonly getBinary: () => Promise<ClaudeBinary>,
        private readonly log: (message: string) => void = () => {},
        private readonly execFile: PluginExecFile = nodeExecFile as unknown as PluginExecFile,
    ) {}

    /** The official `runClaudeCommandRaw`: 30 s, 10 MB, the CLI's own message on failure. */
    async runRaw(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
        const binary = await this.getBinary();
        if (!binary.pathToClaudeCodeExecutable) throw new Error('Claude binary not available');
        const { command, args: argv } = claudeCommand(binary, args);
        return new Promise((resolve, reject) => {
            this.execFile(
                command,
                argv,
                { cwd, env: { ...process.env, ...binary.env }, encoding: 'utf-8', timeout: 30_000, maxBuffer: 10_485_760, windowsHide: true },
                (error, stdout, stderr) => {
                    if (!error) {
                        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
                        return;
                    }
                    if (error.syscall) {
                        reject(error);
                        return;
                    }
                    const how = error.killed
                        ? 'timed out after 30s'
                        : error.code != null
                          ? `exited with code ${String(error.code)}`
                          : `killed by ${error.signal ?? 'signal'}`;
                    const detail = String(stderr ?? '').replace(/\u001B\[[0-9;]*m/g, '').trim();
                    reject(Object.assign(new Error(`Claude CLI ${how}: ${detail}`), { cause: { stdout: String(stdout ?? '') } }));
                },
            );
        });
    }

    private async runJson<T>(args: string[], cwd: string): Promise<T> {
        const { stdout } = await this.runRaw(args, cwd);
        return JSON.parse(stdout) as T;
    }

    async listPlugins(cwd: string, options?: { includeAvailable?: boolean }): Promise<ListPluginsResponse> {
        const args = ['plugin', 'list', '--json'];
        if (options?.includeAvailable) {
            args.push('--available');
            const out = await this.runJson<{ installed: CliInstalledPlugin[]; available: CliAvailablePlugin[] }>(args, cwd);
            return {
                type: 'list_plugins_response',
                available: (out.available ?? []).map(
                    (p): AvailablePlugin => ({
                        entry: { name: p.name, description: p.description },
                        marketplaceName: p.marketplaceName,
                        pluginId: p.pluginId,
                        isInstalled: false,
                        source: p.source,
                        installCount: p.installCount,
                    }),
                ),
                installed: (out.installed ?? []).map((p) => toInstalledPlugin(p, cwd)),
                errors: [],
            };
        }
        const installed = await this.runJson<CliInstalledPlugin[]>(args, cwd);
        return { type: 'list_plugins_response', available: [], installed: installed.map((p) => toInstalledPlugin(p, cwd)), errors: [] };
    }

    async listMarketplaces(cwd: string): Promise<ListMarketplacesResponse> {
        const list = await this.runJson<CliMarketplace[]>(['plugin', 'marketplace', 'list', '--json'], cwd);
        return {
            type: 'list_marketplaces_response',
            marketplaces: list.map(
                (m): Marketplace => ({
                    name: m.name,
                    config: { source: toMarketplaceSource(m), installLocation: m.installLocation },
                    pluginCount: 0,
                    installedCount: 0,
                }),
            ),
        };
    }

    async installPlugin(pluginId: string, scope: PluginInstallScope, cwd: string) {
        await this.runRaw(positional(['plugin', 'install'], ['--scope', validateInstallScope(scope)], validatePluginId(pluginId)), cwd);
        this.log(`Installed plugin ${pluginId} in ${scope} scope`);
        return { type: 'install_plugin_response' as const, needsRestart: true };
    }

    async uninstallPlugin(pluginId: string, cwd: string) {
        await this.runRaw(positional(['plugin', 'uninstall'], [], validatePluginId(pluginId)), cwd);
        this.log(`Uninstalled plugin ${pluginId}`);
        return { type: 'uninstall_plugin_response' as const, needsRestart: true };
    }

    /** The official `updatePlugin`: a failure comes back as `outcome: "failed"`, with the CLI's output. */
    async updatePlugin(pluginId: string, scope: PluginInstallScope, cwd: string): Promise<UpdatePluginResponse> {
        validatePluginId(pluginId);
        validateInstallScope(scope);
        let stdout: string;
        try {
            ({ stdout } = await this.runRaw(positional(['plugin', 'update'], ['--scope', scope], pluginId), cwd));
        } catch (error) {
            const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
            const output = cause && typeof cause === 'object' && 'stdout' in cause ? String((cause as { stdout: unknown }).stdout) : '';
            this.log(`Update of plugin ${pluginId} in ${scope} scope failed`);
            return {
                type: 'update_plugin_response',
                outcome: 'failed',
                needsRestart: false,
                reason: error instanceof Error ? error.message : String(error),
                output,
            };
        }
        const message = lastLine(stdout);
        this.log(`Updated plugin ${pluginId} in ${scope} scope`);
        return {
            type: 'update_plugin_response',
            outcome: 'ok',
            needsRestart: message === undefined || !isUnchanged(message),
            ...(message !== undefined && { message }),
            ...(message !== undefined && /version shown may be stale\.$/.test(message) && { upstreamUnchecked: true }),
        };
    }

    async setPluginEnabled(pluginId: string, enabled: boolean, cwd: string) {
        if (typeof enabled !== 'boolean') throw new Error('set_plugin_enabled: enabled must be true or false');
        await this.runRaw(positional(['plugin', enabled ? 'enable' : 'disable'], [], validatePluginId(pluginId)), cwd);
        this.log(`Set plugin ${pluginId} enabled=${enabled}`);
        return { type: 'set_plugin_enabled_response' as const, needsRestart: true };
    }

    async addMarketplace(source: string, cwd: string) {
        const value = validateMarketplaceSource(source);
        await this.runRaw(positional(['plugin', 'marketplace', 'add'], [], value), cwd);
        this.log('Added marketplace');
        return { type: 'add_marketplace_response' as const };
    }

    async removeMarketplace(marketplaceId: string, cwd: string) {
        await this.runRaw(positional(['plugin', 'marketplace', 'remove'], [], validateMarketplaceName(marketplaceId)), cwd);
        this.log(`Removed marketplace ${marketplaceId}`);
        return { type: 'remove_marketplace_response' as const };
    }

    async refreshMarketplace(marketplaceId: string, cwd: string) {
        await this.runRaw(positional(['plugin', 'marketplace', 'update'], [], validateMarketplaceName(marketplaceId)), cwd);
        this.log(`Refreshed marketplace ${marketplaceId}`);
        return { type: 'refresh_marketplace_response' as const };
    }
}
