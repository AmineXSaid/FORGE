/**
 * A5: smart-stream output filtering.
 *
 * The thing worth testing hardest is that the budget is *derived* from
 * `capabilities.contextWindow` rather than hardcoded. That is the whole point
 * of the port: a 32k self-hosted model needs aggressive filtering where a 200k
 * Claude needs almost none, and one constant would be wrong for both.
 *
 * The second is honesty. A model reading abridged output without knowing it is
 * abridged will answer confidently about lines it never saw, so every elision
 * has to be visible in the text itself.
 */
import { describe, expect, it } from 'vitest';
import {
  FullOutputStore,
  filterToolResponse,
  toolResponseText,
  budgetFor,
  filterToolOutput,
  isHighSignal,
  similarityKey,
} from '../src/services/claude/smartStream';

const lines = (n: number, make: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => make(i)).join('\n');

/**
 * A token that survives `similarityKey`.
 *
 * Digits are normalised away, by design -- `item 1` and `item 2` are one fact
 * repeated. So a fixture that needs N *genuinely* distinct lines has to vary
 * them in letters, or dedup collapses the whole thing to one line and the
 * budget never binds.
 */
const letters = (i: number): string => {
  let out = '';
  let n = i + 1;
  while (n > 0) {
    out = String.fromCharCode(97 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

describe('budgetFor: derived from the context window, not hardcoded', () => {
  it('scales with the window', () => {
    const small = budgetFor(32_000);
    const large = budgetFor(200_000);
    expect(large.maxChars).toBeGreaterThan(small.maxChars);
    expect(large.maxLines).toBeGreaterThan(small.maxLines);
  });

  it('gives a 32k model roughly a tenth of its window in tokens', () => {
    // ~3,200 tokens at ~4 chars each.
    expect(budgetFor(32_000).maxChars).toBe(12_800);
  });

  it('leaves room for the rest of the turn', () => {
    // One tool result must not eat the window: the system prompt, tool
    // definitions, history and several more calls still have to fit.
    for (const window of [8_000, 32_000, 128_000, 200_000]) {
      const budgetTokens = budgetFor(window).maxChars / 4;
      expect(budgetTokens).toBeLessThanOrEqual(window * 0.11);
    }
  });

  it('floors the budget so a tiny window is still usable', () => {
    const tiny = budgetFor(1_000);
    expect(tiny.maxChars).toBeGreaterThanOrEqual(2_000);
    expect(tiny.maxLines).toBeGreaterThanOrEqual(60);
  });

  it('falls back sanely on a nonsense window', () => {
    expect(budgetFor(0)).toEqual(budgetFor(32_000));
    expect(budgetFor(NaN)).toEqual(budgetFor(32_000));
    expect(budgetFor(-5)).toEqual(budgetFor(32_000));
  });
});

describe('small output passes through untouched', () => {
  it('returns the exact bytes when under budget', () => {
    const text = 'total 12\ndrwxr-xr-x  3 user  staff   96 Jan  1 00:00 .\n-rw-r--r--  1 user  staff  512 src';
    const result = filterToolOutput(text, budgetFor(32_000));
    expect(result.filtered).toBe(false);
    expect(result.text).toBe(text);
  });

  it('adds no notice to output it did not change', () => {
    const result = filterToolOutput('ok', budgetFor(200_000));
    expect(result.text).toBe('ok');
    expect(result.text).not.toMatch(/Forge abridged/);
  });
});

describe('the same output is filtered differently per window', () => {
  // Distinct in letters, so dedup cannot collapse it and the budget is what
  // decides how much survives -- which is the thing under test.
  const build = lines(4_000, (i) => `[INFO] compiling ${letters(i)}.ts with options --strict`);

  it('filters hard for a 32k model', () => {
    const result = filterToolOutput(build, budgetFor(32_000));
    expect(result.filtered).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(budgetFor(32_000).maxChars + 200);
  });

  it('is the clearest example of capability-driven behaviour', () => {
    const small = filterToolOutput(build, budgetFor(32_000));
    const large = filterToolOutput(build, budgetFor(200_000));
    expect(small.text.length).toBeLessThan(large.text.length);
  });
});

describe('nothing is dropped silently', () => {
  const noisy = lines(5_000, (i) => `[00:${i % 60}] processed item ${i}`);

  it('says at the top that the output was abridged', () => {
    const result = filterToolOutput(noisy, budgetFor(32_000));
    expect(result.text.split('\n')[0]).toMatch(/Forge abridged this output/);
    expect(result.text).toMatch(/5000 lines of output/);
  });

  it('reports how many lines were repeated and how many hidden', () => {
    const result = filterToolOutput(noisy, budgetFor(32_000));
    const notice = result.text.split('\n')[0];
    expect(notice).toMatch(/repeated|hidden/);
    expect(result.stats.originalLines).toBe(5_000);
  });

  it('marks an elision inline where it happened', () => {
    const mixed = lines(3_000, (i) => `resolved dependency ${letters(i)} from the registry`);
    const result = filterToolOutput(mixed, budgetFor(32_000));
    expect(result.text).toMatch(/line\(s\) hidden/);
  });
});

describe('deduplication collapses one fact repeated, not many facts', () => {
  it('collapses lines differing only by a counter', () => {
    const result = filterToolOutput(lines(3_000, (i) => `processed item ${i}`), budgetFor(32_000));
    expect(result.stats.duplicateLines).toBeGreaterThan(2_000);
    expect(result.text).toMatch(/similar line\(s\)/);
  });

  it('keeps a representative of each collapsed group', () => {
    const result = filterToolOutput(
      `${lines(500, () => 'alpha repeated')}\n${lines(500, () => 'beta repeated')}`,
      { maxChars: 500, maxLines: 20 },
    );
    expect(result.text).toMatch(/alpha repeated/);
    expect(result.text).toMatch(/beta repeated/);
  });

  it('never deduplicates error lines', () => {
    // The same assertion failing in twenty places is twenty facts; collapsing
    // them would hide nineteen.
    const errors = lines(40, (i) => `error: assertion failed at src/file_${i}.ts`);
    const result = filterToolOutput(`${lines(3_000, (i) => `noise ${i}`)}\n${errors}`, budgetFor(32_000));
    const kept = result.text.split('\n').filter((l) => /assertion failed/.test(l));
    expect(kept.length).toBe(40);
  });

  it('caps runs of blank lines', () => {
    const result = filterToolOutput(
      `start${'\n'.repeat(500)}end\n${lines(3_000, (i) => `x ${i}`)}`,
      budgetFor(32_000),
    );
    expect(result.text).not.toMatch(/\n{5,}/);
  });
});

describe('high-signal lines survive', () => {
  it.each([
    'error: cannot find module',
    'FATAL: out of memory',
    'warning: unused variable',
    'test result: 3 failed',
    'Traceback (most recent call last):',
    'Permission denied',
    'process exited with exit code 1',
  ])('recognises %s', (line) => {
    expect(isHighSignal(line)).toBe(true);
  });

  it.each([
    'compiling module_12.ts',
    '[INFO] done',
    '   ',
  ])('does not over-claim on %s', (line) => {
    expect(isHighSignal(line)).toBe(false);
  });

  it('keeps an error buried in the middle of a huge log', () => {
    const before = lines(4_000, (i) => `[INFO] step ${i} ok`);
    const after = lines(4_000, (i) => `[INFO] step ${4000 + i} ok`);
    const result = filterToolOutput(
      `${before}\nerror: THE_ONE_THING_THAT_MATTERS\n${after}`,
      budgetFor(32_000),
    );
    expect(result.text).toMatch(/THE_ONE_THING_THAT_MATTERS/);
  });

  it('keeps the head and the tail, where a reader looks first', () => {
    const result = filterToolOutput(
      `FIRST_LINE_MARKER\n${lines(5_000, (i) => `middle ${i} padding text here`)}\nLAST_LINE_MARKER`,
      budgetFor(32_000),
    );
    expect(result.text).toMatch(/FIRST_LINE_MARKER/);
    expect(result.text).toMatch(/LAST_LINE_MARKER/);
  });
});

describe('the character cap is enforced last', () => {
  it('cuts a single enormous line to fit', () => {
    const result = filterToolOutput(`${'x'.repeat(400_000)}\n${lines(100, (i) => `line ${i}`)}`, budgetFor(32_000));
    expect(result.text.length).toBeLessThanOrEqual(budgetFor(32_000).maxChars + 300);
    expect(result.text).toMatch(/character\(s\) cut/);
  });

  it('respects the cap even for pathological input', () => {
    const budget = { maxChars: 3_000, maxLines: 50 };
    const result = filterToolOutput(lines(20_000, (i) => `error: distinct failure ${i} ${'y'.repeat(50)}`), budget);
    expect(result.text.length).toBeLessThanOrEqual(budget.maxChars + 300);
  });
});

describe('similarityKey', () => {
  it('collapses counters and timestamps', () => {
    expect(similarityKey('[00:12:43] processed item 8231'))
      .toBe(similarityKey('[00:12:44] processed item 8232'));
  });

  it('collapses hex addresses', () => {
    expect(similarityKey('at 0xdeadbeef')).toBe(similarityKey('at 0xcafef00d'));
  });

  it('keeps genuinely different lines apart', () => {
    expect(similarityKey('compiling foo.ts')).not.toBe(similarityKey('linking foo.o'));
  });
});

describe('filterToolResponse: the shape the real CLI actually sends', () => {
  // Measured against the bundled binary: Bash returns an object, not a string.
  // The first version of this filter handled only strings, so it silently
  // skipped the one tool most likely to emit ten thousand lines.
  const bashResponse = (stdout: string, stderr = '') => ({
    stdout, stderr, interrupted: false, isImage: false,
  });

  it('filters stdout inside a Bash response object', () => {
    const out = filterToolResponse(
      bashResponse(lines(6_000, (i) => `[INFO] compiling ${letters(i)}.ts`)),
      budgetFor(32_000),
    );
    expect(out).toBeDefined();
    const response = out!.response as Record<string, unknown>;
    expect(String(response.stdout)).toMatch(/Forge abridged/);
    expect(String(response.stdout).length).toBeLessThan(budgetFor(32_000).maxChars + 400);
  });

  it('keeps the other fields of the object intact', () => {
    const out = filterToolResponse(
      bashResponse(lines(6_000, (i) => `line ${letters(i)}`)),
      budgetFor(32_000),
    );
    const response = out!.response as Record<string, unknown>;
    expect(response.interrupted).toBe(false);
    expect(response.isImage).toBe(false);
  });

  it('filters stderr too, where a failing build puts its output', () => {
    const out = filterToolResponse(
      bashResponse('', lines(6_000, (i) => `error: failure ${letters(i)}`)),
      budgetFor(32_000),
    );
    expect(String((out!.response as any).stderr)).toMatch(/Forge abridged/);
  });

  it('still handles a plain string response', () => {
    const out = filterToolResponse(
      lines(6_000, (i) => `line ${letters(i)}`),
      budgetFor(32_000),
    );
    expect(typeof out!.response).toBe('string');
  });

  it('returns undefined when nothing needed changing', () => {
    // So the caller leaves the response alone rather than rewriting an
    // identical copy over it.
    expect(filterToolResponse(bashResponse('ok'), budgetFor(200_000))).toBeUndefined();
    expect(filterToolResponse('short', budgetFor(200_000))).toBeUndefined();
  });

  it('ignores shapes it does not understand', () => {
    expect(filterToolResponse(null, budgetFor(32_000))).toBeUndefined();
    expect(filterToolResponse(42, budgetFor(32_000))).toBeUndefined();
    expect(filterToolResponse({ interrupted: false }, budgetFor(32_000))).toBeUndefined();
  });

  it('sums the stats across every field it filtered', () => {
    const big = lines(6_000, (i) => `line ${letters(i)}`);
    const out = filterToolResponse(bashResponse(big, big), budgetFor(32_000));
    expect(out!.stats.originalLines).toBe(12_000);
  });
});

describe('toolResponseText: the full copy for A4', () => {
  it('pulls text out of a Bash response object', () => {
    expect(toolResponseText({ stdout: 'out', stderr: 'err', interrupted: false }))
      .toBe('out\nerr');
  });

  it('passes a string through', () => {
    expect(toolResponseText('plain')).toBe('plain');
  });

  it('returns empty for a shape with no text', () => {
    expect(toolResponseText({ interrupted: true })).toBe('');
    expect(toolResponseText(null)).toBe('');
  });
});

describe('FullOutputStore: the evidence A4 verifies against', () => {
  it('returns the unabridged text', () => {
    const store = new FullOutputStore();
    const huge = lines(10_000, (i) => `line ${i}`);
    store.set('tool_1', huge);
    expect(store.get('tool_1')).toBe(huge);
  });

  it('is bounded by total characters, because one huge log is the real case', () => {
    const store = new FullOutputStore(10_000);
    for (let i = 0; i < 20; i++) store.set(`t${i}`, 'x'.repeat(2_000));
    expect(store.size).toBeLessThan(20);
    // The newest is always retained.
    expect(store.get('t19')).toBeDefined();
  });

  it('evicts oldest first', () => {
    const store = new FullOutputStore(5_000);
    store.set('old', 'a'.repeat(4_000));
    store.set('new', 'b'.repeat(4_000));
    expect(store.get('old')).toBeUndefined();
    expect(store.get('new')).toBeDefined();
  });

  it('accounts correctly when a key is overwritten', () => {
    const store = new FullOutputStore(10_000);
    store.set('k', 'x'.repeat(4_000));
    store.set('k', 'y'.repeat(4_000));
    expect(store.size).toBe(1);
    store.set('other', 'z'.repeat(4_000));
    expect(store.get('k')).toBeDefined();
  });

  it('clears', () => {
    const store = new FullOutputStore();
    store.set('a', 'x');
    store.clear();
    expect(store.size).toBe(0);
    expect(store.get('a')).toBeUndefined();
  });
});
