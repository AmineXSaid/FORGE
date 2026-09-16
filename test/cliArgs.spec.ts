/**
 * Tests for the CLI flag passthrough gate.
 *
 * This is the seam between user settings and the real `claude` process, so the
 * important cases are the refusals: a flag that reaches the command line when it
 * should not can corrupt the SDK's stream protocol rather than just fail.
 */
import { describe, it, expect } from 'vitest';
import { buildExtraArgs, describeBuild } from '../src/services/claude/cliArgs';

const BASE = {
  debug: null,
  'debug-to-stderr': null,
  settings: '/home/u/.claude/forge.json',
} as Record<string, string | null>;

describe('buildExtraArgs', () => {
  it('returns the base flags untouched when nothing is configured', () => {
    for (const configured of [undefined, null, {}, [], 'nonsense', 42]) {
      const { extraArgs, rejected } = buildExtraArgs(BASE, configured);
      expect(extraArgs).toEqual(BASE);
      expect(rejected).toEqual([]);
    }
  });

  it('passes ordinary flags through, with or without leading dashes', () => {
    const { extraArgs, accepted } = buildExtraArgs(BASE, {
      '--add-dir': '../shared',
      allowedTools: 'Read,Grep',
    });
    expect(extraArgs['add-dir']).toBe('../shared');
    expect(extraArgs['allowedTools']).toBe('Read,Grep');
    expect(accepted.map((a) => a.flag).sort()).toEqual(['add-dir', 'allowedTools']);
  });

  it('treats true and null as valueless flags', () => {
    const { extraArgs } = buildExtraArgs(BASE, { 'dangerously-skip-permissions': true, verbose: null });
    expect(extraArgs['dangerously-skip-permissions']).toBeNull();
    expect(extraArgs['verbose']).toBeNull();
  });

  it('lets false switch off a flag Forge sets by default', () => {
    const { extraArgs } = buildExtraArgs(BASE, { debug: false });
    expect('debug' in extraArgs).toBe(false);
    expect(extraArgs['settings']).toBe(BASE.settings);
  });

  it('coerces numbers and arrays to strings', () => {
    const { extraArgs } = buildExtraArgs(BASE, { 'max-turns': 5, 'allowedTools': ['Read', 'Grep'] });
    expect(extraArgs['max-turns']).toBe('5');
    expect(extraArgs['allowedTools']).toBe('Read,Grep');
  });

  it('hard-rejects flags the SDK stream protocol depends on', () => {
    const protocolFlags = ['print', 'p', 'output-format', 'input-format', 'include-partial-messages'];
    const { extraArgs, rejected } = buildExtraArgs(
      BASE,
      Object.fromEntries(protocolFlags.map((f) => [f, 'text'])),
    );
    for (const f of protocolFlags) {
      expect(extraArgs[f], `${f} must never reach the command line`).toBeUndefined();
    }
    expect(rejected).toHaveLength(protocolFlags.length);
    expect(rejected.every((r) => r.reason.includes('reserved'))).toBe(true);
  });

  it('rejects flag names that are not flag-shaped', () => {
    const { extraArgs, rejected } = buildExtraArgs(BASE, {
      'rm -rf /': 'x',
      'a;b': 'x',
      '--': 'x',
    });
    expect(Object.keys(extraArgs).sort()).toEqual(Object.keys(BASE).sort());
    expect(rejected.map((r) => r.flag).sort()).toEqual(['a;b', 'rm -rf /']);
  });

  it('allows but warns about flags the SDK already sets itself', () => {
    const { extraArgs, warned } = buildExtraArgs(BASE, { model: 'claude-opus-5' });
    expect(extraArgs['model']).toBe('claude-opus-5');
    expect(warned).toHaveLength(1);
    expect(warned[0].flag).toBe('model');
  });

  it('rejects values it cannot represent, without dropping the base', () => {
    const { extraArgs, rejected } = buildExtraArgs(BASE, { 'some-flag': { nested: true } });
    expect(extraArgs).toEqual(BASE);
    expect(rejected[0].reason).toContain('unsupported value type');
  });

  it('never mutates the base map', () => {
    const base = { ...BASE };
    buildExtraArgs(base, { debug: false, 'add-dir': 'x' });
    expect(base).toEqual(BASE);
  });
});

describe('describeBuild', () => {
  it('renders accepted, warned and rejected flags distinguishably', () => {
    const build = buildExtraArgs(BASE, {
      'add-dir': '../shared',
      model: 'claude-opus-5',
      print: true,
    });
    const lines = describeBuild(build).join('\n');
    expect(lines).toContain('+ --add-dir ../shared');
    expect(lines).toContain('! --model claude-opus-5');
    expect(lines).toContain('x --print  REJECTED');
  });
});
