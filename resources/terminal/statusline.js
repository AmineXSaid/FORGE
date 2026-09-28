#!/usr/bin/env node
/**
 * Forge's status line for "Open Forge in Terminal".
 *
 * Claude Code runs this after each turn with its status as JSON on stdin and
 * shows the first line printed:
 *
 *   ▛◆ Forge │ qwen3-coder @ company-llama │ agent release │ ▰▰▰▱▱▱▱▱ 34% of 128k │ ⎇ main
 *
 * The model and the context window (`context_window.used_percentage`,
 * `context_window_size`) come from the CLI's status; the endpoint and agent
 * from FORGE_ENDPOINT / FORGE_AGENT, which Forge puts in the terminal's
 * environment; the branch from the workspace's `.git/HEAD`. Every part is
 * optional, and a status line must never fail the prompt, so nothing here
 * throws. Runs on VS Code's own runtime (ELECTRON_RUN_AS_NODE), so it may use
 * nothing but Node built-ins.
 *
 * Colours are the Forge mark's (the F, the cube's top face) and the Pajamas
 * warning and danger stops for a filling context window. NO_COLOR is plain.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RGB = {
  f: '119;89;194', // the F (MARK_COLOURS.f in terminalBrand.ts)
  cube: '203;187;242', // the cube's top face
  warn: '193;125;16', // --pajamas-orange-400
  danger: '221;43;14', // --pajamas-red-500
};
const METER_CELLS = 8;

function painter(color) {
  const style = (codes) => (s) => (color ? `\x1b[${codes}m${s}\x1b[0m` : s);
  return {
    f: style(`1;38;2;${RGB.f}`),
    purple: style(`38;2;${RGB.f}`),
    cube: style(`38;2;${RGB.cube}`),
    tone: (tone) => style(`38;2;${RGB[tone]}`),
    bold: style('1'),
    dim: style('2'),
  };
}

/** 131072 -> "131k", 1000000 -> "1M". */
function tokens(n) {
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  return `${Math.round(n / 1000)}k`;
}

/** The branch checked out under `dir`, or the short commit when detached. */
function branchOf(dir) {
  try {
    for (let at = path.resolve(dir); ; at = path.dirname(at)) {
      const dotGit = path.join(at, '.git');
      if (fs.existsSync(dotGit)) {
        let gitDir = dotGit;
        if (fs.statSync(dotGit).isFile()) {
          // A worktree or submodule: ".git" names the real git dir.
          const pointer = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'));
          if (!pointer) return undefined;
          gitDir = path.resolve(at, pointer[1].trim());
        }
        const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
        const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
        return ref ? ref[1] : /^[0-9a-f]{7,}$/.test(head) ? head.slice(0, 7) : undefined;
      }
      if (path.dirname(at) === at) return undefined;
    }
  } catch {
    return undefined;
  }
}

/** The context meter: "▰▰▰▱▱▱▱▱ 34% of 128k", toned as the window fills. */
function meter(window, paint) {
  const used = Number(window && window.used_percentage);
  if (!Number.isFinite(used)) return undefined;
  const pct = Math.max(0, Math.min(100, Math.round(used)));
  const filled = Math.min(METER_CELLS, Math.round((pct / 100) * METER_CELLS));
  const tone = pct >= 90 ? paint.tone('danger') : pct >= 70 ? paint.tone('warn') : paint.purple;
  const size = Number(window.context_window_size);
  return `${tone('▰'.repeat(filled))}${paint.dim('▱'.repeat(METER_CELLS - filled))} ${pct}%${
    Number.isFinite(size) && size > 0 ? paint.dim(` of ${tokens(size)}`) : ''
  }`;
}

const visible = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').length;

/**
 * The line. `options.color` (default: unless NO_COLOR), `options.columns`
 * (default: COLUMNS) and `options.branch` (default: read from the workspace)
 * are there for the specs.
 */
function line(status, env, options = {}) {
  const color = options.color ?? !(env && env.NO_COLOR);
  const paint = painter(color);
  const e = env || {};
  const s = status || {};
  const model = s.model && (s.model.display_name || s.model.id);
  const endpoint = e.FORGE_ENDPOINT || 'Anthropic API';
  const dir = (s.workspace && s.workspace.current_dir) || s.cwd;
  const branch = 'branch' in options ? options.branch : dir ? branchOf(dir) : undefined;

  const parts = [
    { keep: 0, text: `${paint.f('▛')}${paint.cube('◆')} ${paint.f('Forge')}` },
    { keep: 0, text: model ? `${paint.bold(model)}${paint.dim(' @ ')}${endpoint}` : endpoint },
    e.FORGE_AGENT && { keep: 2, text: `${paint.dim('agent ')}${e.FORGE_AGENT}` },
    { keep: 1, text: meter(s.context_window, paint) },
    branch && { keep: 3, text: `${paint.dim('⎇')} ${branch}` },
  ].filter((p) => p && p.text);

  const sep = paint.dim(' │ ');
  const join = (ps) => ps.map((p) => p.text).join(sep);
  const columns = Number(options.columns ?? e.COLUMNS);
  let shown = parts;
  // Too wide: the branch goes first, then the agent, then the meter.
  for (const drop of [3, 2, 1]) {
    if (!(columns > 0) || visible(join(shown)) <= columns) break;
    shown = shown.filter((p) => p.keep !== drop);
  }
  return join(shown);
}

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (input += chunk));
  process.stdin.on('end', () => {
    let status = null;
    try {
      status = JSON.parse(input);
    } catch {
      // A status line must never fail the prompt; print what is known.
    }
    let out = '';
    try {
      out = line(status, process.env);
    } catch {
      out = 'Forge';
    }
    process.stdout.write(out + '\n');
  });
}

module.exports = { line, branchOf };
