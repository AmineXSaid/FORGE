/**
 * One URL for an Anthropic-wire endpoint, whoever builds it.
 *
 * The relay appended the CLI's `/v1/messages` to `baseUrl` while the health and
 * diagnostics probes appended `/messages`, so for any one `baseUrl` one of them
 * was wrong: an endpoint could chat and still be marked dead by every check,
 * which is the "every model shows as not answering" report. Both spellings of
 * the base must now land on the same route, from every caller.
 */
import { describe, expect, it } from 'vitest';
import { anthropicMessagesUrl, anthropicUrl } from '../src/services/endpoints/urls';
import { joinUrl } from '../src/services/endpoints/relay';

describe('anthropicUrl', () => {
  it('lands on one route whether baseUrl carries the version or not', () => {
    expect(anthropicUrl('https://api.anthropic.com', '/v1/messages')).toBe('https://api.anthropic.com/v1/messages');
    expect(anthropicUrl('https://api.anthropic.com/v1', '/v1/messages')).toBe('https://api.anthropic.com/v1/messages');
    expect(anthropicUrl('https://api.anthropic.com/v1/', '/v1/messages')).toBe('https://api.anthropic.com/v1/messages');
    expect(anthropicUrl('https://gw.example/anthropic', '/v1/messages')).toBe('https://gw.example/anthropic/v1/messages');
    expect(anthropicUrl('https://gw.example/anthropic/v1', '/v1/messages/count_tokens'))
      .toBe('https://gw.example/anthropic/v1/messages/count_tokens');
  });

  it('keeps a pinned chat path as written', () => {
    expect(anthropicMessagesUrl('https://gw.example', '/custom/chat')).toBe('https://gw.example/custom/chat');
    expect(anthropicMessagesUrl('https://gw.example/v1', undefined)).toBe('https://gw.example/v1/messages');
  });
});

describe('the relay builds the same URL the probes do', () => {
  it('for the messages route, both spellings of the base', () => {
    for (const base of ['https://api.anthropic.com', 'https://api.anthropic.com/v1']) {
      expect(joinUrl(base, '/v1/messages')).toBe(anthropicMessagesUrl(base));
    }
  });

  it('keeps the query string', () => {
    expect(joinUrl('https://api.anthropic.com/v1', '/v1/messages?beta=true')).toBe('https://api.anthropic.com/v1/messages?beta=true');
  });

  it('sends only messages to a pinned chatPath, not count_tokens', () => {
    expect(joinUrl('https://gw.example', '/v1/messages', '/chat')).toBe('https://gw.example/chat');
    expect(joinUrl('https://gw.example', '/v1/messages/count_tokens', '/chat')).toBe('https://gw.example/v1/messages/count_tokens');
  });
});
