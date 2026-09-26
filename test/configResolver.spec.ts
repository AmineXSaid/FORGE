/**
 * Where the "/" list comes from: the official shared config.
 *
 * Reported from a fresh install: typing "/" said "No matches". The log had two
 * lines: "the CLI config probe did not answer in 8000ms; serving ... an empty
 * command list", then "Query closed before response received". Two causes:
 *
 * - the handshake gave up on the probe after 8s and served `commands: []`,
 *   with nothing but a few re-asks to ever replace it;
 * - the probe closed its CLI's stdin straight after launching it, so a cold CLI
 *   read end-of-input before answering `initialize` and exited.
 *
 * The official host (`loadConfig`, `claimConfigResolver`,
 * `releaseConfigResolver`, `startFallbackProbe`, `spawnConfigProbe`) has no
 * give-up budget: the first chat launch settles the config from its own
 * initialize response, a probe runs only when no launch claims it within
 * 500ms, and the probe's stdin stays open until its reads are done. Forge keeps
 * its handshake budget (the welcome gate cannot wait on a cold CLI) and pushes
 * the config to every page the moment it settles.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONFIG_FALLBACK_PROBE_DELAY_MS,
  CONFIG_PROBE_BUDGET_MS,
  claimConfigResolver,
  handleGetClaudeState,
  resetConfigProbe,
  settleConfigFromLaunch,
} from '../src/services/claude/handlers/handlers';

const never = <T>() => new Promise<T>(() => {});
const after = <T>(value: T, ms: number) => new Promise<T>((r) => setTimeout(() => r(value), ms));

const PROBE_COMMANDS = [{ name: 'compact', description: 'from the probe', argumentHint: '' }];
const LAUNCH_COMMANDS = [{ name: 'review', description: 'from the launch', argumentHint: '' }];

/** A query whose initialize answers `commands` after `ms` (never, when undefined). */
function fakeQuery(commands: unknown[], ms?: number, fail?: Error) {
  const init = fail
    ? Promise.reject(fail)
    : ms === undefined ? never<any>() : after({ models: [], commands }, ms);
  init.catch(() => undefined);
  return {
    initializationResult: () => init,
    supportedCommands: () => init.then(() => commands),
    accountInfo: () => init.then(() => null),
    return: vi.fn(async () => ({ done: true, value: undefined })),
  } as any;
}

interface Opts {
  /** How long the standalone probe's CLI takes to answer; undefined is never. */
  probeMs?: number;
}

function context(opts: Opts = {}) {
  const probes: { stream: any; query: any }[] = [];
  const ctx = {
    logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
    workspaceService: { getDefaultWorkspaceFolder: () => undefined },
    agentService: { noteClaudeSettings: vi.fn(), schedulePushStateUpdate: vi.fn() },
    endpointService: {
      listProfiles: () => ({ profiles: [], errors: [] }),
      resolveActiveProfile: () => undefined,
    },
    sdkService: {
      query: vi.fn(async ({ inputStream }: any) => {
        const query = fakeQuery(PROBE_COMMANDS, opts.probeMs);
        probes.push({ stream: inputStream, query });
        return query;
      }),
    },
    probes,
  } as any;
  return ctx;
}

const ask = (ctx: any) => handleGetClaudeState({ type: 'get_claude_state' } as any, ctx);
const names = (config: any) => config.commands.map((c: any) => c.name);

beforeEach(() => {
  resetConfigProbe();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a chat launch settles the config', () => {
  it('fills the "/" list from the launch, and no probe CLI starts', async () => {
    const ctx = context();
    const pending = ask(ctx);

    // The chat mounts and launches inside the 500ms window.
    const claimed = claimConfigResolver(ctx);
    expect(claimed).toBeDefined();
    void settleConfigFromLaunch(ctx, claimed, fakeQuery(LAUNCH_COMMANDS, 50));

    await vi.advanceTimersByTimeAsync(CONFIG_FALLBACK_PROBE_DELAY_MS + 100);
    const response = await pending;

    expect(names(response.config)).toEqual(['review']);
    expect(response.provisional).toBeFalsy();
    expect(ctx.sdkService.query).not.toHaveBeenCalled();
  });

  it('settles a config asked for while the launch was still spawning (the official re-claim)', async () => {
    const ctx = context();
    // Launched before anything asked: nothing to claim yet.
    const settling = settleConfigFromLaunch(ctx, claimConfigResolver(ctx), fakeQuery(LAUNCH_COMMANDS, 100));

    const pending = ask(ctx);
    await vi.advanceTimersByTimeAsync(150);
    await settling;
    const response = await pending;

    expect(names(response.config)).toEqual(['review']);
    expect(ctx.sdkService.query).not.toHaveBeenCalled();
  });

  it('seeds the config when it lands before anything asked, so the next ask answers at once', async () => {
    const ctx = context();
    const settling = settleConfigFromLaunch(ctx, undefined, fakeQuery(LAUNCH_COMMANDS, 5));
    await vi.advanceTimersByTimeAsync(10);
    await settling;

    const response = await ask(ctx);
    expect(names(response.config)).toEqual(['review']);
    expect(response.provisional).toBeFalsy();
    expect(ctx.sdkService.query).not.toHaveBeenCalled();
  });

  it('a later launch refreshes the list (a new plugin or skill) and pushes it', async () => {
    const ctx = context();
    const first = settleConfigFromLaunch(ctx, undefined, fakeQuery(LAUNCH_COMMANDS, 5));
    await vi.advanceTimersByTimeAsync(10);
    await first;
    ctx.agentService.schedulePushStateUpdate.mockClear();

    const more = [...LAUNCH_COMMANDS, { name: 'deploy', description: '', argumentHint: '' }];
    const second = settleConfigFromLaunch(ctx, undefined, fakeQuery(more, 5));
    await vi.advanceTimersByTimeAsync(10);
    await second;

    expect(ctx.agentService.schedulePushStateUpdate).toHaveBeenCalledTimes(1);
    expect(names((await ask(ctx)).config)).toEqual(['review', 'deploy']);
  });

  it('an unchanged list is not pushed again', async () => {
    const ctx = context();
    for (let i = 0; i < 2; i++) {
      const settling = settleConfigFromLaunch(ctx, undefined, fakeQuery(LAUNCH_COMMANDS, 5));
      await vi.advanceTimersByTimeAsync(10);
      await settling;
    }
    expect(ctx.agentService.schedulePushStateUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('a slow CLI no longer leaves the list empty', () => {
  it('answers provisionally at the budget, then pushes the list when a launch settles it', async () => {
    const ctx = context(); // the probe never answers
    const pending = ask(ctx);
    await vi.advanceTimersByTimeAsync(CONFIG_PROBE_BUDGET_MS + 10);

    const first = await pending;
    expect(first.provisional).toBe(true);
    expect(first.config.commands).toEqual([]);
    expect(ctx.agentService.schedulePushStateUpdate).not.toHaveBeenCalled();

    // The chat's launch arrives late and claims the config from the probe.
    const claimed = claimConfigResolver(ctx);
    expect(claimed).toBeDefined();
    const settling = settleConfigFromLaunch(ctx, claimed, fakeQuery(LAUNCH_COMMANDS, 5));
    await vi.advanceTimersByTimeAsync(10);
    await settling;

    // The page is told at once (the official pushStateUpdate), and asked
    // again, the host answers from the settled config.
    expect(ctx.agentService.schedulePushStateUpdate).toHaveBeenCalled();
    const second = await ask(ctx);
    expect(names(second.config)).toEqual(['review']);
    expect(second.provisional).toBeFalsy();
  });

  it('retires the probe CLI a launch has claimed from', async () => {
    const ctx = context();
    void ask(ctx);
    await vi.advanceTimersByTimeAsync(CONFIG_FALLBACK_PROBE_DELAY_MS + 10);
    expect(ctx.probes).toHaveLength(1);

    claimConfigResolver(ctx);
    expect(ctx.probes[0].query.return).toHaveBeenCalled();
    expect(ctx.probes[0].stream.isDone).toBe(true);
  });
});

describe('the fallback probe', () => {
  it('starts only when no launch claims the config within 500ms', async () => {
    const ctx = context({ probeMs: 5 });
    const pending = ask(ctx);

    await vi.advanceTimersByTimeAsync(CONFIG_FALLBACK_PROBE_DELAY_MS - 50);
    expect(ctx.sdkService.query).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(ctx.sdkService.query).toHaveBeenCalledTimes(1);
    expect(names((await pending).config)).toEqual(['compact']);
  });

  it('keeps the CLI stdin open until initialize answers', async () => {
    // Closing it first let a cold CLI exit before answering: "Query closed
    // before response received" in the fresh-install log.
    const ctx = context({ probeMs: 1000 });
    void ask(ctx);
    await vi.advanceTimersByTimeAsync(CONFIG_FALLBACK_PROBE_DELAY_MS + 10);

    const { stream, query } = ctx.probes[0];
    expect(stream.isDone).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    expect(stream.isDone).toBe(true);
    expect(query.return).toHaveBeenCalled();
  });

  it('takes over at once when the launch that claimed the config fails', async () => {
    const ctx = context({ probeMs: 5 });
    const pending = ask(ctx);

    const claimed = claimConfigResolver(ctx);
    void settleConfigFromLaunch(ctx, claimed, fakeQuery([], undefined, new Error('Query closed before response received')));

    await vi.advanceTimersByTimeAsync(20);
    expect(ctx.sdkService.query).toHaveBeenCalledTimes(1);
    const response = await pending;
    expect(names(response.config)).toEqual(['compact']);
    expect(response.provisional).toBeFalsy();
  });

  it('a config rejected at shutdown answers provisionally rather than throwing', async () => {
    const ctx = context();
    const pending = ask(ctx);
    claimConfigResolver(ctx)?.reject(new Error('Host shutting down'));

    const response = await pending;
    expect(response.type).toBe('get_claude_state_response');
    expect(response.provisional).toBe(true);
    expect(response.config.commands).toEqual([]);
  });
});
