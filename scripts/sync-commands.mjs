#!/usr/bin/env node
/**
 * Sync package.json's `contributes.commands` from the command registry.
 *
 * `scripts/check-commands.mjs` reports drift; this fixes it. The registry in
 * src/commands/forgeCommands.ts is the source of truth, so adding a command there
 * and running this is the whole workflow.
 *
 * Usage: node scripts/sync-commands.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = join(ROOT, 'package.json');

const source = readFileSync(join(ROOT, 'src', 'commands', 'forgeCommands.ts'), 'utf8');
const block = source.match(/export const FORGE_COMMANDS = \[([\s\S]*?)\] as const;/)?.[1];
if (!block) {
  console.error('sync-commands: could not find FORGE_COMMANDS');
  process.exit(1);
}

const commands = [...block.matchAll(
  /\{\s*command:\s*'([^']+)',\s*title:\s*'([^']+)'(?:,\s*icon:\s*'([^']+)')?\s*\}/g,
)].map(([, command, title, icon]) => (icon ? { command, title, icon } : { command, title }));

const manifest = JSON.parse(readFileSync(PKG, 'utf8'));
const before = JSON.stringify(manifest.contributes.commands);
manifest.contributes.commands = commands;

if (before === JSON.stringify(commands)) {
  console.log(`sync-commands: already in sync (${commands.length} commands)`);
  process.exit(0);
}

writeFileSync(PKG, JSON.stringify(manifest, null, 2) + '\n');
console.log(`sync-commands: wrote ${commands.length} commands to package.json`);
