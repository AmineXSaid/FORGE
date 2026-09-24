/**
 * Step 25: `fork_conversation` and the "Message actions" button.
 *
 * Host: `forkConversation.ts` (the validator), `handleForkConversation`, the
 * dispatcher case, and `ClaudeSessionService.forkSession` on the SDK.
 * Webview: the transport method's unwrapping, `AppContext.forkConversation`,
 * `SessionStore.activateSessionFromServer`, and the ordering rules `HU0`
 * applies (which uuid a fork resumes at, and rewind-before-fork).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { signal } from 'alien-signals';
import {
  MAX_FORK_TITLE_LENGTH,
  planForkConversation,
} from '../src/services/claude/forkConversation';
import { handleForkConversation } from '../src/services/claude/handlers/handlers';
import { ClaudeAgentService } from '../src/services/claude/ClaudeAgentService';
import { BaseTransport } from '../src/webview/src/transport/BaseTransport';
import { AppContext } from '../src/webview/src/core/AppContext';
import { SessionStore } from '../src/webview/src/core/SessionStore';
import { Session } from '../src/webview/src/core/Session';
import { Message as MessageModel } from '../src/webview/src/models/Message';
import { rewindTargets } from '../src/webview/src/core/rewind';

beforeAll(() => {
  (globalThis as any).window ??= {
    location: new URL('http://localhost/index.html'),
    history: { replaceState: () => {} },
  };
});

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const MSG = '11111111-0000-4000-8000-000000000001';

// ---------------------------------------------------------------------------
// The validator (B3)
// ---------------------------------------------------------------------------

describe('planForkConversation', () => {
  it('takes a session id alone as "copy the whole conversation"', () => {
    expect(planForkConversation({ type: 'fork_conversation', forkedFromSession: A })).toEqual({
      forkedFromSession: A,
    });
  });

  it('maps resumeSessionAt onto the SDK`s upToMessageId', () => {
    expect(planForkConversation({ forkedFromSession: A, resumeSessionAt: MSG })).toEqual({
      forkedFromSession: A,
      upToMessageId: MSG,
    });
  });

  it('refuses a source that is not a session id', () => {
    for (const bad of ['', '   ', 'nope', '../../etc/passwd', `${A}/../x`, `${A} `, A.slice(0, -1), 42, null, undefined, {}, [A], true]) {
      expect(planForkConversation({ forkedFromSession: bad })).toBeNull();
    }
  });

  it('refuses a resumeSessionAt that is not a message uuid', () => {
    for (const bad of ['', 'nope', '../x', 7, null, {}, []]) {
      expect(planForkConversation({ forkedFromSession: A, resumeSessionAt: bad })).toBeNull();
    }
  });

  it('refuses a non-object request', () => {
    for (const bad of [null, undefined, 'fork_conversation', 7]) {
      expect(planForkConversation(bad)).toBeNull();
    }
  });

  it('caps a title and drops an empty one, so the SDK derives "<original> (fork)"', () => {
    expect(planForkConversation({ forkedFromSession: A, title: '  Trimmed  ' })?.title).toBe('Trimmed');
    expect(planForkConversation({ forkedFromSession: A, title: '   ' })?.title).toBeUndefined();
    expect(planForkConversation({ forkedFromSession: A, title: '' })?.title).toBeUndefined();
    const long = planForkConversation({ forkedFromSession: A, title: 'x'.repeat(500) });
    expect(long?.title).toHaveLength(MAX_FORK_TITLE_LENGTH);
  });

  it('refuses a non-string title', () => {
    expect(planForkConversation({ forkedFromSession: A, title: 7 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The handler and the dispatcher
// ---------------------------------------------------------------------------

describe('handleForkConversation', () => {
  const context = (forkSession: any) => ({
    logService: { info: () => {}, warn: () => {}, error: () => {}, trace: () => {} },
    sessionService: { forkSession },
    workspaceService: { getDefaultWorkspaceFolder: () => ({ uri: { fsPath: '/repo' } }) },
  }) as any;

  it('forks and answers the new session id', async () => {
    const forkSession = vi.fn(async () => B);
    expect(
      await handleForkConversation({ type: 'fork_conversation', forkedFromSession: A, resumeSessionAt: MSG }, context(forkSession))
    ).toEqual({ type: 'fork_conversation_response', sessionId: B });
    expect(forkSession).toHaveBeenCalledWith({ forkedFromSession: A, upToMessageId: MSG }, '/repo');
  });

  it('passes the workspace as `dir`, not every project directory', async () => {
    const forkSession = vi.fn(async () => B);
    await handleForkConversation({ type: 'fork_conversation', forkedFromSession: A }, context(forkSession));
    expect(forkSession.mock.calls[0]![1]).toBe('/repo');
  });

  it('throws for a bad id, the way the official`s store does', async () => {
    const forkSession = vi.fn(async () => B);
    await expect(
      handleForkConversation({ type: 'fork_conversation', forkedFromSession: 'nope' } as any, context(forkSession))
    ).rejects.toThrow('invalid session id');
    await expect(
      handleForkConversation({ type: 'fork_conversation', forkedFromSession: A, resumeSessionAt: 'nope' } as any, context(forkSession))
    ).rejects.toThrow('invalid session id');
    expect(forkSession).not.toHaveBeenCalled();
  });

  it('lets a fork failure reach the transport instead of swallowing it', async () => {
    const forkSession = vi.fn(async () => {
      throw new Error(`Session ${A} not found`);
    });
    await expect(
      handleForkConversation({ type: 'fork_conversation', forkedFromSession: A }, context(forkSession))
    ).rejects.toThrow(`Session ${A} not found`);
  });

  it('is reachable from the dispatcher', async () => {
    const log = { info: () => {}, warn: () => {}, error: () => {}, trace: () => {} };
    const svc = new (ClaudeAgentService as any)(log, {}, {}, {}, {}, {}, {}, {}, {}, {});
    svc.handlerContext = context(async () => B);
    expect(
      await svc.processRequest(
        { type: 'request', requestId: 'r1', request: { type: 'fork_conversation', forkedFromSession: A } },
        undefined as any
      )
    ).toEqual({ type: 'fork_conversation_response', sessionId: B });
  });
});

// ---------------------------------------------------------------------------
// The transport and the context
// ---------------------------------------------------------------------------

describe('BaseTransport.forkConversation', () => {
  const t = (response: any) => {
    const sent: any[] = [];
    const transport = new (BaseTransport as any)();
    transport.send = (m: any) => {
      sent.push(m);
      queueMicrotask(() => {
        const handler = transport.outstandingRequests.get(m.requestId);
        handler?.resolve(response);
      });
    };
    return { transport, sent };
  };

  it('is not channel-scoped and unwraps the bare session id', async () => {
    const { transport, sent } = t({ type: 'fork_conversation_response', sessionId: B });
    const id = await transport.forkConversation(A, MSG);
    expect(id).toBe(B);
    expect(sent[0].channelId).toBeUndefined();
    expect(sent[0].request).toEqual({ type: 'fork_conversation', forkedFromSession: A, resumeSessionAt: MSG });
  });

  it('omits `title` unless one is given', async () => {
    const { transport, sent } = t({ type: 'fork_conversation_response', sessionId: B });
    await transport.forkConversation(A);
    expect('title' in sent[0].request).toBe(false);
    const second = t({ type: 'fork_conversation_response', sessionId: B });
    await second.transport.forkConversation(A, undefined, 'My fork');
    expect(second.sent[0].request.title).toBe('My fork');
  });
});

describe('AppContext.forkConversation', () => {
  const context = (connection: any) => {
    const ctx = new (AppContext as any)({ connection: () => connection, get: async () => connection });
    return ctx as AppContext;
  };

  it('opens the fork and hands the prompt to the composer', async () => {
    const forkConversation = vi.fn(async () => B);
    const ctx = context({ forkConversation, config: () => ({ openNewInTab: false }) });
    const viewed: any[] = [];
    ctx.viewSession = async (id, prompt) => {
      viewed.push([id, prompt]);
      return true;
    };
    await ctx.forkConversation(A, 'the prompt', MSG);
    expect(forkConversation).toHaveBeenCalledWith(A, MSG);
    expect(viewed).toEqual([[B, 'the prompt']]);
  });

  it('does nothing without a connection', async () => {
    const ctx = context(undefined);
    let called = false;
    ctx.viewSession = async () => ((called = true), true);
    await ctx.forkConversation(A, 'x', MSG);
    expect(called).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// activateSessionFromServer
// ---------------------------------------------------------------------------

describe('SessionStore.activateSessionFromServer', () => {
  const sessionContext = {
    currentSelection: signal(undefined),
    commandRegistry: { registerAction: () => {} },
    fileOpener: {},
    renameTab: () => {},
  } as any;

  const store = (sessions: Session[], onList?: () => void) => {
    const s = new (SessionStore as any)(
      { state: () => 'connected', connection: () => undefined },
      sessionContext
    ) as SessionStore;
    (s as any).sessions(sessions);
    (s as any).listSessions = async () => onList?.();
    return s;
  };

  // Making a session active runs `preloadConnection`, which reaches for
  // `config`, `launchClaude` and `getSession`. A fake without them turns into an
  // unhandled rejection, and `pnpm test` exits non-zero on those.
  const fakeConnection = {
    config: () => ({ defaultCwd: '/repo', openNewInTab: false }),
    claudeConfig: () => undefined,
    state: () => 'connected',
    launchClaude: () => ({ [Symbol.asyncIterator]: async function* () {} }),
    getSession: async () => ({ messages: [] }),
    sendInput: () => {},
  } as any;

  const session = (id: string) => {
    const s = new Session(async () => fakeConnection, sessionContext, {} as any);
    s.sessionId(id);
    return s;
  };

  it('activates a session that is already loaded and sets the prompt', async () => {
    const target = session(B);
    const s = store([session(A), target]);
    expect(await s.activateSessionFromServer(B, 'the prompt')).toBe(true);
    expect(s.activeSession()).toBe(target);
    expect(target.initialPrompt()).toBe('the prompt');
  });

  it('re-lists when the id is unknown -- the normal path for a fresh fork', async () => {
    const forked = session(B);
    let listed = 0;
    const s = store([session(A)], () => {
      listed++;
      (s as any).sessions([...(s as any).sessions(), forked]);
    });
    expect(await s.activateSessionFromServer(B, 'the prompt')).toBe(true);
    expect(listed).toBe(1);
    expect(s.activeSession()).toBe(forked);
    expect(forked.initialPrompt()).toBe('the prompt');
  });

  it('gives up when the re-list does not have it either', async () => {
    const s = store([session(A)], () => {});
    expect(await s.activateSessionFromServer(B)).toBe(false);
    expect(s.activeSession()).toBeUndefined();
  });

  it('leaves initialPrompt alone when none is given', async () => {
    const target = session(B);
    const s = store([target]);
    await s.activateSessionFromServer(B);
    expect(target.initialPrompt()).toBeUndefined();
  });

  it('does not clear a draft already waiting when it is re-activated without one', async () => {
    // `if(J)V.initialPrompt.value=J` -- an unconditional assignment would wipe
    // the prompt a fork just put there if the session is activated again first.
    const target = session(B);
    target.initialPrompt('still editing this');
    const s = store([target]);
    await s.activateSessionFromServer(B);
    expect(target.initialPrompt()).toBe('still editing this');
  });
});

// ---------------------------------------------------------------------------
// The ordering rules HU0 applies
// ---------------------------------------------------------------------------

describe('the fork point HU0 picks', () => {
  const row = (type: string, uuid: string | undefined, text: string) =>
    MessageModel.fromRaw({ type, uuid, message: { role: type, content: text } })!;

  /** `I`: the nearest earlier user-or-assistant message with a uuid. */
  function forkPoint(messages: MessageModel[], target: MessageModel): string | undefined {
    for (let i = messages.indexOf(target) - 1; i >= 0; i--) {
      const earlier = messages[i];
      if (earlier?.uuid && (earlier.type === 'assistant' || earlier.type === 'user')) return earlier.uuid;
    }
    return undefined;
  }

  it('is the message before the one you picked, so its prompt can be re-sent', () => {
    const u1 = row('user', 'u1', 'first');
    const a1 = row('assistant', 'a1', 'reply');
    const u2 = row('user', 'u2', 'second');
    expect(forkPoint([u1, a1, u2], u2)).toBe('a1');
  });

  it('is undefined on the first message, which is what makes it a new conversation', () => {
    const u1 = row('user', 'u1', 'first');
    expect(forkPoint([u1], u1)).toBeUndefined();
  });

  it('walks back past rows with no uuid', () => {
    const a1 = row('assistant', 'a1', 'reply');
    const stray = row('assistant', undefined, 'streaming');
    const u2 = row('user', 'u2', 'second');
    expect(forkPoint([a1, stray, u2], u2)).toBe('a1');
  });

  it('agrees with the picker`s own resumeAtMessageId for the same transcript', () => {
    const rows = [
      { type: 'user', uuid: 'u1', timestamp: 1, text: 'first' },
      { type: 'assistant', uuid: 'a1', timestamp: 2, text: 'reply' },
      { type: 'user', uuid: 'u2', timestamp: 3, text: 'second' },
    ];
    const targets = rewindTargets(rows);
    expect(targets.map((t) => [t.uuid, t.resumeAtMessageId])).toEqual([
      ['u2', 'a1'],
      ['u1', undefined],
    ]);
  });
});

describe('"Fork conversation and rewind code" runs rewind first', () => {
  /** `async function G1(){if(M(!1),await i()&&w)s();N(!1)}` */
  async function confirm(rewind: () => Promise<boolean>, fork: () => void, willFork: boolean): Promise<void> {
    const ok = await rewind();
    if (ok && willFork) fork();
  }

  it('forks when the rewind succeeded', async () => {
    const order: string[] = [];
    await confirm(
      async () => (order.push('rewind'), true),
      () => order.push('fork'),
      true
    );
    expect(order).toEqual(['rewind', 'fork']);
  });

  it('does NOT fork when the rewind failed', async () => {
    const order: string[] = [];
    await confirm(
      async () => (order.push('rewind'), false),
      () => order.push('fork'),
      true
    );
    expect(order).toEqual(['rewind']);
  });

  it('does not fork for a rewind-only confirm, even on success', async () => {
    const order: string[] = [];
    await confirm(
      async () => (order.push('rewind'), true),
      () => order.push('fork'),
      false
    );
    expect(order).toEqual(['rewind']);
  });
});
