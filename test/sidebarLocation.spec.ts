/**
 * Where the chat lives, and what the activity-bar button opens.
 *
 * Reported from a real install: "the left side button must, when clicked, open
 * the history like Claude Code in VS Code, not twice the window." It opened a
 * second chat beside the one already on screen.
 *
 * The official's arrangement, from its activation:
 *
 *   let V = version.split(".").map(Number), B = V[0] ?? 0, H = V[1] ?? 0;
 *   let q = B > 1 || (B === 1 && H >= 106);
 *   if (!q) setContext("claude-code:doesNotSupportSecondarySidebar", true);
 *   setContext("claude-vscode.sessionsListEnabled", true);
 *
 * So on any VS Code that can host it, the **chat** is in the secondary side bar
 * and the **activity bar** belongs to the sessions list. Forge instead defaulted
 * `preferredLocation` to `primary` and shipped `showSessionsSidebar` off, which
 * is the duplicate window that was reported.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import {
  CTX_NO_SECONDARY_SIDEBAR,
  CTX_SESSIONS_LIST_ENABLED,
  applySidebarContextKeys,
  supportsSecondarySidebar,
} from '../src/commands/forgeCommands';

const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as any;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('the version gate, copied from the official', () => {
  it.each(['1.106.0', '1.107.2', '1.138.0', '2.0.0', '1.200.0'])(
    '%s can host the secondary side bar',
    (version) => {
      expect(supportsSecondarySidebar(version)).toBe(true);
    },
  );

  it.each(['1.105.9', '1.98.0', '1.0.0', '0.99.0'])('%s cannot', (version) => {
    expect(supportsSecondarySidebar(version)).toBe(false);
  });

  it('treats a malformed version as too old, which is the safe direction', () => {
    // A build whose version cannot be read gets the primary side bar, where a
    // container always resolves. The other way round leaves no chat at all.
    expect(supportsSecondarySidebar('')).toBe(false);
    expect(supportsSecondarySidebar('insiders')).toBe(false);
  });
});

describe('the context keys activation sets', () => {
  it('leaves the "no secondary side bar" key unset on a modern build', () => {
    // The official only ever sets it when unsupported; an absent key is falsy,
    // so `!forge:doesNotSupportSecondarySidebar` is true without setting it.
    const exec = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined as never);
    applySidebarContextKeys('1.138.0');
    const keys = exec.mock.calls.map((c) => c[1]);
    expect(keys).not.toContain(CTX_NO_SECONDARY_SIDEBAR);
    expect(keys).toContain(CTX_SESSIONS_LIST_ENABLED);
  });

  it('sets it on a build too old for the secondary side bar', () => {
    const exec = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined as never);
    applySidebarContextKeys('1.105.0');
    expect(exec).toHaveBeenCalledWith('setContext', CTX_NO_SECONDARY_SIDEBAR, true);
  });

  it('always enables the sessions list, like the official', () => {
    for (const version of ['1.105.0', '1.138.0']) {
      const exec = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined as never);
      applySidebarContextKeys(version);
      expect(exec).toHaveBeenCalledWith('setContext', CTX_SESSIONS_LIST_ENABLED, true);
      vi.restoreAllMocks();
    }
  });
});

describe('what the manifest contributes', () => {
  const activitybar = manifest.contributes.viewsContainers.activitybar as any[];
  const secondary = manifest.contributes.viewsContainers.secondarySidebar as any[];
  const chatPrimary = activitybar.find((c) => c.id === 'forge-sidebar');
  const sessions = activitybar.find((c) => c.id === 'forge-sessions-sidebar');
  const chatSecondary = secondary.find((c) => c.id === 'forge-sidebar-secondary');

  it('puts the chat in the secondary side bar by default', () => {
    expect(manifest.contributes.configuration.properties['forge.preferredLocation'].default)
      .toBe('secondary');
  });

  it('shows the sessions list by default, so the activity bar has an entry', () => {
    expect(manifest.contributes.configuration.properties['forge.showSessionsSidebar'].default)
      .toBe(true);
  });

  it('only puts the chat in the activity bar on an old build or by request', () => {
    expect(chatPrimary.when).toBe(
      "forge:doesNotSupportSecondarySidebar || config.forge.preferredLocation == 'primary'",
    );
  });

  it('gates the secondary container on the same key, negated', () => {
    expect(chatSecondary.when).toBe(
      "!forge:doesNotSupportSecondarySidebar && config.forge.preferredLocation != 'primary'",
    );
  });

  it.each([
    [false, 'secondary', 'secondary'],
    [false, 'primary', 'primary'],
    [true, 'secondary', 'primary'],
    [true, 'primary', 'primary'],
  ])(
    'with noSecondary=%s and preferredLocation=%s the chat is in exactly one place (%s)',
    (noSecondary, preferred, expected) => {
      // Evaluates the real clauses over every input, rather than asserting one
      // string is the negation of the other: the property that matters is that
      // no combination produces two chat containers, or none.
      const evaluate = (clause: string) =>
        Boolean(
          // eslint-disable-next-line no-new-func
          new Function('key', 'pref', `return ${clause
            .replace(/forge:doesNotSupportSecondarySidebar/g, 'key')
            .replace(/config\.forge\.preferredLocation/g, 'pref')}`)(noSecondary, preferred),
        );

      const inPrimary = evaluate(chatPrimary.when);
      const inSecondary = evaluate(chatSecondary.when);

      expect([inPrimary, inSecondary].filter(Boolean)).toHaveLength(1);
      expect(inPrimary ? 'primary' : 'secondary').toBe(expected);
    },
  );

  it('gives the sessions container the same title as the chat, like the official', () => {
    expect(sessions.title).toBe('Forge');
    expect(chatPrimary.title).toBe('Forge');
  });

  it('gives the sessions view no name, so it does not stack a second header', () => {
    const view = manifest.contributes.views['forge-sessions-sidebar'][0];
    expect(view.name).toBe('');
    expect(view.id).toBe('forge.sessionsView');
  });

  it('every container uses the masked cube', () => {
    for (const container of [...activitybar, ...secondary]) {
      expect(container.icon).toBe('resources/forge-cube.svg');
    }
  });
});
