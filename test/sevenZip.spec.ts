/**
 * rar / 7z / xz ... through Forge's built-in 7-Zip (7z-wasm), 2026-10-03.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractWithSevenZip, parseListing } from '../src/services/claude/sevenZip';
import { describeStaged, safeEntryPath, stageAttachment } from '../src/services/claude/attachmentStaging';

const FIXTURES = path.join(__dirname, 'fixtures', 'archives');
const LIMITS = { maxEntries: 5000, maxBytes: 512 * 1024 * 1024 };

/** A .7z made by the same 7-Zip, so the test needs nothing installed. */
async function make7z(files: Record<string, string>, extra: string[] = []): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const factory = require('7z-wasm');
  const sz = await factory({ print: () => {}, printErr: () => {} });
  sz.FS.mkdir('/d');
  for (const [name, body] of Object.entries(files)) {
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = '/d/' + parts.slice(0, i).join('/');
      try { sz.FS.mkdir(dir); } catch { /* exists */ }
    }
    sz.FS.writeFile('/d/' + name, body);
  }
  sz.callMain(['a', ...extra, '/t.7z', '/d/*']);
  return Buffer.from(sz.FS.readFile('/t.7z'));
}

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-7z-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('built-in 7-Zip', () => {
  it('extracts RAR3 with sub-folders and unicode names', async () => {
    const out = await extractWithSevenZip(fs.readFileSync(path.join(FIXTURES, 'rar3-subdirs.rar')), 'a.rar', dir, LIMITS, safeEntryPath);
    expect(out.files).toContain('sub/dir1/file1.txt');
    expect(out.files).toContain('sub/with space/long fn.txt');
    expect(out.files.some((f) => f.startsWith('sub/üȵĩöḋè/'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'sub', 'dir1', 'file1.txt'))).toBe(true);
  }, 30_000);

  it('extracts a solid RAR5', async () => {
    const out = await extractWithSevenZip(fs.readFileSync(path.join(FIXTURES, 'rar5-solid.rar')), 'b.rar', dir, LIMITS, safeEntryPath);
    expect(out.files).toEqual(['stest1.txt', 'stest2.txt']);
  }, 30_000);

  it('says a password-protected archive needs a password, without hanging', async () => {
    await expect(
      extractWithSevenZip(fs.readFileSync(path.join(FIXTURES, 'rar5-psw.rar')), 'c.rar', dir, LIMITS, safeEntryPath),
    ).rejects.toThrow(/password-protected/);
  }, 30_000);

  it('extracts a .7z', async () => {
    const archive = await make7z({ 'main.c': 'int main(){}', 'lib/util.h': '#pragma once' });
    const out = await extractWithSevenZip(archive, 'p.7z', dir, LIMITS, safeEntryPath);
    expect(out.files).toEqual(['lib/util.h', 'main.c']);
    expect(fs.readFileSync(path.join(dir, 'main.c'), 'utf8')).toBe('int main(){}');
  }, 30_000);

  it('refuses a bomb from the listing, before anything is written', async () => {
    const archive = await make7z({ 'zeros.bin': '0'.repeat(2_000_000) });
    expect(archive.length).toBeLessThan(10_000);
    await expect(
      extractWithSevenZip(archive, 'bomb.7z', dir, { maxEntries: 10, maxBytes: 1_000_000 }, safeEntryPath),
    ).rejects.toThrow(/expands to 2000000 bytes/);
    expect(fs.readdirSync(dir)).toEqual([]);
  }, 30_000);

  it('says when the file is not an archive', async () => {
    await expect(extractWithSevenZip(Buffer.from('plain text, not an archive'), 'x.7z', dir, LIMITS, safeEntryPath)).rejects.toThrow(/not an archive/);
  }, 30_000);

  it('leaves process.exitCode alone', async () => {
    const before = process.exitCode;
    await extractWithSevenZip(Buffer.from('nope'), 'x.rar', dir, LIMITS, safeEntryPath).catch(() => {});
    expect(process.exitCode).toBe(before);
  }, 30_000);

  it('reads the listing totals', () => {
    expect(parseListing(['header', 'Path = /in/x.7z', '----------', 'Path = a', 'Size = 5', '', 'Path = b', 'Size = 7'])).toEqual({ entries: 2, bytes: 12 });
  });
});

describe('attaching a .rar or .7z', () => {
  it('stages, extracts and tells the model to work with the files', async () => {
    const staged = await stageAttachment(dir, 'project.rar', fs.readFileSync(path.join(FIXTURES, 'rar3-subdirs.rar')).toString('base64'));
    expect(staged.kind).toBe('archive');
    expect(staged.note).toBeUndefined();
    expect(staged.extractedTo).toMatch(/\/project$/);
    const text = describeStaged('project.rar', staged);
    expect(text).toContain(`${staged.extractedTo}/sub/dir1/file1.txt`);
    expect(text).toMatch(/open them with Read/);

    const seven = await stageAttachment(dir, 'src.7z', (await make7z({ 'a.py': 'print(1)' })).toString('base64'));
    expect(seven.files).toEqual(['a.py']);
  }, 60_000);
});
