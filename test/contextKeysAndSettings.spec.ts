/**
 * Keybindings that can fire, and settings that exist.
 *
 * Production audit (2026-09-24):
 * - `forge.sideBarActive` was read by two keybindings (Ctrl+Esc blur, Ctrl+N
 *   new conversation) and set by nothing, so neither could ever fire.
 * - `forge.activeAgent`, `forge.agentsDir` and `forge.agentEndpoints` were read
 *   and written but not declared, so "Forge: Select Agent" failed its write
 *   ("not a registered configuration").
 *
 * The drift guards below fail when a `when` clause reads a Forge context key
 * nothing sets, or when the code reads or writes a `forge.*` setting that
 * package.json does not declare.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CTX_SIDE_BAR_ACTIVE, SideBarActiveTracker } from '../src/services/webViewService';

const ROOT = join(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const declared = manifest.contributes.configuration.properties as Record<string, { scope?: string; type?: string }>;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'webview' ? [] : sources(full);
    return name.endsWith('.ts') ? [full] : [];
  });
}
const hostFiles = sources(join(ROOT, 'src')).map((file) => ({ file, text: readFileSync(file, 'utf8') }));

describe('forge.sideBarActive', () => {
  it('is true while either side-bar chat shows, and false when both are hidden', () => {
    const setContext = vi.fn();
    const tracker = new SideBarActiveTracker(setContext);

    tracker.update('forge.chatView', true);
    tracker.update('forge.chatViewSecondary', true);
    tracker.update('forge.chatView', false);
    expect(setContext.mock.calls).toEqual([[CTX_SIDE_BAR_ACTIVE, true]]);

    tracker.update('forge.chatViewSecondary', false);
    expect(setContext.mock.calls).toEqual([[CTX_SIDE_BAR_ACTIVE, true], [CTX_SIDE_BAR_ACTIVE, false]]);
  });

  it('does not repeat a value it already set', () => {
    const setContext = vi.fn();
    const tracker = new SideBarActiveTracker(setContext);
    tracker.update('forge.chatView', false);
    tracker.update('forge.chatView', false);
    expect(setContext).toHaveBeenCalledTimes(1);
  });

  it('survives a setContext that rejects', async () => {
    const tracker = new SideBarActiveTracker(() => Promise.reject(new Error('gone')));
    expect(() => tracker.update('forge.chatView', true)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('is the key the side-bar keybinding reads', () => {
    const bindings = (manifest.contributes.keybindings as Array<{ command: string; when?: string }>)
      .filter((b) => b.when?.includes(CTX_SIDE_BAR_ACTIVE))
      .map((b) => b.command)
      .sort();
    expect(bindings).toEqual(['forge.newConversation']);
  });

  // The official `claude-vscode.blur`: `when: !editorTextFocus`, and it runs
  // `workbench.action.focusFirstEditorGroup`. Found by the end-to-end run
  // (2026-09-24): Forge's blur only blurred the input, so Ctrl+Esc in the chat
  // left focus in the webview.
  it('Ctrl+Esc outside the editor returns to the editor, as the official', () => {
    const blur = (manifest.contributes.keybindings as Array<{ command: string; key: string; when?: string }>).find((b) => b.command === 'forge.blur');
    expect(blur).toMatchObject({ key: 'ctrl+escape', when: '!editorTextFocus' });
    const source = readFileSync(join(__dirname, '..', 'src/commands/forgeCommands.ts'), 'utf8');
    expect(source).toMatch(/'forge\.blur': \(\) => vscode\.commands\.executeCommand\('workbench\.action\.focusFirstEditorGroup'\)/);
  });
});

describe('every Forge context key a when clause reads is set somewhere', () => {
  const whens = new Set<string>();
  JSON.stringify(manifest.contributes, (key, value) => {
    if ((key === 'when' || key === 'enablement') && typeof value === 'string') whens.add(value);
    return value;
  });
  const viewIds = new Set(
    Object.values(manifest.contributes.views as Record<string, Array<{ id: string }>>).flat().map((v) => v.id),
  );
  const keys = new Set<string>();
  for (const when of whens) {
    for (const match of when.matchAll(/(?<![.\w])(forge[\w.:-]*)/g)) {
      if (!viewIds.has(match[1])) keys.add(match[1]);
    }
  }

  it.each([...keys])('%s', (key) => {
    const setters = hostFiles.filter(({ text }) => {
      if (!text.includes('setContext')) return false;
      if (text.includes(`'${key}'`)) return true;
      // Set through a named constant: `const CTX_X = '<key>'`.
      const constant = text.match(new RegExp(`const (CTX_\\w+) = '${key.replace(/[.:]/g, '\\$&')}'`));
      return !!constant && text.includes(constant[1]);
    });
    expect(setters.map((s) => s.file), `${key} is read by a when clause but never set`).not.toEqual([]);
  });
});

describe('every forge.* setting the host reads or writes is declared', () => {
  const used = new Map<string, string>();
  for (const { file, text } of hostFiles) {
    const record = (key: string) => { if (!used.has(key)) used.set(key, file); };
    // getConfiguration('forge').get('x') / .update('x') / .inspect('x'), across lines.
    for (const m of text.matchAll(/getConfiguration\(\s*'forge'\s*\)\s*\.(?:get|update|inspect)(?:<[^(]*>)?\(\s*'([\w.]+)'/g)) {
      record(`forge.${m[1]}`);
    }
    // const config = ...getConfiguration('forge'); config.get('x')
    for (const v of text.matchAll(/const (\w+) = vscode\.workspace\.getConfiguration\(\s*'forge'\s*\)/g)) {
      for (const m of text.matchAll(new RegExp(`\\b${v[1]}\\.(?:get|update|inspect)(?:<[^(]*>)?\\(\\s*'([\\w.]+)'`, 'g'))) {
        record(`forge.${m[1]}`);
      }
    }
    // getConfiguration().get('forge.x') and affectsConfiguration('forge.x')
    for (const m of text.matchAll(/(?:affectsConfiguration|\.get(?:<[^(]*>)?|\.update|\.inspect(?:<[^(]*>)?)\(\s*'(forge\.[\w.]+)'/g)) {
      record(m[1]);
    }
  }

  it('finds the settings the audit named', () => {
    expect([...used.keys()]).toEqual(expect.arrayContaining(['forge.activeAgent', 'forge.agentsDir', 'forge.agentEndpoints', 'forge.cliArgs']));
  });

  it.each([...used.entries()])('%s (used in %s)', (key) => {
    expect(declared, `${key} is used but not declared in package.json`).toHaveProperty([key]);
  });
});

describe('the agent settings', () => {
  it('are declared with their types', () => {
    expect(declared['forge.activeAgent']?.type).toBe('string');
    expect(declared['forge.agentsDir']?.type).toBe('string');
    expect(declared['forge.agentEndpoints']?.type).toBe('object');
  });

  it('"Select Agent" writes user settings when no folder is open', () => {
    const src = readFileSync(join(ROOT, 'src/commands/forgeCommands.ts'), 'utf8');
    const start = src.indexOf("'forge.selectAgent': async");
    const block = src.slice(start, start + 4000);
    expect(block).toMatch(/hasFolder \? vscode\.ConfigurationTarget\.Workspace : vscode\.ConfigurationTarget\.Global/);
  });
});
