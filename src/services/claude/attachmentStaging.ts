/**
 * Attachments the model cannot take inline: put them where its tools can.
 *
 * Reported 2026-10-03: "eth_spy.pcapng can't be attached. Forge takes images,
 * PDFs and text files", "chatbox can accept uploaded zip files and unzip it by
 * itself whatever is the model", "accepts pdfs and excels".
 *
 * A model's message can only carry text, images and PDFs. Everything else is
 * staged on disk inside the workspace, under `.forge/attachments/<id>/`, and
 * the message tells the model the path -- every model, whatever it can see,
 * can then open it with its own tools (Read, Bash `tshark`, `unzip -l` ...):
 *   - a `.zip` is extracted next to itself, so its files can be read at once;
 *   - an `.xlsx` / `.xlsm` is also turned into CSV text, one block per sheet,
 *     which goes in the message itself;
 *   - anything else is saved as-is.
 *
 * The webview is untrusted (B3): the file name is reduced to a safe base name,
 * archive entries cannot leave their folder (zip-slip), and extraction is
 * bounded in entry count and total size (zip bombs).
 *
 * Kept free of `vscode` so the spec can import it.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import * as crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { extractWithSevenZip } from './sevenZip';

/** Largest attachment accepted, decoded. Matches the webview's cap. */
export const MAX_STAGED_BYTES = 64 * 1024 * 1024;
/** Extraction limits for an archive. */
export const MAX_ARCHIVE_ENTRIES = 5000;
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
/** How much CSV text a spreadsheet may put in the message. */
export const MAX_SHEET_TEXT = 200_000;

/** Where staged files go, relative to the workspace. */
export const STAGING_DIR = path.join('.forge', 'attachments');

/** A file name reduced to something safe to create: no directories, no control characters. */
export function safeFileName(name: unknown): string {
  const raw = typeof name === 'string' ? name : '';
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    // Control characters (code < 32) and the characters Windows forbids.
    .replace(/[<>:"|?*]/g, '_')
    .split('').map((ch) => (ch.charCodeAt(0) < 32 ? '_' : ch)).join('')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || 'attachment';
}

// ------------------------------------------------------------------ zip ---

export interface ZipEntry {
  name: string;
  directory: boolean;
  /** Decompressed bytes; read lazily so a listing costs nothing. */
  read(): Buffer;
  size: number;
}

/** Parse a zip's central directory. Throws on anything that is not a zip it can read. */
export function readZip(buf: Buffer): ZipEntry[] {
  // End of central directory: the last 0x06054b50 within the final 64 KiB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || offset === 0xffffffff) throw new Error('zip64 archives are not supported');

  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) throw new Error('corrupt zip directory');
    const flags = buf.readUInt16LE(offset + 8);
    const method = buf.readUInt16LE(offset + 10);
    const compressed = buf.readUInt32LE(offset + 20);
    const size = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const local = buf.readUInt32LE(offset + 42);
    const nameBytes = buf.subarray(offset + 46, offset + 46 + nameLen);
    // Bit 11: UTF-8 names; otherwise CP437, which latin1 approximates.
    const name = nameBytes.toString(flags & 0x800 ? 'utf8' : 'latin1');
    offset += 46 + nameLen + extraLen + commentLen;

    const directory = name.endsWith('/');
    entries.push({
      name,
      directory,
      size,
      read: () => {
        if (flags & 0x1) throw new Error(`${name} is encrypted`);
        if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`corrupt entry ${name}`);
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const data = buf.subarray(start, start + compressed);
        if (method === 0) return Buffer.from(data);
        if (method === 8) return zlib.inflateRawSync(data, { maxOutputLength: Math.max(size, 1) + 1024 });
        throw new Error(`${name} uses an unsupported compression method (${method})`);
      },
    });
  }
  return entries;
}

/**
 * Where an archive entry lands under `root`, or undefined when it would land
 * outside it (`../`, an absolute path, a drive letter).
 */
export function safeEntryPath(root: string, entryName: string): string | undefined {
  const normalized = entryName.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return undefined;
  if (normalized.split('/').some((part) => part === '..')) return undefined;
  const target = path.resolve(root, ...normalized.split('/').filter(Boolean));
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
  return target;
}

/** Extract an archive under `dest`, within the limits. Returns the relative paths written. */
export async function extractZip(buf: Buffer, dest: string): Promise<{ files: string[]; skipped: string[] }> {
  const entries = readZip(buf);
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error(`the archive has ${entries.length} entries (limit ${MAX_ARCHIVE_ENTRIES})`);
  const declared = entries.reduce((sum, e) => sum + e.size, 0);
  if (declared > MAX_ARCHIVE_BYTES) throw new Error(`the archive expands to ${declared} bytes (limit ${MAX_ARCHIVE_BYTES})`);

  const files: string[] = [];
  const skipped: string[] = [];
  let written = 0;
  for (const entry of entries) {
    const target = safeEntryPath(dest, entry.name);
    if (!target) { skipped.push(entry.name); continue; }
    if (entry.directory) { await fs.mkdir(target, { recursive: true }); continue; }
    let data: Buffer;
    try {
      data = entry.read();
    } catch {
      skipped.push(entry.name);
      continue;
    }
    written += data.length;
    if (written > MAX_ARCHIVE_BYTES) throw new Error('the archive expands past the size limit');
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.writeFile(target, data, { flag: 'wx' });
    } catch (e) {
      // A duplicate name in the archive: the first copy stays.
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      skipped.push(entry.name);
      continue;
    }
    files.push(path.relative(dest, target).split(path.sep).join('/'));
  }
  return { files, skipped };
}

// ----------------------------------------------------- other archives ---

/**
 * How an archive is opened (2026-10-03: "zip, rar, 7z ... all covered?").
 * Built in, no tools needed: zip, tar, tar.gz/tgz, gz. The rest go to the
 * `7z` command, else `tar` (bsdtar on Windows and macOS reads rar and 7z; GNU
 * tar on Linux reads xz, bz2 and zstd tarballs).
 */
export type ArchiveFormat = 'zip' | 'tar' | 'tgz' | 'gz' | 'external';

const EXTERNAL_EXTENSIONS = [
  '.rar', '.7z', '.tar.xz', '.txz', '.tar.bz2', '.tbz2', '.tbz', '.tar.zst', '.tzst',
  '.xz', '.bz2', '.zst', '.cab', '.iso', '.lzma', '.arj', '.wim', '.z', '.lzh', '.lha', '.cpio', '.rpm', '.deb',
];

export function archiveFormat(fileName: string): ArchiveFormat | undefined {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tgz';
  if (lower.endsWith('.tar')) return 'tar';
  if (EXTERNAL_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'external';
  if (lower.endsWith('.gz')) return 'gz';
  return undefined;
}

/** "logs.tar.gz" -> "logs", "a.7z" -> "a". */
export function stripArchiveExtension(fileName: string): string {
  return fileName.replace(/\.(tar\.(gz|xz|bz2|zst)|tgz|txz|tbz2?|tzst|zip|tar|rar|7z|gz|xz|bz2|zst|cab|iso|lzma|arj|wim|z|lzh|lha|cpio|rpm|deb)$/i, '');
}

/** Parse a tar stream and write its regular files under `dest`. Links are skipped. */
export async function extractTar(buf: Buffer, dest: string): Promise<{ files: string[]; skipped: string[] }> {
  const files: string[] = [];
  const skipped: string[] = [];
  let offset = 0;
  let longName: string | undefined;
  let written = 0;
  let entries = 0;
  const str = (start: number, len: number) => {
    const raw = buf.subarray(start, start + len);
    const end = raw.indexOf(0);
    return raw.subarray(0, end < 0 ? raw.length : end).toString('utf8');
  };
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const size = parseInt(str(offset + 124, 12).trim() || '0', 8) || 0;
    const type = String.fromCharCode(header[156] || 48);
    const prefix = buf.subarray(offset + 257, offset + 262).toString() === 'ustar' ? str(offset + 345, 155) : '';
    let name = longName ?? (prefix ? `${prefix}/${str(offset, 100)}` : str(offset, 100));
    longName = undefined;
    const body = buf.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (type === 'L') { longName = body.toString('utf8').replace(/\0+$/, ''); continue; }
    if (type === 'x') {
      const m = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
      if (m) longName = m[1];
      continue;
    }
    if (type === 'g') continue;
    if (++entries > MAX_ARCHIVE_ENTRIES) throw new Error(`the archive has more than ${MAX_ARCHIVE_ENTRIES} entries`);
    name = name.replace(/^\.\//, '');
    const target = safeEntryPath(dest, name);
    if (!target) { if (name) skipped.push(name); continue; }
    if (type === '5') { await fs.mkdir(target, { recursive: true }); continue; }
    if (type !== '0' && type !== '\0' && type !== '7') { skipped.push(name); continue; }
    written += body.length;
    if (written > MAX_ARCHIVE_BYTES) throw new Error('the archive expands past the size limit');
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.writeFile(target, body, { flag: 'wx' });
      files.push(path.relative(dest, target).split(path.sep).join('/'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      skipped.push(name);
    }
  }
  return { files, skipped };
}

function gunzip(buf: Buffer): Buffer {
  return zlib.gunzipSync(buf, { maxOutputLength: MAX_ARCHIVE_BYTES });
}

/** Run a fixed command; resolves false when the program is not installed. */
function run(command: string, args: string[], timeoutMs = 120_000): Promise<boolean> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err) => {
      if (!err) return resolve(true);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return resolve(false);
      reject(new Error(`${command} could not extract it (for rar or 7z, install 7-Zip)`));
    });
  });
}

/**
 * After an external tool ran: drop every link (it could point anywhere),
 * enforce the limits, and list what is left.
 */
export async function auditExtracted(dest: string): Promise<{ files: string[]; skipped: string[] }> {
  const files: string[] = [];
  const skipped: string[] = [];
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(dest, full).split(path.sep).join('/');
      const stat = await fs.lstat(full);
      if (stat.isSymbolicLink()) {
        await fs.rm(full, { force: true });
        skipped.push(rel);
      } else if (stat.isDirectory()) {
        await walk(full);
      } else if (stat.isFile()) {
        total += stat.size;
        files.push(rel);
        if (files.length > MAX_ARCHIVE_ENTRIES || total > MAX_ARCHIVE_BYTES) {
          throw new Error('the archive expands past the size or entry limit');
        }
      } else {
        await fs.rm(full, { force: true });
        skipped.push(rel);
      }
    }
  };
  await walk(dest);
  return { files: files.sort(), skipped };
}

/** Extract any supported archive under `dest`. `file` is the saved archive on disk. */
export async function extractArchive(
  format: ArchiveFormat,
  data: Buffer,
  file: string,
  dest: string,
): Promise<{ files: string[]; skipped: string[] }> {
  if (format === 'zip') return extractZip(data, dest);
  if (format === 'tar') return extractTar(data, dest);
  if (format === 'tgz') return extractTar(gunzip(data), dest);
  if (format === 'gz') {
    const out = gunzip(data);
    const name = safeFileName(path.basename(file).replace(/\.gz$/i, '')) || 'file';
    await fs.mkdir(dest, { recursive: true });
    await fs.writeFile(path.join(dest, name), out, { flag: 'wx' });
    return { files: [name], skipped: [] };
  }
  // rar, 7z, xz, bz2, zstd ...: Forge's built-in 7-Zip (sevenZip.ts) first.
  // Only if it is missing from the build does an installed tool get a turn;
  // an archive it reads and refuses (password, damage) is not retried.
  try {
    const out = await extractWithSevenZip(data, file, dest, { maxEntries: MAX_ARCHIVE_ENTRIES, maxBytes: MAX_ARCHIVE_BYTES }, safeEntryPath);
    // A compressed tarball (.tar.xz, .tar.bz2, .tar.zst) comes out of 7-Zip
    // as one .tar: open that too, so the model sees the files themselves.
    if (out.files.length === 1 && /\.tar$/i.test(out.files[0]!)) {
      const tarPath = path.join(dest, out.files[0]!);
      const tar = await fs.readFile(tarPath);
      await fs.rm(tarPath, { force: true });
      const inner = await extractTar(tar, dest);
      return { files: inner.files, skipped: [...out.skipped, ...inner.skipped] };
    }
    return out;
  } catch (e) {
    await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
    if (!/7zz\.wasm\) is missing/.test(e instanceof Error ? e.message : '')) throw e;
  }
  await fs.mkdir(dest, { recursive: true });
  try {
    const ok =
      (await run('7z', ['x', '-y', '-bd', `-o${dest}`, '--', file])) ||
      (await run('7za', ['x', '-y', '-bd', `-o${dest}`, '--', file])) ||
      (await run('tar', ['-xf', file, '-C', dest]));
    if (!ok) throw new Error('no extractor is installed for this format (install 7-Zip, or use a zip)');
    return await auditExtracted(dest);
  } catch (e) {
    await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

// --------------------------------------------------------------- xlsx -----

function xmlDecode(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/** "AB12" -> 27 (zero-based column index). */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? 'A';
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Every sheet of an `.xlsx` as CSV, in workbook order. */
export function xlsxToCsv(buf: Buffer): Array<{ name: string; csv: string }> {
  const entries = new Map(readZip(buf).map((e) => [e.name.replace(/\\/g, '/'), e]));
  const text = (name: string): string | undefined => {
    const e = entries.get(name);
    return e ? e.read().toString('utf8') : undefined;
  };

  const shared: string[] = [];
  const sst = text('xl/sharedStrings.xml');
  if (sst) {
    for (const si of sst.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      shared.push(xmlDecode((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
    }
  }

  // Sheet names and order from workbook.xml, targets from its rels.
  const workbook = text('xl/workbook.xml') ?? '';
  const rels = text('xl/_rels/workbook.xml.rels') ?? '';
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1];
    const target = /Target="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) targets.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''));
  }
  const sheets: Array<{ name: string; file: string }> = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = xmlDecode(/name="([^"]*)"/.exec(m[0])?.[1] ?? `Sheet${sheets.length + 1}`);
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1];
    const target = rid ? targets.get(rid) : undefined;
    sheets.push({ name, file: `xl/${target ?? `worksheets/sheet${sheets.length + 1}.xml`}` });
  }
  if (!sheets.length) {
    for (const name of entries.keys()) {
      const m = /^xl\/worksheets\/(sheet\d+)\.xml$/.exec(name);
      if (m) sheets.push({ name: m[1]!, file: name });
    }
  }

  const out: Array<{ name: string; csv: string }> = [];
  for (const sheet of sheets) {
    const xml = text(sheet.file);
    if (xml === undefined) continue;
    const rows: string[] = [];
    for (const row of xml.match(/<row\b[\s\S]*?<\/row>|<row\b[^>]*\/>/g) ?? []) {
      const cells: string[] = [];
      for (const c of row.match(/<c\b[^>]*\/>|<c\b[\s\S]*?<\/c>/g) ?? []) {
        const attrs = /<c\b([^>]*)/.exec(c)?.[1] ?? '';
        const ref = /r="([A-Z]+\d+)"/i.exec(attrs)?.[1];
        const type = /t="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(c)?.[1];
        let value = '';
        if (type === 's' && v !== undefined) value = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') value = xmlDecode((c.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join(''));
        else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
        else if (v !== undefined) value = xmlDecode(v);
        const index = ref ? columnIndex(ref) : cells.length;
        while (cells.length < index) cells.push('');
        cells[index] = csvCell(value);
      }
      rows.push(cells.join(','));
    }
    while (rows.length && rows[rows.length - 1] === '') rows.pop();
    out.push({ name: sheet.name, csv: rows.join('\n') });
  }
  return out;
}

// -------------------------------------------------------------- staging ---

export type StagedKind = 'archive' | 'spreadsheet' | 'file';

export interface StagedAttachment {
  kind: StagedKind;
  /** Workspace-relative path of the saved file (forward slashes). */
  path: string;
  /** Archive: where it was extracted, and what came out (capped). */
  extractedTo?: string;
  files?: string[];
  fileCount?: number;
  skipped?: number;
  /** Spreadsheet: each sheet as CSV (capped). */
  sheets?: Array<{ name: string; csv: string }>;
  truncated?: boolean;
  /** Why an archive or a workbook could not be opened; the file is still saved. */
  note?: string;
  size: number;
}

export function kindOf(fileName: string): StagedKind {
  const ext = path.extname(fileName).toLowerCase();
  if (archiveFormat(fileName)) return 'archive';
  if (ext === '.xlsx' || ext === '.xlsm') return 'spreadsheet';
  return 'file';
}

/** Stage one attachment under `workspaceRoot/.forge/attachments/<id>/`. */
export async function stageAttachment(
  workspaceRoot: string,
  fileName: unknown,
  base64: unknown,
): Promise<StagedAttachment> {
  if (typeof base64 !== 'string' || !base64) throw new Error('stage_attachment: no data');
  if (base64.length > Math.ceil((MAX_STAGED_BYTES * 4) / 3) + 4) throw new Error('stage_attachment: the file is larger than 64 MB');
  const data = Buffer.from(base64, 'base64');
  const name = safeFileName(fileName);
  const stagingRoot = path.join(workspaceRoot, STAGING_DIR);
  await fs.mkdir(stagingRoot, { recursive: true });
  // Keep staged files out of the user's git history.
  await fs.writeFile(path.join(stagingRoot, '.gitignore'), '*\n', { flag: 'wx' }).catch(() => {});

  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
  const dir = path.join(stagingRoot, id);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await fs.writeFile(file, data, { flag: 'wx' });
  const rel = (p: string) => path.relative(workspaceRoot, p).split(path.sep).join('/');

  const staged: StagedAttachment = { kind: kindOf(name), path: rel(file), size: data.length };

  if (staged.kind === 'archive') {
    const format = archiveFormat(name)!;
    const dest = path.join(dir, stripArchiveExtension(name) || 'archive');
    try {
      const out = await extractArchive(format, data, file, dest);
      staged.extractedTo = rel(dest);
      staged.fileCount = out.files.length;
      staged.files = out.files.slice(0, 200);
      staged.skipped = out.skipped.length;
    } catch (e) {
      staged.note = `could not extract: ${e instanceof Error ? e.message : String(e)}`;
    }
  } else if (staged.kind === 'spreadsheet') {
    try {
      let budget = MAX_SHEET_TEXT;
      staged.sheets = [];
      for (const sheet of xlsxToCsv(data)) {
        const csv = sheet.csv.length > budget ? sheet.csv.slice(0, Math.max(0, budget)) : sheet.csv;
        if (csv.length < sheet.csv.length) staged.truncated = true;
        budget -= csv.length;
        staged.sheets.push({ name: sheet.name, csv });
        if (budget <= 0) { staged.truncated = true; break; }
      }
    } catch (e) {
      staged.note = `could not read the workbook: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return staged;
}

/** What the model is told about a staged attachment (a text block in the user message). */
export function describeStaged(fileName: string, staged: StagedAttachment): string {
  const lines = [`<attachment name="${safeFileName(fileName).replace(/"/g, "'")}" saved_at="${staged.path}" bytes="${staged.size}">`];
  if (staged.kind === 'archive' && staged.extractedTo) {
    lines.push(`The user attached an archive. It has been extracted to \`${staged.extractedTo}/\` (${staged.fileCount} file(s)${staged.skipped ? `, ${staged.skipped} unsafe or unreadable entr${staged.skipped === 1 ? 'y' : 'ies'} skipped` : ''}):`);
    for (const f of staged.files ?? []) lines.push(`- ${staged.extractedTo}/${f}`);
    if ((staged.fileCount ?? 0) > (staged.files?.length ?? 0)) lines.push(`- ... and ${(staged.fileCount ?? 0) - (staged.files?.length ?? 0)} more`);
    lines.push('These are ordinary files in the workspace now: open them with Read, search them with Grep and Glob, and run or debug them like any project file.');
  } else if (staged.kind === 'spreadsheet' && staged.sheets) {
    lines.push('The user attached a spreadsheet. Its sheets as CSV:');
    for (const sheet of staged.sheets) {
      lines.push(`<sheet name="${sheet.name.replace(/"/g, "'")}">`, sheet.csv, '</sheet>');
    }
    if (staged.truncated) lines.push(`[Truncated; the full workbook is at ${staged.path}.]`);
  } else {
    lines.push('The user attached this file. It is not text the message can carry, so it was saved at the path above: inspect it with your tools.');
  }
  if (staged.note) lines.push(`(Note: ${staged.note}.)`);
  lines.push('</attachment>');
  return lines.join('\n');
}
