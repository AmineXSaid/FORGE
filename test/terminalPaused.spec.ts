/**
 * "Open Forge in Terminal" is paused (2026-09-28): every way into it is shown
 * greyed out with "(soon)" and does nothing, until TERMINAL_AVAILABLE flips.
 * The host request still works; only the entry points are held back.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SOON, TERMINAL_AVAILABLE } from '../src/webview/src/components/forge/terminalAvailability';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('the terminal, paused', () => {
  it('is off, and says soon', () => {
    expect(TERMINAL_AVAILABLE).toBe(false);
    expect(SOON).toBe('soon');
  });

  it('greys out the "/" menu rows that open it, and the menu runs neither', () => {
    const area = read('src/webview/src/components/ButtonArea.vue');
    expect(area).toMatch(/id: 'terminal',[^\n]*soon: !TERMINAL_AVAILABLE/);
    expect(area).toMatch(/fastModeRows\(props\.supportsFastMode\)\.map\(\(row\) => \(\{ \.\.\.row, soon: !TERMINAL_AVAILABLE \}\)\)/);
    expect(area).toMatch(/case 'terminal': if \(!TERMINAL_AVAILABLE\) return;/);
    expect(area).toMatch(/case 'fast': if \(!TERMINAL_AVAILABLE\) return;/);
    const menu = read('src/webview/src/components/forge/CommandMenu.vue');
    expect(menu).toMatch(/function run\(cmd: MenuCommand, viaTab: boolean\): void \{\s*if \(cmd\.soon\) return;/);
    expect(menu).toContain(`:aria-disabled="cmd.soon ? 'true' : undefined"`);
    expect(menu).toContain('({{ SOON }})');
  });

  it('greys out the welcome page\'s "Use the terminal", and hides the terminal card and tip', () => {
    const welcome = read('src/webview/src/components/welcome/EndpointWelcome.vue');
    expect(welcome).toContain(':disabled="!TERMINAL_AVAILABLE"');
    expect(welcome).toMatch(/function openTerminal\(\): void \{\s*if \(!TERMINAL_AVAILABLE\) return;/);
    expect(read('src/webview/src/pages/ChatPage.vue')).toMatch(/v-if="TERMINAL_AVAILABLE" class="fg-emptystate__terminalBannerContainer"/);
    expect(read('src/webview/src/components/RandomTip.vue')).toMatch(/TERMINAL_AVAILABLE \? \[\['Use Forge in the terminal/);
  });
});
