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
import { MAX_EMPTY_ANSWER_NUDGES, StopGate } from '../src/services/claude/stopGate';

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
