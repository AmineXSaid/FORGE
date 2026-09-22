/**
 * Phase 5: the model list and capability-driven gating.
 *
 * `Session.ts` already derives every gate from `currentModelInfo`, which comes
 * from `sdk_probe {capabilities:["supportedModels"]}`. The gating mechanism
 * therefore needs no change — only a different source when Forge is pointed at
 * someone else's gateway, where the CLI's built-in table describes Anthropic
 * tiers that are not being served.
 *
 * The rule these tests exist for is the **intersection**: a model entry is a
 * claim, the capability block is evidence, and evidence wins. A model saying
 * `supportsEffort: true` against an endpoint whose probes found the gateway
 * ignores `reasoning_effort` must stay greyed out — otherwise the user gets
 * four rungs that all produce the same answer, which is the exact failure
 * step 38 measured on a live gateway.
 */
import { describe, expect, it } from 'vitest';
import { contextWindowFor, profileModelRows } from '../src/services/endpoints/models';
import { parseProfile, type EndpointProfile } from '../src/services/endpoints/profile';
import pkg from '../package.json';

function profile(overrides: Record<string, unknown> = {}): EndpointProfile {
  return parseProfile(
    { name: 'gw', wire: 'openai', baseUrl: 'https://gw/v1', model: 'llama-3.3-70b', ...overrides },
    'test',
  );
}

describe('profileModelRows: real model names, not Claude tiers', () => {
  it('falls back to the single model the profile names', () => {
    const rows = profileModelRows(profile());
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe('llama-3.3-70b');
    expect(rows[0].displayName).toBe('llama-3.3-70b');
  });

  it('uses the SDK ModelInfo field names, so Session.ts cannot tell the difference', () => {
    const [row] = profileModelRows(profile());
    // sdk.d.ts:1313 — value / displayName / description, not id / name / detail.
    expect(Object.keys(row).sort()).toEqual(
      ['description', 'displayName', 'supportedEffortLevels', 'supportsAutoMode', 'supportsEffort', 'supportsFastMode', 'value'].sort(),
    );
  });

  it('lists every declared model', () => {
    const rows = profileModelRows(profile({
      models: [{ id: 'qwen2.5-coder-32b' }, { id: 'llama-3.3-70b' }],
    }));
    expect(rows.map((r) => r.value)).toEqual(['qwen2.5-coder-32b', 'llama-3.3-70b']);
  });

  it('prefers an explicit display name and description', () => {
    const [row] = profileModelRows(profile({
      models: [{ id: 'x', displayName: 'Qwen Coder', description: 'Fast local coder' }],
    }));
    expect(row.displayName).toBe('Qwen Coder');
    expect(row.description).toBe('Fast local coder');
  });

  it('builds a useful description from the profile when none is given', () => {
    const [row] = profileModelRows(profile({
      description: 'Company gateway',
      models: [{ id: 'x', contextWindow: 131072 }],
    }));
    expect(row.description).toMatch(/Company gateway/);
    expect(row.description).toMatch(/131,072 token context/);
  });

  it('marks an unavailable model so the picker greys it rather than hiding it', () => {
    const [row] = profileModelRows(profile({ models: [{ id: 'x', unavailable: true }] }));
    expect(row.unavailable).toBe(true);
  });

  it('reports auto mode as false rather than leaving it unknown', () => {
    // Session.ts treats undefined as "unknown" and keeps the row waiting, so an
    // Anthropic-side routing feature with no gateway equivalent must say no.
    expect(profileModelRows(profile())[0].supportsAutoMode).toBe(false);
  });
});

describe('the intersection rule: a claim loses to evidence', () => {
  it('greys effort when the model claims it but the endpoint ignores it', () => {
    // The live-gateway case from step 38: reasoning_effort accepted, ignored.
    const [row] = profileModelRows(profile({
      capabilities: { effort: false },
      models: [{ id: 'x', supportsEffort: true }],
    }));
    expect(row.supportsEffort).toBe(false);
    expect(row.supportedEffortLevels).toEqual([]);
  });

  it('does not grow effort on a model that has none, however capable the endpoint', () => {
    const [row] = profileModelRows(profile({
      capabilities: { effort: true, effortLevels: ['low', 'high'] },
      models: [{ id: 'x', supportsEffort: false }],
    }));
    expect(row.supportsEffort).toBe(false);
  });

  it('allows effort only when both agree', () => {
    const [row] = profileModelRows(profile({
      capabilities: { effort: true, effortLevels: ['low', 'medium', 'high'] },
      models: [{ id: 'x', supportsEffort: true }],
    }));
    expect(row.supportsEffort).toBe(true);
    expect(row.supportedEffortLevels).toEqual(['low', 'medium', 'high']);
  });

  it('lets a model inherit endpoint-wide effort support when it says nothing', () => {
    const [row] = profileModelRows(profile({
      capabilities: { effort: true, effortLevels: ['low', 'high'] },
      models: [{ id: 'x' }],
    }));
    expect(row.supportsEffort).toBe(true);
  });

  describe('effort levels intersect too, which decides Ultracode', () => {
    it('drops xhigh when the endpoint does not honour it', () => {
      // isUltracodeAvailable reads supportedEffortLevels, so a model claiming
      // xhigh against an endpoint that stops at high must not offer Ultracode.
      const [row] = profileModelRows(profile({
        capabilities: { effort: true, effortLevels: ['low', 'medium', 'high'] },
        models: [{ id: 'x', supportsEffort: true, supportedEffortLevels: ['low', 'high', 'xhigh'] }],
      }));
      expect(row.supportedEffortLevels).not.toContain('xhigh');
      expect(row.supportedEffortLevels).toEqual(['low', 'high']);
    });

    it('keeps xhigh when both sides list it', () => {
      const [row] = profileModelRows(profile({
        capabilities: { effort: true, effortLevels: ['low', 'high', 'xhigh'] },
        models: [{ id: 'x', supportsEffort: true, supportedEffortLevels: ['low', 'high', 'xhigh'] }],
      }));
      expect(row.supportedEffortLevels).toContain('xhigh');
    });

    it('narrows to the model when the model is the stricter side', () => {
      const [row] = profileModelRows(profile({
        capabilities: { effort: true, effortLevels: ['low', 'medium', 'high', 'xhigh'] },
        models: [{ id: 'x', supportsEffort: true, supportedEffortLevels: ['low'] }],
      }));
      expect(row.supportedEffortLevels).toEqual(['low']);
    });
  });

  describe('fast mode', () => {
    it('is off unless both the endpoint and the model offer it', () => {
      const off = profileModelRows(profile({
        capabilities: { fastMode: false },
        models: [{ id: 'x', supportsFastMode: true }],
      }));
      expect(off[0].supportsFastMode).toBe(false);

      const on = profileModelRows(profile({
        capabilities: { fastMode: true },
        models: [{ id: 'x', supportsFastMode: true }],
      }));
      expect(on[0].supportsFastMode).toBe(true);
    });

    it('is off by default, because a single self-hosted model has no second tier', () => {
      expect(profileModelRows(profile())[0].supportsFastMode).toBe(false);
    });
  });
});

describe('contextWindowFor', () => {
  it('prefers the per-model window', () => {
    expect(contextWindowFor(profile({ models: [{ id: 'x', contextWindow: 200_000 }] }), 'x'))
      .toBe(200_000);
  });

  it('falls back to the endpoint-wide capability', () => {
    expect(contextWindowFor(profile({ capabilities: { contextWindow: 128_000 } }), 'x'))
      .toBe(128_000);
  });

  it('falls back for an unknown model id', () => {
    expect(contextWindowFor(profile({ models: [{ id: 'a', contextWindow: 9 }] }), 'other'))
      .toBe(32000);
  });
});

describe('package.json declares the models block', () => {
  const profileSchema = (pkg as any).contributes.configuration.properties['forge.endpoints'].additionalProperties;

  it('requires only an id per entry', () => {
    expect(profileSchema.properties.models.items.required).toEqual(['id']);
  });

  it('offers exactly the fields the mapper reads', () => {
    expect(Object.keys(profileSchema.properties.models.items.properties).sort()).toEqual([
      'contextWindow', 'description', 'displayName', 'id',
      'supportedEffortLevels', 'supportsEffort', 'supportsFastMode', 'unavailable',
    ]);
  });

  it('keeps the effort rungs aligned with the capability block', () => {
    const modelLevels = profileSchema.properties.models.items.properties.supportedEffortLevels.items.enum;
    const capLevels = profileSchema.properties.capabilities.properties.effortLevels.items.enum;
    expect(modelLevels).toEqual(capLevels);
  });
});
