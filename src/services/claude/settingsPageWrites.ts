/**
 * What the Settings page may write through `update_setting` / `reset_setting`.
 *
 * B3: the webview is untrusted input. These requests used to write any key
 * with any value into a Claude Code settings file. The page only ever writes
 * the keys below (every `setting-key` and every literal `updateSetting` /
 * `resetSetting` key under `src/webview/src`), so anything else is refused.
 * Types and enums are the CLI's own, from the bundled
 * `resources/claude-code-settings.schema.json`; the two keys that schema does
 * not list are the page's own booleans.
 */

type ValueType = 'boolean' | 'integer' | 'string' | 'array' | 'object';

interface KeyRule {
    type: ValueType;
    enum?: readonly string[];
}

export const SETTINGS_PAGE_KEYS: Readonly<Record<string, KeyRule>> = {
    alwaysThinkingEnabled: { type: 'boolean' },
    apiKeyHelper: { type: 'string' },
    attribution: { type: 'object' },
    autoUpdatesChannel: { type: 'string', enum: ['latest', 'stable', 'rc'] },
    cleanupPeriodDays: { type: 'integer' },
    companyAnnouncements: { type: 'array' },
    completionSound: { type: 'boolean' },
    disableAllHooks: { type: 'boolean' },
    disabledMcpjsonServers: { type: 'array' },
    effortLevel: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh'] },
    enableAllProjectMcpServers: { type: 'boolean' },
    enabledMcpjsonServers: { type: 'array' },
    env: { type: 'object' },
    forceLoginMethod: { type: 'string', enum: ['claudeai', 'console', 'gateway'] },
    hooks: { type: 'object' },
    language: { type: 'string' },
    outputStyle: { type: 'string' },
    permissions: { type: 'object' },
    plansDirectory: { type: 'string' },
    respectGitignore: { type: 'boolean' },
    sandbox: { type: 'object' },
    showTurnDuration: { type: 'boolean' },
    systemNotifications: { type: 'boolean' },
    teammateMode: { type: 'string', enum: ['auto', 'tmux', 'iterm2', 'in-process'] },
};

export type SettingsTarget = 'local' | 'shared' | 'global';

const TARGETS: readonly SettingsTarget[] = ['local', 'shared', 'global'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matches(rule: KeyRule, value: unknown): boolean {
    switch (rule.type) {
        case 'boolean': return typeof value === 'boolean';
        case 'integer': return Number.isInteger(value);
        case 'string': return typeof value === 'string' && (!rule.enum || rule.enum.includes(value));
        case 'array': return Array.isArray(value);
        case 'object': return isPlainObject(value);
    }
}

/** The key is one the page writes; the target is a real layer. Throws otherwise. */
export function assertSettingsPageKey(key: unknown, target: unknown): asserts key is string {
    if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(SETTINGS_PAGE_KEYS, key)) {
        throw new Error(`The Settings page cannot change "${String(key)}".`);
    }
    if (!TARGETS.includes(target as SettingsTarget)) {
        throw new Error(`Unknown settings layer: ${String(target)}`);
    }
}

/** `assertSettingsPageKey`, and the value has the CLI's type for that key. */
export function assertSettingsPageWrite(key: unknown, value: unknown, target: unknown): void {
    assertSettingsPageKey(key, target);
    const rule = SETTINGS_PAGE_KEYS[key];
    if (!matches(rule, value)) {
        const expected = rule.enum ? `one of ${rule.enum.join(', ')}` : `a ${rule.type}`;
        throw new Error(`${key} must be ${expected}.`);
    }
}
