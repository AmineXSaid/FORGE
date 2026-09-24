/**
 * Bypass permissions in Pajamas deep red (production audit, Phase 6, item 1).
 *
 * The official tints bypass and its `auto` mode with the error foreground.
 * Forge gives bypass its own role: `--forge-bypass` (red-700) for the glyph
 * and the focus ring, `--forge-bypass-strong` (red-800) for the filled send
 * button, in forge-design.css (loaded after the ported official rules, same
 * selectors). The ported files are untouched, so `auto` keeps the official
 * colour.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const design = read('src/webview/src/styles/forge-design.css');

describe('bypass in deep red', () => {
  it('the tokens are Pajamas red-700 and red-800', () => {
    const tokens = read('src/webview/src/styles/forge-tokens.css');
    expect(tokens).toMatch(/--forge-bypass:\s*var\(--pajamas-red-700\);/);
    expect(tokens).toMatch(/--forge-bypass-strong:\s*var\(--pajamas-red-800\);/);
  });

  it('forge-design.css re-points the three official bypass selectors', () => {
    expect(design).toMatch(/\.fg-footer__sendButton\[data-permission-mode=bypassPermissions\] \{\n  background-color: var\(--forge-bypass-strong\);/);
    expect(design).toMatch(/\.fg-spinner__container\[data-permission-mode=bypassPermissions\] \.fg-spinner__icon \{\n  color: var\(--forge-bypass\);/);
    expect(design).toMatch(/\.fg-composer__inputContainer\[data-permission-mode=bypassPermissions\]:focus-within \{\n  --focus-ring-color: var\(--forge-bypass\);/);
  });

  it('those are exactly the selectors the official tints with the error colour', () => {
    const official = ['footer', 'spinner', 'composer'].map((m) => read(`src/webview/src/styles/official/${m}.css`)).join('\n');
    const tinted = [...official.matchAll(/([^{}]+)\{[^}]*var\(--app-error-foreground\)[^}]*\}/g)]
      .flatMap((m) => m[1].split(',').map((s) => s.trim()))
      .filter((s) => s.includes('bypassPermissions'));
    expect(tinted.sort()).toEqual([
      '.fg-composer__inputContainer[data-permission-mode=bypassPermissions]:focus-within',
      '.fg-footer__sendButton[data-permission-mode=bypassPermissions]',
      '.fg-spinner__container[data-permission-mode=bypassPermissions] .fg-spinner__icon',
    ]);
    for (const selector of tinted) expect(design).toContain(`${selector} {`);
  });

  it('auto keeps the official colour: no auto rule in forge-design.css', () => {
    expect(design).not.toMatch(/data-permission-mode=auto/);
  });

  it('forge-design.css loads after the ported official rules', () => {
    const theme = read('src/webview/src/styles/forge-theme.css');
    expect(theme.indexOf('@import "./official/index.css"')).toBeLessThan(theme.indexOf('@import "./forge-design.css"'));
  });

  it('the mode menu tints the bypass row the same red', () => {
    expect(read('src/webview/src/components/ModeSelect.vue')).toMatch(/\.fg-modeTint\[data-mode='bypassPermissions'\] \{\n  color: var\(--forge-bypass\);/);
  });
});
