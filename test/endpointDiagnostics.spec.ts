/**
 * Phase 4: the diagnostics ladder and the capability probes.
 *
 * Run against a real loopback HTTP server rather than a mocked dispatcher. The
 * probes exist to tell the truth about a gateway's actual behaviour, and a mock
 * that returns whatever the test wants would only prove the assertions agree
 * with themselves. A fake gateway that genuinely streams, genuinely 400s on an
 * image, and genuinely ignores `reasoning_effort` exercises the thing being
 * claimed.
 *
 * The effort probe is the one that matters most. Measured against a live
 * gateway, the same prompt at low and high produced 142 and 143 reasoning
 * tokens: the endpoint accepts the field and ignores it. A profile that
 * believed the field worked would offer four rungs that all produce the same
 * answer, so "accepts it" must not be mistaken for "honours it".
 */
import * as http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent } from 'undici';
import { detectCapabilities } from '../src/services/endpoints/detect';
import { inspectorIn, summarise, type Rung } from '../src/services/diagnostics/ladder';
import { parseProfile, type EndpointProfile } from '../src/services/endpoints/profile';

/** What the fake gateway should do for a given request. */
interface GatewayBehaviour {
  /** Reasoning tokens to report, as a function of the reasoning_effort sent. */
  reasoningTokensFor?: (effort: string | undefined) => number;
  /** Emit reasoning deltas on this field. */
  reasoningField?: 'reasoning_content' | 'reasoning';
  /** Answer tool requests with this many tool calls. */
  toolCalls?: number;
  /** Reject image content with a 400, as a gateway without vision does. */
  rejectImages?: boolean;
  /** Send the whole answer in one frame instead of streaming it. */
  bufferWholeAnswer?: boolean;
  /** Answer a tool request with this text instead of a tool call, as an unparsed server does. */
  textToolCall?: string;
}

interface FakeGateway {
  baseUrl: string;
  requests: any[];
  close(): Promise<void>;
}

async function startGateway(behaviour: GatewayBehaviour = {}): Promise<FakeGateway> {
  const requests: any[] = [];

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    requests.push(body);

    const hasImage = JSON.stringify(body.messages ?? []).includes('image_url');
    if (hasImage && behaviour.rejectImages) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'this model does not accept images' } }));
      return;
    }

    const reasoningTokens = behaviour.reasoningTokensFor?.(body.reasoning_effort);
    const usage = {
      prompt_tokens: 20,
      completion_tokens: 30,
      total_tokens: 50,
      ...(reasoningTokens === undefined ? {} : { completion_tokens_details: { reasoning_tokens: reasoningTokens } }),
    };

    const toolCalls = Array.from({ length: behaviour.toolCalls ?? 0 }, (_, i) => ({
      index: i,
      id: `call_${i}`,
      type: 'function',
      function: { name: i === 0 ? 'ping' : 'pong', arguments: '{"value":1}' },
    }));

    if (behaviour.textToolCall && body.tools?.length) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content: behaviour.textToolCall }, finish_reason: 'stop' }],
        usage,
      }));
      return;
    }

    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-x',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: toolCalls.length ? null : 'ok',
            ...(toolCalls.length ? { tool_calls: toolCalls.map(({ index, ...t }) => t) } : {}),
          },
          finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
        }],
        usage,
      }));
      return;
    }

    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);

    if (behaviour.reasoningField) {
      send({ choices: [{ delta: { [behaviour.reasoningField]: 'thinking about it' } }] });
    }
    if (toolCalls.length) {
      send({ choices: [{ delta: { tool_calls: toolCalls } }] });
    } else if (behaviour.bufferWholeAnswer) {
      send({ choices: [{ delta: { content: 'one two three four five six seven eight' } }] });
    } else {
      for (const word of ['one ', 'two ', 'three ', 'four ']) {
        send({ choices: [{ delta: { content: word } }] });
      }
    }
    send({ choices: [{ delta: {}, finish_reason: toolCalls.length ? 'tool_calls' : 'stop' }] });
    send({ choices: [], usage });
    res.write('data: [DONE]\n\n');
    res.end();
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as any).port));
  });

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}

let gateway: FakeGateway | undefined;
afterEach(async () => {
  await gateway?.close();
  gateway = undefined;
});

function profileFor(baseUrl: string, overrides: Record<string, unknown> = {}): EndpointProfile {
  return parseProfile(
    { name: 'fake', wire: 'openai', baseUrl, model: 'test-model', timeoutMs: 10_000, ...overrides },
    'test',
  );
}

async function probe(behaviour: GatewayBehaviour, overrides: Record<string, unknown> = {}) {
  gateway = await startGateway(behaviour);
  const dispatcher = new Agent();
  try {
    return await detectCapabilities({
      profile: profileFor(gateway.baseUrl, overrides),
      dispatcher,
      headers: {},
    });
  } finally {
    await dispatcher.close();
  }
}

const resultFor = (report: Awaited<ReturnType<typeof probe>>, name: string) =>
  report.results.find((r) => r.name === name)!;

describe('detectCapabilities: streaming', () => {
  it('reports streaming when several incremental chunks arrive', async () => {
    const report = await probe({});
    expect(resultFor(report, 'streaming').supported).toBe(true);
    expect(report.patch.streaming).toBe(true);
  });

  it('reports no streaming when the whole answer arrives in one frame', async () => {
    // A gateway that buffers is not streaming however it answers: the
    // typewriter would sit still until the end.
    const report = await probe({ bufferWholeAnswer: true });
    expect(resultFor(report, 'streaming').supported).toBe(false);
    expect(resultFor(report, 'streaming').detail).toMatch(/one frame/);
  });
});

describe('detectCapabilities: tools', () => {
  it('reports tools when the model actually calls one', async () => {
    const report = await probe({ toolCalls: 1 });
    expect(resultFor(report, 'tools').supported).toBe(true);
    expect(resultFor(report, 'tools').detail).toMatch(/invoked "ping"/);
  });

  it('accepting the field is not support', async () => {
    // The gateway takes `tools` happily and answers in text. A model that does
    // this in a probe does it in a real turn too.
    const report = await probe({ toolCalls: 0 });
    expect(resultFor(report, 'tools').supported).toBe(false);
    expect(resultFor(report, 'tools').detail).toMatch(/answered in text/);
    expect(report.patch.tools).toBe(false);
  });

  it('keeps tools on, and names the server flag, when the model writes its call as text', async () => {
    // The server is not parsing tool calls (vLLM without --tool-call-parser,
    // llama.cpp without --jinja): the call arrives as Hermes text. The relay
    // recovers it, so tools work -- but the fix belongs on the server.
    const report = await probe({ textToolCall: '<tool_call>\n{"name": "ping", "arguments": {"value": 1}}\n</tool_call>' });
    const tools = resultFor(report, 'tools');
    expect(tools.supported).toBe(true);
    expect(tools.detail).toMatch(/wrote the call as text \(Hermes\/Qwen <tool_call>\)/);
    expect(tools.detail).toMatch(/--tool-call-parser hermes/);
    expect(tools.detail).toMatch(/llama\.cpp: --jinja/);
    expect(report.patch.tools).toBe(true);
  });

  it('still says "answered in text" when the text is not a call to the tool', async () => {
    const report = await probe({ textToolCall: 'I would call ping here, but I will not.' });
    expect(resultFor(report, 'tools').detail).toMatch(/answered in text/);
    expect(report.patch.tools).toBe(false);
  });

  it('skips the parallel probe when tools do not work at all', async () => {
    const report = await probe({ toolCalls: 0 });
    const parallel = resultFor(report, 'parallelToolCalls');
    expect(parallel.supported).toBeUndefined();
    expect(parallel.detail).toMatch(/Not probed/);
  });

  it('reports parallel tool calls when two arrive in one turn', async () => {
    const report = await probe({ toolCalls: 2 });
    expect(resultFor(report, 'parallelToolCalls').supported).toBe(true);
    expect(report.patch.parallelToolCalls).toBe(true);
  });

  it('reports no parallel calls when only one arrives', async () => {
    const report = await probe({ toolCalls: 1 });
    expect(resultFor(report, 'parallelToolCalls').supported).toBe(false);
  });

  it('probes tools even when the profile declares them off', async () => {
    // The probe answers a question the profile is the wrong source for. A
    // capability set to false must not filter its own probe.
    const report = await probe({ toolCalls: 1 }, { capabilities: { tools: false } });
    expect(resultFor(report, 'tools').supported).toBe(true);
  });
});

describe('detectCapabilities: vision', () => {
  it('reports no vision when the gateway 400s on an image', async () => {
    const report = await probe({ rejectImages: true });
    expect(resultFor(report, 'vision').supported).toBe(false);
    expect(report.patch.vision).toBe(false);
  });

  it('reports vision when an image block completes', async () => {
    const report = await probe({});
    expect(resultFor(report, 'vision').supported).toBe(true);
    expect(report.patch.vision).toBe(true);
  });

  it('sends the image even when the profile declares vision off', async () => {
    gateway = await startGateway({ rejectImages: false });
    const dispatcher = new Agent();
    try {
      await detectCapabilities({
        profile: profileFor(gateway.baseUrl, { capabilities: { vision: false } }),
        dispatcher,
        headers: {},
      });
      expect(JSON.stringify(gateway.requests)).toMatch(/image_url/);
    } finally {
      await dispatcher.close();
    }
  });
});

describe('detectCapabilities: which field carries reasoning', () => {
  it.each(['reasoning_content', 'reasoning'] as const)('detects %s', async (field) => {
    const report = await probe({ reasoningField: field });
    expect(resultFor(report, 'reasoning').supported).toBe(true);
    expect(resultFor(report, 'reasoningField').detail).toMatch(field);
    expect(report.patch.reasoningField).toBe(field);
  });

  it('reports none when nothing arrives on a reasoning channel', async () => {
    const report = await probe({});
    expect(resultFor(report, 'reasoning').supported).toBe(false);
    expect(report.patch.reasoningField).toBe('none');
  });
});

describe('detectCapabilities: effort, the probe that keeps the UI honest', () => {
  it('reports support when more effort buys more thinking', async () => {
    const report = await probe({
      reasoningTokensFor: (effort) => (effort === 'high' ? 900 : 100),
    });
    expect(resultFor(report, 'effort').supported).toBe(true);
    expect(report.patch.effort).toBe(true);
    expect(report.patch.effortLevels).toEqual(['low', 'medium', 'high']);
  });

  it('reports no support when the field is accepted and ignored', async () => {
    // The live-gateway case: 142 reasoning tokens at low, 143 at high.
    const report = await probe({ reasoningTokensFor: (e) => (e === 'high' ? 143 : 142) });
    const effort = resultFor(report, 'effort');
    expect(effort.supported).toBe(false);
    expect(effort.detail).toMatch(/accepts reasoning_effort and ignores it/);
    expect(report.patch.effort).toBe(false);
  });

  it('does not claim xhigh from evidence about high', async () => {
    // effortLevels decides whether Ultracode is offered. Inventing a rung the
    // probe never measured would be inventing that decision.
    const report = await probe({ reasoningTokensFor: (e) => (e === 'high' ? 900 : 100) });
    expect(report.patch.effortLevels).not.toContain('xhigh');
  });

  it('actually varies reasoning_effort between the two runs', async () => {
    gateway = await startGateway({ reasoningTokensFor: () => 100 });
    const dispatcher = new Agent();
    try {
      await detectCapabilities({
        profile: profileFor(gateway.baseUrl),
        dispatcher,
        headers: {},
      });
      const efforts = gateway.requests
        .map((r) => r.reasoning_effort)
        .filter(Boolean);
      expect(efforts).toContain('low');
      expect(efforts).toContain('high');
    } finally {
      await dispatcher.close();
    }
  });

  it('falls back to output tokens when the gateway reports no reasoning tokens', async () => {
    const report = await probe({});
    expect(resultFor(report, 'effort').detail).toMatch(/output tokens/);
  });
});

describe('detectCapabilities: a failure is an answer, not an error', () => {
  it('finishes the whole sweep when one capability is missing', async () => {
    const report = await probe({ rejectImages: true, toolCalls: 0 });
    // Every probe still reported, despite two of them answering "no".
    expect(report.results.map((r) => r.name)).toEqual([
      'streaming', 'tools', 'parallelToolCalls', 'vision', 'reasoning', 'reasoningField', 'effort',
    ]);
  });

  it('reports every probe against an endpoint that is simply not there', async () => {
    const dispatcher = new Agent();
    try {
      const report = await detectCapabilities({
        profile: profileFor('http://127.0.0.1:1/v1', { timeoutMs: 2_000, retries: 0 }),
        dispatcher,
        headers: {},
      });
      expect(report.results.length).toBeGreaterThanOrEqual(6);
      expect(report.patch.streaming).toBe(false);
      expect(report.patch.tools).toBe(false);
    } finally {
      await dispatcher.close();
    }
  }, 30_000);
});

describe('inspectorIn: naming the TLS interceptor is a diagnosis', () => {
  it.each([
    ['Zscaler Inc.', 'Zscaler'],
    ['Kaspersky Lab', 'Kaspersky'],
    ['Fortinet', 'FortiGate'],
    ['mitmproxy', 'a local debugging proxy'],
  ])('recognises %s', (issuer, label) => {
    expect(inspectorIn([issuer])).toBe(label);
  });

  it('says nothing about an ordinary public CA', () => {
    expect(inspectorIn(["Let's Encrypt", 'DigiCert Inc'])).toBeUndefined();
  });
});

describe('summarise: the one sentence a banner shows', () => {
  const rung = (over: Partial<Rung>): Rung => ({ name: 'X', status: 'pass', detail: 'd', ms: 1, ...over });

  it('reports the first failure, which is the real one', () => {
    const out = summarise([
      rung({ name: 'DNS', status: 'pass' }),
      rung({ name: 'TCP', status: 'fail', detail: 'refused' }),
      rung({ name: 'Completion', status: 'fail', detail: 'no answer' }),
    ]);
    expect(out.ok).toBe(false);
    expect(out.summary).toMatch(/TCP failed: refused/);
  });

  it('reports warnings when nothing failed', () => {
    const out = summarise([rung({ status: 'warn', detail: 'a proxy is re-signing' })]);
    expect(out.ok).toBe(true);
    expect(out.summary).toMatch(/1 warning/);
  });

  it('says so plainly when everything passed', () => {
    expect(summarise([rung({}), rung({})])).toEqual({ ok: true, summary: 'All checks passed.' });
  });
});
