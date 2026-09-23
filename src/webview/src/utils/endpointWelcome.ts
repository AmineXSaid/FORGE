/**
 * Which welcome the chat page is holding up, and whether the user waved it off.
 *
 * Its own module rather than a `computed` inside `ChatPage.vue` for the reason
 * `relativeTime.ts` is one: `<script setup>` cannot export, and a rule with
 * three states, an "unknown" case and a persistence flag deserves a spec. The
 * gate is the most expensive thing in the webview to get wrong -- it hides the
 * composer -- so it is the last thing that should only be reachable by mounting
 * a page.
 */

/** The three states, in the order §2 Part E lists them. */
export type EndpointWelcomeState =
  /** A: no profiles at all. */
  | 'no-profiles'
  /** B: profiles exist, nothing to offer, and no sweep has explained why. */
  | 'unchecked'
  /** C: profiles were measured and nothing answered. The dismissible one. */
  | 'none-healthy';

export interface EndpointWelcomeInput {
  /** `endpointProfileCount > 0`; `undefined` until `init` answers. */
  hasEndpoints: boolean | undefined;
  /** Rows in the model picker; `undefined` until `get_claude_state` answers. */
  modelCount: number | undefined;
  /** Models that answered a real request, anywhere. */
  healthyModelCount: number | undefined;
  /** Profiles with a completed sweep behind them. */
  checkedProfileCount: number | undefined;
}

/**
 * The gate.
 *
 * Keyed on what can actually be sent to, not on what is configured: a gateway
 * listing a hundred models it cannot serve is as unusable as no gateway, and
 * before the health sweep it read as "100 models, all good".
 *
 * `undefined` means "nothing is up", and it is also what an unanswered
 * handshake returns -- the two are deliberately the same, because the page must
 * not flash a gate on launch and then take it away.
 *
 * Order matters. The zero-healthy verdict is tested before the model count
 * because it answers the same question more precisely and carries the extra way
 * out; testing the count first would show state B ("check them") to someone
 * whose endpoints have just been checked.
 */
export function endpointWelcomeState(
  input: EndpointWelcomeInput,
): EndpointWelcomeState | undefined {
  if (input.hasEndpoints === undefined) return undefined;
  if (!input.hasEndpoints) return 'no-profiles';
  if ((input.checkedProfileCount ?? 0) > 0 && input.healthyModelCount === 0) return 'none-healthy';
  if (input.modelCount === 0) return 'unchecked';
  return undefined;
}

/**
 * Whether any endpoint is configured, as the gate should read it right now.
 *
 * The rule the page keeps: the chat shows only when an endpoint is configured,
 * and the welcome shows otherwise -- on first open, after closing and
 * reopening the panel, after a window reload. The handshake that answers the
 * question takes a moment, and what the gate did in that moment decided which
 * of two bugs you got. Read as "no gate", it showed the chat page to a fresh
 * install whenever the answer was late or never came (a reopened panel whose
 * `init` was lost). Read as "no endpoint", it would flash the welcome at
 * everyone who has one, on every launch.
 *
 * So the last answer this webview saw stands in until the live one arrives.
 * A fresh install has none, and gets the welcome; someone with an endpoint
 * gets the chat straight away. The live answer always wins once it lands.
 */
export function resolveHasEndpoints(
  live: boolean | undefined,
  lastKnown: boolean | undefined,
): boolean {
  return live ?? lastKnown ?? false;
}

/** Where the last live answer is kept. Per webview origin, like the skip flag. */
export const KNOWN_HAS_ENDPOINTS_KEY = 'forge.hasEndpoints';

export function readKnownHasEndpoints(): boolean | undefined {
  try {
    const value = globalThis.localStorage?.getItem(KNOWN_HAS_ENDPOINTS_KEY);
    return value === '1' ? true : value === '0' ? false : undefined;
  } catch {
    return undefined;
  }
}

export function writeKnownHasEndpoints(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(KNOWN_HAS_ENDPOINTS_KEY, value ? '1' : '0');
  } catch {
    // Without storage the next launch simply waits on the handshake, showing
    // the welcome meanwhile: the safe direction for a fresh install.
  }
}

/**
 * Whether the user pressed "Skip to chat" here.
 *
 * Per workspace, in the webview's own storage, for the same reason the health
 * verdicts are per machine: skipping is a statement about *this* checkout's
 * endpoints. It is cleared the moment a later sweep finds something healthy or
 * the profiles go away -- so it silences a verdict already overruled without
 * silencing a real one that arrives later.
 */
export const SKIPPED_WELCOME_KEY = 'forge.endpointWelcomeSkipped';

export function readSkippedWelcome(): boolean {
  try {
    return globalThis.localStorage?.getItem(SKIPPED_WELCOME_KEY) === '1';
  } catch {
    // Without storage the gate simply comes back on reload, which is the safe
    // direction to fail in: it is a notice the user can dismiss again, not work
    // they lose.
    return false;
  }
}

export function writeSkippedWelcome(skipped: boolean): void {
  try {
    if (skipped) globalThis.localStorage?.setItem(SKIPPED_WELCOME_KEY, '1');
    else globalThis.localStorage?.removeItem(SKIPPED_WELCOME_KEY);
  } catch {
    // As above.
  }
}

/**
 * Whether a skip still applies.
 *
 * Kept beside the gate so the clearing rule and the gate itself cannot drift:
 * a skip that outlived its verdict would hide the page from someone whose
 * endpoints broke *after* they skipped.
 */
export function skipStillApplies(input: {
  hasEndpoints: boolean | undefined;
  healthyModelCount: number | undefined;
}): boolean {
  if (input.hasEndpoints === false) return false;
  return (input.healthyModelCount ?? 0) === 0;
}
