/**
 * The chat's model picker: one row per endpoint, each the endpoint with its one
 * model (the Genesis model the user asked for on 2026-09-23).
 *
 * History, because it explains the shape. The picker used to serve the CLI's
 * model table (Anthropic tiers) until a gateway listing arrived, with a 6s
 * budget after which the Anthropic table was served anyway, and then every id
 * the gateway listed. Two reports followed: the picker offered models the
 * endpoint does not serve, and it showed Anthropic tiers at all. Now the rows
 * come from the profiles alone -- no network, no CLI table, no fallback -- and
 * a profile's `model` is the model.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CONFIG_PROBE_BUDGET_MS,
  handleGetClaudeState,
  handleSdkProbe,
  resetConfigProbe,
} from '../src/services/claude/handlers/handlers';
import { parseProfile } from '../src/services/endpoints/profile';
import { pairRow, profileModelRows, isEffortLevel, EFFORT_LEVELS } from '../src/services/endpoints/models';

/** Anthropic tiers, which is what the CLI reports however the endpoint is pointed. */
const CLI_MODELS = [
  { value: 'default', displayName: 'Default (recommended)', description: 'Sonnet' },
  { value: 'opus', displayName: 'Opus', description: 'Opus' },
];

const GATEWAY = parseProfile(
  {
    name: 'omniroute',
    wire: 'openai',
    baseUrl: 'http://localhost:20128/v1',
    model: 'auto',
    auth: { kind: 'none' },
    models: [{ id: 'auto', supportsEffort: true }, { id: 'best-fast' }],
    capabilities: { effort: true },
  },
  'test',
);

const OLLAMA = parseProfile(
  { name: 'ollama-qwen', wire: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen3-coder', auth: { kind: 'none' } },
  'test',
);

/**
 * A handler context whose CLI config probe takes `probeMs` to answer.
 *
 * `query()` is what `loadConfig` calls; everything it awaits is stubbed to
 * resolve after that delay, which is how a slow launch is reproduced without
 * one.
 */
function context(opts: { profiles?: any[]; probeMs?: number; health?: Record<string, any> } = {}) {
  const delay = opts.probeMs ?? 0;
  const after = <T>(value: T) => new Promise<T>((r) => setTimeout(() => r(value), delay));
  const profiles = opts.profiles ?? [];
  return {
    logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
    workspaceService: { getDefaultWorkspaceFolder: () => undefined },
    agentService: { noteClaudeSettings: vi.fn(), schedulePushStateUpdate: vi.fn() },
    endpointService: {
      listProfiles: () => ({ profiles, errors: [] }),
      resolveActiveProfile: () => profiles[0],
      getStatus: () => ({ profile: profiles[0], report: [], errors: [], available: profiles }),
      servedModels: vi.fn(async () => ['should', 'not', 'be', 'asked']),
    },
    endpointHealthService: { getHealth: (name: string) => opts.health?.[name] },
    sdkService: {
      query: async () => ({
        initializationResult: () => after({ models: CLI_MODELS, unavailable_models: [{ value: 'opus[1m]' }] }),
        supportedCommands: () => after([{ name: 'compact' }]),
        accountInfo: () => after(null),
        return: async () => {},
      }),
      probe: async () => ({ data: { supportedModels: CLI_MODELS, supportedCommands: [] }, errors: { supportedModels: 'x' } }),
    },
  } as any;
}

describe('where the picker gets its models', () => {
  it('serves one row per endpoint, each its own model, and never the CLI tiers', async () => {
    const response = await handleGetClaudeState(
      { type: 'get_claude_state' } as any,
      context({ profiles: [GATEWAY, OLLAMA] }),
    );
    expect(response.config.models.map((m: any) => [m.value, m.displayName])).toEqual([
      ['omniroute', 'auto'],
      ['ollama-qwen', 'qwen3-coder'],
    ]);
    const values = response.config.models.map((m: any) => m.value);
    expect(values).not.toContain('opus');
    expect(values).not.toContain('default');
    expect(response.config.unavailable_models).toBeUndefined();
  });

  it('never asks the gateway to list its models, so the picker does not wait on it', async () => {
    const ctx = context({ profiles: [GATEWAY] });
    await handleGetClaudeState({ type: 'get_claude_state' } as any, ctx);
    expect(ctx.endpointService.servedModels).not.toHaveBeenCalled();
  });

  it('serves no models at all, not the Anthropic table, when no endpoint exists', async () => {
    const response = await handleGetClaudeState({ type: 'get_claude_state' } as any, context({}));
    expect(response.config.models).toEqual([]);
    expect(response.config.unavailable_models).toBeUndefined();
  });

  it('agrees with what sdk_probe serves, because both read one function', async () => {
    const ctx = context({ profiles: [GATEWAY, OLLAMA] });
    const state = await handleGetClaudeState({ type: 'get_claude_state' } as any, ctx);
    const probe = await handleSdkProbe({ type: 'sdk_probe', capabilities: ['supportedModels'] } as any, ctx);
    expect(probe.data.supportedModels).toEqual(state.config.models);
    // The CLI's own supportedModels error is about a table nobody reads.
    expect(probe.errors?.supportedModels).toBeUndefined();
  });

  it('sdk_probe serves no Anthropic tiers either, with no endpoint', async () => {
    const probe = await handleSdkProbe({ type: 'sdk_probe', capabilities: ['supportedModels'] } as any, context({}));
    expect(probe.data.supportedModels).toEqual([]);
  });
});

describe('a pair row', () => {
  it('reads as the model, with the endpoint and its host beside it', () => {
    const row = pairRow(OLLAMA);
    expect(row).toMatchObject({ value: 'ollama-qwen', displayName: 'qwen3-coder', description: 'ollama-qwen · localhost:11434 · not checked yet' });
    expect(row.supportsAutoMode).toBe(false);
  });

  it('takes the declared entry for its model, capabilities included, and ignores the rest', () => {
    const row = pairRow(GATEWAY);
    expect(row.displayName).toBe('auto');
    expect(row.supportsEffort).toBe(true);
  });

  it('carries what the last health check measured, and says why when the pair is not answering', () => {
    const answered = pairRow(OLLAMA, { models: [{ id: 'qwen3-coder', servable: true, ms: 1234 }] });
    expect(answered.check).toEqual({ state: 'answered', ms: 1234, checkedAt: undefined });
    // The ping is drawn as a chip from `check`; the description stays the place.
    expect(answered.description).toBe('ollama-qwen · localhost:11434');
    expect(pairRow(OLLAMA, { models: [{ id: 'qwen3-coder', servable: false, ms: 0, detail: '404 model not found' }] }).description)
      .toBe('ollama-qwen · localhost:11434 · did not answer: 404 model not found');
    expect(pairRow(OLLAMA, { error: 'connect ECONNREFUSED', models: [] }).description)
      .toBe('ollama-qwen · localhost:11434 · could not be checked: connect ECONNREFUSED');
    expect(pairRow(OLLAMA, { models: [], syncing: true }).description)
      .toBe('ollama-qwen · localhost:11434 · checking…');
    // A verdict about some other model says nothing about this pair.
    expect(pairRow(OLLAMA, { models: [{ id: 'llama3', servable: false, ms: 0 }] }).description)
      .toBe('ollama-qwen · localhost:11434 · not checked yet');
  });
});

describe('the picker cannot be held up forever', () => {
  // The budget, the fallback probe and the push are exercised on a fake clock
  // in claudeStateHandshake.spec.ts and configResolver.spec.ts.
  it('is the budget the handler actually applies', () => {
    // If this drifts, the two tests above stop describing production.
    expect(CONFIG_PROBE_BUDGET_MS).toBeGreaterThanOrEqual(2000);
    expect(CONFIG_PROBE_BUDGET_MS).toBeLessThanOrEqual(15_000);
  });

  it('still returns the CLI commands through the handler when the probe is quick', async () => {
    resetConfigProbe();
    const response = await handleGetClaudeState(
      { type: 'get_claude_state' } as any,
      context({ profiles: [GATEWAY], probeMs: 5 }),
    );
    expect(response.config.commands).toEqual([{ name: 'compact' }]);
    expect(response.config.models.map((m: any) => m.value)).toEqual(['omniroute']);
  });
});

describe('effort levels a gateway invents', () => {
  it('are dropped, because the slider has no notch for them', () => {
    const odd = parseProfile(
      {
        name: 'gw', wire: 'openai', baseUrl: 'http://x/v1', model: 'm', auth: { kind: 'none' },
        capabilities: { effort: true, effortLevels: ['low', 'turbo', 'high'] },
      },
      'test',
    );
    const [row] = profileModelRows(odd);
    expect(row.supportedEffortLevels).toEqual(['low', 'high']);
  });

  it('recognises exactly the levels the UI can render', () => {
    expect([...EFFORT_LEVELS]).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    for (const level of EFFORT_LEVELS) expect(isEffortLevel(level)).toBe(true);
    for (const bad of ['turbo', 'LOW', '', 'ultra']) expect(isEffortLevel(bad)).toBe(false);
  });
});
