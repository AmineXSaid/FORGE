/**
 * Step 13: effort end to end, and Ultracode (in scope since 2026-09-18).
 *
 * Effort is its own setting now: a pick sends `apply_settings {effortLevel}`
 * (persisted to user settings, pushed live), never `set_thinking_level`. The
 * levels are the model's own. Ultracode is `xhigh` plus the session-scoped
 * `ultracode` flag, offered only where the model lists `xhigh` and workflows
 * are on. The label follows what the CLI reports it applied (`applied.effort`),
 * which is how `maxEffortLevel` caps and model downgrades show up (B7).
 */
import { describe, expect, it, vi } from 'vitest';
import { signal } from 'alien-signals';
import {
  DEFAULT_EFFORT_LEVELS,
  NO_EFFORT,
  ULTRACODE_DESCRIPTION,
  effortLabel,
  effortRowSuffix,
  effortToneClass,
  isUltracodeAvailable,
  nextEffortPick,
  pillEffortLabel,
} from '../src/webview/src/components/forge/effort';
import { readClaudeSettings, toAppliedSettings, toClaudeSettingsSnapshot } from '../src/services/claude/claudeSettings';
import { Session } from '../src/webview/src/core/Session';
import type { CliModelInfo, ClaudeSettingsSnapshot } from '../src/shared/messages';

const SONNET_LEVELS = ['low', 'medium', 'high'];
const OPUS_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const XHIGH_TOP = ['low', 'medium', 'high', 'xhigh'];
const SETTINGS: ClaudeSettingsSnapshot = { effective: { disableWorkflows: false } };

describe('labels (V25 / kK / Xq0 / Io)', () => {
  it('names every level the SDK has, and "Auto" for none or an unknown one', () => {
    expect(['low', 'medium', 'high', 'xhigh', 'max'].map(effortLabel)).toEqual([
      'Low',
      'Medium',
      'High',
      'Extra high',
      'Max',
    ]);
    expect(effortLabel(undefined)).toBe('Auto');
    expect(effortLabel('ultracode')).toBe('Auto');
  });

  it('shows no effort in the pill for a model without effort, or before a level is known', () => {
    expect(pillEffortLabel(false, 'high', false)).toBeUndefined();
    expect(pillEffortLabel(false, 'xhigh', true)).toBeUndefined();
    expect(pillEffortLabel(true, undefined, false)).toBeUndefined();
  });

  it('shows the level, or "Ultracode" while it is on', () => {
    expect(pillEffortLabel(true, 'xhigh', false)).toBe('Extra high');
    expect(pillEffortLabel(true, 'xhigh', true)).toBe('Ultracode');
  });

  it('gives the "/" row its official suffix', () => {
    expect(effortRowSuffix('high', false)).toBe('High');
    expect(effortRowSuffix(undefined, false)).toBe('Auto');
    expect(effortRowSuffix('xhigh', true)).toBe(ULTRACODE_DESCRIPTION);
    expect(ULTRACODE_DESCRIPTION).toBe('Ultracode - xhigh + workflows');
  });

  it('tints by heat, and Ultracode wins over the level it runs at', () => {
    expect(effortToneClass('medium')).toBeUndefined();
    expect(effortToneClass('xhigh')).toBe('fg-effort--xhigh');
    expect(effortToneClass('max')).toBe('fg-effort--max');
    expect(effortToneClass('xhigh', true)).toBe('fg-ultracode-text');
  });

  it('has no "ultracode" level and no fixed scale: the fallback is the official one', () => {
    expect(DEFAULT_EFFORT_LEVELS).toEqual(['low', 'medium', 'high']);
    expect(NO_EFFORT.supported).toBe(false);
  });
});

describe('the Effort row cycle (the official registry row)', () => {
  it('starts at the lowest level when none is known', () => {
    expect(nextEffortPick(SONNET_LEVELS, undefined, false, false)).toEqual({ kind: 'level', level: 'low' });
  });

  it('steps up and wraps within the model\'s own levels', () => {
    expect(nextEffortPick(SONNET_LEVELS, 'medium', false, false)).toEqual({ kind: 'level', level: 'high' });
    expect(nextEffortPick(SONNET_LEVELS, 'high', false, false)).toEqual({ kind: 'level', level: 'low' });
  });

  it('reaches Ultracode after the top level when it is offered, then wraps to the lowest', () => {
    expect(nextEffortPick(OPUS_LEVELS, 'max', true, false)).toEqual({ kind: 'ultracode' });
    expect(nextEffortPick(OPUS_LEVELS, 'xhigh', true, true)).toEqual({ kind: 'level', level: 'low' });
    expect(nextEffortPick(XHIGH_TOP, 'xhigh', true, false)).toEqual({ kind: 'ultracode' });
  });

  it('never offers Ultracode when it is not available', () => {
    expect(nextEffortPick(OPUS_LEVELS, 'max', false, false)).toEqual({ kind: 'level', level: 'low' });
  });
});

describe('ultracodeAvailable (official)', () => {
  it('is false until the CLI settings have been read', () => {
    expect(isUltracodeAvailable(undefined, OPUS_LEVELS)).toBe(false);
  });

  it('is false when workflows are disabled', () => {
    expect(isUltracodeAvailable({ effective: { disableWorkflows: true } }, OPUS_LEVELS)).toBe(false);
  });

  it('needs the model to list xhigh', () => {
    expect(isUltracodeAvailable(SETTINGS, SONNET_LEVELS)).toBe(false);
    expect(isUltracodeAvailable(SETTINGS, undefined)).toBe(false);
    expect(isUltracodeAvailable(SETTINGS, XHIGH_TOP)).toBe(true);
    expect(isUltracodeAvailable(SETTINGS, OPUS_LEVELS)).toBe(true);
  });
});

describe('host: reading what the CLI applied (get_settings)', () => {
  it('keeps the fields of the CLI applied block that have the right type', () => {
    expect(toAppliedSettings({ model: 'claude-opus-5', effort: 'max', advisor: null, ultracode: false })).toEqual({
      model: 'claude-opus-5',
      effort: 'max',
      advisor: null,
      ultracode: false,
    });
  });

  it('keeps effort null (no effort parameter will be sent)', () => {
    expect(toAppliedSettings({ model: 'claude-haiku-4-5', effort: null })).toEqual({
      model: 'claude-haiku-4-5',
      effort: null,
    });
  });

  it('drops anything malformed rather than trusting it', () => {
    expect(toAppliedSettings({ effort: 'ultracode', ultracode: 'yes', model: 42 })).toEqual({});
    expect(toAppliedSettings(null)).toBeUndefined();
    expect(toAppliedSettings([])).toBeUndefined();
  });

  it('projects a get_settings response to the snapshot the webview reads', () => {
    const snapshot = toClaudeSettingsSnapshot({
      effective: { disableWorkflows: true, ultracode: false, effortLevel: 'high', apiKeyHelper: 'secret.sh', env: { A: '1' } },
      sources: [{ source: 'userSettings', settings: {} }],
      applied: { model: 'claude-sonnet-5', effort: 'high', ultracode: false },
    });
    expect(snapshot).toEqual({
      effective: { disableWorkflows: true, ultracode: false, effortLevel: 'high' },
      applied: { model: 'claude-sonnet-5', effort: 'high', ultracode: false },
    });
  });

  it('copes with a response that has no effective or applied block', () => {
    expect(toClaudeSettingsSnapshot({})).toEqual({ effective: {} });
    expect(toClaudeSettingsSnapshot('nope')).toBeUndefined();
  });

  it('calls the SDK runtime getSettings, and fails loudly when it is missing', async () => {
    const query = { getSettings: vi.fn(async () => ({ applied: { effort: 'low' } })) };
    await expect(readClaudeSettings(query)).resolves.toEqual({ applied: { effort: 'low' } });
    await expect(readClaudeSettings({})).rejects.toThrow('getSettings is not available');
  });
});

const MODELS: CliModelInfo[] = [
  { value: 'default', resolvedModel: 'claude-sonnet-5', displayName: 'Default', description: 'Sonnet 5', supportsEffort: true, supportedEffortLevels: SONNET_LEVELS as CliModelInfo['supportedEffortLevels'] },
  { value: 'opus', resolvedModel: 'claude-opus-5', displayName: 'Opus', description: 'Opus 5', supportsEffort: true, supportedEffortLevels: OPUS_LEVELS as CliModelInfo['supportedEffortLevels'] },
  { value: 'haiku', resolvedModel: 'claude-haiku-4-5', displayName: 'Haiku', description: 'Haiku 4.5', supportsEffort: false },
  { value: 'noLevels', displayName: 'No levels', description: 'x', supportsEffort: true },
];

function makeSession(opts: { claudeSettings?: ClaudeSettingsSnapshot; applied?: unknown } = {}) {
  const calls: Array<{ type: string; [k: string]: unknown }> = [];
  const connection = {
    claudeConfig: signal({ commands: [], models: MODELS, accountInfo: null, claudeSettings: opts.claudeSettings ?? SETTINGS }),
    config: signal({ modelSetting: 'default' }),
    permissionRequests: signal([]),
    applySettings: vi.fn(async (settings: Record<string, unknown>, o?: { flagsOnly?: boolean }) => {
      calls.push({ type: 'apply_settings', settings, flagsOnly: o?.flagsOnly });
    }),
    setThinkingLevel: vi.fn(async (_c: string, level: string) => {
      calls.push({ type: 'set_thinking_level', level });
    }),
    setModel: vi.fn(async (_c: string, model: { value: string }) => {
      calls.push({ type: 'set_model', value: model.value });
      return { type: 'set_model_response', applied: opts.applied };
    }),
    getAppliedSettings: vi.fn(async () => {
      calls.push({ type: 'get_applied_settings' });
      return opts.applied;
    }),
  };
  const session = new Session(async () => connection as never, {
    currentSelection: signal(undefined),
    commandRegistry: { registerAction: () => {} },
    fileOpener: { open: () => {}, openContent: async () => undefined },
  });
  (session as any).claudeChannelId('ch1');
  return { session, calls, connection };
}

describe('Session: effort is its own setting', () => {
  it('sends apply_settings {effortLevel} and nothing else -- thinking is untouched', async () => {
    const { session, calls } = makeSession();
    await session.getConnection();
    session.thinkingLevel('default_on');
    await session.setEffortLevel('high');
    expect(calls).toEqual([{ type: 'apply_settings', settings: { effortLevel: 'high' }, flagsOnly: undefined }]);
    expect(session.effortLevel()).toBe('high');
    expect(session.thinkingLevel()).toBe('default_on');
  });

  it('does not resend a level that is already chosen', async () => {
    const { session, calls } = makeSession();
    await session.getConnection();
    await session.setEffortLevel('low');
    await session.setEffortLevel('low');
    expect(calls.filter((c) => c.type === 'apply_settings')).toHaveLength(1);
  });

  it('sends max as is: the CLI keeps it for the session only', async () => {
    const { session, calls } = makeSession();
    session.modelSelection('opus');
    await session.getConnection();
    await session.setEffortLevel('max');
    expect(calls).toEqual([{ type: 'apply_settings', settings: { effortLevel: 'max' }, flagsOnly: undefined }]);
  });
});

describe('Session: Ultracode, the official way', () => {
  it('enables with Extra high first, then the session-scoped flag', async () => {
    const { session, calls } = makeSession();
    session.modelSelection('opus');
    await session.getConnection();
    await session.enableUltracode();
    expect(calls).toEqual([
      { type: 'apply_settings', settings: { effortLevel: 'xhigh' }, flagsOnly: undefined },
      { type: 'apply_settings', settings: { ultracode: true }, flagsOnly: true },
    ]);
    expect(session.ultracodeEnabled()).toBe(true);
    expect(session.effortLevel()).toBe('xhigh');
  });

  it('clears the flag before any other level is written', async () => {
    const { session, calls } = makeSession();
    session.modelSelection('opus');
    await session.getConnection();
    await session.enableUltracode();
    calls.length = 0;
    await session.setEffortLevel('high');
    expect(calls).toEqual([
      { type: 'apply_settings', settings: { ultracode: null }, flagsOnly: true },
      { type: 'apply_settings', settings: { effortLevel: 'high' }, flagsOnly: undefined },
    ]);
    expect(session.ultracodeEnabled()).toBe(false);
  });

  it('clears it even when picking xhigh itself, which the official also does', async () => {
    const { session, calls } = makeSession();
    session.modelSelection('opus');
    await session.getConnection();
    await session.enableUltracode();
    calls.length = 0;
    await session.setEffortLevel('xhigh');
    expect(calls[0]).toEqual({ type: 'apply_settings', settings: { ultracode: null }, flagsOnly: true });
  });

  it('does nothing when it is already on', async () => {
    const { session, calls } = makeSession();
    await session.getConnection();
    await session.enableUltracode();
    calls.length = 0;
    await session.enableUltracode();
    expect(calls).toEqual([]);
  });

  it('keeps writes in order even when fired together', async () => {
    const { session, calls } = makeSession();
    session.modelSelection('opus');
    await session.getConnection();
    await Promise.all([session.enableUltracode(), session.setEffortLevel('low')]);
    expect(calls.map((c) => JSON.stringify(c.settings))).toEqual([
      '{"effortLevel":"xhigh"}',
      '{"ultracode":true}',
      '{"ultracode":null}',
      '{"effortLevel":"low"}',
    ]);
  });
});

describe('Session: what the effort controls render from', () => {
  it('uses the model\'s own levels, and hides every control for a model without effort', async () => {
    const { session } = makeSession();
    await session.getConnection();
    expect(session.effortState().levels).toEqual(SONNET_LEVELS);
    session.modelSelection('opus');
    expect(session.effortState().levels).toEqual(OPUS_LEVELS);
    session.modelSelection('haiku');
    expect(session.effortState()).toBe(NO_EFFORT);
  });

  it('falls back to low/medium/high for a model with effort but no level list', async () => {
    const { session } = makeSession();
    await session.getConnection();
    session.modelSelection('noLevels');
    expect(session.effortState().levels).toEqual(['low', 'medium', 'high']);
  });

  it('offers Ultracode only on an xhigh model with workflows on', async () => {
    const { session } = makeSession();
    await session.getConnection();
    expect(session.ultracodeAvailable()).toBe(false);
    session.modelSelection('opus');
    expect(session.ultracodeAvailable()).toBe(true);
    expect(session.effortState().ultracodeAvailable).toBe(true);

    const off = makeSession({ claudeSettings: { effective: { disableWorkflows: true } } });
    await off.session.getConnection();
    off.session.modelSelection('opus');
    expect(off.session.ultracodeAvailable()).toBe(false);
  });
});

describe('Session: the label follows what the CLI reports (B7)', () => {
  it('seeds from the effort the CLI applied', async () => {
    const { session } = makeSession({
      claudeSettings: { effective: {}, applied: { effort: 'high', ultracode: false } },
    });
    await session.getConnection();
    expect(session.effortLevel()).toBe('high');
    expect(session.ultracodeEnabled()).toBe(false);
  });

  it('seeds Ultracode on when the CLI says it is on', async () => {
    const { session } = makeSession({
      claudeSettings: { effective: { ultracode: true }, applied: { effort: 'xhigh', ultracode: true } },
    });
    await session.getConnection();
    expect(session.ultracodeEnabled()).toBe(true);
    expect(session.effortLevel()).toBe('xhigh');
  });

  it('adopts the downgrade the CLI reports after a model switch (Max -> High on Sonnet)', async () => {
    const { session } = makeSession({ applied: { model: 'claude-sonnet-5', effort: 'high', ultracode: false } });
    session.modelSelection('opus');
    await session.getConnection();
    await session.setEffortLevel('max');
    await session.setModel({ value: 'default' });
    expect(session.effortLevel()).toBe('high');
  });

  it('adopts the cap the CLI reports (maxEffortLevel) and still writes a re-pick of the shown level', async () => {
    const { session, calls } = makeSession({ applied: { effort: 'medium' } });
    await session.getConnection();
    session.adoptAppliedEffort({ effort: 'medium' });
    expect(session.effortLevel()).toBe('medium');
    // The level shown came from the CLI, not a pick: picking it still writes.
    await session.setEffortLevel('medium');
    expect(calls.at(-1)).toEqual({ type: 'apply_settings', settings: { effortLevel: 'medium' }, flagsOnly: undefined });
  });

  it('ignores an applied block without a string effort', async () => {
    const { session } = makeSession();
    await session.getConnection();
    await session.setEffortLevel('low');
    session.adoptAppliedEffort({ effort: null });
    session.adoptAppliedEffort(undefined);
    expect(session.effortLevel()).toBe('low');
  });

  it('re-reads what the CLI applied at the end of a turn that sent a slash command', async () => {
    const { session, calls } = makeSession({ applied: { model: 'claude-opus-5', effort: 'xhigh', ultracode: false } });
    await session.getConnection();
    (session as any).rereadAppliedOnResult = true;
    (session as any).processIncomingMessage({ type: 'result', subtype: 'success', session_id: 's' });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.some((c) => c.type === 'get_applied_settings')).toBe(true);
    expect(session.effortLevel()).toBe('xhigh');
    // `/model opus` typed in the composer: the picker follows the CLI.
    expect(session.modelSelection()).toBe('opus');
  });

  it('does not re-read after an ordinary turn', async () => {
    const { session, calls } = makeSession({ applied: { effort: 'xhigh' } });
    await session.getConnection();
    (session as any).processIncomingMessage({ type: 'result', subtype: 'success', session_id: 's' });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.some((c) => c.type === 'get_applied_settings')).toBe(false);
  });
});
