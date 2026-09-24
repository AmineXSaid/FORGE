/**
 * `get_claude_state` must always answer.
 *
 * Reported from a real install, as two bugs: "the initial welcome page didn't
 * appear" and "the model selection appears loading when a mounted model already
 * exists". They are one bug. The webview's whole handshake blocks on this
 * request -- `BaseTransport.initialize` sets `claudeConfig` and reaches
 * "connected" only once it answers -- so a single unanswered request leaves
 * `claudeConfig` undefined, and two surfaces read that one value:
 *
 * - `ModelSelect` renders `models === undefined` as "Loading models…", forever;
 * - `ChatPage`'s welcome gate is `modelCount === 0`, and `undefined !== 0`, so
 *   the page that offers to set an endpoint up never mounts either.
 *
 * Since 2026-09-23 the model list is the endpoint and model pairs, read from
 * settings with no network at all, and the CLI probe only supplies the command
 * list. So the contract is simpler and stricter: it answers inside one budget,
 * the models are the pairs whatever the CLI does, and they are never the CLI's
 * Anthropic table.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONFIG_FALLBACK_PROBE_DELAY_MS,
  CONFIG_PROBE_BUDGET_MS,
  handleGetClaudeState,
  resetConfigProbe,
} from '../src/services/claude/handlers/handlers';
import { parseProfile } from '../src/services/endpoints/profile';

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
  },
  'test',
);

/** Never settles -- a CLI that never completes initialize. */
const never = <T>() => new Promise<T>(() => {});

/** Settles after `ms` on the fake clock. */
const after = <T>(value: T, ms: number) => new Promise<T>((r) => setTimeout(() => r(value), ms));

interface Opts {
  profiles?: any[];
  /** How long the CLI takes to answer; `undefined` means never. */
  probeMs?: number;
  /** Make the CLI launch throw rather than hang. */
  throws?: boolean;
}

function context(opts: Opts = {}) {
  const queried = vi.fn();
  const profiles = opts.profiles ?? [];
  const ctx = {
    logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
    workspaceService: { getDefaultWorkspaceFolder: () => undefined },
    agentService: { noteClaudeSettings: vi.fn(), schedulePushStateUpdate: vi.fn() },
    endpointService: {
      listProfiles: () => ({ profiles, errors: [] }),
      resolveActiveProfile: () => profiles[0],
      getStatus: () => ({ profile: profiles[0], report: [], errors: [], available: profiles }),
    },
    sdkService: {
      query: async () => {
        queried();
        if (opts.throws) throw new Error('the CLI could not be launched');
        const init = opts.probeMs === undefined
          ? never<any>()
          : after({ models: CLI_MODELS }, opts.probeMs);
        return {
          initializationResult: () => init,
          supportedCommands: () => init.then(() => [{ name: 'compact' }]),
          accountInfo: () => init.then(() => null),
          return: async () => {},
        };
      },
    },
    queried,
  } as any;
  return ctx;
}

const ask = (ctx: any) => handleGetClaudeState({ type: 'get_claude_state' } as any, ctx);

beforeEach(() => {
  resetConfigProbe();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('it answers whatever the CLI does', () => {
  it('answers inside the budget when the CLI never completes initialize', async () => {
    const ctx = context({});
    const pending = ask(ctx);

    await vi.advanceTimersByTimeAsync(CONFIG_PROBE_BUDGET_MS + 10);
    const response = await pending;

    expect(response.config.models).toEqual([]);
    expect(response.config.commands).toEqual([]);
    expect(response.provisional).toBe(true);
  });

  it('answers rather than rejecting when the CLI cannot be launched', async () => {
    // A rejection here used to reject `initialize()` in the webview, which
    // leaves `claudeConfig` undefined with nothing to re-run it.
    const pending = ask(context({ throws: true, profiles: [GATEWAY] }));
    await vi.advanceTimersByTimeAsync(CONFIG_FALLBACK_PROBE_DELAY_MS + 10);
    const response = await pending;

    expect(response.type).toBe('get_claude_state_response');
    expect(response.config.models.map((m: any) => m.value)).toEqual(['omniroute']);
    expect(response.provisional).toBe(true);
  });

  it('never serves the CLI table, even on a healthy launch', async () => {
    const ctx = context({ probeMs: 5 });
    const pending = ask(ctx);

    await vi.advanceTimersByTimeAsync(CONFIG_FALLBACK_PROBE_DELAY_MS + 10);
    const response = await pending;

    // No endpoint: no models, and the chat shows its setup page.
    expect(response.config.models).toEqual([]);
    expect(response.config.commands).toEqual([{ name: 'compact' }]);
    expect(response.provisional).toBeFalsy();
  });

  it('always returns an array for `models`, because undefined is what hangs the picker', async () => {
    const pending = ask(context({ probeMs: 5 }));
    await vi.advanceTimersByTimeAsync(CONFIG_FALLBACK_PROBE_DELAY_MS + 10);
    expect(Array.isArray((await pending).config.models)).toBe(true);
  });
});

describe('the pairs do not wait on anything', () => {
  it('are served even when the CLI probe is dead', async () => {
    // A dead CLI costs the command list, never the model picker.
    const ctx = context({ profiles: [GATEWAY] });
    const pending = ask(ctx);

    await vi.advanceTimersByTimeAsync(CONFIG_PROBE_BUDGET_MS + 10);
    const response = await pending;

    expect(response.config.models.map((m: any) => m.value)).toEqual(['omniroute']);
    expect(response.config.commands).toEqual([]);
    expect(response.provisional).toBe(true);
  });
});

describe('the probe it gave up on is not wasted', () => {
  it('serves the real command list to the next ask once the slow probe lands', async () => {
    const ctx = context({ profiles: [GATEWAY], probeMs: CONFIG_PROBE_BUDGET_MS + 5000 });

    const first = ask(ctx);
    await vi.advanceTimersByTimeAsync(CONFIG_PROBE_BUDGET_MS + 10);
    expect((await first).provisional).toBe(true);
    expect((await first).config.commands).toEqual([]);

    // The probe the host never cancelled now finishes (it started after the
    // fallback delay), and the settled config is pushed to every page.
    await vi.advanceTimersByTimeAsync(5000 + CONFIG_FALLBACK_PROBE_DELAY_MS);
    expect(ctx.agentService.schedulePushStateUpdate).toHaveBeenCalled();

    const second = await ask(ctx);
    expect(second.config.commands).toEqual([{ name: 'compact' }]);
    expect(second.config.models.map((m: any) => m.value)).toEqual(['omniroute']);
    expect(second.provisional).toBeFalsy();
  });

  it('launches the CLI once for callers that arrive together', async () => {
    const ctx = context({ probeMs: 5 });

    const both = Promise.all([ask(ctx), ask(ctx)]);
    await vi.advanceTimersByTimeAsync(CONFIG_FALLBACK_PROBE_DELAY_MS + 20);
    await both;

    expect(ctx.queried).toHaveBeenCalledTimes(1);
  });
});

describe('the budget', () => {
  it('is short enough not to read as a hung UI, long enough for a real launch', () => {
    expect(CONFIG_PROBE_BUDGET_MS).toBeGreaterThanOrEqual(2000);
    expect(CONFIG_PROBE_BUDGET_MS).toBeLessThanOrEqual(15_000);
  });
});
