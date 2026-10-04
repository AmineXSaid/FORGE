/**
 * The "is this model servable" probe must hit the same URL the chat does.
 *
 * Reported 2026-10-04 while setting up Gemini: its OpenAI-compatible route is
 * `…/v1beta/openai/chat/completions`, so the profile pins `chatPath`. The relay
 * honoured it (`anthropicServer.chatUrl`) but `keepServable` rebuilt the URL by
 * hand without it and probed `…/v1beta/openai/v1/chat/completions` -- a 404 for
 * a model the chat could use.
 */
import * as http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { keepServable } from '../src/services/endpoints/check';
import { parseProfile } from '../src/services/endpoints/profile';

describe('keepServable uses the profile chat route', () => {
    let server: http.Server | undefined;
    afterEach(async () => {
        await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
        server = undefined;
    });

    async function serveOnly(path: string): Promise<{ port: number; hits: string[] }> {
        const hits: string[] = [];
        server = http.createServer((req, res) => {
            hits.push(req.url ?? '');
            req.resume();
            req.on('end', () => {
                if (req.url === path) {
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }] }));
                } else {
                    res.writeHead(404).end();
                }
            });
        });
        await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
        return { port: (server.address() as { port: number }).port, hits };
    }

    it('probes base + chatPath for a Gemini-style base URL', async () => {
        const { port, hits } = await serveOnly('/v1beta/openai/chat/completions');
        const profile = parseProfile(
            {
                name: 'gemini',
                wire: 'openai',
                baseUrl: `http://127.0.0.1:${port}/v1beta/openai`,
                chatPath: 'chat/completions',
                model: 'gemini-2.5-flash',
                auth: { kind: 'none' },
            },
            'test',
        );

        const [result] = await keepServable(profile, ['gemini-2.5-flash'], () => undefined, { timeoutMs: 5_000 });

        expect(hits).toEqual(['/v1beta/openai/chat/completions']);
        expect(result.servable).toBe(true);
    });

    it('still appends /v1/chat/completions to a bare origin without chatPath', async () => {
        const { port, hits } = await serveOnly('/v1/chat/completions');
        const profile = parseProfile(
            { name: 'plain', wire: 'openai', baseUrl: `http://127.0.0.1:${port}`, model: 'm', auth: { kind: 'none' } },
            'test',
        );

        const [result] = await keepServable(profile, ['m'], () => undefined, { timeoutMs: 5_000 });

        expect(hits).toEqual(['/v1/chat/completions']);
        expect(result.servable).toBe(true);
    });
});
