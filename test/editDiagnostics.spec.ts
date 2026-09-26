/**
 * Edit diagnostics: errors an edit introduced, reported to the model.
 *
 * Tested against a fake diagnostics source. The VS Code side
 * (`editDiagnosticsVscode.ts`: when a language server publishes, whether it
 * sees a file the CLI changed) can only be exercised in real VS Code, and is
 * on the user checklist rather than claimed here.
 */
import { describe, expect, it } from 'vitest';
import { EditDiagnostics, newErrors, type DiagnosticsSource, type EditorDiagnostic } from '../src/services/claude/editDiagnostics';

/** A fake editor: errors per file, changed by the test between before and after. */
function fakeSource(initial: Record<string, EditorDiagnostic[] | undefined>) {
  const state = { ...initial };
  let settles = 0;
  const source: DiagnosticsSource = {
    errors: (file) => state[file],
    settle: async () => { settles++; },
  };
  return { source, state, settles: () => settles };
}

const err = (message: string, line = 0, code = '2322'): EditorDiagnostic => ({ message, line, source: 'ts', code });

describe('EditDiagnostics', () => {
  it('reports only the errors the edit introduced', async () => {
    const { source, state } = fakeSource({ '/a.ts': [err('old problem', 3)] });
    const d = new EditDiagnostics(source);
    d.before('t1', '/a.ts');
    state['/a.ts'] = [err('old problem', 5), err("Type 'string' is not assignable to type 'number'.", 0)];
    const report = await d.after('t1', '/a.ts');
    expect(report).toBe(
      "Your edit to /a.ts introduced 1 new error(s), reported by the editor:\n" +
      "- line 1: Type 'string' is not assignable to type 'number'. (ts 2322)\n" +
      'Fix them before moving on.',
    );
  });

  it('says nothing when the edit added no error', async () => {
    const { source, state } = fakeSource({ '/a.ts': [err('old', 1)] });
    const d = new EditDiagnostics(source);
    d.before('t1', '/a.ts');
    state['/a.ts'] = [err('old', 2)];
    expect(await d.after('t1', '/a.ts')).toBeUndefined();
  });

  it('does not claim errors in a file the editor had no view of were caused by the edit', async () => {
    const { source, state } = fakeSource({ '/b.ts': undefined });
    const d = new EditDiagnostics(source);
    d.before('t1', '/b.ts');
    state['/b.ts'] = [err('something wrong', 9)];
    expect(await d.after('t1', '/b.ts')).toMatch(/^The editor reports 1 error\(s\) in \/b\.ts after your edit:\n- line 10: something wrong/);
  });

  it('stays silent when the editor still has no view of the file', async () => {
    const { source } = fakeSource({ '/c.ts': undefined });
    const d = new EditDiagnostics(source);
    d.before('t1', '/c.ts');
    expect(await d.after('t1', '/c.ts')).toBeUndefined();
  });

  it('waits for the language server before reading', async () => {
    const fake = fakeSource({ '/a.ts': [] });
    const d = new EditDiagnostics(fake.source);
    d.before('t1', '/a.ts');
    await d.after('t1', '/a.ts');
    expect(fake.settles()).toBe(1);
  });

  it('lists at most ten errors', async () => {
    const { source, state } = fakeSource({ '/a.ts': [] });
    const d = new EditDiagnostics(source);
    d.before('t1', '/a.ts');
    state['/a.ts'] = Array.from({ length: 14 }, (_, i) => err(`problem ${i}`, i));
    const report = (await d.after('t1', '/a.ts'))!;
    expect(report.split('\n').filter((l) => l.startsWith('- line'))).toHaveLength(10);
    expect(report).toMatch(/…and 4 more/);
  });
});

describe('newErrors', () => {
  it('compares as a multiset and ignores positions', () => {
    const before = [err('dup', 1), err('dup', 2)];
    const after = [err('dup', 4), err('dup', 5), err('dup', 6)];
    expect(newErrors(before, after)).toEqual([err('dup', 6)]);
  });

  it('treats a different code as a different error', () => {
    expect(newErrors([err('x', 0, '1')], [err('x', 0, '2')])).toHaveLength(1);
  });
});
