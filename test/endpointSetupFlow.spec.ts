/**
 * "Add endpoint": an endpoint and its model, set up together (2026-09-23).
 *
 * The user confirmed four failures of the old flow; each path below pins the
 * fix. The UI is a script: each prompt takes the next answer, and records what
 * it was asked, so the order of the questions is asserted, not assumed.
 */
import { describe, expect, it, vi } from 'vitest';
import { chatModelIds, isLoopback, modelItems, runEndpointSetup, type SetupDeps, type SetupUi } from '../src/services/endpoints/setupFlow';
import { parseProfile } from '../src/services/endpoints/profile';
import { LOCAL_RUNTIMES } from '../src/services/endpoints/discover';

const OLLAMA = LOCAL_RUNTIMES.find((r) => r.id === 'ollama')!;

type Answer = string | undefined | ((items: any[]) => any);

function scriptedUi(start: any, answers: Answer[]) {
  const asked: string[] = [];
  const queue = [...answers];
  const next = () => queue.shift();
  const ui: SetupUi = {
    pickStart: async () => start,
    input: async (o) => {
      asked.push(`input:${o.title}`);
      const a = next();
      if (a !== undefined && o.validate) {
        const problem = o.validate(String(a));
        if (problem) throw new Error(`validation failed for ${o.title}: ${problem}`);
      }
      return a as string | undefined;
    },
    pick: async (items, o) => {
      asked.push(`pick:${o.title}`);
      const a = next();
      if (a === undefined) return undefined;
      if (typeof a === 'function') return a(items);
      return items.find((i: any) => i.value === a) ?? items.find((i: any) => String(i.label).includes(String(a)));
    },
    withProgress: async (_t, task) => task(),
  };
  return { ui, asked };
}

function deps(over: Partial<SetupDeps> = {}) {
  const writes: Array<[string, Record<string, unknown>, string]> = [];
  const secrets = new Map<string, string>();
  const selected: Array<[string, string]> = [];
  const d: SetupDeps = {
    profiles: [],
    takenNames: [],
    hasWorkspace: false,
    rawProfile: () => undefined,
    profileTarget: () => 'user',
    storedSecret: (k) => secrets.get(k),
    listModels: vi.fn(async () => ({ models: [{ id: 'qwen3-coder' }, { id: 'nomic-embed-text' }, { id: 'llama3.2' }], listed: 3 })),
    probe: vi.fn(async (_p, ids) => ids.map((id: string) => ({ id, servable: id !== 'dead', ms: id === 'fast' ? 100 : 900 }))),
    check: vi.fn(async () => ({ ok: true, summary: 'All checks passed.' })),
    storeSecret: vi.fn(async (k, v) => { secrets.set(k, v); }),
    deleteSecret: vi.fn(async (k) => { secrets.delete(k); }),
    writeProfile: vi.fn(async (name, value, target) => { writes.push([name, value, target]); }),
    select: vi.fn(async (name, target) => { selected.push([name, target]); }),
    ...over,
  };
  return { d, writes, secrets, selected };
}

describe('a local runtime that is running', () => {
  it('asks only for a name and a model: no URL, no API, no key', async () => {
    const { ui, asked } = scriptedUi({ runtime: OLLAMA, found: { runtime: OLLAMA, models: ['qwen3-coder'] } }, ['ollama', 'qwen3-coder']);
    const { d, writes, selected } = deps();

    expect(await runEndpointSetup(ui, d)).toEqual({ name: 'ollama', model: 'qwen3-coder' });
    expect(asked).toEqual(['input:Add Ollama: name', 'pick:Add endpoint: model']);
    // Its list is its disk: no probe loads every model into memory.
    expect(d.probe).not.toHaveBeenCalled();
    // The chosen pair is checked once, before anything is written.
    expect((d.check as any).mock.calls[0][0].model).toBe('qwen3-coder');
    expect(writes).toEqual([['ollama', { wire: 'openai', baseUrl: OLLAMA.baseUrl, auth: { kind: 'none' }, model: 'qwen3-coder' }, 'user']]);
    // Active at once, not only after a toast.
    expect(selected).toEqual([['ollama', 'user']]);
  });

  it('never offers an embedding model as a chat model', async () => {
    let offered: string[] = [];
    const { ui } = scriptedUi({ runtime: OLLAMA, found: { runtime: OLLAMA, models: [] } }, ['ollama', (items: any[]) => {
      offered = items.map((i) => i.value).filter((v) => typeof v === 'string');
      return items[0];
    }]);
    await runEndpointSetup(ui, deps().d);
    expect(offered).toEqual(['qwen3-coder', 'llama3.2']);
  });
});

describe('a local runtime that was not detected', () => {
  it('offers its default address for editing, so another port works', async () => {
    const { ui, asked } = scriptedUi({ runtime: OLLAMA }, ['ollama', 'http://localhost:11500/v1', 'qwen3-coder']);
    const { d, writes } = deps();
    await runEndpointSetup(ui, d);
    expect(asked).toEqual(['input:Add Ollama: name', 'input:Add Ollama: address', 'pick:Add endpoint: model']);
    expect(writes[0][1].baseUrl).toBe('http://localhost:11500/v1');
    expect(writes[0][1].auth).toEqual({ kind: 'none' });
  });
});

describe('a remote gateway', () => {
  it('asks for the key before the model, lists with it, checks each id, and puts answering ones first', async () => {
    const listModels = vi.fn(async (_p: any, secrets: (k: string) => string | undefined) => {
      // The listing is authenticated with the key being set up.
      expect(secrets('forge.endpoint.gw.token')).toBe('sk-live-123');
      return { models: [{ id: 'dead' }, { id: 'slow' }, { id: 'fast' }, { id: 'text-embedding-3-small' }], listed: 4 };
    });
    let rows: any[] = [];
    const { ui, asked } = scriptedUi({ label: 'gateway' }, [
      'gw', 'https://gw.example/v1', 'openai', 'bearer', 'sk-live-123',
      (items: any[]) => { rows = items; return items[0]; },
      'workspace',
    ]);
    const { d, writes, secrets, selected } = deps({ listModels, hasWorkspace: true });

    expect(await runEndpointSetup(ui, d)).toEqual({ name: 'gw', model: 'fast' });
    expect(asked).toEqual([
      'input:Add endpoint: name',
      'input:Add endpoint: base URL',
      'pick:Add endpoint: API',
      'pick:Add endpoint: key',
      'input:Add endpoint: key',
      'pick:Add endpoint: model',
      'pick:Add endpoint: where to save',
    ]);
    expect((d.probe as any).mock.calls[0][1]).toEqual(['dead', 'slow', 'fast']);
    expect(rows.map((r) => r.value).filter((v) => typeof v === 'string')).toEqual(['fast', 'slow', 'dead']);
    expect(rows[0].description).toBe('answered in 100ms');
    expect(rows[2].description).toContain('did not answer');
    // The key is in the keychain; settings hold a reference.
    expect(secrets.get('forge.endpoint.gw.token')).toBe('sk-live-123');
    expect(writes[0]).toEqual(['gw', {
      wire: 'openai', baseUrl: 'https://gw.example/v1',
      auth: { kind: 'bearer', value: '${secret:forge.endpoint.gw.token}' }, model: 'fast',
    }, 'workspace']);
    expect(selected).toEqual([['gw', 'workspace']]);
  });

  it('suggests x-api-key first for an Anthropic API', async () => {
    let kinds: string[] = [];
    const { ui } = scriptedUi({ label: 'gateway' }, [
      'anthropic', 'https://api.anthropic.com', 'anthropic', (items: any[]) => { kinds = items.map((i) => i.value); return items[0]; },
      'sk-ant-123', 'x-api-key', 'claude-sonnet-5',
    ]);
    const { d, writes } = deps({ listModels: vi.fn(async () => ({ models: [], listed: 0, error: 'The gateway returned 401 for /models.' })) });
    await runEndpointSetup(ui, d);
    expect(kinds[0]).toBe('header');
    expect(writes[0][1].auth).toEqual({ kind: 'header', header: 'x-api-key', value: '${secret:forge.endpoint.anthropic.token}' });
    expect(writes[0][1].model).toBe('claude-sonnet-5');
  });
});

describe('the pair is checked before it is saved', () => {
  it('offers another model when the first does not answer, and saves the one that does', async () => {
    const check = vi.fn(async (p: any) =>
      p.model === 'qwen3-coder' ? { ok: false, summary: 'HTTP failed: 404 model not found', fix: 'Pull the model first.' } : { ok: true, summary: 'ok' });
    const { ui, asked } = scriptedUi({ runtime: OLLAMA, found: { runtime: OLLAMA, models: [] } }, ['ollama', 'qwen3-coder', 'model', 'llama3.2']);
    const { d, writes } = deps({ check });
    expect(await runEndpointSetup(ui, d)).toEqual({ name: 'ollama', model: 'llama3.2' });
    expect(asked).toContain('pick:qwen3-coder did not answer');
    expect(writes[0][1].model).toBe('llama3.2');
  });

  it('writes nothing when cancelled after a failed check', async () => {
    const { ui } = scriptedUi({ runtime: OLLAMA, found: { runtime: OLLAMA, models: [] } }, ['ollama', 'qwen3-coder', 'cancel']);
    const { d, writes, selected } = deps({ check: vi.fn(async () => ({ ok: false, summary: 'no' })) });
    expect(await runEndpointSetup(ui, d)).toBeUndefined();
    expect(writes).toEqual([]);
    expect(selected).toEqual([]);
  });

  it('lets the user type the id when the endpoint cannot list', async () => {
    const { ui, asked } = scriptedUi({ runtime: OLLAMA, found: { runtime: OLLAMA, models: [] } }, ['ollama', 'my-model']);
    const { d, writes } = deps({ listModels: vi.fn(async () => ({ models: [], listed: 0, error: 'connect ECONNREFUSED' })) });
    await runEndpointSetup(ui, d);
    expect(asked).toEqual(['input:Add Ollama: name', 'input:Add endpoint: model id']);
    expect(writes[0][1].model).toBe('my-model');
  });
});

describe('a failed save leaves nothing behind', () => {
  it('takes the stored key back when the profile cannot be written', async () => {
    const { ui } = scriptedUi({ label: 'gateway' }, ['gw', 'https://gw.example/v1', 'openai', 'bearer', 'sk-1', 'fast']);
    const { d, secrets, selected } = deps({
      writeProfile: vi.fn(async () => { throw new Error('settings.json is read-only'); }),
      listModels: vi.fn(async () => ({ models: [{ id: 'fast' }], listed: 1 })),
    });
    await expect(runEndpointSetup(ui, d)).rejects.toThrow('read-only');
    expect(d.deleteSecret).toHaveBeenCalledWith('forge.endpoint.gw.token');
    expect(secrets.size).toBe(0);
    expect(selected).toEqual([]);
  });

  it('writes nothing when cancelled at any question', async () => {
    for (let stop = 0; stop < 5; stop++) {
      const answers: Answer[] = ['gw', 'https://gw.example/v1', 'openai', 'bearer', 'sk-1', 'fast'];
      answers[stop] = undefined;
      const { ui } = scriptedUi({ label: 'gateway' }, answers);
      const { d, writes, secrets } = deps();
      expect(await runEndpointSetup(ui, d)).toBeUndefined();
      expect(writes).toEqual([]);
      expect(secrets.size).toBe(0);
    }
  });

  it('refuses a name already in use, including one whose entry failed to parse', async () => {
    const { ui } = scriptedUi({ label: 'gateway' }, ['broken-one']);
    await expect(runEndpointSetup(ui, deps({ takenNames: ['broken-one'] }).d)).rejects.toThrow('already exists');
  });
});

describe('another model from an endpoint that already works', () => {
  const GW = parseProfile({ name: 'gw', wire: 'openai', baseUrl: 'https://gw.example/v1', model: 'fast', auth: { kind: 'bearer', value: '${secret:forge.endpoint.gw.token}' } }, 'test');

  it('copies the address and the key reference, asks only for the model and a name, and saves beside it', async () => {
    const { ui, asked } = scriptedUi({ from: GW }, ['slow', 'gw-slow']);
    const { d, writes, selected } = deps({
      profiles: [GW],
      takenNames: ['gw'],
      rawProfile: () => ({ wire: 'openai', baseUrl: 'https://gw.example/v1', model: 'fast', auth: { kind: 'bearer', value: '${secret:forge.endpoint.gw.token}' } }),
      profileTarget: () => 'workspace',
      listModels: vi.fn(async () => ({ models: [{ id: 'fast' }, { id: 'slow' }], listed: 2 })),
    });
    expect(await runEndpointSetup(ui, d)).toEqual({ name: 'gw-slow', model: 'slow' });
    expect(asked).toEqual(['pick:Another model from gw', 'input:Another model: name']);
    expect(d.storeSecret).not.toHaveBeenCalled();
    expect(writes).toEqual([['gw-slow', {
      wire: 'openai', baseUrl: 'https://gw.example/v1', model: 'slow',
      auth: { kind: 'bearer', value: '${secret:forge.endpoint.gw.token}' },
    }, 'workspace']]);
    expect(selected).toEqual([['gw-slow', 'workspace']]);
  });
});

describe('the helpers', () => {
  it('keeps chat models and drops the rest', () => {
    expect(chatModelIds(['llama3.2', 'nomic-embed-text', 'text-embedding-3-large', 'bge-m3', 'whisper-1', 'gpt-4o', 'qwen3-coder:30b', 'jina-reranker-v2']))
      .toEqual(['llama3.2', 'gpt-4o', 'qwen3-coder:30b']);
  });

  it('knows a server on this machine', () => {
    for (const u of ['http://localhost:11434/v1', 'http://127.0.0.1:1234/v1', 'http://[::1]:8000/v1']) expect(isLoopback(u)).toBe(true);
    for (const u of ['https://gw.example/v1', 'http://10.0.0.5:8000/v1', 'not a url']) expect(isLoopback(u)).toBe(false);
  });

  it('always ends the model list with a way to type an id', () => {
    const items = modelItems(['a'], undefined);
    expect(items.at(-1)?.label).toContain('Type a model id');
  });
});
