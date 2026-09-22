/**
 * Capture a real session against a live endpoint, for UI testing.
 *
 * Runs the actual `claude` binary through Forge's relay at a real gateway,
 * then writes every SDK message the stream produced to a JSON file. The
 * ui-parity harness replays that file into the real webview, so the transcript
 * on screen is rendering genuine model output -- real text, real tool calls,
 * real usage -- rather than a hand-written fixture that only ever contains
 * what someone remembered to put in it.
 *
 * Usage:
 *   FORGE_E2E_BASE_URL=... FORGE_E2E_API_KEY=... FORGE_E2E_MODEL=... \
 *     pnpm exec tsx scripts/capture-session.ts "your prompt"
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRelay } from '../src/services/endpoints/relay';
import { parseProfile } from '../src/services/endpoints/profile';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.claude/skills/ui-parity/.harness/session.json');

const BASE_URL = process.env.FORGE_E2E_BASE_URL;
const API_KEY = process.env.FORGE_E2E_API_KEY;
const MODEL = process.env.FORGE_E2E_MODEL ?? 'auto/best-fast';
const PROMPT = process.argv[2] ?? 'List the files in the current directory, then say how many there are.';

if (!BASE_URL || !API_KEY) {
  console.error('Set FORGE_E2E_BASE_URL and FORGE_E2E_API_KEY.');
  process.exit(1);
}

async function main(): Promise<void> {

const relay = await startRelay({
  profile: parseProfile(
    {
      name: 'capture',
      wire: 'openai',
      baseUrl: BASE_URL,
      model: MODEL,
      auth: { kind: 'bearer', value: '${env:FORGE_E2E_API_KEY}' },
      timeoutMs: 180_000,
      capabilities: { tools: true, contextWindow: 128_000, maxOutputTokens: 4096 },
    },
    'capture',
  ),
  secrets: (key) => process.env[key],
  workspaceRoot: process.cwd(),
  log: (m) => console.log(m),
});

console.log(`relay: ${relay.baseUrl} -> ${BASE_URL}`);
console.log(`model: ${MODEL}`);
console.log(`prompt: ${PROMPT}\n`);

const { query } = await import('@anthropic-ai/claude-agent-sdk');

const messages: unknown[] = [];
const stream = query({
  prompt: PROMPT,
  options: {
    model: MODEL,
    cwd: process.cwd(),
    permissionMode: 'bypassPermissions',
    pathToClaudeCodeExecutable: resolve(ROOT, 'resources/native-binary/claude.exe'),
    includePartialMessages: false,
    env: {
      ...process.env,
      ANTHROPIC_BASE_URL: relay.baseUrl,
      ANTHROPIC_AUTH_TOKEN: relay.token,
      ANTHROPIC_API_KEY: relay.token,
      CLAUDE_CODE_ENTRYPOINT: 'forge-capture',
    },
  },
});

try {
  for await (const message of stream as AsyncIterable<any>) {
    messages.push(message);
    const kind = message?.type === 'assistant' || message?.type === 'user'
      ? (message.message?.content ?? []).map?.((b: any) => b?.type).join(',')
      : message?.subtype ?? '';
    console.log(`  ${messages.length}. ${message?.type}${kind ? ` (${kind})` : ''}`);
  }
} catch (e) {
  console.error('stream ended with an error:', e instanceof Error ? e.message : e);
} finally {
  await relay.close();
}

writeFileSync(OUT, JSON.stringify({ prompt: PROMPT, model: MODEL, messages }, null, 1), 'utf8');
console.log(`\nwrote ${messages.length} messages to ${OUT}`);

}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
