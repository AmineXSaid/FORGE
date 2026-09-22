/**
 * Ask an endpoint what it can actually do.
 *
 * The capability block is a set of promises the UI relies on: declare
 * `tools: true` against a gateway that drops the field and every turn silently
 * falls back to text; declare `effort: true` against one that ignores
 * `reasoning_effort` and the user gets four rungs that all produce the same
 * answer. Both are guesses someone makes once and never revisits.
 *
 * The diagnostics ladder cannot answer this, because it only exercises what the
 * profile has already switched on -- a capability set to false is reported as
 * "disabled in this profile", which is the question rather than the answer.
 * These probes run regardless of the current setting.
 *
 * Two design rules, carried over from Genesis and worth restating because they
 * are what make the results trustworthy:
 *
 *   - **A failure is an answer ("no"), not an error.** One unsupported feature
 *     never stops the rest of the sweep.
 *   - **Accepting the field is not support.** The tools probe requires the model
 *     to come back with an actual tool call; one that answers in text instead
 *     would do the same thing during a real turn.
 *
 * Nothing here writes to settings. The report carries a `patch` the user
 * accepts or rejects -- the profile stays the source of truth.
 */
import type { Dispatcher } from 'undici';
import type { Capabilities, EndpointProfile } from './profile';
import { probeComplete, type ProbeOutcome } from './probeClient';

export type CapProbe =
  | 'streaming'
  | 'tools'
  | 'parallelToolCalls'
  | 'vision'
  | 'reasoning'
  | 'reasoningField'
  | 'effort';

export interface CapResult {
  name: CapProbe;
  /** What the endpoint did. `undefined` when the probe could not run at all. */
  supported?: boolean;
  detail: string;
  ms: number;
}

export interface DetectReport {
  results: CapResult[];
  /**
   * The subset that can be written with confidence -- a *proposal*, never
   * applied automatically.
   */
  patch: Partial<Capabilities>;
}

const PING_TOOL = {
  name: 'ping',
  description: 'A connectivity check.',
  input_schema: {
    type: 'object',
    properties: { value: { type: 'number', description: 'Any number.' } },
    required: ['value'],
  },
};
const PONG_TOOL = { ...PING_TOOL, name: 'pong', description: 'A second connectivity check.' };

/** A one-pixel transparent PNG: the smallest thing that is unambiguously an image. */
export const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function timed(
  fn: () => Promise<ProbeOutcome>,
): Promise<[ProbeOutcome | undefined, unknown, number]> {
  const t0 = Date.now();
  try {
    return [await fn(), undefined, Date.now() - t0];
  } catch (e) {
    return [undefined, e, Date.now() - t0];
  }
}

const msgOf = (e: unknown): string => String((e as any)?.message ?? e).slice(0, 200);

export interface DetectOptions {
  profile: EndpointProfile;
  dispatcher: Dispatcher;
  headers: Record<string, string>;
  signal?: AbortSignal;
  /** Called as each probe finishes, so a panel can fill in progressively. */
  onResult?: (result: CapResult) => void;
}

export async function detectCapabilities(options: DetectOptions): Promise<DetectReport> {
  const { profile, dispatcher, headers, signal, onResult } = options;
  const results: CapResult[] = [];
  const patch: Partial<Capabilities> = {};

  const record = (result: CapResult): void => {
    results.push(result);
    onResult?.(result);
  };

  /** Run one probe against the endpoint, bypassing the profile's own gating. */
  const run = (request: Parameters<typeof probeComplete>[3]) =>
    timed(() => probeComplete(
      // Probes must not be filtered by the capability block they are measuring:
      // a profile that says `tools: false` would otherwise have its tool probe
      // silently stripped and answer "no" to its own assumption.
      { ...profile, capabilities: { ...profile.capabilities, tools: true, vision: true, effort: true } },
      dispatcher,
      headers,
      request,
      signal,
    ));

  // ── streaming ──────────────────────────────────────────────────────────
  // More than one chunk is the only proof. A gateway that buffers the whole
  // answer into a single frame is not streaming however it answers, and the
  // typewriter would sit still until the end.
  {
    const [out, err, ms] = await run({
      messages: [{ role: 'user', content: 'Count from one to eight, one word per line.' }],
      max_tokens: 64,
      stream: true,
    });
    if (err) {
      record({ name: 'streaming', supported: false, detail: msgOf(err), ms });
      patch.streaming = false;
    } else if ((out?.chunks ?? 0) > 1) {
      record({ name: 'streaming', supported: true, detail: `${out!.chunks} incremental chunks.`, ms });
      patch.streaming = true;
    } else {
      record({
        name: 'streaming',
        supported: false,
        detail: 'The whole answer arrived in one frame, so nothing is gained by streaming.',
        ms,
      });
      patch.streaming = false;
    }
  }

  // ── tools ──────────────────────────────────────────────────────────────
  {
    const [out, err, ms] = await run({
      messages: [{ role: 'user', content: 'Call the ping tool with value 1. Do not reply in text.' }],
      tools: [PING_TOOL],
      max_tokens: 128,
    });
    const called = out?.toolCalls[0]?.name;
    if (err) {
      record({ name: 'tools', supported: false, detail: msgOf(err), ms });
      patch.tools = false;
    } else if (called) {
      record({ name: 'tools', supported: true, detail: `Model invoked "${called}".`, ms });
      patch.tools = true;
    } else {
      record({
        name: 'tools',
        supported: false,
        detail: 'The endpoint accepted the tools field but the model answered in text.',
        ms,
      });
      patch.tools = false;
    }
  }

  // ── parallel tool calls ────────────────────────────────────────────────
  if (patch.tools) {
    const [out, err, ms] = await run({
      messages: [{ role: 'user', content: 'Call both ping and pong, each with value 1, in the same turn.' }],
      tools: [PING_TOOL, PONG_TOOL],
      max_tokens: 192,
    });
    if (err) {
      record({ name: 'parallelToolCalls', supported: false, detail: msgOf(err), ms });
      patch.parallelToolCalls = false;
    } else {
      const count = out?.toolCalls.length ?? 0;
      const ok = count > 1;
      record({
        name: 'parallelToolCalls',
        supported: ok,
        detail: ok ? `${count} tool calls in one turn.` : `Only ${count} call per turn.`,
        ms,
      });
      patch.parallelToolCalls = ok;
    }
  } else {
    record({
      name: 'parallelToolCalls',
      detail: 'Not probed: the endpoint has no working tool calling.',
      ms: 0,
    });
  }

  // ── vision ─────────────────────────────────────────────────────────────
  // A gateway without it answers an image block with a 400, which is a clean
  // no. Anything that completes is a yes.
  {
    const [out, err, ms] = await run({
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: TINY_PNG } },
          { type: 'text', text: 'Reply with the single word: seen.' },
        ],
      }],
      max_tokens: 32,
    });
    if (err) {
      record({ name: 'vision', supported: false, detail: msgOf(err), ms });
      patch.vision = false;
    } else {
      record({
        name: 'vision',
        supported: true,
        detail: `Accepted an image block. Answered: ${(out?.text ?? '').trim().slice(0, 40)}`,
        ms,
      });
      patch.vision = true;
    }
  }

  // ── reasoning, and which field carries it ──────────────────────────────
  // Beyond Genesis's five. Which delta field carries reasoning varies by
  // gateway -- vLLM and DeepSeek-shaped APIs use `reasoning_content`,
  // OpenRouter and several aggregators use `reasoning`. Guessing wrong renders
  // a turn that spent its whole budget thinking as an empty reply.
  let reasoningOutcome: ProbeOutcome | undefined;
  {
    const [out, err, ms] = await run({
      messages: [{ role: 'user', content: 'What is 17 times 23? Think it through.' }],
      max_tokens: 256,
      stream: true,
    });
    reasoningOutcome = out;
    const saw = Boolean(out?.reasoning);
    record({
      name: 'reasoning',
      supported: err ? undefined : saw,
      detail: err
        ? msgOf(err)
        : saw
          ? 'The model streams a separate reasoning channel.'
          : 'No separate reasoning channel; the answer is the whole output.',
      ms,
    });

    if (!err) {
      const field = out?.reasoningField ?? 'none';
      patch.reasoningField = field;
      record({
        name: 'reasoningField',
        supported: field !== 'none',
        detail: field === 'none'
          ? 'Nothing arrived on a reasoning channel, so there is no field to read.'
          : `Reasoning arrived on "${field}".`,
        ms: 0,
      });
    }
  }

  // ── effort ─────────────────────────────────────────────────────────────
  // Beyond Genesis's five, and the one that matters most for keeping the
  // Anthropic UI honest. The same prompt at low and at high: if the endpoint
  // honours the field, the amount of thinking changes. If it does not, the
  // rows must be hidden rather than shown and inert.
  {
    const prompt = 'A farmer has 17 sheep, and all but 9 run away. How many are left? Think it through.';
    const at = (level: string) => run({
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 512,
      stream: true,
      effort: level,
    });

    const [low, lowErr, lowMs] = await at('low');
    const [high, highErr, highMs] = await at('high');
    const ms = lowMs + highMs;

    if (lowErr || highErr) {
      // A 400 on the field is a clean no.
      record({ name: 'effort', supported: false, detail: msgOf(lowErr ?? highErr), ms });
      patch.effort = false;
    } else {
      const lowWork = low?.usage.reasoningTokens ?? low?.usage.output ?? 0;
      const highWork = high?.usage.reasoningTokens ?? high?.usage.output ?? 0;
      const measure = low?.usage.reasoningTokens !== undefined ? 'reasoning tokens' : 'output tokens';
      // A meaningful difference, not noise. Two runs of the same model vary a
      // little; a gateway that honours the field varies a lot.
      const ratio = lowWork > 0 ? highWork / lowWork : highWork > 0 ? Infinity : 1;
      const honoured = ratio >= 1.25 || ratio <= 0.8;
      record({
        name: 'effort',
        supported: honoured,
        detail: honoured
          ? `${measure} changed with the rung: ${lowWork} at low, ${highWork} at high.`
          : `${measure} barely moved: ${lowWork} at low, ${highWork} at high. ` +
            'The endpoint accepts reasoning_effort and ignores it.',
        ms,
      });
      patch.effort = honoured;
      if (honoured) {
        // Only the two rungs actually measured are claimed. Proposing xhigh
        // from evidence about high would be inventing the thing that decides
        // whether Ultracode is offered.
        patch.effortLevels = ['low', 'medium', 'high'];
      }
    }
  }

  void reasoningOutcome;
  return { results, patch };
}
