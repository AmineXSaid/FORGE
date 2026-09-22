/**
 * Step 14: the Thinking toggle, separate from effort.
 *
 * The official host turns the level into a thinking config (`m$$`): "off" is
 * `{type:"disabled"}`, anything else a fixed 31999-token budget, with summaries
 * shown only when `showThinkingSummaries` says so. The running session gets it
 * through `setMaxThinkingTokens(budget, display ?? null)` or `(0)`, and the level
 * persists in globalState. A past regression had effort picks switching thinking
 * off, so independence is proven in both directions.
 */
import { describe, expect, it, vi } from 'vitest';
import { signal } from 'alien-signals';
import {
  DEFAULT_THINKING_LEVEL,
  THINKING_BUDGET_TOKENS,
  THINKING_LEVEL_STATE_KEY,
  applyThinkingConfig,
  invalidThinkingLevelMessage,
  parseThinkingLevel,
  readThinkingLevel,
  thinkingConfigFor,
  writeThinkingLevel,
} from '../src/services/claude/thinkingLevel';
import { ClaudeAgentService } from '../src/services/claude/ClaudeAgentService';
import { Session } from '../src/webview/src/core/Session';

describe('m$$: the thinking config for a level', () => {
  it('turns "off" into disabled thinking', () => {
    expect(thinkingConfigFor('off', undefined)).toEqual({ type: 'disabled' });
    expect(thinkingConfigFor('off', true)).toEqual({ type: 'disabled' });
  });

  it('gives "default_on" the official 31999-token budget, summaries off by default', () => {
    expect(THINKING_BUDGET_TOKENS).toBe(31999);
    expect(thinkingConfigFor('default_on', undefined)).toEqual({ type: 'enabled', budgetTokens: 31999, display: undefined });
    expect(thinkingConfigFor('default_on', false)).toEqual({ type: 'enabled', budgetTokens: 31999, display: undefined });
  });

  it('asks for summaries when showThinkingSummaries is true', () => {
    expect(thinkingConfigFor('default_on', true)).toEqual({ type: 'enabled', budgetTokens: 31999, display: 'summarized' });
  });

  it('lets the setting override a host default either way', () => {
    expect(thinkingConfigFor('default_on', undefined, true).display).toBe('summarized');
    expect(thinkingConfigFor('default_on', false, true).display).toBeUndefined();
  });

  it('treats anything but "off" as on, as the official does', () => {
    expect(thinkingConfigFor('high', undefined).type).toBe('enabled');
  });
});

describe('the levels the host accepts', () => {
  it('accepts exactly the two the webview sends', () => {
    expect(parseThinkingLevel('off')).toBe('off');
    expect(parseThinkingLevel('default_on')).toBe('default_on');
  });

  it('refuses everything else, effort levels included', () => {
    for (const bad of [undefined, null, '', 'on', 'OFF', 'high', 'ultracode', 'medium', 0, 1, true, {}, []]) {
      expect(() => parseThinkingLevel(bad)).toThrow(invalidThinkingLevelMessage(bad));
    }
  });
});

describe('the live switch (setMaxThinkingTokens)', () => {
  it('sends the budget and clears the display override when summaries are off', async () => {
    const query = { setMaxThinkingTokens: vi.fn(async () => {}) };
    await applyThinkingConfig(query, thinkingConfigFor('default_on', undefined));
    expect(query.setMaxThinkingTokens).toHaveBeenCalledWith(31999, null);
  });

  it('sends the budget and "summarized" when summaries are on', async () => {
    const query = { setMaxThinkingTokens: vi.fn(async () => {}) };
    await applyThinkingConfig(query, thinkingConfigFor('default_on', true));
    expect(query.setMaxThinkingTokens).toHaveBeenCalledWith(31999, 'summarized');
  });

  it('sends 0, and nothing else, to switch thinking off', async () => {
    const query = { setMaxThinkingTokens: vi.fn(async () => {}) };
    await applyThinkingConfig(query, thinkingConfigFor('off', true));
    expect(query.setMaxThinkingTokens).toHaveBeenCalledWith(0);
    expect(query.setMaxThinkingTokens.mock.calls[0]).toHaveLength(1);
  });
});

describe('persistence (globalState "thinkingLevel")', () => {
  function memento(initial: Record<string, unknown> = {}) {
    const data = { ...initial };
    return { data, get: (k: string) => data[k], update: vi.fn(async (k: string, v: unknown) => void (data[k] = v)) };
  }

  it('reads "default_on" when nothing is stored', () => {
    expect(readThinkingLevel(memento())).toBe(DEFAULT_THINKING_LEVEL);
    expect(readThinkingLevel(memento({ thinkingLevel: '' }))).toBe('default_on');
  });

  it('reads what is stored, under the official key', () => {
    expect(THINKING_LEVEL_STATE_KEY).toBe('thinkingLevel');
    expect(readThinkingLevel(memento({ thinkingLevel: 'off' }))).toBe('off');
  });

  it('writes under the official key', async () => {
    const store = memento();
    await writeThinkingLevel(store, 'off');
    expect(store.update).toHaveBeenCalledWith('thinkingLevel', 'off');
    expect(readThinkingLevel(store)).toBe('off');
  });
});

describe('host: set_thinking_level on ClaudeAgentService', () => {
  function makeService(showThinkingSummaries?: unknown) {
    const order: string[] = [];
    const query = {
      setMaxThinkingTokens: vi.fn(async (...args: unknown[]) => void order.push(`setMaxThinkingTokens(${args.join(',')})`)),
    };
    const sdkService = {
      setThinkingLevel: vi.fn(async (level: string) => void order.push(`persist(${level})`)),
      getThinkingLevel: () => 'default_on',
    };
    const configService = { getSetting: vi.fn(async () => showThinkingSummaries) };
    const log = { info: () => {}, warn: () => {}, error: () => {} };
    const svc = new (ClaudeAgentService as any)(log, configService, {}, {}, {}, {}, {}, sdkService, {}, {}, {}, { onDidChangeHealth: () => ({ dispose() {} }), getAllHealth: () => [] });
    svc.channels.set('ch1', { query });
    return { svc, query, sdkService, order };
  }

  it('applies the budget to the session, then persists the level -- in that order', async () => {
    const { svc, order } = makeService(undefined);
    await svc.setThinkingLevel('ch1', 'default_on');
    expect(order).toEqual(['setMaxThinkingTokens(31999,)', 'persist(default_on)']);
  });

  it('switches thinking off with 0 and persists "off"', async () => {
    const { svc, query, sdkService } = makeService(undefined);
    await svc.setThinkingLevel('ch1', 'off');
    expect(query.setMaxThinkingTokens).toHaveBeenCalledWith(0);
    expect(sdkService.setThinkingLevel).toHaveBeenCalledWith('off');
  });

  it('reads showThinkingSummaries from the merged settings', async () => {
    const { svc, query } = makeService(true);
    await svc.setThinkingLevel('ch1', 'default_on');
    expect(query.setMaxThinkingTokens).toHaveBeenCalledWith(31999, 'summarized');
  });

  it('ignores a showThinkingSummaries that is not a boolean', async () => {
    const { svc, query } = makeService('yes');
    await svc.setThinkingLevel('ch1', 'default_on');
    expect(query.setMaxThinkingTokens).toHaveBeenCalledWith(31999, null);
  });

  it('refuses a bad level before touching the session or the store', async () => {
    const { svc, query, sdkService } = makeService(undefined);
    await expect(svc.setThinkingLevel('ch1', 'high')).rejects.toThrow(invalidThinkingLevelMessage('high'));
    expect(query.setMaxThinkingTokens).not.toHaveBeenCalled();
    expect(sdkService.setThinkingLevel).not.toHaveBeenCalled();
  });

  it('refuses an unknown channel, and persists nothing (the official withChannel)', async () => {
    const { svc, sdkService } = makeService(undefined);
    await expect(svc.setThinkingLevel('nope', 'off')).rejects.toThrow('Channel not found: nope');
    expect(sdkService.setThinkingLevel).not.toHaveBeenCalled();
  });

  it('answers the dispatcher with the official response', async () => {
    const { svc } = makeService(undefined);
    const response = await svc.processRequest(
      { type: 'request', requestId: '1', channelId: 'ch1', request: { type: 'set_thinking_level', thinkingLevel: 'off' } },
      new AbortController().signal
    );
    expect(response).toEqual({ type: 'set_thinking_level_response' });
  });

  it('never reaches effort: no applyFlagSettings, no settings file', async () => {
    const { svc } = makeService(undefined);
    const applyFlagSettings = vi.fn();
    svc.channels.get('ch1').query.applyFlagSettings = applyFlagSettings;
    await svc.setThinkingLevel('ch1', 'off');
    expect(applyFlagSettings).not.toHaveBeenCalled();
  });
});

describe('webview: thinking and effort are independent, both ways', () => {
  function makeSession(configThinkingLevel?: string) {
    const calls: Array<{ type: string; payload: unknown }> = [];
    const connection = {
      claudeConfig: signal({
        commands: [],
        models: [{ value: 'default', displayName: 'Default', description: '', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'] }],
        accountInfo: null,
        claudeSettings: { effective: {}, applied: { effort: 'medium' } },
      }),
      config: signal({ modelSetting: 'default', thinkingLevel: configThinkingLevel }),
      permissionRequests: signal([]),
      applySettings: vi.fn(async (settings: unknown) => void calls.push({ type: 'apply_settings', payload: settings })),
      setThinkingLevel: vi.fn(async (_c: string, level: string) => void calls.push({ type: 'set_thinking_level', payload: level })),
    };
    const session = new Session(async () => connection as never, {
      currentSelection: signal(undefined),
      commandRegistry: { registerAction: () => {} },
      fileOpener: { open: () => {}, openContent: async () => undefined },
    });
    (session as any).claudeChannelId('ch1');
    return { session, calls };
  }

  it('shows the persisted level from init, and "off" when the host sent none', async () => {
    const persisted = makeSession('off');
    await persisted.session.getConnection();
    expect(persisted.session.thinkingLevel()).toBe('off');

    const none = makeSession(undefined);
    await none.session.getConnection();
    expect(none.session.thinkingLevel()).toBe('off');

    const on = makeSession('default_on');
    await on.session.getConnection();
    expect(on.session.thinkingLevel()).toBe('default_on');
  });

  it('toggling thinking sends only set_thinking_level and leaves effort alone', async () => {
    const { session, calls } = makeSession('default_on');
    await session.getConnection();
    expect(session.effortLevel()).toBe('medium');
    await session.setThinkingLevel('off');
    expect(calls).toEqual([{ type: 'set_thinking_level', payload: 'off' }]);
    expect(session.thinkingLevel()).toBe('off');
    expect(session.effortLevel()).toBe('medium');
    await session.setThinkingLevel('default_on');
    expect(session.effortLevel()).toBe('medium');
  });

  it('picking any effort sends only apply_settings and leaves thinking alone -- on or off', async () => {
    for (const start of ['default_on', 'off']) {
      const { session, calls } = makeSession(start);
      await session.getConnection();
      for (const level of ['low', 'high', 'medium']) await session.setEffortLevel(level);
      expect(calls.every((c) => c.type === 'apply_settings')).toBe(true);
      expect(session.thinkingLevel()).toBe(start);
    }
  });
});
