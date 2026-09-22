/**
 * Step 29: output styles, ported from the official host.
 *
 * Everything the webview sends here ends up as a **file name and file content**,
 * so this module is where B3 lives. The official's own checks, ported literally:
 *
 * - `If$` (extension.js @2891336) -- the name: not empty, no `\ / : * ? " < > |`,
 *   no control characters, not starting with `.`, not a Windows device name,
 *   no `---`, and not already taken;
 * - `Ef$` (@2891582) -- the description: no `---` (it would close the front
 *   matter early);
 * - `Cf$` (@2891636) -- the file name is exactly `${name.trim()}.md`, which is
 *   why the name may contain no separators;
 * - `wf$` / `Pf$` (@2891843) -- the YAML front matter, quoted the official way;
 * - `userOutputStylesDir` (@3091874) -- the CLI's `user_output_styles_dir` is
 *   only trusted when it is absolute, already normalised, and actually named
 *   `output-styles`; otherwise this host's own `~/.claude/output-styles`.
 *
 * The write itself (`mv` / `Bf$` / `fe` / `yA0`, @2885715-@2887000) is hardened
 * against the directory being swapped under it: every open is `O_EXCL` +
 * `O_NOFOLLOW`, the `.claude` and `output-styles` directories are checked for
 * being symlinks, a project-level write must resolve inside the session cwd, and
 * the directory's `dev`/`ino` must be the same before and after. A mismatch is
 * `OutputStyleFolderChangedError`, which the official surfaces as
 * "This project's output styles folder is a link to another location. Save at
 * the User level instead."
 *
 * Kept free of `vscode` so the specs can import it.
 */

import * as fsSync from 'fs';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

/** The official `cA0`, `lA0`, `dA0`. */
const NAME_SEPARATORS = /[\\/:*?"<>|]/;
// eslint-disable-next-line no-control-regex -- the official `lA0`, verbatim
const NAME_CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const WINDOWS_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

export type OutputStyleNameProblem = 'empty' | 'characters' | 'taken' | null;

/** The official `If$` / `FU0`: the same function on both sides of the wire. */
export function outputStyleNameProblem(name: string, existing?: readonly string[]): OutputStyleNameProblem {
    const trimmed = name.trim();
    if (trimmed.length === 0) return 'empty';
    if (
        NAME_SEPARATORS.test(trimmed) ||
        NAME_CONTROL_CHARS.test(trimmed) ||
        trimmed.startsWith('.') ||
        WINDOWS_DEVICE_NAMES.test(trimmed) ||
        trimmed.includes('---')
    ) {
        return 'characters';
    }
    const lower = trimmed.toLowerCase();
    if (existing?.some((style) => style.toLowerCase() === lower)) return 'taken';
    return null;
}

/** The official `Ef$` / `AU0`. */
export function outputStyleDescriptionProblem(description: string): 'fence' | null {
    return description.includes('---') ? 'fence' : null;
}

/** The official `Cf$` / `DU0`. */
export function outputStyleFileName(name: string): string {
    return `${name.trim()}.md`;
}

/** The official `iA0` / `nA0` / `wf$`: a bare YAML scalar, or JSON-quoted. */
const PLAIN_SCALAR = /^[A-Za-z][A-Za-z0-9 ,.!?'()-]*[A-Za-z0-9.!?')]$/;
const YAML_KEYWORD = /^(true|false|yes|no|on|off|null)$/i;

export function yamlScalar(value: string): string {
    return PLAIN_SCALAR.test(value) && !YAML_KEYWORD.test(value) ? value : JSON.stringify(value);
}

export interface OutputStyleDraft {
    name: string;
    description: string;
    instructions: string;
    keepCodingInstructions?: boolean;
}

/** The official `Pf$`: the front matter, then the instructions, then a newline. */
export function outputStyleFileContent(draft: OutputStyleDraft): string {
    const lines = [`name: ${yamlScalar(draft.name.trim())}`];
    const description = draft.description.trim();
    if (description.length > 0) lines.push(`description: ${yamlScalar(description)}`);
    if (draft.keepCodingInstructions) lines.push('keep-coding-instructions: true');
    return `---\n${lines.join('\n')}\n---\n\n${draft.instructions.trim()}\n`;
}

/** The official levels. Anything else is `Invalid output style level`. */
export type OutputStyleLevel = 'project' | 'user';

export function isOutputStyleLevel(value: unknown): value is OutputStyleLevel {
    return value === 'project' || value === 'user';
}

/** The official `A1.join(".claude","output-styles")` -- relative, as sent. */
export const PROJECT_OUTPUT_STYLES_DIR = path.join('.claude', 'output-styles');

/** The official `W_`. */
export const OUTPUT_STYLE_FOLDER_CHANGED =
    "This project's output styles folder is a link to another location. Save at the User level instead.";

export class OutputStyleFolderChangedError extends Error {
    constructor() {
        super('The output styles folder changed while the style was being saved');
        this.name = 'OutputStyleFolderChangedError';
    }
}

/** The official `WO$`: `$HOME` shown as `~`. */
export function tildify(absolute: string, homedir = os.homedir()): string {
    if (absolute === homedir) return '~';
    return absolute.startsWith(homedir + path.sep) ? '~' + absolute.slice(homedir.length) : absolute;
}

/** This host's own folder, the official's fallback (`A1.join(q1(),"output-styles")`). */
export function hostUserOutputStylesDir(homedir = os.homedir()): string {
    return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(homedir, '.claude'), 'output-styles');
}

/**
 * The official's check on the CLI's `user_output_styles_dir`: absolute, already
 * normalised, and named `output-styles`. Anything else falls back to this
 * host's folder, because it is about to be written into.
 *
 * The field is **not** on the SDK's published `SDKControlInitializeResponse`
 * (sdk.d.ts:4282 lists `available_output_styles` and its neighbours, not this),
 * so it is read defensively off the raw response, exactly as the official does.
 */
export function userOutputStylesDirFrom(initResult: unknown, fallback = hostUserOutputStylesDir()): string {
    const dir = (initResult as { user_output_styles_dir?: unknown } | null | undefined)?.user_output_styles_dir;
    if (
        typeof dir === 'string' &&
        path.isAbsolute(dir) &&
        path.resolve(dir) === dir &&
        path.basename(dir) === 'output-styles'
    ) {
        return dir;
    }
    return fallback;
}

// ---------------------------------------------------------------------------
// The hardened write (the official `mv` / `Bf$` / `fe` / `yA0`)
// ---------------------------------------------------------------------------

/** The official `kA0`: create-only, never follow a symlink. */
const OPEN_FLAGS =
    fsSync.constants.O_WRONLY |
    fsSync.constants.O_CREAT |
    fsSync.constants.O_EXCL |
    (process.platform === 'win32' ? 0 : (fsSync.constants.O_NOFOLLOW ?? 0));

/** The official `fA0`: the rename failures worth retrying by unlinking first. */
const RETRYABLE_RENAME_ERRORS = new Set(['EEXIST', 'EPERM', 'EBUSY', 'EACCES']);

export interface DirIdentity {
    dev: number;
    ino: number;
}

const isEnoent = (error: unknown): boolean => (error as { code?: string } | null)?.code === 'ENOENT';
const errnoOf = (error: unknown): string | undefined => (error as { code?: string } | null)?.code;

/** The official `ID`. */
export const sameDir = (a: DirIdentity, b: DirIdentity): boolean => a.dev === b.dev && a.ino === b.ino;

/** The official `yA0`: the directory's identity, or the folder-changed error. */
async function dirIdentity(dir: string): Promise<DirIdentity> {
    const stat = await fs.lstat(dir);
    if (!stat.isDirectory()) throw new OutputStyleFolderChangedError();
    return { dev: stat.dev, ino: stat.ino };
}

/** The official `fe`: the directory and the file must still be the ones opened. */
async function assertUnchanged(dir: string, expected: DirIdentity, file: string, fileId: DirIdentity | undefined) {
    const now = await dirIdentity(dir).catch((error) => {
        if (isEnoent(error)) throw new OutputStyleFolderChangedError();
        throw error;
    });
    const fileStat = await fs.stat(file).catch(() => undefined);
    if (!sameDir(now, expected) || fileStat === undefined || fileId === undefined) {
        throw new OutputStyleFolderChangedError();
    }
    if (!sameDir({ dev: fileStat.dev, ino: fileStat.ino }, fileId)) {
        throw new OutputStyleFolderChangedError();
    }
}

/**
 * The official `mv($,Q,X,J)`: create `dir/name` exclusively, check the folder is
 * still the one we meant, then write. A failure unlinks what it created.
 */
export async function createExclusive(
    dir: string,
    name: string,
    content: string,
    guard?: DirIdentity
): Promise<DirIdentity> {
    const file = path.join(dir, name);
    const handle = await fs.open(file, OPEN_FLAGS);
    let fileId: DirIdentity | undefined;
    try {
        const stat = await handle.stat();
        fileId = { dev: stat.dev, ino: stat.ino };
        if (guard !== undefined) await assertUnchanged(dir, guard, file, fileId);
        await handle.writeFile(content, { encoding: 'utf8' });
        return fileId;
    } catch (error) {
        await handle.close();
        if (fileId !== undefined && !(error instanceof OutputStyleFolderChangedError)) {
            const current = await fs.stat(file).catch(() => undefined);
            if (current !== undefined && sameDir({ dev: current.dev, ino: current.ino }, fileId)) {
                await fs.unlink(file).catch(() => {});
            }
        }
        throw error;
    } finally {
        await handle.close().catch(() => {});
    }
}

/**
 * The official `Bf$`: write to a temp name in the same directory, then rename
 * over the target. This is the `replace: true` path -- the only way an existing
 * style file is ever overwritten.
 */
export async function replaceViaTemp(
    dir: string,
    name: string,
    tempName: string,
    content: string,
    guard?: DirIdentity
): Promise<void> {
    const tempPath = path.join(dir, tempName);
    const target = path.join(dir, name);
    let fileId: DirIdentity | undefined;
    let unlinked = false;
    try {
        fileId = await createExclusive(dir, tempName, content, guard);
        try {
            await fs.rename(tempPath, target);
        } catch (error) {
            if (isEnoent(error)) throw new OutputStyleFolderChangedError();
            const code = errnoOf(error);
            if (code === undefined || !RETRYABLE_RENAME_ERRORS.has(code)) throw error;
            if (guard !== undefined) await assertUnchanged(dir, guard, tempPath, fileId);
            await fs.unlink(target);
            unlinked = true;
            await fs.rename(tempPath, target);
        }
    } catch (error) {
        if (!unlinked) await fs.rm(tempPath, { force: true }).catch(() => {});
        throw error;
    }
    if (guard !== undefined) await assertUnchanged(dir, guard, target, fileId);
}

/**
 * The official `createOutputStyle`'s folder probe: neither `<cwd>/.claude` nor
 * the styles directory may be a symlink, and the styles directory's identity is
 * remembered so the write can prove it did not change underneath.
 */
export async function probeOutputStyleFolder(cwd: string, stylesDir: string): Promise<DirIdentity | undefined> {
    let identity: DirIdentity | undefined;
    for (const dir of [path.join(cwd, '.claude'), stylesDir]) {
        const stat = await fs.lstat(dir).catch((error) => {
            if (isEnoent(error)) return undefined;
            throw error;
        });
        if (stat?.isSymbolicLink()) throw new Error(OUTPUT_STYLE_FOLDER_CHANGED);
        if (dir === stylesDir && stat?.isDirectory()) identity = { dev: stat.dev, ino: stat.ino };
    }
    return identity;
}

/**
 * The official project-level containment check: after `mkdir`, the styles
 * directory's real path must sit inside the session's real cwd, and the folder
 * identity must be the one probed before.
 */
export async function assertProjectFolderSafe(
    cwd: string,
    stylesDir: string,
    before: DirIdentity | undefined
): Promise<DirIdentity> {
    const [realStyles, realCwd] = await Promise.all([fs.realpath(stylesDir), fs.realpath(cwd)]);
    const prefix = realCwd.endsWith(path.sep) ? realCwd : realCwd + path.sep;
    if (!realStyles.startsWith(prefix)) throw new Error(OUTPUT_STYLE_FOLDER_CHANGED);
    const after = await probeOutputStyleFolder(cwd, stylesDir);
    if (after === undefined || (before !== undefined && !sameDir(before, after))) {
        throw new Error(OUTPUT_STYLE_FOLDER_CHANGED);
    }
    return after;
}

/** `getSettings().effective.outputStyle`, but only when it really is a string. */
export function effectiveOutputStyle(settings: unknown): string | undefined {
    const effective = (settings as { effective?: unknown } | null | undefined)?.effective;
    const style = (effective as { outputStyle?: unknown } | null | undefined)?.outputStyle;
    return typeof style === 'string' ? style : undefined;
}

/** `initializationResult().available_output_styles`, checked before use. */
export function availableOutputStyles(initResult: unknown): string[] | undefined {
    const styles = (initResult as { available_output_styles?: unknown } | null | undefined)?.available_output_styles;
    return Array.isArray(styles) && styles.every((s) => typeof s === 'string') ? (styles as string[]) : undefined;
}
