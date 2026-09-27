/**
 * The guards over HTTP (Forge SDK): what a terminal CLI's `type: 'http'` hooks
 * reach. The webview never talks to this, but any local page could try, so
 * every way in other than a known terminal's token is refused.
 */
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_HOOK_BODY_BYTES, startGuardHookServer, type GuardHookServer } from '../src/forge-sdk/cli/guardHookServer';
import { cliGuardSettings, GUARD_HOOK_EVENTS, HOOK_TOKEN_ENV } from '../src/forge-sdk/cli/cliGuardSettings';
import { prepareCliGuards } from '../src/forge-sdk/cli/cliGuards';

let server: GuardHookServer | undefined;
afterEach(async () => {
    await server?.close();
    server = undefined;
});

function post(url: string, body: string, headers: Record<string, string> = {}, method = 'POST'): Promise<{ status: number; json: any }> {
    return new Promise((resolve, reject) => {
        const req = http.request(url, { method, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : undefined });
            });
        });
        req.on('error', (e) => (method === 'POST' && body.length > MAX_HOOK_BODY_BYTES ? resolve({ status: 413, json: undefined }) : reject(e)));
        req.end(body);
    });
}

const input = JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Read', tool_input: {} });

describe('the guard hook server', () => {
    it('listens on loopback and answers a known token with that terminal`s handler', async () => {
        server = await startGuardHookServer();
        expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/hook$/);
        const a = server.register(async () => ({ continue: true, stopReason: 'a' }));
        const b = server.register(async () => ({ continue: false, stopReason: 'b' }));
        expect(a).not.toBe(b);
        expect((await post(server.url, input, { authorization: `Bearer ${a}` })).json).toEqual({ continue: true, stopReason: 'a' });
        expect((await post(server.url, input, { authorization: `Bearer ${b}` })).json).toEqual({ continue: false, stopReason: 'b' });
    });

    it('refuses no token, a wrong token and a revoked one', async () => {
        server = await startGuardHookServer();
        const token = server.register(async () => ({ continue: true }));
        expect((await post(server.url, input)).status).toBe(401);
        expect((await post(server.url, input, { authorization: `Bearer ${token}x` })).status).toBe(401);
        expect((await post(server.url, input, { authorization: token })).status).toBe(401);
        server.revoke(token);
        expect((await post(server.url, input, { authorization: `Bearer ${token}` })).status).toBe(401);
    });

    it('answers only POST /hook, for its own host', async () => {
        server = await startGuardHookServer();
        const token = server.register(async () => ({ continue: true }));
        const auth = { authorization: `Bearer ${token}` };
        expect((await post(server.url.replace('/hook', '/other'), input, auth)).status).toBe(404);
        expect((await post(server.url, '', auth, 'GET')).status).toBe(405);
        expect((await post(server.url, input, { ...auth, host: 'evil.example' })).status).toBe(403);
    });

    it('refuses a body that is not a hook input, and one that is too large', async () => {
        server = await startGuardHookServer();
        const auth = { authorization: `Bearer ${server.register(async () => ({ continue: true }))}` };
        expect((await post(server.url, '{not json', auth)).status).toBe(400);
        expect((await post(server.url, '[]', auth)).status).toBe(400);
        expect((await post(server.url, JSON.stringify({ tool_name: 'Read' }), auth)).status).toBe(400);
        const big = JSON.stringify({ hook_event_name: 'Stop', pad: 'x'.repeat(MAX_HOOK_BODY_BYTES) });
        expect((await post(server.url, big, auth)).status).toBe(413);
    });

    it('fails open: a guard that throws lets the CLI continue', async () => {
        const lines: string[] = [];
        server = await startGuardHookServer((l) => lines.push(l));
        const auth = { authorization: `Bearer ${server.register(async () => { throw new Error('boom'); })}` };
        expect(await post(server.url, input, auth)).toEqual({ status: 200, json: { continue: true } });
        expect(lines.join('\n')).toContain('boom');
    });
});

describe('a CLI launch`s guards', () => {
    it('the settings layer: an HTTP hook per guarded event, the token only as a variable', () => {
        const settings = cliGuardSettings('http://127.0.0.1:9/hook');
        expect(Object.keys(settings.hooks)).toEqual([...GUARD_HOOK_EVENTS]);
        const hook = (settings.hooks.PreToolUse[0] as any).hooks[0];
        expect(hook).toMatchObject({
            type: 'http',
            url: 'http://127.0.0.1:9/hook',
            headers: { Authorization: `Bearer $${HOOK_TOKEN_ENV}` },
            allowedEnvVars: [HOOK_TOKEN_ENV],
        });
    });

    it('off adds nothing: no token, no file, no flag', async () => {
        server = await startGuardHookServer();
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-cli-guards-'));
        const launch = prepareCliGuards({ server, level: 'off', dir, log: () => {}, onStop: () => {} });
        expect(launch.settingsFile).toBeUndefined();
        expect(launch.env).toEqual({});
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    it('strict: a private settings file without the token, and a token the server answers until disposed', async () => {
        server = await startGuardHookServer();
        const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-cli-guards-')), 'nested');
        const launch = prepareCliGuards({ server, level: 'strict', dir, log: () => {}, onStop: () => {} });
        const token = launch.env[HOOK_TOKEN_ENV];
        expect(token).toBeTruthy();
        const text = fs.readFileSync(launch.settingsFile!, 'utf8');
        expect(text).not.toContain(token);
        expect(JSON.parse(text)).toEqual(cliGuardSettings(server.url));
        if (process.platform !== 'win32') expect(fs.statSync(launch.settingsFile!).mode & 0o777).toBe(0o600);
        expect((await post(server.url, input, { authorization: `Bearer ${token}` })).status).toBe(200);
        launch.dispose();
        expect((await post(server.url, input, { authorization: `Bearer ${token}` })).status).toBe(401);
    });
});
