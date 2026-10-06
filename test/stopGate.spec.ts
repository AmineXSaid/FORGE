/**
 * The stop gate: a claim no tool call backs goes back to the model once, and
 * an empty answer after a tool result is asked for again, boundedly.
 *
 * Measured against the real CLI (2.1.283) through the SDK: the Stop hook's
 * `additionalContext` continues the turn and reaches the model as
 * "Stop hook additional context: …", and the next stop arrives with
 * `stop_hook_active: true`.
 */
import { describe, expect, it } from 'vitest';
import { MAX_EMPTY_ANSWER_NUDGES, StopGate } from '../src/forge-sdk/guards/stopGate';

const S = 'session';

describe('unverified claims', () => {
  it('challenges an edit claim with no matching edit, once per turn', () => {
    const gate = new StopGate();
    gate.beginTurn(S);
    const first = gate.onStop(S, 'strict', 'Done. I updated `src/config.ts`.', false);
    expect(first).toMatch(/^Before you finish/);
    expect(first).toMatch(/no Write or Edit to src\/config\.ts was made/);
    expect(gate.onStop(S, 'strict', 'Done. I updated `src/config.ts`.', false)).toBeUndefined();
  });

  it('lets a claim through when the session really made the edit', () => {
    const gate = new StopGate();
    gate.beginTurn(S);
    gate.recordCall(S, 'Edit', { file_path: '/repo/src/config.ts', old_string: 'a', new_string: 'b' }, true);
    expect(gate.onStop(S, 'strict', 'I updated `src/config.ts`.', false)).toBeUndefined();
  });

  it('remembers edits from earlier turns: a summary may mention them', () => {
    const gate = new StopGate();
    gate.beginTurn(S);
    gate.recordCall(S, 'Write', { file_path: '/repo/README.md', content: 'x' }, true);
    gate.beginTurn(S);
    expect(gate.onStop(S, 'strict', 'Earlier I created `README.md`.', false)).toBeUndefined();
  });

  it('does not count a failed edit as evidence', () => {
    const gate = new StopGate();
    gate.beginTurn(S);
    gate.recordCall(S, 'Edit', { file_path: '/repo/a.ts' }, false);
    expect(gate.onStop(S, 'strict', 'I fixed `a.ts`.', false)).toMatch(/no Write or Edit to a\.ts/);
  });

  it('challenges "tests pass" when no test ran, and when every run failed', () => {
    const none = new StopGate();
    none.beginTurn(S);
    expect(none.onStop(S, 'strict', 'All tests pass.', false)).toMatch(/no test command was run/);

    const failed = new StopGate();
    failed.beginTurn(S);
    failed.recordCall(S, 'Bash', { command: 'npm test' }, false);
    expect(failed.onStop(S, 'strict', 'All tests pass.', false)).toMatch(/the test run \(npm test\) failed/);
  });

  it('accepts an honest report of failing tests', () => {
    const gate = new StopGate();
    gate.beginTurn(S);
    gate.recordCall(S, 'Bash', { command: 'pnpm test' }, false);
    expect(gate.onStop(S, 'strict', 'I ran the tests; three are still failing.', false)).toBeUndefined();
  });

  it('accepts "tests pass" after a clean run', () => {
    const gate = new StopGate();
    gate.beginTurn(S);
    gate.recordCall(S, 'Bash', { command: 'npx vitest run' }, true);
    expect(gate.onStop(S, 'strict', 'The tests pass.', false)).toBeUndefined();
  });

  it('leaves plans and honest failures alone (the claim checker\'s own rules)', () => {
    const gate = new StopGate();
    gate.beginTurn(S);
    expect(gate.onStop(S, 'strict', 'I could not update `a.ts` because it is read-only.', false)).toBeUndefined();
    expect(gate.onStop(S, 'strict', 'Next step: update `a.ts`.', false)).toBeUndefined();
  });

  it('only challenges claims under strict; standard leaves it to the badge', () => {
    const gate = new StopGate();
    gate.beginTurn(S);
    expect(gate.onStop(S, 'standard', 'I updated `a.ts`.', false)).toBeUndefined();
  });

  it('a new turn gets a new challenge', () => {
    const gate = new StopGate();
    gate.beginTurn(S);
    expect(gate.onStop(S, 'strict', 'I updated `a.ts`.', false)).toBeDefined();
    gate.beginTurn(S);
    expect(gate.onStop(S, 'strict', 'I updated `a.ts`.', false)).toBeDefined();
  });
});

describe('empty answers after tools', () => {
  it('asks for the final answer, at most twice a turn', () => {
    const gate = new StopGate();
    gate.beginTurn(S);
    gate.recordCall(S, 'Read', { file_path: '/a' }, true);
    for (let i = 0; i < MAX_EMPTY_ANSWER_NUDGES; i++) {
      expect(gate.onStop(S, 'standard', '  ', false)).toMatch(/^Your last message was empty/);
    }
    expect(gate.onStop(S, 'standard', '', false)).toBeUndefined();
  });

  it('says nothing about an empty message when no tool ran this turn', () => {
    const gate = new StopGate();
    gate.beginTurn(S);
    expect(gate.onStop(S, 'strict', '', false)).toBeUndefined();
  });
});

describe('never loops', () => {
  it('stays silent while the model is already continuing because of a stop hook', () => {
    const gate = new StopGate();
    gate.beginTurn(S);
    gate.recordCall(S, 'Read', { file_path: '/a' }, true);
    expect(gate.onStop(S, 'strict', '', true)).toBeUndefined();
    expect(gate.onStop(S, 'strict', 'I updated `a.ts`.', true)).toBeUndefined();
  });

  it('is off entirely when the guards are', () => {
    const gate = new StopGate();
    gate.beginTurn(S);
    gate.recordCall(S, 'Read', { file_path: '/a' }, true);
    expect(gate.onStop(S, 'off', '', false)).toBeUndefined();
    expect(gate.onStop(S, 'off', 'I updated `a.ts`.', false)).toBeUndefined();
  });
});

describe('48b ship gate: the claim challenge holds up on honest reports', () => {
  const policy = { emptyAnswer: true, claimChallenge: true };
  const fresh = () => {
    const gate = new StopGate();
    gate.beginTurn(S);
    return gate;
  };

  it('an honest Alpha report with Remaining items and "Tests: not run" is not challenged', () => {
    const gate = fresh();
    gate.recordCall(S, 'Edit', { file_path: '/repo/src/a.ts', old_string: 'x', new_string: 'y' }, true);
    const report = [
      '**Result:** the parser now accepts trailing commas.',
      '',
      '**Changes:**',
      '- Updated `src/a.ts`: accept a trailing comma.',
      '',
      '**Verification:** tests not run (no test suite in this repo).',
      '- Tests: not run.',
      '',
      '**Remaining:**',
      '- `src/b.ts` still needs to be updated.',
      '- Update `src/c.ts` for the same case.',
      '',
      'Note: `src/auth/login.ts` was last modified in #412.',
    ].join('\n');
    expect(gate.onStop(S, policy, report, false)).toBeUndefined();
  });

  it('"Remaining: x" on one line is not a claim either', () => {
    const gate = fresh();
    gate.recordCall(S, 'Read', { file_path: '/repo/x.ts' }, true);
    expect(gate.onStop(S, policy, 'Remaining: `src/b.ts` still needs to be updated.', false)).toBeUndefined();
  });

  it('"renamed `a.ts`" after `git mv a.ts b.ts` is backed', () => {
    const gate = fresh();
    gate.recordCall(S, 'Bash', { command: 'git mv src/a.ts src/b.ts' }, true);
    expect(gate.onStop(S, policy, 'I renamed `src/a.ts` to `src/b.ts`.', false)).toBeUndefined();
  });

  it.each([
    ['echo x > src/a.ts', 'src/a.ts'],
    ["sed -i 's/a/b/' src/a.ts", 'src/a.ts'],
    ['prettier --write src/a.ts', 'src/a.ts'],
    ['cat foo | tee src/a.ts', 'src/a.ts'],
  ])('`%s` backs an edit claim on %s', (command, file) => {
    const gate = fresh();
    gate.recordCall(S, 'Bash', { command }, true);
    expect(gate.onStop(S, policy, `I updated \`${file}\`.`, false)).toBeUndefined();
  });

  it('"updated `src/a.ts`" with only `cat src/a.ts` is challenged', () => {
    const gate = fresh();
    gate.recordCall(S, 'Bash', { command: 'cat src/a.ts' }, true);
    expect(gate.onStop(S, policy, 'I updated `src/a.ts`.', false)).toMatch(/no Write or Edit to src\/a\.ts/);
  });

  it.each(['./gradlew test', 'npx playwright test', 'node --test', 'bazel test //...', 'swift test', 'cargo nextest run', 'pnpm run test:unit', 'make check', './scripts/run-tests.sh'])(
    '`%s` counts as a test run',
    (command) => {
      const gate = fresh();
      gate.recordCall(S, 'Bash', { command }, true);
      expect(gate.onStop(S, policy, 'Ran the tests; they pass.', false)).toBeUndefined();
    },
  );

  it('a resumed session with nothing run yet is not challenged', () => {
    const gate = new StopGate();
    gate.markResumed(S);
    gate.beginTurn(S);
    expect(gate.onStop(S, policy, 'I updated `src/config.ts` earlier and the tests pass.', false)).toBeUndefined();
  });

  it('a fresh session with a claim and no call at all is still challenged (checklist step 2)', () => {
    const gate = fresh();
    expect(gate.onStop(S, policy, 'Done: I updated `src/config.ts` and the tests pass.', false)).toMatch(/^Before you finish/);
  });

  it('the old onStop(…, "strict", …) and "standard" call shapes still work', () => {
    expect(fresh().onStop(S, 'strict', 'I updated `src/x.ts`.', false)).toMatch(/^Before you finish/);
    expect(fresh().onStop(S, 'standard', 'I updated `src/x.ts`.', false)).toBeUndefined();
    expect(fresh().onStop(S, 'off', '', false)).toBeUndefined();
  });
});

describe('48b: reading a test file is not running it', () => {
  it('"tests pass" after only `cat test_slugify.py` is challenged', () => {
    const gate = new StopGate();
    gate.beginTurn(S);
    gate.recordCall(S, 'Bash', { command: 'cat test_slugify.py' }, true);
    expect(gate.onStop(S, { emptyAnswer: true, claimChallenge: true }, 'The tests pass.', false)).toMatch(/no test command was run/);
  });
});
