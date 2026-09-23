/**
 * Telling the user the endpoint is not answering.
 *
 * Reported by pulling the wifi and sending a message. What the log shows:
 *
 *   [relay] omni-routing: upstream HTTP 502
 *   [SDK ERROR] API error (attempt 4/11): 502 … ENOTFOUND opencode.ai
 *   … 13 of these over several minutes …
 *   [engine] turn 5 end (… stop=end_turn resultLen=0)
 *
 * What the user saw: a randomly chosen verb ("Forging…"), then the CLI's own
 * "[Your previous response had no visible output…]" nudge rendered as if they
 * had typed it, because a provider eventually answered with nothing.
 *
 * Every one of those 13 retries arrived in the webview as `system`/`api_retry`
 * (`SDKAPIRetryMessage`, `sdk.d.ts` L3361) carrying `attempt`, `max_retries`
 * and `error_status`. `Session` handled only `subtype === 'init'` and dropped
 * the rest on the floor.
 *
 * Forge-only: the official webview ignores this subtype too, which is fair when
 * the endpoint is `api.anthropic.com`. Forge points the CLI at gateways and
 * self-hosted servers, where a dead upstream is ordinary.
 */
import { describe, expect, it } from 'vitest';
import { retryStatusText } from '../src/webview/src/core/retryStatus';

describe('retryStatusText', () => {
  it('says nothing when the endpoint is answering', () => {
    // The spinner falls back to its verb; the notice must not linger.
    expect(retryStatusText(undefined)).toBe('');
  });

  it('leads with the HTTP status, because that is the actionable part', () => {
    // The reported case: a local gateway that is up, whose upstream is not.
    expect(retryStatusText({ attempt: 4, maxRetries: 11, status: 502 })).toBe(
      'Endpoint error 502. Retrying 4/11…',
    );
  });

  it('says "not responding" when there was no HTTP response at all', () => {
    // `error_status` is null for connection errors and timeouts.
    expect(retryStatusText({ attempt: 1, maxRetries: 11, status: null })).toBe(
      'Endpoint not responding. Retrying 1/11…',
    );
  });

  it('omits the count when the SDK does not give a budget', () => {
    expect(retryStatusText({ attempt: 0, maxRetries: 0, status: 503 })).toBe(
      'Endpoint error 503. Retrying…',
    );
  });

  it('keeps counting to the end of the budget', () => {
    expect(retryStatusText({ attempt: 11, maxRetries: 11, status: 502 })).toContain('11/11');
  });
});
