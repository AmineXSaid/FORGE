/**
 * The Expert row (production audit, Phase 6, item 2).
 *
 * `set_expert_mode {channelId, enabled}` turns the plugin's `forge:Expert`
 * output style on or off for one running session through the CLI's
 * session-scoped flag layer (`applyFlagSettings({outputStyle})`). The row is
 * first in the mode menu, in gold, first in the Shift+Tab cycle, and the
 * session re-applies it after every launch, before its first message.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { signal } from 'alien-signals';
import { ClaudeAgentService } from '../src/services/claude/ClaudeAgentService';
import { handleSetExpertMode } from '../src/services/claude/handlers/handlers';
import { Session } from '../src/webview/src/core/Session';

const ROOT = join(__dirname, '..');
// LF whatever the checkout: git on Windows converts to CRLF, and the patterns below say \n.
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

beforeAll(() => {
  (globalThis as any).window ??= { location: new URL('http://localhost/index.html'), history: { replaceState: () => {} } };
});

describe('set_expert_mode: the handler', () => {
  const context = () => ({ agentService: { setExpertMode: vi.fn(async () => {}) } }) as any;

  it('turns Expert on and off for the named session', async () => {
    const ctx = context();
    expect(await handleSetExpertMode({ type: 'set_expert_mode', channelId: 'c1', enabled: true }, ctx)).toEqual({ type: 'set_expert_mode_response', enabled: true });
    expect(await handleSetExpertMode({ type: 'set_expert_mode', channelId: 'c1', enabled: false }, ctx)).toEqual({ type: 'set_expert_mode_response', enabled: false });
    expect(ctx.agentService.setExpertMode.mock.calls).toEqual([['c1', true], ['c1', false]]);
  });

  it('refuses anything but a boolean, before touching the session', async () => {
    const ctx = context();
    for (const enabled of ['true', 1, null, undefined, { on: true }]) {
      await expect(handleSetExpertMode({ type: 'set_expert_mode', channelId: 'c1', enabled } as any, ctx)).rejects.toThrow(/true or false/);
    }
    expect(ctx.agentService.setExpertMode).not.toHaveBeenCalled();
  });

  it('refuses a request with no session', async () => {
    const ctx = context();
    for (const channelId of ['', undefined, 7]) {
      await expect(handleSetExpertMode({ type: 'set_expert_mode', channelId, enabled: true } as any, ctx)).rejects.toThrow(/running session/);
    }
  });
});

describe('set_expert_mode: the session flag layer', () => {
  function service() {
    const s = new (ClaudeAgentService as any)({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {});
    const applyFlagSettings = vi.fn(async () => {});
    s.channels.set('c1', { query: { applyFlagSettings } });
    return { s, applyFlagSettings };
  }

  it("sets outputStyle to the plugin's forge:Expert, and null to turn it off", async () => {
    const { s, applyFlagSettings } = service();
    await s.setExpertMode('c1', true);
    await s.setExpertMode('c1', false);
    expect(applyFlagSettings.mock.calls).toEqual([[{ outputStyle: 'forge:Expert' }], [{ outputStyle: null }]]);
  });

  it('refuses a channel Forge is not running', async () => {
    const { s, applyFlagSettings } = service();
    await expect(s.setExpertMode('nope', true)).rejects.toThrow(/Channel not found/);
    expect(applyFlagSettings).not.toHaveBeenCalled();
  });

  it('is routed by the dispatcher to the handler', () => {
    expect(read('src/services/claude/ClaudeAgentService.ts')).toMatch(/case "set_expert_mode":\s*return handleSetExpertMode\(request as SetExpertModeRequest, this\.handlerContext\);/);
  });
});

describe('the session re-applies Expert after a launch, before its first message', () => {
  const context = { currentSelection: signal(undefined), commandRegistry: { registerAction: () => {} }, fileOpener: {}, renameTab: () => {} } as any;

  function session() {
    const order: string[] = [];
    let release!: () => void;
    const connection = {
      config: () => ({}),
      launchClaude: vi.fn(() => {
        order.push('launch');
        return { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
      }),
      setExpertMode: vi.fn((_channel: string, enabled: boolean) => {
        order.push(`expert:${enabled}`);
        return new Promise<boolean>((resolve) => { release = () => resolve(true); });
      }),
      sendInput: vi.fn(() => order.push('input')),
    } as any;
    const s = new Session(async () => connection, context, {});
    return { s, connection, order, release: () => release() };
  }

  it('without a running CLI, choosing Expert waits for the next launch', async () => {
    const { s, connection } = session();
    await s.setExpertMode(true);
    expect(s.expertMode()).toBe(true);
    expect(connection.setExpertMode).not.toHaveBeenCalled();
  });

  it('a launch in Expert applies it, and the message goes in only after', async () => {
    const { s, order, release } = session();
    await s.setExpertMode(true);
    const sending = s.send('explain this');
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(['launch', 'expert:true']);
    release();
    await sending;
    expect(order).toEqual(['launch', 'expert:true', 'input']);
  });

  it('a launch outside Expert applies nothing', async () => {
    const { s, order } = session();
    await s.send('hello');
    expect(order).toEqual(['launch', 'input']);
  });

  it('with a running CLI, the flag is set now and the state follows the answer', async () => {
    const { s, connection, release } = session();
    await s.launchClaude();
    const turning = s.setExpertMode(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(s.expertMode()).toBe(false);
    release();
    await turning;
    expect(connection.setExpertMode).toHaveBeenCalledWith(s.claudeChannelId(), true);
    expect(s.expertMode()).toBe(true);
  });
});

describe('the menu and the cycle', () => {
  it('Expert is the first row, in the gold token', () => {
    const menu = read('src/webview/src/components/ModeSelect.vue');
    const ids = [...menu.matchAll(/id: '(\w+)'/g)].map((m) => m[1]);
    expect(ids[0]).toBe('expert');
    expect(ids).toEqual(['expert', 'default', 'acceptEdits', 'plan', 'bypassPermissions']);
    expect(menu).toMatch(/\.fg-modeTint\[data-mode='expert'\] \{\n  color: var\(--forge-expert\);/);
  });

  it('the gold is Pajamas orange-400 (orange-300 on dark), not the warning orange', () => {
    const tokens = read('src/webview/src/styles/forge-tokens.css');
    expect(tokens).toMatch(/--forge-expert:\s*var\(--pajamas-orange-400\);/);
    expect(tokens).toMatch(/--forge-expert:\s*var\(--pajamas-orange-300\);/);
    expect(tokens).toMatch(/--forge-warning:\s*var\(--pajamas-orange-500\);/);
  });

  it('Shift+Tab starts at Expert, and choosing Expert means Manual permissions', () => {
    const chat = read('src/webview/src/pages/ChatPage.vue');
    expect(chat).toMatch(/const order: ModeId\[\] = \[\s*'expert',\s*'default',\s*'acceptEdits',\s*'plan',/);
    expect(chat).toMatch(/if \(mode === 'expert'\) \{\s*try \{\s*await s\.setExpertMode\(true\);\s*if \(\(s\.permissionMode\.value \?\? 'default'\) !== 'default'\) await s\.setPermissionMode\('default'\);/);
    expect(chat).toMatch(/if \(s\.expertMode\.value\) \{\s*try \{\s*await s\.setExpertMode\(false\);/);
  });
});
