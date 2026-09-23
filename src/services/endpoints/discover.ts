/**
 * Find the model runtimes already running on this machine.
 *
 * The guided flow asks five questions. For the most common first endpoint --
 * an Ollama or an LM Studio someone already has open -- four of those answers
 * are knowable without asking: the base URL is a well-known port, the wire is
 * OpenAI, there is no token, and the runtime will name its own models. So the
 * setup page offers what is actually running, and the five questions become
 * "which model?".
 *
 * Every runtime here speaks the OpenAI wire on a documented default port and
 * answers `GET /v1/models` unauthenticated, which is what makes this possible.
 * A runtime on a non-default port simply is not found, and the full flow is
 * still there.
 *
 * The probe is injected rather than imported so this is testable without a
 * network and without a model server.
 */

/** A local runtime Forge knows how to reach without being told. */
export interface LocalRuntime {
    id: string;
    /** What the picker calls it. */
    label: string;
    /** Its documented default. */
    baseUrl: string;
    /** All of these speak Chat Completions. */
    wire: 'openai';
    /** One line for the picker's detail row. */
    hint: string;
}

/**
 * Ports are each runtime's documented default, not a guess.
 *
 * Ordered by how likely someone is to be running it, because the picker shows
 * them in this order when nothing is detected.
 */
export const LOCAL_RUNTIMES: readonly LocalRuntime[] = [
    {
        id: 'ollama',
        label: 'Ollama',
        baseUrl: 'http://localhost:11434/v1',
        wire: 'openai',
        hint: 'Local models, OpenAI-compatible on port 11434.',
    },
    {
        id: 'lmstudio',
        label: 'LM Studio',
        baseUrl: 'http://localhost:1234/v1',
        wire: 'openai',
        hint: 'Its local server, on port 1234.',
    },
    {
        id: 'vllm',
        label: 'vLLM',
        baseUrl: 'http://localhost:8000/v1',
        wire: 'openai',
        hint: 'A self-hosted vLLM server, on port 8000.',
    },
    {
        id: 'llamacpp',
        label: 'llama.cpp',
        baseUrl: 'http://localhost:8080/v1',
        wire: 'openai',
        hint: 'llama-server, on port 8080.',
    },
    {
        id: 'jan',
        label: 'Jan',
        baseUrl: 'http://localhost:1337/v1',
        wire: 'openai',
        hint: 'Jan’s local API server, on port 1337.',
    },
];

/** A runtime that answered, and what it said it serves. */
export interface Discovery {
    runtime: LocalRuntime;
    /** Model ids the runtime listed. Empty means it answered but serves nothing. */
    models: string[];
}

/**
 * Ask one base URL for its model list.
 *
 * `undefined` means "nothing is there" -- a refused connection, a timeout, a
 * 404, anything. Only a real answer counts as a detection.
 */
export type ModelProbe = (baseUrl: string) => Promise<string[] | undefined>;

/**
 * Probe every known runtime at once and keep the ones that answer.
 *
 * Concurrent because this runs while someone is looking at a picker: five
 * sequential connection refusals on a slow loopback is a visible pause, and
 * five parallel ones is not. Results keep `LOCAL_RUNTIMES` order rather than
 * completion order, so the list does not reshuffle between runs.
 */
export async function discoverLocalRuntimes(
    probe: ModelProbe,
    /**
     * Called once per runtime as its probe settles, found or not, so a picker
     * already on screen can fill in as answers arrive instead of waiting on
     * the slowest one.
     */
    onSettled?: (runtime: LocalRuntime, found: Discovery | undefined) => void,
): Promise<Discovery[]> {
    const results = await Promise.all(
        LOCAL_RUNTIMES.map(async (runtime): Promise<Discovery | undefined> => {
            let found: Discovery | undefined;
            try {
                const models = await probe(runtime.baseUrl);
                found = models === undefined ? undefined : { runtime, models };
            } catch {
                // A probe that throws is a runtime that is not there.
                found = undefined;
            }
            onSettled?.(runtime, found);
            return found;
        }),
    );
    return results.filter((r): r is Discovery => r !== undefined);
}

/**
 * How long one local probe may take.
 *
 * A runtime on loopback answers in milliseconds or is not there; waiting
 * longer only delays the picker. The profile-level `timeoutMs` this used to
 * pass was never applied -- the model listing it reused allows 15s for headers
 * alone -- so on a machine where loopback is slow to refuse, "Set up an
 * endpoint" sat for seconds with nothing on screen.
 */
export const LOCAL_PROBE_TIMEOUT_MS = 1500;

/**
 * Race a probe against its budget. A probe that has not answered in time is a
 * runtime that is not there, reported as `undefined` like any other miss.
 */
export function boundedProbe(probe: ModelProbe, timeoutMs = LOCAL_PROBE_TIMEOUT_MS): ModelProbe {
    return (baseUrl) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<undefined>((resolve) => {
            timer = setTimeout(() => resolve(undefined), timeoutMs);
        });
        return Promise.race([probe(baseUrl).catch(() => undefined), timeout]).finally(() => clearTimeout(timer));
    };
}

/**
 * A profile name that will not collide with one already defined.
 *
 * `ollama`, then `ollama-2`, and so on. The name is a settings key and the
 * value of `forge.endpointProfile`, so it has to be unique but should still
 * read like the thing it points at.
 */
export function suggestProfileName(base: string, taken: Iterable<string>): string {
    const existing = new Set(taken);
    if (!existing.has(base)) return base;
    for (let n = 2; n < 100; n++) {
        const candidate = `${base}-${n}`;
        if (!existing.has(candidate)) return candidate;
    }
    return `${base}-${Date.now()}`;
}
