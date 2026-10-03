/**
 * Export a conversation as JSON, and import it so the model can carry on
 * (asked for on 2026-10-03).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  buildExport,
  exportFileName,
  parseImport,
  parseTranscript,
  rekeyTranscript,
  toJsonl,
  transcriptTitle,
} from '../src/services/claude/chatExport';
import { handleExportConversation, handleImportConversation } from '../src/services/claude/handlers/handlers';
import { ClaudeSessionService, getProjectHistoryDir } from '../src/services/claude/ClaudeSessionService';

const SID = '11111111-1111-4111-8111-111111111111';
const U1 = '22222222-2222-4222-8222-222222222222';
const U2 = '33333333-3333-4333-8333-333333333333';
const ROWS = [
  { type: 'user', uuid: U1, parentUuid: null, sessionId: SID, cwd: '/old', message: { role: 'user', content: 'Fix the parser bug' } },
  { type: 'assistant', uuid: U2, parentUuid: U1, sessionId: SID, cwd: '/old', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } },
];

describe('the export format', () => {
  it('wraps the transcript rows as they are, with a title', () => {
    const doc = buildExport(SID, ROWS, '/old', new Date('2026-10-03T00:00:00Z'));
    expect(doc).toMatchObject({ format: 'forge-chat', version: 1, sessionId: SID, title: 'Fix the parser bug', transcript: ROWS });
    expect(parseImport(JSON.stringify(doc)).transcript).toEqual(ROWS);
  });

  it('prefers a custom title and skips torn lines', () => {
    const text = toJsonl(ROWS) + JSON.stringify({ type: 'custom-title', customTitle: 'Parser', sessionId: SID }) + '\n{"torn';
    const rows = parseTranscript(text);
    expect(rows).toHaveLength(3);
    expect(transcriptTitle(rows)).toBe('Parser');
  });

  it('names the file after the title, safely', () => {
    expect(exportFileName('Fix: the/parser?', SID)).toBe('Fix the parser.forge-chat.json');
    expect(exportFileName(undefined, SID)).toBe('conversation-11111111.forge-chat.json');
  });

  it('rejects anything that is not a Forge export', () => {
    expect(() => parseImport('nope')).toThrow(/not JSON/);
    expect(() => parseImport('{"format":"other"}')).toThrow(/not a Forge chat export/);
    expect(() => parseImport(JSON.stringify({ format: 'forge-chat', version: 99, transcript: ROWS }))).toThrow(/version/);
    expect(() => parseImport(JSON.stringify({ format: 'forge-chat', version: 1, transcript: [] }))).toThrow(/no messages/);
    expect(() => parseImport(JSON.stringify({ format: 'forge-chat', version: 1, transcript: [1] }))).toThrow(/malformed/);
  });
});

describe('re-keying an import for this workspace', () => {
  it('gives every row the new session id, new uuids with links kept, and this cwd', () => {
    let n = 0;
    const doc = buildExport(SID, ROWS, '/old');
    const rows = rekeyTranscript(doc, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '/new', () => `bbbbbbbb-bbbb-4bbb-8bbb-00000000000${n++}`);
    expect(rows[0]).toMatchObject({ sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', cwd: '/new', uuid: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000000', parentUuid: null });
    expect(rows[1]).toMatchObject({ uuid: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', parentUuid: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000000' });
    expect(rows[2]).toEqual({ type: 'custom-title', customTitle: 'Fix the parser bug (imported)', sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    // The export is not changed.
    expect(doc.transcript[0]).toMatchObject({ sessionId: SID, uuid: U1 });
  });
});

describe('the handlers', () => {
  let home: string;
  let work: string;
  const saved = { save: (vscode.window as any).showSaveDialog, open: (vscode.window as any).showOpenDialog, info: (vscode.window as any).showInformationMessage };
  const context = () => ({
    workspaceService: { getDefaultWorkspaceFolder: () => ({ uri: { fsPath: work } }) },
    logService: { info: () => {}, warn: () => {} },
  }) as any;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-claude-'));
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-work-'));
    process.env.CLAUDE_CONFIG_DIR = home;
    (vscode.window as any).showInformationMessage = vi.fn(async () => undefined);
  });
  afterEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR;
    (vscode.window as any).showSaveDialog = saved.save;
    (vscode.window as any).showOpenDialog = saved.open;
    (vscode.window as any).showInformationMessage = saved.info;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('exports a transcript to the file the user picks, and imports it back as a resumable session', async () => {
    const dir = getProjectHistoryDir(work);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${SID}.jsonl`), toJsonl(ROWS));
    const target = path.join(work, 'out.json');
    (vscode.window as any).showSaveDialog = vi.fn(async () => ({ fsPath: target }));

    const exported = await handleExportConversation({ type: 'export_conversation', sessionId: SID }, context());
    expect(exported).toEqual({ type: 'export_conversation_response', saved: true, path: target });
    expect(JSON.parse(fs.readFileSync(target, 'utf8')).transcript).toEqual(ROWS);

    (vscode.window as any).showOpenDialog = vi.fn(async () => [{ fsPath: target }]);
    const imported = await handleImportConversation({ type: 'import_conversation' }, context());
    expect(imported.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(imported.sessionId).not.toBe(SID);
    const rows = parseTranscript(fs.readFileSync(path.join(dir, `${imported.sessionId}.jsonl`), 'utf8'));
    expect(rows.filter((r) => r.type === 'user' || r.type === 'assistant').every((r) => r.sessionId === imported.sessionId && r.cwd === work)).toBe(true);
    expect(imported.title).toBe('Fix the parser bug (imported)');
  });

  it('an imported chat loads with every message, in order, as the chat view shows it', async () => {
    // A longer conversation, with timestamps and a tool call, as the CLI writes it.
    const t = (s: number) => new Date(Date.UTC(2026, 9, 3, 12, 0, s)).toISOString();
    const ids = Array.from({ length: 6 }, (_, i) => `44444444-4444-4444-8444-44444444444${i}`);
    const rows = [
      { type: 'user', uuid: ids[0], parentUuid: null, timestamp: t(0), sessionId: SID, cwd: '/old', message: { role: 'user', content: 'List the files' } },
      { type: 'assistant', uuid: ids[1], parentUuid: ids[0], timestamp: t(1), sessionId: SID, cwd: '/old', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }] } },
      { type: 'user', uuid: ids[2], parentUuid: ids[1], timestamp: t(2), sessionId: SID, cwd: '/old', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'a.py\nb.py' }] } },
      { type: 'assistant', uuid: ids[3], parentUuid: ids[2], timestamp: t(3), sessionId: SID, cwd: '/old', message: { id: 'msg_2', role: 'assistant', content: [{ type: 'text', text: 'Two files: a.py and b.py.' }] } },
      { type: 'user', uuid: ids[4], parentUuid: ids[3], timestamp: t(4), sessionId: SID, cwd: '/old', message: { role: 'user', content: 'Thanks' } },
      { type: 'assistant', uuid: ids[5], parentUuid: ids[4], timestamp: t(5), sessionId: SID, cwd: '/old', message: { id: 'msg_3', role: 'assistant', content: [{ type: 'text', text: 'You are welcome.' }] } },
    ];
    const file = path.join(work, 'chat.json');
    fs.writeFileSync(file, JSON.stringify(buildExport(SID, rows, '/old')));
    (vscode.window as any).showOpenDialog = vi.fn(async () => [{ fsPath: file }]);
    const { sessionId } = await handleImportConversation({ type: 'import_conversation' }, context());

    const sessions = new ClaudeSessionService({ info: () => {}, warn: () => {}, error: () => {} } as any);
    const loaded = await sessions.getSession(sessionId!, work);
    expect(loaded).toHaveLength(6);
    const text = (m: any) => typeof m.message.content === 'string' ? m.message.content : m.message.content.map((b: any) => b.text ?? b.name ?? b.content).join('');
    expect(loaded.map((m: any) => [m.type, text(m)])).toEqual([
      ['user', 'List the files'],
      ['assistant', 'Bash'],
      ['user', 'a.py\nb.py'],
      ['assistant', 'Two files: a.py and b.py.'],
      ['user', 'Thanks'],
      ['assistant', 'You are welcome.'],
    ]);
    // And it is listed in this workspace, under its imported title.
    const listed = await sessions.listSessions(work);
    expect(listed.find((s: any) => s.id === sessionId)?.summary).toBe('List the files (imported)');
  });

  it('answers a cancelled dialog with nothing done', async () => {
    const dir = getProjectHistoryDir(work);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${SID}.jsonl`), toJsonl(ROWS));
    (vscode.window as any).showSaveDialog = vi.fn(async () => undefined);
    expect(await handleExportConversation({ type: 'export_conversation', sessionId: SID }, context())).toEqual({ type: 'export_conversation_response', saved: false });
    (vscode.window as any).showOpenDialog = vi.fn(async () => undefined);
    expect(await handleImportConversation({ type: 'import_conversation' }, context())).toEqual({ type: 'import_conversation_response' });
  });

  it('refuses a bad session id, and a session with no transcript', async () => {
    await expect(handleExportConversation({ type: 'export_conversation', sessionId: '../../etc/passwd' }, context())).rejects.toThrow(/invalid session id/);
    await expect(handleExportConversation({ type: 'export_conversation', sessionId: SID }, context())).rejects.toThrow(/no transcript/);
  });

  it('refuses a file that is not an export', async () => {
    const bad = path.join(work, 'bad.json');
    fs.writeFileSync(bad, '{"hello":1}');
    (vscode.window as any).showOpenDialog = vi.fn(async () => [{ fsPath: bad }]);
    await expect(handleImportConversation({ type: 'import_conversation' }, context())).rejects.toThrow(/not a Forge chat export/);
  });
});
