/**
 * rar, 7z and the other formats Node cannot open, inside Forge itself.
 *
 * Asked for on 2026-10-03: "find a light, effective solution for .rar and .7z
 * ... so the model can see the unzipped files". The choice is `7z-wasm`
 * (github.com/use-strict/7z-wasm): 7-Zip compiled to WebAssembly, one 1.8 MB
 * module, no install on the user's machine, the same on Windows, macOS and
 * Linux. It reads rar (v2-v5, solid), 7z, xz, bz2, zstd, iso, cab, arj, lzma,
 * wim and more. The alternatives were narrower (node-unrar-js: rar only) or
 * heavier (libarchive.js: a browser worker). The system `7z`/`tar` stay as a
 * fallback (attachmentStaging.ts).
 *
 * The archive is opened in 7-Zip's in-memory file system, never on disk:
 *   1. `l -slt` lists it first, so a bomb is refused before anything expands;
 *   2. `x` extracts into memory;
 *   3. Forge copies regular files out itself, each through `safeEntryPath`,
 *      so a hostile name cannot leave the folder and links are never written.
 * `-p` (an empty password) keeps 7-Zip from waiting on a prompt: a
 * password-protected archive fails with a reason instead of hanging.
 *
 * License: 7zz.wasm is GNU LGPL + the unRAR restriction; it ships unmodified,
 * with both license texts, in dist/7z-wasm/.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

type SevenZipModule = {
  FS: {
    writeFile(p: string, data: Uint8Array): void;
    readFile(p: string): Uint8Array;
    mkdir(p: string): void;
    readdir(p: string): string[];
    lstat(p: string): { mode: number; size: number };
    isDir(mode: number): boolean;
    isFile(mode: number): boolean;
  };
  callMain(args: string[]): number;
};
type SevenZipFactory = (options: Record<string, unknown>) => Promise<SevenZipModule>;

export interface SevenZipLimits {
  maxEntries: number;
  maxBytes: number;
}

/** Where `7zz.wasm` is: next to the bundle in a build, in node_modules in dev and tests. */
async function wasmBinary(): Promise<Uint8Array> {
  const candidates = [path.join(__dirname, '7z-wasm', '7zz.wasm')];
  try {
    candidates.push(path.join(path.dirname(require.resolve('7z-wasm/package.json')), '7zz.wasm'));
  } catch {
    // Not resolvable from a bundle; the first candidate is the one.
  }
  for (const file of candidates) {
    try {
      return await fs.readFile(file);
    } catch {
      // Try the next.
    }
  }
  throw new Error('the built-in 7-Zip (7zz.wasm) is missing from this build');
}

let cachedBinary: Uint8Array | undefined;

/** A fresh 7-Zip instance (each run exits its runtime), its console captured. */
async function sevenZip(output: string[]): Promise<SevenZipModule> {
  cachedBinary ??= await wasmBinary();
  const factory = require('7z-wasm') as SevenZipFactory;
  return factory({
    wasmBinary: cachedBinary,
    print: (line: string) => output.push(line),
    printErr: (line: string) => output.push(line),
  });
}

/**
 * Run 7-Zip's main. Emscripten sets `process.exitCode` when it returns; in
 * the extension host that would leak into VS Code's own exit, so it is put back.
 */
function runMain(module: SevenZipModule, args: string[]): number {
  const saved = process.exitCode;
  try {
    return module.callMain(args);
  } finally {
    process.exitCode = saved;
  }
}

/** `l -slt` output -> entry count and total unpacked size. */
export function parseListing(lines: readonly string[]): { entries: number; bytes: number } {
  let entries = 0;
  let bytes = 0;
  let inEntries = false;
  for (const line of lines) {
    if (line.startsWith('----------')) { inEntries = true; continue; }
    if (!inEntries) continue;
    if (line.startsWith('Path = ')) entries++;
    const size = /^Size = (\d+)$/.exec(line);
    if (size) bytes += Number(size[1]);
  }
  return { entries, bytes };
}

/** The exit codes 7-Zip documents: 0 ok, 1 warning, 2 fatal, 7 bad command line, 8 memory. */
function failure(code: number, output: readonly string[]): Error {
  const text = output.join('\n');
  if (/Wrong password|encrypted|Can not open encrypted/i.test(text)) {
    return new Error('the archive is password-protected');
  }
  if (/Can ?not open (the )?file as archive|Is not archive/i.test(text)) {
    return new Error('this is not an archive 7-Zip can read');
  }
  return new Error(`7-Zip could not extract it (exit ${code}${/Data Error|CRC Failed/i.test(text) ? ', the archive is damaged' : ''})`);
}

/**
 * Extract `data` (named `fileName`, whose extension helps 7-Zip pick a
 * format) under `dest`. Returns the relative paths written and the entries
 * skipped (links, unsafe names, duplicates).
 */
export async function extractWithSevenZip(
  data: Uint8Array,
  fileName: string,
  dest: string,
  limits: SevenZipLimits,
  safeEntryPath: (root: string, name: string) => string | undefined,
): Promise<{ files: string[]; skipped: string[] }> {
  const input = `/in/${path.basename(fileName).replace(/[^\w.-]/g, '_') || 'archive'}`;

  // 1. List first: refuse a bomb before it expands.
  const listing: string[] = [];
  const lister = await sevenZip(listing);
  lister.FS.mkdir('/in');
  lister.FS.writeFile(input, data);
  let code = runMain(lister, ['l', '-slt', '-p', '-bd', input]);
  if (code !== 0 && code !== 1) throw failure(code, listing);
  const { entries, bytes } = parseListing(listing);
  if (entries > limits.maxEntries) throw new Error(`the archive has ${entries} entries (limit ${limits.maxEntries})`);
  if (bytes > limits.maxBytes) throw new Error(`the archive expands to ${bytes} bytes (limit ${limits.maxBytes})`);

  // 2. Extract in memory.
  const output: string[] = [];
  const zip = await sevenZip(output);
  zip.FS.mkdir('/in');
  zip.FS.mkdir('/out');
  zip.FS.writeFile(input, data);
  code = runMain(zip, ['x', '-y', '-bd', '-p', '-o/out', input]);
  if (code !== 0 && code !== 1) throw failure(code, output);

  // 3. Copy regular files out, each through the zip-slip check.
  const files: string[] = [];
  const skipped: string[] = [];
  let written = 0;
  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const name of zip.FS.readdir(dir)) {
      if (name === '.' || name === '..') continue;
      const inner = `${dir}/${name}`;
      const relName = rel ? `${rel}/${name}` : name;
      const stat = zip.FS.lstat(inner);
      if (zip.FS.isDir(stat.mode)) {
        await walk(inner, relName);
        continue;
      }
      const target = zip.FS.isFile(stat.mode) ? safeEntryPath(dest, relName) : undefined;
      if (!target) { skipped.push(relName); continue; }
      const body = zip.FS.readFile(inner);
      written += body.length;
      if (written > limits.maxBytes) throw new Error('the archive expands past the size limit');
      await fs.mkdir(path.dirname(target), { recursive: true });
      try {
        await fs.writeFile(target, body, { flag: 'wx' });
        files.push(relName);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        skipped.push(relName);
      }
    }
  };
  await fs.mkdir(dest, { recursive: true });
  await walk('/out', '');
  return { files: files.sort(), skipped };
}
