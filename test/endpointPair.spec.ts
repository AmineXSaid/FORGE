/**
 * An endpoint and its model are one choice (2026-09-23).
 *
 * The user asked for the Genesis model: set up an endpoint *with* a model, pick
 * pairs in the chat, and never see Anthropic's default models. Four reports sat
 * behind it, and each has a check here:
 *
 * - the first message failed: the profile's model never reached the CLI, which
 *   launched with Claude's default and sent that id to the gateway;
 * - picking a model wrote a gateway id into ~/.claude/settings.json;
 * - a selected profile that could not start fell back to api.anthropic.com;
 * - the selection was written to Workspace settings with no folder open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  EndpointService,
  EndpointUnavailableError,
  relayEnvironment,
  resolveProfile,
} from '../src/services/endpoints/endpointService';
import { selectionTarget } from '../src/services/endpoints/selection';
import { parseProfile } from '../src/services/endpoints/profile';
import { ClaudeAgentService } from '../src/services/claude/ClaudeAgentService';

const A = parseProfile({ name: 'ollama-qwen', wire: 'openai', baseUrl: 'http://127.0.0.1:1/v1', model: 'qwen3-coder', auth: { kind: 'none' } }, 'test');
const B = parseProfile({ name: 'gateway-gpt', wire: 'openai', baseUrl: 'https://gw.example/v1', model: 'gpt-4o', auth: { kind: 'none' } }, 'test');

describe('which pair a launch runs on', () => {
  it('is the one selected, else the first that parses', () => {
    expect(resolveProfile([A, B], 'gateway-gpt')).toBe(B);
    expect(resolveProfile([A, B], '')).toBe(A);
    expect(resolveProfile([A, B], undefined)).toBe(A);
    expect(resolveProfile([A, B], 'gone')).toBeUndefined();
    expect(resolveProfile([], undefined)).toBeUndefined();
  });

  it('puts the model in every slot the CLI picks one from', () => {
    const env = relayEnvironment({ baseUrl: 'http://127.0.0.1:5555', token: 't' }, 'qwen3-coder');
    expect(env).toMatchObject({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:5555',
      ANTHROPIC_MODEL: 'qwen3-coder',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'qwen3-coder',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'qwen3-coder',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'qwen3-coder',
      CLAUDE_CODE_SUBAGENT_MODEL: 'qwen3-coder',
    });
  });
});

describe('where the selection is written', () => {
  it('is the user settings, unless a folder is open and already sets it', () => {
    expect(selectionTarget(undefined, false)).toBe(vscode.ConfigurationTarget.Global);
    expect(selectionTarget(undefined, true)).toBe(vscode.ConfigurationTarget.Global);
    // A workspace value wins, so writing the user one would change nothing.
    expect(selectionTarget('gateway-gpt', true)).toBe(vscode.ConfigurationTarget.Workspace);
    // No folder: never Workspace, which would throw.
    expect(selectionTarget('gateway-gpt', false)).toBe(vscode.ConfigurationTarget.Global);
  });
});

describe('a selected endpoint that cannot be used is an error, never Anthropic', () => {
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  let dir: string;

  function configure(endpoints: Record<string, unknown>, active: string): void {
    (vscode.workspace as any).getConfiguration = () => ({
      get: (key: string, fallback?: unknown) =>
        key === 'endpoints' ? endpoints : key === 'endpointProfilesDir' ? dir : key === 'endpointProfile' ? active : fallback,
      update: () => Promise.resolve(),
    });
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-pairs-'));
  });

  afterEach(() => {
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const service = () => new EndpointService(undefined, { info: () => {}, warn: () => {}, error: () => {} } as any);

  it('throws for a selected name that matches no profile', async () => {
    configure({ 'ollama-qwen': { wire: 'openai', baseUrl: 'http://127.0.0.1:1/v1', model: 'qwen3-coder', auth: { kind: 'none' } } }, 'deleted-one');
    await expect(service().getEnvironment()).rejects.toBeInstanceOf(EndpointUnavailableError);
    await expect(service().getEnvironment()).rejects.toThrow('could not find the endpoint "deleted-one"');
  });

  it('routes nothing when there is no profile at all (the chat shows its setup page)', async () => {
    configure({}, '');
    expect(await service().getEnvironment()).toEqual({});
  });

  it('uses the first profile when none is selected, with its model', async () => {
    configure({ 'ollama-qwen': { wire: 'openai', baseUrl: 'http://127.0.0.1:1/v1', model: 'qwen3-coder', auth: { kind: 'none' } } }, '');
    const svc = service();
    expect(svc.resolveActiveProfile()?.name).toBe('ollama-qwen');
    const env = await svc.getEnvironment();
    expect(env.ANTHROPIC_MODEL).toBe('qwen3-coder');
    expect(env.ANTHROPIC_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+/);
    await svc.reset();
  });
});

describe('set_model picks a pair', () => {
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  let updates: Array<[string, unknown, unknown]>;

  function agentService(profiles: unknown[]) {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const s = new (ClaudeAgentService as any)(
      log, {}, { getDefaultWorkspaceFolder: () => undefined }, {}, {}, {}, {},
      { getThinkingLevel: () => 'off' }, {}, {},
      { listProfiles: () => ({ profiles, errors: [] }), getStatus: () => ({}) },
      { onDidChangeHealth: () => ({ dispose() {} }) },
    );
    s.writeUserSettings = vi.fn(async () => {});
    return s;
  }

  beforeEach(() => {
    updates = [];
    (vscode.workspace as any).getConfiguration = () => ({
      get: (_k: string, fallback?: unknown) => fallback,
      inspect: () => ({ workspaceValue: undefined }),
      update: (key: string, value: unknown, target: unknown) => {
        updates.push([key, value, target]);
        return Promise.resolve();
      },
    });
  });

  afterEach(() => {
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
  });

  const setModel = (s: any, value: unknown, channelId?: string) =>
    s.processRequest({ type: 'request', requestId: 'r', channelId, request: { type: 'set_model', model: { value } } }, new AbortController().signal);

  it('selects the profile, with or without a live channel, and writes no CLI setting', async () => {
    const s = agentService([A, B]);
    expect(await setModel(s, 'gateway-gpt')).toEqual({ type: 'set_model_response' });
    expect(updates).toEqual([['endpointProfile', 'gateway-gpt', vscode.ConfigurationTarget.Global]]);
    // Never ~/.claude/settings.json: a gateway id there leaked into every other CLI session.
    expect(s.writeUserSettings).not.toHaveBeenCalled();
  });

  it('refuses a name the host does not know (B3), and anything when nothing is set up', async () => {
    await expect(setModel(agentService([A, B]), 'opus')).rejects.toThrow('Unknown endpoint: opus');
    await expect(setModel(agentService([]), 'default')).rejects.toThrow('Set up an endpoint first');
    await expect(setModel(agentService([A]), 42)).rejects.toThrow('set_model: malformed request');
    expect(updates).toEqual([]);
  });
});
