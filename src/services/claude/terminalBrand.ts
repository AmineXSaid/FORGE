/**
 * Forge's branding for "Open Forge in Terminal".
 *
 * The terminal runs Anthropic's Claude Code CLI unmodified. Its welcome box is
 * hard-coded in the CLI (no setting or variable turns it off), and the binary
 * is Anthropic's, so Forge neither patches it nor rewrites its output. What
 * Forge brands is everything it owns or the CLI documents as customisable:
 *
 *   - a banner VS Code writes into the terminal before the shell starts
 *     (`TerminalOptions.message`), drawing the Forge mark from marks.ts;
 *   - a `--settings` file (the CLI's flag-settings layer) with Forge's spinner
 *     verbs, spinner tips, startup announcement and status line.
 *
 * Kept free of `vscode` so the specs can import it.
 */
import { F_CUBE, F_MODULES, F_SOLID, type CubeFace } from '../../webview/src/components/forge/marks';
import { shellQuote } from './terminalLaunch';

/**
 * The mark's colours: the Pajamas stops the webview's --forge-mark-* tokens
 * name. test/terminalBrand.spec.ts checks them against the palette, so a
 * recolour cannot leave the terminal behind.
 */
export const MARK_COLOURS = {
  f: '#7759c2',
  top: '#cbbbf2',
  lit: '#9475db',
  shade: '#5c47a6',
} as const;

type Ink = keyof typeof MARK_COLOURS;

/** Pixels per module in the terminal drawing: 18x18 pixels, 18 columns x 9 rows. */
const SCALE = 3;

const inside = (poly: CubeFace, x: number, y: number) => {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cross !== 0) {
      if (sign === 0) sign = Math.sign(cross);
      else if (Math.sign(cross) !== sign) return false;
    }
  }
  return true;
};

/** The ink at a point of the mark, in modules; null where it is empty. */
export function inkAt(x: number, y: number): Ink | null {
  for (const ink of ['shade', 'lit', 'top'] as const) if (inside(F_CUBE[ink], x, y)) return ink;
  for (const [rx, ry, w, h] of F_SOLID) if (x >= rx && x < rx + w && y >= ry && y < ry + h) return 'f';
  return null;
}

/** The mark as a grid of inks, sampled at each pixel's centre. */
export function markPixels(scale = SCALE): (Ink | null)[][] {
  const size = F_MODULES * scale;
  return Array.from({ length: size }, (_, py) =>
    Array.from({ length: size }, (_, px) => inkAt((px + 0.5) / scale, (py + 0.5) / scale)),
  );
}

const ansiTriplet = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(';');
const fg = (ink: Ink) => `\x1b[38;2;${ansiTriplet(MARK_COLOURS[ink])}m`;
const bg = (ink: Ink) => `\x1b[48;2;${ansiTriplet(MARK_COLOURS[ink])}m`;
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

/**
 * The mark as a crafted pixel sprite, drawn the way the chat's war hammer is
 * (`ForgeHammer.vue`): a dark outline, light from the top left, several tones
 * per surface. One character per pixel, `.` empty:
 *
 *   O  outline                purple-950
 *   H  the F, lit edge        purple-300
 *   F  the F                  purple-500
 *   D  the F, shaded edge     purple-700
 *   T  cube top               purple-100
 *   G  cube top, glint        purple-50
 *   L  cube, lit face         purple-400
 *   S  cube, shaded face      purple-800
 *   E  cube, edge between     purple-900
 *
 * MARK_SPRITE is 16 x 16 (16 columns by 8 rows in half blocks, the hammer's
 * size); MARK_SPRITE_SMALL is the 12 x 12 cut for narrow terminals.
 */
export const MARK_INKS: Readonly<Record<string, string>> = {
  O: '#27243e',
  H: '#ac93e6',
  F: '#7b58cf',
  D: '#5c47a6',
  T: '#e1d8f9',
  G: '#f4f0ff',
  L: '#9475db',
  S: '#493c83',
  E: '#342d59',
};

export const MARK_SPRITE: readonly string[] = [
  'OOOOOOOOOOOOOOOO',
  'OHHHHHHHHHHHHHHO',
  'OHFFFFFFFFFFFFDO',
  'OHFFFFFFFFFFFFDO',
  'OHFFFDDDDDDDDDDO',
  'OHFFDOOOOOOOOOOO',
  'OHFFDO....OO....',
  'OHFFDO..OOTTOO..',
  'OHFFDOOOTTGTTTOO',
  'OHFFDOLLTTTTTSSO',
  'OHFFDOLLLLTSSSSO',
  'OHFFDOLLLLESSSSO',
  'OHFFDOLLLLESSSSO',
  'OHFFDOOLLLESSSOO',
  'ODDDDO.OOLESOO..',
  'OOOOOO...OOO....',
];

export const MARK_SPRITE_SMALL: readonly string[] = [
  'OOOOOOOOOOOO',
  'OHHHHHHHHHHO',
  'OHFFFFFFFFDO',
  'OHFFDDDDDDDO',
  'OHFDOOOOOOOO',
  'OHFDO..OO...',
  'OHFDO.OTTO..',
  'OHFDOOTGTTOO',
  'OHFDOLLTTSSO',
  'OHFDOLLLESSO',
  'ODDDOOLLESOO',
  'OOOOO.OOOO..',
];

/** The same sprite with no outline: softer on a dark terminal. */
export const withoutOutline = (sprite: readonly string[]): string[] => sprite.map((row) => row.replace(/O/g, '.'));

const hexFg = (hex: string) => `\x1b[38;2;${ansiTriplet(hex)}m`;
const hexBg = (hex: string) => `\x1b[48;2;${ansiTriplet(hex)}m`;

/** A sprite in half blocks, as `markLines` draws the sampled mark. */
export function spriteLines(sprite: readonly string[]): string[] {
  const ink = (c: string | undefined) => (c ? MARK_INKS[c] : undefined);
  const lines: string[] = [];
  for (let y = 0; y < sprite.length; y += 2) {
    let line = '';
    for (let x = 0; x < sprite[y].length; x++) {
      const upper = ink(sprite[y][x]);
      const lower = ink(sprite[y + 1]?.[x]);
      if (!upper && !lower) line += ' ';
      else if (upper && !lower) line += `${hexFg(upper)}▀${RESET}`;
      else if (!upper && lower) line += `${hexFg(lower)}▄${RESET}`;
      else if (upper === lower) line += `${hexFg(upper!)}█${RESET}`;
      else line += `${hexFg(upper!)}${hexBg(lower!)}▀${RESET}`;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * The mark in half blocks: each cell is two pixels stacked, `▀` painted with
 * the upper pixel as foreground and the lower as background. A terminal cell is
 * about twice as tall as it is wide, so the pixels come out square.
 */
export function markLines(scale = SCALE): string[] {
  const px = markPixels(scale);
  const lines: string[] = [];
  for (let y = 0; y < px.length; y += 2) {
    let line = '';
    for (let x = 0; x < px[y].length; x++) {
      const upper = px[y][x];
      const lower = px[y + 1]?.[x] ?? null;
      if (!upper && !lower) line += ' ';
      else if (upper && !lower) line += `${fg(upper)}▀${RESET}`;
      else if (!upper && lower) line += `${fg(lower)}▄${RESET}`;
      else if (upper === lower) line += `${fg(upper!)}█${RESET}`;
      else line += `${fg(upper!)}${bg(lower!)}▀${RESET}`;
    }
    lines.push(line);
  }
  return lines;
}

export interface BannerInfo {
  version: string;
  endpoint?: string;
  model?: string;
  agent?: string;
  /** The workspace folder, shown shortened in the compact banner. */
  cwd?: string;
  /**
   * `compact` (the default): the mascot-sized mark beside three lines, the way
   * Claude Code's own box is laid out. `full`: the large mark.
   */
  layout?: 'compact' | 'full';
  /** False writes plain text, for NO_COLOR. */
  color?: boolean;
}

/** "/home/ada/work/forge" -> "/…/work/forge"; short paths are left whole. */
export function shortPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return p;
  const sep = p.includes('\\') && !p.includes('/') ? '\\' : '/';
  return `${sep}…${sep}${parts.slice(-2).join(sep)}`;
}

/** Widest a banner line gets, so it fits an 80-column terminal unwrapped. */
export const BANNER_WIDTH = 72;

/** The keys worth knowing on the first screen, key first. */
export const BANNER_KEYS: readonly [string, string][] = [
  ['/', 'commands'],
  ['@', 'files'],
  ['Esc', 'stop'],
  ['Ctrl+C ×2', 'quit'],
];

/**
 * The banner VS Code writes into the terminal before the CLI starts.
 *
 * Compact (the default) is laid out like Claude Code's own box: the crafted
 * mark (MARK_SPRITE, 16 columns by 8 rows) beside Forge and its version, what
 * it runs on, the workspace and the keys to know. Full puts the large sampled
 * mark beside the same facts. Either ends in a rule,
 * so the CLI's box below reads as separate. Every line fits in BANNER_WIDTH
 * columns. Lines end in CRLF, as a terminal expects of text written to it
 * directly.
 */
export function forgeBanner(info: BannerInfo): string {
  const color = info.color !== false;
  const paint = (s: string, style: string) => (color ? `${style}${s}${RESET}` : s);
  const dot = paint(' · ', DIM);

  // "qwen3-coder on company-llama · agent release": the model leads, bold.
  const runsOn = [
    info.model ? `${paint(info.model, BOLD)}${paint(' on ', DIM)}` : '',
    info.endpoint ?? 'Anthropic API',
    info.agent ? `${dot}${paint('agent ', DIM)}${info.agent}` : '',
  ].join('');
  const keys = BANNER_KEYS.map(([key, what]) => `${paint(key, BOLD)} ${paint(what, DIM)}`).join('   ');

  const title = `${paint('Forge', BOLD + fg('f'))}${info.version ? `  ${paint(`v${info.version}`, DIM)}` : ''}`;
  const lines: string[] = [];

  if ((info.layout ?? 'compact') === 'compact') {
    // Claude Code's box, Forge's: the crafted mark (16 columns by 8 rows)
    // beside who, on what, where, and the keys to know.
    const beside = ['', title, runsOn, info.cwd ? paint(shortPath(info.cwd), DIM) : paint('Claude Code, reforged.', DIM), '', keys, '', ''];
    if (color) {
      const mark = spriteLines(MARK_SPRITE);
      for (let i = 0; i < mark.length; i++) lines.push(`  ${mark[i]}   ${beside[i] ?? ''}`);
    } else {
      lines.push(...beside.filter((l, i) => l || (i > 0 && i < 6)).map((l) => `  ${l}`));
    }
    lines.push('');
  } else {
    const text = ['', title, paint('Claude Code, reforged.', DIM), '', runsOn, '', keys, '', ''];
    if (color) {
      const mark = markLines();
      const height = Math.max(mark.length, text.length);
      for (let i = 0; i < height; i++) lines.push(`  ${mark[i] ?? ' '.repeat(F_MODULES * SCALE)}   ${text[i] ?? ''}`);
    } else {
      lines.push(...text.slice(1, -2).map((l) => `  ${l}`));
    }
  }
  lines.push(`  ${paint('─'.repeat(BANNER_WIDTH - 2), DIM)}`);
  return '\r\n' + lines.map((l) => l.trimEnd()).join('\r\n') + '\r\n\r\n';
}

/** Spinner verbs: the CLI's `spinnerVerbs` with `mode: "replace"`. */
export const SPINNER_VERBS = [
  'Forging',
  'Hammering',
  'Tempering',
  'Quenching',
  'Annealing',
  'Smelting',
  'Shaping',
  'Riveting',
  'Stoking the fire',
  'Heating the anvil',
  'Striking',
  'Polishing',
];

/** Forge's tips: the CLI's `spinnerTipsOverride`, replacing Claude Code's. */
export const FORGE_TIPS = [
  'Forge: Select Agent runs a Hermes agent scoped to the tools it needs.',
  'Forge: Select Endpoint Profile switches to your gateway, vLLM or Ollama.',
  'The Forge chat panel shows every edit beside your code as it happens.',
  'Forge: Run Endpoint Diagnostics checks what an endpoint can really do.',
  'Forge: Create Agent makes a Claude Code subagent or a Hermes agent.',
  'Forge: Create Skill or Create Slash Command from the Command Palette.',
  'Destructive commands always ask first in Forge, even in Edit automatically.',
];

/**
 * The startup announcement. Where the terminal runs is already in the banner
 * and, for the whole session, in the status line; a third copy was noise. So
 * this is the one line of welcome, with the two keys that open everything.
 */
export function announcement(_info?: Pick<BannerInfo, 'endpoint' | 'model' | 'agent'>): string {
  return 'Forge is ready · type / for commands, @ to mention a file';
}

/**
 * The status-line command. Claude Code runs it through bash (Git Bash on
 * Windows, which the CLI requires there), so it is POSIX-quoted. It runs the
 * script on VS Code's own runtime: `runtime` is the extension host's
 * `process.execPath`, which acts as Node under ELECTRON_RUN_AS_NODE, so the user
 * needs no Node install.
 */
export function statusLineCommand(runtime: string, script: string): string {
  return `ELECTRON_RUN_AS_NODE=1 ${shellQuote([runtime, script])}`;
}

/**
 * The terminal's `--settings` file: the chat's own flag settings (forge.json),
 * with Forge's branding on top. Only keys the CLI documents.
 */
export function terminalSettings(
  base: Record<string, unknown>,
  info: Pick<BannerInfo, 'endpoint' | 'model' | 'agent'>,
  statusLine: string,
  userTui?: unknown,
): Record<string, unknown> {
  // The CLI's fullscreen renderer draws on the alternate screen, which hides
  // the banner VS Code wrote before it for the whole session. The inline
  // renderer keeps it above the conversation. A renderer the user chose,
  // here or in their own settings, is left alone.
  const tui = base.tui !== undefined || userTui !== undefined ? {} : { tui: 'default' };
  return {
    ...base,
    ...tui,
    spinnerVerbs: { mode: 'replace', verbs: SPINNER_VERBS },
    spinnerTipsOverride: { excludeDefault: true, label: 'Forge tip', tips: FORGE_TIPS },
    companyAnnouncements: [announcement(info)],
    statusLine: { type: 'command', command: statusLine, padding: 0 },
  };
}

/** The environment the status line reads its endpoint and agent from. */
export function brandEnvironment(info: Pick<BannerInfo, 'endpoint' | 'agent'>): Record<string, string> {
  return {
    FORGE_ENDPOINT: info.endpoint ?? '',
    FORGE_AGENT: info.agent ?? '',
  };
}

/**
 * Fold another settings layer's `hooks` into `settings`, event by event, so one
 * `--settings` file can carry forge.json's hooks, Forge's guard hooks and the
 * branding. Nothing else is taken from `layer`.
 */
export function withHooks(settings: Record<string, unknown>, layer: Record<string, unknown>): Record<string, unknown> {
  const extra = layer.hooks as Record<string, unknown[]> | undefined;
  if (!extra || typeof extra !== 'object') return settings;
  const hooks: Record<string, unknown[]> = { ...((settings.hooks as Record<string, unknown[]>) ?? {}) };
  for (const [event, matchers] of Object.entries(extra)) {
    hooks[event] = [...(Array.isArray(hooks[event]) ? hooks[event] : []), ...(Array.isArray(matchers) ? matchers : [])];
  }
  return { ...settings, hooks };
}
