/**
 * ESLint is a gate (production audit, 2026-09-24): it was not run by any
 * script, and it failed with 1672 problems, 159 of them `.vue` files parsed
 * as plain TypeScript.
 *
 * Now `.vue` goes through vue-eslint-parser, `curly` is the codebase's own
 * `multi-line` style, and `lint` runs in `build` and in `verify` (so in
 * `package`). The `no-explicit-any` warnings are capped at today's count, so
 * the number can only go down.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const config = readFileSync(join(ROOT, 'eslint.config.js'), 'utf8');

describe('the lint gate', () => {
  it('runs in build and in verify', () => {
    expect(manifest.scripts.build.startsWith('pnpm run lint && ')).toBe(true);
    expect(manifest.scripts.verify.startsWith('pnpm run lint && ')).toBe(true);
  });

  it('caps the warnings, so new ones fail', () => {
    expect(manifest.scripts.lint).toMatch(/^eslint src --max-warnings \d+$/);
  });

  it('parses .vue with vue-eslint-parser and TypeScript inside', () => {
    expect(config).toMatch(/import vueParser from 'vue-eslint-parser';/);
    expect(config).toMatch(/files: \['\*\*\/\*\.vue'\],\s*languageOptions: \{\s*parser: vueParser,\s*parserOptions: \{\s*parser: typescriptParser,/);
    expect(manifest.devDependencies['vue-eslint-parser']).toBeDefined();
  });

  it("uses the codebase's multi-line curly style, and no-control-regex", () => {
    expect(config).toContain("curly: ['error', 'multi-line'],");
    expect(config).toContain("'no-control-regex': 'error',");
  });
});
