#!/usr/bin/env node
/**
 * Forge's status line for "Open Forge in Terminal".
 *
 * Claude Code runs this after each turn with its status as JSON on stdin
 * (model, workspace, ...) and shows the first line printed. The endpoint and
 * agent come from FORGE_ENDPOINT / FORGE_AGENT, which Forge puts in the
 * terminal's environment. Runs on VS Code's own runtime (ELECTRON_RUN_AS_NODE),
 * so it may use nothing but Node built-ins.
 *
 * Colours are the Forge mark's: the F in brand purple, the cube's top face.
 */
'use strict';

const F = '\x1b[38;2;119;89;194m';
const CUBE = '\x1b[38;2;203;187;242m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function line(status, env) {
  const model = status && status.model && (status.model.display_name || status.model.id);
  const parts = [
    `${F}${BOLD}▛${RESET}${CUBE}◆${RESET} ${F}${BOLD}Forge${RESET}`,
    model,
    env.FORGE_ENDPOINT || 'Anthropic API',
    env.FORGE_AGENT ? `agent ${env.FORGE_AGENT}` : '',
  ].filter(Boolean);
  return parts.join(`${DIM} · ${RESET}`);
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
    process.stdout.write(line(status, process.env) + '\n');
  });
}

module.exports = { line };
