/**
 * "Forge: Add Endpoint Profile" — the guided flow that makes an endpoint
 * reachable from the UI instead of from `settings.json` only.
 *
 * Two properties are worth a test. The first is that what the flow writes is
 * something `parseProfile` accepts: a wizard that produces an invalid profile
 * is worse than no wizard, because the failure surfaces later, somewhere else.
 * The second is that a key never reaches disk.
 */
import { describe, expect, it } from 'vitest';
import {
  buildProfileValue,
  validateBaseUrl,
  validateHeaderName,
  validateModel,
  validateProfileName,
  validateToken,
} from '../src/services/endpoints/newProfile';
import { parseProfile, parseProfileMap } from '../src/services/endpoints/profile';
import { secretKeyFor, secretRef } from '../src/services/endpoints/secretStore';

describe('what the flow writes is a profile the loader accepts', () => {
  it('parses as a settings profile, with the name coming from the key', () => {
    const value = buildProfileValue({
      wire: 'openai',
      baseUrl: 'https://gateway.example.com/v1',
      model: 'llama-3.3-70b-instruct',
      auth: { kind: 'bearer', secretKey: secretKeyFor('company-gateway') },
    });

    const { profiles, errors } = parseProfileMap({ 'company-gateway': value });

    expect(errors).toEqual([]);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe('company-gateway');
    expect(profiles[0].wire).toBe('openai');
    expect(profiles[0].baseUrl).toBe('https://gateway.example.com/v1');
    expect(profiles[0].model).toBe('llama-3.3-70b-instruct');
  });

  it('fills in the defaults rather than guessing a capability block', () => {
    // Guessing `contextWindow` or `effort` before the endpoint has answered
    // would put a number in front of the UI that nothing measured.
    const value = buildProfileValue({
      wire: 'anthropic',
      baseUrl: 'https://relay.example.com',
      model: 'claude-sonnet-4-5',
      auth: { kind: 'none' },
    });

    expect(Object.keys(value).sort()).toEqual(['auth', 'baseUrl', 'model', 'wire']);

    const parsed = parseProfile({ ...value, name: 'relay' }, 'test');
    expect(parsed.capabilities).toBeDefined();
    expect(parsed.timeoutMs).toBe(120_000);
    expect(parsed.retries).toBe(2);
  });

  it('trims what the user typed', () => {
    const value = buildProfileValue({
      wire: 'openai',
      baseUrl: '  https://gateway.example.com/v1  ',
      model: '  gpt-4o  ',
      auth: { kind: 'header', header: '  x-api-key  ', secretKey: secretKeyFor('gw') },
    });

    expect(value.baseUrl).toBe('https://gateway.example.com/v1');
    expect(value.model).toBe('gpt-4o');
    expect(value.auth).toEqual({
      kind: 'header',
      header: 'x-api-key',
      value: '${secret:forge.endpoint.gw.token}',
    });
  });
});

describe('the token goes to the keychain, not to settings.json', () => {
  it('stores a reference to a SecretStorage key, never the token', () => {
    const value = buildProfileValue({
      wire: 'openai',
      baseUrl: 'https://gateway.example.com/v1',
      model: 'gpt-4o',
      auth: { kind: 'bearer', secretKey: secretKeyFor('company-gateway') },
    });

    expect(value.auth).toEqual({
      kind: 'bearer',
      value: '${secret:forge.endpoint.company-gateway.token}',
    });
    // The property that matters: nothing token-shaped survives into the value
    // that `config.update` writes.
    expect(JSON.stringify(value)).not.toContain('sk-');
  });

  it('files each profile under its own key, so two endpoints cannot share a token', () => {
    expect(secretKeyFor('gw-a')).toBe('forge.endpoint.gw-a.token');
    expect(secretKeyFor('gw-b')).toBe('forge.endpoint.gw-b.token');
    expect(secretKeyFor('gw-a')).not.toBe(secretKeyFor('gw-b'));
  });

  it('formats a reference the way interpolate() reads it', () => {
    expect(secretRef('forge.endpoint.gw.token')).toBe('${secret:forge.endpoint.gw.token}');
  });

  it('writes nothing at all for an unauthenticated endpoint', () => {
    const value = buildProfileValue({
      wire: 'openai',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen2.5-coder',
      auth: { kind: 'none' },
    });
    expect(value.auth).toEqual({ kind: 'none' });
  });
});

describe('the token box', () => {
  it.each([
    'sk-ant-api03-abcdef',
    'hf_AbCdEf123',
    'a'.repeat(200),
    '1234',
  ])('accepts the token %j, because gateways issue all sorts', (good) => {
    expect(validateToken(good)).toBeUndefined();
  });

  it.each(['', '   '])('refuses the empty token %j', (bad) => {
    expect(validateToken(bad)).toBeDefined();
  });

  it.each(['${env:MY_TOKEN}', '${secret:k}', '${file:/tmp/t}'])(
    'refuses %j and says to paste the token itself',
    (reference) => {
      // What someone who read the old documentation would paste. Accepting it
      // would store the literal text and authenticate with nonsense.
      expect(validateToken(reference)).toContain('token itself');
    },
  );

  it('refuses a value with whitespace in it', () => {
    expect(validateToken('Bearer sk-abc')).toContain('no spaces');
  });
});

describe('the questions validate before anything is saved', () => {
  it.each([
    ['', 'empty'],
    ['has space', 'a space'],
    ['-leading-dash', 'a leading dash'],
    ['../escape', 'a path'],
    ['name/with/slash', 'a slash'],
  ])('refuses the name %j (%s)', (bad) => {
    expect(validateProfileName(bad, [])).toBeDefined();
  });

  it('refuses a name that already exists', () => {
    expect(validateProfileName('gateway', ['gateway'])).toContain('already exists');
    expect(validateProfileName('gateway', ['other'])).toBeUndefined();
  });

  it.each(['company-gateway', 'gw.internal', 'GW_1'])('accepts the name %j', (good) => {
    expect(validateProfileName(good, [])).toBeUndefined();
  });

  it.each([
    ['', 'empty'],
    ['gateway.example.com', 'no scheme'],
    ['file:///etc/passwd', 'not http'],
    ['ftp://example.com', 'not http'],
    ['javascript:alert(1)', 'not http'],
  ])('refuses the base URL %j (%s)', (bad) => {
    expect(validateBaseUrl(bad)).toBeDefined();
  });

  it.each(['https://gateway.example.com/v1', 'http://localhost:11434/v1'])(
    'accepts the base URL %j',
    (good) => {
      expect(validateBaseUrl(good)).toBeUndefined();
    },
  );

  it('requires a model id', () => {
    expect(validateModel('  ')).toBeDefined();
    expect(validateModel('gpt-4o')).toBeUndefined();
  });

  it.each(['', 'x api key', 'x:api:key'])('refuses the header name %j', (bad) => {
    expect(validateHeaderName(bad)).toBeDefined();
  });

  it.each(['x-api-key', 'api-key', 'Authorization'])('accepts the header name %j', (good) => {
    expect(validateHeaderName(good)).toBeUndefined();
  });
});
