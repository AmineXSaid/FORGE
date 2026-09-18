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

  // Default keys injected into ~/.claude/settings.json on first use.
  // Only missing keys are inserted; existing user values are never overwritten.
  // These become part of userSettings (lowest user-controlled priority).
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
    await this.ensureExtensionConfigExists();

    // Ensure CLI config (~/.claude/forge.json) exists with default template
    await this.ensureForgeExists();

    // Load active profile from extension config (~/.forge.json)
    const extensionConfig = await this.readJsonFile(this.getExtensionConfigPath());
    this._activeProfile = extensionConfig.activeProfile ?? null;

    // Ensure default global settings exist
    await this.ensureGlobalSettingsExist();

    // Load all layers
    await this.reloadAll();
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
    if (!name || !/^[a-zA-Z0-9_\-]+$/.test(name)) {
      throw new Error(
        'Invalid profile name. Use only alphanumeric characters, underscores, and hyphens.'
      );
    }

    const filename = `settings.${name}.json`;
    const filepath = path.join(os.homedir(), '.claude', filename);

    if (await this.fileSystemService.pathExists(filepath)) {
      throw new Error(`Profile '${name}' already exists.`);
    }

    // Create empty settings file
    await this.writeJsonFile(filepath, {});
  }

  async deleteProfile(name: string): Promise<void> {
    if (!name) {return;}

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

  private async readJsonFile(filePath: string | undefined): Promise<any> {
    if (!filePath) {
      return {};
    }
    // Use fileSystemService.readFile (returns Uint8Array)
    try {
      const uri = vscode.Uri.file(filePath);
      const contentBytes = await this.fileSystemService.readFile(uri);
      const content = new TextDecoder().decode(contentBytes);
      return JSON.parse(content);
    } catch (error) {
      // Log only if it's not a "File not found" which is expected for optional configs
      // console.error(`[Config] Failed to read ${filePath}:`, error);
      return {};
    }
  }

  private async writeJsonFile(filePath: string | undefined, content: any): Promise<void> {
    if (!filePath) {return;}
    try {
      const uri = vscode.Uri.file(filePath);
      const dirUri = vscode.Uri.file(path.dirname(filePath));

      // Allow mkdir to fail if dir exists? vscode.fs.createDirectory is usually safe/idempotent-ish or throws if existing is file
      // Let's check existence first or just try create
      try {
        await this.fileSystemService.createDirectory(dirUri);
      } catch (e) {
        // Ignore if it already exists as directory
      }

      const contentStr = JSON.stringify(content, null, 2);
      await this.fileSystemService.writeFile(uri, new TextEncoder().encode(contentStr));
    } catch (error) {
      console.error(`[Config] Failed to write ${filePath}:`, error);
    }
  }

  /**
   * Ensure ~/.claude/settings.json exists and contains required defaults.
   *
   * This is the correct place to inject extension defaults (permissions, env, mcpServers, etc.)
   * because settings.json is the userSettings layer — the lowest user-controlled priority.
   * Profile overrides, project settings, and policy settings all naturally take precedence.
   *
   * Only inserts missing top-level keys; never overwrites existing user values.
   */
  private async ensureGlobalSettingsExist() {
    const defaultPath = this.getGlobalSettingsPath(null);
    let existing: any = {};

    if (await this.fileSystemService.pathExists(defaultPath)) {
      existing = await this.readJsonFile(defaultPath);
    }

    // Merge: only fill in keys that don't exist yet
    let changed = false;
    for (const [key, value] of Object.entries(this._defaultTemplate)) {
      if (!(key in existing)) {
        existing[key] = value;
        changed = true;
      }
    }

    if (changed || !await this.fileSystemService.pathExists(defaultPath)) {
      await this.writeJsonFile(defaultPath, existing);
    }
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
   * Ensure forge.json exists with default template
   */
  private async ensureForgeExists(): Promise<void> {
    const forgePath = this.getForgeConfigPath();
    if (!(await this.fileSystemService.pathExists(forgePath))) {
      // Empty object — SDK reads ~/.claude/settings.json via userSettings layer,
      // forge.json only serves as flagSettings overlay for profile-specific overrides
      await this.writeJsonFile(forgePath, {});
    }
  }

  /**
   * Sync current Profile content to forge.json
   *
   * forge.json is passed to SDK via --settings flag as the flagSettings layer.
   * SDK already reads ~/.claude/settings.json as userSettings (lower priority).
   * So forge.json only needs profile-specific overrides, NOT a full copy.
   *
   * - No profile (Default): write empty object — SDK uses settings.json directly
   * - With profile: write profile file content — SDK merges over settings.json
   */
  async syncProfileToForge(): Promise<void> {
    const forgePath = this.getForgeConfigPath();

    if (!this._activeProfile) {
      // Default Profile: no overrides needed, SDK reads settings.json via userSettings
      await this.writeJsonFile(forgePath, {});
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
    await this.writeJsonFile(forgePath, stripFlagReservedKeys(profileContent));
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
    // polluting profile files with inherited default-settings keys.
    const fileContent = await this.readJsonFile(filePath);

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

    // When updating global settings, sync to forge.json for CLI hot-reload
    if (target === 'global') {
      await this.syncProfileToForge();
    }
  }

  async resetSetting(key: string, target: 'local' | 'shared' | 'global'): Promise<void> {
    const filePath = this.resolveTargetPath(target);

    // Read actual file content, modify only the target key
    const fileContent = await this.readJsonFile(filePath);

    if (key in fileContent) {
      delete fileContent[key];
      await this.writeJsonFile(filePath, fileContent);

      // Reload in-memory caches
      await this.reloadAll();

      // When resetting global settings, sync to forge.json for CLI hot-reload
      if (target === 'global') {
        await this.syncProfileToForge();
      }
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
    const configPath = this.getExtensionConfigPath();
    const current = await this.readJsonFile(configPath);

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
