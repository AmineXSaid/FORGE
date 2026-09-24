/**
 * The protocol cannot drift apart (production audit, 2026-09-24).
 *
 * A request lives in six places (CLAUDE.md B2). Three of them are checked here
 * against `messages.ts`, so adding a request type without the others fails:
 *
 * - every `WebViewRequest` type has a dispatcher `case` in
 *   `ClaudeAgentService.processRequest`, and every `case` is in the union;
 * - every `WebViewRequest` type has a case in the harness's mock host, so no
 *   surface is tested against its empty fallback answer;
 * - every push the host sends is in `ExtensionRequest`.
 *
 * The exceptions are the out-of-scope requests (`CLAUDE.md`, "Account &
 * cloud"), whose dispatcher cases stay commented out and which nothing in the
 * webview sends.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETTINGS_PAGE_KEYS } from '../src/services/claude/settingsPageWrites';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const messages = read('src/shared/messages.ts');
const dispatcher = read('src/services/claude/ClaudeAgentService.ts');
const mockHost = read('.claude/skills/ui-parity/harness/mock-host.js');

/** Out of scope by CLAUDE.md: login stays commented out in the dispatcher. */
const OUT_OF_SCOPE = ['get_auth_status', 'login', 'submit_oauth_code'];

/** Interface name -> its `type` literal. */
const INTERFACE_TYPES = new Map<string, string>();
for (const match of messages.matchAll(/export interface (\w+)[^{]*\{/g)) {
  const end = messages.indexOf('\n}', match.index! + match[0].length);
  const literal = /type:\s*["']([^"']+)["']/.exec(messages.slice(match.index! + match[0].length, end));
  if (literal) INTERFACE_TYPES.set(match[1], literal[1]);
}

function unionTypes(name: string): string[] {
  const start = messages.indexOf(`export type ${name} =`);
  expect(start, `${name} is declared`).toBeGreaterThan(-1);
  const body = messages.slice(start, messages.indexOf(';', start));
  return [...body.matchAll(/\|\s*(\w+)/g)].map(([, iface]) => {
    const type = INTERFACE_TYPES.get(iface);
    expect(type, `${iface} has a type literal`).toBeDefined();
    return type!;
  });
}

const REQUESTS = unionTypes('WebViewRequest');
const PUSHES = unionTypes('ExtensionRequest');

const switchStart = dispatcher.indexOf('async processRequest(');
const switchEnd = dispatcher.indexOf('default:', switchStart);
const DISPATCHED = new Set([...dispatcher.slice(switchStart, switchEnd).matchAll(/^\s*case "([a-z_]+)":/gm)].map((m) => m[1]));
const MOCKED = new Set([...mockHost.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]));

describe('webview -> host requests', () => {
  it('are many, and unique', () => {
    expect(REQUESTS.length).toBeGreaterThan(60);
    expect(new Set(REQUESTS).size).toBe(REQUESTS.length);
  });

  it.each(REQUESTS.filter((t) => !OUT_OF_SCOPE.includes(t)))('%s has a dispatcher case', (type) => {
    expect(DISPATCHED.has(type)).toBe(true);
  });

  it('every dispatcher case is a request in the union', () => {
    expect([...DISPATCHED].filter((type) => !REQUESTS.includes(type))).toEqual([]);
  });

  it.each(REQUESTS.filter((t) => !OUT_OF_SCOPE.includes(t)))('%s has a mock-host case', (type) => {
    expect(MOCKED.has(type)).toBe(true);
  });
});

describe('the out-of-scope requests', () => {
  it.each(OUT_OF_SCOPE)('%s has no live dispatcher case, and nothing sends it', (type) => {
    expect(DISPATCHED.has(type)).toBe(false);
    expect(dispatcher).toMatch(new RegExp(`//\\s*case "${type}":`));
    expect(read('src/webview/src/transport/BaseTransport.ts')).not.toMatch(new RegExp(`type:\\s*["']${type}["']`));
  });
});

describe('host -> webview pushes', () => {
  it.each(['select_settings_tab', 'extension_config_changed', 'visibility_changed', 'ui_command', 'update_state'])(
    '%s is in ExtensionRequest',
    (type) => {
      expect(PUSHES).toContain(type);
    },
  );

  it('every push type the host builds is in ExtensionRequest', () => {
    const hostFiles = [
      'src/services/claude/ClaudeAgentService.ts',
      'src/services/claude/handlers/handlers.ts',
      'src/services/webViewService.ts',
      'src/commands/forgeCommands.ts',
    ].map(read).join('\n');
    const pushed = new Set([
      ...[...hostFiles.matchAll(/request:\s*\{\s*type:\s*['"]([a-z_]+)['"]/g)].map((m) => m[1]),
      ...[...hostFiles.matchAll(/notifyClient\(\{\s*type:\s*['"]([a-z_]+)['"]/g)].map((m) => m[1]),
    ]);
    // The scan finds real pushes, so an empty match cannot pass for "all declared".
    expect([...pushed]).toEqual(expect.arrayContaining(['select_settings_tab', 'extension_config_changed', 'visibility_changed']));
    expect([...pushed].filter((type) => !PUSHES.includes(type))).toEqual([]);
  });
});

describe('the mock host mirrors the real validation', () => {
  it('allows exactly the keys the Settings page may write', () => {
    const list = /const SETTINGS_PAGE_KEYS = \[([\s\S]*?)\];/.exec(mockHost)?.[1] ?? '';
    const keys = [...list.matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]).sort();
    expect(keys).toEqual(Object.keys(SETTINGS_PAGE_KEYS).sort());
  });
});
