/**
 * Stopping a reply that repeats itself ("chanting"), Gemini CLI's detector.
 *
 * The important cases are the negatives: ordinary prose, a list of distinct
 * items with a shared prefix, and repetitive code must all stream untouched.
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { RepetitionDetector } from '../src/services/endpoints/wire/repetition';
import { OpenAiToAnthropicStream } from '../src/services/endpoints/wire/fromOpenAI';
import { startRelay, type RunningRelay } from '../src/services/endpoints/relay';
import { parseProfile } from '../src/services/endpoints/profile';

/** Feed text in small deltas, as a stream would; true once flagged. */
function feed(text: string, size = 7): boolean {
  const d = new RepetitionDetector();
  for (let i = 0; i < text.length; i += size) if (d.push(text.slice(i, i + size))) return true;
  return false;
}

const LOOP = 'I will now check the configuration file to see what is wrong with it. ';

describe('RepetitionDetector', () => {
  it('flags the same sentence repeated over and over', () => {
    expect(feed(LOOP.repeat(20))).toBe(true);
  });

  it('flags a short cycle of two sentences', () => {
    expect(feed(('Let me look at the file again. ' + 'The file has the same content as before. ').repeat(15))).toBe(true);
  });

  it('does not flag ordinary prose', () => {
    const prose = Array.from({ length: 60 }, (_, i) =>
      `Step ${i}: the parser reads token ${i * 7} and hands it to stage ${i % 5}. `).join('');
    expect(feed(prose)).toBe(false);
  });

  it('does not flag a list whose items share a prefix', () => {
    const list = Array.from({ length: 40 }, (_, i) => `- Updated the import in src/module${i}/index.ts to use the new path\n`).join('');
    expect(feed(list)).toBe(false);
  });

  it('does not flag repetitive code inside a fence', () => {
    const code = '```ts\n' + 'export const value = computeTheValue(input, options);\n'.repeat(40) + '```\n';
    expect(feed(code, 64)).toBe(false);
  });

  it('does not flag a short repetition', () => {
    expect(feed(LOOP.repeat(3))).toBe(false);
  });
});

describe('the stream stops at the repetition', () => {
  it('ends the text with a note, drops the rest, and says it is repeating', () => {
    const notes: string[] = [];
    const stream = new OpenAiToAnthropicStream({ model: 'm', stopRepetition: true, onRepair: (n) => notes.push(n) });
    const frames: string[] = [];
    for (let i = 0; i < 40; i++) frames.push(...stream.push({ choices: [{ delta: { content: LOOP } }] }));
    frames.push(...stream.end());
    const text = frames
      .map((f) => JSON.parse(f.split('\n').find((l) => l.startsWith('data: '))!.slice(6)))
      .filter((f) => f.delta?.type === 'text_delta').map((f) => f.delta.text).join('');
    expect(stream.repeating).toBe(true);
    expect(text).toMatch(/\[Forge stopped this reply because it kept repeating the same text\.\]$/);
    expect(text.split(LOOP).length - 1).toBeLessThan(20);
    expect(notes).toEqual(['stopped a reply that kept repeating the same text']);
  });

  it('is off unless asked for', () => {
    const stream = new OpenAiToAnthropicStream({ model: 'm' });
    for (let i = 0; i < 40; i++) stream.push({ choices: [{ delta: { content: LOOP } }] });
    expect(stream.repeating).toBe(false);
  });
});

describe('the relay stops reading from the gateway', () => {
  let server: http.Server | undefined;
  let relay: RunningRelay | undefined;
  afterEach(async () => {
    await relay?.close();
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  });

  it('ends the response long before a gateway that would repeat forever', async () => {
    let written = 0;
    server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        // Effectively endless: stops only when the relay hangs up.
        const tick = () => {
          if (res.destroyed || written > 5000) return res.end();
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: LOOP } }] })}\n\n`);
          written++;
          setImmediate(tick);
        };
        tick();
      });
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    relay = await startRelay({
      profile: parseProfile({ name: 'gw', wire: 'openai', baseUrl, model: 'm', proxy: { useEnvironment: false } }, 'test'),
      secrets: () => undefined,
      workspaceRoot: process.cwd(),
      log: () => {},
    });
    const res = await fetch(`${relay.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${relay.token}` },
      body: JSON.stringify({ model: 'm', stream: true, max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }),
    });
    const body = await res.text();
    expect(body).toContain('kept repeating the same text');
    expect(body).toContain('message_stop');
    expect(written).toBeLessThan(5000);
  });
});
