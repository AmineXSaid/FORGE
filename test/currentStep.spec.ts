/**
 * The working indicator names the running tool and its elapsed time
 * ("Editing ChatPage.vue · 1m 7s") instead of a random verb (2026-10-04).
 */
import { describe, expect, it } from 'vitest';
import { describeStep, formatElapsed, runningStep, type StepSourceMessage } from '../src/webview/src/core/currentStep';

const toolUse = (id: string, name: string, input: unknown, done = false) => ({
    content: { type: 'tool_use', id, name, input },
    hasToolResult: () => done,
});
const assistant = (...blocks: unknown[]): StepSourceMessage => ({ type: 'assistant', message: { content: blocks } });
const user = (): StepSourceMessage => ({ type: 'user', message: { content: 'hi' } });

describe('runningStep', () => {
    it('is the newest tool call without a result', () => {
        const step = runningStep([
            user(),
            assistant(toolUse('a', 'Read', { file_path: '/repo/src/a.ts' }, true)),
            assistant({ content: { type: 'text', text: 'ok' } }, toolUse('b', 'Edit', { file_path: 'C:\\repo\\src\\pages\\ChatPage.vue' })),
        ]);
        expect(step).toEqual({ id: 'b', label: 'Editing ChatPage.vue' });
    });

    it('is nothing when the newest tool call has finished, or there is none', () => {
        expect(runningStep([assistant(toolUse('a', 'Bash', { command: 'ls' }, true))])).toBeUndefined();
        expect(runningStep([user(), assistant({ content: { type: 'text', text: 'hello' } })])).toBeUndefined();
        expect(runningStep([])).toBeUndefined();
    });
});

describe('describeStep', () => {
    it('names common tools with their target', () => {
        expect(describeStep('Read', { file_path: '/x/README.md' })).toBe('Reading README.md');
        expect(describeStep('Write', { file_path: 'out.json' })).toBe('Writing out.json');
        expect(describeStep('Bash', { command: 'npm test', description: 'Run the unit tests' })).toBe('Run the unit tests');
        expect(describeStep('Bash', { command: 'npm test' })).toBe('Running npm test');
        expect(describeStep('Bash', { command: 'pnpm test', description: 'run full test, typecheck, build' })).toBe('Run full test, typecheck, build');
        expect(describeStep('Grep', { pattern: 'TODO' })).toBe('Searching for TODO');
        expect(describeStep('WebFetch', { url: 'https://example.com/a?b=1' })).toBe('Fetching example.com');
        expect(describeStep('Agent', { description: 'audit the relay' })).toBe('Running a subagent: audit the relay');
        expect(describeStep('mcp__github__create_issue', {})).toBe('Using create_issue (github)');
    });

    it('copes with input that is still streaming in', () => {
        expect(describeStep('Edit', undefined)).toBe('Editing');
        expect(describeStep('Bash', {})).toBe('Running');
        expect(describeStep('', undefined)).toBe('Working');
    });

    it('keeps a long command to one short line', () => {
        const label = describeStep('Bash', { command: `echo ${'x'.repeat(200)}\nsecond line` });
        expect(label.length).toBeLessThanOrEqual('Running '.length + 48);
        expect(label).not.toContain('\n');
        expect(label.endsWith('…')).toBe(true);
    });
});

describe('formatElapsed', () => {
    it('reads like a stopwatch', () => {
        expect(formatElapsed(0)).toBe('0s');
        expect(formatElapsed(12_400)).toBe('12s');
        expect(formatElapsed(67_000)).toBe('1m 7s');
        expect(formatElapsed(3_780_000)).toBe('1h 3m');
        expect(formatElapsed(-5)).toBe('0s');
    });
});

describe('liveStep: what the model is doing now', async () => {
    const { liveStep, runningTasksLabel, stepLabel } = await import('../src/webview/src/core/currentStep');
    const thinking = (partial: boolean) => ({ content: { type: 'thinking' }, isPartial: partial });
    it('an open tool call wins', () => {
        expect(liveStep([assistant(thinking(true), toolUse('t1', 'Read', { file_path: 'a.ts' }))])).toEqual({ id: 't1', label: 'Reading a.ts' });
    });
    it('a thought still streaming reads "Thinking"; a finished one does not', () => {
        expect(liveStep([user(), assistant(thinking(true))])?.label).toBe('Thinking');
        expect(liveStep([user(), assistant(thinking(false))])).toBeUndefined();
    });
    it('a subagent\'s thought is not the main thread\'s', () => {
        expect(liveStep([user(), { ...assistant(thinking(true)), parentToolUseId: 'tu1' }])).toBeUndefined();
    });
    it('streaming text is on screen already: no step', () => {
        expect(liveStep([user(), assistant({ content: { type: 'text', text: 'Hel' }, isPartial: true })])).toBeUndefined();
    });
    it('labels', () => {
        expect(runningTasksLabel(1)).toBe('1 running task');
        expect(runningTasksLabel(4)).toBe('4 running tasks');
        expect(stepLabel({ id: 'x', label: 'Thinking' })).toBe('Thinking');
    });
});
