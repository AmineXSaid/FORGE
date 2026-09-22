/**
 * Phase 3: effort, thinking and caching across the bridge.
 *
 * The rule under test throughout is B7 -- behaviour, not labels. A control that
 * changes its label but not the model's behaviour is broken, so what matters
 * here is what actually reaches the wire: which rung, spelled how, and omitted
 * entirely when the endpoint cannot honour it.
 *
 * The downgrade direction is the subtle part and gets its own tests. Dropping
 * an unsupported rung would silently fall back to the endpoint's default, which
 * is usually weaker than every rung the user could have chosen -- so asking for
 * `xhigh` on a gateway that stops at `high` would produce *less* reasoning than
 * asking for `medium`. That is the wrong way round, and it would be invisible.
 */
import { describe, expect, it } from 'vitest';
import {
  EFFORT_LADDER,
  effortForBudget,
  reasoningFor,
  resolveEffort,
} from '../src/services/endpoints/wire/reasoning';
import {
  keepsCacheControl,
  prefixStabilityWarnings,
  stripCacheControl,
} from '../src/services/endpoints/wire/caching';
import { toOpenAI } from '../src/services/endpoints/wire/toOpenAI';
import { parseProfile, type Capabilities, type EndpointProfile } from '../src/services/endpoints/profile';

function profile(overrides: Record<string, unknown> = {}): EndpointProfile {
  return parseProfile(
    { name: 'gw', wire: 'openai', baseUrl: 'https://gw/v1', model: 'm', ...overrides },
    'test',
  );
}

function caps(overrides: Partial<Capabilities> = {}): Capabilities {
  return profile({ capabilities: overrides }).capabilities;
}

describe('resolveEffort: an unsupported rung downgrades, never disappears', () => {
  it('passes a supported rung through untouched', () => {
    expect(resolveEffort('high', ['low', 'medium', 'high'])).toBe('high');
  });

  it('downgrades to the strongest rung below what was asked for', () => {
    // xhigh on a gateway that stops at high must give high, not the default.
    expect(resolveEffort('xhigh', ['low', 'medium', 'high'])).toBe('high');
    expect(resolveEffort('max', ['low', 'medium'])).toBe('medium');
  });

  it('never downgrades below a weaker rung that is offered', () => {
    expect(resolveEffort('high', ['low', 'medium'])).toBe('medium');
    expect(resolveEffort('high', ['low'])).toBe('low');
  });

  it('takes the weakest offered rung when everything is stronger', () => {
    expect(resolveEffort('minimal', ['high', 'xhigh'])).toBe('high');
  });

  it('omits an unrecognised name rather than guessing', () => {
    expect(resolveEffort('turbo', ['low', 'high'])).toBeUndefined();
  });

  it('omits when the endpoint lists no levels at all', () => {
    expect(resolveEffort('high', [])).toBeUndefined();
  });

  it('orders the ladder weakest-first, which is what makes downgrade mean anything', () => {
    expect(EFFORT_LADDER.indexOf('low')).toBeLessThan(EFFORT_LADDER.indexOf('high'));
    expect(EFFORT_LADDER.indexOf('high')).toBeLessThan(EFFORT_LADDER.indexOf('xhigh'));
    expect(EFFORT_LADDER.indexOf('xhigh')).toBeLessThan(EFFORT_LADDER.indexOf('max'));
  });
});

describe('effortForBudget: a thinking budget expressed as the nearest rung', () => {
  it.each([
    [2_000, 'low'],
    [8_000, 'medium'],
    [24_000, 'high'],
    [64_000, 'xhigh'],
  ])('maps a %s-token budget to %s', (budget, expected) => {
    expect(effortForBudget(budget)).toBe(expected);
  });

  it('rises monotonically, so more budget never means less effort', () => {
    const budgets = [1, 4_096, 16_384, 32_768, 100_000];
    const ranks = budgets.map((b) => EFFORT_LADDER.indexOf(effortForBudget(b)));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe('reasoningFor: what actually reaches the wire', () => {
  it('sends nothing when the endpoint declares no effort support', () => {
    // Sending the field anyway is a 400 on some gateways and a no-op on the
    // rest; the UI hides the rows to match.
    expect(reasoningFor('high', undefined, caps({ effort: false })).effort).toBeUndefined();
  });

  it('renames effort to the OpenAI spelling when supported', () => {
    const r = reasoningFor('high', undefined, caps({ effort: true, effortLevels: ['low', 'medium', 'high'] }));
    expect(r.effort).toBe('high');
    expect(r.warnings).toEqual([]);
  });

  it('explains a downgrade rather than making it silently', () => {
    const r = reasoningFor('xhigh', undefined, caps({ effort: true, effortLevels: ['low', 'high'] }));
    expect(r.effort).toBe('high');
    expect(r.warnings.join()).toMatch(/not in capabilities.effortLevels/);
  });

  it('derives a rung from a thinking budget when no effort was named', () => {
    const r = reasoningFor(
      undefined,
      { type: 'enabled', budget_tokens: 24_000 },
      caps({ effort: true, effortLevels: ['low', 'medium', 'high'] }),
    );
    expect(r.effort).toBe('high');
  });

  it('lets an explicit effort win over the thinking budget', () => {
    // Effort and thinking are separate controls; the named rung is the direct
    // instruction and the budget is only a fallback reading of intent.
    const r = reasoningFor(
      'low',
      { type: 'enabled', budget_tokens: 64_000 },
      caps({ effort: true, effortLevels: ['low', 'medium', 'high'] }),
    );
    expect(r.effort).toBe('low');
  });

  it('treats thinking: disabled as an instruction, not an absence', () => {
    const r = reasoningFor(
      undefined,
      { type: 'disabled' },
      caps({ effort: true, effortLevels: ['low', 'medium', 'high'] }),
    );
    expect(r.effort).toBe('low');
  });

  it('prefers minimal for disabled thinking when the endpoint offers it', () => {
    const r = reasoningFor(
      undefined,
      { type: 'disabled' },
      caps({ effort: true, effortLevels: ['minimal', 'low', 'high'] }),
    );
    expect(r.effort).toBe('minimal');
  });

  it('accepts an integer budget in the effort field', () => {
    const r = reasoningFor(2_000, undefined, caps({ effort: true, effortLevels: ['low', 'high'] }));
    expect(r.effort).toBe('low');
  });

  it('sends nothing when neither effort nor thinking was specified', () => {
    expect(reasoningFor(undefined, undefined, caps({ effort: true })).effort).toBeUndefined();
  });

  describe('Ultracode needs nothing beyond the rung existing', () => {
    it('sends xhigh when the endpoint lists it', () => {
      const r = reasoningFor('xhigh', undefined, caps({ effort: true, effortLevels: ['low', 'high', 'xhigh'] }));
      expect(r.effort).toBe('xhigh');
    });
  });
});

describe('toOpenAI: reasoning on a whole request', () => {
  it('puts reasoning_effort on the body', () => {
    const { body } = toOpenAI(
      { messages: [], effort: 'high' },
      profile({ capabilities: { effort: true, effortLevels: ['low', 'medium', 'high'] } }),
    );
    expect(body.reasoning_effort).toBe('high');
  });

  it('omits reasoning_effort entirely for an endpoint without effort', () => {
    const { body } = toOpenAI({ messages: [], effort: 'high' }, profile());
    expect('reasoning_effort' in body).toBe(false);
  });

  it('lets extraBody override the field name for a gateway that spells it differently', () => {
    const { body } = toOpenAI(
      { messages: [], effort: 'high' },
      profile({
        capabilities: { effort: true, effortLevels: ['high'] },
        extraBody: { reasoning: { effort: 'high' } },
      }),
    );
    expect(body.reasoning).toEqual({ effort: 'high' });
  });

  it('reports the downgrade as a request warning', () => {
    const { warnings } = toOpenAI(
      { messages: [], effort: 'max' },
      profile({ capabilities: { effort: true, effortLevels: ['low', 'medium'] } }),
    );
    expect(warnings.join()).toMatch(/sent "medium" instead/);
  });
});

describe('stripCacheControl', () => {
  it('removes markers wherever they are nested', () => {
    const request = {
      system: [{ type: 'text', text: 'rules', cache_control: { type: 'ephemeral' } }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }] },
      ],
      tools: [{ name: 'Read', cache_control: { type: 'ephemeral' } }],
    };
    const { value, removed } = stripCacheControl(request);
    expect(removed).toBe(3);
    expect(JSON.stringify(value)).not.toMatch(/cache_control/);
  });

  it('leaves the rest of the request exactly as it was', () => {
    const request = {
      system: [{ type: 'text', text: 'rules', cache_control: { type: 'ephemeral' } }],
      max_tokens: 1024,
    };
    const { value } = stripCacheControl(request);
    expect(value).toEqual({ system: [{ type: 'text', text: 'rules' }], max_tokens: 1024 });
  });

  it('returns the original object when there was nothing to strip', () => {
    // Structural sharing: the request is mostly conversation history, and
    // deep-cloning it every turn would cost real time for no benefit.
    const request = { messages: [{ role: 'user', content: 'hi' }] };
    const { value, removed } = stripCacheControl(request);
    expect(removed).toBe(0);
    expect(value).toBe(request);
  });

  it('counts every marker, so the log line is accurate', () => {
    const many = { a: [{ cache_control: 1 }, { cache_control: 2 }], b: { cache_control: 3 } };
    expect(stripCacheControl(many).removed).toBe(3);
  });

  it('handles an empty or primitive body without throwing', () => {
    expect(stripCacheControl({}).removed).toBe(0);
    expect(stripCacheControl(null).value).toBeNull();
  });
});

describe('keepsCacheControl: only an Anthropic-wire gateway can act on markers', () => {
  it.each([
    ['anthropic', true],
    ['prefix', false],
    ['none', false],
  ])('promptCaching %s keeps markers: %s', (mode, expected) => {
    expect(keepsCacheControl(caps({ promptCaching: mode as any }))).toBe(expected);
  });
});

describe('the OpenAI bridge drops cache_control implicitly', () => {
  it('never emits a marker, whatever the CLI sent', () => {
    const { body } = toOpenAI(
      {
        system: [{ type: 'text', text: 'rules', cache_control: { type: 'ephemeral' } }] as any,
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }] as any,
        }],
        tools: [{ name: 'Read', input_schema: {}, cache_control: { type: 'ephemeral' } } as any],
      },
      profile({ capabilities: { promptCaching: 'prefix' } }),
    );
    expect(JSON.stringify(body)).not.toMatch(/cache_control/);
  });
});

describe('prefixStabilityWarnings: a cache that never hits looks like a slow endpoint', () => {
  it.each(['request_id', 'session_id', 'timestamp', 'nonce'])(
    'warns about a per-turn %s in the body',
    (key) => {
      expect(prefixStabilityWarnings({ [key]: 'x' }).join()).toMatch(/every turn/);
    },
  );

  it('says nothing about an ordinary stable body', () => {
    expect(prefixStabilityWarnings({ model: 'm', temperature: 0.2 })).toEqual([]);
  });

  it('only runs for prefix-caching profiles', () => {
    const { warnings } = toOpenAI(
      { messages: [] },
      profile({ capabilities: { promptCaching: 'none' }, extraBody: { request_id: 'abc' } }),
    );
    expect(warnings.join()).not.toMatch(/every turn/);
  });

  it('surfaces through toOpenAI when the profile does cache by prefix', () => {
    const { warnings } = toOpenAI(
      { messages: [] },
      profile({ capabilities: { promptCaching: 'prefix' }, extraBody: { request_id: 'abc' } }),
    );
    expect(warnings.join()).toMatch(/prefix cache from ever hitting/);
  });
});

describe('prefix stability: the bridge itself introduces no per-turn variation', () => {
  it('produces a byte-identical body for an identical request', () => {
    const p = profile({ capabilities: { promptCaching: 'prefix', effort: true, effortLevels: ['high'] } });
    const request = {
      system: 'rules',
      messages: [{ role: 'user' as const, content: 'hello' }],
      tools: [{ name: 'Read', input_schema: { type: 'object' } }],
      effort: 'high',
      max_tokens: 100,
    };
    expect(JSON.stringify(toOpenAI(request, p).body))
      .toBe(JSON.stringify(toOpenAI(request, p).body));
  });

  it('keeps the prefix stable when only the newest turn differs', () => {
    const p = profile({ capabilities: { promptCaching: 'prefix' } });
    const base = [{ role: 'user' as const, content: 'first' }];
    const one = JSON.stringify(toOpenAI({ system: 'rules', messages: base }, p).body);
    const two = JSON.stringify(
      toOpenAI({ system: 'rules', messages: [...base, { role: 'assistant', content: 'reply' }] }, p).body,
    );
    // The shorter body's message array is a prefix of the longer one's, which
    // is exactly what an automatic prefix cache matches on.
    const head = one.slice(0, one.indexOf('"first"') + '"first"'.length);
    expect(two.startsWith(head)).toBe(true);
  });
});
