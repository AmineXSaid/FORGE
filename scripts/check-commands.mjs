#!/usr/bin/env node
/**
 * Keeps package.json in step with the command registry.
 *
 * A command declared in the manifest but never registered still appears in the
 * command palette, and then throws "command not found" when someone runs it. The
 * reverse -- registered but undeclared -- is invisible to users. Both are easy to
 * introduce and neither shows up in a type check, so this is a build gate.
 *
 * Also verifies that every command referenced by a keybinding or menu entry, and
 * every `forge.*` setting referenced from a `when` clause, actually exists.
 *
 * Usage: node scripts/check-commands.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const source = readFileSync(join(ROOT, 'src', 'commands', 'forgeCommands.ts'), 'utf8');

const problems = [];

// --- registry (source of truth) -------------------------------------------
const registryBlock = source.match(/export const FORGE_COMMANDS = \[([\s\S]*?)\] as const;/)?.[1];
if (!registryBlock) {
  console.error('check-commands: could not find FORGE_COMMANDS in src/commands/forgeCommands.ts');
  process.exit(1);
}
const registry = new Map(
  [...registryBlock.matchAll(/\{\s*command:\s*'([^']+)',\s*title:\s*'([^']+)'/g)]
    .map((m) => [m[1], m[2]]),
);

// Every registry entry must also have an implementation in the impls map.
// The signature is matched loosely: it went from `() => unknown` to
// `(...args: unknown[]) => unknown` when the registration started forwarding
// arguments, and a check that silently matches nothing reports every command
// as unimplemented, which reads as 25 problems rather than as one stale regex.
const implBlock = source.match(/const impls: Record<ForgeCommandId, \([^)]*\) => unknown> = \{([\s\S]*?)\n    \};/)?.[1] ?? '';
if (!implBlock) {
  problems.push('could not find the impls map in forgeCommands.ts -- has its declaration changed?');
}
const implemented = new Set([...implBlock.matchAll(/'(forge\.[a-zA-Z.]+)':/g)].map((m) => m[1]));

// --- manifest --------------------------------------------------------------
const declared = new Map((manifest.contributes?.commands ?? []).map((c) => [c.command, c.title]));

for (const [id, title] of registry) {
  if (!declared.has(id)) {
    problems.push(`registered but not declared in package.json: ${id}`);
  } else if (declared.get(id) !== title) {
    problems.push(`title mismatch for ${id}\n      registry: ${title}\n      manifest: ${declared.get(id)}`);
  }
  if (!implemented.has(id)) {
    problems.push(`declared in FORGE_COMMANDS but has no entry in the impls map: ${id}`);
  }
}
for (const id of declared.keys()) {
  if (!registry.has(id)) {
    problems.push(`declared in package.json but never registered: ${id}`);
  }
}

// --- cross-references ------------------------------------------------------
const refs = [];
for (const k of manifest.contributes?.keybindings ?? []) refs.push(['keybinding', k.command, k.when]);
for (const [menu, entries] of Object.entries(manifest.contributes?.menus ?? {})) {
  for (const e of entries) refs.push([`menu ${menu}`, e.command, e.when]);
}
for (const [where, command, when] of refs) {
  if (command && !declared.has(command)) {
    problems.push(`${where} refers to an undeclared command: ${command}`);
  }
  // `config.forge.x` in a when-clause only resolves if the setting is contributed.
  for (const m of String(when ?? '').matchAll(/config\.(forge\.[A-Za-z]+)/g)) {
    if (!manifest.contributes?.configuration?.properties?.[m[1]]) {
      problems.push(`${where} when-clause refers to an undeclared setting: ${m[1]}`);
    }
  }
}

// --- walkthrough media -----------------------------------------------------
for (const w of manifest.contributes?.walkthroughs ?? []) {
  for (const step of w.steps ?? []) {
    const md = step.media?.markdown;
    if (!md) continue;
    try {
      readFileSync(join(ROOT, md));
    } catch {
      problems.push(`walkthrough step "${step.id}" points at a missing file: ${md}`);
    }
  }
}

if (problems.length) {
  console.error(`\nForge command check: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nsrc/commands/forgeCommands.ts is the source of truth; package.json mirrors it.\n');
  process.exit(1);
}

console.log(`Forge command check: clean (${registry.size} commands, ${refs.length} references)`);
