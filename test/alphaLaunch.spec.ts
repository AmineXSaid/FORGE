/**
 * 48b: what a launch puts in place under Alpha mode. The real
 * `ClaudeSdkService.query()` builds its options; the SDK's `query` is mocked
 * to capture them, so nothing is spawned.
 */
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const captured: any[] = [];
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
    query: vi.fn((args: any) => {
        captured.push(args.options);
        return { interrupt: async () => {} };
    }),
}));

import { ClaudeSdkService } from '../src/services/claude/ClaudeSdkService';
import { AsyncStream } from '../src/services/claude/transport/AsyncStream';

const ROOT = path.resolve(__dirname, '..');

function service(profile: Record<string, unknown> | undefined) {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() };
    const s = new (ClaudeSdkService as any)(
        { asAbsolutePath: (p: string) => path.join(ROOT, p), extensionPath: ROOT, globalState: { get: () => undefined } },
        log,
        { getEnvironmentVariables: async () => ({}), getExtensionConfig: async () => ({}) },
        { pathExists: async () => true, stat: async () => ({ size: 1 }), isExecutable: async () => true },
        {
            getStatus: () => ({ profile }),
            listProfiles: () => ({ profiles: profile ? [profile] : [] }),
            resolveActiveProfile: () => profile,
        },
        { getActiveSdkOptions: () => undefined },
    );
    vi.spyOn(s, 'getClaudeExecutablePath').mockResolvedValue('/tmp/claude-0/fakebin/claude');
    vi.spyOn(s, 'getMergedEnvironmentVariables').mockResolvedValue(
        profile ? { ANTHROPIC_BASE_URL: 'http://127.0.0.1:1/', ANTHROPIC_MODEL: 'm' } : {},
    );
    return s;
}

async function launch(profile: Record<string, unknown> | undefined, alpha: boolean) {
    captured.length = 0;
    const launched = vi.fn();
    await service(profile).query({
        inputStream: new AsyncStream(),
        resume: null,
        canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
        model: null,
        cwd: ROOT,
        permissionMode: 'default',
        alphaMode: () => alpha,
        onLaunched: launched,
    });
    return { options: captured[0], launched };
}

describe('48b: Alpha at launch', () => {
    beforeEach(() => captured.splice(0));

    it('Alpha on, Claude (no profile): _alpha.md in systemPrompt.append, maxTurns 60', async () => {
        const { options, launched } = await launch(undefined, true);
        expect(options.systemPrompt.append).toContain('# Alpha mode: working rules');
        expect(options.maxTurns).toBe(60);
        expect(launched).toHaveBeenCalledWith({ maxTurns: 60, alphaRules: true });
    });

    it('Alpha off, Claude: neither (as before Alpha)', async () => {
        const { options, launched } = await launch(undefined, false);
        expect(options.systemPrompt.append).not.toContain('Alpha mode');
        expect(options.maxTurns).toBeUndefined();
        expect(launched).toHaveBeenCalledWith({ maxTurns: undefined, alphaRules: false });
    });

    it('strict + Alpha: the small-model rules, then the Alpha rules after them', async () => {
        const { options } = await launch({ name: 'gw', wire: 'openai', baseUrl: 'http://127.0.0.1:1/v1', model: 'm' }, true);
        const append: string = options.systemPrompt.append;
        expect(append.indexOf('# Working rules')).toBeGreaterThan(-1);
        expect(append.indexOf('# Alpha mode: working rules')).toBeGreaterThan(append.indexOf('# Working rules'));
        expect(options.maxTurns).toBe(60);
    });

    it('wires a SessionStart hook (resume and compaction)', async () => {
        const { options } = await launch(undefined, true);
        expect(options.hooks.SessionStart).toHaveLength(1);
    });
});
