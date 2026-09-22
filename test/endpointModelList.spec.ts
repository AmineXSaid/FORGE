/**
 * The chat's model picker, with an endpoint profile active.
 *
 * Reported from a real install against an omniroute gateway: "I made an
 * endpoint, check the list of models it returned right, but when I went to the
 * models selection list it didn't load anything for a while."
 *
 * Two separate defects sat behind that.
 *
 * 1. **Wrong source.** `sdk_probe` replaced the CLI's model table with the
 *    profile's rows; `get_claude_state` did not. The chat picker reads
 *    `claudeConfig.models`, which comes from `get_claude_state`, so Settings >
 *    Models showed the gateway's models while the picker beside the composer
 *    showed Anthropic tiers the gateway does not serve. The relay never serves
 *    `/models` to the CLI, so `initializationResult()` always reports the
 *    CLI's built-in list whatever the endpoint runs.
 *
 * 2. **Unbounded wait.** `get_claude_state` launches the real CLI and awaits
 *    its initialize, and `BaseTransport.initialize` does not reach "connected"
 *    until it answers. With a relay in front that is a relay start plus a CLI
 *    handshake through the gateway -- which is the "Loading models…" the user
 *    was looking at. The gateway itself answered `/v1/models` in 31ms, so the
 *    wait was never the gateway's.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CONFIG_PROBE_BUDGET_MS,
  handleGetClaudeState,
  loadConfigBounded,
} from '../src/services/claude/handlers/handlers';
import { parseProfile } from '../src/services/endpoints/profile';
import { profileModelRows, isEffortLevel, EFFORT_LEVELS } from '../src/services/endpoints/models';

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
    models: [{ id: 'auto' }, { id: 'best-fast' }],
  },
  'test',
);

/**
 * A handler context whose CLI config probe takes `probeMs` to answer.
 *
 * `query()` is what `loadConfig` calls; everything it awaits is stubbed to
 * resolve after that delay, which is how a slow launch is reproduced without
 * one.
 */
function context(opts: { profile?: any; probeMs?: number; served?: string[] } = {}) {
  const delay = opts.probeMs ?? 0;
  const after = <T>(value: T) => new Promise<T>((r) => setTimeout(() => r(value), delay));
  return {
    logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    workspaceService: { getDefaultWorkspaceFolder: () => undefined },
    agentService: { noteClaudeSettings: vi.fn() },
    endpointService: {
      getStatus: () => ({ profile: opts.profile, report: [], errors: [], available: [] }),
      servedModels: async () => opts.served,
    },
    sdkService: {
      query: async () => ({
        initializationResult: () => after({ models: CLI_MODELS }),
        supportedCommands: () => after([{ name: 'compact' }]),
        accountInfo: () => after(null),
        return: async () => {},
      }),
    },
  } as any;
}

describe('where the picker gets its models', () => {
  it('serves the profile’s models, not the CLI’s Anthropic tiers', async () => {
    const response = await handleGetClaudeState({ type: 'get_claude_state' } as any, context({ profile: GATEWAY }));

    expect(response.config.models.map((m: any) => m.value)).toEqual(['auto', 'best-fast']);
    expect(response.config.models.map((m: any) => m.value)).not.toContain('opus');
  });

  it('drops unavailable_models, which are Anthropic tiers the gateway never offered', async () => {
    const ctx = context({ profile: GATEWAY });
    ctx.sdkService.query = async () => ({
      initializationResult: async () => ({ models: CLI_MODELS, unavailable_models: [{ value: 'opus[1m]' }] }),
      supportedCommands: async () => [],
      accountInfo: async () => null,
      return: async () => {},
    });

    const response = await handleGetClaudeState({ type: 'get_claude_state' } as any, ctx);
    expect(response.config.unavailable_models).toBeUndefined();
  });

  it('leaves the CLI’s table alone when no profile is active', async () => {
    const response = await handleGetClaudeState({ type: 'get_claude_state' } as any, context({}));
    expect(response.config.models.map((m: any) => m.value)).toEqual(['default', 'opus']);
  });

  it('agrees with what sdk_probe serves, because both read one function', async () => {
    // The two used to disagree, which is how the picker and Settings > Models
    // ended up showing different lists.
    const response = await handleGetClaudeState({ type: 'get_claude_state' } as any, context({ profile: GATEWAY }));
    expect(response.config.models).toEqual(profileModelRows(GATEWAY));
  });
});

describe('a profile that declares no models asks the gateway', () => {
  const BARE = parseProfile(
    { name: 'omniroute', wire: 'openai', baseUrl: 'http://localhost:20128/v1', model: 'auto', auth: { kind: 'none' } },
    'test',
  );

  it('offers every model the endpoint serves', async () => {
    // Without this the picker holds the single id the profile happens to name,
    // which is what "the model list didn't load" meant on a gateway serving
    // dozens.
    const response = await handleGetClaudeState(
      { type: 'get_claude_state' } as any,
      context({ profile: BARE, served: ['auto', 'best-fast', 'gpt-4o', 'claude-sonnet-4-5'] }),
    );
    expect(response.config.models.map((m: any) => m.value))
      .toEqual(['auto', 'best-fast', 'gpt-4o', 'claude-sonnet-4-5']);
  });

  it('falls back to the profile’s own model when the gateway will not list', async () => {
    const response = await handleGetClaudeState(
      { type: 'get_claude_state' } as any,
      context({ profile: BARE, served: undefined }),
    );
    expect(response.config.models.map((m: any) => m.value)).toEqual(['auto']);
  });

  it('does not ask when the profile declares its own list', async () => {
    // A declared block is the user choosing a handful out of hundreds; asking
    // the gateway would overrule them.
    let asked = false;
    const ctx = context({ profile: GATEWAY });
    ctx.endpointService.servedModels = async () => { asked = true; return ['a', 'b', 'c']; };

    const response = await handleGetClaudeState({ type: 'get_claude_state' } as any, ctx);
    expect(asked).toBe(false);
    expect(response.config.models.map((m: any) => m.value)).toEqual(['auto', 'best-fast']);
  });
});

describe('the picker cannot be held up forever', () => {
  // The budget itself is exercised directly, so the suite does not have to sit
  // through 8 seconds twice to prove a timeout works.
  it('gives up on a probe that never returns, and still answers', async () => {
    const started = Date.now();
    const config = await loadConfigBounded(context({ profile: GATEWAY, probeMs: 60_000 }), 50);

    expect(Date.now() - started).toBeLessThan(2000);
    expect(config).toEqual({ commands: [], models: [], accountInfo: null });
  });

  it('says so in the log rather than failing silently', async () => {
    const ctx = context({ profile: GATEWAY, probeMs: 60_000 });
    await loadConfigBounded(ctx, 50);

    const warned = ctx.logService.warn.mock.calls.map((c: any[]) => String(c[0])).join(' | ');
    expect(warned).toContain('did not answer');
    expect(warned).toContain('Endpoint Diagnostics');
  });

  it('costs the fast path nothing', async () => {
    // The budget is wide rather than tight on purpose. `context({probeMs})`
    // arms a fresh timer for each of the three things `loadConfig` awaits, so
    // a "5ms" probe is at least 15ms of real clock -- and against a 50ms budget
    // on a machine running the other 50-odd spec files at once, this failed on
    // the timer rather than on the behaviour it is meant to check.
    const config = await loadConfigBounded(context({ profile: GATEWAY, probeMs: 5 }), 2000);
    expect(config.commands).toEqual([{ name: 'compact' }]);
  });

  it('is the budget the handler actually applies', () => {
    // If this drifts, the two tests above stop describing production.
    expect(CONFIG_PROBE_BUDGET_MS).toBeGreaterThanOrEqual(2000);
    expect(CONFIG_PROBE_BUDGET_MS).toBeLessThanOrEqual(15_000);
  });

  it('still returns the CLI commands through the handler when the probe is quick', async () => {
    const response = await handleGetClaudeState(
      { type: 'get_claude_state' } as any,
      context({ profile: GATEWAY, probeMs: 5 }),
    );
    expect(response.config.commands).toEqual([{ name: 'compact' }]);
    expect(response.config.models.map((m: any) => m.value)).toEqual(['auto', 'best-fast']);
  });

  it('does not bound the probe when no profile is active', async () => {
    // Without a profile the CLI is the only source of models, so cutting it
    // short would replace a slow menu with an empty one.
    const started = Date.now();
    const response = await handleGetClaudeState(
      { type: 'get_claude_state' } as any,
      context({ probeMs: 300 }),
    );
    expect(response.config.models).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
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
