/**
 * Tests for the CLI flag passthrough gate.
 *
 * This is the seam between user settings and the real `claude` process, so the
 * important cases are the refusals: a flag that reaches the command line when it
 * should not can corrupt the SDK's stream protocol rather than just fail. Every
 * other flag must stay usable -- the gate only warns, and only when the flag is
 * really duplicated.
 */
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { describe, it, expect } from 'vitest';
import { SDK_DERIVED_FLAGS, SDK_INITIALIZE_FLAGS, buildExtraArgs, describeBuild } from '../src/services/claude/cliArgs';

const BASE = {
  debug: null,
  'debug-to-stderr': null,
  settings: '/home/u/.claude/forge.json',
} as Record<string, string | null>;

/** The Options ClaudeSdkService passes on a normal launch (without the callbacks). */
const FORGE_LAUNCH = {
  cwd: '/work',
  model: 'default',
  permissionMode: 'default',
  maxThinkingTokens: 31999,
  settingSources: ['user', 'project', 'local'],
  includePartialMessages: true,
  systemPrompt: { type: 'preset', preset: 'claude_code', append: '...' },
  pathToClaudeCodeExecutable: '/ext/resources/native-binary/claude',
};

describe('buildExtraArgs', () => {
  it('returns the base flags untouched when nothing is configured', () => {
    for (const configured of [undefined, null, {}, [], 'nonsense', 42]) {
      const { extraArgs, rejected } = buildExtraArgs(BASE, configured);
      expect(extraArgs).toEqual(BASE);
      expect(rejected).toEqual([]);
    }
  });

  it('passes ordinary flags through, with or without leading dashes', () => {
    const { extraArgs, accepted, warned } = buildExtraArgs(BASE, {
      '--add-dir': '../shared',
      allowedTools: 'Read,Grep',
      ide: true,
    }, FORGE_LAUNCH);
    expect(extraArgs['add-dir']).toBe('../shared');
    expect(extraArgs['allowedTools']).toBe('Read,Grep');
    expect(extraArgs['ide']).toBeNull();
    expect(warned).toEqual([]);
    expect(accepted.map((a) => a.flag).sort()).toEqual(['add-dir', 'allowedTools', 'ide']);
  });

  it('names the SDK option behind a derived flag that Forge does not set', () => {
    const { accepted } = buildExtraArgs(BASE, { effort: 'high', 'fallback-model': 'sonnet', ide: null }, FORGE_LAUNCH);
    expect(accepted).toEqual([
      { flag: 'effort', value: 'high', reason: 'passthrough (SDK option effort is not set)' },
      { flag: 'fallback-model', value: 'sonnet', reason: 'passthrough (SDK option fallbackModel is not set)' },
      { flag: 'ide', value: null, reason: 'passthrough' },
    ]);
  });

  it('treats true and null as valueless flags', () => {
    const { extraArgs } = buildExtraArgs(BASE, { 'strict-mcp-config': true, verbose: null });
    expect(extraArgs['strict-mcp-config']).toBeNull();
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
    const protocolFlags = ['print', 'p', 'output-format', 'input-format', 'include-partial-messages', 'permission-prompt-tool'];
    const { extraArgs, rejected } = buildExtraArgs(
      BASE,
      Object.fromEntries(protocolFlags.map((f) => [f, 'text'])),
      FORGE_LAUNCH,
    );
    for (const f of protocolFlags) {
      expect(extraArgs[f], `${f} must never reach the command line`).toBeUndefined();
    }
    expect(rejected).toHaveLength(protocolFlags.length);
    expect(rejected.every((r) => r.reason.includes('reserved'))).toBe(true);
  });

  it('rejects permission-prompt-tool even as a valueless flag', () => {
    const { extraArgs, rejected } = buildExtraArgs(BASE, { '--permission-prompt-tool': true });
    expect('permission-prompt-tool' in extraArgs).toBe(false);
    expect(rejected).toEqual([
      { flag: 'permission-prompt-tool', value: null, reason: 'reserved: the SDK stream protocol depends on this flag' },
    ]);
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

  it('warns when the SDK emits the same flag from an option set on this launch', () => {
    const { extraArgs, warned } = buildExtraArgs(BASE, { model: 'claude-opus-5' }, FORGE_LAUNCH);
    expect(extraArgs['model']).toBe('claude-opus-5');
    expect(warned).toEqual([
      { flag: 'model', value: 'claude-opus-5', reason: 'the SDK also emits it from model on this launch; the CLI decides which wins' },
    ]);
  });

  it('does not warn about the same flag when that option is not set', () => {
    const { warned, accepted } = buildExtraArgs(BASE, { model: 'claude-opus-5' });
    expect(warned).toEqual([]);
    expect(accepted[0].reason).toBe('passthrough (SDK option model is not set)');
  });

  it('warns about --thinking and --max-thinking-tokens, which 0.3.x derives from maxThinkingTokens', () => {
    const { warned } = buildExtraArgs(BASE, { 'setting-sources': 'user', 'max-thinking-tokens': 1024, '--thinking': 'adaptive' }, FORGE_LAUNCH);
    expect(warned.map((w) => w.flag)).toEqual(['setting-sources', 'max-thinking-tokens', 'thinking']);
    // maxThinkingTokens: 0 is emitted too (as --thinking disabled).
    const off = buildExtraArgs(BASE, { thinking: 'adaptive' }, { ...FORGE_LAUNCH, maxThinkingTokens: 0 });
    expect(off.warned.map((w) => w.flag)).toEqual(['thinking']);
  });

  it('follows the SDK builder for options that are emitted only in some shapes', () => {
    const emitted = (flag: string, options: Record<string, unknown>) => SDK_DERIVED_FLAGS.get(flag)!.emitted(options);
    expect(emitted('allowedTools', { allowedTools: [] })).toBe(false);
    expect(emitted('allowedTools', { skills: ['review'] })).toBe(true);
    expect(emitted('tools', { tools: [] })).toBe(true);
    expect(emitted('mcp-config', { mcpServers: {} })).toBe(false);
    expect(emitted('mcp-config', { mcpServers: { a: { command: 'x' } } })).toBe(true);
    expect(emitted('no-session-persistence', { persistSession: true })).toBe(false);
    expect(emitted('no-session-persistence', { persistSession: false })).toBe(true);
    expect(emitted('await-initialize', { pluginDelivery: 'argv' })).toBe(false);
    expect(emitted('await-initialize', { pluginDelivery: 'initialize' })).toBe(true);
    expect(emitted('setting-sources', { settingSources: [] })).toBe(true);
    expect(emitted('thinking-display', { thinking: { type: 'adaptive' } })).toBe(false);
    expect(emitted('thinking-display', { thinking: { type: 'adaptive', display: 'summarized' } })).toBe(true);
    expect(emitted('verbose', {})).toBe(true);
  });

  it('warns about --append-system-prompt, which overlaps the systemPrompt the SDK sends in initialize', () => {
    const { warned } = buildExtraArgs(BASE, { 'append-system-prompt': 'be brief' }, FORGE_LAUNCH);
    expect(warned[0].reason).toContain('systemPrompt (sent in initialize)');
  });

  it("warns when a configured value replaces one of Forge's own flags", () => {
    const { extraArgs, warned } = buildExtraArgs(BASE, { settings: '/tmp/other.json' }, FORGE_LAUNCH);
    expect(extraArgs['settings']).toBe('/tmp/other.json');
    expect(warned).toEqual([
      { flag: 'settings', value: '/tmp/other.json', reason: "replaces Forge's own --settings /home/u/.claude/forge.json" },
    ]);
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

describe('SDK_DERIVED_FLAGS against the installed SDK', () => {
  /** Every `--flag` the installed sdk.mjs argument builder can push. */
  function builderFlags(): Set<string> {
    const require = createRequire(import.meta.url);
    const source = readFileSync(require.resolve('@anthropic-ai/claude-agent-sdk'), 'utf8');
    const start = source.indexOf('["--output-format","stream-json","--verbose","--input-format","stream-json"]');
    expect(start, 'the SDK argument builder moved; re-read sdk.mjs').toBeGreaterThan(0);
    const end = source.indexOf('Object.entries(', start);
    const segment = source.slice(start, end);
    const literals = [...segment.matchAll(/["`]--([a-zA-Z][a-zA-Z0-9-]*)/g)].map((m) => m[1]);
    const viaHelper = [...segment.matchAll(/,"([a-z][a-z-]*)",[a-zA-Z$_]+\)/g)].map((m) => m[1]);
    // Options.settings is merged into extraArgs, which then become `--settings`.
    const viaExtraArgs = /\.settings=this\.options\.settings/.test(segment) ? ['settings'] : [];
    return new Set([...literals, ...viaHelper, ...viaExtraArgs]);
  }

  it('classifies every flag the SDK derives, and nothing it does not', () => {
    const fromSdk = builderFlags();
    const classified = new Set([...SDK_DERIVED_FLAGS.keys(), 'output-format', 'input-format', 'include-partial-messages', 'permission-prompt-tool']);
    expect([...fromSdk].filter((f) => !classified.has(f)).sort(), 'SDK flags missing from SDK_DERIVED_FLAGS').toEqual([]);
    expect([...classified].filter((f) => !fromSdk.has(f)).sort(), 'listed flags the SDK no longer derives').toEqual([]);
  });

  it('keeps the initialize overlaps out of the command-line list', () => {
    for (const flag of SDK_INITIALIZE_FLAGS.keys()) expect(SDK_DERIVED_FLAGS.has(flag)).toBe(false);
  });
});

describe('describeBuild', () => {
  it('renders accepted, warned and rejected flags distinguishably', () => {
    const build = buildExtraArgs(BASE, {
      'add-dir': '../shared',
      model: 'claude-opus-5',
      print: true,
    }, FORGE_LAUNCH);
    const lines = describeBuild(build).join('\n');
    expect(lines).toContain('+ --add-dir ../shared');
    expect(lines).toContain('! --model claude-opus-5');
    expect(lines).toContain('x --print  REJECTED');
  });
});
