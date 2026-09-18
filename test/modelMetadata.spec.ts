/**
 * Step 12: model metadata.
 *
 * The model list is the CLI's, carried by its initialize response: `models`
 * (selectable, in the CLI's order) and `unavailable_models` (greyed). Every
 * label the picker and the pill show is computed from those rows by functions
 * ported literally from the official webview (`IH`, `PK1`, `bK`, `Xz0`, `wC`,
 * `kH`, `Mo`, `OR`, `V75`), and `set_model` is the official host's: a malformed
 * row is refused, anything else is written to user settings and pushed live.
 */
import { describe, expect, it, vi } from 'vitest';
import { signal } from 'alien-signals';
import {
  PREVIOUS_MODEL_LABEL,
  allModelRows,
  currentModelInfo,
  findModelRow,
  modelFamily,
  modelPillLabel,
  orderAliasRowsLast,
  pickerCurrentValue,
  promoDescriptionParts,
  selectedModelLabel,
  servedModelOf,
  type ModelRow,
} from '../src/webview/src/components/forge/modelCatalog';
import { MALFORMED_SET_MODEL, modelSettingsPatch, parseSetModelRequest } from '../src/services/claude/setModel';
import { OFFICIAL_CLI_ENTRYPOINT, withOfficialEntrypoint } from '../src/services/claude/cliLaunch';
import { Session } from '../src/webview/src/core/Session';

const DEFAULT: ModelRow = {
  value: 'default',
  resolvedModel: 'claude-sonnet-5',
  displayName: 'Default (recommended)',
  description: 'Sonnet 5 · Efficient for routine tasks',
  supportsEffort: true,
  supportedEffortLevels: ['low', 'medium', 'high'],
};
const SONNET: ModelRow = { ...DEFAULT, value: 'sonnet', displayName: 'Sonnet' };
const FABLE: ModelRow = {
  value: 'fable',
  resolvedModel: 'claude-fable-5-1',
  displayName: 'Fable',
  description: 'Fable 5.1 · Most capable for your hardest and longest-running tasks',
};
const OPUS: ModelRow = {
  value: 'opus',
  resolvedModel: 'claude-opus-5',
  displayName: 'Opus',
  description: 'Opus 5 · Best for everyday, complex tasks · $2.50/$12.50 per Mtok',
  promoListPrice: '$5/$25',
  supportsEffort: true,
  supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  supportsFastMode: true,
  supportsAutoMode: true,
  supportsAdaptiveThinking: true,
};
const HAIKU: ModelRow = {
  value: 'haiku',
  resolvedModel: 'claude-haiku-4-5',
  displayName: 'Haiku',
  description: 'Haiku 4.5 · Fastest for quick answers',
  supportsEffort: false,
};
const OPUS_1M_UNAVAILABLE: ModelRow = {
  value: 'opus[1m]',
  resolvedModel: 'claude-opus-5[1m]',
  displayName: 'Opus (1M context)',
  description: "Opus 5 with 1M context · Not available with your organization's data retention settings",
  disabled: true,
};
const MODELS = [DEFAULT, SONNET, FABLE, OPUS, HAIKU];
const ROWS = allModelRows({ models: MODELS, unavailable_models: [OPUS_1M_UNAVAILABLE] });

describe('IH: the rows come from the initialize response, in the CLI order', () => {
  it('lists the selectable models first, in order, then the unavailable ones', () => {
    expect(ROWS.map((m) => m.value)).toEqual(['default', 'sonnet', 'fable', 'opus', 'haiku', 'opus[1m]']);
  });

  it('keeps every field the CLI sent, including the @internal ones', () => {
    const opus = ROWS.find((m) => m.value === 'opus')!;
    expect(opus).toEqual(OPUS);
    expect(ROWS.at(-1)?.disabled).toBe(true);
  });

  it('copes with either list being absent (the CLI omits unavailable_models when empty)', () => {
    expect(allModelRows(undefined)).toEqual([]);
    expect(allModelRows({ models: MODELS })).toEqual(MODELS);
    expect(allModelRows({ unavailable_models: [OPUS_1M_UNAVAILABLE] })).toEqual([OPUS_1M_UNAVAILABLE]);
  });
});

describe('PK1: alias rows go last, everything else keeps the SDK order', () => {
  it('leaves an alias-free list exactly as the CLI ordered it', () => {
    expect(orderAliasRowsLast(MODELS)).toEqual(MODELS);
  });

  it('moves a row whose name or description says "alias" after the rest, keeping their order', () => {
    const alias = { ...SONNET, value: 'sonnet-alias', description: 'Alias for the latest Sonnet' };
    const aliases = { ...HAIKU, value: 'haiku-aliases', displayName: 'Haiku aliases' };
    const ordered = orderAliasRowsLast([alias, DEFAULT, aliases, OPUS]);
    expect(ordered.map((m) => m.value)).toEqual(['default', 'opus', 'sonnet-alias', 'haiku-aliases']);
  });

  it('does not match "alias" inside a longer word', () => {
    const row = { ...OPUS, description: 'Opus 5 · aliasing-safe' };
    expect(orderAliasRowsLast([row, DEFAULT])[0]).toBe(row);
  });
});

describe('bK / currentModelInfo: which row the capabilities come from', () => {
  it('treats no selection as Default', () => {
    expect(findModelRow(ROWS, undefined)).toBe(DEFAULT);
    expect(currentModelInfo(ROWS, undefined)).toBe(DEFAULT);
  });

  it('finds an explicit id through the alias row that resolves to it, never through Default', () => {
    expect(findModelRow(ROWS, 'claude-opus-5')).toBe(OPUS);
    // claude-sonnet-5 is Default's resolvedModel too, but bK skips the Default row.
    expect(findModelRow(ROWS, 'claude-sonnet-5')).toBe(SONNET);
  });

  it('currentModelInfo also strips [1m] before matching', () => {
    expect(currentModelInfo(ROWS, 'haiku[1m]')).toBe(HAIKU);
    expect(currentModelInfo(ROWS, 'opus[1m]')?.value).toBe('opus[1m]');
  });

  it('returns undefined for a model the CLI does not list', () => {
    expect(findModelRow(ROWS, 'my-custom-model')).toBeUndefined();
    expect(currentModelInfo(ROWS, 'my-custom-model')).toBeUndefined();
  });

  it('reads the capability fields off the row', () => {
    expect(currentModelInfo(ROWS, 'opus')?.supportsFastMode).toBe(true);
    expect(currentModelInfo(ROWS, 'haiku')?.supportsEffort).toBe(false);
    expect(currentModelInfo(ROWS, 'sonnet')?.supportedEffortLevels).toEqual(['low', 'medium', 'high']);
  });
});

describe('Xz0: the ticked row', () => {
  it('is Default for no selection', () => {
    expect(pickerCurrentValue(ROWS, undefined)).toBe('default');
    expect(pickerCurrentValue(ROWS, 'default')).toBe('default');
  });

  it('maps a persisted full id onto the alias row that covers it', () => {
    expect(pickerCurrentValue(ROWS, 'claude-opus-5')).toBe('opus');
    expect(pickerCurrentValue(ROWS, 'claude-haiku-4-5[1m]')).toBe('haiku');
  });

  it('keeps an id no row covers, so a custom model can still be ticked', () => {
    expect(pickerCurrentValue(ROWS, 'my-custom-model')).toBe('my-custom-model');
  });
});

describe('wC: the selected model label, and the model that actually served', () => {
  it('is the row name when nothing has been served yet', () => {
    expect(selectedModelLabel('default', undefined, ROWS)).toBe('Default (recommended)');
    expect(selectedModelLabel('opus', undefined, ROWS)).toBe('Opus');
  });

  it('names the served model when Default was answered by another family', () => {
    expect(selectedModelLabel('default', 'claude-opus-5', ROWS)).toBe('Opus 5');
  });

  it('keeps the row name when the served model is the same family', () => {
    expect(selectedModelLabel('sonnet', 'claude-sonnet-5', ROWS)).toBe('Sonnet');
  });

  it('names a served Bedrock inference-profile id by family and version', () => {
    expect(selectedModelLabel('default', 'us.anthropic.claude-haiku-4-5-20251001-v1:0', ROWS)).toBe('Haiku 4.5');
  });

  it('keeps the selected name when the served model is of no known family', () => {
    // wC only switches when the served model's family (`mj`) is known.
    expect(selectedModelLabel('default', 'claude-mythos-v2-prod', ROWS)).toBe('Default (recommended)');
  });

  it('masks a codename past its first three letters when it has to name it', () => {
    expect(selectedModelLabel('not-listed', 'claude-mythos-v2-prod', ROWS)).toBe('Myt*** 2');
  });

  it('falls back to "The previous model" for an id it cannot read', () => {
    expect(selectedModelLabel('nonexistent', 'gpt-5', [])).toBe(PREVIOUS_MODEL_LABEL);
  });

  it('knows the four families and nothing else', () => {
    expect(['opus', 'sonnet', 'haiku', 'fable'].map(modelFamily)).toEqual(['opus', 'sonnet', 'haiku', 'fable']);
    expect(modelFamily('gpt-5')).toBeUndefined();
    expect(modelFamily(undefined)).toBeUndefined();
  });
});

describe('the pill: the concrete model, not the alias', () => {
  it('shows Default as the model it resolves to', () => {
    expect(modelPillLabel(ROWS, 'default', undefined)).toBe('Sonnet 5');
    expect(modelPillLabel(ROWS, undefined, undefined)).toBe('Sonnet 5');
  });

  it('shows Default as whatever served the last turn, once it differs', () => {
    expect(modelPillLabel(ROWS, 'default', 'claude-opus-5')).toBe('Opus 5');
  });

  it('shows a minor version from resolvedModel', () => {
    expect(modelPillLabel(ROWS, 'fable', undefined)).toBe('Fable 5.1');
    expect(modelPillLabel(ROWS, 'haiku', undefined)).toBe('Haiku 4.5');
  });

  it('shows a newer served model of the same family', () => {
    expect(modelPillLabel(ROWS, 'opus', 'claude-opus-5-1')).toBe('Opus 5.1');
  });

  it('marks a 1M row from its display name', () => {
    expect(modelPillLabel(ROWS, 'opus[1m]', undefined)).toBe('Opus 5 (1M)');
  });

  it('shows a row that has a name of its own as that name', () => {
    const plan = { ...OPUS, value: 'opusplan', resolvedModel: 'claude-opus-5', displayName: 'Opus Plan Mode' };
    expect(modelPillLabel([...ROWS, plan], 'opusplan', undefined)).toBe('Opus Plan Mode');
  });

  it('formats an unlisted full id, and says "Model" when it cannot', () => {
    expect(modelPillLabel(ROWS, 'claude-sonnet-4-5-20250929', undefined)).toBe('Sonnet 4.5');
    expect(modelPillLabel(ROWS, 'my-custom-model', undefined)).toBe('Model');
  });

  it('has no label with no rows at all, so the pill falls back to "Model"', () => {
    expect(modelPillLabel([], 'default', undefined)).toBeUndefined();
  });
});

describe('V75: the promo list price is struck through before the price', () => {
  it('splits the description around the first $X/$Y per Mtok', () => {
    expect(promoDescriptionParts(OPUS)).toEqual({
      before: 'Opus 5 · Best for everyday, complex tasks · ',
      listPrice: '$5/$25',
      price: '$2.50/$12.50 per Mtok',
      after: '',
    });
  });

  it('does nothing without a promo, or without a price to put it before', () => {
    expect(promoDescriptionParts(SONNET)).toBeUndefined();
    expect(promoDescriptionParts({ description: 'Opus 5 · no price here', promoListPrice: '$5/$25' })).toBeUndefined();
  });
});

describe('lastServedModel: which messages name the serving model', () => {
  it('takes the model off a top-level assistant message', () => {
    expect(servedModelOf({ type: 'assistant', parent_tool_use_id: null, message: { model: 'claude-opus-5' } })).toBe(
      'claude-opus-5'
    );
  });

  it('ignores sub-agent turns, synthetic messages and everything that is not an assistant message', () => {
    expect(servedModelOf({ type: 'assistant', parent_tool_use_id: 'toolu_1', message: { model: 'claude-haiku-4-5' } })).toBeUndefined();
    expect(servedModelOf({ type: 'assistant', message: { model: '<synthetic>' } })).toBeUndefined();
    expect(servedModelOf({ type: 'assistant', message: {} })).toBeUndefined();
    expect(servedModelOf({ type: 'user', message: { model: 'claude-opus-5' } })).toBeUndefined();
  });
});

describe('set_model (host): the official check and settings patch', () => {
  it('accepts a full row and a bare {value}', () => {
    expect(parseSetModelRequest(OPUS)).toBe('opus');
    expect(parseSetModelRequest({ value: 'default' })).toBe('default');
  });

  it('does not check the value against the model list, as the official does not', () => {
    // Full ids, [1m] variants and Forge custom models are all legitimate.
    expect(parseSetModelRequest({ value: 'claude-opus-5[1m]' })).toBe('claude-opus-5[1m]');
    expect(parseSetModelRequest({ value: 'my-custom-model' })).toBe('my-custom-model');
  });

  it('refuses anything whose value is not a string, with the official message', () => {
    for (const bad of [undefined, null, 'opus', 42, {}, [], { value: 42 }, { value: null }, { displayName: 'Opus' }]) {
      expect(() => parseSetModelRequest(bad)).toThrow(MALFORMED_SET_MODEL);
    }
  });

  it('clears the setting for Default instead of writing "default"', () => {
    expect(modelSettingsPatch('default')).toEqual({ model: null });
  });

  it('writes any other value as is', () => {
    expect(modelSettingsPatch('opus')).toEqual({ model: 'opus' });
    expect(modelSettingsPatch('claude-opus-5[1m]')).toEqual({ model: 'claude-opus-5[1m]' });
  });
});

describe('the CLI environment carries the official entrypoint', () => {
  it('stamps claude-vscode, which is what makes the CLI send unavailable_models', () => {
    expect(OFFICIAL_CLI_ENTRYPOINT).toBe('claude-vscode');
    expect(withOfficialEntrypoint({ PATH: '/bin' })).toEqual({ PATH: '/bin', CLAUDE_CODE_ENTRYPOINT: 'claude-vscode' });
  });

  it('wins over a user variable of the same name, as the official sets it last', () => {
    expect(withOfficialEntrypoint({ CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' }).CLAUDE_CODE_ENTRYPOINT).toBe('claude-vscode');
  });

  it('does not mutate the env it is given', () => {
    const env = { A: '1' };
    withOfficialEntrypoint(env);
    expect(env).toEqual({ A: '1' });
  });
});

describe('Session: model state, end to end', () => {
  function makeSession(setModel: (channelId: string, model: unknown) => Promise<unknown>) {
    const notify = vi.fn(async () => undefined);
    const connection = {
      claudeConfig: signal({ commands: [], models: MODELS, unavailable_models: [OPUS_1M_UNAVAILABLE], accountInfo: null }),
      config: signal({ modelSetting: 'default' }),
      permissionRequests: signal([]),
      setModel,
    };
    const session = new Session(async () => connection as never, {
      currentSelection: signal(undefined),
      commandRegistry: { registerAction: () => {} },
      fileOpener: { open: () => {}, openContent: async () => undefined },
      showNotification: notify,
    });
    return { session, notify, connection };
  }

  it('reads the current model capabilities off the CLI rows', async () => {
    const { session } = makeSession(async () => ({ type: 'set_model_response' }));
    await session.getConnection();
    expect(session.currentModelInfo()?.value).toBe('default');
    expect(session.currentModelSupportsEffort()).toBe(true);
    expect(session.currentModelSupportsFastMode()).toBe(false);

    session.modelSelection('opus');
    expect(session.currentModelSupportsFastMode()).toBe(true);
    expect(session.currentModelSupportsAutoMode()).toBe(true);
    expect(session.currentModelSupportsAdaptiveThinking()).toBe(true);

    session.modelSelection('haiku');
    expect(session.currentModelSupportsEffort()).toBe(false);

    session.modelSelection('my-custom-model');
    expect(session.currentModelInfo()).toBeUndefined();
    // Unknown stays unknown for auto mode, as the official keeps it.
    expect(session.currentModelSupportsAutoMode()).toBeUndefined();
  });

  it('records the model that served the last top-level turn', async () => {
    const { session } = makeSession(async () => ({ type: 'set_model_response' }));
    (session as any).processMessage({ type: 'assistant', parent_tool_use_id: null, message: { model: 'claude-opus-5', content: [] } });
    expect(session.lastServedModel()).toBe('claude-opus-5');
    (session as any).processMessage({ type: 'assistant', parent_tool_use_id: 'toolu_1', message: { model: 'claude-haiku-4-5', content: [] } });
    expect(session.lastServedModel()).toBe('claude-opus-5');
  });

  it('sends the picked row and forgets the last served model', async () => {
    const setModel = vi.fn(async () => ({ type: 'set_model_response' }));
    const { session } = makeSession(setModel);
    (session as any).claudeChannelId('ch1');
    session.lastServedModel('claude-sonnet-5');

    expect(await session.setModel(OPUS)).toBe(true);
    expect(setModel).toHaveBeenCalledWith('ch1', OPUS);
    expect(session.modelSelection()).toBe('opus');
    expect(session.lastServedModel()).toBeUndefined();
  });

  it('puts the selection and served model back, and says so, when the host refuses', async () => {
    const { session, notify } = makeSession(async () => {
      throw new Error(MALFORMED_SET_MODEL);
    });
    (session as any).claudeChannelId('ch1');
    session.modelSelection('sonnet');
    session.lastServedModel('claude-sonnet-5');

    expect(await session.setModel(OPUS)).toBe(false);
    expect(session.modelSelection()).toBe('sonnet');
    expect(session.lastServedModel()).toBe('claude-sonnet-5');
    expect(notify).toHaveBeenCalledWith(`Failed to set model: ${MALFORMED_SET_MODEL}`, 'error');
  });
});
