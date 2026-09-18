/**
 * Step 15: the "Toggle fast mode" row.
 *
 * The official registers it only while the current model reports
 * `supportsFastMode`, with the registry's own label and description, and runs
 * `openClaudeInTerminal("/fast", [], "bottom")` -- step 09's request, whose
 * validator (`JI0`) accepts a bare slash command and an empty argument list.
 */
import { describe, expect, it } from 'vitest';
import { signal } from 'alien-signals';
import { FAST_MODE_LAUNCH, FAST_MODE_ROW, fastModeRows } from '../src/webview/src/components/forge/fastMode';
import {
  isTerminalLocation,
  isValidOpenClaudeInTerminalRequest,
  shellQuote,
} from '../src/services/claude/terminalLaunch';
import { Session } from '../src/webview/src/core/Session';
import type { CliModelInfo } from '../src/shared/messages';

describe('the row (official registry entry)', () => {
  it('copies the id, label, description and section', () => {
    expect(FAST_MODE_ROW).toEqual({
      id: 'fast',
      label: 'Toggle fast mode',
      description: 'Toggle fast mode for faster responses (Opus only)',
      section: 'Model',
    });
  });

  it('closes the menu when run: no keepMenuOpen, no trailing control, not filter-only', () => {
    expect(FAST_MODE_ROW.keepMenuOpen).toBeUndefined();
    expect(FAST_MODE_ROW.trailing).toBeUndefined();
    expect(FAST_MODE_ROW.filterOnly).toBeUndefined();
  });

  it('is registered only when the current model supports fast mode (B4)', () => {
    expect(fastModeRows(true)).toEqual([FAST_MODE_ROW]);
    expect(fastModeRows(false)).toEqual([]);
  });

  it('hands out a copy, so a caller cannot change the registry entry', () => {
    const [row] = fastModeRows(true);
    row.label = 'changed';
    expect(FAST_MODE_ROW.label).toBe('Toggle fast mode');
  });
});

describe('what the row runs (step 09 request)', () => {
  it('is the official openClaudeInTerminal("/fast", [], "bottom")', () => {
    expect(FAST_MODE_LAUNCH).toEqual({ prompt: '/fast', args: [], location: 'bottom' });
  });

  it('passes the host validator and names a location the host knows', () => {
    expect(isValidOpenClaudeInTerminalRequest(FAST_MODE_LAUNCH)).toBe(true);
    expect(isTerminalLocation(FAST_MODE_LAUNCH.location)).toBe(true);
  });

  it('reaches the terminal unquoted: `claude /fast`', () => {
    expect(shellQuote([FAST_MODE_LAUNCH.prompt, ...FAST_MODE_LAUNCH.args])).toBe('/fast');
  });
});

describe('the gate follows the current model (currentModelSupportsFastMode)', () => {
  const MODELS: CliModelInfo[] = [
    { value: 'default', resolvedModel: 'claude-sonnet-5', displayName: 'Default', description: '', supportsFastMode: false },
    { value: 'opus', resolvedModel: 'claude-opus-5', displayName: 'Opus', description: '', supportsFastMode: true },
    { value: 'haiku', displayName: 'Haiku', description: '' },
  ];

  function makeSession() {
    const connection = {
      claudeConfig: signal({ commands: [], models: MODELS, accountInfo: null }),
      config: signal({ modelSetting: 'default' }),
      permissionRequests: signal([]),
    };
    return new Session(async () => connection as never, {
      currentSelection: signal(undefined),
      commandRegistry: { registerAction: () => {} },
      fileOpener: { open: () => {}, openContent: async () => undefined },
    });
  }

  it('shows the row on Opus and hides it on Default, Haiku and unknown models', async () => {
    const session = makeSession();
    await session.getConnection();
    const rowsFor = (selection: string | undefined) => {
      session.modelSelection(selection);
      return fastModeRows(session.currentModelSupportsFastMode()).map((r) => r.id);
    };
    expect(rowsFor(undefined)).toEqual([]);
    expect(rowsFor('opus')).toEqual(['fast']);
    expect(rowsFor('claude-opus-5')).toEqual(['fast']);
    expect(rowsFor('opus[1m]')).toEqual(['fast']);
    expect(rowsFor('haiku')).toEqual([]);
    expect(rowsFor('my-custom-model')).toEqual([]);
  });
});
