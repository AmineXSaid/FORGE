/**
 * Forge's branding for "Open Forge in Terminal" (terminalBrand.ts).
 *
 * The CLI runs unmodified; Forge brands only what it owns (the banner VS Code
 * writes before the shell starts) and what the CLI documents (its --settings
 * keys). These specs pin both: the banner draws the real mark, and the settings
 * file carries only documented keys.
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BANNER_KEYS,
  BANNER_WIDTH,
  FORGE_TIPS,
  MARK_COLOURS,
  SPINNER_VERBS,
  announcement,
  brandEnvironment,
  forgeBanner,
  inkAt,
  markLines,
  markPixels,
  statusLineCommand,
  terminalSettings,
  withHooks,
} from '../src/services/claude/terminalBrand';

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { line: statusLine, branchOf } = require('../resources/terminal/statusline.js');

describe('the mark in the terminal', () => {
  it('uses the colours of the --forge-mark-* tokens', () => {
    const palette = read('src/webview/src/styles/forge-pajamas.css');
    const tokens = read('src/webview/src/styles/forge-tokens.css');
    const hex = (token: string) => {
      const stop = tokens.match(new RegExp(`${token}:\\s*var\\(--pajamas-([a-z0-9-]+)\\)`))?.[1];
      return palette.match(new RegExp(`--pajamas-${stop}:\\s*(#[0-9a-fA-F]{6})`))?.[1]?.toLowerCase();
    };
    expect(MARK_COLOURS.f).toBe(hex('--forge-mark-f'));
    expect(MARK_COLOURS.top).toBe(hex('--forge-mark-cube-top'));
    expect(MARK_COLOURS.lit).toBe(hex('--forge-mark-cube-lit'));
    expect(MARK_COLOURS.shade).toBe(hex('--forge-mark-cube-shade'));
  });

  it('samples the F and the three cube faces where marks.ts puts them', () => {
    expect(inkAt(1, 3)).toBe('f'); // stem
    expect(inkAt(4, 1)).toBe('f'); // top bar
    expect(inkAt(4, 3.1)).toBe('top');
    expect(inkAt(3, 4.5)).toBe('lit');
    expect(inkAt(5, 4.5)).toBe('shade');
    expect(inkAt(3, 2.2)).toBeNull(); // the niche above the cube
    expect(inkAt(0.5, 6.5)).toBeNull();
  });

  it('is 18 pixels square, 9 terminal rows of half blocks, each row 18 cells wide', () => {
    const px = markPixels();
    expect(px).toHaveLength(18);
    expect(px.every((row) => row.length === 18)).toBe(true);
    const lines = markLines();
    expect(lines).toHaveLength(9);
    for (const l of lines) expect([...strip(l)]).toHaveLength(18);
    // Every ink shows up somewhere.
    const inks = new Set(px.flat());
    for (const ink of ['f', 'top', 'lit', 'shade']) expect(inks).toContain(ink);
  });
});

describe('the banner', () => {
  const info = { version: '0.1.1', endpoint: 'company-llama', model: 'qwen3-coder', agent: 'release' };

  it('names Forge, the version, the endpoint, the model and the agent', () => {
    const text = strip(forgeBanner(info));
    for (const s of ['Forge', 'v0.1.1', 'company-llama', 'qwen3-coder', 'release']) expect(text).toContain(s);
  });

  it('says Anthropic API when no endpoint profile is active', () => {
    expect(strip(forgeBanner({ version: '0.1.1' }))).toContain('Anthropic API');
  });

  it('writes CRLF lines, as text written straight to a terminal needs', () => {
    const banner = forgeBanner(info);
    expect(banner.replace(/\r\n/g, '')).not.toMatch(/\n/);
  });

  it('says what it runs on in one line: the model, the endpoint, the agent', () => {
    const lines = strip(forgeBanner(info)).split('\r\n');
    expect(lines.some((l) => l.includes('qwen3-coder on company-llama · agent release'))).toBe(true);
    expect(strip(forgeBanner({ version: '0.1.1', endpoint: 'e' }))).toContain(' e');
  });

  it('shows the keys worth knowing, and ends in a rule', () => {
    const lines = strip(forgeBanner(info)).split('\r\n').filter(Boolean);
    const keys = lines.find((l) => l.includes('commands'))!;
    for (const [key, what] of BANNER_KEYS) expect(keys).toContain(`${key} ${what}`);
    expect(lines.at(-1)!.trim()).toMatch(/^─+$/);
  });

  it('fits an 80-column terminal: no line is wider than BANNER_WIDTH', () => {
    for (const color of [true, false]) {
      for (const l of strip(forgeBanner({ ...info, color })).split('\r\n')) expect(l.length).toBeLessThanOrEqual(BANNER_WIDTH);
    }
    expect(BANNER_WIDTH).toBeLessThanOrEqual(80);
  });

  it('draws the mark in colour, and plain text for NO_COLOR', () => {
    expect(forgeBanner(info)).toMatch(/\x1b\[38;2;119;89;194m/);
    const plain = forgeBanner({ ...info, color: false });
    expect(plain).not.toMatch(/\x1b\[/);
    expect(plain).toContain('Forge');
  });
});

describe('the settings file', () => {
  const info = { endpoint: 'company-llama', model: 'qwen3-coder', agent: 'release' };
  const settings = terminalSettings({ env: { A: '1' }, model: 'x' }, info, 'CMD');

  it('keeps the chat’s forge.json settings', () => {
    expect(settings.env).toEqual({ A: '1' });
    expect(settings.model).toBe('x');
  });

  it('adds only keys the CLI documents', () => {
    const added = Object.keys(settings).filter((k) => !['env', 'model'].includes(k)).sort();
    expect(added).toEqual(['companyAnnouncements', 'spinnerTipsOverride', 'spinnerVerbs', 'statusLine', 'tui']);
  });

  it('uses the inline renderer, so the banner stays above the session', () => {
    expect(settings.tui).toBe('default');
  });

  it('leaves a renderer the user chose alone', () => {
    expect(terminalSettings({ tui: 'fullscreen' }, info, 'CMD').tui).toBe('fullscreen');
    expect(terminalSettings({}, info, 'CMD', 'fullscreen')).not.toHaveProperty('tui');
  });

  it('replaces the spinner verbs and tips with Forge’s', () => {
    expect(settings.spinnerVerbs).toEqual({ mode: 'replace', verbs: SPINNER_VERBS });
    expect(settings.spinnerTipsOverride).toMatchObject({ excludeDefault: true, tips: FORGE_TIPS });
    // The CLI drops tips with double quotes, angle brackets or newlines.
    for (const tip of FORGE_TIPS) expect(tip).not.toMatch(/["<>\n\r]/);
  });

  it('welcomes, without repeating what the banner and the status line show', () => {
    const [line] = settings.companyAnnouncements as string[];
    expect(line).toBe(announcement(info));
    for (const s of ['company-llama', 'qwen3-coder', 'release']) expect(line).not.toContain(s);
  });

  it('points the status line at the command', () => {
    expect(settings.statusLine).toEqual({ type: 'command', command: 'CMD', padding: 0 });
  });
});

describe('the status line', () => {
  it('runs the script on VS Code’s runtime, quoted for bash', () => {
    expect(statusLineCommand('/usr/share/code/code', '/ext/resources/terminal/statusline.js')).toBe(
      'ELECTRON_RUN_AS_NODE=1 /usr/share/code/code /ext/resources/terminal/statusline.js',
    );
    expect(statusLineCommand("C:\\Program Files\\Microsoft VS Code\\Code.exe", "C:\\O'Brien\\statusline.js")).toBe(
      `ELECTRON_RUN_AS_NODE=1 'C:\\Program Files\\Microsoft VS Code\\Code.exe' 'C:\\O'"'"'Brien\\statusline.js'`,
    );
  });

  const status = (used?: number) => ({
    model: { id: 'qwen3-coder', display_name: 'Qwen3 Coder' },
    ...(used !== undefined && { context_window: { used_percentage: used, context_window_size: 131072 } }),
  });
  const env = { FORGE_ENDPOINT: 'company-llama', FORGE_AGENT: 'release' };

  it('prints the mark, the model on its endpoint, the agent, the context meter and the branch', () => {
    expect(strip(statusLine(status(34), env, { branch: 'main' }))).toBe(
      '▛◆ Forge │ Qwen3 Coder @ company-llama │ agent release │ ▰▰▰▱▱▱▱▱ 34% of 131k │ ⎇ main',
    );
  });

  it('fills the meter in the brand colour, warning from 70%, danger from 90%', () => {
    const tone = (used: number) => /\x1b\[38;2;([0-9;]+)m▰/.exec(statusLine(status(used), env, { branch: undefined, color: true }))?.[1];
    expect(tone(34)).toBe('119;89;194');
    expect(tone(75)).toBe('193;125;16');
    expect(tone(95)).toBe('221;43;14');
    expect(strip(statusLine(status(0), env, { branch: undefined }))).toContain('▱▱▱▱▱▱▱▱ 0% of 131k');
    expect(strip(statusLine(status(100), env, { branch: undefined }))).toContain('▰▰▰▰▰▰▰▰ 100%');
  });

  it('never fails on missing input, and leaves out what it does not know', () => {
    expect(strip(statusLine(null, {}, { branch: undefined }))).toBe('▛◆ Forge │ Anthropic API');
    expect(strip(statusLine({ context_window: { used_percentage: 'x' } }, {}, { branch: undefined }))).toBe('▛◆ Forge │ Anthropic API');
  });

  it('is plain text under NO_COLOR', () => {
    expect(statusLine(status(34), { ...env, NO_COLOR: '1' }, { branch: 'main' })).not.toMatch(/\x1b\[/);
  });

  it('drops the branch, then the agent, then the meter when the terminal is narrow', () => {
    const at = (columns: number) => strip(statusLine(status(34), env, { branch: 'main', columns }));
    expect(at(200)).toContain('⎇ main');
    expect(at(80)).not.toContain('⎇');
    expect(at(80)).toContain('agent release');
    expect(at(65)).not.toContain('agent');
    expect(at(65)).toContain('34%');
    expect(at(40)).toBe('▛◆ Forge │ Qwen3 Coder @ company-llama');
  });

  it('reads the branch from .git/HEAD, a worktree pointer, or a detached commit', () => {
    const root = mkdtempSync(join(tmpdir(), 'forge-status-'));
    try {
      mkdirSync(join(root, 'repo', '.git'), { recursive: true });
      mkdirSync(join(root, 'repo', 'src', 'deep'), { recursive: true });
      writeFileSync(join(root, 'repo', '.git', 'HEAD'), 'ref: refs/heads/feature/x\n');
      expect(branchOf(join(root, 'repo', 'src', 'deep'))).toBe('feature/x');

      mkdirSync(join(root, 'wt'));
      mkdirSync(join(root, 'gitdirs', 'wt'), { recursive: true });
      writeFileSync(join(root, 'wt', '.git'), `gitdir: ${join(root, 'gitdirs', 'wt')}\n`);
      writeFileSync(join(root, 'gitdirs', 'wt', 'HEAD'), '0123456789abcdef0123456789abcdef01234567\n');
      expect(branchOf(join(root, 'wt'))).toBe('0123456');

      mkdirSync(join(root, 'none'));
      expect(branchOf(join(root, 'none', 'missing'))).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('gets its endpoint and agent from the terminal environment', () => {
    expect(brandEnvironment({ endpoint: 'e', agent: 'a' })).toEqual({ FORGE_ENDPOINT: 'e', FORGE_AGENT: 'a' });
    expect(brandEnvironment({})).toEqual({ FORGE_ENDPOINT: '', FORGE_AGENT: '' });
  });
});

describe('withHooks: one --settings file for forge.json, the guards and the branding', () => {
  it('appends the layer\'s hooks event by event, keeping existing ones', () => {
    const mine = { hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'lint' }] }] }, spinnerVerbs: 1 };
    const guards = { hooks: { PostToolUse: [{ hooks: [{ type: 'http', url: 'u' }] }], Stop: [{ hooks: [] }] } };
    const out = withHooks(mine, guards) as any;
    expect(out.hooks.PostToolUse).toHaveLength(2);
    expect(out.hooks.PostToolUse[0].hooks[0].command).toBe('lint');
    expect(out.hooks.PostToolUse[1].hooks[0].type).toBe('http');
    expect(out.hooks.Stop).toHaveLength(1);
    expect(out.spinnerVerbs).toBe(1);
  });

  it('takes nothing but hooks from the layer, and leaves settings alone without any', () => {
    const settings = { a: 1 };
    expect(withHooks(settings, {})).toBe(settings);
    expect(withHooks(settings, { hooks: { Stop: [] }, model: 'evil' } as any)).not.toHaveProperty('model');
  });
});
