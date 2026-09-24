/**
 * 配置服务 / Configuration Service
 * 负责管理多层级配置：Local Project > Shared Project > Global Profile > Defaults
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import { createDecorator } from '../di/instantiation';
import { IFileSystemService } from './fileSystemService';
import { stripFlagReservedKeys } from './claude/settingsWhitelist';

export const IConfigurationService = createDecorator<IConfigurationService>('configurationService');

export type SettingScope =
  | 'managed' // managed-settings.json (Enterprise Policies)
  | 'cli' // CLI args via extraArgs
  | 'local' // .claude/settings.local.json (Workspace Local)
  | 'shared' // .claude/settings.json (Workspace Shared)
  | 'profile' // ~/.claude/settings.<name>.json (Profile overlay, only when profile active)
  | 'global' // ~/.claude/settings.json (User Global, always the default file)
  | 'default'; // Internal defaults

export interface ConfigurationInspectResult<T> {
  key: string;
  value: T; // Effective value
  effectiveScope: SettingScope;
  values: {
    managed?: T;
    cli?: T;
    local?: T;
    shared?: T;
    profile?: T;  // ~/.claude/settings.<name>.json (only when profile is active)
    global?: T;   // ~/.claude/settings.json (always the default file)
    default?: T;
  };
}

/**
 * Extension-specific configuration stored in ~/.forge.json
 * Independent of CLI configuration, not affected by Profile switching
 */
export interface ExtensionConfig {
  // Active Profile (null = Default settings.json)
  activeProfile: string | null;

  // Startup defaults
  // The SDK's own union: 'delegate' was removed and the CLI rejects unknown modes.
  defaultPermissionMode: PermissionMode;
  defaultModel: string;
  defaultThinkingLevel: 'off' | 'default_on';

  // UI preferences
  systemNotifications: boolean;
  completionSound: boolean;
  /**
   * Focus view: the transcript shows only prompts and replies (step 30). The
   * official keeps this as the VS Code setting `claudeCode.focusView`, written
   * with `ConfigurationTarget.Global`; Forge keeps its own preferences here, so
   * this file is the equivalent global store.
   */
  focusView: boolean;

  // Model management
  customModels: Array<{ id: string; name?: string }>;
  disabledModels: string[];
}

export interface IConfigurationService {
	readonly _serviceBrand: undefined;

  // Active Profile (null = Default settings.json)
  activeProfile: string | null;

  // Switch Profile (reloads Global layer)
  switchProfile(profileName: string | null): Promise<void>;

  // Get available profiles
  getProfiles(): Promise<string[]>;

  // Get merged settings object (key -> effective value)
  getAllSettings(): Promise<Record<string, any>>;

  // Get full inspection data for UI rendering
  inspect<T>(key: string): Promise<ConfigurationInspectResult<T>>;

  // Update specific layer
  // Triggers dual-write to forge.json for critical keys
  updateSetting(key: string, value: any, target: 'local' | 'shared' | 'global'): Promise<void>;

  // Reset specific layer
  resetSetting(key: string, target: 'local' | 'shared' | 'global'): Promise<void>;

  // Get single effective value (convenience)
  getSetting<T>(key: string, defaultValue?: T): Promise<T>;

  // Get parsed environment variables
  getEnvironmentVariables(): Promise<Record<string, string>>;

  // Inspect all settings
  inspectAll(): Promise<Record<string, ConfigurationInspectResult<any>>>;

  // Whether a workspace folder is currently open
  readonly hasWorkspace: boolean;

  // Create a new profile (creates settings.<name>.json)
  createProfile(name: string): Promise<void>;

  // Delete a profile (deletes settings.<name>.json)
  deleteProfile(name: string): Promise<void>;

  // Read-only access to Managed/CLI layers
  getManagedSettings(): Promise<any>;
  getCliArgs(): Promise<any>;

  // Extension-specific configuration (~/.forge.json)
  getExtensionConfig(): Promise<ExtensionConfig>;
  updateExtensionConfig<K extends keyof ExtensionConfig>(key: K, value: ExtensionConfig[K]): Promise<void>;
}

export class ConfigurationService implements IConfigurationService {
	readonly _serviceBrand: undefined;

  private _activeProfile: string | null = null;
  private _managedSettings: any = {};
  private _cliSettings: any = {};
  private _globalSettings: any = {};       // Smart-merged result (default + profile)
  private _globalDefaultSettings: any = {}; // Raw content of settings.json (always)
  private _globalProfileSettings: any = {}; // Raw content of settings.<name>.json (only when profile active)
  private _sharedSettings: any = {};
  private _localSettings: any = {};

  // CC schema defaults: extracted from bundled claude-code-settings.schema.json `default` fields.
  // Used as in-memory fallback for inspect(), and as the baseline for delta-only write logic.
  private _defaults: Record<string, any> = {};

  /**
   * Forge's defaults for the sessions it launches.
   *
   * These used to be written into ~/.claude/settings.json on every start, which
   * changed the Claude Code CLI everywhere (the terminal too) and, when that
   * file did not parse, replaced the user's settings with these five keys.
   * They now reach only Forge's own launches, through forge.json (the
   * `--settings` flag layer), and only for keys none of the user's settings
   * layers sets, so a value the user chose still wins (`forgeLaunchDefaults`).
   */
  private readonly _defaultTemplate: any = {
    permissions: {
      allow: [],
      deny: []
    },
    env: {
      "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
      "CLAUDE_CODE_ATTRIBUTION_HEADER": "0",
      "DISABLE_INSTALLATION_CHECKS": "1"
    },
    attribution: {
      commit: '',
      pr: ''
    },
    "skipWebFetchPreflight": true
  };

  // Default template for extension config (~/.forge.json)
  private readonly _extensionConfigDefaults: ExtensionConfig = {
    activeProfile: null,
    defaultPermissionMode: 'default',
    defaultModel: 'default',
    defaultThinkingLevel: 'default_on',
    systemNotifications: false,
    completionSound: true,
    focusView: false,
    customModels: [],
    disabledModels: []
  };

  constructor(@IFileSystemService private readonly fileSystemService: IFileSystemService) {
    this.initialize();
  }

  get activeProfile(): string | null {
    return this._activeProfile;
  }

  private async initialize() {
    // Load CC schema defaults from bundled schema file
    this.loadSchemaDefaults();

    // Ensure extension config (~/.forge.json) exists
    await this.logFailure('create ~/.forge.json', () => this.ensureExtensionConfigExists());

    // Load active profile from extension config (~/.forge.json)
    const extensionConfig = await this.readJsonFile(this.getExtensionConfigPath());
    this._activeProfile = isProfileName(extensionConfig.activeProfile) ? extensionConfig.activeProfile : null;

    // Load all layers, then write forge.json (Forge's flag layer) from them.
    // ~/.claude/settings.json itself is never written here.
    await this.reloadAll();
    await this.logFailure('write ~/.claude/forge.json', () => this.syncProfileToForge());
  }

  /** A startup step that must not stop the service from loading. */
  private async logFailure(what: string, step: () => Promise<void>): Promise<void> {
    try {
      await step();
    } catch (error) {
      console.error(`[Config] Could not ${what}:`, error);
    }
  }

  /**
   * Extract `default` values from bundled CC settings schema.
   * These serve as the baseline for inspect() fallback and delta-only write logic.
   */
  private loadSchemaDefaults(): void {
    try {
      const schemaPath = path.join(__dirname, '..', 'resources', 'claude-code-settings.schema.json');
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
      const properties = schema.properties ?? {};
      for (const [key, prop] of Object.entries<any>(properties)) {
        if (prop.default !== undefined) {
          this._defaults[key] = prop.default;
        }
      }
    } catch (e) {
      console.error('[Config] Failed to load schema defaults:', e);
    }
  }

  private async reloadAll() {
    this._managedSettings = await this.loadManagedSettings();
    this._cliSettings = await this.loadCliSettings();
    this._globalSettings = await this.loadGlobalSettings();
    this._sharedSettings = await this.loadSharedSettings();
    this._localSettings = await this.loadLocalSettings();
  }

  async createProfile(name: string): Promise<void> {
    assertProfileName(name);

    const filename = `settings.${name}.json`;
    const filepath = path.join(os.homedir(), '.claude', filename);

    if (await this.fileSystemService.pathExists(filepath)) {
      throw new Error(`Profile '${name}' already exists.`);
    }

    // Create empty settings file
    await this.writeJsonFile(filepath, {});
  }

  async deleteProfile(name: string): Promise<void> {
    // B3: the name becomes a path under ~/.claude, so "../x" must never reach it.
    assertProfileName(name);

    const filename = `settings.${name}.json`;
    const filepath = path.join(os.homedir(), '.claude', filename);

    if (await this.fileSystemService.pathExists(filepath)) {
      // Check if active, switch to default if so
      if (this._activeProfile === name) {
        await this.switchProfile(null);
      }
      await fs.promises.unlink(filepath);
    }
  }

  // --- Path Helpers ---

  /**
   * Extension-specific config path: ~/.forge.json
   * Independent of CLI configuration
   */
  private getExtensionConfigPath(): string {
    return path.join(os.homedir(), '.forge.json');
  }

  /**
   * CLI config path: ~/.claude/forge.json
   * Synced with active Profile
   */
  private getForgeConfigPath(): string {
    return path.join(os.homedir(), '.claude', 'forge.json');
  }

  // Mock implementation for Managed Settings path
  private getManagedSettingsPath(): string {
    return path.join(os.homedir(), '.claude', 'managed-settings.json');
  }

  private getGlobalSettingsPath(profile: string | null): string {
    const filename = profile ? `settings.${profile}.json` : 'settings.json';
    return path.join(os.homedir(), '.claude', filename);
  }

  get hasWorkspace(): boolean {
    return this.getWorkspaceRoot() !== undefined;
  }

  private getWorkspaceRoot(): string | undefined {
    // Simple assumption: first workspace folder
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      return vscode.workspace.workspaceFolders[0].uri.fsPath;
    }
    return undefined;
  }

  private getSharedSettingsPath(): string | undefined {
    const root = this.getWorkspaceRoot();
    return root ? path.join(root, '.claude', 'settings.json') : undefined;
  }

  private getLocalSettingsPath(): string | undefined {
    const root = this.getWorkspaceRoot();
    return root ? path.join(root, '.claude', 'settings.local.json') : undefined;
  }

  // --- File Operations ---

  /**
   * A settings file for reading: `{}` when it is missing or does not parse.
   * Readers carry on with the other layers; nothing may be written back from a
   * read that failed to parse (`readJsonFileForWrite`).
   */
  private async readJsonFile(filePath: string | undefined): Promise<any> {
    try {
      return await this.readJsonFileForWrite(filePath);
    } catch (error) {
      console.warn(`[Config] ${error instanceof Error ? error.message : String(error)}`);
      return {};
    }
  }

  /**
   * A settings file that is about to be modified and written back: `{}` only
   * when it does not exist. A file that exists but does not parse (a comment,
   * a trailing comma, a read while another process is writing it) throws, so
   * the write that would have replaced the user's settings never happens.
   */
  private async readJsonFileForWrite(filePath: string | undefined): Promise<any> {
    if (!filePath) {
      return {};
    }
    if (!(await this.fileSystemService.pathExists(filePath))) {
      return {};
    }
    const contentBytes = await this.fileSystemService.readFile(vscode.Uri.file(filePath));
    const content = new TextDecoder().decode(contentBytes);
    if (!content.trim()) {
      return {};
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new SettingsFileUnreadableError(filePath, error);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new SettingsFileUnreadableError(filePath, new Error('the top level is not an object'));
    }
    return parsed;
  }

  /**
   * Written whole or not at all: a temp file beside the target, then a rename,
   * so a crash or a concurrent reader never sees half a settings file.
   */
  private async writeJsonFile(filePath: string | undefined, content: any): Promise<void> {
    if (!filePath) {return;}
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.promises.writeFile(temp, JSON.stringify(content, null, 2), 'utf8');
      await fs.promises.rename(temp, filePath);
    } catch (error) {
      await fs.promises.rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /**
   * The defaults Forge's own launches get: every key of `_defaultTemplate` that
   * no settings layer sets, and every default env variable that no layer's
   * `env` and not the environment itself sets.
   */
  forgeLaunchDefaults(): Record<string, unknown> {
    const layers = [this._globalSettings, this._sharedSettings, this._localSettings, this._managedSettings]
      .filter((layer) => layer && typeof layer === 'object');
    const defaults: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this._defaultTemplate)) {
      if (key === 'env' || key === 'permissions') continue;
      if (!layers.some((layer) => key in layer)) defaults[key] = value;
    }
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(this._defaultTemplate.env as Record<string, string>)) {
      const setSomewhere = name in process.env || layers.some((layer) => layer.env && name in layer.env);
      if (!setSomewhere) env[name] = value;
    }
    if (Object.keys(env).length) defaults.env = env;
    return defaults;
  }

  /**
   * Ensure extension config (~/.forge.json) exists with default values
   */
  private async ensureExtensionConfigExists(): Promise<void> {
    const configPath = this.getExtensionConfigPath();
    if (!(await this.fileSystemService.pathExists(configPath))) {
      await this.writeJsonFile(configPath, { ...this._extensionConfigDefaults });
    }
  }

  /**
   * Sync current Profile content to forge.json
   *
   * forge.json is passed to SDK via --settings flag as the flagSettings layer.
   * SDK already reads ~/.claude/settings.json as userSettings (lower priority).
   * So forge.json only needs profile-specific overrides, NOT a full copy.
   *
   * - No profile (Default): only Forge's launch defaults (`forgeLaunchDefaults`)
   * - With profile: the profile's content over those defaults
   */
  async syncProfileToForge(): Promise<void> {
    const forgePath = this.getForgeConfigPath();
    const defaults = this.forgeLaunchDefaults();

    if (!this._activeProfile) {
      await this.writeJsonFile(forgePath, defaults);
      return;
    }

    // Named profile: write profile-specific content as flagSettings overlay
    const profilePath = this.getGlobalSettingsPath(this._activeProfile);
    let profileContent: any;
    if (await this.fileSystemService.pathExists(profilePath)) {
      profileContent = await this.readJsonFile(profilePath);
    } else {
      profileContent = {};
    }

    // CLAUDE.md B6. forge.json is the flag layer, which outranks user settings,
    // so anything a profile pins here beats the user's own choice on every
    // launch -- silently. The keys `apply_settings` owns are therefore stripped:
    // they belong in ~/.claude/settings.json, and reach a running session
    // through applyFlagSettings, which is session-scoped. That is how the
    // official resolves them too; it has no persistent flag file at all.
    // Everything else a profile carries still overlays.
    const overlay: Record<string, any> = stripFlagReservedKeys(profileContent);
    const env = { ...(defaults.env as Record<string, string> | undefined), ...(overlay.env as Record<string, string> | undefined) };
    await this.writeJsonFile(forgePath, {
      ...defaults,
      ...overlay,
      ...(Object.keys(env).length > 0 && { env }),
    });
  }

  // --- Loaders ---

  private async loadManagedSettings() {
    return this.readJsonFile(this.getManagedSettingsPath());
  }

  private async loadCliSettings() {
    // CLI settings layer is reserved for future use (e.g., extraArgs from SDK)
    // Currently returns empty object as forge.json follows standard settings.json schema
    return {};
  }

  private async loadGlobalSettings() {
    // Always read the default settings.json
    this._globalDefaultSettings = await this.readJsonFile(this.getGlobalSettingsPath(null));

    if (this._activeProfile) {
      this._globalProfileSettings = await this.readJsonFile(this.getGlobalSettingsPath(this._activeProfile));

      // Smart merge: profile overlays default
      // - Scalars/arrays: profile value replaces default value (shallow)
      // - Plain objects (env, permissions, mcpServers): deep merge (profile keys overlay default keys)
      const merged: any = { ...this._globalDefaultSettings };
      for (const [key, value] of Object.entries(this._globalProfileSettings)) {
        if (
          value !== null && typeof value === 'object' && !Array.isArray(value) &&
          merged[key] !== null && typeof merged[key] === 'object' && !Array.isArray(merged[key])
        ) {
          merged[key] = { ...merged[key], ...value };
        } else {
          merged[key] = value;
        }
      }
      return merged;
    }

    this._globalProfileSettings = {};
    return { ...this._globalDefaultSettings };
  }

  private async loadSharedSettings() {
    return this.readJsonFile(this.getSharedSettingsPath());
  }

  private async loadLocalSettings() {
    return this.readJsonFile(this.getLocalSettingsPath());
  }

  // --- Public API ---

  async getManagedSettings(): Promise<any> {
    return this._managedSettings;
  }

  async getCliArgs(): Promise<any> {
    return this._cliSettings;
  }

  async getProfiles(): Promise<string[]> {
    const claudeDir = path.join(os.homedir(), '.claude');
    if (!(await this.fileSystemService.pathExists(claudeDir))) {return [];}

    try {
      const entries = await this.fileSystemService.readDirectory(vscode.Uri.file(claudeDir));
      // Match settings.<profile>.json
      const profiles: string[] = [];
      const regex = /^settings\.(.+)\.json$/;

      for (const [name, type] of entries) {
        if (type === vscode.FileType.File) {
          if (name === 'settings.json') {continue;} // Default
          const match = name.match(regex);
          if (match) {
            profiles.push(match[1]);
          }
        }
      }
      return profiles;
    } catch (e) {
      console.error('[Config] Failed to list profiles:', e);
      return [];
    }
  }

  async getAllSettings(): Promise<Record<string, any>> {
    await this.reloadAll();

    // Merge in order of precedence (later wins):
    // Default → Global(settings.json + profile deep-merged) → Shared → Local → CLI → Managed
    return {
      ...this._defaults,
      ...this._globalSettings,
      ...this._sharedSettings,
      ...this._localSettings,
      ...this._cliSettings,
      ...this._managedSettings
    };
  }

  async switchProfile(profileName: string | null): Promise<void> {
    if (profileName !== null) assertProfileName(profileName);
    this._activeProfile = profileName;

    // Save active profile to extension config (~/.forge.json)
    await this.updateExtensionConfig('activeProfile', profileName);

    // Reload global settings from new profile
    this._globalSettings = await this.loadGlobalSettings();

    // Sync profile content to forge.json (triggers CLI hot-reload)
    await this.syncProfileToForge();
  }

  async inspect<T>(key: string): Promise<ConfigurationInspectResult<T>> {
    // Refresh to ensure latest state (optimization: could watch files instead)
    await this.reloadAll();

    const managedVal = this._managedSettings[key];
    const cliVal = this._cliSettings[key];
    const localVal = this._localSettings[key];
    const sharedVal = this._sharedSettings[key];
    // Separate profile and global (default settings.json) layers
    const profileVal = this._activeProfile ? this._globalProfileSettings[key] : undefined;
    const globalVal = this._globalDefaultSettings[key];
    const defaultVal = this._defaults[key];

    // Effective value: walk priority chain (lowest to highest)
    // Per CC SDK docs: default < global(userSettings) < shared(projectSettings)
    //   < local(localSettings) < profile(flagSettings) < cli < managed(policySettings)
    let value = defaultVal;
    let effectiveScope: SettingScope = 'default';

    if (globalVal !== undefined) {
      value = globalVal;
      effectiveScope = 'global';
    }
    if (sharedVal !== undefined) {
      value = sharedVal;
      effectiveScope = 'shared';
    }
    if (localVal !== undefined) {
      value = localVal;
      effectiveScope = 'local';
    }
    if (profileVal !== undefined) {
      value = profileVal;
      effectiveScope = 'profile';
    }
    if (cliVal !== undefined) {
      value = cliVal;
      effectiveScope = 'cli';
    }
    if (managedVal !== undefined) {
      value = managedVal;
      effectiveScope = 'managed';
    }

    return {
      key,
      value,
      effectiveScope,
      values: {
        managed: managedVal,
        cli: cliVal,
        local: localVal,
        shared: sharedVal,
        profile: profileVal,
        global: globalVal,
        default: defaultVal
      }
    };
  }

  async getSetting<T>(key: string, defaultValue?: T): Promise<T> {
    const inspection = await this.inspect<T>(key);
    return inspection.value !== undefined ? inspection.value : (defaultValue as T);
  }

  async getEnvironmentVariables(): Promise<Record<string, string>> {
    const vars = await this.getSetting<Array<{ name: string; value: string }>>(
      'environmentVariables',
      []
    );
    const env: Record<string, string> = {};
    if (Array.isArray(vars)) {
      for (const item of vars) {
        if (item.name) {
          env[item.name] = item.value || '';
        }
      }
    }
    return env;
  }

  async inspectAll(): Promise<Record<string, ConfigurationInspectResult<any>>> {
    await this.reloadAll();

    const allKeys = new Set<string>([
      ...Object.keys(this._defaults),
      ...Object.keys(this._globalSettings),
      ...Object.keys(this._sharedSettings),
      ...Object.keys(this._localSettings),
      ...Object.keys(this._cliSettings),
      ...Object.keys(this._managedSettings)
    ]);

    const result: Record<string, ConfigurationInspectResult<any>> = {};
    for (const key of allKeys) {
      result[key] = await this.inspect(key);
    }
    return result;
  }

  /**
   * Resolve the target file path for a settings scope.
   */
  private resolveTargetPath(target: 'local' | 'shared' | 'global'): string {
    switch (target) {
      case 'local': {
        const p = this.getLocalSettingsPath();
        if (!p) {throw new Error('No workspace open for local settings');}
        return p;
      }
      case 'shared': {
        const p = this.getSharedSettingsPath();
        if (!p) {throw new Error('No workspace open for shared settings');}
        return p;
      }
      case 'global':
        return this.getGlobalSettingsPath(this._activeProfile);
    }
  }

  async updateSetting(
    key: string,
    value: any,
    target: 'local' | 'shared' | 'global'
  ): Promise<void> {
    const filePath = this.resolveTargetPath(target);

    // Read the actual file content (NOT the merged cache) to avoid
    // polluting profile files with inherited default-settings keys. A file
    // that does not parse is refused rather than replaced.
    const fileContent = await this.readJsonFileForWrite(filePath);

    // Delta-only write: if value equals CC schema default, remove the key instead of writing.
    // This keeps settings files clean — only deltas from CC defaults are persisted.
    const schemaDefault = this._defaults[key];
    if (schemaDefault !== undefined && this.deepEqual(value, schemaDefault)) {
      delete fileContent[key];
    } else {
      fileContent[key] = value;
    }

    // Write file
    await this.writeJsonFile(filePath, fileContent);

    // Reload in-memory caches to reflect the change
    await this.reloadAll();

    // forge.json follows: a profile change hot-reloads, and a key the user now
    // sets in any layer stops being one of Forge's launch defaults.
    await this.syncProfileToForge();
  }

  async resetSetting(key: string, target: 'local' | 'shared' | 'global'): Promise<void> {
    const filePath = this.resolveTargetPath(target);

    // Read actual file content, modify only the target key
    const fileContent = await this.readJsonFileForWrite(filePath);

    if (key in fileContent) {
      delete fileContent[key];
      await this.writeJsonFile(filePath, fileContent);

      // Reload in-memory caches, and forge.json with them (see updateSetting)
      await this.reloadAll();
      await this.syncProfileToForge();
    }
  }

  // --- Extension Config API (~/.forge.json) ---

  /**
   * Get extension-specific configuration
   * Returns merged config with defaults for missing keys
   */
  async getExtensionConfig(): Promise<ExtensionConfig> {
    const configPath = this.getExtensionConfigPath();
    const stored = await this.readJsonFile(configPath);

    // Merge with defaults to ensure all keys exist
    return {
      ...this._extensionConfigDefaults,
      ...stored
    };
  }

  /**
   * Update extension-specific configuration
   */
  async updateExtensionConfig<K extends keyof ExtensionConfig>(
    key: K,
    value: ExtensionConfig[K]
  ): Promise<void> {
    // B3: the key and value come from the webview. Only ExtensionConfig's own
    // keys, each with the type its default has.
    assertExtensionConfigEntry(key, value, this._extensionConfigDefaults);
    const configPath = this.getExtensionConfigPath();
    const current = await this.readJsonFileForWrite(configPath);

    const updated = {
      ...this._extensionConfigDefaults,
      ...current,
      [key]: value
    };

    await this.writeJsonFile(configPath, updated);
  }

  // --- Utilities ---

  private deepEqual(a: any, b: any): boolean {
    if (a === b) {return true;}
    if (a == null || b == null) {return false;}
    if (typeof a !== typeof b) {return false;}
    if (typeof a !== 'object') {return false;}
    if (Array.isArray(a) !== Array.isArray(b)) {return false;}

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) {return false;}

    return keysA.every(k => this.deepEqual(a[k], b[k]));
  }
}

/** A settings file exists but is not a JSON object; it is left untouched. */
export class SettingsFileUnreadableError extends Error {
  constructor(readonly filePath: string, cause: unknown) {
    super(`${filePath} is not valid JSON (${cause instanceof Error ? cause.message : String(cause)}); it was left unchanged.`);
    this.name = 'SettingsFileUnreadableError';
  }
}

const PROFILE_NAME = /^[a-zA-Z0-9_-]+$/;

/** A profile name: the part between `settings.` and `.json` under ~/.claude. */
export function isProfileName(name: unknown): name is string {
  return typeof name === 'string' && PROFILE_NAME.test(name);
}

function assertProfileName(name: unknown): asserts name is string {
  if (!isProfileName(name)) {
    throw new Error('Invalid profile name. Use only alphanumeric characters, underscores, and hyphens.');
  }
}

/** Only ExtensionConfig's keys, each with its default's type (activeProfile may be null or a profile name). */
export function assertExtensionConfigEntry(key: unknown, value: unknown, defaults: ExtensionConfig): void {
  if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(defaults, key)) {
    throw new Error(`Unknown Forge setting: ${String(key)}`);
  }
  const expected = (defaults as unknown as Record<string, unknown>)[key];
  if (key === 'activeProfile') {
    if (value === null || isProfileName(value)) return;
    throw new Error('activeProfile must be null or a profile name');
  }
  const ok = Array.isArray(expected)
    ? Array.isArray(value)
    : typeof value === typeof expected && value !== null;
  if (!ok) {
    throw new Error(`${key} must be a ${Array.isArray(expected) ? 'list' : typeof expected}`);
  }
}
