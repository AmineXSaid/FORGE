/**
 * Phase 2: the Anthropic-shaped face the CLI talks to, and the error mapping.
 *
 * Two behaviours here are load-bearing in a way that is easy to miss:
 *
 *   - `count_tokens` is answered locally. OpenAI has no such route, and a 404
 *     makes the CLI behave as though the context were unbounded.
 *   - HTTP statuses are passed through untouched. The CLI runs its own 429/529
 *     backoff; a relay that reclassified statuses, or retried them itself,
 *     would either break that backoff or multiply it.
 */
import { describe, expect, it } from 'vitest';
import {
  chatUrl,
  estimateTokens,
  isCountTokensPath,
  toAnthropicMessage,
} from '../src/services/endpoints/wire/anthropicServer';
import {
  errorTypeForStatus,
  extractMessage,
  isRetryableTransportError,
  transportError,
  upstreamError,
} from '../src/services/endpoints/wire/errors';
import { parseProfile, type EndpointProfile } from '../src/services/endpoints/profile';

function profile(overrides: Record<string, unknown> = {}): EndpointProfile {
  return parseProfile(
    { name: 'gw', wire: 'openai', baseUrl: 'https://gw/v1', model: 'm', ...overrides },
    'test',
  );
}

describe('chatUrl: both spellings of baseUrl are common and neither is wrong', () => {
  it('appends the bare route when baseUrl already carries a version segment', () => {
    expect(chatUrl(profile({ baseUrl: 'http://localhost:20128/v1' })))
      .toBe('http://localhost:20128/v1/chat/completions');
  });

  it('adds /v1 when baseUrl is a bare origin', () => {
    expect(chatUrl(profile({ baseUrl: 'http://localhost:20128' })))
      .toBe('http://localhost:20128/v1/chat/completions');
  });

  it('tolerates a trailing slash', () => {
    expect(chatUrl(profile({ baseUrl: 'http://localhost:20128/v1/' })))
      .toBe('http://localhost:20128/v1/chat/completions');
  });

  it('lets an explicit chatPath win, because that profile knows its gateway', () => {
    expect(chatUrl(profile({ baseUrl: 'https://gw.example', chatPath: '/openai/deployments/x/chat' })))
      .toBe('https://gw.example/openai/deployments/x/chat');
  });
});

describe('isCountTokensPath', () => {
  it.each([
    ['/v1/messages/count_tokens', true],
    ['/v1/messages/count_tokens/', true],
    ['/v1/messages/count_tokens?beta=true', true],
    ['/v1/messages', false],
  ])('%s -> %s', (path, expected) => {
    expect(isCountTokensPath(path)).toBe(expected);
  });
});

describe('estimateTokens: wrong in the safe direction', () => {
  it('counts the system prompt, the messages and the tool schemas', () => {
    // Tool schemas are frequently the largest part of the prompt, so leaving
    // them out would under-count exactly when it matters most.
    const withTools = estimateTokens({
      system: 'x'.repeat(400),
      messages: [{ role: 'user', content: 'y'.repeat(400) }],
      tools: [{ name: 'Read', description: 'z'.repeat(400), input_schema: {} }],
    });
    const withoutTools = estimateTokens({
      system: 'x'.repeat(400),
      messages: [{ role: 'user', content: 'y'.repeat(400) }],
    });
    expect(withTools).toBeGreaterThan(withoutTools);
    // 800 characters of content at ~4 chars/token, plus a token or so for the
    // structural keys the walk also sees.
    expect(withoutTools).toBeGreaterThanOrEqual(200);
    expect(withoutTools).toBeLessThan(210);
  });

  it('charges an image by its pixels, not its bytes', () => {
    const image = (data: string) => ({
      messages: [{
        role: 'user' as const,
        content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }],
      }],
    });
    // A 200 KB screenshot must not be counted as 50,000 tokens of text: the
    // base64 payload is never walked, so both estimates are the same.
    expect(estimateTokens(image('A'.repeat(200_000)))).toBe(estimateTokens(image('AA')));
    expect(estimateTokens(image('AA'))).toBeGreaterThanOrEqual(1400);
  });

  it('grows with the conversation, which is what compaction keys off', () => {
    const short = estimateTokens({ messages: [{ role: 'user', content: 'hi' }] });
    const long = estimateTokens({
      messages: Array.from({ length: 50 }, () => ({ role: 'user' as const, content: 'x'.repeat(1000) })),
    });
    expect(long).toBeGreaterThan(short * 100);
  });

  it('handles an empty request without throwing', () => {
    expect(estimateTokens({})).toBe(0);
  });
});

describe('toAnthropicMessage: the non-streamed reply', () => {
  it('translates text and usage', () => {
    const msg = toAnthropicMessage(
      {
        id: 'chatcmpl-9',
        choices: [{ message: { role: 'assistant', content: 'Hello.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      },
      'my-model',
    );
    expect(msg).toMatchObject({
      id: 'chatcmpl-9',
      type: 'message',
      role: 'assistant',
      model: 'my-model',
      content: [{ type: 'text', text: 'Hello.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 4 },
    });
  });

  it('translates tool calls and reports stop_reason tool_use', () => {
    const msg: any = toAnthropicMessage(
      {
        choices: [{
          message: {
            content: null,
            tool_calls: [{ id: 'call_1', function: { name: 'Read', arguments: '{"file_path":"a.ts"}' } }],
          },
          finish_reason: 'tool_calls',
        }],
      },
      'm',
    );
    expect(msg.content).toEqual([
      { type: 'tool_use', id: 'call_1', name: 'Read', input: { file_path: 'a.ts' } },
    ]);
    expect(msg.stop_reason).toBe('tool_use');
  });

  it('keeps malformed tool arguments visible rather than dropping the call', () => {
    const msg: any = toAnthropicMessage(
      {
        choices: [{
          message: { tool_calls: [{ id: 'c', function: { name: 'Read', arguments: '{not json' } }] },
          finish_reason: 'tool_calls',
        }],
      },
      'm',
    );
    expect(msg.content[0].input).toEqual({ _raw: '{not json' });
  });

  it('maps finish_reason length to max_tokens', () => {
    const msg: any = toAnthropicMessage(
      { choices: [{ message: { content: 'cut off' }, finish_reason: 'length' }] },
      'm',
    );
    expect(msg.stop_reason).toBe('max_tokens');
  });

  it('turns a reasoning field into a thinking block', () => {
    const msg: any = toAnthropicMessage(
      { choices: [{ message: { reasoning_content: 'working', content: 'done' }, finish_reason: 'stop' }] },
      'm',
    );
    expect(msg.content[0]).toMatchObject({ type: 'thinking', thinking: 'working' });
    expect(msg.content[1]).toMatchObject({ type: 'text', text: 'done' });
  });
});

describe('errors: the CLI has to be able to read the failure', () => {
  it.each([
    [400, 'invalid_request_error'],
    [401, 'authentication_error'],
    [403, 'permission_error'],
    [404, 'not_found_error'],
    [413, 'request_too_large'],
    [429, 'rate_limit_error'],
    [500, 'api_error'],
    [529, 'overloaded_error'],
  ])('maps HTTP %s to %s', (status, type) => {
    expect(errorTypeForStatus(status)).toBe(type);
  });

  it.each([
    ['{"error":{"message":"model not found"}}', 'model not found'],
    ['{"message":"bad key"}', 'bad key'],
    ['{"detail":"no such model"}', 'no such model'],
    ['plain text failure', 'plain text failure'],
  ])('pulls a message out of %s', (body, expected) => {
    expect(extractMessage(body, 400)).toBe(expected);
  });

  it('says something useful about an empty body', () => {
    expect(extractMessage('', 502)).toMatch(/HTTP 502/);
  });

  it('names the profile, so the failure does not read as an Anthropic account problem', () => {
    const err = upstreamError(401, '{"error":{"message":"bad key"}}', 'company-llama');
    expect(err.error.type).toBe('authentication_error');
    expect(err.error.message).toBe('[company-llama] bad key');
  });

  describe('transport failures name the syscall, which is the actionable part', () => {
    it.each([
      ['ECONNREFUSED', /nothing is listening/],
      ['ENOTFOUND', /host name did not resolve/],
      ['ETIMEDOUT', /larger timeoutMs/],
      ['DEPTH_ZERO_SELF_SIGNED_CERT', /tls.caBundle/],
      ['CERT_HAS_EXPIRED', /certificate has expired/],
    ])('%s produces a fix hint', (code, pattern) => {
      const e = Object.assign(new Error('boom'), { code });
      expect(transportError(e, 'gw', 'https://gw/v1').error.message).toMatch(pattern);
    });
  });

  describe('isRetryableTransportError: the single most important constraint', () => {
    it.each(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_SOCKET'])(
      'retries the connection-level failure %s',
      (code) => {
        expect(isRetryableTransportError(Object.assign(new Error('x'), { code }))).toBe(true);
      },
    );

    it('does not treat an HTTP failure as retryable', () => {
      // HTTP statuses never reach this function -- they are passed to the CLI,
      // which backs off itself. Retrying here too would multiply the wait and
      // present as a session hung for minutes with nothing on screen.
      expect(isRetryableTransportError(new Error('HTTP 429'))).toBe(false);
      expect(isRetryableTransportError(Object.assign(new Error('x'), { code: 'ERR_BAD_REQUEST' }))).toBe(false);
    });
  });
});
