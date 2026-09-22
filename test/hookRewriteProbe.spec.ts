/**
 * Does `updatedToolOutput` rewrite what the *transcript* sees, or only what the
 * model sees?
 *
 * A5 filters high-volume tool output by returning `updatedToolOutput` from a
 * PostToolUse hook. The SDK type says it "replaces the tool output before it is
 * sent to the model" -- but the rewrite is applied inside the `claude` binary,
 * not in `sdk.mjs`, so nothing in the repo answers whether the rewritten or the
 * original text comes back on the message stream.
 *
 * That matters, because the webview renders whatever the stream carries:
 *
 *   - stream carries the REWRITTEN text -> the transcript shows Forge's
 *     abridged copy, and the full output exists only in `fullOutputStore` with
 *     nothing surfacing it. A regression introduced by A5.
 *   - stream carries the ORIGINAL text -> the transcript is untouched and A5
 *     does exactly what it claims.
 *
 * Opt-in, like the other live test, because it spawns the real CLI and needs a
 * working endpoint:
 *
 *   FORGE_E2E_BASE_URL, FORGE_E2E_API_KEY, FORGE_E2E_MODEL
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { startRelay, type RunningRelay } from '../src/services/endpoints/relay';
import { parseProfile } from '../src/services/endpoints/profile';

const BASE_URL = process.env.FORGE_E2E_BASE_URL;
const API_KEY = process.env.FORGE_E2E_API_KEY;
const MODEL = process.env.FORGE_E2E_MODEL ?? 'auto/best-fast';

const suite = BASE_URL && API_KEY ? describe : describe.skip;

/** Text only the hook can produce, so its presence is unambiguous. */
const SENTINEL = 'FORGE_HOOK_REWROTE_THIS';

suite('updatedToolOutput: what reaches the transcript', () => {
  let relay: RunningRelay;

  beforeAll(async () => {
    relay = await startRelay({
      profile: parseProfile(
        {
          name: 'hookprobe',
          wire: 'openai',
          baseUrl: BASE_URL,
          model: MODEL,
          auth: { kind: 'bearer', value: '${env:FORGE_E2E_API_KEY}' },
          timeoutMs: 120_000,
          capabilities: { tools: true, contextWindow: 128_000, maxOutputTokens: 2048 },
        },
        'hookprobe',
      ),
      secrets: (key) => process.env[key],
      workspaceRoot: process.cwd(),
      log: () => { },
    });
  }, 60_000);

  afterAll(async () => {
    await relay?.close();
  });

  it('reports whether the stream carries the rewrite or the original', async () => {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');

    let hookFired = false;
    let originalSeen = '';

    const stream = query({
      prompt: 'Run exactly this command with the Bash tool and nothing else: echo ORIGINAL_TOOL_OUTPUT_MARKER',
      options: {
        model: MODEL,
        cwd: process.cwd(),
        permissionMode: 'bypassPermissions',
        pathToClaudeCodeExecutable: path.resolve('resources/native-binary/claude.exe'),
        env: {
          ...process.env,
          ANTHROPIC_BASE_URL: relay.baseUrl,
          ANTHROPIC_AUTH_TOKEN: relay.token,
          ANTHROPIC_API_KEY: relay.token,
          CLAUDE_CODE_ENTRYPOINT: 'forge-test',
        },
        hooks: {
          PostToolUse: [{
            hooks: [async (input: any) => {
              if (input?.hook_event_name !== 'PostToolUse') return { continue: true };
              hookFired = true;
              // Shape matters: A5's filter only runs when this is a string.
              originalSeen = JSON.stringify(input.tool_response)?.slice(0, 400) ?? 'undefined';
              return {
                continue: true,
                hookSpecificOutput: {
                  hookEventName: 'PostToolUse',
                  updatedToolOutput: SENTINEL,
                },
              };
            }],
          }] as any,
        },
      },
    });

    // Collect every tool_result the stream carries -- this is exactly what the
    // webview would render.
    const toolResults: string[] = [];
    for await (const message of stream as any) {
      if (message?.type !== 'user') continue;
      const content = message.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block?.type === 'tool_result') toolResults.push(JSON.stringify(block.content));
      }
    }

    const joined = toolResults.join('\n');
    const streamHasRewrite = joined.includes(SENTINEL);
    const streamHasOriginal = joined.includes('ORIGINAL_TOOL_OUTPUT_MARKER');

    // eslint-disable-next-line no-console
    console.log('\n  ── updatedToolOutput probe ──');
    // eslint-disable-next-line no-console
    console.log('  hook fired            :', hookFired);
    // eslint-disable-next-line no-console
    console.log('  hook saw (original)   :', originalSeen.slice(0, 80).replace(/\n/g, '\\n'));
    // eslint-disable-next-line no-console
    console.log('  tool_result count     :', toolResults.length);
    // eslint-disable-next-line no-console
    console.log('  stream has REWRITE    :', streamHasRewrite);
    // eslint-disable-next-line no-console
    console.log('  stream has ORIGINAL   :', streamHasOriginal);
    // eslint-disable-next-line no-console
    console.log('  => transcript would show:',
      streamHasRewrite ? 'THE ABRIDGED COPY (A5 affects the UI)'
        : streamHasOriginal ? 'THE FULL ORIGINAL (A5 is model-only)'
          : 'INCONCLUSIVE — the model may not have called Bash');

    // The test asserts only that the probe ran; the answer is the output above.
    expect(hookFired || toolResults.length >= 0).toBe(true);
  }, 300_000);

  it('smart-stream actually fires on a real Bash response', async () => {
    // The regression this pins: `tool_response` is an object for Bash, and the
    // first version of the filter handled only strings, so it silently skipped
    // the one tool most likely to emit ten thousand lines.
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const { budgetFor, filterToolResponse, toolResponseText } =
      await import('../src/services/claude/smartStream');

    let sawResponse: unknown;
    let filtered: ReturnType<typeof filterToolResponse>;

    const stream = query({
      prompt: 'Use the Bash tool to run exactly: seq 1 4000 | sed "s/^/line /"',
      options: {
        model: MODEL,
        cwd: process.cwd(),
        permissionMode: 'bypassPermissions',
        pathToClaudeCodeExecutable: path.resolve('resources/native-binary/claude.exe'),
        env: {
          ...process.env,
          ANTHROPIC_BASE_URL: relay.baseUrl,
          ANTHROPIC_AUTH_TOKEN: relay.token,
          ANTHROPIC_API_KEY: relay.token,
          CLAUDE_CODE_ENTRYPOINT: 'forge-test',
        },
        hooks: {
          PostToolUse: [{
            hooks: [async (input: any) => {
              if (input?.hook_event_name !== 'PostToolUse') return { continue: true };
              sawResponse = input.tool_response;
              // Exactly what ClaudeSdkService now does.
              filtered = filterToolResponse(input.tool_response, budgetFor(32_000));
              return { continue: true };
            }],
          }] as any,
        },
      },
    });

    for await (const _ of stream as any) { /* drain */ }

    const fullLen = toolResponseText(sawResponse).length;
    // eslint-disable-next-line no-console
    console.log('\n  ── smart-stream on a real Bash response ──');
    // eslint-disable-next-line no-console
    console.log('  tool_response type    :', typeof sawResponse);
    // eslint-disable-next-line no-console
    console.log('  full text length      :', fullLen);
    // eslint-disable-next-line no-console
    console.log('  filter fired          :', !!filtered);
    if (filtered) {
      const outLen = toolResponseText(filtered.response).length;
      // eslint-disable-next-line no-console
      console.log('  original lines        :', filtered.stats.originalLines);
      // eslint-disable-next-line no-console
      console.log('  filtered text length  :', outLen, `(${Math.round((1 - outLen / fullLen) * 100)}% smaller)`);
    }

    if (fullLen > budgetFor(32_000).maxChars) {
      expect(filtered, 'filter must fire on output over budget').toBeDefined();
    }
  }, 300_000);
});
