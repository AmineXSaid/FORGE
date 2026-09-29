/**
 * "Open Forge in Terminal" is on and reachable (the user's decision,
 * 2026-09-29, undoing the pause of 2026-09-28). Every way in opens the
 * terminal: the "/" menu's "Open Forge in Terminal" and "Toggle fast mode"
 * rows, the welcome page's "Use the terminal", the empty chat's terminal card
 * and its tip. None of them is greyed out or marked "(soon)".
 *
 * The host side (`open_claude_in_terminal`, the official `JI0` validation) is
 * `openClaudeInTerminal.spec.ts`.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

const ENTRY_POINTS = [
  'src/webview/src/components/ButtonArea.vue',
  'src/webview/src/components/forge/CommandMenu.vue',
  'src/webview/src/components/welcome/EndpointWelcome.vue',
  'src/webview/src/components/welcome/TerminalBanner.vue',
  'src/webview/src/components/RandomTip.vue',
  'src/webview/src/pages/ChatPage.vue',
];

describe('the terminal, available', () => {
  it('has no pause switch and no "(soon)" state anywhere', () => {
    expect(existsSync(join(__dirname, '..', 'src/webview/src/components/forge/terminalAvailability.ts'))).toBe(false);
    for (const file of ENTRY_POINTS) {
      const source = read(file);
      expect(source, file).not.toContain('TERMINAL_AVAILABLE');
      expect(source, file).not.toMatch(/\(soon\)|coming soon|\{\{ SOON \}\}|cmd\.soon|--soon/);
    }
  });

  it('offers both "/" rows, and each opens a terminal', () => {
    const area = read('src/webview/src/components/ButtonArea.vue');
    expect(area).toMatch(/\{ id: 'terminal', label: 'Open Forge in Terminal', description: 'Open a new Forge instance in the Terminal', section: 'Customize', trailing: 'terminal' \}/);
    expect(area).toContain('...fastModeRows(props.supportsFastMode),');
    // The official row passes no prompt, no args, the bottom panel.
    expect(area).toContain("case 'terminal': return runHostAction('open Forge in the terminal', () => transport.openClaudeInTerminal(undefined, undefined, 'bottom'))");
    // "Toggle fast mode" is `claude /fast` in a terminal.
    expect(area).toMatch(/case 'fast': return runHostAction\('open Forge in the terminal', \(\) => transport\.openClaudeInTerminal\(FAST_MODE_LAUNCH\.prompt/);
  });

  it('runs every "/" row it is given: the menu disables none', () => {
    const menu = read('src/webview/src/components/forge/CommandMenu.vue');
    expect(menu).toMatch(/function run\(cmd: MenuCommand, viaTab: boolean\): void \{\s*emit\('run', cmd\.id, viaTab\);/);
    // Only the official "No matching commands" placeholder is disabled; no
    // command row carries a disabled binding.
    expect(menu).not.toContain(':aria-disabled');
  });

  it('keeps the welcome page\'s "Use the terminal" enabled, opening the bottom terminal', () => {
    const welcome = read('src/webview/src/components/welcome/EndpointWelcome.vue');
    expect(welcome).toContain('title="Open a terminal running Forge"');
    expect(welcome).not.toMatch(/:disabled="[^"]*TERMINAL/);
    expect(welcome).toMatch(/function openTerminal\(\): void \{\s*runHostAction\('open Forge in the terminal', \(\) =>\s*transport\.openClaudeInTerminal\(undefined, undefined, 'bottom'\),/);
  });

  it('shows the empty chat\'s terminal card, and keeps its tip in the rotation', () => {
    const chat = read('src/webview/src/pages/ChatPage.vue');
    expect(chat).toMatch(/<div class="fg-emptystate__terminalBannerContainer">\s*<TerminalBanner \/>/);
    const banner = read('src/webview/src/components/welcome/TerminalBanner.vue');
    expect(banner).toContain('@click.prevent="openTerminal"');
    expect(read('src/webview/src/components/RandomTip.vue')).toContain(
      "['Use Forge in the terminal to configure MCP servers. They’ll work here, too!'],",
    );
  });
});
