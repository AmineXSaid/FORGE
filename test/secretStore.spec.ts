/**
 * Where an endpoint's token lives, and how it gets back out.
 *
 * `interpolate` already understood `${secret:KEY}`, but the only lookup ever
 * passed to it was `(key) => process.env[key]` — so `${secret:…}` was an alias
 * for `${env:…}` and nothing was actually stored anywhere. These tests cover
 * the plumbing that makes it a real keychain read, and the bound on what gets
 * read out of that keychain.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  collectSecretKeys,
  secretKeyFor,
  secretLookupFor,
  secretRef,
  type SecretReader,
} from '../src/services/endpoints/secretStore';
import { interpolate, parseProfile, type EndpointProfile } from '../src/services/endpoints/profile';

/** A keychain holding exactly these entries. */
function keychain(entries: Record<string, string>): SecretReader & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    get(key: string) {
      reads.push(key);
      return Promise.resolve(entries[key]);
    },
  };
}

function profile(partial: Record<string, unknown>): EndpointProfile {
  return parseProfile(
    { name: 'gw', wire: 'openai', baseUrl: 'https://gw.example.com', model: 'm', ...partial },
    'test',
  );
}

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe('key naming', () => {
  it('files a token under the profile it belongs to', () => {
    expect(secretKeyFor('company-gateway')).toBe('forge.endpoint.company-gateway.token');
  });

  it('round-trips through the reference form', () => {
    const key = secretKeyFor('gw');
    expect(secretRef(key)).toBe('${secret:forge.endpoint.gw.token}');
    expect(collectSecretKeys(profile({ auth: { kind: 'bearer', value: secretRef(key) } })))
      .toEqual([key]);
  });
});

describe('which secrets a profile refers to', () => {
  it('finds the one in an auth value', () => {
    const p = profile({ auth: { kind: 'bearer', value: '${secret:k1}' } });
    expect(collectSecretKeys(p)).toEqual(['k1']);
  });

  it('finds the ones in an exchange block', () => {
    const p = profile({
      auth: {
        kind: 'exchange',
        exchange: {
          url: 'https://auth.example.com/${secret:tenant}/token',
          headers: { 'x-a': '${secret:k2}' },
          body: { client_secret: '${secret:k3}' },
        },
      },
    });
    expect(collectSecretKeys(p).sort()).toEqual(['k2', 'k3', 'tenant']);
  });

  it('returns nothing for a profile with no secrets', () => {
    expect(collectSecretKeys(profile({ auth: { kind: 'none' } }))).toEqual([]);
    expect(collectSecretKeys(profile({ auth: { kind: 'bearer', value: '${env:TOKEN}' } })))
      .toEqual([]);
  });

  it('does not scan fields that are never interpolated', () => {
    // Resolving a secret the request can never use would read more of the
    // keychain than it needs. `headers` is not run through `interpolate`.
    const p = profile({
      auth: { kind: 'bearer', value: '${secret:used}' },
      headers: { 'x-unused': '${secret:never-read}' },
    });
    expect(collectSecretKeys(p)).toEqual(['used']);
  });

  it('deduplicates a key used twice', () => {
    const p = profile({
      auth: {
        kind: 'exchange',
        exchange: { url: 'https://a/${secret:k}', body: { s: '${secret:k}' } },
      },
    });
    expect(collectSecretKeys(p)).toEqual(['k']);
  });
});

describe('resolving them', () => {
  it('reads only the keys the profile names', async () => {
    const store = keychain({ 'forge.endpoint.gw.token': 'sk-live', other: 'nope' });
    const p = profile({ auth: { kind: 'bearer', value: secretRef(secretKeyFor('gw')) } });

    const lookup = await secretLookupFor(p, store);

    expect(store.reads).toEqual(['forge.endpoint.gw.token']);
    expect(lookup('forge.endpoint.gw.token')).toBe('sk-live');
  });

  it('substitutes into the auth value the way a request will', async () => {
    const key = secretKeyFor('gw');
    const p = profile({ auth: { kind: 'bearer', value: secretRef(key) } });
    const lookup = await secretLookupFor(p, keychain({ [key]: 'sk-live' }));

    expect(interpolate(p.auth.value!, lookup)).toBe('sk-live');
  });

  it('falls back to the environment for a key the keychain lacks', async () => {
    // What `${secret:…}` did before SecretStorage existed. Dropping it would
    // break any profile written against the old behaviour.
    process.env.LEGACY_KEY = 'from-env';
    const p = profile({ auth: { kind: 'bearer', value: '${secret:LEGACY_KEY}' } });
    const lookup = await secretLookupFor(p, keychain({}));

    expect(lookup('LEGACY_KEY')).toBe('from-env');
  });

  it('prefers the keychain over an environment variable of the same name', async () => {
    process.env.BOTH = 'from-env';
    const p = profile({ auth: { kind: 'bearer', value: '${secret:BOTH}' } });
    const lookup = await secretLookupFor(p, keychain({ BOTH: 'from-keychain' }));

    expect(lookup('BOTH')).toBe('from-keychain');
  });

  it('works with no keychain at all', async () => {
    process.env.ONLY_ENV = 'v';
    const p = profile({ auth: { kind: 'bearer', value: '${secret:ONLY_ENV}' } });
    const lookup = await secretLookupFor(p, undefined);

    expect(lookup('ONLY_ENV')).toBe('v');
    expect(lookup('missing')).toBeUndefined();
  });

  it('survives a keychain that refuses to open', async () => {
    // A locked keychain should surface as an auth failure against the endpoint,
    // not as an exception before the request is ever built.
    const store: SecretReader = { get: () => Promise.reject(new Error('locked')) };
    const p = profile({ auth: { kind: 'bearer', value: '${secret:k}' } });

    const lookup = await secretLookupFor(p, store);
    expect(lookup('k')).toBeUndefined();
  });

  it('leaves ${env:…} to the environment, untouched', async () => {
    process.env.PLAIN = 'env-value';
    const p = profile({ auth: { kind: 'bearer', value: '${env:PLAIN}' } });
    const lookup = await secretLookupFor(p, keychain({ PLAIN: 'keychain-value' }));

    // `interpolate` resolves `env:` from process.env directly, never via the
    // lookup, so an existing profile keeps behaving exactly as it did.
    expect(interpolate(p.auth.value!, lookup)).toBe('env-value');
  });
});
