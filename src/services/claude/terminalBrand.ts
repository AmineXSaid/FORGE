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
  /** False writes plain text, for NO_COLOR. */
  color?: boolean;
}

/**
 * The banner VS Code writes into the terminal before the CLI starts: the mark,
 * then who is running and on what. Lines end in CRLF, as a terminal expects of
 * text written to it directly.
 */
export function forgeBanner(info: BannerInfo): string {
  const color = info.color !== false;
  const paint = (s: string, style: string) => (color ? `${style}${s}${RESET}` : s);
  const row = (label: string, value: string | undefined) =>
    value ? `${paint(label.padEnd(10), DIM)}${value}` : '';

  const text = [
    '',
    `${paint('Forge', BOLD + fg('f'))}${info.version ? `  ${paint(`v${info.version}`, DIM)}` : ''}`,
    paint('Claude Code, reforged.', DIM),
    '',
    row('endpoint', info.endpoint ?? 'Anthropic API'),
    row('model', info.model),
    row('agent', info.agent),
    '',
    paint('/help for commands · Esc to interrupt · Ctrl+C twice to quit', DIM),
  ];

  const lines: string[] = [];
  if (color) {
    const mark = markLines();
    const height = Math.max(mark.length, text.length);
    for (let i = 0; i < height; i++) lines.push(`  ${mark[i] ?? ' '.repeat(F_MODULES * SCALE)}   ${text[i] ?? ''}`);
  } else {
    lines.push(...text.filter((l, i) => l || i > 0).map((l) => `  ${l}`));
  }
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
  'Forge: Create Skill, Subagent or Slash Command from the Command Palette.',
  'Destructive commands always ask first in Forge, even in Edit automatically.',
];

/** The startup announcement: where this terminal is running. */
export function announcement(info: Pick<BannerInfo, 'endpoint' | 'model' | 'agent'>): string {
  return ['Forge', info.endpoint ?? 'Anthropic API', info.model, info.agent && `agent ${info.agent}`]
    .filter(Boolean)
    .join(' · ');
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
