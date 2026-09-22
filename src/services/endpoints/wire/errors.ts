/**
 * Error-shape mapping for the wire bridge.
 *
 * The CLI parses failures as Anthropic errors and renders them; anything else
 * surfaces as "unparseable response", which tells the user nothing about a
 * gateway that is merely rate-limiting them. So every failure the bridge can
 * produce leaves as an Anthropic error envelope.
 *
 * The status code is deliberately *not* rewritten. The CLI has its own backoff
 * for 429 and 529 and it reads the status to drive it; re-labelling a 429 as a
 * 500 would turn a wait into a hard failure, and inventing a 429 where the
 * gateway sent none would make the CLI sleep for no reason.
 */

/** The Anthropic error envelope. */
export interface AnthropicError {
  type: 'error';
  error: { type: string; message: string };
}

/**
 * HTTP status -> Anthropic error `type`.
 *
 * Mirrors the taxonomy the Anthropic API uses, because the CLI keys off these
 * strings as well as the status.
 */
export function errorTypeForStatus(status: number): string {
  switch (status) {
    case 400: return 'invalid_request_error';
    case 401: return 'authentication_error';
    case 403: return 'permission_error';
    case 404: return 'not_found_error';
    case 413: return 'request_too_large';
    case 422: return 'invalid_request_error';
    case 429: return 'rate_limit_error';
    case 529: return 'overloaded_error';
    default: return status >= 500 ? 'api_error' : 'invalid_request_error';
  }
}

/**
 * Pull a human message out of whatever the gateway sent back.
 *
 * Gateways disagree on the envelope -- OpenAI nests under `error.message`,
 * some return a bare `message`, vLLM sometimes returns `detail`, and a few
 * return plain text. The raw body is the last resort because an opaque
 * "request failed" is the least useful thing to show.
 */
export function extractMessage(body: string, status: number): string {
  try {
    const json = JSON.parse(body);
    const candidate =
      json?.error?.message ??
      json?.error ??
      json?.message ??
      json?.detail ??
      json?.error_message;
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (candidate && typeof candidate === 'object') return JSON.stringify(candidate);
  } catch {
    // Not JSON.
  }
  const text = body.trim();
  if (text) return text.slice(0, 2000);
  return `Endpoint returned HTTP ${status} with an empty body.`;
}

/**
 * Translate an upstream failure into an Anthropic error envelope.
 *
 * @param profileName named in the message because with a profile active the
 *   failure is the *gateway's*, and a bare "authentication_error" otherwise
 *   reads as a problem with the user's Anthropic account.
 */
export function upstreamError(status: number, body: string, profileName: string): AnthropicError {
  return {
    type: 'error',
    error: {
      type: errorTypeForStatus(status),
      message: `[${profileName}] ${extractMessage(body, status)}`,
    },
  };
}

/**
 * Translate a transport-level failure -- nothing reached the gateway at all.
 *
 * These carry Node's syscall codes, which are the most actionable thing the
 * user can be told: ECONNREFUSED means the port is wrong or the server is down,
 * ENOTFOUND means the host name is, and a certificate code means the TLS block
 * needs attention rather than the URL.
 */
export function transportError(e: unknown, profileName: string, baseUrl: string): AnthropicError {
  const code = (e as NodeJS.ErrnoException)?.code;
  const message = e instanceof Error ? e.message : String(e);

  const hint =
    code === 'ECONNREFUSED' ? 'nothing is listening there -- check the port and that the server is running'
      : code === 'ENOTFOUND' ? 'the host name did not resolve -- check baseUrl'
        : code === 'ETIMEDOUT' || code === 'UND_ERR_HEADERS_TIMEOUT' ? 'the endpoint did not answer in time -- a cold-starting model may need a larger timeoutMs'
          : code === 'UND_ERR_BODY_TIMEOUT' ? 'the endpoint stopped sending mid-response -- raise timeoutMs'
            : code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'SELF_SIGNED_CERT_IN_CHAIN' ? 'self-signed certificate -- add the CA to tls.caBundle'
              : code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ? 'the certificate chain is incomplete -- add the issuing CA to tls.caBundle'
                : code === 'CERT_HAS_EXPIRED' ? 'the endpoint certificate has expired'
                  : undefined;

  return {
    type: 'error',
    error: {
      type: 'api_error',
      message: `[${profileName}] could not reach ${baseUrl}: ${message}${hint ? ` (${hint})` : ''}`,
    },
  };
}

/**
 * Whether a transport failure is worth retrying.
 *
 * Connection-level only, and that restriction is the important part rather
 * than a detail. The CLI already retries 429 and 529 with its own backoff, so
 * a relay that also retried HTTP statuses would multiply the two and present
 * as a session hung for minutes with nothing on screen. Every HTTP status
 * therefore passes straight through to the CLI; only failures where no
 * response was ever produced are retried here.
 */
export function isRetryableTransportError(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException)?.code;
  return code === 'ECONNRESET'
    || code === 'ECONNREFUSED'
    || code === 'ETIMEDOUT'
    || code === 'EPIPE'
    || code === 'EAI_AGAIN'
    || code === 'EHOSTUNREACH'
    || code === 'ENETUNREACH'
    || code === 'UND_ERR_SOCKET'
    || code === 'UND_ERR_CONNECT_TIMEOUT';
}
