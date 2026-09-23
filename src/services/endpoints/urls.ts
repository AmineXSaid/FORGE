/**
 * Where an Anthropic-wire endpoint's routes are.
 *
 * The relay, the health probes, the diagnostics probe and the model listing all
 * build this URL, and they used to build it differently: the relay appended the
 * CLI's `/v1/messages` to `baseUrl`, the probes appended `/messages`. For any one
 * `baseUrl` one of the two was wrong -- written as `https://host` the probes
 * missed the `/v1`, written as `https://host/v1` the relay sent `/v1/v1/messages`
 * -- so an endpoint that chatted fine could be marked dead by every health
 * check, or the other way round. One builder, and it accepts both spellings.
 */

/** The API version header Anthropic's Messages API requires on every request. */
export const ANTHROPIC_VERSION = '2023-06-01';

const VERSION_SEGMENT = /\/v\d+[a-z]*$/i;
const LEADING_VERSION = /^\/v\d+[a-z]*(?=\/)/i;

/**
 * Join `baseUrl` and an API path such as `/v1/messages`, without doubling the
 * version: `https://host/v1` + `/v1/messages` is `https://host/v1/messages`, and
 * so is `https://host` + `/v1/messages`. A query string on `path` is kept.
 */
export function anthropicUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const route = path.startsWith('/') ? path : `/${path}`;
  let pathname = base;
  try {
    pathname = new URL(base).pathname.replace(/\/+$/, '');
  } catch {
    // A malformed base is reported by the request itself.
  }
  return VERSION_SEGMENT.test(pathname) ? `${base}${route.replace(LEADING_VERSION, '')}` : `${base}${route}`;
}

/**
 * The Messages route for a profile: its pinned `chatPath` when it has one,
 * else the standard `/v1/messages`.
 */
export function anthropicMessagesUrl(baseUrl: string, chatPath?: string): string {
  return chatPath ? anthropicUrl(baseUrl, chatPath) : anthropicUrl(baseUrl, '/v1/messages');
}
