/**
 * The channel messages that are not requests, and the two pushes that had no
 * spec (production audit, Phase 2):
 *
 * - `interrupt_claude`: Stop. Runs on the channel's own queue, after anything
 *   already queued for it, and a failure is logged, never thrown into the loop.
 * - `cancel_request`: the webview gave up on a request (a diff it closed); the
 *   host aborts that request's signal.
 * - `visibility_changed` (host -> webview): the envelope the transport reads,
 *   and what the webview does with it.
 * - `sdk_error` (host -> webview): a model request error from the CLI's
 *   stderr, shown in the transcript during a turn and as a notification outside one.
 */
import { describe, expect, it, vi } from 'vitest';
import { ClaudeAgentService } from '../src/services/claude/ClaudeAgentService';
import { postVisibility } from '../src/services/webViewService';
import { BaseTransport } from '../src/webview/src/transport/BaseTransport';
import { Session } from '../src/webview/src/core/Session';
import { EventEmitter } from '../src/webview/src/utils/events';
import { signal } from 'alien-signals';

const log = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() });
const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
};

function host(interrupt = vi.fn(async () => {})) {
  const logService = log();
  const s = new (ClaudeAgentService as any)(logService, {}, {}, {}, {}, {}, {}, { interrupt }, {}, {}, {}, {});
  return { s, logService, interrupt };
}

describe('interrupt_claude', () => {
  it("interrupts the channel's query", async () => {
    const { s, interrupt } = host();
    const query = { name: 'q1' };
    s.channels.set('c1', { query });
    s.dispatchFromClient({ type: 'interrupt_claude', channelId: 'c1' });
    await until(() => interrupt.mock.calls.length === 1);
    expect(interrupt).toHaveBeenCalledWith(query);
  });

  it('waits for work already queued on the channel (a launch still starting)', async () => {
    const { s, interrupt } = host();
    const order: string[] = [];
    let finishLaunch!: () => void;
    s.onChannel('c1', () => new Promise<void>((resolve) => { finishLaunch = () => { order.push('launched'); s.channels.set('c1', { query: {} }); resolve(); }; }));
    interrupt.mockImplementation(async () => { order.push('interrupted'); });
    s.dispatchFromClient({ type: 'interrupt_claude', channelId: 'c1' });
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([]);
    finishLaunch();
    await until(() => order.length === 2);
    expect(order).toEqual(['launched', 'interrupted']);
  });

  it('a channel that does not exist is a warning, not an error', async () => {
    const { s, logService, interrupt } = host();
    s.dispatchFromClient({ type: 'interrupt_claude', channelId: 'gone' });
    await until(() => logService.warn.mock.calls.length === 1);
    expect(interrupt).not.toHaveBeenCalled();
    expect(logService.warn.mock.calls[0][0]).toMatch(/No such channel: gone/);
  });

  it('a failed interrupt is logged, and the loop carries on', async () => {
    const { s, logService } = host(vi.fn(async () => { throw new Error('CLI gone'); }));
    s.channels.set('c1', { query: {} });
    s.dispatchFromClient({ type: 'interrupt_claude', channelId: 'c1' });
    await until(() => logService.error.mock.calls.length === 1);
    expect(logService.error.mock.calls[0][0]).toMatch(/Interrupt failed/);
  });
});

describe('cancel_request', () => {
  it("aborts that request's signal and forgets it", () => {
    const { s } = host();
    const controller = new AbortController();
    s.abortControllers.set('r1', controller);
    s.dispatchFromClient({ type: 'cancel_request', targetRequestId: 'r1' });
    expect(controller.signal.aborted).toBe(true);
    expect(s.abortControllers.has('r1')).toBe(false);
  });

  it('ignores a request it does not know', () => {
    const { s } = host();
    const controller = new AbortController();
    s.abortControllers.set('r1', controller);
    expect(() => s.dispatchFromClient({ type: 'cancel_request', targetRequestId: 'nope' })).not.toThrow();
    expect(controller.signal.aborted).toBe(false);
  });

  it('a running request sees the abort', async () => {
    const { s } = host();
    let seen: AbortSignal | undefined;
    s.transport = { send: vi.fn() };
    s.processRequest = vi.fn(async (_m: unknown, signal: AbortSignal) => {
      seen = signal;
      await new Promise((resolve) => signal.addEventListener('abort', resolve));
      return { type: 'open_content_response' };
    });
    const running = s.handleRequest({ type: 'request', requestId: 'r7', request: { type: 'open_content' } });
    await until(() => !!seen);
    s.dispatchFromClient({ type: 'cancel_request', targetRequestId: 'r7' });
    await running;
    expect(seen!.aborted).toBe(true);
    expect(s.transport.send).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'r7', response: { type: 'open_content_response' } }));
  });
});

class TestTransport extends BaseTransport {
  sent: any[] = [];
  protected send(message: any): void {
    this.sent.push(message);
  }
  feed(message: any) {
    (this as any).fromHost.enqueue(message);
  }
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('visibility_changed', () => {
  it('the host sends it in the envelope the transport reads', async () => {
    const posted: any[] = [];
    postVisibility({ postMessage: (m: any) => { posted.push(m); return Promise.resolve(true); } } as any, false);
    expect(posted).toEqual([
      {
        type: 'from-extension',
        message: { type: 'request', channelId: '', requestId: expect.stringMatching(/^visibility-/), request: { type: 'visibility_changed', isVisible: false } },
      },
    ]);
  });

  it('a webview that has gone away just drops it', async () => {
    expect(() => postVisibility({ postMessage: () => Promise.reject(new Error('disposed')) } as any, true)).not.toThrow();
    await tick();
  });

  it('the webview follows it, and ignores @-mentions while hidden', async () => {
    const mentions = new EventEmitter<string>();
    const heard = vi.fn();
    mentions.add(heard);
    const t = new TestTransport(mentions, new EventEmitter());
    t.feed({ type: 'request', requestId: 'v1', request: { type: 'visibility_changed', isVisible: false } });
    await tick();
    expect(t.isVisible()).toBe(false);
    t.feed({ type: 'request', requestId: 'm1', request: { type: 'insert_at_mention', text: '@a.ts' } });
    await tick();
    expect(heard).not.toHaveBeenCalled();
    t.feed({ type: 'request', requestId: 'v2', request: { type: 'visibility_changed', isVisible: true } });
    t.feed({ type: 'request', requestId: 'm2', request: { type: 'insert_at_mention', text: '@b.ts' } });
    await tick();
    expect(heard).toHaveBeenCalledWith('@b.ts');
    // A push is not a request the webview answers.
    expect(t.sent).toEqual([]);
  });
});

describe('sdk_error', () => {
  it("reaches the channel's stream as an __llm_request_error__ event", async () => {
    const t = new TestTransport(new EventEmitter(), new EventEmitter());
    const stream = t.launchClaude('c1');
    t.feed({ type: 'sdk_error', channelId: 'c1', error: 'Rate limited', statusCode: '429', errorType: 'rate_limit_error' });
    const first = await stream[Symbol.asyncIterator]().next();
    expect(first.value).toEqual({ type: '__llm_request_error__', error: 'Rate limited', statusCode: '429', errorType: 'rate_limit_error' });
  });

  it('is dropped for a channel the webview does not have', async () => {
    const t = new TestTransport(new EventEmitter(), new EventEmitter());
    expect(() => t.feed({ type: 'sdk_error', channelId: 'nope', error: 'x' })).not.toThrow();
    await tick();
  });

  function session(busy: boolean) {
    const s = Object.create(Session.prototype);
    const showNotification = vi.fn();
    Object.assign(s, {
      busy: signal(busy),
      messages: signal<any[]>([]),
      context: { showNotification },
    });
    return { s, showNotification };
  }

  it('during a turn: an llm_error row in the transcript, and the turn ends', () => {
    const { s, showNotification } = session(true);
    s.processIncomingMessage({ type: '__llm_request_error__', error: 'Rate limited' });
    expect(s.busy()).toBe(false);
    expect(JSON.stringify(s.messages())).toContain('Rate limited');
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('outside a turn: a notification, and the transcript is left alone', () => {
    const { s, showNotification } = session(false);
    s.processIncomingMessage({ type: '__llm_request_error__', error: 'Endpoint down' });
    expect(showNotification).toHaveBeenCalledWith('Endpoint down', 'error');
    expect(s.messages()).toEqual([]);
  });
});
