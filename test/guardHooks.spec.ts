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
    // Every attempted call is a step, as the SDK's maxTurns counts them.
    const step = (i: number) => ({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Read', tool_input: { file_path: `/f${i}` } });

    it('stops the turn one step past the strict limit, and a new message starts the count again', async () => {
        const { hooks, onStop } = setup('strict', true);
        for (let i = 0; i < STRICT_MAX_TURNS; i++) expect((await hooks.handle(step(i))).continue).toBe(true);
        const over = await hooks.handle(step(STRICT_MAX_TURNS));
        expect(over.continue).toBe(false);
        expect(over.stopReason).toBe(stepCapMessage(STRICT_MAX_TURNS + 1));
        expect(onStop).toHaveBeenCalledWith(stepCapMessage(STRICT_MAX_TURNS + 1));
        await hooks.handle({ hook_event_name: 'UserPromptSubmit', session_id: 's', source: 'user' });
        expect((await hooks.handle(step(999))).continue).toBe(true);
    });

    it('is not applied when the host sets maxTurns itself (stepCap off) or under standard', async () => {
        for (const [level, cap] of [['strict', false], ['standard', true]] as const) {
            const { hooks } = setup(level, cap);
            for (let i = 0; i < STRICT_MAX_TURNS + 5; i++) expect((await hooks.handle(step(i))).continue).toBe(true);
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
