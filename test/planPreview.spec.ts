/**
 * Step 17: the plan labels on the permission prompt, what each plan answer
 * sends, the official `set_permission_mode`, and the plan preview panel
 * (`open_markdown_preview`, `plan_comment`, `get_plan_comments`,
 * `remove_plan_comment`, `close_plan_preview`).
 */
import { describe, expect, it, vi } from 'vitest';
import { signal } from 'alien-signals';
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import {
  DEFAULT_PLAN_TITLE as HOST_DEFAULT_TITLE,
  PLAN_PREVIEW_VIEW_TYPE,
  PlanPreviewPanel,
  commentFromPageMessage,
  renderPlanHtml,
  type PlanPreviewHostPanel,
} from '../src/services/claude/planPreview';
import { isPermissionMode } from '../src/services/claude/permissionMode';
import { ClaudeAgentService } from '../src/services/claude/ClaudeAgentService';
import {
  DEFAULT_PLAN_TITLE,
  KEEP_PLANNING_MESSAGE,
  REJECT_MESSAGE,
  REJECT_WITH_REASON_PREFIX,
  commentsAsFeedback,
  inputsWithPlanComments,
  openPlanPreviewFor,
  planTitle,
  promptLabels,
  rejectAnswer,
} from '../src/webview/src/core/planPreview';
import { RETURN_TO_DEFAULT_MODE, optionTwoUpdates } from '../src/webview/src/core/permissionPrompt';
import { ALLOWED_ATTRS, ALLOWED_TAGS, isAllowedAttribute, isAllowedTag } from '../src/webview/src/core/planPreviewPage';
import { BaseTransport } from '../src/webview/src/transport/BaseTransport';
import { EventEmitter } from '../src/webview/src/utils/events';
import { Session } from '../src/webview/src/core/Session';

const comment = (id: string, selectedText = 'Cache the merged result', text = 'Invalidate on profile switch') => ({
  id,
  selectedText,
  sectionHeading: 'Steps',
  comment: text,
});

// ================================================================== host ===

describe('host: the preview panel (yS)', () => {
  function fakePanel() {
    const posted: unknown[] = [];
    let onMessage: (m: unknown) => void = () => {};
    const disposeListeners: (() => void)[] = [];
    const panel: PlanPreviewHostPanel & { disposed: boolean } = {
      title: 'x',
      disposed: false,
      webview: {
        postMessage: (m) => (posted.push(m), true),
        onDidReceiveMessage: (l) => ((onMessage = l), { dispose() {} }),
      },
      onDidDispose: (l) => (disposeListeners.push(l), { dispose: vi.fn() }),
      dispose() {
        this.disposed = true;
        disposeListeners.forEach((l) => l());
      },
    };
    return { panel, posted, send: (m: unknown) => onMessage(m) };
  }

  it('renders markdown with marked, as the official Yh0', () => {
    expect(renderPlanHtml('# Plan\n\n- one\n\n`x`')).toBe('<h1>Plan</h1>\n<ul>\n<li>one</li>\n</ul>\n<p><code>x</code></p>\n');
  });

  it('sends the content and the comments switch once the page is ready', () => {
    const { panel, posted, send } = fakePanel();
    PlanPreviewPanel.create(panel, '# Plan', true, () => {});
    expect(posted).toEqual([]);
    send({ type: 'ready' });
    expect(posted).toEqual([
      { type: 'updateContent', html: '<h1>Plan</h1>\n' },
      { type: 'setCommentsEnabled', enabled: true },
    ]);
    const off = fakePanel();
    PlanPreviewPanel.create(off.panel, 'x', false, () => {});
    off.send({ type: 'ready' });
    expect(off.posted[1]).toEqual({ type: 'setCommentsEnabled', enabled: false });
  });

  it("passes on the page's comments, and only well-formed ones", () => {
    const { panel, send } = fakePanel();
    const onComment = vi.fn();
    PlanPreviewPanel.create(panel, 'x', true, onComment);
    send({ type: 'comment', id: 'c1', selectedText: 'a', comment: 'b' });
    expect(onComment).toHaveBeenCalledWith({ id: 'c1', selectedText: 'a', sectionHeading: '', comment: 'b' });
    for (const bad of [
      { type: 'comment', selectedText: 'a', comment: 'b' },
      { type: 'comment', id: 'c', comment: 'b' },
      { type: 'comment', id: 'c', selectedText: 'a' },
      { type: 'comment', id: 'c', selectedText: 'a', comment: '' },
      { type: 'comment', id: 3, selectedText: 'a', comment: 'b' },
      { type: 'comment', id: 'c', selectedText: {}, comment: 'b' },
      { type: 'other', id: 'c', selectedText: 'a', comment: 'b' },
      null,
      'comment',
    ]) {
      send(bad);
    }
    expect(onComment).toHaveBeenCalledTimes(1);
    expect(commentFromPageMessage({ type: 'comment', id: 'c', selectedText: 'a', comment: 'b', sectionHeading: 7 })?.sectionHeading).toBe('');
  });

  it('title, content, comment removal, detach and dispose', () => {
    const { panel, posted, send } = fakePanel();
    const onComment = vi.fn();
    const preview = PlanPreviewPanel.create(panel, 'x', true, onComment);
    preview.setTitle('New');
    expect(panel.title).toBe('New');
    preview.removeComment('c9');
    expect(posted.at(-1)).toEqual({ type: 'removeComment', commentId: 'c9' });
    const listener = vi.fn();
    preview.onDidDispose(listener);
    preview.detach();
    expect(posted.at(-1)).toEqual({ type: 'setCommentsEnabled', enabled: false });
    send({ type: 'comment', id: 'c1', selectedText: 'a', comment: 'b' });
    expect(onComment).not.toHaveBeenCalled();
    send({ type: 'ready' });
    expect(posted.at(-1)).toEqual({ type: 'setCommentsEnabled', enabled: false });
    preview.dispose();
    expect(panel.disposed).toBe(true);
  });
});

describe('host: set_permission_mode (the official setPermissionMode)', () => {
  function makeService(allowBypass = false, fail = false) {
    const query = { setPermissionMode: vi.fn(async () => { if (fail) throw new Error('cli said no'); }) };
    const sdkService = { getAllowDangerouslySkipPermissions: () => allowBypass };
    const log = { info: () => {}, warn: vi.fn(), error: vi.fn(), trace: vi.fn() };
    const svc = new (ClaudeAgentService as any)(log, {}, {}, {}, {}, {}, {}, sdkService, {}, {});
    svc.channels.set('ch1', { query });
    const dispatch = (request: any, channelId = 'ch1') =>
      svc.processRequest({ type: 'request', requestId: 'r', channelId, request }, new AbortController().signal);
    return { query, dispatch, log };
  }

  it('the six SDK modes, and nothing else (ou$)', () => {
    for (const ok of ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto']) expect(isPermissionMode(ok)).toBe(true);
    for (const bad of ['Plan', 'delegate', '', 'toString', 'constructor', null, undefined, 1, {}]) expect(isPermissionMode(bad)).toBe(false);
  });

  it('sets the mode and answers success', async () => {
    const { query, dispatch } = makeService();
    await expect(dispatch({ type: 'set_permission_mode', mode: 'acceptEdits', userInitiated: false })).resolves.toEqual({
      type: 'set_permission_mode_response',
      success: true,
    });
    expect(query.setPermissionMode).toHaveBeenCalledWith('acceptEdits');
  });

  it('an unknown mode is refused in-band, before the channel is even looked up', async () => {
    const { query, dispatch, log } = makeService();
    for (const mode of ['yolo', '', 3, undefined]) {
      await expect(dispatch({ type: 'set_permission_mode', mode }, 'missing')).resolves.toEqual({
        type: 'set_permission_mode_response',
        success: false,
      });
    }
    expect(query.setPermissionMode).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('mode is not a recognized mode'));
  });

  it('bypassPermissions needs allowDangerouslySkipPermissions', async () => {
    const barred = makeService(false);
    await expect(barred.dispatch({ type: 'set_permission_mode', mode: 'bypassPermissions' })).resolves.toMatchObject({ success: false });
    expect(barred.query.setPermissionMode).not.toHaveBeenCalled();
    const allowed = makeService(true);
    await expect(allowed.dispatch({ type: 'set_permission_mode', mode: 'bypassPermissions' })).resolves.toMatchObject({ success: true });
  });

  it('a CLI failure is success: false; a missing channel is an error', async () => {
    const failing = makeService(false, true);
    await expect(failing.dispatch({ type: 'set_permission_mode', mode: 'plan' })).resolves.toMatchObject({ success: false });
    const { dispatch } = makeService();
    await expect(dispatch({ type: 'set_permission_mode', mode: 'plan' }, 'gone')).rejects.toThrow('Channel not found: gone');
  });
});

describe('host: the plan preview requests', () => {
  function makeService() {
    const created: { panel: any; args: any[]; posted: unknown[]; send: (m: unknown) => void }[] = [];
    const webViewService = {
      createPagePanel: vi.fn((...args: any[]) => {
        const posted: unknown[] = [];
        let onMessage: (m: unknown) => void = () => {};
        const disposeListeners: (() => void)[] = [];
        const panel = {
          title: args[1],
          webview: { postMessage: (m: unknown) => (posted.push(m), true), onDidReceiveMessage: (l: any) => ((onMessage = l), { dispose() {} }) },
          onDidDispose: (l: () => void) => (disposeListeners.push(l), { dispose() {} }),
          dispose: vi.fn(() => disposeListeners.forEach((l) => l())),
        };
        created.push({ panel, args, posted, send: (m) => onMessage(m) });
        return panel;
      }),
      planPreviewColumn: vi.fn(() => 2),
    };
    const sent: unknown[] = [];
    const log = { info: () => {}, warn: () => {}, error: () => {}, trace: () => {} };
    const svc = new (ClaudeAgentService as any)(log, {}, {}, {}, {}, {}, {}, {}, {}, webViewService);
    svc.transport = { send: (m: unknown) => sent.push(m) };
    const dispatch = (request: any, webviewId = 'editor:chat:1') =>
      svc.processRequest({ type: 'request', requestId: 'r', channelId: '', request, webviewId }, new AbortController().signal);
    return { svc, dispatch, created, sent, webViewService };
  }
  const open = { type: 'open_markdown_preview', channelId: 'ch1', content: '# Plan', title: 'Plan', enableComments: true };

  it('opens a claudePlanPreview panel showing the plan page, beside the chat', async () => {
    const { dispatch, created, webViewService } = makeService();
    await expect(dispatch(open)).resolves.toEqual({ type: 'open_markdown_preview_response' });
    expect(created[0].args).toEqual([PLAN_PREVIEW_VIEW_TYPE, 'Plan', 'plan-preview', 2]);
    expect(PLAN_PREVIEW_VIEW_TYPE).toBe('claudePlanPreview');
    expect(webViewService.planPreviewColumn).toHaveBeenCalledWith('editor:chat:1');
    await dispatch({ ...open, title: undefined });
    await dispatch({ ...open, channelId: 'ch2', title: '' });
    expect(created[1].args[1]).toBe(HOST_DEFAULT_TITLE);
  });

  it("a comment made in the page is kept and pushed to the webview as plan_comment", async () => {
    const { dispatch, created, sent } = makeService();
    await dispatch(open);
    created[0].send({ type: 'comment', id: 'c1', selectedText: 'Cache', sectionHeading: 'Steps', comment: 'why?' });
    expect(sent).toEqual([{ type: 'plan_comment', channelId: 'ch1', comment: { id: 'c1', selectedText: 'Cache', sectionHeading: 'Steps', comment: 'why?' } }]);
    await expect(dispatch({ type: 'get_plan_comments', channelId: 'ch1' })).resolves.toEqual({
      type: 'get_plan_comments_response',
      comments: [{ id: 'c1', selectedText: 'Cache', sectionHeading: 'Steps', comment: 'why?' }],
    });
    await expect(dispatch({ type: 'get_plan_comments', channelId: 'other' })).resolves.toEqual({ type: 'get_plan_comments_response', comments: [] });
  });

  it('a second plan reuses the panel: new title and content, comments reset', async () => {
    const { dispatch, created } = makeService();
    await dispatch(open);
    created[0].send({ type: 'comment', id: 'c1', selectedText: 'a', comment: 'b' });
    await dispatch({ ...open, content: '# Plan 2', title: 'Plan 2', enableComments: false });
    expect(created).toHaveLength(1);
    expect(created[0].panel.title).toBe('Plan 2');
    expect(created[0].posted).toEqual([
      { type: 'updateContent', html: '<h1>Plan 2</h1>\n' },
      { type: 'setCommentsEnabled', enabled: false },
    ]);
    await expect(dispatch({ type: 'get_plan_comments', channelId: 'ch1' })).resolves.toMatchObject({ comments: [] });
  });

  it('remove_plan_comment forgets it and unmarks it in the page; close_plan_preview disposes the panel', async () => {
    const { dispatch, created } = makeService();
    await dispatch(open);
    created[0].send({ type: 'comment', id: 'c1', selectedText: 'a', comment: 'b' });
    created[0].send({ type: 'comment', id: 'c2', selectedText: 'c', comment: 'd' });
    await expect(dispatch({ type: 'remove_plan_comment', channelId: 'ch1', commentId: 'c1' })).resolves.toEqual({ type: 'remove_plan_comment_response' });
    expect(created[0].posted.at(-1)).toEqual({ type: 'removeComment', commentId: 'c1' });
    await expect(dispatch({ type: 'get_plan_comments', channelId: 'ch1' })).resolves.toMatchObject({ comments: [{ id: 'c2' }] });
    await expect(dispatch({ type: 'close_plan_preview', channelId: 'ch1' })).resolves.toEqual({ type: 'close_plan_preview_response' });
    expect(created[0].panel.dispose).toHaveBeenCalled();
    // Closed: the next plan opens a new panel.
    await dispatch(open);
    expect(created).toHaveLength(2);
  });

  it('after shutdown panels are detached, and no new preview opens', async () => {
    const { svc, dispatch, created } = makeService();
    await dispatch(open);
    await svc.shutdown();
    expect(created[0].posted.at(-1)).toEqual({ type: 'setCommentsEnabled', enabled: false });
    await dispatch({ ...open, channelId: 'ch3' });
    expect(created).toHaveLength(1);
  });

  it('a malformed open is refused before anything is created', async () => {
    const { dispatch, created } = makeService();
    for (const bad of [
      { ...open, content: 42 },
      { ...open, channelId: undefined },
      { ...open, title: {} },
    ]) {
      await expect(dispatch(bad)).rejects.toThrow('open_markdown_preview: malformed request');
    }
    expect(created).toHaveLength(0);
  });
});

// =============================================================== webview ===

describe('webview: the plan title (jW0) and when the preview opens (MW0)', () => {
  it("the plan's opening # heading, or the default", () => {
    expect(planTitle('# Refactor loader\n\nbody')).toBe('Refactor loader');
    expect(planTitle('\n\n#   Spaced out   #\n')).toBe('Spaced out');
    expect(planTitle('## Not an H1')).toBeUndefined();
    expect(planTitle('Intro\n# Late heading')).toBeUndefined();
    expect(planTitle('# ###')).toBeUndefined();
    expect(planTitle('# ' + 'x'.repeat(201))).toBeUndefined();
    expect(planTitle('')).toBeUndefined();
    expect(DEFAULT_PLAN_TITLE).toBe('Forge’s Plan');
  });

  function request(toolName: string, inputs: Record<string, unknown>) {
    const listeners: ((r: { behavior: string }) => void)[] = [];
    return { toolName, inputs, onResolved: (l: any) => listeners.push(l), resolve: (behavior: string) => listeners.forEach((l) => l({ behavior })) };
  }

  it('an ExitPlanMode prompt opens the plan with comments on, and accepting it closes the preview', () => {
    const session = { openMarkdownPreview: vi.fn(), closePlanPreview: vi.fn() };
    const r = request('ExitPlanMode', { plan: '# Ship it\n\n- a' });
    openPlanPreviewFor(r, session);
    expect(session.openMarkdownPreview).toHaveBeenCalledWith('# Ship it\n\n- a', 'Ship it', true);
    r.resolve('allow');
    expect(session.closePlanPreview).toHaveBeenCalled();
  });

  it('a rejected plan leaves the preview open; no plan text, no preview; other tools do nothing', () => {
    const session = { openMarkdownPreview: vi.fn(), closePlanPreview: vi.fn() };
    const rejected = request('ExitPlanMode', { plan: 'no heading' });
    openPlanPreviewFor(rejected, session);
    expect(session.openMarkdownPreview).toHaveBeenCalledWith('no heading', DEFAULT_PLAN_TITLE, true);
    rejected.resolve('deny');
    expect(session.closePlanPreview).not.toHaveBeenCalled();
    openPlanPreviewFor(request('ExitPlanMode', {}), session);
    openPlanPreviewFor(request('Bash', { plan: '# x' }), session);
    expect(session.openMarkdownPreview).toHaveBeenCalledTimes(1);
  });
});

describe("webview: the prompt's labels and answers for a plan (EU0)", () => {
  it('labels come from the request, not the session mode', () => {
    expect(promptLabels('ExitPlanMode', false)).toEqual({
      approve: 'Yes, and auto-accept',
      approveAlways: 'Yes, and manually approve edits',
      reject: 'No, keep planning',
    });
    expect(promptLabels('ExitPlanMode', true).reject).toBe('Send feedback and keep planning');
    expect(promptLabels('Bash', false)).toEqual({ approve: 'Yes', approveAlways: null, reject: 'No' });
    expect(promptLabels('Bash', true).reject).toBe('No');
  });

  it('"Yes, and manually approve edits" answers with a return to default for the session (MU0)', () => {
    const suggested: PermissionUpdate[] = [{ type: 'addRules', rules: [{ toolName: 'Read' }], behavior: 'allow', destination: 'localSettings' }];
    expect(optionTwoUpdates(suggested, 'userSettings', true)).toEqual([RETURN_TO_DEFAULT_MODE]);
    expect(RETURN_TO_DEFAULT_MODE).toEqual({ type: 'setMode', mode: 'default', destination: 'session' });
  });

  it('reject messages: the official AS, _61 and wM texts', () => {
    expect(rejectAnswer('', false, [])).toEqual({ message: REJECT_MESSAGE, interrupt: true });
    expect(rejectAnswer('  ', true, [])).toEqual({ message: KEEP_PLANNING_MESSAGE, interrupt: true });
    expect(KEEP_PLANNING_MESSAGE).toBe('User chose to stay in plan mode and continue planning');
    // The official adds a space after a prefix that already ends in one.
    expect(rejectAnswer(' use pnpm ', false, [])).toEqual({ message: `${REJECT_WITH_REASON_PREFIX} use pnpm`, interrupt: false });
    expect(rejectAnswer('use pnpm', false, []).message).toContain('rejection:  use pnpm');
    expect(rejectAnswer('shorter', true, []).message).toBe(`${REJECT_WITH_REASON_PREFIX} shorter`);
  });

  it('plan comments become feedback, and a plan with comments never interrupts', () => {
    const comments = [comment('c1'), comment('c2', 'Add a readLayer helper', 'Name it readSettingsLayer')];
    expect(commentsAsFeedback(comments)).toBe(
      '[Re: "Cache the merged result"] Invalidate on profile switch\n[Re: "Add a readLayer helper"] Name it readSettingsLayer'
    );
    expect(rejectAnswer('', true, comments)).toEqual({
      message: `${KEEP_PLANNING_MESSAGE}\n\nComments on the plan:\n${commentsAsFeedback(comments)}`,
      interrupt: false,
    });
    expect(rejectAnswer('also add tests', true, comments).message).toBe(
      `${REJECT_WITH_REASON_PREFIX} also add tests\n\nComments on the plan:\n${commentsAsFeedback(comments)}`
    );
    // Not a plan: comments are ignored.
    expect(rejectAnswer('', false, comments)).toEqual({ message: REJECT_MESSAGE, interrupt: true });
    expect(inputsWithPlanComments({ plan: 'p' }, comments)).toEqual({ plan: 'p', userFeedback: commentsAsFeedback(comments), userComments: comments });
    expect(inputsWithPlanComments({ plan: 'p' }, [])).toEqual({ plan: 'p' });
  });
});

describe("webview: the preview page's sanitiser allowlist", () => {
  it('keeps what markdown produces, drops the rest', () => {
    for (const tag of ['h1', 'p', 'ul', 'li', 'code', 'pre', 'table', 'a', 'img', 'mark', 'blockquote', 'DIV']) expect(isAllowedTag(tag)).toBe(true);
    for (const tag of ['script', 'style', 'iframe', 'object', 'form', 'svg', 'link', 'meta']) expect(isAllowedTag(tag)).toBe(false);
    // The official lists: 10 block + 6 list + 11 inline + 6 code + 10 table + 3 figure + 5 generic.
    expect(ALLOWED_TAGS.size).toBe(51);
    expect(ALLOWED_ATTRS.size).toBe(20);
  });

  it('no handlers, no styles, no javascript: links', () => {
    expect(isAllowedAttribute('href', 'https://x')).toBe(true);
    expect(isAllowedAttribute('class', 'language-ts')).toBe(true);
    expect(isAllowedAttribute('onerror', 'x')).toBe(false);
    expect(isAllowedAttribute('onclick', 'x')).toBe(false);
    expect(isAllowedAttribute('style', 'color:red')).toBe(false);
    expect(isAllowedAttribute('href', ' javascript:alert(1)')).toBe(false);
    expect(isAllowedAttribute('src', 'JavaScript:alert(1)')).toBe(false);
    expect(isAllowedAttribute('HREF', 'https://x')).toBe(true);
  });
});

describe('webview: transport and session', () => {
  class TestTransport extends BaseTransport {
    sent: any[] = [];
    protected send(message: any): void {
      this.sent.push(message);
    }
    feed(message: any) {
      this.fromHost.enqueue(message);
    }
  }

  it('a pending permission prompt does not hold up other messages (the official loop does not await it)', async () => {
    const t = new TestTransport(new EventEmitter(), new EventEmitter());
    // A plan prompt nobody has answered yet...
    t.feed({ type: 'request', requestId: 'p1', channelId: 'ch', request: { type: 'tool_permission_request', toolName: 'ExitPlanMode', inputs: {}, suggestions: [] } });
    await new Promise((r) => setTimeout(r, 0));
    expect(t.permissionRequests()).toHaveLength(1);
    // ...while "Yes, and auto-accept" waits for its set_permission_mode reply.
    const reply = t.setPermissionMode('ch', 'acceptEdits', false);
    const requestId = t.sent.at(-1).requestId;
    t.feed({ type: 'response', requestId, response: { type: 'set_permission_mode_response', success: true } });
    t.feed({ type: 'plan_comment', channelId: 'ch', comment: comment('c1') });
    await expect(reply).resolves.toBe(true);
    expect(t.planCommentsByChannel().get('ch')).toHaveLength(1);
    t.permissionRequests()[0].accept({});
    await new Promise((r) => setTimeout(r, 0));
    expect(t.sent.at(-1)).toMatchObject({ type: 'response', requestId: 'p1', response: { type: 'tool_permission_response' } });
  });

  it('the official payloads: open, remove, close, set_permission_mode with userInitiated', () => {
    const t = new TestTransport(new EventEmitter(), new EventEmitter());
    void t.openMarkdownPreview('ch', '# p', 'p', true);
    void t.removePlanComment('ch', 'c1');
    void t.closePlanPreview('ch');
    void t.setPermissionMode('ch', 'acceptEdits', false);
    expect(t.sent.map((m) => [m.channelId, m.request])).toEqual([
      [undefined, { type: 'open_markdown_preview', channelId: 'ch', content: '# p', title: 'p', enableComments: true }],
      [undefined, { type: 'remove_plan_comment', channelId: 'ch', commentId: 'c1' }],
      [undefined, { type: 'close_plan_preview', channelId: 'ch' }],
      ['ch', { type: 'set_permission_mode', mode: 'acceptEdits', userInitiated: false }],
    ]);
  });

  it('plan_comment appends to the channel; remove drops it at once; opening without comments clears them', async () => {
    const t = new TestTransport(new EventEmitter(), new EventEmitter());
    t.feed({ type: 'plan_comment', channelId: 'ch', comment: comment('c1') });
    t.feed({ type: 'plan_comment', channelId: 'ch', comment: comment('c2') });
    await new Promise((r) => setTimeout(r, 0));
    expect(t.planCommentsByChannel().get('ch')?.map((c) => c.id)).toEqual(['c1', 'c2']);
    void t.removePlanComment('ch', 'c1');
    expect(t.planCommentsByChannel().get('ch')?.map((c) => c.id)).toEqual(['c2']);
    void t.openMarkdownPreview('ch', 'x', 'x', true);
    expect(t.planCommentsByChannel().get('ch')).toHaveLength(1);
    void t.openMarkdownPreview('ch', 'x', 'x', false);
    expect(t.planCommentsByChannel().get('ch')).toEqual([]);
  });

  function makeSession() {
    const calls: any[] = [];
    const connection = {
      setPermissionMode: vi.fn(async (...args: any[]) => (calls.push(args), true)),
      planCommentsByChannel: signal(new Map([['ch1', [comment('c1')]]])),
      openMarkdownPreview: vi.fn(async () => {}),
      closePlanPreview: vi.fn(async () => {}),
      removePlanComment: vi.fn(async () => {}),
      config: () => undefined,
      claudeConfig: () => undefined,
    };
    const session = new Session(async () => connection as never, {
      currentSelection: signal(undefined),
      commandRegistry: { registerAction: () => {} },
      fileOpener: { open: () => {}, openContent: async () => undefined },
    });
    (session as any).claudeChannelId('ch1');
    return { session, connection, calls };
  }

  it('a user pick is userInitiated; a prompt answer is not; leaving dontAsk never is', async () => {
    const { session, calls } = makeSession();
    await session.getConnection();
    await session.setPermissionMode('plan');
    await session.setPermissionMode('acceptEdits', true, false);
    session.permissionMode('dontAsk');
    await session.setPermissionMode('default');
    expect(calls).toEqual([
      ['ch1', 'plan', true],
      ['ch1', 'acceptEdits', false],
      ['ch1', 'default', false],
    ]);
  });

  it('a permission listener added before the connection exists still fires (MW0 depends on it)', async () => {
    const permissionRequested = new EventEmitter<any>();
    const connection = { permissionRequested, config: () => undefined, claudeConfig: () => undefined };
    const session = new Session(async () => connection as never, {
      currentSelection: signal(undefined),
      commandRegistry: { registerAction: () => {} },
      fileOpener: { open: () => {}, openContent: async () => undefined },
    });
    (session as any).claudeChannelId('ch1');
    const seen: string[] = [];
    const stop = session.onPermissionRequested((r) => seen.push(r.toolName));
    await session.getConnection();
    permissionRequested.emit({ channelId: 'ch1', toolName: 'ExitPlanMode' });
    permissionRequested.emit({ channelId: 'other', toolName: 'Bash' });
    stop();
    permissionRequested.emit({ channelId: 'ch1', toolName: 'Write' });
    expect(seen).toEqual(['ExitPlanMode']);
  });

  it("the session's plan comments, preview and comment removal go to its own channel", async () => {
    const { session, connection } = makeSession();
    await session.getConnection();
    expect(session.planComments().map((c) => c.id)).toEqual(['c1']);
    session.openMarkdownPreview('# p', 'p', true);
    session.closePlanPreview();
    session.removePlanComment('c1');
    expect(connection.openMarkdownPreview).toHaveBeenCalledWith('ch1', '# p', 'p', true);
    expect(connection.closePlanPreview).toHaveBeenCalledWith('ch1');
    expect(connection.removePlanComment).toHaveBeenCalledWith('ch1', 'c1');
  });
});
