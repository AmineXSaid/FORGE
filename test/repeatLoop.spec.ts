/**
 * The repeat guard's third tier: the same successful call, again and again.
 *
 * Found with DeepSeek V4 Flash through a company gateway (2026-09-25): it
 * re-ran the same `grep` and re-read the same file several times in one answer.
 * Nothing failed, so the failure tiers never stopped it.
 */
import { describe, expect, it } from 'vitest';
import { IDENTICAL_SUCCESS_LIMIT, RepeatGuard, type CallScope } from '../src/services/claude/repeatGuard';

const turn = (promptId = 'p1', agentId?: string): CallScope => ({ sessionId: 's1', promptId, agentId });
const READ = { file_path: 'Tests/security_testcases/tls_testcases/helper.py' };
const GREP = { command: 'grep -rn "EXTENDED_MASTER" .' };

function runs(guard: RepeatGuard, scope: CallScope, tool: string, input: unknown, times: number): void {
    for (let i = 0; i < times; i++) {
        expect(guard.checkRepeat(scope, tool, input).refuse).toBe(false);
        guard.recordRepeat(scope, tool, input);
    }
}

describe('identical successful calls in one turn', () => {
    it('allows two, and refuses the third with a reason the model can act on', () => {
        const guard = new RepeatGuard();
        runs(guard, turn(), 'Read', READ, IDENTICAL_SUCCESS_LIMIT);
        const verdict = guard.checkRepeat(turn(), 'Read', READ);
        expect(verdict).toMatchObject({ refuse: true, tier: 'identical-success', failures: 2 });
        expect(verdict.reason).toMatch(/already ran 2 times in this turn/);
        expect(verdict.reason).toMatch(/Use the output you already have/);
    });

    it('treats the same input with its keys reordered as the same call', () => {
        const guard = new RepeatGuard();
        runs(guard, turn(), 'Grep', { pattern: 'EMS', path: '.' }, 2);
        expect(guard.checkRepeat(turn(), 'Grep', { path: '.', pattern: 'EMS' }).refuse).toBe(true);
    });

    it('counts a different input separately', () => {
        const guard = new RepeatGuard();
        runs(guard, turn(), 'Bash', GREP, 2);
        expect(guard.checkRepeat(turn(), 'Bash', { command: 'grep -rn "master_secret" .' }).refuse).toBe(false);
    });
});

describe('what resets the count', () => {
    it('the next prompt: a new turn starts from zero', () => {
        const guard = new RepeatGuard();
        runs(guard, turn('p1'), 'Read', READ, 2);
        expect(guard.checkRepeat(turn('p2'), 'Read', READ).refuse).toBe(false);
    });

    it('a file edit: reading again after a change is right', () => {
        const guard = new RepeatGuard();
        runs(guard, turn(), 'Read', READ, 2);
        guard.recordRepeat(turn(), 'Edit', { file_path: READ.file_path, old_string: 'a', new_string: 'b' });
        expect(guard.checkRepeat(turn(), 'Read', READ).refuse).toBe(false);
    });

    it('the session ending', () => {
        const guard = new RepeatGuard();
        runs(guard, turn(), 'Read', READ, 2);
        guard.clearSession('s1');
        expect(guard.checkRepeat(turn(), 'Read', READ).refuse).toBe(false);
    });
});

describe('what is never counted', () => {
    it('a subagent is counted apart from the main thread', () => {
        const guard = new RepeatGuard();
        runs(guard, turn('p1'), 'Read', READ, 2);
        expect(guard.checkRepeat(turn('p1', 'agent-1'), 'Read', READ).refuse).toBe(false);
    });

    it('tools that exist to be repeated', () => {
        const guard = new RepeatGuard();
        for (const tool of ['TodoWrite', 'BashOutput', 'AskUserQuestion']) runs(guard, turn(), tool, { x: 1 }, 5);
    });

    it('commands that wait or follow on purpose', () => {
        const guard = new RepeatGuard();
        for (const command of ['sleep 30 && curl -s localhost:8080/health', 'watch -n 5 ls', 'tail -f build.log']) {
            runs(guard, turn(), 'Bash', { command }, 5);
        }
    });
});

describe('the failure tiers are unchanged', () => {
    it('an identical failure is still refused on the third attempt, apart from success counts', () => {
        const guard = new RepeatGuard();
        guard.recordFailure('s1', 'Bash', GREP, 'exit 2');
        guard.recordFailure('s1', 'Bash', GREP, 'exit 2');
        expect(guard.check('s1', 'Bash', GREP)).toMatchObject({ refuse: true, tier: 'identical-input' });
        expect(guard.checkRepeat(turn(), 'Bash', GREP).refuse).toBe(false);
    });
});
