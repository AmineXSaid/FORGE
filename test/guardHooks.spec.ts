/**
 * The guard hooks as one module (Forge SDK): the methods the chat wires as SDK
 * callbacks, and `handle()`, which a terminal CLI reaches over HTTP.
 */
import { describe, expect, it, vi } from 'vitest';
import { createGuardHooks, merge, stepCapMessage } from '../src/forge-sdk/guards/guardHooks';
import { LoopGuard, STRICT_MAX_TURNS } from '../src/forge-sdk/guards/loopGuard';
import { RepeatGuard } from '../src/forge-sdk/guards/repeatGuard';
import { FailureHints } from '../src/forge-sdk/guards/failureHints';
import { StopGate } from '../src/forge-sdk/guards/stopGate';
import type { GuardLevel } from '../src/forge-sdk/guards/levels';
import { resolveGuardLevel } from '../src/forge-sdk/guards/levels';

function setup(level: GuardLevel = 'strict', stepCap = false) {
    const onStop = vi.fn();
    const log = vi.fn();
    const hooks = createGuardHooks({
        level: () => level,
        log,
        onStop,
        stepCap,
        state: { loop: new LoopGuard(), repeat: new RepeatGuard(), hints: new FailureHints(), gate: new StopGate() },
    });
    return { hooks, onStop, log };
}

const read = { hook_event_name: 'PostToolUse', session_id: 's', tool_name: 'Read', tool_input: { file_path: '/a' }, tool_response: 'same text' };

describe('guard level', () => {
    it('is the profile`s own, else strict for OpenAI wire and standard otherwise', () => {
        expect(resolveGuardLevel({ guards: 'off', wire: 'openai' })).toBe('off');
        expect(resolveGuardLevel({ wire: 'openai' })).toBe('strict');
        expect(resolveGuardLevel({ wire: 'anthropic' })).toBe('standard');
        expect(resolveGuardLevel(undefined)).toBe('standard');
    });
});

describe('handle(): the hooks as one HTTP-reachable answer', () => {
    it('warns a model that repeats a step, then ends the turn and tells the host', async () => {
        const { hooks, onStop } = setup('strict');
        const outputs = [];
        for (let i = 0; i < 8; i++) {
            const out = await hooks.handle(read);
            outputs.push(out);
            if (out.continue === false) break;
        }
        const nudge = outputs.find((o) => (o.hookSpecificOutput as any)?.additionalContext?.includes('Potential loop detected'));
        expect(nudge).toBeDefined();
        const stop = outputs.at(-1)!;
        expect(stop.continue).toBe(false);
        expect(onStop).toHaveBeenCalledTimes(1);
    });

    it('refuses a call that failed the same way before, with the reason', async () => {
        const { hooks } = setup('strict');
        const call = { session_id: 's', tool_name: 'Read', tool_input: { file_path: '/missing' } };
        for (let i = 0; i < 2; i++) {
            await hooks.handle({ ...call, hook_event_name: 'PostToolUseFailure', error: 'File does not exist.' });
        }
        const pre = await hooks.handle({ ...call, hook_event_name: 'PreToolUse' });
        expect((pre.hookSpecificOutput as any)?.permissionDecision).toBe('deny');
        expect((pre.hookSpecificOutput as any)?.permissionDecisionReason).toBeTruthy();
    });

    it('sends an unbacked claim back once before the model may stop', async () => {
        const { hooks } = setup('strict');
        await hooks.handle({ hook_event_name: 'UserPromptSubmit', session_id: 's', source: 'user' });
        const out = await hooks.handle({
            hook_event_name: 'Stop', session_id: 's', stop_hook_active: false,
            last_assistant_message: 'Done: I updated `src/config.ts` and the tests pass.',
        });
        expect((out.hookSpecificOutput as any)?.additionalContext).toMatch(/Before you finish/);
    });

    it('a model that keeps retrying a refused call is warned, then stopped', async () => {
        const { hooks, onStop } = setup('strict');
        const pre = { hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Read', tool_input: { file_path: '/a' } };
        const outs = [];
        for (let i = 0; i < 12; i++) {
            const p = await hooks.handle(pre);
            outs.push(p);
            if (p.continue === false) break;
            if ((p.hookSpecificOutput as any)?.permissionDecision !== 'deny') await hooks.handle({ ...read, tool_input: pre.tool_input });
        }
        const reasons = outs.map((o) => String((o.hookSpecificOutput as any)?.permissionDecisionReason ?? ''));
        expect(reasons.some((r) => r.includes('Potential loop detected'))).toBe(true);
        expect(outs.at(-1)!.continue).toBe(false);
        expect((outs.at(-1)!.hookSpecificOutput as any)?.permissionDecision).toBe('deny');
        expect(onStop).toHaveBeenCalledTimes(1);
    });

    it('does nothing at all when guards are off', async () => {
        const { hooks } = setup('off', true);
        for (let i = 0; i < 100; i++) expect(await hooks.handle(read)).toEqual({ continue: true });
    });

    it('ignores events it does not guard', async () => {
        const { hooks } = setup();
        expect(await hooks.handle({ hook_event_name: 'SessionStart' })).toEqual({ continue: true });
    });
});

describe('the step cap, for hosts without maxTurns', () => {
    // A step is a model turn: a call, then its result. Parallel calls count once.
    const call = (i: number) => ({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Read', tool_input: { file_path: `/f${i}` } });

    it('stops the turn one step past the strict limit, and a new message starts the count again', async () => {
        const { hooks, onStop } = setup('strict', true);
        const result = (i: number) => hooks.handle({ ...call(i), hook_event_name: 'PostToolUse', tool_response: `r${i}` });
        for (let i = 0; i < STRICT_MAX_TURNS; i++) {
            expect((await hooks.handle(call(i))).continue).toBe(true);
            await result(i);
        }
        const over = await hooks.handle(call(STRICT_MAX_TURNS));
        expect(over.continue).toBe(false);
        expect(over.stopReason).toBe(stepCapMessage(STRICT_MAX_TURNS + 1));
        expect(onStop).toHaveBeenCalledWith(stepCapMessage(STRICT_MAX_TURNS + 1));
        await hooks.handle({ hook_event_name: 'UserPromptSubmit', session_id: 's', source: 'user' });
        expect((await hooks.handle(call(999))).continue).toBe(true);
    });

    it('is not applied when the host sets maxTurns itself (stepCap off) or under standard', async () => {
        for (const [level, cap] of [['strict', false], ['standard', true]] as const) {
            const { hooks } = setup(level, cap);
            for (let i = 0; i < STRICT_MAX_TURNS + 5; i++) {
                expect((await hooks.handle(call(i))).continue).toBe(true);
                await hooks.handle({ ...call(i), hook_event_name: 'PostToolUse', tool_response: `r${i}` });
            }
        }
    });
});

describe('merge', () => {
    it('lets a stop or a deny win, and joins context', () => {
        expect(merge('PostToolUse', [
            { continue: true, hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'a' } },
            { continue: true, hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'b' } },
        ])).toEqual({ continue: true, hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'a\n\nb' } });
        expect(merge('PostToolUse', [{ continue: true }, { continue: false, stopReason: 'x' }])).toEqual({ continue: false, stopReason: 'x' });
        const deny = { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'r' } as any;
        expect(merge('PreToolUse', [{ continue: true }, { continue: true, hookSpecificOutput: deny }]).hookSpecificOutput).toEqual(deny);
        expect(merge('Stop', [{ continue: true }])).toEqual({ continue: true });
    });
});

describe('48b: Alpha mode runs the strict checks on any profile', () => {
    function alphaSetup(level: GuardLevel, opts: { stepCap?: boolean; turnsUsed?: (s: string) => number; alpha?: () => boolean } = {}) {
        const onStop = vi.fn();
        const diags = new (class {
            before = vi.fn();
            after = vi.fn(async () => 'Your edit to /w/a.ts introduced 1 new error(s)');
        })();
        const hooks = createGuardHooks({
            level: () => level,
            alpha: opts.alpha ?? (() => true),
            log: vi.fn(),
            onStop,
            stepCap: opts.stepCap,
            turnsUsed: opts.turnsUsed,
            editDiagnostics: diags as any,
            state: { loop: new LoopGuard(), repeat: new RepeatGuard(), hints: new FailureHints(), gate: new StopGate() },
        });
        return { hooks, onStop, diags };
    }

    for (const level of ['standard', 'off'] as const) {
        it(`${level} + Alpha: claim challenge, edit diagnostics, read-only reminder, 3-repeat loop`, async () => {
            const { hooks, diags } = alphaSetup(level);
            const stop = await hooks.stop({ hook_event_name: 'Stop', session_id: 's', last_assistant_message: 'I updated `src/x.ts`.' });
            expect((stop.hookSpecificOutput as any)?.additionalContext).toMatch(/Before you finish/);

            await hooks.preEdit({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Edit', tool_input: { file_path: '/w/a.ts' }, tool_use_id: 'e1' });
            expect(diags.before).toHaveBeenCalled();
            const edit = await hooks.postEdit({ hook_event_name: 'PostToolUse', session_id: 's', tool_name: 'Edit', tool_input: { file_path: '/w/a.ts' }, tool_use_id: 'e1' });
            expect((edit.hookSpecificOutput as any)?.additionalContext).toMatch(/introduced 1 new error/);

            const outs = [];
            for (let i = 0; i < 20; i++) outs.push(await hooks.postToolUseLoop({ ...read, session_id: 'r', tool_input: { file_path: `/f${i}` }, tool_response: `t${i}` }));
            expect((outs[19].hookSpecificOutput as any)?.additionalContext).toMatch(/20 read-only calls in a row/);
            expect(outs.slice(0, 19).every((o) => !o.hookSpecificOutput)).toBe(true);

            const loop = [];
            for (let i = 0; i < 3; i++) loop.push(await hooks.postToolUseLoop({ ...read, session_id: 'l' }));
            expect((loop[2].hookSpecificOutput as any)?.additionalContext).toMatch(/Potential loop detected/);
        });
    }

    it('Alpha off on standard keeps today: no challenge, no edit check', async () => {
        const { hooks, diags } = alphaSetup('standard', { alpha: () => false });
        expect(await hooks.stop({ hook_event_name: 'Stop', session_id: 's', last_assistant_message: 'I updated `src/x.ts`.' })).toEqual({ continue: true });
        await hooks.preEdit({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Edit', tool_input: { file_path: '/w/a.ts' }, tool_use_id: 'e1' });
        expect(diags.before).not.toHaveBeenCalled();
    });

    it('a toggle applies from the next call', async () => {
        let on = false;
        const { hooks } = alphaSetup('standard', { alpha: () => on });
        const claim = { hook_event_name: 'Stop', session_id: 's', last_assistant_message: 'I updated `src/x.ts`.' };
        expect(await hooks.stop(claim)).toEqual({ continue: true });
        on = true;
        expect((await hooks.stop(claim)).hookSpecificOutput).toBeDefined();
    });

    it('the terminal step counter counts model turns: a parallel batch counts once; it trips at 61 under Alpha', async () => {
        const { hooks, onStop } = alphaSetup('off', { stepCap: true });
        const pre = (i: number) => ({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Read', tool_input: { file_path: `/p${i}` } });
        const post = (i: number) => ({ ...pre(i), hook_event_name: 'PostToolUse', tool_response: `r${i}` });
        for (let turn = 0; turn < 60; turn++) {
            // Three parallel calls, then their three results.
            for (let k = 0; k < 3; k++) expect((await hooks.handle(pre(turn * 3 + k))).continue).toBe(true);
            for (let k = 0; k < 3; k++) await hooks.handle(post(turn * 3 + k));
        }
        const over = await hooks.handle(pre(999));
        expect(over.continue).toBe(false);
        expect(over.stopReason).toBe(stepCapMessage(61, true));
        expect(onStop).toHaveBeenCalledWith(expect.stringMatching(/^Forge stopped this turn at Alpha mode's step limit \(61 steps\)/));
    });

    it('the wrap-up nudge fires once a turn at turnsUsed 50', async () => {
        let used = 49;
        const { hooks } = alphaSetup('standard', { turnsUsed: () => used });
        const a = await hooks.postToolUseLoop({ ...read, tool_input: { file_path: '/n1' }, tool_response: 'n1' });
        expect(a.hookSpecificOutput).toBeUndefined();
        used = 50;
        const b = await hooks.postToolUseLoop({ ...read, tool_input: { file_path: '/n2' }, tool_response: 'n2' });
        expect((b.hookSpecificOutput as any)?.additionalContext).toMatch(/10 steps left this turn/);
        used = 51;
        const c = await hooks.postToolUseLoop({ ...read, tool_input: { file_path: '/n3' }, tool_response: 'n3' });
        expect(c.hookSpecificOutput).toBeUndefined();
        await hooks.userPromptSubmit({ hook_event_name: 'UserPromptSubmit', session_id: 's', source: 'user' });
        used = 55;
        const d = await hooks.postToolUseLoop({ ...read, tool_input: { file_path: '/n4' }, tool_response: 'n4' });
        expect((d.hookSpecificOutput as any)?.additionalContext).toMatch(/5 steps left this turn/);
    });

    it('handle() at off with Alpha off still returns CONTINUE for everything', async () => {
        const { hooks } = alphaSetup('off', { alpha: () => false, stepCap: true });
        for (let i = 0; i < 100; i++) expect(await hooks.handle(read)).toEqual({ continue: true });
        expect(await hooks.handle({ hook_event_name: 'Stop', session_id: 's', last_assistant_message: 'I updated `a/b.ts`.' })).toEqual({ continue: true });
    });

    it('a resumed session (SessionStart resume) holds the claim check until a call runs', async () => {
        const { hooks } = alphaSetup('standard');
        await hooks.sessionStart({ hook_event_name: 'SessionStart', session_id: 'z', source: 'resume' });
        expect(await hooks.stop({ hook_event_name: 'Stop', session_id: 'z', last_assistant_message: 'I updated `src/x.ts`.' })).toEqual({ continue: true });
    });
});
