/**
 * Prompt caching, for latency rather than money.
 *
 * Cost tracking is explicitly out of scope here -- these are self-hosted models
 * on company servers. Caching still matters, because re-processing a 40,000
 * token prefix on every turn is the difference between a reply that starts in
 * under a second and one that starts in fifteen.
 *
 * The three modes do genuinely different things:
 *
 *   "anthropic"  emit `cache_control` breakpoints and let the gateway act on
 *                them. Only meaningful on an Anthropic-shaped gateway.
 *   "prefix"     send no cache directives at all, but keep the head of the
 *                prompt byte-stable so a vLLM or SGLang automatic prefix cache
 *                hits it. This is the useful setting for most self-hosted
 *                servers, which cache by matching the longest common prefix of
 *                the token stream and need no instruction to do it.
 *   "none"       neither, and the default. These are arbitrary enterprise
 *                gateways, and an unknown field is a 400 on some of them, so
 *                caching is opt-in per profile rather than assumed.
 *
 * `cache_control` is stripped whenever the mode is not "anthropic". That is not
 * tidiness: the CLI emits those breakpoints unconditionally, and a gateway that
 * has never heard of the field rejects the whole request because of it.
 */
import type { Capabilities } from '../profile';

/**
 * Remove every `cache_control` marker from an Anthropic request body.
 *
 * Returns a structurally-shared copy: objects on the path to a stripped marker
 * are rebuilt, everything else is reused. The request is large and mostly
 * conversation history, so deep-cloning it on every turn would be a real cost
 * for no benefit.
 *
 * @returns the cleaned value and how many markers were removed.
 */
export function stripCacheControl<T>(value: T): { value: T; removed: number } {
  let removed = 0;

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      let changed = false;
      const out = node.map((item) => {
        const next = walk(item);
        if (next !== item) changed = true;
        return next;
      });
      return changed ? out : node;
    }

    if (node && typeof node === 'object') {
      const source = node as Record<string, unknown>;
      let changed = false;
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(source)) {
        if (key === 'cache_control') {
          removed += 1;
          changed = true;
          continue;
        }
        const next = walk(item);
        if (next !== item) changed = true;
        out[key] = next;
      }
      return changed ? out : node;
    }

    return node;
  };

  return { value: walk(value) as T, removed };
}

/**
 * Whether this profile wants `cache_control` markers left on the request.
 *
 * Only an Anthropic-wire gateway can act on them, and only when the profile
 * says it does. On the OpenAI bridge the markers have no representation at all,
 * so they are dropped during translation regardless of this.
 */
export function keepsCacheControl(caps: Capabilities): boolean {
  return caps.promptCaching === 'anthropic';
}

/**
 * Anything that must not vary between turns for a prefix cache to hit.
 *
 * Kept as an explicit, documented list rather than a rule applied silently,
 * because the failure it prevents is invisible: a prefix cache that never hits
 * looks exactly like a slow endpoint. The Genesis note on cache counters says
 * the same thing from the other side -- `cache_read_input_tokens` stuck at zero
 * across turns of one conversation means something in the prefix is changing.
 *
 * The bridge itself introduces no per-turn variation: it derives the body from
 * the request, merges `extraBody` last, and serialises with a stable key order.
 * This function exists so a future change that *would* introduce variation has
 * somewhere obvious to fail.
 */
export function prefixStabilityWarnings(body: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  // A per-request identifier in the body defeats prefix matching outright.
  for (const key of ['request_id', 'session_id', 'timestamp', 'nonce']) {
    if (key in body) {
      warnings.push(
        `extraBody carries "${key}", which changes every turn and will stop a ` +
        `prefix cache from ever hitting`,
      );
    }
  }
  return warnings;
}
