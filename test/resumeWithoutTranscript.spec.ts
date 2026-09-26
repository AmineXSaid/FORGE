/**
 * Picking another model before the first message must not break the chat.
 *
 * Found by e2e scenario 24 (2026-09-25): in a fresh conversation, choosing a
 * different endpoint in the model picker makes the host close the idle
 * channel so the next send relaunches on the new endpoint. The webview then
 * relaunches with `resume: <the id the CLI named at startup>`, but a
 * conversation that never carried a message has no transcript, and the CLI
 * answered every relaunch with "No conversation found with session ID". The
 * host now checks for a transcript before resuming, and starts fresh when
 * there is none.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getProjectHistoryDir, sessionTranscriptExists } from '../src/services/claude/ClaudeSessionService';
import { ClaudeAgentService } from '../src/services/claude/ClaudeAgentService';

const ID = '032ab02e-d82f-4de6-abfb-32ab81dd8c72';
let configDir: string;
const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;

beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-resume-'));
    process.env.CLAUDE_CONFIG_DIR = configDir;
});

afterEach(() => {
    if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
    fs.rmSync(configDir, { recursive: true, force: true });
});

function transcript(cwd: string, id = ID): void {
    const dir = getProjectHistoryDir(cwd);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.jsonl`), '{"type":"user"}\n');
}

describe('whether a session can be resumed', () => {
    it('is when its transcript is in this project', async () => {
        transcript('/repo');
        expect(await sessionTranscriptExists(ID, '/repo')).toBe(true);
    });

    it('is when its transcript is in another project, where the CLI also finds it', async () => {
        transcript('/elsewhere');
        expect(await sessionTranscriptExists(ID, '/repo')).toBe(true);
    });

    it('is not when no message was ever sent, so no transcript exists', async () => {
        transcript('/repo', 'aaaaaaaa-0000-4000-8000-000000000001');
        expect(await sessionTranscriptExists(ID, '/repo')).toBe(false);
    });

    it('is not when the CLI has no projects directory yet', async () => {
        expect(await sessionTranscriptExists(ID, '/repo')).toBe(false);
    });

    it('never touches the filesystem for an id that is not a UUID (B3)', async () => {
        const exists = vi.fn(async () => true);
        const list = vi.fn(async () => ['x']);
        for (const bad of ['../../etc/passwd', `${ID}/../x`, '', 'not-a-uuid']) {
            expect(await sessionTranscriptExists(bad, '/repo', exists, list)).toBe(false);
        }
        expect(exists).not.toHaveBeenCalled();
        expect(list).not.toHaveBeenCalled();
    });
});

describe('a relaunch after the endpoint changed', () => {
    function host() {
        const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const s = new (ClaudeAgentService as any)(
            log, {}, { getDefaultWorkspaceFolder: () => undefined }, {}, {}, {}, {},
            { getThinkingLevel: () => 'off', getAllowDangerouslySkipPermissions: () => false }, {}, {},
            { getStatus: () => ({}) },
            { onDidChangeHealth: () => ({ dispose() {} }) },
        );
        s.setTransport({ send: () => {}, onMessage: () => {} });
        s.getShowThinkingSummaries = async () => undefined;
        const resumed: unknown[] = [];
        s.spawnClaude = async (_in: unknown, resume: unknown) => {
            resumed.push(resume);
            return { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }), return() {} };
        };
        return { s, log, resumed };
    }

    it('starts fresh when the conversation never carried a message', async () => {
        const { s, log, resumed } = host();
        await s.launchClaude('c1', ID, '/repo', 'e2e', 'default', null);
        expect(resumed).toEqual([null]);
        expect(log.info.mock.calls.some(([line]: [string]) => line.includes(`session ${ID} has no transcript`))).toBe(true);
        // Nothing seeds the channel with an id the CLI will never use.
        expect(s.channels.get('c1').sessionId).toBeUndefined();
    });

    it('resumes a conversation that has a transcript', async () => {
        transcript('/repo');
        const { s, resumed } = host();
        await s.launchClaude('c2', ID, '/repo', 'e2e', 'default', null);
        expect(resumed).toEqual([ID]);
        expect(s.channels.get('c2').sessionId).toBe(ID);
    });

    it('launches a new conversation as before', async () => {
        const { s, resumed } = host();
        await s.launchClaude('c3', null, '/repo', 'e2e', 'default', null);
        expect(resumed).toEqual([null]);
    });
});
