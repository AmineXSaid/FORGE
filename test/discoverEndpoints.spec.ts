/**
 * "Add endpoint" starts from what is already running.
 *
 * The flow asks five questions. For the most common first endpoint -- an
 * Ollama or an LM Studio the user already has open -- four of those answers
 * are knowable: the base URL is a documented default port, the wire is OpenAI,
 * there is no token, and the runtime will name its own models. So the picker
 * offers what answers, and five questions become "which model?".
 */
import { describe, expect, it, vi } from 'vitest';
import {
  LOCAL_RUNTIMES,
  discoverLocalRuntimes,
  suggestProfileName,
  type ModelProbe,
} from '../src/services/endpoints/discover';
import { parseProfile } from '../src/services/endpoints/profile';

/** A probe that answers for the given base URLs and refuses everywhere else. */
function probeFor(answers: Record<string, string[]>): ModelProbe {
  return async (baseUrl) => answers[baseUrl];
}

describe('the runtimes Forge knows', () => {
  it('are all OpenAI-wire, which is what makes an unauthenticated probe possible', () => {
    for (const runtime of LOCAL_RUNTIMES) expect(runtime.wire).toBe('openai');
  });

  it('point at loopback, never at someone else’s machine', () => {
    // A probe that reached off-box would be scanning the network.
    for (const runtime of LOCAL_RUNTIMES) {
      const url = new URL(runtime.baseUrl);
      expect(['localhost', '127.0.0.1']).toContain(url.hostname);
    }
  });

  it('each carry a distinct port, so two cannot be confused', () => {
    const ports = LOCAL_RUNTIMES.map((r) => new URL(r.baseUrl).port);
    expect(new Set(ports).size).toBe(LOCAL_RUNTIMES.length);
  });

  it('each have a unique id and a hint for the picker', () => {
    expect(new Set(LOCAL_RUNTIMES.map((r) => r.id)).size).toBe(LOCAL_RUNTIMES.length);
    for (const runtime of LOCAL_RUNTIMES) {
      expect(runtime.label).toBeTruthy();
      expect(runtime.hint).toBeTruthy();
    }
  });

  it('describe a profile the loader accepts, with no token', () => {
    // A preset that produced an invalid profile would fail later, elsewhere.
    for (const runtime of LOCAL_RUNTIMES) {
      const parsed = parseProfile(
        { name: runtime.id, wire: runtime.wire, baseUrl: runtime.baseUrl, model: 'm', auth: { kind: 'none' } },
        'test',
      );
      expect(parsed.baseUrl).toBe(runtime.baseUrl);
      expect(parsed.auth.kind).toBe('none');
    }
  });
});

describe('discovery', () => {
  it('keeps only the runtimes that answer', async () => {
    const ollama = LOCAL_RUNTIMES.find((r) => r.id === 'ollama')!;
    const found = await discoverLocalRuntimes(probeFor({ [ollama.baseUrl]: ['qwen2.5-coder', 'llama3.2'] }));

    expect(found).toHaveLength(1);
    expect(found[0].runtime.id).toBe('ollama');
    expect(found[0].models).toEqual(['qwen2.5-coder', 'llama3.2']);
  });

  it('finds nothing when nothing is running', async () => {
    expect(await discoverLocalRuntimes(probeFor({}))).toEqual([]);
  });

  it('counts a runtime that answers with an empty list as running', async () => {
    // It is there, it just has no model pulled yet -- which is worth saying,
    // and different from "not detected".
    const ollama = LOCAL_RUNTIMES.find((r) => r.id === 'ollama')!;
    const found = await discoverLocalRuntimes(probeFor({ [ollama.baseUrl]: [] }));
    expect(found).toHaveLength(1);
    expect(found[0].models).toEqual([]);
  });

  it('probes every runtime, and does so concurrently', async () => {
    const seen: string[] = [];
    let live = 0;
    let peak = 0;
    await discoverLocalRuntimes(async (baseUrl) => {
      seen.push(baseUrl);
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      return undefined;
    });

    expect(seen.sort()).toEqual(LOCAL_RUNTIMES.map((r) => r.baseUrl).sort());
    // Sequential would peak at 1, and five refused connections in a row is a
    // visible pause in front of a picker.
    expect(peak).toBe(LOCAL_RUNTIMES.length);
  });

  it('survives a probe that throws', async () => {
    const ollama = LOCAL_RUNTIMES.find((r) => r.id === 'ollama')!;
    const found = await discoverLocalRuntimes(async (baseUrl) => {
      if (baseUrl !== ollama.baseUrl) throw new Error('ECONNREFUSED');
      return ['m'];
    });
    expect(found.map((f) => f.runtime.id)).toEqual(['ollama']);
  });

  it('returns results in a stable order, not in completion order', async () => {
    // Otherwise the picker reshuffles between runs depending on which loopback
    // socket refused first.
    const answer = Object.fromEntries(LOCAL_RUNTIMES.map((r) => [r.baseUrl, ['m']]));
    const slow = new Set([LOCAL_RUNTIMES[0].baseUrl, LOCAL_RUNTIMES[1].baseUrl]);
    const found = await discoverLocalRuntimes(async (baseUrl) => {
      if (slow.has(baseUrl)) await new Promise((r) => setTimeout(r, 10));
      return answer[baseUrl];
    });
    expect(found.map((f) => f.runtime.id)).toEqual(LOCAL_RUNTIMES.map((r) => r.id));
  });
});

describe('the name it suggests', () => {
  it('uses the runtime id when it is free', () => {
    expect(suggestProfileName('ollama', [])).toBe('ollama');
  });

  it('counts up past a collision', () => {
    expect(suggestProfileName('ollama', ['ollama'])).toBe('ollama-2');
    expect(suggestProfileName('ollama', ['ollama', 'ollama-2'])).toBe('ollama-3');
  });

  it('suggests a name the name validator accepts', async () => {
    const { validateProfileName } = await import('../src/services/endpoints/newProfile');
    for (const runtime of LOCAL_RUNTIMES) {
      const taken = [runtime.id];
      const suggested = suggestProfileName(runtime.id, taken);
      expect(validateProfileName(suggested, taken)).toBeUndefined();
    }
  });

  it('gives up on a unique-enough name rather than looping forever', () => {
    const taken = ['x', ...Array.from({ length: 200 }, (_, i) => `x-${i + 2}`)];
    const suggested = suggestProfileName('x', taken);
    expect(taken).not.toContain(suggested);
  });
});
