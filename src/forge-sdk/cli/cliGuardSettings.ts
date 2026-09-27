/**
 * What a terminal CLI needs to reach the guards: a settings layer of HTTP
 * hooks (`--settings <file>`) and one environment variable.
 *
 * The CLI POSTs each hook input to `url` and reads the reply as the hook's
 * output (measured against CLI 2.1.274). The token never appears in the file:
 * the header names `$FORGE_HOOK_TOKEN`, which the CLI fills in from its own
 * environment only because `allowedEnvVars` lists it.
 */

/** The environment variable the per-terminal token travels in. */
export const HOOK_TOKEN_ENV = 'FORGE_HOOK_TOKEN';

/** The events the guards answer. */
export const GUARD_HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit', 'Stop'] as const;

/**
 * Seconds the CLI waits for an answer. Edit diagnostics wait up to 2 s for the
 * language servers; anything beyond that is a host that is gone, and the CLI
 * carries on without the hook.
 */
export const GUARD_HOOK_TIMEOUT_S = 15;

export function cliGuardSettings(url: string): { hooks: Record<string, unknown[]> } {
  const hook = {
    type: 'http',
    url,
    headers: { Authorization: `Bearer $${HOOK_TOKEN_ENV}` },
    allowedEnvVars: [HOOK_TOKEN_ENV],
    timeout: GUARD_HOOK_TIMEOUT_S,
  };
  return { hooks: Object.fromEntries(GUARD_HOOK_EVENTS.map((event) => [event, [{ hooks: [hook] }]])) };
}
