/** The SDK's `system`/`api_retry`, reduced to what the spinner needs. */
export interface ApiRetryState {
  attempt: number;
  maxRetries: number;
  /** `null` for connection errors that never got an HTTP response. */
  status: number | null;
}

/**
 * What the spinner says while the endpoint is not answering.
 *
 * Its own module so the wording can be tested. This is the only thing the user
 * sees during a retry storm, and getting it wrong is how a dead gateway reads
 * as a slow one — which is exactly what happened with the wifi off: 13 retries
 * over several minutes, and a randomly chosen verb ("Forging…") throughout.
 *
 * The HTTP status leads when there is one, because "502" is the difference
 * between "my gateway is down" and "my gateway's upstream is down" and the user
 * is the only one who can act on it. The attempt count follows, because it says
 * both that this is still going and roughly how much patience is left.
 */
export function retryStatusText(retry: ApiRetryState | undefined): string {
  if (!retry) return '';

  const attempts = retry.maxRetries > 0 ? ` ${retry.attempt}/${retry.maxRetries}` : '';

  return retry.status
    ? `Endpoint error ${retry.status} — retrying${attempts}…`
    : `Endpoint not responding — retrying${attempts}…`;
}
