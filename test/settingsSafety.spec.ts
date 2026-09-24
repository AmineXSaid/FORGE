/**
 * Forge never damages the user's Claude Code settings.
 *
 * Found in the production-readiness audit (2026-09-24). On every VS Code start
 * the configuration service merged five defaults into ~/.claude/settings.json.
 * Two problems:
 *
 * - The file was read with a helper that answered `{}` when it did not parse
 *   (a comment, a trailing comma, a read while the CLI was writing it), so the
 *   "merge" wrote back Forge's five keys and nothing else: the user's settings
 *   were gone.
 * - Even when it parsed, the defaults (attribution off, `skipWebFetchPreflight`,
 *   three env variables) changed the Claude Code CLI everywhere, the terminal
 *   included, not only the sessions Forge launches.
 *
 * Now startup writes nothing there. The defaults go to Forge's own flag layer
 * (~/.claude/forge.json, passed with `--settings`), only for keys none of the
 * user's layers sets; every settings write refuses a file that does not parse;
 * and writes are atomic.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigurationService, assertExtensionConfigEntry } from '../src/services/configurationService';

let home: string;
let savedHome: Record<string, string | undefined>;

const claudeDir = () => path.join(home, '.claude');
const settingsPath = () => path.join(claudeDir(), 'settings.json');
const forgeJsonPath = () => path.join(claudeDir(), 'forge.json');
const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));

/** The file-system service surface the configuration service uses, on the real disk. */
const fileSystem = {
  pathExists: async (p: string) => fs.existsSync(p),
  readFile: async (uri: { fsPath: string }) => new Uint8Array(fs.readFileSync(uri.fsPath)),
  readDirectory: async (uri: { fsPath: string }) =>
    fs.readdirSync(uri.fsPath, { withFileTypes: true }).map((d) => [d.name, d.isFile() ? 1 : 2] as [string, number]),
  createDirectory: async (uri: { fsPath: string }) => { fs.mkdirSync(uri.fsPath, { recursive: true }); },
  writeFile: async (uri: { fsPath: string }, data: Uint8Array) => fs.writeFileSync(uri.fsPath, data),
} as any;

/** A service, and the moment its startup work has finished. */
async function start(): Promise<ConfigurationService> {
  const service = new ConfigurationService(fileSystem);
  // `initialize()` runs from the constructor; wait for forge.json to land.
  for (let i = 0; i < 100 && !fs.existsSync(forgeJsonPath()); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  await new Promise((r) => setTimeout(r, 20));
  return service;
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-settings-'));
  savedHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  for (const name of ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'CLAUDE_CODE_ATTRIBUTION_HEADER', 'DISABLE_INSTALLATION_CHECKS']) {
    delete process.env[name];
  }
});

afterEach(() => {
  process.env.HOME = savedHome.HOME;
  process.env.USERPROFILE = savedHome.USERPROFILE;
  fs.rmSync(home, { recursive: true, force: true });
});

describe('startup', () => {
  it('does not create ~/.claude/settings.json', async () => {
    await start();
    expect(fs.existsSync(settingsPath())).toBe(false);
  });

  it('leaves an existing settings.json byte for byte as it was', async () => {
    fs.mkdirSync(claudeDir(), { recursive: true });
    const original = '{\n  "model": "opus",\n  "permissions": { "allow": ["Bash(ls:*)"] }\n}\n';
    fs.writeFileSync(settingsPath(), original);

    await start();

    expect(fs.readFileSync(settingsPath(), 'utf8')).toBe(original);
  });

  it('leaves a settings.json that does not parse untouched, instead of replacing it', async () => {
    // The data-loss case: a comment (or a trailing comma) used to read as {}
    // and the file was rewritten with Forge's defaults alone.
    fs.mkdirSync(claudeDir(), { recursive: true });
    const original = '{\n  // my model\n  "model": "opus",\n}\n';
    fs.writeFileSync(settingsPath(), original);

    await start();

    expect(fs.readFileSync(settingsPath(), 'utf8')).toBe(original);
  });

  it("puts Forge's defaults in forge.json, for Forge's own launches only", async () => {
    await start();
    const flags = readJson(forgeJsonPath());

    expect(flags.attribution).toEqual({ commit: '', pr: '' });
    expect(flags.skipWebFetchPreflight).toBe(true);
    expect(flags.env).toEqual({
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CLAUDE_CODE_ATTRIBUTION_HEADER: '0',
      DISABLE_INSTALLATION_CHECKS: '1',
    });
    // Never the permission lists: those are the user's to write.
    expect(flags).not.toHaveProperty('permissions');
  });

  it("leaves out every default the user's own settings already set, so theirs wins", async () => {
    fs.mkdirSync(claudeDir(), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify({
      attribution: { commit: 'Co-authored-by: me', pr: '' },
      env: { CLAUDE_CODE_ATTRIBUTION_HEADER: '1' },
    }));

    await start();
    const flags = readJson(forgeJsonPath());

    // forge.json outranks user settings, so a default here would silently win.
    expect(flags).not.toHaveProperty('attribution');
    expect(flags.env).not.toHaveProperty('CLAUDE_CODE_ATTRIBUTION_HEADER');
    expect(flags.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
    expect(flags.skipWebFetchPreflight).toBe(true);
  });

  it('leaves out a default variable the environment already sets', async () => {
    process.env.DISABLE_INSTALLATION_CHECKS = '0';
    await start();
    expect(readJson(forgeJsonPath()).env).not.toHaveProperty('DISABLE_INSTALLATION_CHECKS');
    delete process.env.DISABLE_INSTALLATION_CHECKS;
  });
});

describe('writes', () => {
  it('refuses to write a settings file that does not parse, and leaves it as it was', async () => {
    const service = await start();
    fs.mkdirSync(claudeDir(), { recursive: true });
    const original = '{ "model": "opus", }';
    fs.writeFileSync(settingsPath(), original);

    await expect(service.updateSetting('model', 'sonnet', 'global')).rejects.toThrow(/not valid JSON/);
    await expect(service.resetSetting('model', 'global')).rejects.toThrow(/not valid JSON/);
    expect(fs.readFileSync(settingsPath(), 'utf8')).toBe(original);
  });

  it('writes a valid file whole, with no temp file left behind', async () => {
    const service = await start();
    await service.updateSetting('model', 'sonnet', 'global');

    expect(readJson(settingsPath()).model).toBe('sonnet');
    expect(fs.readdirSync(claudeDir()).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('a key the user sets stops being one of the launch defaults', async () => {
    const service = await start();
    expect(readJson(forgeJsonPath())).toHaveProperty('skipWebFetchPreflight');

    await service.updateSetting('skipWebFetchPreflight', false, 'global');

    expect(readJson(forgeJsonPath())).not.toHaveProperty('skipWebFetchPreflight');
  });
});

describe('profile names are checked before they become paths (B3)', () => {
  it.each(['../settings', '..\\x', 'a/b', '', ' ', 'x.json'])('refuses %j', async (name) => {
    const service = await start();
    await expect(service.deleteProfile(name)).rejects.toThrow(/Invalid profile name/);
    await expect(service.switchProfile(name)).rejects.toThrow(/Invalid profile name/);
    await expect(service.createProfile(name)).rejects.toThrow(/Invalid profile name/);
  });

  it('cannot delete a file outside the profile naming scheme', async () => {
    const service = await start();
    fs.mkdirSync(claudeDir(), { recursive: true });
    const victim = path.join(home, 'keep.json');
    fs.writeFileSync(victim, '{}');

    await expect(service.deleteProfile('../../keep')).rejects.toThrow();
    expect(fs.existsSync(victim)).toBe(true);
  });

  it('still creates, switches to and deletes a real profile', async () => {
    const service = await start();
    await service.createProfile('work_1');
    await service.switchProfile('work_1');
    expect(service.activeProfile).toBe('work_1');
    await service.deleteProfile('work_1');
    expect(service.activeProfile).toBeNull();
    expect(fs.existsSync(path.join(claudeDir(), 'settings.work_1.json'))).toBe(false);
  });
});

describe('extension config keys (B3)', () => {
  const defaults = {
    activeProfile: null,
    defaultPermissionMode: 'default',
    defaultModel: 'default',
    defaultThinkingLevel: 'default_on',
    systemNotifications: false,
    completionSound: true,
    focusView: false,
    customModels: [],
    disabledModels: [],
  } as any;

  it('accepts its own keys with the right types', () => {
    expect(() => assertExtensionConfigEntry('focusView', true, defaults)).not.toThrow();
    expect(() => assertExtensionConfigEntry('disabledModels', ['x'], defaults)).not.toThrow();
    expect(() => assertExtensionConfigEntry('activeProfile', null, defaults)).not.toThrow();
    expect(() => assertExtensionConfigEntry('activeProfile', 'work', defaults)).not.toThrow();
  });

  it.each([
    ['unknown key', '__proto__', {}],
    ['unknown key', 'apiKeyHelper', 'x'],
    ['wrong type', 'focusView', 'yes'],
    ['wrong type', 'disabledModels', 'x'],
    ['bad profile', 'activeProfile', '../x'],
  ])('refuses a %s (%s)', (_what, key, value) => {
    expect(() => assertExtensionConfigEntry(key, value, defaults)).toThrow();
  });

  it('the service applies the check before writing', async () => {
    const service = await start();
    await expect(service.updateExtensionConfig('nope' as any, 1 as any)).rejects.toThrow(/Unknown Forge setting/);
    await service.updateExtensionConfig('focusView', true);
    expect(readJson(path.join(home, '.forge.json')).focusView).toBe(true);
  });
});
