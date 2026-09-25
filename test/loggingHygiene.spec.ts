/**
 * The Forge output channel is readable (production audit, 2026-09-24).
 *
 * - Log lines and UI strings are English (80 log calls and two UI strings
 *   were Chinese). Source comments are left as they are.
 * - What happens once per message is trace: each stream event, each message
 *   either way, each request, each CLI debug line. The channel's own level
 *   decides whether they show; Forge no longer hides trace itself.
 * - The webview no longer `console.log`s every host message.
 * - The config probe logs a summary; the full object is trace.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { logStderrLine, stderrLineLevel } from '../src/services/claude/ClaudeSdkService';
import { summarizeConfig } from '../src/services/claude/handlers/handlers';
import { LogService } from '../src/services/logService';

const ROOT = join(__dirname, '..', 'src');
const CJK = /[　-〿一-鿿＀-￯]/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : /\.(ts|vue)$/.test(name) ? [full] : [];
  });
}

/** Code lines only: comment lines, and trailing `//` comments, removed. */
function codeLines(file: string): Array<{ line: number; code: string }> {
  // \r?\n: on a Windows checkout a trailing \r kept `//.*$` from seeing the comment.
  return readFileSync(file, 'utf8').split(/\r?\n/).flatMap((text, i) => {
    const trimmed = text.trim();
    if (/^(\/\/|\*|\/\*|<!--)/.test(trimmed)) return [];
    const code = text.replace(/\s\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    return [{ line: i + 1, code }];
  });
}

describe('English', () => {
  it('has no Chinese in any log call or string outside comments', () => {
    const found: string[] = [];
    for (const file of files(ROOT)) {
      for (const { line, code } of codeLines(file)) {
        if (CJK.test(code)) found.push(`${file.replace(ROOT, 'src')}:${line}: ${code.trim().slice(0, 100)}`);
      }
    }
    expect(found).toEqual([]);
  });
});

describe('CLI stderr', () => {
  it.each([
    ['2026-09-24T10:00:00.000Z [ERROR] API error: 500', 'error'],
    ['2026-09-24T10:00:00.000Z [WARN] slow MCP server', 'warn'],
    ['2026-09-24T10:00:00.000Z [DEBUG] Tool Read: no errors', 'trace'],
    ['2026-09-24T10:00:00.000Z [INFO] hooks loaded', 'trace'],
    ['Error: Cannot find module x', 'warn'],
    ['    at Object.<anonymous>', 'trace'],
  ] as const)('%s is %s', (line, level) => {
    expect(stderrLineLevel(line)).toBe(level);
  });

  it('a debug line that mentions an error is not an error', () => {
    expect(stderrLineLevel('2026-09-24T10:00:00.000Z [DEBUG] retry after error 429')).toBe('trace');
  });

  it('logs at that level, marked as the CLI', () => {
    const log = { error: vi.fn(), warn: vi.fn(), trace: vi.fn() };
    logStderrLine(log, '2026-09-24T10:00:00.000Z [ERROR] boom');
    logStderrLine(log, '2026-09-24T10:00:00.000Z [DEBUG] noise');
    expect(log.error).toHaveBeenCalledWith('[CLI] 2026-09-24T10:00:00.000Z [ERROR] boom');
    expect(log.trace).toHaveBeenCalledWith('[CLI] 2026-09-24T10:00:00.000Z [DEBUG] noise');
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe('per-message lines are trace', () => {
  const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

  it.each([
    ['services/claude/ClaudeAgentService.ts', /this\.logService\.trace\(`  ← message #\$\{messageCount\}/],
    ['services/claude/ClaudeAgentService.ts', /this\.logService\.trace\(`\[ClaudeAgentService\] request: \$\{request\.type\}`\)/],
    ['services/claude/transport/VSCodeTransport.ts', /this\.logService\.trace\(`\[VSCodeTransport\] → \$\{message\.type\}`\)/],
    ['services/webViewService.ts', /this\.logService\.trace\(`\[WebView → Extension\] \$\{message\.type\}`\)/],
    ['services/claude/ClaudeSdkService.ts', /this\.logService\.trace\(`\[Hook\] PreToolUse/],
    ['services/claude/ClaudeSdkService.ts', /this\.logService\.trace\(`  - \$\{key\}: \$\{redactEnvValue\(key, value\)\}`\)/],
  ])('%s', (file, pattern) => {
    expect(read(file)).toMatch(pattern);
  });

  it('the webview does not log every host message', () => {
    expect(read('webview/src/transport/VSCodeTransport.ts')).not.toMatch(/console\.log/);
  });

  it('trace reaches the output channel, which applies its own level', () => {
    const service = new LogService();
    const channel = (service as any).outputChannel;
    const trace = vi.spyOn(channel, 'trace');
    service.trace('x');
    expect(trace).toHaveBeenCalledWith('x');
  });
});

describe('the config probe line', () => {
  it('counts lists and names fields', () => {
    expect(summarizeConfig({ models: [1, 2, 3], slashCommands: [1], account: { a: 1, b: 2 }, fastMode: false, x: undefined })).toBe(
      'models: 3, slashCommands: 1, account: {2 keys}, fastMode: false',
    );
    expect(summarizeConfig(null)).toBe('null');
  });
});
