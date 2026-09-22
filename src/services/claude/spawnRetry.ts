/**
 * Retry policy for launching the `claude` CLI.
 *
 * This is the *process* half of A1. The connection half lives in
 * `endpoints/wire/errors.ts` and `wire/anthropicServer.ts`, and the split
 * matters more than it looks:
 *
 *   - the **relay** retries connection-level failures only, and passes every
 *     HTTP status straight through, because the CLI runs its own 429/529
 *     backoff and retrying statuses in both places multiplies the wait into a
 *     session that appears hung for minutes;
 *   - **this** layer retries neither. It only covers the case where the CLI
 *     process could not be started at all, which the CLI cannot retry because
 *     it is not running yet.
 *
 * The classification is deliberately narrow. A spawn failure is usually
 * permanent -- a missing binary, a bad path, no execute permission -- and
 * retrying those five times buys nothing except five seconds of delay in front
 * of the error message that would have explained the problem immediately. Only
 * failures that are genuinely transient properties of the machine are retried.
 */

/** Attempts in total, including the first. Alphacode's MAX_RETRIES. */
export const MAX_SPAWN_ATTEMPTS = 5;

/** Base for the exponential backoff. Alphacode's RETRY_BASE_DELAY_MS. */
export const RETRY_BASE_DELAY_MS = 1_000;

/** Longest a single backoff may last, so five attempts cannot take a minute. */
export const MAX_RETRY_DELAY_MS = 8_000;

/**
 * Transient OS conditions: the machine is temporarily out of a resource the
 * spawn needs, and the same command will work shortly.
 *
 *   EAGAIN   the process table or thread limit is momentarily full
 *   EMFILE   this process is out of file descriptors
 *   ENFILE   the system is out of file descriptors
 *   ETXTBSY  the binary is being written right now (an update landing)
 *   EBUSY    Windows, typically an antivirus holding the file open
 *
 * `EBUSY` and `ETXTBSY` are the two that matter in practice on a developer
 * machine, because both happen while the CLI is being upgraded underneath a
 * running editor.
 */
const TRANSIENT_SPAWN_CODES = new Set(['EAGAIN', 'EMFILE', 'ENFILE', 'ETXTBSY', 'EBUSY']);

/**
 * Permanent spawn failures, listed so the reasoning is visible rather than
 * implied by absence.
 *
 *   ENOENT   the binary is not at that path
 *   EACCES   it is there and not executable
 *   ENOEXEC  it is there and not a runnable binary for this architecture
 *   EPERM    policy forbids executing it
 *
 * Retrying any of these delays a message the user needs to see now.
 */
const PERMANENT_SPAWN_CODES = new Set(['ENOENT', 'EACCES', 'ENOEXEC', 'EPERM']);

export function isPermanentSpawnError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return typeof code === 'string' && PERMANENT_SPAWN_CODES.has(code);
}

export function isRetryableSpawnError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return typeof code === 'string' && TRANSIENT_SPAWN_CODES.has(code);
}

/** Exponential backoff, capped. Attempt is 1-based. */
export function spawnRetryDelayMs(attempt: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1), MAX_RETRY_DELAY_MS);
}

/**
 * Explain a permanent spawn failure in terms of what to do about it.
 *
 * The raw errno is accurate and tells a user nothing. The CLI path is the thing
 * they can actually change.
 */
export function spawnFailureAdvice(error: unknown, cliPath: string | undefined): string | undefined {
  const code = (error as NodeJS.ErrnoException)?.code;
  switch (code) {
    case 'ENOENT':
      return `The Claude CLI was not found at ${cliPath ?? 'the configured path'}. ` +
        'Check the bundled binary shipped with this build, or set an explicit path.';
    case 'EACCES':
      return `${cliPath ?? 'The Claude CLI'} is not executable by this user. ` +
        'On macOS or Linux, chmod +x it.';
    case 'ENOEXEC':
      return `${cliPath ?? 'The Claude CLI'} is not runnable on this architecture. ` +
        'The wrong platform build may have been installed.';
    case 'EPERM':
      return `Running ${cliPath ?? 'the Claude CLI'} was refused by policy. ` +
        'Check antivirus or an execution allow-list.';
    default:
      return undefined;
  }
}

export interface SpawnRetryOptions {
  attempts?: number;
  /** Reports each retry, so a slow start is visible rather than a silent hang. */
  log?: (message: string) => void;
  /** Injectable for tests, so a spec does not really sleep. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Run `launch` with retries for transient spawn failures only.
 *
 * A permanent failure is rethrown on the first attempt, with advice attached
 * where there is any to give.
 */
export async function withSpawnRetry<T>(
  launch: () => Promise<T>,
  cliPath: string | undefined,
  options: SpawnRetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? MAX_SPAWN_ATTEMPTS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await launch();
    } catch (error) {
      lastError = error;

      if (isPermanentSpawnError(error)) {
        const advice = spawnFailureAdvice(error, cliPath);
        if (advice) options.log?.(`[spawn] ${advice}`);
        throw error;
      }
      if (!isRetryableSpawnError(error) || attempt >= attempts) {
        throw error;
      }

      const delay = spawnRetryDelayMs(attempt);
      options.log?.(
        `[spawn] ${(error as NodeJS.ErrnoException).code} starting the CLI ` +
        `(attempt ${attempt}/${attempts}); retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }

  throw lastError;
}
