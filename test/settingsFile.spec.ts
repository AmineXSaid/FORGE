/**
 * Settings files are read strictly and written atomically, everywhere.
 *
 * Production audit (2026-09-24). `configurationService` was fixed first; the
 * same `{}`-on-a-parse-error read was still in `ClaudeAgentService`'s
 * `writeUserSettings` (the `apply_settings` userSettings layer: effort), so
 * choosing an effort level with a `settings.json` that held a comment rewrote
 * the file with `effortLevel` alone. Both now share `settingsFile.ts`.
 *
 * Also here: Forge's launch defaults reach the CLI through the launch
 * environment, at the lowest priority, as well as through forge.json.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SettingsFileUnreadableError,
  parseJsonObject,
  readJsonObjectForWrite,
  writeJsonAtomic,
} from '../src/services/settingsFile';
import { mergeLaunchEnvironment } from '../src/services/claude/cliLaunch';
import { ClaudeAgentService } from '../src/services/claude/ClaudeAgentService';
import { ClaudeSdkService } from '../src/services/claude/ClaudeSdkService';

let dir: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-settings-file-'));
  saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
});

afterEach(() => {
  process.env.HOME = saved.HOME;
  process.env.USERPROFILE = saved.USERPROFILE;
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('readJsonObjectForWrite', () => {
  it('answers {} for a file that does not exist', async () => {
    expect(await readJsonObjectForWrite(path.join(dir, 'nope.json'))).toEqual({});
  });

  it('answers {} for an empty file', async () => {
    const file = path.join(dir, 'empty.json');
    fs.writeFileSync(file, '  \n');
    expect(await readJsonObjectForWrite(file)).toEqual({});
  });

  it('reads a file with a byte order mark, as Windows editors write it', async () => {
    const file = path.join(dir, 'bom.json');
    fs.writeFileSync(file, '﻿{"model":"opus"}');
    expect(await readJsonObjectForWrite(file)).toEqual({ model: 'opus' });
  });

  it.each([
    ['a comment', '{\n  // mine\n  "model": "opus"\n}'],
    ['a trailing comma', '{ "model": "opus", }'],
    ['half a file', '{ "model": "op'],
    ['an array', '["model"]'],
    ['a string', '"model"'],
    ['null', 'null'],
  ])('throws on %s instead of answering {}', async (_what, content) => {
    const file = path.join(dir, 'bad.json');
    fs.writeFileSync(file, content);
    await expect(readJsonObjectForWrite(file)).rejects.toBeInstanceOf(SettingsFileUnreadableError);
  });

  it('names the file and says it was left alone', () => {
    expect(() => parseJsonObject('/x/settings.json', '{')).toThrow(/\/x\/settings\.json is not valid JSON.*left unchanged/);
  });
});

describe('writeJsonAtomic', () => {
  it('writes two-space JSON with a trailing newline, creating the folder', async () => {
    const file = path.join(dir, 'a', 'b', 'settings.json');
    await writeJsonAtomic(file, { model: 'opus' });
    expect(fs.readFileSync(file, 'utf8')).toBe('{\n  "model": "opus"\n}\n');
  });

  it('leaves no temp file behind', async () => {
    const file = path.join(dir, 'settings.json');
    await writeJsonAtomic(file, { a: 1 });
    await writeJsonAtomic(file, { a: 2 });
    expect(fs.readdirSync(dir)).toEqual(['settings.json']);
  });

  it('retries a rename Windows refuses for a moment, then succeeds', async () => {
    const file = path.join(dir, 'settings.json');
    const real = fs.promises.rename;
    let calls = 0;
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (++calls < 3) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      return real(from, to);
    });
    await writeJsonAtomic(file, { a: 1 });
    expect(calls).toBe(3);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ a: 1 });
  });

  it('gives up on a rename that keeps failing, keeps the old file and removes the temp file', async () => {
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '{"old":true}');
    vi.spyOn(fs.promises, 'rename').mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
    await expect(writeJsonAtomic(file, { a: 1 })).rejects.toThrow(/denied/);
    expect(fs.readFileSync(file, 'utf8')).toBe('{"old":true}');
    expect(fs.readdirSync(dir)).toEqual(['settings.json']);
  });

  it('does not retry an error that is not transient', async () => {
    const file = path.join(dir, 'settings.json');
    const rename = vi.spyOn(fs.promises, 'rename').mockRejectedValue(Object.assign(new Error('no'), { code: 'EXDEV' }));
    await expect(writeJsonAtomic(file, {})).rejects.toThrow(/no/);
    expect(rename).toHaveBeenCalledTimes(1);
  });
});

describe('apply_settings to userSettings (effort)', () => {
  const service = () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const s = new (ClaudeAgentService as any)(log, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {});
    s.channels = new Map();
    return s;
  };
  const settingsPath = () => path.join(dir, '.claude', 'settings.json');

  it('refuses a settings.json that does not parse and leaves it byte for byte', async () => {
    fs.mkdirSync(path.join(dir, '.claude'));
    const original = '{\n  // my model\n  "model": "opus",\n}\n';
    fs.writeFileSync(settingsPath(), original);

    await expect(service().applySettings(undefined, { effortLevel: 'high' })).rejects.toThrow(/not valid JSON/);

    expect(fs.readFileSync(settingsPath(), 'utf8')).toBe(original);
  });

  it('merges into a valid file, keeping every other key', async () => {
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.writeFileSync(settingsPath(), JSON.stringify({ model: 'opus', permissions: { allow: ['Bash(ls:*)'] } }));

    await service().applySettings(undefined, { effortLevel: 'high' });

    expect(JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))).toEqual({
      model: 'opus',
      permissions: { allow: ['Bash(ls:*)'] },
      effortLevel: 'high',
    });
    expect(fs.readdirSync(path.join(dir, '.claude'))).toEqual(['settings.json']);
  });

  it('creates the file when there is none', async () => {
    await service().applySettings(undefined, { effortLevel: 'low' });
    expect(JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))).toEqual({ effortLevel: 'low' });
  });
});

describe("Forge's launch defaults reach the CLI environment", () => {
  it('sit under everything else: the host, the official defaults, the user and the endpoint', () => {
    const { env } = mergeLaunchEnvironment(
      { A: 'host' },
      { D: 'endpoint' },
      { C: 'user' },
      { A: 'forge', B: 'forge', C: 'forge', D: 'forge', CLAUDE_CODE_ATTRIBUTION_HEADER: '0' },
    );
    expect(env).toMatchObject({ A: 'host', B: 'forge', C: 'user', D: 'endpoint', CLAUDE_CODE_ATTRIBUTION_HEADER: '0' });
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBe('claude-vscode');
  });

  it("are what a launch's environment carries, after startup has finished", async () => {
    const order: string[] = [];
    const sdk = Object.create(ClaudeSdkService.prototype);
    Object.assign(sdk, {
      logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      endpointService: { getEnvironment: async () => ({}) },
      configService: {
        getEnvironmentVariables: async () => ({}),
        whenReady: async () => { order.push('ready'); },
        forgeLaunchDefaults: () => {
          order.push('defaults');
          return { env: { FORGE_TEST_DEFAULT: '1' }, attribution: { commit: '', pr: '' } };
        },
      },
    });

    const env = await sdk.getMergedEnvironmentVariables();

    expect(env.FORGE_TEST_DEFAULT).toBe('1');
    expect(order).toEqual(['ready', 'defaults']);
  });
});
