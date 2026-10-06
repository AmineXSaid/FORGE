/**
 * Tool errors that name their own fix, on both sides of the CLI.
 *
 * Relay side (`errorHints.ts`): the three errors the CLI returns before any
 * hook runs -- an unknown tool, an InputValidationError, an Edit whose
 * old_string is not in the file. Host side (`failureHints.ts`): the failures
 * PostToolUseFailure does see, with the hint growing firmer as the same kind
 * of failure repeats in a turn.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearHintCache, ErrorHinter, nearestMatch } from '../src/services/endpoints/wire/errorHints';
import { toOpenAI } from '../src/services/endpoints/wire/toOpenAI';
import { parseProfile } from '../src/services/endpoints/profile';
import { FailureHints, missingPathHint } from '../src/forge-sdk/guards/failureHints';
import { closestNames, diceSimilarity, levenshtein } from '../src/shared/similarity';

const TOOLS = [
  { name: 'Read', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, limit: { type: 'integer' } }, required: ['file_path'] } },
  { name: 'Edit', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'] } },
  { name: 'Bash', input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
  { name: 'Grep', input_schema: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] } },
];

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-hints-'));
  clearHintCache();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** An assistant tool call followed by its (error) result, as the CLI sends them. */
function exchange(id: string, name: string, input: unknown, error: string) {
  return [
    { role: 'assistant' as const, content: [{ type: 'tool_use', id, name, input }] },
    { role: 'user' as const, content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: error }] },
  ];
}

/** Translate and return the text of every `tool` message sent to the gateway. */
function toolMessages(messages: any[]): string[] {
  const { body } = toOpenAI(
    { model: 'm', tools: TOOLS, messages },
    parseProfile({ name: 'gw', wire: 'openai', baseUrl: 'https://gw/v1', model: 'm' }, 'test'),
  );
  return (body.messages as any[]).filter((m) => m.role === 'tool').map((m) => m.content);
}

describe('relay: unknown tool', () => {
  const unknown = (name: string) => `<tool_use_error>Error: No such tool available: ${name}</tool_use_error>`;

  it('suggests the nearest real tool and lists them all (alphacode #104)', () => {
    const [text] = toolMessages(exchange('t1', 'Reed', {}, unknown('Reed')));
    expect(text).toMatch(/Hint: "Reed" is not a tool in this session\. Did you mean: Read\?/);
    expect(text).toMatch(/Available tools: Read, Edit, Bash, Grep\./);
  });

  it('escalates when the same invented name fails again', () => {
    const texts = toolMessages([
      ...exchange('t1', 'search_files', {}, unknown('search_files')),
      ...exchange('t2', 'search_files', {}, unknown('search_files')),
    ]);
    expect(texts[0]).not.toMatch(/failed 2 times/);
    expect(texts[1]).toMatch(/This name has now failed 2 times; it cannot start working/);
  });

  it('is stable across re-sends, so a prefix cache still hits', () => {
    const conversation = exchange('t1', 'Reed', {}, unknown('Reed'));
    expect(toolMessages(conversation)).toEqual(toolMessages(conversation));
  });
});

describe('relay: InputValidationError', () => {
  it('names the required parameters and the likely intended key', () => {
    const [text] = toolMessages(exchange('t1', 'Read', { fil_path: 'a' },
      '<tool_use_error>InputValidationError: Read failed due to the following issues:\nAn unexpected parameter `fil_path` was provided\nThe required parameter `file_path` is missing</tool_use_error>'));
    expect(text).toMatch(/Hint: Read takes required file_path \(string\); optional limit \(integer\)\./);
    expect(text).toMatch(/`fil_path` is not a parameter; did you mean `file_path`\?/);
  });
});

describe('relay: Edit old_string not found', () => {
  it('points at the line with different indentation', () => {
    const file = path.join(dir, 'a.ts');
    fs.writeFileSync(file, 'function f() {\n    return 1;\n}\n');
    const [text] = toolMessages(exchange('t1', 'Edit', { file_path: file, old_string: 'return 1;\n}', new_string: 'x' },
      '<tool_use_error>String to replace not found in file.\nString: return 1;</tool_use_error>'));
    expect(text).toMatch(/old_string must match the file exactly/);
    expect(text).toMatch(/first line is at line 2 with different indentation: " {4}return 1;"/);
  });

  it('names the closest line when nothing matches exactly', () => {
    expect(nearestMatch('a\nconst answer = computeTheAnswer(42);\nb', 'const answer = computeTheAnswr(42);'))
      .toMatch(/closest line is 2 \(\d+% similar\)/);
  });

  it('stays generic when the file cannot be read', () => {
    const [text] = toolMessages(exchange('t1', 'Edit', { file_path: path.join(dir, 'gone.ts'), old_string: 'x', new_string: 'y' },
      'String to replace not found in file.'));
    expect(text).toMatch(/Read that part of the file again/);
    expect(text).not.toMatch(/closest line/);
  });

  it('adds nothing to a successful result or an unrelated error', () => {
    const hinter = new ErrorHinter(TOOLS, []);
    expect(hinter.hintFor('x', 'Exit code 1')).toBeUndefined();
    const texts = toolMessages([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'ok', name: 'Read', input: { file_path: '/a' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'ok', content: 'No such tool available: fine' }] },
    ]);
    expect(texts[0]).toBe('No such tool available: fine');
  });
});

describe('host: failures PostToolUseFailure sees', () => {
  it('suggests the sibling the model probably meant', () => {
    fs.writeFileSync(path.join(dir, 'config.yaml'), '');
    fs.writeFileSync(path.join(dir, 'README.md'), '');
    const hint = missingPathHint(path.join(dir, 'config.yml'));
    expect(hint).toBe(`Hint: ${path.join(dir, 'config.yml')} does not exist. Did you mean: ${path.join(dir, 'config.yaml')}?`);
  });

  it('names the nearest existing directory when the whole path is invented', () => {
    const hint = missingPathHint(path.join(dir, 'src', 'deep', 'x.ts'));
    expect(hint).toBe(`Hint: ${path.join(dir, 'src', 'deep', 'x.ts')} does not exist; the nearest existing directory is ${dir}. List it before choosing a path.`);
  });

  it('resolves a relative path against the session cwd', () => {
    fs.writeFileSync(path.join(dir, 'index.ts'), '');
    expect(missingPathHint('indx.ts', dir)).toMatch(/Did you mean: .*index\.ts\?/);
  });

  it('escalates by kind within a turn, and resets on the next turn', () => {
    const hints = new FailureHints();
    const fail = () => hints.hintFor('s', 'Bash', { command: 'make' }, 'Exit code 2\nmake: *** No rule to make target');
    expect(fail()).toMatch(/do not re-run the same command unchanged\.$/);
    expect(fail()).toMatch(/\[2x this turn\]$/);
    expect(fail()).toMatch(/\[3x this turn — try a different approach\]$/);
    expect(fail()).toMatch(/\[4x this turn — you MUST try a completely different approach\]$/);
    hints.beginTurn('s');
    expect(fail()).toMatch(/unchanged\.$/);
  });

  it.each([
    ['Bash', 'Exit code 127\nfoo: command not found', /not installed or not on PATH/],
    ['Write', 'EACCES: permission denied, open /etc/x', /permission denied — retrying will not help/],
    ['WebFetch', 'Request timed out after 30000ms', /timed out\. Retry at most once/],
    ['WebFetch', 'getaddrinfo ENOTFOUND example.invalid', /network request failed/],
  ])('%s: %s', (tool, error, pattern) => {
    expect(new FailureHints().hintFor('s', tool, {}, error)).toMatch(pattern);
  });

  it('says nothing about an error it has no fix for', () => {
    expect(new FailureHints().hintFor('s', 'Grep', {}, 'regex parse error')).toBeUndefined();
  });
});

describe('similarity helpers', () => {
  it('levenshtein, with an early exit', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('a', 'abcdefgh', 2)).toBe(3);
  });

  it('dice similarity', () => {
    expect(diceSimilarity('night', 'nacht')).toBeCloseTo(0.25);
    expect(diceSimilarity('same', 'same')).toBe(1);
  });

  it('closestNames ranks exact, prefix, substring, then edit distance', () => {
    expect(closestNames('read', ['Reader', 'Read', 'Thread', 'Bash'])).toEqual(['Read', 'Reader', 'Thread']);
    expect(closestNames('Graph', ['Grep', 'Glob'])).toEqual(['Grep']);
  });
});

describe('48a: the hint on a cut-off call says why it was refused', () => {
  const invalid = (missing: string) =>
    `<tool_use_error>InputValidationError: failed due to the following issue:\nThe required parameter \`${missing}\` is missing</tool_use_error>`;
  const cutTools = [
    ...TOOLS,
    { name: 'Write', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } },
    { name: 'NotebookEdit', input_schema: { type: 'object', properties: { notebook_path: { type: 'string' }, new_source: { type: 'string' } }, required: ['notebook_path', 'new_source'] } },
  ];
  const messagesFor = (messages: any[]) => {
    const { body } = toOpenAI(
      { model: 'm', tools: cutTools, messages },
      parseProfile({ name: 'gw', wire: 'openai', baseUrl: 'https://gw/v1', model: 'm' }, 'test'),
    );
    return (body.messages as any[]).filter((m) => m.role === 'tool').map((m) => m.content as string);
  };
  let registry: typeof import('../src/services/endpoints/wire/cutOffCalls');
  beforeEach(async () => {
    registry = await import('../src/services/endpoints/wire/cutOffCalls');
    registry.clearCutOffCalls();
  });

  it('Write cut by the token limit: nothing written, split it up', () => {
    registry.recordCutOff('w1', { tool: 'Write', target: '/w/a.ts', finishReason: 'length' });
    const [text] = messagesFor(exchange('w1', 'Write', { file_path: '/w/a.ts' }, invalid('content')));
    expect(text).toContain('Hint: nothing was written to /w/a.ts: this call\'s arguments were cut off by the output token limit');
    expect(text).toContain('Write a first chunk, then extend it with Edit');
    expect(text).not.toMatch(/Write takes required/);
  });

  it('Bash cut by the token limit: nothing run', () => {
    registry.recordCutOff('b1', { tool: 'Bash', target: '', finishReason: 'length' });
    const [text] = messagesFor(exchange('b1', 'Bash', {}, invalid('command')));
    expect(text).toContain('Hint: nothing was run: the command was cut off before it finished arriving.');
  });

  it('another tool cut by the token limit: re-send it complete', () => {
    registry.recordCutOff('g1', { tool: 'Grep', target: '', finishReason: 'length' });
    const [text] = messagesFor(exchange('g1', 'Grep', {}, invalid('pattern')));
    expect(text).toContain("Hint: this call's arguments were cut off before they finished arriving, so it was not run.");
  });

  it('an unterminated call that was never too long is not told to split', () => {
    registry.recordCutOff('u1', { tool: 'Bash', target: '', finishReason: 'tool_calls' });
    const [text] = messagesFor(exchange('u1', 'Bash', {}, invalid('command')));
    expect(text).toContain('Hint: the arguments JSON was unterminated, so the call was not run. Re-send it complete.');
    expect(text).not.toMatch(/smaller pieces|split/);
  });

  it('NotebookEdit names notebook_path', () => {
    registry.recordCutOff('n1', { tool: 'NotebookEdit', target: '/w/a.ipynb', finishReason: 'length' });
    const [text] = messagesFor(exchange('n1', 'NotebookEdit', { notebook_path: '/w/a.ipynb' }, invalid('new_source')));
    expect(text).toContain('nothing was written to /w/a.ipynb');
  });

  it('a repeat of the same (tool, target) escalates, with a new id each time', () => {
    registry.recordCutOff('w1', { tool: 'Write', target: '/w/a.ts', finishReason: 'length' });
    registry.recordCutOff('w2', { tool: 'Write', target: '/w/a.ts', finishReason: 'length' });
    registry.recordCutOff('w3', { tool: 'Write', target: '/w/b.ts', finishReason: 'length' });
    const texts = messagesFor([
      ...exchange('w1', 'Write', { file_path: '/w/a.ts' }, invalid('content')),
      ...exchange('w2', 'Write', { file_path: '/w/a.ts' }, invalid('content')),
      ...exchange('w3', 'Write', { file_path: '/w/b.ts' }, invalid('content')),
    ]);
    expect(texts[0]).not.toMatch(/time this call was cut off/);
    expect(texts[1]).toContain('This is the 2nd time this call was cut off; split it now.');
    expect(texts[2]).not.toMatch(/time this call was cut off/);
    // Stable on a re-send.
    expect(messagesFor([
      ...exchange('w1', 'Write', { file_path: '/w/a.ts' }, invalid('content')),
      ...exchange('w2', 'Write', { file_path: '/w/a.ts' }, invalid('content')),
    ])[1]).toBe(texts[1]);
  });

  it('a gateway that reuses an id does not get the earlier call\'s cached hint', () => {
    messagesFor(exchange('call_0', 'Write', { file_path: '/w/a.ts' }, invalid('content')));
    registry.recordCutOff('call_0', { tool: 'Write', target: '/w/a.ts', finishReason: 'length' });
    const [text] = messagesFor(exchange('call_0', 'Write', { file_path: '/w/a.ts' }, invalid('content')));
    expect(text).toContain('nothing was written to /w/a.ts');
  });

  it('an unregistered id keeps the parameter hint', () => {
    const [text] = messagesFor(exchange('x1', 'Write', { file_path: '/w/a.ts' }, invalid('content')));
    expect(text).toMatch(/Hint: Write takes required file_path \(string\), content \(string\)\./);
  });
});
