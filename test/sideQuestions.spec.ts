import { describe, expect, it } from 'vitest';
import {
  cliHasBtw,
  withSideQuestionCommand,
  EMPTY_SIDE_STATE,
  MAX_THREAD,
  appendItem,
  itemFrom,
  openPanel,
  parseBtw,
  toHistory,
  type SideState,
} from '../src/webview/src/core/sideQuestions';
import {
  MAX_SIDE_HISTORY,
  parseSideQuestion,
  toSdkHistory,
  toSideQuestionResponse,
} from '../src/services/claude/sideQuestion';

describe('parseBtw (official tG0)', () => {
  it('takes /btw and its question', () => {
    expect(parseBtw('/btw what is a relay?')).toEqual({ question: 'what is a relay?' });
    expect(parseBtw('  /BTW  multi\nline  ')).toEqual({ question: 'multi\nline' });
    expect(parseBtw('/btw')).toEqual({ question: '' });
  });
  it('ignores anything else', () => {
    expect(parseBtw('/btwx')).toBeNull();
    expect(parseBtw('btw is it done')).toBeNull();
    expect(parseBtw('/help')).toBeNull();
  });
});

describe('the thread (official $55, KK1, e05)', () => {
  it('turns host answers into items', () => {
    expect(itemFrom('q', { type: 'side_question_response', response: 'A.' })).toEqual({ kind: 'answer', question: 'q', response: 'A.' });
    expect(itemFrom('q', { type: 'side_question_response', response: '  ' })).toEqual({ kind: 'no-answer', question: 'q' });
    expect(itemFrom('q', { type: 'side_question_response', response: null })).toEqual({ kind: 'no-answer', question: 'q' });
    expect(itemFrom('q', { type: 'side_question_response', response: 'Busy.', synthetic: true })).toEqual({ kind: 'synthetic', question: 'q', notice: 'Busy.' });
    expect(itemFrom('q', { type: 'side_question_response', error: 'boom' })).toEqual({ kind: 'error', question: 'q', message: 'boom' });
    expect(itemFrom('q', { type: 'side_question_response', response: 'A.', fallbackNotice: 'Fell back' }))
      .toEqual({ kind: 'answer', question: 'q', response: 'A.', fallbackNotice: 'Fell back' });
  });

  it('settles the pending question, but not on a cancellation', () => {
    const asking: SideState = { ...EMPTY_SIDE_STATE, pending: { question: 'q' } };
    expect(appendItem(asking, { kind: 'answer', question: 'q', response: 'A' }).pending).toBeNull();
    expect(appendItem(asking, { kind: 'cancelled', question: 'q' }).pending).toEqual({ question: 'q' });
    expect(appendItem(asking, { kind: 'answer', question: 'other', response: 'A' }).pending).toEqual({ question: 'q' });
  });

  it('keeps the last 20 exchanges', () => {
    let s: SideState = EMPTY_SIDE_STATE;
    for (let i = 0; i < 25; i++) s = appendItem(s, { kind: 'answer', question: `q${i}`, response: 'a' });
    expect(s.thread).toHaveLength(MAX_THREAD);
    expect(s.thread[0].item.question).toBe('q5');
  });

  it('sends back answered exchanges only', () => {
    let s: SideState = EMPTY_SIDE_STATE;
    s = appendItem(s, { kind: 'answer', question: 'a', response: 'A', fallbackNotice: 'n' });
    s = appendItem(s, { kind: 'error', question: 'b', message: 'x' });
    s = appendItem(s, { kind: 'no-answer', question: 'c' });
    expect(toHistory(s.thread)).toEqual([{ question: 'a', response: 'A', fallbackNotice: 'n' }]);
  });

  it('opening shows, unfolds and focuses', () => {
    expect(openPanel({ ...EMPTY_SIDE_STATE, minimized: true })).toMatchObject({ visible: true, minimized: false, focusRequested: true });
  });
});

describe('the host side: validation and shapes (B3)', () => {
  it('accepts a question with valid history', () => {
    expect(parseSideQuestion({ question: '  why? ', history: [{ question: 'a', response: 'b' }] }))
      .toEqual({ question: 'why?', history: [{ question: 'a', response: 'b' }] });
  });

  it('rejects empty, oversized and malformed input', () => {
    expect(parseSideQuestion({ question: '   ' })).toHaveProperty('error');
    expect(parseSideQuestion({ question: 42 })).toHaveProperty('error');
    expect(parseSideQuestion(null)).toHaveProperty('error');
    expect(parseSideQuestion({ question: 'x'.repeat(8001) })).toHaveProperty('error');
    expect(parseSideQuestion({ question: 'q', history: 'nope' })).toHaveProperty('error');
    expect(parseSideQuestion({ question: 'q', history: [{ question: 'a' }] })).toHaveProperty('error');
    expect(parseSideQuestion({ question: 'q', history: [{ question: 'a', response: 'b', fallbackNotice: 3 }] })).toHaveProperty('error');
    const tooLong = Array.from({ length: MAX_SIDE_HISTORY + 1 }, () => ({ question: 'a', response: 'b' }));
    expect(parseSideQuestion({ question: 'q', history: tooLong })).toHaveProperty('error');
  });

  it('maps history and answers the official way', () => {
    expect(toSdkHistory([{ question: 'a', response: 'b', fallbackNotice: 'n' }])).toEqual([{ question: 'a', response: 'b', fallback_notice: 'n' }]);
    expect(toSideQuestionResponse(null)).toEqual({ type: 'side_question_response', response: null, synthetic: false });
    expect(toSideQuestionResponse({ response: 'A', synthetic: false, refusalFallback: { content: 'Fell back' } }))
      .toEqual({ type: 'side_question_response', response: 'A', synthetic: false, fallbackNotice: 'Fell back' });
  });
});

describe('side_question through the dispatcher (host)', async () => {
  const { vi } = await import('vitest');
  const { ClaudeAgentService } = await import('../src/services/claude/ClaudeAgentService');
  const log = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() });
  const svc = (askSideQuestion?: any) => {
    const s = new (ClaudeAgentService as any)(log(), {}, {}, {}, {}, {}, {}, {}, {}, {});
    s.channels = new Map([['ch1', { query: askSideQuestion ? { askSideQuestion } : {} }]]);
    return s;
  };
  const ask = (s: any, request: unknown, signal = new AbortController().signal) =>
    s.processRequest({ type: 'request', requestId: 'r1', channelId: 'ch1', request }, signal);

  it('asks the channel query with the mapped history and answers the official shape', async () => {
    const sdk = vi.fn(async () => ({ response: 'The relay translates.', synthetic: false }));
    const out = await ask(svc(sdk), {
      type: 'side_question',
      question: 'what does the relay do?',
      history: [{ question: 'a', response: 'b', fallbackNotice: 'n' }],
    });
    expect(sdk).toHaveBeenCalledWith('what does the relay do?', expect.objectContaining({
      history: [{ question: 'a', response: 'b', fallback_notice: 'n' }],
    }));
    expect(out).toEqual({ type: 'side_question_response', response: 'The relay translates.', synthetic: false });
  });

  it('rejects a bad request before touching the CLI', async () => {
    const sdk = vi.fn();
    const out = await ask(svc(sdk), { type: 'side_question', question: '   ' });
    expect(sdk).not.toHaveBeenCalled();
    expect(out.error).toMatch(/needs some text/);
  });

  it('no channel, or an SDK without the method, is a shaped error', async () => {
    const s = svc(vi.fn());
    const out = await s.processRequest(
      { type: 'request', requestId: 'r1', channelId: 'nope', request: { type: 'side_question', question: 'q' } },
      new AbortController().signal
    );
    expect(out.error).toMatch(/Channel not found/);
    expect((await ask(svc(), { type: 'side_question', question: 'q' })).error).toMatch(/cannot answer side questions/);
  });

  it('a newer question supersedes the older one, and cancelling ends it', async () => {
    let calls = 0;
    const sdk = vi.fn((_q: string, { signal }: { signal: AbortSignal }) => {
      calls++;
      return new Promise((resolve) => {
        if (calls === 2) resolve({ response: 'second', synthetic: false });
        signal.addEventListener('abort', () => {});
      });
    });
    const s = svc(sdk);
    const first = ask(s, { type: 'side_question', question: 'one' });
    const second = ask(s, { type: 'side_question', question: 'two' });
    expect((await first).error).toMatch(/superseded/);
    expect((await second).response).toBe('second');

    const cancel = new AbortController();
    const third = ask(svc(vi.fn(() => new Promise(() => {}))), { type: 'side_question', question: 'three' }, cancel.signal);
    cancel.abort();
    expect((await third).error).toMatch(/cancelled/);
  });
});

describe('the /btw row (official slash-command-btw)', () => {
  it('is added to the CLI list, and stands alone before the list arrives', () => {
    const cli = [{ name: 'compact', description: 'Compact', argumentHint: '' }];
    expect(withSideQuestionCommand(cli).map((c) => c.name)).toEqual(['compact', 'btw']);
    expect(withSideQuestionCommand(undefined)).toEqual([
      { name: 'btw', description: 'Ask a quick side question without interrupting the main conversation', argumentHint: '[question]' },
    ]);
  });
  it('gives way to a CLI that has its own /btw', () => {
    const cli = [{ name: 'btw', description: 'CLI side question', argumentHint: '<q>' }];
    expect(cliHasBtw(cli)).toBe(true);
    expect(withSideQuestionCommand(cli)).toEqual(cli);
  });
});
