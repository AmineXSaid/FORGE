/**
 * Forge's branding for "Open Forge in Terminal" (terminalBrand.ts).
 *
 * The CLI runs unmodified; Forge brands only what it owns (the banner VS Code
 * writes before the shell starts) and what the CLI documents (its --settings
 * keys). These specs pin both: the banner draws the real mark, and the settings
 * file carries only documented keys.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
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
} from '../src/services/claude/terminalBrand';

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { line: statusLine } = require('../resources/terminal/statusline.js');

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

  it('announces where the terminal runs', () => {
    expect(settings.companyAnnouncements).toEqual(['Forge · company-llama · qwen3-coder · agent release']);
    expect(announcement({})).toBe('Forge · Anthropic API');
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

  it('prints the Forge mark, the model, the endpoint and the agent', () => {
    const out = strip(
      statusLine({ model: { id: 'qwen3-coder', display_name: 'Qwen3 Coder' } }, { FORGE_ENDPOINT: 'company-llama', FORGE_AGENT: 'release' }),
    );
    expect(out).toBe('▛◆ Forge · Qwen3 Coder · company-llama · agent release');
  });

  it('never fails on missing input', () => {
    expect(strip(statusLine(null, {}))).toBe('▛◆ Forge · Anthropic API');
  });

  it('gets its endpoint and agent from the terminal environment', () => {
    expect(brandEnvironment({ endpoint: 'e', agent: 'a' })).toEqual({ FORGE_ENDPOINT: 'e', FORGE_AGENT: 'a' });
    expect(brandEnvironment({})).toEqual({ FORGE_ENDPOINT: '', FORGE_AGENT: '' });
  });
});
