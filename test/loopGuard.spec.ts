/**
 * The loop guard: a model going round in circles is told once, then stopped.
 *
 * The cases that matter most are the ones that must NOT trigger. A guard that
 * interrupts a model reading twenty different files, or re-running tests after
 * an edit, would be switched off within a day. So the key includes the result
 * (a poll that returns something new is progress) and a batch over different
 * files never looks like a cycle.
 */
import { describe, expect, it } from 'vitest';
import { findCycle, LoopGuard, stepKey, thresholdsFor } from '../src/services/claude/loopGuard';

const S = 'session-1';

/** Feed a list of [tool, input, outcome] steps; return the verdicts. */
function feed(guard: LoopGuard, steps: [string, unknown, string][], level: 'strict' | 'standard' | 'off' = 'strict') {
  return steps.map(([tool, input, outcome]) => guard.record(S, level, tool, input, outcome));
}

const read = (file: string, result = 'contents'): [string, unknown, string] => ['Read', { file_path: file }, result];
const bash = (command: string, result: string, description = 'run it'): [string, unknown, string] =>
  ['Bash', { command, description }, result];

describe('thresholds', () => {
  it('strict flags at 3 repeats, standard at 5, off never', () => {
    expect(thresholdsFor('strict')).toEqual({ repeats: 3 });
    expect(thresholdsFor('standard')).toEqual({ repeats: 5 });
    expect(thresholdsFor('off')).toBeUndefined();
  });
});

describe('what counts as a loop', () => {
  it('the same call with the same result three times in a row (strict)', () => {
    const verdicts = feed(new LoopGuard(), [read('a.ts'), read('a.ts'), read('a.ts')]);
    expect(verdicts.map((v) => v.action)).toEqual(['none', 'none', 'nudge']);
  });

  it('an edit/build cycle that fails the same way each time', () => {
    const edit: [string, unknown, string] = ['Edit', { file_path: 'a.ts', old_string: 'x', new_string: 'y' }, 'error:String to replace not found'];
    const build = bash('npm run build', 'error TS2304: Cannot find name y');
    const verdicts = feed(new LoopGuard(), [edit, build, edit, build, edit, build]);
    expect(verdicts.at(-1)).toMatchObject({ action: 'nudge' });
    expect((verdicts.at(-1) as any).detail).toMatch(/2-step cycle \(Edit → Bash\) 3 times/);
  });

  it('a three-step cycle', () => {
    const cycle = [read('a.ts'), bash('npm test', 'FAIL'), read('b.ts')];
    const verdicts = feed(new LoopGuard(), [...cycle, ...cycle, ...cycle]);
    expect(verdicts.at(-1)?.action).toBe('nudge');
  });

  it('ignores a reworded Bash description: it is the same command', () => {
    const verdicts = feed(new LoopGuard(), [
      bash('ls', 'a b', 'list files'),
      bash('ls', 'a b', 'look again'),
      bash('ls', 'a b', 'one more time'),
    ]);
    expect(verdicts.at(-1)?.action).toBe('nudge');
  });
});

describe('what must not count', () => {
  it('reading many different files', () => {
    const verdicts = feed(new LoopGuard(), Array.from({ length: 20 }, (_, i) => read(`file${i}.ts`)));
    expect(verdicts.every((v) => v.action === 'none')).toBe(true);
  });

  it('a poll whose result changes each time', () => {
    const verdicts = feed(new LoopGuard(), [
      bash('gh run view', 'in_progress 10%'),
      bash('gh run view', 'in_progress 50%'),
      bash('gh run view', 'in_progress 90%'),
      bash('gh run view', 'completed'),
    ]);
    expect(verdicts.every((v) => v.action === 'none')).toBe(true);
  });

  it('re-running tests after an edit in between', () => {
    const verdicts = feed(new LoopGuard(), [
      bash('npm test', 'FAIL 3'),
      ['Edit', { file_path: 'a.ts', old_string: '1', new_string: '2' }, 'ok'],
      bash('npm test', 'FAIL 2'),
      ['Edit', { file_path: 'a.ts', old_string: '2', new_string: '3' }, 'ok'],
      bash('npm test', 'PASS'),
    ]);
    expect(verdicts.every((v) => v.action === 'none')).toBe(true);
  });

  it('two repeats under strict, four under standard', () => {
    expect(feed(new LoopGuard(), [read('a'), read('a')]).every((v) => v.action === 'none')).toBe(true);
    expect(feed(new LoopGuard(), [read('a'), read('a'), read('a'), read('a')], 'standard')
      .every((v) => v.action === 'none')).toBe(true);
  });

  it('anything at all when the guards are off', () => {
    const verdicts = feed(new LoopGuard(), Array.from({ length: 12 }, () => read('a.ts')), 'off');
    expect(verdicts.every((v) => v.action === 'none')).toBe(true);
  });
});

describe('two strikes', () => {
  it('nudges first, stops on the second loop in the same turn', () => {
    const guard = new LoopGuard();
    const first = feed(guard, [read('a'), read('a'), read('a')]);
    expect(first.at(-1)?.action).toBe('nudge');
    // After the warning the count starts afresh: two more are not enough.
    expect(feed(guard, [read('a'), read('a')]).every((v) => v.action === 'none')).toBe(true);
    const third = guard.record(S, 'strict', 'Read', { file_path: 'a' }, 'contents');
    expect(third.action).toBe('stop');
    expect((third as any).message).toMatch(/^Forge stopped this turn/);
  });

  it('the nudge tells the model what it is repeating and what to do instead', () => {
    const verdicts = feed(new LoopGuard(), [read('a'), read('a'), read('a')]);
    const nudge = verdicts.at(-1) as any;
    expect(nudge.message).toMatch(/^Potential loop detected: the same Read call 3 times in a row/);
    expect(nudge.message).toMatch(/change your approach/);
    expect(nudge.message).toMatch(/tell the user what is blocking you/);
  });

  it('a new user message starts a new turn, with no strikes', () => {
    const guard = new LoopGuard();
    feed(guard, [read('a'), read('a'), read('a')]);
    expect(guard.strikesFor(S)).toBe(1);
    guard.beginTurn(S);
    expect(guard.strikesFor(S)).toBe(0);
    expect(feed(guard, [read('a'), read('a'), read('a')]).at(-1)?.action).toBe('nudge');
  });

  it('keeps sessions apart', () => {
    const guard = new LoopGuard();
    guard.record('one', 'strict', 'Read', { file_path: 'a' }, 'x');
    guard.record('two', 'strict', 'Read', { file_path: 'a' }, 'x');
    guard.record('one', 'strict', 'Read', { file_path: 'a' }, 'x');
    expect(guard.record('two', 'strict', 'Read', { file_path: 'a' }, 'x').action).toBe('none');
  });
});

describe('findCycle / stepKey', () => {
  const step = (key: string) => ({ key, tool: key });

  it('finds the shortest cycle the history ends with', () => {
    expect(findCycle(['a', 'b', 'a', 'b', 'a', 'b'].map(step), 3)?.map((s) => s.key)).toEqual(['a', 'b']);
    expect(findCycle(['x', 'a', 'a', 'a'].map(step), 3)?.map((s) => s.key)).toEqual(['a']);
    expect(findCycle(['a', 'b', 'c', 'a', 'b'].map(step), 3)).toBeUndefined();
  });

  it('keys input order-insensitively and results by content', () => {
    expect(stepKey('Read', { a: 1, b: 2 }, 'r')).toBe(stepKey('Read', { b: 2, a: 1 }, 'r'));
    expect(stepKey('Read', { a: 1 }, 'r1')).not.toBe(stepKey('Read', { a: 1 }, 'r2'));
  });
});
