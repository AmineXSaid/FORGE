/**
 * Attachments the message cannot carry (reported 2026-10-03: a .pcapng was
 * refused; zips and Excel files should work "whatever the model").
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  describeStaged,
  extractZip,
  readZip,
  safeEntryPath,
  safeFileName,
  stageAttachment,
  xlsxToCsv,
} from '../src/services/claude/attachmentStaging';
import { handleStageAttachment } from '../src/services/claude/handlers/handlers';

/** A minimal zip writer for fixtures (stored or deflated entries). */
function makeZip(entries: Array<{ name: string; data: string | Buffer; deflate?: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const body = e.deflate ? zlib.deflateRawSync(raw) : raw;
    const name = Buffer.from(e.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(e.deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(e.deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

function makeXlsx(): Buffer {
  return makeZip([
    { name: 'xl/workbook.xml', data: '<workbook><sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Two" sheetId="2" r:id="rId2"/></sheets></workbook>', deflate: true },
    { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>' },
    { name: 'xl/sharedStrings.xml', data: '<sst><si><t>name</t></si><si><t>a, "b"</t></si><si><r><t>rich</t></r><r><t> text</t></r></si></sst>' },
    { name: 'xl/worksheets/sheet1.xml', data: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>42</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="b"><v>1</v></c><c r="C2" t="inlineStr"><is><t>x&amp;y</t></is></c></row></sheetData></worksheet>', deflate: true },
    { name: 'xl/worksheets/sheet2.xml', data: '<worksheet><sheetData><row r="1"><c r="B1" t="s"><v>2</v></c></row></sheetData></worksheet>' },
  ]);
}

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-stage-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('file names from the webview', () => {
  it('are reduced to a safe base name', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\Users\\x\\cap.pcapng')).toBe('cap.pcapng');
    expect(safeFileName('..hidden')).toBe('hidden');
    expect(safeFileName('a<b>:c?.txt')).toBe('a_b__c_.txt');
    expect(safeFileName(undefined)).toBe('attachment');
    expect(safeFileName('')).toBe('attachment');
  });
});

describe('zip', () => {
  it('reads stored and deflated entries', () => {
    const entries = readZip(makeZip([{ name: 'a.txt', data: 'hello' }, { name: 'd/b.txt', data: 'world'.repeat(50), deflate: true }]));
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'd/b.txt']);
    expect(entries[1]!.read().toString()).toBe('world'.repeat(50));
  });

  it('refuses entries that would leave the folder (zip-slip)', () => {
    expect(safeEntryPath(dir, '../evil.txt')).toBeUndefined();
    expect(safeEntryPath(dir, 'a/../../evil.txt')).toBeUndefined();
    expect(safeEntryPath(dir, '/etc/passwd')).toBeUndefined();
    expect(safeEntryPath(dir, 'C:/x')).toBeUndefined();
    expect(safeEntryPath(dir, 'ok/file.txt')).toBe(path.join(dir, 'ok', 'file.txt'));
  });

  it('extracts the safe entries and skips the rest', async () => {
    const zip = makeZip([
      { name: 'src/', data: '' },
      { name: 'src/main.c', data: 'int main(){}', deflate: true },
      { name: '../escape.txt', data: 'no' },
      { name: 'src/main.c', data: 'dup' },
    ]);
    const out = await extractZip(zip, path.join(dir, 'x'));
    expect(out.files).toEqual(['src/main.c']);
    expect(out.skipped).toEqual(['../escape.txt', 'src/main.c']);
    expect(fs.readFileSync(path.join(dir, 'x', 'src', 'main.c'), 'utf8')).toBe('int main(){}');
    expect(fs.existsSync(path.join(dir, 'escape.txt'))).toBe(false);
  });

  it('throws on something that is not a zip', () => {
    expect(() => readZip(Buffer.from('not a zip at all, definitely not'))).toThrow(/not a zip/);
  });
});

describe('xlsx', () => {
  it('turns every sheet into CSV, in workbook order', () => {
    const sheets = xlsxToCsv(makeXlsx());
    expect(sheets.map((s) => s.name)).toEqual(['Data', 'Two']);
    expect(sheets[0]!.csv).toBe('name,,42\n"a, ""b""",TRUE,x&y');
    expect(sheets[1]!.csv).toBe(',rich text');
  });
});

describe('stageAttachment', () => {
  it('saves a capture file under .forge/attachments, git-ignored, and tells the model where', async () => {
    const staged = await stageAttachment(dir, 'eth_spy.pcapng', Buffer.from([0x0a, 0x0d, 0x0d, 0x0a]).toString('base64'));
    expect(staged.kind).toBe('file');
    expect(staged.path).toMatch(/^\.forge\/attachments\/[^/]+\/eth_spy\.pcapng$/);
    expect(fs.readFileSync(path.join(dir, staged.path))).toEqual(Buffer.from([0x0a, 0x0d, 0x0d, 0x0a]));
    expect(fs.readFileSync(path.join(dir, '.forge', 'attachments', '.gitignore'), 'utf8')).toBe('*\n');
    const text = describeStaged('eth_spy.pcapng', staged);
    expect(text).toContain(staged.path);
    expect(text).toContain('inspect it with your tools');
  });

  it('extracts a zip next to itself and lists it', async () => {
    const zip = makeZip([{ name: 'readme.md', data: '# hi' }, { name: 'lib/a.py', data: 'print(1)', deflate: true }]);
    const staged = await stageAttachment(dir, 'project.zip', zip.toString('base64'));
    expect(staged.kind).toBe('archive');
    expect(staged.fileCount).toBe(2);
    expect(fs.readFileSync(path.join(dir, staged.extractedTo!, 'lib', 'a.py'), 'utf8')).toBe('print(1)');
    expect(describeStaged('project.zip', staged)).toContain(`${staged.extractedTo}/lib/a.py`);
  });

  it('keeps a broken zip as a file and says why', async () => {
    const staged = await stageAttachment(dir, 'broken.zip', Buffer.from('garbage').toString('base64'));
    expect(staged.note).toMatch(/could not extract/);
    expect(fs.existsSync(path.join(dir, staged.path))).toBe(true);
  });

  it('puts a workbook in the message as CSV', async () => {
    const staged = await stageAttachment(dir, 'budget.xlsx', makeXlsx().toString('base64'));
    expect(staged.kind).toBe('spreadsheet');
    const text = describeStaged('budget.xlsx', staged);
    expect(text).toContain('<sheet name="Data">');
    expect(text).toContain('name,,42');
  });

  it('rejects a missing payload', async () => {
    await expect(stageAttachment(dir, 'x.bin', undefined)).rejects.toThrow(/no data/);
    await expect(stageAttachment(dir, 'x.bin', '')).rejects.toThrow(/no data/);
  });

  it('never writes outside the staging folder, whatever the name', async () => {
    const staged = await stageAttachment(dir, '../../outside.bin', Buffer.from('x').toString('base64'));
    expect(staged.path.startsWith('.forge/attachments/')).toBe(true);
    expect(fs.existsSync(path.join(dir, '..', 'outside.bin'))).toBe(false);
  });
});

describe('handleStageAttachment', () => {
  const context = (root: string | undefined) => ({
    workspaceService: { getDefaultWorkspaceFolder: () => (root ? { uri: { fsPath: root } } : undefined) },
    logService: { info: () => {} },
  }) as any;

  it('stages into the workspace and answers with the text for the model', async () => {
    const res = await handleStageAttachment(
      { type: 'stage_attachment', fileName: 'cap.pcapng', data: Buffer.from('abc').toString('base64') },
      context(dir),
    );
    expect(res.type).toBe('stage_attachment_response');
    expect(res.kind).toBe('file');
    expect(res.text).toContain(res.path);
  });

  it('refuses without a workspace folder', async () => {
    await expect(
      handleStageAttachment({ type: 'stage_attachment', fileName: 'a', data: 'YQ==' }, context(undefined)),
    ).rejects.toThrow(/open a folder/);
  });
});

describe('other archive formats (2026-10-03: zip, rar, 7z ...)', () => {
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  /** Build a real archive with the system tar from a small tree. */
  function makeTarball(flags: string, out: string): Buffer {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-tarsrc-'));
    fs.mkdirSync(path.join(src, 'pkg'));
    fs.writeFileSync(path.join(src, 'pkg', 'a.txt'), 'alpha');
    fs.writeFileSync(path.join(src, 'readme.md'), '# hi');
    fs.symlinkSync('/etc/passwd', path.join(src, 'link'));
    const file = path.join(src, out);
    execFileSync('tar', [flags, file, '-C', src, 'pkg', 'readme.md', 'link']);
    const buf = fs.readFileSync(file);
    fs.rmSync(src, { recursive: true, force: true });
    return buf;
  }

  it('knows the formats', async () => {
    const { archiveFormat, stripArchiveExtension } = await import('../src/services/claude/attachmentStaging');
    expect(archiveFormat('a.zip')).toBe('zip');
    expect(archiveFormat('a.tar')).toBe('tar');
    expect(archiveFormat('a.tar.gz')).toBe('tgz');
    expect(archiveFormat('a.tgz')).toBe('tgz');
    expect(archiveFormat('log.gz')).toBe('gz');
    for (const f of ['a.rar', 'a.7z', 'a.tar.xz', 'a.tar.bz2', 'a.bz2', 'a.xz', 'a.tar.zst']) expect(archiveFormat(f)).toBe('external');
    expect(archiveFormat('a.pcapng')).toBeUndefined();
    expect(stripArchiveExtension('logs.tar.gz')).toBe('logs');
    expect(stripArchiveExtension('x.7z')).toBe('x');
  });

  it('extracts .tar and .tar.gz built in, skipping links', async () => {
    for (const [flags, name] of [['-cf', 'b.tar'], ['-czf', 'b.tar.gz'], ['-czf', 'b.tgz']] as const) {
      const staged = await stageAttachment(dir, name, makeTarball(flags, name).toString('base64'));
      expect(staged.kind).toBe('archive');
      expect(staged.files).toEqual(['pkg/a.txt', 'readme.md']);
      expect(staged.skipped).toBe(1);
      expect(fs.readFileSync(path.join(dir, staged.extractedTo!, 'pkg', 'a.txt'), 'utf8')).toBe('alpha');
    }
  });

  it('unpacks a single .gz file', async () => {
    const staged = await stageAttachment(dir, 'server.log.gz', zlib.gzipSync(Buffer.from('boot ok')).toString('base64'));
    expect(staged.files).toEqual(['server.log']);
    expect(fs.readFileSync(path.join(dir, staged.extractedTo!, 'server.log'), 'utf8')).toBe('boot ok');
  });

  it('extracts .tar.xz / .tar.bz2 (built-in 7-Zip, then the inner tar), and drops links', async () => {
    for (const [flags, name] of [['-cJf', 'c.tar.xz'], ['-cjf', 'c.tar.bz2']] as const) {
      const staged = await stageAttachment(dir, name, makeTarball(flags, name).toString('base64'));
      expect(staged.note).toBeUndefined();
      expect(staged.files).toEqual(['pkg/a.txt', 'readme.md']);
      expect(fs.existsSync(path.join(dir, staged.extractedTo!, 'link'))).toBe(false);
    }
  });

  it('keeps an archive no tool can open, and says why', async () => {
    const staged = await stageAttachment(dir, 'broken.7z', Buffer.from('not really 7z').toString('base64'));
    expect(staged.kind).toBe('archive');
    expect(staged.note).toMatch(/could not extract/);
    expect(fs.existsSync(path.join(dir, staged.path))).toBe(true);
  });
});
