/**
 * "The check must be fast for UX" (the user, 2026-09-26).
 *
 * The welcome page and the Settings table sit on "Checking…" until every
 * endpoint has answered. Three things made that wait long: endpoints were
 * checked one after another, an unreachable host cost the 15s connect
 * timeout a chat turn allows, and a model that never replies cost 20s. The
 * sweep's side of it is covered in `endpointHealth.spec.ts`; this file holds
 * the pure rules and the one that needs a real socket.
 */
import * as net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
    INTERACTIVE_PROBE_TIMEOUT_MS,
    PROBE_TIMEOUT_MS,
    inParallel,
    probeTimeoutFor,
} from '../src/services/endpoints/healthStore';
import { keepServable } from '../src/services/endpoints/check';
import { parseProfile } from '../src/services/endpoints/profile';
import { isLoopback } from '../src/services/endpoints/setupFlow';

describe('the answer deadline', () => {
    it('is short for a remote endpoint the user is waiting on', () => {
        expect(probeTimeoutFor('https://gpt.example.net/v1', false)).toBe(INTERACTIVE_PROBE_TIMEOUT_MS);
    });

    it('stays long on the timer, where nobody is waiting', () => {
        expect(probeTimeoutFor('https://gpt.example.net/v1', true)).toBe(PROBE_TIMEOUT_MS);
    });

    it('stays long for a local runtime, which loads the model on the first request', () => {
        for (const url of ['http://localhost:11434/v1', 'http://127.0.0.1:1234/v1', 'http://[::1]:8000/v1']) {
            expect(probeTimeoutFor(url, false)).toBe(PROBE_TIMEOUT_MS);
        }
    });

    it('treats a malformed URL as remote', () => {
        expect(probeTimeoutFor('not a url', false)).toBe(INTERACTIVE_PROBE_TIMEOUT_MS);
    });

    it('moved `isLoopback` without changing what setupFlow exports', () => {
        expect(isLoopback('http://localhost:11434/v1')).toBe(true);
        expect(isLoopback('http://10.0.0.5:8000/v1')).toBe(false);
    });
});

describe('inParallel', () => {
    it('keeps input order whatever order the work finishes in', async () => {
        const out = await inParallel([30, 5, 15], 3, (ms) => new Promise<number>((r) => setTimeout(() => r(ms), ms)));
        expect(out).toEqual([30, 5, 15]);
    });

    it('never runs more than the limit at once', async () => {
        let running = 0;
        let peak = 0;
        await inParallel(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
            running += 1;
            peak = Math.max(peak, running);
            await new Promise((r) => setTimeout(r, 5));
            running -= 1;
        });
        expect(peak).toBe(3);
    });

    it('answers an empty list at once', async () => {
        expect(await inParallel([], 4, async () => 1)).toEqual([]);
    });
});

describe('a probe against a host that never completes the handshake', () => {
    let server: net.Server | undefined;
    const sockets: net.Socket[] = [];
    afterEach(async () => {
        sockets.splice(0).forEach((s) => s.destroy());
        await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
        server = undefined;
    });

    it('gives up after the connect deadline, not the chat turn`s 15s', async () => {
        // Accepts TCP and then says nothing: the TLS handshake never finishes,
        // which is how a black-holed corporate gateway looks from outside.
        server = net.createServer((socket) => void sockets.push(socket));
        await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
        const port = (server.address() as net.AddressInfo).port;
        const profile = parseProfile(
            { name: 'silent', wire: 'openai', baseUrl: `https://127.0.0.1:${port}/v1`, model: 'm', auth: { kind: 'none' } },
            'test',
        );

        const started = Date.now();
        const [result] = await keepServable(profile, ['m'], () => undefined, { connectTimeoutMs: 300, timeoutMs: 20_000 });
        const took = Date.now() - started;

        expect(result).toMatchObject({ id: 'm', servable: false, detail: 'could not connect' });
        expect(took).toBeGreaterThanOrEqual(250);
        expect(took).toBeLessThan(3_000);
    });
});
