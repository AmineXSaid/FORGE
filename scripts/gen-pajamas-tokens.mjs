#!/usr/bin/env node
/**
 * Regenerates src/webview/src/styles/forge-pajamas.css from the upstream
 * Pajamas design tokens shipped in @gitlab/ui.
 *
 * We vendor the *primitive* palette only (the raw colour scales). Primitives are
 * theme-independent upstream -- tokens.css and tokens.dark.css carry byte-identical
 * scales, and only the semantic layer above them flips per scope. Forge builds its
 * own semantic layer on top (forge-tokens.css) because our light/dark adaptivity
 * comes from VS Code, not from Pajamas' scopes.
 *
 * Usage: node scripts/gen-pajamas-tokens.mjs [version]
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = process.argv[2] ?? '137.2.2';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'webview', 'src', 'styles', 'forge-pajamas.css');

/** Hue scales to vendor, in emission order. `brand` is the GitLab brand ramp. */
const GROUPS = ['neutral', 'blue', 'purple', 'green', 'orange', 'red', 'alpha', 'brand'];

const work = mkdtempSync(join(tmpdir(), 'forge-pajamas-'));
try {
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', `@gitlab/ui@${VERSION}`, '--silent'], { cwd: work, stdio: ['ignore', 'pipe', 'inherit']  });
  execFileSync('tar', ['xzf', `gitlab-ui-${VERSION}.tgz`], { cwd: work, stdio: 'inherit' });

  const src = readFileSync(join(work, 'package', 'src', 'tokens', 'build', 'css', 'tokens.css'), 'utf8');

  // Collect `--gl-color-<group>-<step>: <value>;` declarations, preserving upstream order.
  const decls = [...src.matchAll(/--gl-color-([a-z]+)-([a-z0-9-]+):\s*([^;]+);/g)];
  const byGroup = new Map(GROUPS.map((g) => [g, []]));
  for (const [, group, step, value] of decls) {
    if (!byGroup.has(group)) continue;
    const bucket = byGroup.get(group);
    const name = `--pajamas-${group}-${step}`;
    if (bucket.some((d) => d.name === name)) continue; // first definition wins (light scope)
    bucket.push({ name, value: value.trim() });
  }

  const total = [...byGroup.values()].reduce((n, b) => n + b.length, 0);
  if (total < 60) throw new Error(`Only extracted ${total} primitives -- upstream layout probably changed.`);

  const body = GROUPS.map((g) => {
    const bucket = byGroup.get(g);
    if (!bucket.length) return '';
    const pad = Math.max(...bucket.map((d) => d.name.length));
    const lines = bucket.map((d) => `  ${d.name}:${' '.repeat(pad - d.name.length)} ${d.value};`).join('\n');
    return `  /* ---- ${g} ---- */\n${lines}`;
  }).filter(Boolean).join('\n\n');

  writeFileSync(OUT, `/*!
 * forge-pajamas.css -- Pajamas primitive palette (LAYER 1 of 3)
 *
 * GENERATED FILE -- DO NOT EDIT BY HAND.
 * Source:     @gitlab/ui@${VERSION} -> src/tokens/build/css/tokens.css
 * Regenerate: npm run tokens:pajamas
 *
 * These are raw palette primitives and nothing else. They are theme-independent
 * (upstream ships identical scales in the light and dark scopes), and they carry
 * no meaning on their own.
 *
 * Components MUST NOT reference --pajamas-* directly. The only legal consumer is
 * forge-tokens.css, which maps primitives onto semantic --forge-* tokens. This is
 * enforced by stylelint (see .stylelintrc.json).
 */
:root {
${body}
}
`);
  console.log(`forge-pajamas.css: wrote ${total} primitives from @gitlab/ui@${VERSION}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
