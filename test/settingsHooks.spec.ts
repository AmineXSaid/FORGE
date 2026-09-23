/**
 * The Hooks tab's edits to the `hooks` setting, and the Settings search.
 *
 * What matters about hooks is the file the CLI reads afterwards: the shape
 * (`{ [event]: [{ matcher?, hooks: [{ type, command, timeout? }] }] }`), that
 * a hook the tab cannot show survives an edit beside it, and that a bad hook
 * is refused before anything is written.
 */
import { describe, expect, it } from 'vitest';
import {
  HOOK_EVENTS,
  addHook,
  asHooksConfig,
  hookRows,
  removeHook,
  validateHook,
} from '../src/webview/src/components/settings/hooks';
import { SETTINGS_INDEX, searchSettings } from '../src/webview/src/components/settings/settingsSearch';

describe('hooks: what is written', () => {
  it('adds a command hook in the CLI shape, joining an entry with the same matcher', () => {
    let config = addHook({}, { event: 'PostToolUse', matcher: 'Edit|Write', command: 'npx prettier --write .' });
    expect(config).toEqual({
      PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'npx prettier --write .' }] }],
    });
    config = addHook(config, { event: 'PostToolUse', matcher: 'Edit|Write', command: 'npm run lint', timeout: 30 });
    expect(config.PostToolUse).toHaveLength(1);
    expect(config.PostToolUse[0].hooks).toEqual([
      { type: 'command', command: 'npx prettier --write .' },
      { type: 'command', command: 'npm run lint', timeout: 30 },
    ]);
  });

  it('leaves the matcher out for events that take none', () => {
    const config = addHook({}, { event: 'UserPromptSubmit', matcher: 'ignored', command: 'echo hi' });
    expect(config).toEqual({ UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] });
  });

  it('keeps hooks it cannot show (other types, other events) through an edit', () => {
    const existing = asHooksConfig({
      Stop: [{ hooks: [{ type: 'prompt', prompt: 'Did you run the tests?' }] }],
      WorktreeCreate: [{ hooks: [{ type: 'command', command: 'make-worktree' }] }],
    });
    const next = addHook(existing, { event: 'Stop', matcher: '', command: 'say done' });
    expect(next.WorktreeCreate).toEqual(existing.WorktreeCreate);
    expect(next.Stop[0].hooks).toEqual([
      { type: 'prompt', prompt: 'Did you run the tests?' },
      { type: 'command', command: 'say done' },
    ]);
  });

  it('removes one hook, then the empty entry, then the empty event', () => {
    let config = addHook({}, { event: 'PreToolUse', matcher: 'Bash', command: 'a' });
    config = addHook(config, { event: 'PreToolUse', matcher: 'Bash', command: 'b' });
    config = addHook(config, { event: 'PreToolUse', matcher: 'Read', command: 'c' });
    const rows = hookRows(config);
    expect(rows.map((r) => [r.matcher, r.command])).toEqual([['Bash', 'a'], ['Bash', 'b'], ['Read', 'c']]);
    config = removeHook(config, rows[0]);
    expect(config.PreToolUse[0].hooks.map((h) => h.command)).toEqual(['b']);
    config = removeHook(config, hookRows(config)[0]);
    expect(config.PreToolUse.map((g) => g.matcher)).toEqual(['Read']);
    config = removeHook(config, hookRows(config)[0]);
    expect(config).toEqual({});
  });

  it('ignores a stale row rather than removing the wrong hook', () => {
    const config = addHook({}, { event: 'Stop', matcher: '', command: 'a' });
    expect(removeHook(config, { event: 'Stop', group: 3, index: 0 })).toBe(config);
    expect(removeHook(config, { event: 'Nope', group: 0, index: 0 })).toBe(config);
  });

  it('reads only well-formed entries out of whatever the file holds', () => {
    expect(asHooksConfig(null)).toEqual({});
    expect(asHooksConfig(['x'])).toEqual({});
    expect(asHooksConfig({ Stop: 'x', PreToolUse: [{ nope: 1 }, { hooks: [] }] })).toEqual({ PreToolUse: [{ hooks: [] }] });
  });
});

describe('hooks: what is refused', () => {
  it('needs an offered event, a command on one line, a valid matcher and a sane timeout', () => {
    const ok = { event: 'PreToolUse', matcher: 'Bash', command: 'echo ok' };
    expect(validateHook(ok)).toBeUndefined();
    expect(validateHook({ ...ok, matcher: '*' })).toBeUndefined();
    expect(validateHook({ ...ok, event: 'Bogus' })).toMatch(/event/);
    expect(validateHook({ ...ok, command: '   ' })).toMatch(/command/);
    expect(validateHook({ ...ok, command: 'a\nb' })).toMatch(/one line/);
    expect(validateHook({ ...ok, matcher: 'Edit|(' })).toMatch(/pattern/);
    expect(validateHook({ ...ok, timeout: 0 })).toBeUndefined();
    expect(validateHook({ ...ok, timeout: 30 })).toBeUndefined();
    expect(validateHook({ ...ok, timeout: 5000 })).toMatch(/Timeout/);
    expect(validateHook({ ...ok, timeout: 1.5 })).toMatch(/Timeout/);
  });

  it('offers only events the CLI knows, each with its summary', () => {
    const cliEvents = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'UserPromptSubmit', 'Notification', 'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact', 'SessionStart', 'SessionEnd'];
    expect(HOOK_EVENTS.map((e) => e.id)).toEqual(cliEvents);
    for (const e of HOOK_EVENTS) expect(e.summary.length).toBeGreaterThan(5);
  });
});

describe('settings search', () => {
  const tabs = Object.keys(SETTINGS_INDEX).map((id) => ({ id, label: id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') }));

  it('returns every tab, in order, for an empty query', () => {
    expect(searchSettings('  ', tabs)).toEqual(tabs);
  });

  it('finds a tab by a setting inside it, best match first', () => {
    expect(searchSettings('proxy', tabs)[0].id).toBe('network');
    expect(searchSettings('claude.md', tabs).map((t) => t.id)).toEqual(['memory-and-rules']);
    expect(searchSettings('hooks', tabs)[0].id).toBe('hooks');
    expect(searchSettings('PreToolUse', tabs).map((t) => t.id)).toEqual(['hooks']);
    expect(searchSettings('marketplace', tabs)[0].id).toBe('plugins');
  });

  it('says nothing matches rather than guessing', () => {
    expect(searchSettings('zzzz', tabs)).toEqual([]);
  });
});
