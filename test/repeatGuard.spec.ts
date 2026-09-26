/**
 * A6: the repeat guard.
 *
 * A model that gets a tool error back will often re-send the identical call, or
 * re-invent the same unknown tool name, several times in one turn. The
 * alphacode session that motivated this burned twelve calls and about two
 * minutes on three tool names that could never resolve.
 *
 * The two tiers have different limits for a reason worth keeping straight:
 * an unknown *name* cannot start resolving by being repeated, so one retry is
 * the most that helps; a real tool failing on identical *input* might be
 * transient, so it gets one more chance before being stopped.
 */
import { describe, expect, it } from 'vitest';
import {
  IDENTICAL_FAILURE_LIMIT,
  RepeatGuard,
  UNKNOWN_NAME_LIMIT,
  inputKey,
  isUnknownToolError,
} from '../src/services/claude/repeatGuard';

const S = 'session-1';
const NOT_FOUND = 'Error: No such tool available: ls.intent';
const REAL_FAILURE = 'ENOENT: no such file or directory';

describe('isUnknownToolError: which tier a failure belongs to', () => {
  it.each([
    'No such tool available: ls.intent',
    'Unknown tool: selfdev.intent',
    'Tool "bash.intent" is not available',
    'foo is not a valid tool',
  ])('recognises %s as a name problem', (error) => {
    expect(isUnknownToolError(error)).toBe(true);
  });

  it.each([
    'ENOENT: no such file or directory',
    'Permission denied',
    'Command failed with exit code 1',
    'File has not been read yet',
  ])('treats %s as an argument problem', (error) => {
    expect(isUnknownToolError(error)).toBe(false);
  });
});

describe('inputKey: the same call in a different key order is still the same call', () => {
  it('is stable across key order', () => {
    expect(inputKey({ a: 1, b: 2 })).toBe(inputKey({ b: 2, a: 1 }));
  });

  it('is stable for nested objects', () => {
    expect(inputKey({ o: { x: 1, y: 2 } })).toBe(inputKey({ o: { y: 2, x: 1 } }));
  });

  it('distinguishes genuinely different inputs', () => {
    expect(inputKey({ path: 'a.ts' })).not.toBe(inputKey({ path: 'b.ts' }));
  });

  it('keeps array order significant, because it is', () => {
    expect(inputKey([1, 2])).not.toBe(inputKey([2, 1]));
  });

  it('never treats an unserialisable input as a repeat', () => {
    const cyclic: any = {};
    cyclic.self = cyclic;
    expect(inputKey(cyclic)).not.toBe(inputKey(cyclic));
  });
});

describe('the unknown-name tier', () => {
  it('refuses the second attempt: a name cannot resolve by being repeated', () => {
    const guard = new RepeatGuard();
    // Attempt 1 runs, and its error is how the model learns the name is wrong.
    expect(guard.check(S, 'ls.intent', {}).refuse).toBe(false);

    guard.recordFailure(S, 'ls.intent', {}, NOT_FOUND);

    // Attempt 2 is refused.
    const verdict = guard.check(S, 'ls.intent', {});
    expect(verdict.refuse).toBe(true);
    expect(verdict.tier).toBe('unknown-name');
  });

  it('refuses regardless of the arguments, because the name is the problem', () => {
    const guard = new RepeatGuard();
    guard.recordFailure(S, 'ls.intent', { path: 'a' }, NOT_FOUND);
    expect(guard.check(S, 'ls.intent', { path: 'completely-different' }).refuse).toBe(true);
  });

  it('explains why, so the model stops instead of trying again', () => {
    const guard = new RepeatGuard();
    guard.recordFailure(S, 'ls.intent', {}, NOT_FOUND);
    const { reason } = guard.check(S, 'ls.intent', {});
    expect(reason).toMatch(/does not exist/);
    expect(reason).toMatch(/cannot succeed/);
    expect(reason).toMatch(/ls\.intent/);
  });

  it('honours the documented limit', () => {
    const guard = new RepeatGuard();
    for (let i = 0; i < UNKNOWN_NAME_LIMIT; i++) guard.recordFailure(S, 'x', {}, NOT_FOUND);
    expect(guard.check(S, 'x', {}).refuse).toBe(true);
  });
});

describe('the identical-input tier', () => {
  it('allows two attempts, then refuses the third', () => {
    const guard = new RepeatGuard();
    const input = { file_path: 'a.ts' };

    // Attempt 1 fails. It might have been transient, so attempt 2 is allowed.
    guard.recordFailure(S, 'Read', input, REAL_FAILURE);
    expect(guard.check(S, 'Read', input).refuse).toBe(false);

    // Attempt 2 fails the same way. The model is not adapting; stop attempt 3.
    guard.recordFailure(S, 'Read', input, REAL_FAILURE);
    const verdict = guard.check(S, 'Read', input);
    expect(verdict.refuse).toBe(true);
    expect(verdict.tier).toBe('identical-input');
    expect(verdict.failures).toBe(IDENTICAL_FAILURE_LIMIT);
  });

  it('lets a changed argument through, which is the point', () => {
    const guard = new RepeatGuard();
    guard.recordFailure(S, 'Read', { file_path: 'a.ts' }, REAL_FAILURE);
    guard.recordFailure(S, 'Read', { file_path: 'a.ts' }, REAL_FAILURE);
    expect(guard.check(S, 'Read', { file_path: 'a.ts' }).refuse).toBe(true);
    // Adapting is exactly what the refusal asks for, so it must not be blocked.
    expect(guard.check(S, 'Read', { file_path: 'b.ts' }).refuse).toBe(false);
  });

  it('tells the model to change something rather than just saying no', () => {
    const guard = new RepeatGuard();
    const input = { file_path: 'a.ts' };
    guard.recordFailure(S, 'Read', input, REAL_FAILURE);
    guard.recordFailure(S, 'Read', input, REAL_FAILURE);
    const { reason } = guard.check(S, 'Read', input);
    expect(reason).toMatch(/change the arguments or use a different tool/);
    expect(reason).toMatch(/Last error: .*ENOENT/);
  });

  it('quotes the keys it received, so a misnamed argument is visible', () => {
    // alphacode repeat_guard.rs: the commonest identical failure from a small
    // model is a wrong key, and seeing its own keys beside the error is what
    // lets it notice.
    const guard = new RepeatGuard();
    const input = { path: 'a.ts', limit: 5 };
    guard.recordFailure(S, 'Read', input, REAL_FAILURE);
    guard.recordFailure(S, 'Read', input, REAL_FAILURE);
    expect(guard.check(S, 'Read', input).reason).toMatch(/Received keys: `path`, `limit`/);
  });
});

describe('the nudge before the refusal', () => {
  it('warns once, on the failure that makes the next identical call refusable', () => {
    // OpenHands get_action_error_nudge: one chance to change course before
    // being stopped, rather than a refusal out of nowhere.
    const guard = new RepeatGuard();
    const input = { file_path: 'a.ts' };
    expect(guard.recordFailure(S, 'Read', input, REAL_FAILURE)).toBeUndefined();
    const nudge = guard.recordFailure(S, 'Read', input, REAL_FAILURE);
    expect(nudge).toMatch(/same arguments 2 times/);
    expect(nudge).toMatch(/next identical attempt will be refused/);
    expect(nudge).toMatch(/ENOENT/);
    expect(guard.recordFailure(S, 'Read', input, REAL_FAILURE)).toBeUndefined();
  });

  it('does not nudge on a different call that happens to fail', () => {
    const guard = new RepeatGuard();
    guard.recordFailure(S, 'Read', { file_path: 'a.ts' }, REAL_FAILURE);
    expect(guard.recordFailure(S, 'Read', { file_path: 'b.ts' }, REAL_FAILURE)).toBeUndefined();
  });
});

describe('only failures count', () => {
  it('never blocks a tool the model legitimately polls', () => {
    const guard = new RepeatGuard();
    const input = { command: 'git status' };
    for (let i = 0; i < 20; i++) {
      expect(guard.check(S, 'Bash', input).refuse).toBe(false);
      guard.recordSuccess(S, 'Bash', input);
    }
  });

  it('clears a streak on success, so a transient failure is forgiven', () => {
    const guard = new RepeatGuard();
    const input = { file_path: 'a.ts' };
    guard.recordFailure(S, 'Read', input, REAL_FAILURE);
    guard.recordFailure(S, 'Read', input, REAL_FAILURE);
    expect(guard.check(S, 'Read', input).refuse).toBe(true);

    guard.recordSuccess(S, 'Read', input);
    expect(guard.check(S, 'Read', input).refuse).toBe(false);
  });
});

describe('sessions are isolated', () => {
  it('does not leak a streak between sessions', () => {
    const guard = new RepeatGuard();
    guard.recordFailure('a', 'ls.intent', {}, NOT_FOUND);
    guard.recordFailure('a', 'ls.intent', {}, NOT_FOUND);
    expect(guard.check('a', 'ls.intent', {}).refuse).toBe(true);
    expect(guard.check('b', 'ls.intent', {}).refuse).toBe(false);
  });

  it('drops one session without touching another', () => {
    const guard = new RepeatGuard();
    guard.recordFailure('a', 'x', {}, NOT_FOUND);
    guard.recordFailure('a', 'x', {}, NOT_FOUND);
    guard.recordFailure('b', 'x', {}, NOT_FOUND);
    guard.recordFailure('b', 'x', {}, NOT_FOUND);

    guard.clearSession('a');
    expect(guard.check('a', 'x', {}).refuse).toBe(false);
    expect(guard.check('b', 'x', {}).refuse).toBe(true);
  });
});

describe('the map is bounded', () => {
  it('evicts oldest entries rather than growing without limit', () => {
    const guard = new RepeatGuard();
    for (let i = 0; i < 700; i++) {
      guard.recordFailure(S, 'Read', { file_path: `f${i}.ts` }, REAL_FAILURE);
    }
    expect(guard.size).toBeLessThanOrEqual(512);
  });

  it('fails in the forgiving direction when it evicts', () => {
    // A forgotten streak costs one extra tool call. A wrongly-remembered one
    // would refuse a call that should run, which is the worse mistake.
    const guard = new RepeatGuard();
    const oldest = { file_path: 'oldest.ts' };
    guard.recordFailure(S, 'Read', oldest, REAL_FAILURE);
    guard.recordFailure(S, 'Read', oldest, REAL_FAILURE);
    expect(guard.check(S, 'Read', oldest).refuse).toBe(true);

    for (let i = 0; i < 600; i++) {
      guard.recordFailure(S, 'Read', { file_path: `f${i}.ts` }, REAL_FAILURE);
    }
    expect(guard.check(S, 'Read', oldest).refuse).toBe(false);
  });
});
