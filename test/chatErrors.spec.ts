/**
 * A launch that fails, or a CLI that stops mid-turn, is shown in the chat.
 *
 * Production audit (2026-09-24): the host sent `close_channel` with the error
 * and the webview stored it on `session.error`, but no template rendered it,
 * so a missing binary, a platform Forge does not ship for, or a crash mid-turn
 * left the chat looking as if nothing happened.
 *
 * - `describeLaunchError` turns the failures into sentences a user can act on;
 * - an abort Forge caused itself (closing a query it no longer needs) is not
 *   reported;
 * - `ChatPage.vue` renders the error in the official chat module's
 *   errorBanner, with a dismiss button.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ClaudeBinaryError, describeLaunchError, isAbortError } from '../src/services/claude/cliLaunch';
import { handleOpenOutputPanel } from '../src/services/claude/handlers/handlers';
import { SESSION_LOAD_FAILED, Session } from '../src/webview/src/core/Session';
import { signal } from 'alien-signals';

import { OFFICIAL_DIR, readOfficial } from './helpers/officialBundle';

describe('describeLaunchError', () => {
  it('says Forge is Windows x64 only when there is no binary for this platform', () => {
    const error = new ClaudeBinaryError('Unsupported platform: linux-x64. No compatible Claude Code binary found.', 'unsupported_platform');
    expect(describeLaunchError(error, 'linux', 'x64')).toBe(
      'Forge runs on Windows x64 only. This VS Code is linux-x64, and this build has no Claude Code binary for it.',
    );
    // The host passes String(error) through too: "ClaudeBinaryError: Unsupported platform: …"
    expect(describeLaunchError('ClaudeBinaryError: Unsupported platform: darwin-arm64.', 'darwin', 'arm64')).toMatch(/Windows x64 only.*darwin-arm64/);
  });

  it('on Windows x64, a binary that does not resolve is a damaged install, not an unsupported platform', () => {
    const error = new ClaudeBinaryError('Unsupported platform: win32-x64. No compatible Claude Code binary found.', 'unsupported_platform');
    expect(describeLaunchError(error, 'win32', 'x64')).toBe('The Claude Code binary is missing from this Forge install. Reinstall the Forge extension.');
  });

  it('says the binary is missing, and where it was expected', () => {
    const message = describeLaunchError(new Error('Claude CLI not found at: C:\\ext\\resources\\native-binary\\claude.exe'));
    expect(message).toBe(
      'The Claude Code binary is missing from this Forge install (C:\\ext\\resources\\native-binary\\claude.exe). Reinstall the Forge extension.',
    );
    expect(describeLaunchError(new Error('spawn C:\\x\\claude.exe ENOENT'))).toMatch(/binary is missing.*Reinstall/);
  });

  it('turns an exit code into a sentence, without the debug stderr tail', () => {
    const error = new Error('Claude Code process exited with code 1. stderr: [DEBUG] 4000 lines of --debug-to-stderr');
    expect(describeLaunchError(error)).toBe(
      'Claude Code stopped unexpectedly (exit code 1). The Forge output channel has the details.',
    );
    expect(describeLaunchError(new Error('Claude Code process terminated by signal SIGKILL'))).toMatch(/stopped by the system \(SIGKILL\)/);
  });

  it('keeps any other message, minus the "Error:" prefix', () => {
    expect(describeLaunchError(new Error('Forge relay: bad token'))).toBe('Forge relay: bad token');
    expect(describeLaunchError('Error: something else')).toBe('something else');
    expect(describeLaunchError(undefined)).toMatch(/stopped unexpectedly/);
  });
});

describe('isAbortError', () => {
  it.each([
    ['the SDK abort on a closed query', Object.assign(new Error('Claude Code process aborted by user'), { name: 'Error' })],
    ['a generic abort', new Error('Operation aborted')],
    ['a connection abort', new Error('Connection aborted by user')],
    ['a DOM-style AbortError', Object.assign(new Error('x'), { name: 'AbortError' })],
  ])('treats %s as not worth reporting', (_what, error) => {
    expect(isAbortError(error)).toBe(true);
  });

  it.each([
    new Error('Claude Code process exited with code 1'),
    new Error('The user aborted a merge, then …'),
    'Operation aborted',
    undefined,
  ])('reports %s', (error) => {
    expect(isAbortError(error)).toBe(false);
  });
});

describe('the host', () => {
  const source = readFileSync(join(__dirname, '../src/services/claude/ClaudeAgentService.ts'), 'utf8');

  it('sends describeLaunchError on both launch-failure and mid-turn close paths', () => {
    expect(source).not.toMatch(/closeChannel\(channelId, true, String\(error\)\)/);
    expect(source.match(/describeLaunchError\(error\)/g)).toHaveLength(2);
  });

  it('does not report an abort, or a query Forge already replaced', () => {
    expect(source).toMatch(/const stoppedByForge = this\.channels\.get\(channelId\)\?\.query !== query \|\| isAbortError\(error\);/);
  });
});

describe('the chat', () => {
  const page = readFileSync(join(__dirname, '../src/webview/src/pages/ChatPage.vue'), 'utf8');

  it('renders session.error in the official errorBanner, as index.js builds it', () => {
    expect(page).toMatch(/<div v-if="sessionError" class="fg-chat__errorBanner">/);
    expect(page).toMatch(/<div class="fg-chat__errorMessage">\{\{ sessionError \}\}<br>/);
    // Retry only after a failed load, then the two links, " · " between them.
    expect(page).toMatch(/<template v-if="sessionLoadFailed"><a[\s\S]*?@click\.prevent\.stop="retrySessionLoad"\s*>Retry<\/a> · <\/template>/);
    expect(page).toMatch(/@click\.prevent\.stop="openOutputPanel"\s*>View output logs<\/a> · <a/);
    expect(page).toMatch(/href="https:\/\/code\.claude\.com\/docs\/en\/vs-code#troubleshooting"\s*>Troubleshooting resources<\/a><\/div>/);
    // The official button: no type, an aria-label, a literal ×.
    expect(page).toMatch(/<button\s+class="fg-chat__errorDismiss"\s+aria-label="Dismiss error"\s+@click="dismissSessionError"\s*>×<\/button>/);
  });

  it.skipIf(!OFFICIAL_DIR)('matches the official markup in the bundle', () => {
    const bundle = readOfficial('webview/index.js');
    expect(bundle).toContain('D0&&R("div",{className:u0.errorBanner,children:[R("div",{className:u0.errorMessage,children:[D0,F("br",{}),$.loadFailed.value&&');
    expect(bundle).toContain('children:"Retry"})," · "]}),F(xF1,{context:J})," · ",F(sV,{})]}),F("button",{className:u0.errorDismiss,onClick:()=>{$.error.value=void 0},"aria-label":"Dismiss error",children:"×"})');
    expect(bundle).toContain('onAction:()=>$.openOutputPanel(),children:"View output logs"');
    expect(bundle).toContain('href:"https://code.claude.com/docs/en/vs-code#troubleshooting",children:"Troubleshooting resources"');
  });

  it('uses rules that exist in the ported official CSS', () => {
    const css = readFileSync(join(__dirname, '../src/webview/src/styles/official/chat.css'), 'utf8');
    for (const rule of ['.fg-chat__errorBanner', '.fg-chat__errorMessage', '.fg-chat__errorDismiss']) {
      expect(css).toContain(`${rule} {`);
    }
  });
});

describe('a conversation that cannot be read (the official loadFailed)', () => {
  function session(getSession: () => Promise<any>) {
    const s = Object.create(Session.prototype);
    Object.assign(s, {
      sessionId: signal<string | undefined>('3f2c8a10-5b7e-4d21-9a0c-1e2f3a4b5c6d'),
      isLoading: signal(false),
      error: signal<string | undefined>(undefined),
      loadFailed: signal(false),
      messages: signal<any[]>([]),
      getConnection: async () => ({ getSession }),
      processMessage: () => {},
      launchClaude: vi.fn(async () => 'c1'),
    });
    return s;
  }

  it('shows "Couldn\'t open this session." and remembers the failure', async () => {
    const s = session(async () => { throw new Error('ENOENT'); });
    await expect(s.loadFromServer()).rejects.toThrow('ENOENT');
    expect(s.error()).toBe(SESSION_LOAD_FAILED);
    expect(s.loadFailed()).toBe(true);
    expect(s.isLoading()).toBe(false);
  });

  it('does nothing more until asked to retry, then clears its own error', async () => {
    let fail = true;
    const getSession = vi.fn(async () => { if (fail) throw new Error('x'); return { messages: [] }; });
    const s = session(getSession);
    await s.loadFromServer().catch(() => {});
    await s.loadFromServer();
    expect(getSession).toHaveBeenCalledTimes(1);

    fail = false;
    await s.loadFromServer({ retry: true });
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(s.loadFailed()).toBe(false);
    expect(s.error()).toBeUndefined();
    expect(s.launchClaude).toHaveBeenCalled();
  });

  it('keeps an error that is not its own on retry', async () => {
    const s = session(async () => ({ messages: [] }));
    s.loadFailed(true);
    s.error('Claude Code stopped unexpectedly (exit code 1).');
    await s.loadFromServer({ retry: true });
    expect(s.error()).toBe('Claude Code stopped unexpectedly (exit code 1).');
  });

  it('does not report a relaunch failure as a load failure', async () => {
    const s = session(async () => ({ messages: [] }));
    s.launchClaude = vi.fn(async () => { throw new Error('launch'); });
    await expect(s.loadFromServer()).rejects.toThrow('launch');
    expect(s.loadFailed()).toBe(false);
    expect(s.error()).toBeUndefined();
  });
});

describe('open_output_panel (the banner\'s "View output logs")', () => {
  it('shows the Forge output channel', async () => {
    const show = vi.fn();
    expect(await handleOpenOutputPanel({ type: 'open_output_panel' }, { logService: { show } } as any)).toEqual({
      type: 'open_output_panel_response',
    });
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('is wired in the transport, the dispatcher and the harness', () => {
    const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
    expect(read('src/webview/src/transport/BaseTransport.ts')).toMatch(/openOutputPanel\(\): Promise<OpenOutputPanelResponse> \{\s*return this\.sendRequest<OpenOutputPanelResponse>\(\{ type: "open_output_panel" \}\);/);
    expect(read('src/services/claude/ClaudeAgentService.ts')).toMatch(/case "open_output_panel":\s*return handleOpenOutputPanel\(request, this\.handlerContext\);/);
    expect(read('.claude/skills/ui-parity/harness/mock-host.js')).toMatch(/case 'open_output_panel': \{[\s\S]*?respond\(requestId, \{ type: 'open_output_panel_response' \}\);/);
  });
});
