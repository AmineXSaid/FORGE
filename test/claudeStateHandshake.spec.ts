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
 * Three unbounded waits could produce it, and the handshake ran through all
 * three. `servedModels` fetches the gateway's `/models` with a 15s timeout of
 * its own, *outside* the config budget. `loadConfig` awaits the CLI's
 * `initializationResult()` with no ceiling at all when no profile is active.
 * And either can reject, which rejected the request, which rejected
 * `initialize()` -- and nothing re-runs it.
 *
 * So these specs assert the contract rather than any one of those paths: it
 * answers, inside a budget, with `models` an array, whatever the CLI and the
 * gateway do.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLI_CONFIG_BUDGET_MS,
  CONFIG_PROBE_BUDGET_MS,
  MODEL_LIST_BUDGET_MS,
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
    models: [{ id: 'auto' }, { id: 'best-fast' }],
  },
  'test',
);

/** A profile with no `models` block, so the handshake asks the gateway. */
const BARE = parseProfile(
  {
    name: 'omniroute',
    wire: 'openai',
    baseUrl: 'http://localhost:20128/v1',
    model: 'auto',
    auth: { kind: 'none' },
  },
  'test',
);

/** Never settles -- a wedged gateway or a CLI that never completes initialize. */
const never = <T>() => new Promise<T>(() => {});

/** Settles after `ms` on the fake clock. */
const after = <T>(value: T, ms: number) => new Promise<T>((r) => setTimeout(() => r(value), ms));

interface Opts {
  profile?: any;
  /** How long the CLI takes to answer; `undefined` means never. */
  probeMs?: number;
  /** How long the gateway takes to list models; `undefined` means never. */
  servedMs?: number;
  served?: string[];
  /** Make the CLI launch throw rather than hang. */
  throws?: boolean;
  /** Hand back a config with no `models` key at all. */
  modelless?: boolean;
}

function context(opts: Opts = {}) {
  const queried = vi.fn();
  const ctx = {
    logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    workspaceService: { getDefaultWorkspaceFolder: () => undefined },
    agentService: { noteClaudeSettings: vi.fn() },
    endpointService: {
      getStatus: () => ({ profile: opts.profile, report: [], errors: [], available: [] }),
      servedModels: () =>
        opts.servedMs === undefined ? never<string[]>() : after(opts.served ?? [], opts.servedMs),
    },
    sdkService: {
      query: async () => {
        queried();
        if (opts.throws) throw new Error('the CLI could not be launched');
        const init = opts.probeMs === undefined
          ? never<any>()
          : after(opts.modelless ? {} : { models: CLI_MODELS }, opts.probeMs);
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
  it('answers with an empty model list when the CLI never completes initialize', async () => {
    // The headline case: no profile, so the old code ran `loadConfig`
    // unbounded and this promise never settled.
    const ctx = context({});
    const pending = ask(ctx);

    await vi.advanceTimersByTimeAsync(CLI_CONFIG_BUDGET_MS + 10);
    const response = await pending;

    expect(response.config.models).toEqual([]);
    expect(response.provisional).toBe(true);
  });

  it('answers rather than rejecting when the CLI cannot be launched', async () => {
    // A rejection here used to reject `initialize()` in the webview, which
    // leaves `claudeConfig` undefined with nothing to re-run it.
    const ctx = context({ throws: true });

    const response = await ask(ctx);

    expect(response.type).toBe('get_claude_state_response');
    expect(response.config.models).toEqual([]);
    expect(response.provisional).toBe(true);
  });

  it('reports the CLI’s models, and not provisionally, on a healthy launch', async () => {
    const ctx = context({ probeMs: 5 });
    const pending = ask(ctx);

    await vi.advanceTimersByTimeAsync(10);
    const response = await pending;

    expect(response.config.models.map((m: any) => m.value)).toEqual(['default', 'opus']);
    expect(response.provisional).toBeFalsy();
  });

  it('never returns a non-array `models`, because undefined is what hangs the picker', async () => {
    // `[]` renders "No models available" and opens the welcome gate.
    // `undefined` renders "Loading models…" and opens nothing. The distinction
    // is the whole bug, so it is made here rather than trusted.
    const ctx = context({ probeMs: 5, modelless: true });
    const pending = ask(ctx);

    await vi.advanceTimersByTimeAsync(10);
    const response = await pending;

    expect(Array.isArray(response.config.models)).toBe(true);
  });
});

describe('it answers whatever the gateway does', () => {
  it('does not wait on a gateway that never lists its models', async () => {
    // `servedModels` sat outside every budget: `listModels` allows 15s for
    // headers alone, so the "bounded" config load could not start for that long.
    const ctx = context({ profile: BARE, probeMs: 1 });
    const pending = ask(ctx);

    await vi.advanceTimersByTimeAsync(MODEL_LIST_BUDGET_MS + CONFIG_PROBE_BUDGET_MS + 20);
    const response = await pending;

    expect(Array.isArray(response.config.models)).toBe(true);
    expect(response.provisional).toBe(true);
  });

  it('keeps the profile’s rows even when the CLI probe is dead', async () => {
    // The rows are already in hand, so a dead CLI costs the command list --
    // not the model picker.
    const ctx = context({ profile: GATEWAY });
    const pending = ask(ctx);

    await vi.advanceTimersByTimeAsync(CONFIG_PROBE_BUDGET_MS + 10);
    const response = await pending;

    expect(response.config.models.map((m: any) => m.value)).toEqual(['auto', 'best-fast']);
    expect(response.config.commands).toEqual([]);
    expect(response.provisional).toBe(true);
  });
});

describe('the probe it gave up on is not wasted', () => {
  it('serves the real config to the next ask once the slow probe lands', async () => {
    // This is what turns the provisional empty picker into the real one: the
    // webview asks again, and the answer the host was still waiting for is
    // already cached.
    const ctx = context({ probeMs: CLI_CONFIG_BUDGET_MS + 5000 });

    const first = ask(ctx);
    await vi.advanceTimersByTimeAsync(CLI_CONFIG_BUDGET_MS + 10);
    expect((await first).provisional).toBe(true);
    expect((await first).config.models).toEqual([]);

    // The probe the host never cancelled now finishes.
    await vi.advanceTimersByTimeAsync(5000);

    const second = await ask(ctx);
    expect(second.config.models.map((m: any) => m.value)).toEqual(['default', 'opus']);
    expect(second.provisional).toBeFalsy();
  });

  it('launches the CLI once for callers that arrive together', async () => {
    const ctx = context({ probeMs: 5 });

    const both = Promise.all([ask(ctx), ask(ctx)]);
    await vi.advanceTimersByTimeAsync(20);
    await both;

    expect(ctx.queried).toHaveBeenCalledTimes(1);
  });
});

describe('the budgets', () => {
  it('give the CLI longer when its table is the only model list there is', () => {
    // With a profile active there is a fallback list; without one, giving up
    // early shows the welcome page to someone whose CLI was merely slow.
    expect(CLI_CONFIG_BUDGET_MS).toBeGreaterThan(CONFIG_PROBE_BUDGET_MS);
  });

  it('bound the gateway listing well inside its own 15s network timeout', () => {
    expect(MODEL_LIST_BUDGET_MS).toBeLessThan(15_000);
  });
});
