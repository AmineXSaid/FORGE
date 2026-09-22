/**
 * A4: the claim checker.
 *
 * The tests that matter most are the ones about *not* flagging. A false
 * "unverified" badge is worse than no badge at all: it trains the reader to
 * ignore it, which costs more than never having shown one. So a model that
 * says "I could not update config.ts" must never be accused of an unverified
 * claim — it was being honest, and the badge would be calling it a liar.
 *
 * The plan is explicit that this starts with cheap, high-signal claims (files
 * written, tests run) rather than general NLP over the report, for the same
 * reason: a checker that is wrong often enough is not trusted on the cases it
 * gets right.
 */
import { describe, expect, it } from 'vitest';
import {
  extractClaims,
  pathsMatch,
  summariseClaims,
  toolCallsFrom,
  verifyClaims,
  type ToolCallRecord,
} from '../src/webview/src/core/claimCheck';

const edit = (path: string, name = 'Edit'): ToolCallRecord => ({ name, input: { file_path: path } });
const bash = (command: string): ToolCallRecord => ({ name: 'Bash', input: { command } });

describe('extractClaims: file edits', () => {
  it('finds a backticked path beside a past-tense verb', () => {
    const claims = extractClaims('I updated `src/services/auth.ts` to validate the token.');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'file-edit', target: 'src/services/auth.ts' });
  });

  it.each(['added', 'created', 'wrote', 'updated', 'modified', 'changed', 'edited', 'fixed', 'removed'])(
    'recognises the verb %s',
    (verb) => {
      expect(extractClaims(`I ${verb} \`src/a.ts\`.`)).toHaveLength(1);
    },
  );

  it('finds several files across several lines', () => {
    const claims = extractClaims([
      '- Created `src/a.ts`',
      '- Updated `src/b.ts`',
      '- Edited `src/c.ts`',
    ].join('\n'));
    expect(claims.map((c) => c.target)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('counts a file mentioned twice only once', () => {
    const claims = extractClaims('Updated `src/a.ts`.\nAlso modified `src/a.ts` again.');
    expect(claims).toHaveLength(1);
  });

  it('accepts a bare path with a separator', () => {
    expect(extractClaims('I modified src/main.ts today.')).toHaveLength(1);
  });

  it('ignores a bare word with a dot but no separator', () => {
    // "Node.js" and "e.g" look exactly like filenames, and guessing wrong is
    // the entire cost of this feature.
    expect(extractClaims('I updated the Node.js version.')).toEqual([]);
  });

  it('ignores URLs', () => {
    expect(extractClaims('I updated https://example.com/docs/index.html in the README.'))
      .not.toContainEqual(expect.objectContaining({ target: expect.stringContaining('http') }));
  });
});

describe('extractClaims: what is deliberately not a claim', () => {
  it.each([
    'I could not update `src/a.ts` because it is generated.',
    "I couldn't create `src/a.ts`.",
    'I did not modify `src/a.ts`.',
    'I was unable to update `src/a.ts`.',
    'I failed to write `src/a.ts`.',
  ])('ignores an honest failure: %s', (line) => {
    // Flagging these would accuse the model of lying for telling the truth.
    expect(extractClaims(line)).toEqual([]);
  });

  it.each([
    'Next I will update `src/a.ts`.',
    'You should update `src/a.ts`.',
    'We could modify `src/a.ts` later.',
    'I plan to create `src/a.ts`.',
    'You can edit `src/a.ts` yourself.',
    'I recommend updating `src/a.ts`.',
  ])('ignores a plan or suggestion: %s', (line) => {
    expect(extractClaims(line)).toEqual([]);
  });

  it('ignores fenced code', () => {
    expect(extractClaims('```\nI updated `src/a.ts`\n```')).toEqual([]);
  });

  it('ignores quoted output', () => {
    expect(extractClaims('> I updated `src/a.ts`')).toEqual([]);
  });

  it('says nothing about a message with no claims', () => {
    expect(extractClaims('Here is how the authentication flow works.')).toEqual([]);
  });
});

describe('extractClaims: tests', () => {
  it.each([
    'All tests pass.',
    'The tests passed.',
    'Test suite is green.',
    'I ran the tests and they succeeded.',
    'Ran the test suite.',
  ])('recognises: %s', (line) => {
    expect(extractClaims(line).some((c) => c.kind === 'tests-run')).toBe(true);
  });

  it('claims tests only once however often they are mentioned', () => {
    const claims = extractClaims('All tests pass.\nThe tests passed again.\nTests are green.');
    expect(claims.filter((c) => c.kind === 'tests-run')).toHaveLength(1);
  });

  it('ignores a plan to run tests', () => {
    expect(extractClaims('You should run the tests next.')).toEqual([]);
  });
});

describe('pathsMatch: lenient, because the model writes relative paths', () => {
  it('matches identical paths', () => {
    expect(pathsMatch('src/a.ts', 'src/a.ts')).toBe(true);
  });

  it('matches a relative claim against an absolute tool path', () => {
    expect(pathsMatch('src/a.ts', '/home/u/proj/src/a.ts')).toBe(true);
  });

  it('matches a bare filename against a full path', () => {
    expect(pathsMatch('a.ts', '/home/u/proj/src/a.ts')).toBe(true);
  });

  it('does not match a different file with a similar name', () => {
    // Suffix matching on a full segment, not on characters.
    expect(pathsMatch('a.ts', '/home/u/schema.ts')).toBe(false);
    expect(pathsMatch('src/a.ts', '/home/u/other/b.ts')).toBe(false);
  });

  it('tolerates backslashes and a leading ./', () => {
    expect(pathsMatch('./src/a.ts', 'src\\a.ts')).toBe(true);
  });
});

describe('verifyClaims', () => {
  it('verifies a file claim against a matching edit', () => {
    const [verdict] = verifyClaims(
      extractClaims('Updated `src/a.ts`.'),
      [edit('/home/u/proj/src/a.ts')],
    );
    expect(verdict.verified).toBe(true);
    expect(verdict.evidence).toMatch(/Edit: \/home\/u\/proj\/src\/a\.ts/);
  });

  it.each(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])('accepts %s as evidence', (tool) => {
    const [verdict] = verifyClaims(extractClaims('Created `src/a.ts`.'), [edit('src/a.ts', tool)]);
    expect(verdict.verified).toBe(true);
  });

  it('does not verify a file that was only read', () => {
    const [verdict] = verifyClaims(
      extractClaims('Updated `src/a.ts`.'),
      [{ name: 'Read', input: { file_path: 'src/a.ts' } }],
    );
    expect(verdict.verified).toBe(false);
  });

  it('flags a claimed edit with no tool call at all', () => {
    // The case this whole port exists for.
    const [verdict] = verifyClaims(extractClaims('Updated `src/never-touched.ts`.'), []);
    expect(verdict.verified).toBe(false);
    expect(verdict.evidence).toBeUndefined();
  });

  it.each([
    'npm test', 'pnpm run test', 'yarn test', 'vitest run', 'jest', 'pytest -q',
    'go test ./...', 'cargo test', 'make test',
  ])('accepts %s as evidence that tests ran', (command) => {
    const [verdict] = verifyClaims(extractClaims('All tests pass.'), [bash(command)]);
    expect(verdict.verified).toBe(true);
  });

  it('does not accept an unrelated command as evidence tests ran', () => {
    const [verdict] = verifyClaims(extractClaims('All tests pass.'), [bash('ls -la')]);
    expect(verdict.verified).toBe(false);
  });

  it('checks each claim independently', () => {
    const verdicts = verifyClaims(
      extractClaims('Updated `src/a.ts` and created `src/b.ts`.'),
      [edit('src/a.ts')],
    );
    expect(verdicts.map((v) => v.verified)).toEqual([true, false]);
  });
});

describe('summariseClaims: the badge', () => {
  it('says nothing when there are no claims', () => {
    expect(summariseClaims('Here is an explanation.', [])).toBeUndefined();
  });

  it('says nothing when every claim checks out', () => {
    // A badge on every message is decoration; one that appears only when
    // something does not line up is information.
    expect(summariseClaims('Updated `src/a.ts`.', [edit('src/a.ts')])).toBeUndefined();
  });

  it('reports the shortfall when something is unverified', () => {
    const summary = summariseClaims(
      'Updated `src/a.ts`, `src/b.ts`, `src/c.ts` and `src/d.ts`.',
      [edit('src/a.ts'), edit('src/b.ts'), edit('src/c.ts')],
    );
    expect(summary).toBeDefined();
    expect(summary!.claimed).toBe(4);
    expect(summary!.verified).toBe(3);
    expect(summary!.label).toBe('3 of 4 claims verified');
  });

  it('uses the singular for one claim', () => {
    const summary = summariseClaims('Updated `src/a.ts`.', []);
    expect(summary!.label).toBe('0 of 1 claim verified');
  });

  it('carries the verdicts so the tooltip can name what is missing', () => {
    const summary = summariseClaims('Updated `src/a.ts` and `src/b.ts`.', [edit('src/a.ts')]);
    const missing = summary!.verdicts.filter((v) => !v.verified).map((v) => v.claim.target);
    expect(missing).toEqual(['src/b.ts']);
  });

  it('flags a model that claims tests pass without running them', () => {
    // The highest-value case on a small model.
    const summary = summariseClaims('I fixed the bug and all tests pass.', [edit('src/a.ts')]);
    expect(summary).toBeDefined();
    expect(summary!.verdicts.some((v) => v.claim.kind === 'tests-run' && !v.verified)).toBe(true);
  });
});

describe('toolCallsFrom', () => {
  it('keeps tool_use blocks and drops the rest', () => {
    expect(toolCallsFrom([
      { type: 'text', text: 'hi' },
      { type: 'tool_use', name: 'Edit', input: { file_path: 'a.ts' } },
      { type: 'tool_result', content: 'ok' },
    ])).toEqual([{ name: 'Edit', input: { file_path: 'a.ts' } }]);
  });

  it('survives a malformed block', () => {
    expect(() => toolCallsFrom([null, undefined, 42, { type: 'tool_use' }])).not.toThrow();
    expect(toolCallsFrom([{ type: 'tool_use', name: 'Edit' }])).toEqual([{ name: 'Edit', input: {} }]);
  });
});

describe('a realistic small-model report', () => {
  it('catches the claims that did not happen', () => {
    const report = [
      "I've completed the refactor:",
      '',
      '- Updated `src/auth/session.ts` to use the new token format',
      '- Created `src/auth/refresh.ts` with the refresh logic',
      '- Modified `src/auth/index.ts` to export both',
      '',
      'All tests pass and the build is clean.',
    ].join('\n');

    const summary = summariseClaims(report, [
      edit('/proj/src/auth/session.ts', 'Edit'),
      edit('/proj/src/auth/refresh.ts', 'Write'),
    ]);

    expect(summary!.claimed).toBe(4);
    expect(summary!.verified).toBe(2);
    const missing = summary!.verdicts.filter((v) => !v.verified);
    expect(missing.map((v) => v.claim.target ?? v.claim.kind))
      .toEqual(['src/auth/index.ts', 'tests-run']);
  });

  it('stays quiet on the same report when the work was really done', () => {
    const report = [
      'Updated `src/auth/session.ts` and created `src/auth/refresh.ts`.',
      'All tests pass.',
    ].join('\n');

    expect(summariseClaims(report, [
      edit('/proj/src/auth/session.ts'),
      edit('/proj/src/auth/refresh.ts', 'Write'),
      bash('pnpm test'),
    ])).toBeUndefined();
  });
});
