/**
 * Detect a gateway that silently truncated the prompt.
 *
 * Ollama answers a prompt longer than its context window by dropping tokens
 * from the *front* -- no error, no warning in the response, only a line in the
 * server log. The front is where Claude Code keeps its system prompt and the
 * tool definitions, so a small model that loses them starts inventing tool
 * names and looping, which looks like the model's fault and is not. The
 * default window is small (4,096 tokens below ~23 GiB of VRAM, 2,048 in older
 * releases), Claude Code's system prompt and tools alone are larger than that,
 * and the OpenAI-compatible route has no per-request way to raise it.
 *
 * The evidence is in the response: the gateway reports how many prompt tokens
 * it actually processed, and the relay knows roughly how many it sent. A
 * reported count far below the estimate means the rest never reached the
 * model. llama.cpp and LM Studio fail the same way when their context is set
 * below the prompt, and a proxy that trims history does too, so the check is
 * not Ollama-specific -- only the advice is.
 *
 * Deliberately conservative: `estimateTokens` is chars/4, which already
 * *under*-counts code (closer to 3 chars/token), so a real prompt reported at
 * under half the estimate cannot be a tokenizer difference.
 */
import type { EndpointProfile } from '../profile';

/** Reported below this fraction of the estimate counts as truncated. */
export const TRUNCATION_RATIO = 0.5;

/**
 * Below this estimate the check does not run. A short prompt measured by two
 * different tokenizers can differ by more than half; a long one cannot.
 */
export const MIN_ESTIMATE_FOR_CHECK = 4_000;

export interface TruncationFinding {
  /** Prompt tokens the gateway says it processed. */
  reported: number;
  /** Prompt tokens the relay estimates it sent (text only). */
  estimated: number;
}

/**
 * Was the prompt cut short?
 *
 * @param reported the gateway's `usage.prompt_tokens`, or undefined when it
 *   reported none -- in which case there is no evidence either way.
 * @param estimated the relay's text-only estimate of what it sent.
 */
export function detectTruncation(
  reported: number | undefined,
  estimated: number,
): TruncationFinding | undefined {
  if (typeof reported !== 'number' || !Number.isFinite(reported) || reported <= 0) return undefined;
  if (estimated < MIN_ESTIMATE_FOR_CHECK) return undefined;
  if (reported >= estimated * TRUNCATION_RATIO) return undefined;
  return { reported, estimated };
}

/** Does this profile look like an Ollama server? */
export function looksLikeOllama(profile: Pick<EndpointProfile, 'baseUrl'>): boolean {
  try {
    const url = new URL(profile.baseUrl);
    return url.port === '11434' || /ollama/i.test(url.hostname);
  } catch {
    return /:11434\b|ollama/i.test(profile.baseUrl);
  }
}

/**
 * What to tell the user, with the fix for the server they are most likely on.
 *
 * The window to ask for is rounded up to a power of two above what was sent,
 * because that is what server settings are normally given in and a number the
 * user can type without doing arithmetic.
 */
export function truncationAdvice(
  profile: Pick<EndpointProfile, 'name' | 'baseUrl'>,
  finding: TruncationFinding,
): string {
  const needed = 2 ** Math.ceil(Math.log2(Math.max(finding.estimated, 8192) * 1.25));
  const head =
    `[${profile.name}] The endpoint processed only ${finding.reported.toLocaleString('en-US')} of about ` +
    `${finding.estimated.toLocaleString('en-US')} prompt tokens, so the start of the prompt -- the ` +
    `instructions and the tool list -- never reached the model. Expect invented tool names and loops ` +
    `until the server's context window is raised.`;
  const fix = looksLikeOllama(profile)
    ? ` Ollama: set OLLAMA_CONTEXT_LENGTH=${needed} on the server and restart it, or create a model ` +
      `with "PARAMETER num_ctx ${needed}" in its Modelfile.`
    : ` Raise the server's context length to at least ${needed} tokens ` +
      `(vLLM --max-model-len, llama.cpp -c, LM Studio "Context Length").`;
  return head + fix;
}
