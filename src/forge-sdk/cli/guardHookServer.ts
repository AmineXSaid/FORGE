/**
 * The guards over HTTP, for CLIs that are not an SDK session of ours.
 *
 * A terminal CLI launched with `cliGuardSettings(url)` POSTs every hook input
 * here. Each terminal gets its own bearer token, and each token its own guard
 * hooks and level, so two terminals never share a loop count. The server:
 *
 * - listens on 127.0.0.1 only, and answers only a Host of 127.0.0.1 or
 *   localhost on its own port (a DNS-rebinding page cannot reach it);
 * - answers only `POST /hook` with a known `Authorization: Bearer <token>`;
 * - caps the body at 1 MB and requires a JSON object with `hook_event_name`;
 * - fails open: if a guard throws, the CLI is told to continue, because a bug
 *   in Forge must never stop someone's terminal session.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SyncHookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import type { GuardHookInput } from '../guards/guardHooks';

/** Answers one hook input for one terminal. */
export type GuardHookHandler = (input: GuardHookInput) => Promise<SyncHookJSONOutput>;

export const MAX_HOOK_BODY_BYTES = 1024 * 1024;

export interface GuardHookServer {
  /** Where the CLI posts: `http://127.0.0.1:<port>/hook`. */
  readonly url: string;
  /** A new terminal: its token, answered by `handler` until revoked. */
  register(handler: GuardHookHandler): string;
  revoke(token: string): void;
  close(): Promise<void>;
}

export async function startGuardHookServer(log: (line: string) => void = () => {}): Promise<GuardHookServer> {
  const handlers = new Map<string, GuardHookHandler>();
  let port = 0;

  const handlerFor = (header: string | undefined): GuardHookHandler | undefined => {
    const match = /^Bearer (\S+)$/.exec(header ?? '');
    if (!match) return undefined;
    const given = Buffer.from(match[1]);
    for (const [token, handler] of handlers) {
      const known = Buffer.from(token);
      if (known.length === given.length && timingSafeEqual(known, given)) return handler;
    }
    return undefined;
  };

  const reply = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return reply(res, 403, { error: 'host' });
    if (req.url !== '/hook') return reply(res, 404, { error: 'not found' });
    if (req.method !== 'POST') return reply(res, 405, { error: 'method' });
    const handler = handlerFor(req.headers.authorization);
    if (!handler) return reply(res, 401, { error: 'token' });

    const chunks: Buffer[] = [];
    let size = 0;
    let refused = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_HOOK_BODY_BYTES && !refused) {
        refused = true;
        reply(res, 413, { error: 'too large' });
        req.destroy();
      } else if (!refused) {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (refused) return;
      let input: unknown;
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return reply(res, 400, { error: 'json' });
      }
      if (!input || typeof input !== 'object' || typeof (input as GuardHookInput).hook_event_name !== 'string') {
        return reply(res, 400, { error: 'hook input' });
      }
      handler(input as GuardHookInput).then(
        (output) => reply(res, 200, output),
        (error: unknown) => {
          log(`[GuardHooks] ${(input as GuardHookInput).hook_event_name} failed, continuing: ${error instanceof Error ? error.message : String(error)}`);
          reply(res, 200, { continue: true });
        },
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  // Never the reason the host process stays alive.
  server.unref();

  return {
    url: `http://127.0.0.1:${port}/hook`,
    register(handler) {
      const token = randomBytes(24).toString('base64url');
      handlers.set(token, handler);
      return token;
    },
    revoke(token) {
      handlers.delete(token);
    },
    close: () =>
      new Promise<void>((resolve) => {
        handlers.clear();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
