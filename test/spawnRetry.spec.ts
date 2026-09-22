/**
 * A1: retry and backoff, the process half.
 *
 * The constraint that matters most in A1 is a *negative* one, and it is
 * enforced across two layers:
 *
 *   - the relay retries connection-level failures only and passes every HTTP
 *     status through, because the CLI runs its own 429/529 backoff and
 *     retrying in both places multiplies the wait (covered in
 *     `wireServer.spec.ts`);
 *   - this layer retries neither, and covers only the case the CLI cannot
 *     retry itself: the process never started.
 *
 * The classification is narrow on purpose. A spawn failure is usually
 * permanent, and retrying a missing binary five times buys nothing but five
 * seconds in front of the message that would have explained it.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_RETRY_DELAY_MS,
  MAX_SPAWN_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  isPermanentSpawnError,
  isRetryableSpawnError,
  spawnFailureAdvice,
  spawnRetryDelayMs,
  withSpawnRetry,
} from '../src/services/claude/spawnRetry';

const err = (code: string) => Object.assign(new Error(code), { code });

describe('classification: transient machine conditions versus permanent mistakes', () => {
  it.each(['EAGAIN', 'EMFILE', 'ENFILE', 'ETXTBSY', 'EBUSY'])('retries %s', (code) => {
    expect(isRetryableSpawnError(err(code))).toBe(true);
    expect(isPermanentSpawnError(err(code))).toBe(false);
  });

  it.each(['ENOENT', 'EACCES', 'ENOEXEC', 'EPERM'])('never retries %s', (code) => {
    expect(isPermanentSpawnError(err(code))).toBe(true);
    expect(isRetryableSpawnError(err(code))).toBe(false);
  });

  it('does not retry an HTTP-shaped failure, which belongs to the CLI', () => {
    expect(isRetryableSpawnError(new Error('429 Too Many Requests'))).toBe(false);
    expect(isRetryableSpawnError(err('ECONNRESET'))).toBe(false);
  });

  it('treats an unclassified error as neither, so it surfaces immediately', () => {
    expect(isRetryableSpawnError(new Error('something else'))).toBe(false);
    expect(isPermanentSpawnError(new Error('something else'))).toBe(false);
  });
});

describe('backoff', () => {
  it('doubles from the base', () => {
    expect(spawnRetryDelayMs(1)).toBe(RETRY_BASE_DELAY_MS);
    expect(spawnRetryDelayMs(2)).toBe(RETRY_BASE_DELAY_MS * 2);
    expect(spawnRetryDelayMs(3)).toBe(RETRY_BASE_DELAY_MS * 4);
  });

  it('is capped, so five attempts cannot take a minute', () => {
    expect(spawnRetryDelayMs(20)).toBe(MAX_RETRY_DELAY_MS);
    const total = Array.from({ length: MAX_SPAWN_ATTEMPTS }, (_, i) => spawnRetryDelayMs(i + 1))
      .reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(30_000);
  });
});

describe('withSpawnRetry', () => {
  const sleep = () => Promise.resolve();

  it('returns the first success without sleeping', async () => {
    const launch = vi.fn().mockResolvedValue('query');
    expect(await withSpawnRetry(launch, '/cli', { sleep })).toBe('query');
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure and returns the eventual success', async () => {
    const launch = vi.fn()
      .mockRejectedValueOnce(err('EBUSY'))
      .mockRejectedValueOnce(err('EBUSY'))
      .mockResolvedValue('query');
    expect(await withSpawnRetry(launch, '/cli', { sleep })).toBe('query');
    expect(launch).toHaveBeenCalledTimes(3);
  });

  it('gives up after the attempt budget', async () => {
    const launch = vi.fn().mockRejectedValue(err('EAGAIN'));
    await expect(withSpawnRetry(launch, '/cli', { sleep, attempts: 3 })).rejects.toThrow('EAGAIN');
    expect(launch).toHaveBeenCalledTimes(3);
  });

  it('rethrows a permanent failure on the first attempt', async () => {
    // Retrying a missing binary only delays the message that explains it.
    const launch = vi.fn().mockRejectedValue(err('ENOENT'));
    await expect(withSpawnRetry(launch, '/cli', { sleep })).rejects.toThrow('ENOENT');
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('rethrows an unclassified failure immediately rather than guessing', async () => {
    const launch = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(withSpawnRetry(launch, '/cli', { sleep })).rejects.toThrow('boom');
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('reports each retry, so a slow start is visible rather than a silent hang', async () => {
    const lines: string[] = [];
    const launch = vi.fn().mockRejectedValueOnce(err('ETXTBSY')).mockResolvedValue('q');
    await withSpawnRetry(launch, '/cli', { sleep, log: (m) => lines.push(m) });
    expect(lines.join()).toMatch(/ETXTBSY.*attempt 1\/5.*retrying/);
  });

  it('logs advice for a permanent failure', async () => {
    const lines: string[] = [];
    const launch = vi.fn().mockRejectedValue(err('EACCES'));
    await expect(withSpawnRetry(launch, '/opt/claude', { sleep, log: (m) => lines.push(m) }))
      .rejects.toThrow();
    expect(lines.join()).toMatch(/not executable/);
  });

  it('waits between attempts using the backoff schedule', async () => {
    const waited: number[] = [];
    const launch = vi.fn()
      .mockRejectedValueOnce(err('EBUSY'))
      .mockRejectedValueOnce(err('EBUSY'))
      .mockResolvedValue('q');
    await withSpawnRetry(launch, '/cli', {
      sleep: async (ms) => { waited.push(ms); },
    });
    expect(waited).toEqual([RETRY_BASE_DELAY_MS, RETRY_BASE_DELAY_MS * 2]);
  });
});

describe('spawnFailureAdvice: the errno is accurate and tells a user nothing', () => {
  it('names the path for a missing binary', () => {
    expect(spawnFailureAdvice(err('ENOENT'), '/opt/claude')).toMatch(/not found at \/opt\/claude/);
  });

  it('suggests chmod for a permission problem', () => {
    expect(spawnFailureAdvice(err('EACCES'), '/opt/claude')).toMatch(/chmod \+x/);
  });

  it('names the wrong-architecture case', () => {
    expect(spawnFailureAdvice(err('ENOEXEC'), '/opt/claude')).toMatch(/architecture/);
  });

  it('points at antivirus for a policy refusal', () => {
    expect(spawnFailureAdvice(err('EPERM'), '/opt/claude')).toMatch(/antivirus|allow-list/);
  });

  it('says nothing it cannot back up', () => {
    expect(spawnFailureAdvice(err('EBUSY'), '/opt/claude')).toBeUndefined();
    expect(spawnFailureAdvice(new Error('x'), '/opt/claude')).toBeUndefined();
  });

  it('copes with no known path', () => {
    expect(spawnFailureAdvice(err('ENOENT'), undefined)).toMatch(/the configured path/);
  });
});
