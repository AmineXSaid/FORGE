/**
 * Phase 2 end-to-end: the bridge against a real OpenAI-compatible gateway.
 *
 * Opt-in, because it needs a live endpoint and a credential. Set:
 *
 *   FORGE_E2E_BASE_URL   e.g. http://localhost:20128/v1
 *   FORGE_E2E_API_KEY    the gateway credential
 *   FORGE_E2E_MODEL      optional; defaults to a small tool-capable model
 *
 * Without them the suite skips, so `pnpm test` stays hermetic on a machine with
 * no gateway.
 *
 * What this proves that the unit tests cannot: that a real gateway's actual
 * chunking, its actual tool-call fragmentation and its actual usage reporting
 * survive the translation. The unit tests use fixtures written from the spec;
 * gateways routinely disagree with the spec, and that disagreement is the whole
 * reason the bridge exists.
 *
 * The credential is read from the environment and never written to disk, which
 * is the same rule the profile schema enforces for `auth.value`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startRelay, type RunningRelay } from '../src/services/endpoints/relay';
import { parseProfile } from '../src/services/endpoints/profile';

const BASE_URL = process.env.FORGE_E2E_BASE_URL;
const API_KEY = process.env.FORGE_E2E_API_KEY;
const MODEL = process.env.FORGE_E2E_MODEL ?? 'cfp/qwen/qwen2.5-coder-32b-instruct';

const suite = BASE_URL && API_KEY ? describe : describe.skip;

/** Parse an Anthropic SSE response body into the frames it carries. */
function parseFrames(body: string): any[] {
  return body
    .split(/\r?\n\r?\n/)
    .map((block) => block.split(/\r?\n/).find((l) => l.startsWith('data: ')))
    .filter((l): l is string => Boolean(l))
    .map((l) => JSON.parse(l.slice(6)));
}

suite('the bridge against a live OpenAI-compatible gateway', () => {
  let relay: RunningRelay;

  beforeAll(async () => {
    relay = await startRelay({
      profile: parseProfile(
        {
          name: 'e2e',
          wire: 'openai',
          baseUrl: BASE_URL,
          model: MODEL,
          auth: { kind: 'bearer', value: '${env:FORGE_E2E_API_KEY}' },
          timeoutMs: 120_000,
          capabilities: { tools: true, contextWindow: 128_000, maxOutputTokens: 1024 },
        },
        'e2e',
      ),
      secrets: (key) => process.env[key],
      workspaceRoot: process.cwd(),
      log: () => { },
    });
  }, 60_000);

  afterAll(async () => {
    await relay?.close();
  });

  /** POST an Anthropic request at the relay exactly as the CLI would. */
  async function post(path: string, body: unknown): Promise<{ status: number; text: string }> {
    const res = await fetch(`${relay.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${relay.token}` },
      body: JSON.stringify(body),
    });
    return { status: res.status, text: await res.text() };
  }

  it('answers count_tokens, which the CLI needs and OpenAI has no route for', async () => {
    const { status, text } = await post('/v1/messages/count_tokens', {
      model: MODEL,
      messages: [{ role: 'user', content: 'hello '.repeat(100) }],
    });
    expect(status).toBe(200);
    expect(JSON.parse(text).input_tokens).toBeGreaterThan(50);
  });

  it('completes a non-streamed turn as an Anthropic message', async () => {
    const { status, text } = await post('/v1/messages', {
      model: MODEL,
      max_tokens: 64,
      messages: [{ role: 'user', content: 'Reply with exactly the word: pong' }],
    });
    expect(status).toBe(200);
    const msg = JSON.parse(text);
    expect(msg.type).toBe('message');
    expect(msg.role).toBe('assistant');
    expect(msg.content.some((b: any) => b.type === 'text' && b.text.trim())).toBe(true);
    expect(msg.usage.input_tokens).toBeGreaterThan(0);
  }, 120_000);

  it('streams a turn as Anthropic SSE, ending with message_stop', async () => {
    const { status, text } = await post('/v1/messages', {
      model: MODEL,
      max_tokens: 64,
      stream: true,
      messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
    });
    expect(status).toBe(200);
    const frames = parseFrames(text);
    const types = frames.map((f) => f.type);

    expect(types[0]).toBe('message_start');
    expect(types.at(-1)).toBe('message_stop');
    expect(types).toContain('content_block_start');
    expect(types).toContain('content_block_delta');
    expect(types).toContain('message_delta');

    // Compaction reads these. Zeros here mean a long session eventually dies on
    // a context-overflow 400 instead of compacting.
    const usage = frames.find((f) => f.type === 'message_delta').usage;
    expect(usage.input_tokens).toBeGreaterThan(0);
    expect(usage.output_tokens).toBeGreaterThan(0);
  }, 120_000);

  it('carries a real tool call through as a well-formed tool_use block', async () => {
    // The whole agent loop depends on this one translation.
    const { status, text } = await post('/v1/messages', {
      model: MODEL,
      max_tokens: 256,
      stream: true,
      tools: [{
        name: 'get_weather',
        description: 'Get the current weather in a city.',
        input_schema: {
          type: 'object',
          properties: { city: { type: 'string', description: 'City name' } },
          required: ['city'],
        },
      }],
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: 'What is the weather in Paris? Use the tool.' }],
    });
    expect(status).toBe(200);
    const frames = parseFrames(text);

    const toolStart = frames.find(
      (f) => f.type === 'content_block_start' && f.content_block?.type === 'tool_use',
    );
    expect(toolStart, 'the gateway produced no tool call').toBeDefined();
    expect(toolStart.content_block.name).toBe('get_weather');
    expect(toolStart.content_block.id).toBeTruthy();

    // Reassembled fragments must be parseable JSON, or the CLI cannot run it.
    const json = frames
      .filter((f) => f.type === 'content_block_delta'
        && f.index === toolStart.index
        && f.delta?.type === 'input_json_delta')
      .map((f) => f.delta.partial_json)
      .join('');
    expect(() => JSON.parse(json)).not.toThrow();
    expect(JSON.parse(json)).toHaveProperty('city');

    // And the turn must be reported as wanting a tool, or the loop stops here.
    expect(frames.find((f) => f.type === 'message_delta').delta.stop_reason).toBe('tool_use');
  }, 120_000);

  it('probes the live endpoint and proposes a coherent capability patch', async () => {
    // The probes are the only honest source for the capability block, so this
    // checks they produce an answer rather than checking what the answer is:
    // which capabilities a given gateway has is the gateway's business.
    const { buildTransport } = await import('../src/services/endpoints/transport');
    const { applyAuth } = await import('../src/services/endpoints/auth');
    const { detectCapabilities } = await import('../src/services/endpoints/detect');

    const profile = parseProfile(
      {
        name: 'e2e',
        wire: 'openai',
        baseUrl: BASE_URL,
        model: MODEL,
        auth: { kind: 'bearer', value: '${env:FORGE_E2E_API_KEY}' },
        timeoutMs: 120_000,
      },
      'e2e',
    );
    const built = buildTransport(profile);
    try {
      const auth = await applyAuth(profile, built.dispatcher, (k) => process.env[k]);
      const report = await detectCapabilities({
        profile,
        dispatcher: built.dispatcher,
        headers: { ...(profile.headers ?? {}), ...auth.headers },
      });

      // Every probe reports, whatever the endpoint said: a failure is an
      // answer ("no"), not an error that stops the sweep.
      expect(report.results.map((r) => r.name)).toEqual([
        'streaming', 'tools', 'parallelToolCalls', 'vision', 'reasoning', 'reasoningField', 'effort',
      ]);
      for (const r of report.results) {
        expect(r.detail, `${r.name} produced no detail`).toBeTruthy();
      }

      // The effort verdict must be a decision, not an assumption.
      expect(typeof report.patch.effort).toBe('boolean');
      // eslint-disable-next-line no-console
      console.log('  probed patch:', JSON.stringify(report.patch));
    } finally {
      await built.dispatcher.close().catch(() => { });
    }
  }, 300_000);

  it('passes an upstream failure through with its status intact', async () => {
    // The CLI runs its own backoff off the status, so it must not be rewritten.
    const { status, text } = await post('/v1/messages', {
      model: 'definitely-not-a-real-model-id',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(status).toBeGreaterThanOrEqual(400);
    const err = JSON.parse(text);
    expect(err.type).toBe('error');
    expect(err.error.message).toMatch(/\[e2e\]/);
  }, 120_000);
});
