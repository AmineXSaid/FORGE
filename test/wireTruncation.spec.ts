/**
 * The truncation detector: a gateway that silently drops the start of the prompt.
 *
 * Ollama's default context window is smaller than Claude Code's system prompt
 * plus tool definitions, and it truncates from the front without an error. The
 * model loses its instructions and tool list and starts inventing tools, which
 * reads as a bad model rather than a misconfigured server. The only evidence is
 * the usage block, so these specs pin the check down at both levels: the pure
 * rule, and the relay actually raising it from a real HTTP exchange.
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  detectTruncation,
  looksLikeOllama,
  MIN_ESTIMATE_FOR_CHECK,
  truncationAdvice,
} from '../src/services/endpoints/wire/truncation';
import { estimateTextTokens, estimateTokens } from '../src/services/endpoints/wire/anthropicServer';
import { OpenAiToAnthropicStream } from '../src/services/endpoints/wire/fromOpenAI';
import { startRelay, type RunningRelay } from '../src/services/endpoints/relay';
import { parseProfile } from '../src/services/endpoints/profile';

describe('detectTruncation: only accuse the gateway on strong evidence', () => {
  it('flags a prompt reported at a small fraction of what was sent', () => {
    expect(detectTruncation(4096, 30_000)).toEqual({ reported: 4096, estimated: 30_000 });
  });

  it('accepts a report at or above half the estimate (tokenizers differ)', () => {
    expect(detectTruncation(15_000, 30_000)).toBeUndefined();
    expect(detectTruncation(40_000, 30_000)).toBeUndefined();
  });

  it('stays silent when the gateway reported no usage at all', () => {
    // No evidence is not evidence of truncation.
    expect(detectTruncation(undefined, 30_000)).toBeUndefined();
    expect(detectTruncation(0, 30_000)).toBeUndefined();
    expect(detectTruncation(Number.NaN, 30_000)).toBeUndefined();
  });

  it('does not run on short prompts, where two tokenizers can legitimately differ by half', () => {
    expect(detectTruncation(100, MIN_ESTIMATE_FOR_CHECK - 1)).toBeUndefined();
  });
});

describe('estimateTextTokens: the check must not be fooled by images', () => {
  it('leaves out the flat per-image charge that estimateTokens adds', () => {
    const request = {
      messages: [{
        role: 'user' as const,
        content: [
          { type: 'text', text: 'x'.repeat(400) },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA' } },
        ],
      }],
    };
    expect(estimateTokens(request) - estimateTextTokens(request)).toBe(1400);
  });
});

describe('truncationAdvice: the fix for the server the user is on', () => {
  const finding = { reported: 4096, estimated: 30_000 };

  it('recognises Ollama by its port or its name', () => {
    expect(looksLikeOllama({ baseUrl: 'http://localhost:11434/v1' })).toBe(true);
    expect(looksLikeOllama({ baseUrl: 'https://ollama.internal/v1' })).toBe(true);
    expect(looksLikeOllama({ baseUrl: 'http://gpu-box:8000/v1' })).toBe(false);
  });

  it('gives Ollama its two real fixes, with a window above what was sent', () => {
    const text = truncationAdvice({ name: 'local', baseUrl: 'http://localhost:11434/v1' }, finding);
    expect(text).toMatch(/^\[local\] The endpoint processed only 4,096 of about 30,000 prompt tokens/);
    expect(text).toMatch(/OLLAMA_CONTEXT_LENGTH=65536/);
    expect(text).toMatch(/PARAMETER num_ctx 65536/);
  });

  it('names the setting on the other common servers', () => {
    const text = truncationAdvice({ name: 'gpu', baseUrl: 'http://gpu-box:8000/v1' }, finding);
    expect(text).toMatch(/--max-model-len/);
    expect(text).toMatch(/llama\.cpp -c/);
    expect(text).not.toMatch(/OLLAMA/);
  });
});

describe('OpenAiToAnthropicStream.reportedInputTokens', () => {
  it('is the gateway figure, never the fallback estimate', () => {
    const withUsage = new OpenAiToAnthropicStream({ model: 'm', fallbackUsage: () => ({ input_tokens: 999, output_tokens: 0 }) });
    withUsage.push({ choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] });
    withUsage.push({ choices: [], usage: { prompt_tokens: 4096, completion_tokens: 3 } });
    withUsage.end();
    expect(withUsage.reportedInputTokens).toBe(4096);

    const without = new OpenAiToAnthropicStream({ model: 'm', fallbackUsage: () => ({ input_tokens: 999, output_tokens: 0 }) });
    without.push({ choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] });
    without.end();
    expect(without.reportedInputTokens).toBeUndefined();
  });
});

describe('diagnostics: the Context window rung', () => {
  let server: http.Server | undefined;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  /**
   * A gateway that reads at most `window` prompt tokens, like Ollama with a
   * small num_ctx, or reports no usage at all when `window` is null.
   */
  async function gatewayWithWindow(window: number | null): Promise<string> {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        const sent = Math.ceil(JSON.stringify(body.messages ?? []).length / 4);
        const usage = window === null ? undefined : { prompt_tokens: Math.min(sent, window), completion_tokens: 1 };
        if (body.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          for (const w of ['one ', 'two ', 'three ']) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`);
          }
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], ...(usage ? { usage } : {}) })}\n\n`);
          res.end('data: [DONE]\n\n');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          ...(usage ? { usage } : {}),
        }));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/v1`;
  }

  async function contextRung(baseUrl: string, contextWindow = 128_000) {
    const { runLadder } = await import('../src/services/diagnostics/ladder');
    const rungs = await runLadder({
      profile: parseProfile(
        { name: 'box', wire: 'openai', baseUrl, model: 'qwen', proxy: { useEnvironment: false }, capabilities: { contextWindow } },
        'test',
      ),
      secrets: () => undefined,
    });
    return rungs.find((r) => r.name === 'Context window');
  }

  it('fails a server that reads only the first 4,096 tokens, with the fix', async () => {
    const rung = await contextRung(await gatewayWithWindow(4096));
    expect(rung?.status).toBe('fail');
    expect(rung?.detail).toMatch(/the server read 4,096/);
    expect(rung?.fix).toMatch(/context length/i);
  });

  it('passes a server that reads the whole prompt', async () => {
    const rung = await contextRung(await gatewayWithWindow(1_000_000));
    expect(rung?.status).toBe('pass');
  });

  it('skips, rather than fails, a server that reports no usage', async () => {
    const rung = await contextRung(await gatewayWithWindow(null));
    expect(rung?.status).toBe('skipped');
  });

  it('does not probe past the window the profile admits to', async () => {
    // A profile honest about an 8k window is sent ~6.4k, which that server holds.
    const rung = await contextRung(await gatewayWithWindow(8192), 8192);
    expect(rung?.status).toBe('pass');
  });
});

describe('the relay raises it from a real exchange', () => {
  let upstream: http.Server | undefined;
  let relay: RunningRelay | undefined;

  afterEach(async () => {
    await relay?.close();
    await new Promise<void>((resolve) => (upstream ? upstream.close(() => resolve()) : resolve()));
    upstream = undefined;
    relay = undefined;
  });

  /** An OpenAI gateway that always claims to have seen `promptTokens`. */
  async function gateway(promptTokens: number): Promise<string> {
    upstream = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: promptTokens, completion_tokens: 1 } })}\n\n`);
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise<void>((resolve) => upstream!.listen(0, '127.0.0.1', () => resolve()));
    return `http://127.0.0.1:${(upstream!.address() as AddressInfo).port}/v1`;
  }

  async function start(baseUrl: string, notices: string[], logs: string[]): Promise<void> {
    relay = await startRelay({
      profile: parseProfile(
        { name: 'small', wire: 'openai', baseUrl, model: 'qwen', proxy: { useEnvironment: false } },
        'test',
      ),
      secrets: () => undefined,
      workspaceRoot: process.cwd(),
      log: (m) => logs.push(m),
      onTruncation: (advice) => notices.push(advice),
    });
  }

  async function turn(model: string): Promise<void> {
    const res = await fetch(`${relay!.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${relay!.token}` },
      body: JSON.stringify({
        model,
        stream: true,
        max_tokens: 100,
        // About 30k tokens of system prompt, the size class of Claude Code's.
        system: 'x'.repeat(120_000),
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    await res.text();
  }

  it('notifies once per model and logs every occurrence', async () => {
    const notices: string[] = [];
    const logs: string[] = [];
    await start(await gateway(4096), notices, logs);

    await turn('qwen');
    await turn('qwen');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/processed only 4,096 of about 30,0\d\d prompt tokens/);
    expect(logs.filter((l) => l.includes('processed only'))).toHaveLength(2);

    await turn('other-model');
    expect(notices).toHaveLength(2);
  });

  it('says nothing when the gateway saw the whole prompt', async () => {
    const notices: string[] = [];
    await start(await gateway(31_000), notices, []);
    await turn('qwen');
    expect(notices).toHaveLength(0);
  });
});
