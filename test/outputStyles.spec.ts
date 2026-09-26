/**
 * Step 29: output styles.
 *
 * Host: `src/services/claude/outputStyles.ts` (the ported `If$` / `Ef$` / `Cf$`
 * / `Pf$` / `userOutputStylesDir` and the hardened write) and
 * `ClaudeAgentService`'s three methods with their dispatcher cases.
 * Webview: `components/forge/outputStyle.ts`, whose three checks must stay the
 * same functions as the host's -- the table at the bottom is what enforces it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    OUTPUT_STYLE_FOLDER_CHANGED,
    PROJECT_OUTPUT_STYLES_DIR,
    assertProjectFolderSafe,
    availableOutputStyles,
    createExclusive,
    effectiveOutputStyle,
    hostUserOutputStylesDir,
    isOutputStyleLevel,
    outputStyleDescriptionProblem,
    outputStyleFileContent,
    outputStyleFileName,
    outputStyleNameProblem,
    probeOutputStyleFolder,
    replaceViaTemp,
    tildify,
    userOutputStylesDirFrom,
    yamlScalar,
} from '../src/services/claude/outputStyles';
import {
    outputStyleDescriptionProblem as webviewDescriptionProblem,
    outputStyleFileName as webviewFileName,
    outputStyleLabel,
    outputStyleNameProblem as webviewNameProblem,
    OUTPUT_STYLE_STEPS,
} from '../src/webview/src/components/forge/outputStyle';
import { validateSettingsWrite } from '../src/services/claude/settingsWhitelist';
import { ClaudeAgentService } from '../src/services/claude/ClaudeAgentService';

// ---------------------------------------------------------------------------
// The name, description and file name (`If$` / `Ef$` / `Cf$`)
// ---------------------------------------------------------------------------

describe('outputStyleNameProblem (the official `If$`)', () => {
    it('accepts an ordinary name', () => {
        expect(outputStyleNameProblem('Diagrams first')).toBeNull();
    });

    it('refuses an empty or blank name', () => {
        expect(outputStyleNameProblem('')).toBe('empty');
        expect(outputStyleNameProblem('   ')).toBe('empty');
    });

    it('refuses every path separator, so the name can only ever be a file in the chosen folder', () => {
        for (const bad of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) {
            expect(outputStyleNameProblem(bad)).toBe('characters');
        }
    });

    it('refuses traversal, because `..` starts with a dot', () => {
        expect(outputStyleNameProblem('..')).toBe('characters');
        expect(outputStyleNameProblem('../../etc/passwd')).toBe('characters');
        expect(outputStyleNameProblem('.hidden')).toBe('characters');
    });

    it('refuses control characters and Windows device names', () => {
        expect(outputStyleNameProblem('a\u0000b')).toBe('characters');
        expect(outputStyleNameProblem('a\u001fb')).toBe('characters');
        expect(outputStyleNameProblem('a\u007fb')).toBe('characters');
        for (const device of ['con', 'PRN', 'aux', 'nul', 'com1', 'LPT9', 'con.md']) {
            expect(outputStyleNameProblem(device)).toBe('characters');
        }
    });

    it('refuses `---`, which would close the front matter early', () => {
        expect(outputStyleNameProblem('a---b')).toBe('characters');
    });

    it('refuses a name already taken, case-insensitively', () => {
        expect(outputStyleNameProblem('explanatory', ['default', 'Explanatory'])).toBe('taken');
        expect(outputStyleNameProblem('  Explanatory  ', ['Explanatory'])).toBe('taken');
        expect(outputStyleNameProblem('Explanatory', ['default'])).toBeNull();
    });
});

describe('outputStyleDescriptionProblem (the official `Ef$`)', () => {
    it('only refuses a fence', () => {
        expect(outputStyleDescriptionProblem('')).toBeNull();
        expect(outputStyleDescriptionProblem('One line about it')).toBeNull();
        expect(outputStyleDescriptionProblem('before --- after')).toBe('fence');
    });
});

describe('outputStyleFileName (the official `Cf$`)', () => {
    it('is exactly the trimmed name plus .md', () => {
        expect(outputStyleFileName('  Diagrams first ')).toBe('Diagrams first.md');
    });
});

describe('isOutputStyleLevel', () => {
    it('accepts only the two official levels', () => {
        expect(isOutputStyleLevel('project')).toBe(true);
        expect(isOutputStyleLevel('user')).toBe(true);
        for (const bad of ['Project', 'flags', '', null, undefined, 1, {}]) {
            expect(isOutputStyleLevel(bad)).toBe(false);
        }
    });
});

// ---------------------------------------------------------------------------
// The file the wizard writes (`wf$` / `Pf$`)
// ---------------------------------------------------------------------------

describe('yamlScalar (the official `iA0` / `nA0`)', () => {
    it('leaves a plain scalar bare', () => {
        expect(yamlScalar('Diagrams first')).toBe('Diagrams first');
    });

    it('quotes anything that would parse as something else', () => {
        expect(yamlScalar('true')).toBe('"true"');
        expect(yamlScalar('No')).toBe('"No"');
        expect(yamlScalar('a: b')).toBe('"a: b"');
        expect(yamlScalar('1 leading digit')).toBe('"1 leading digit"');
        expect(yamlScalar(' padded ')).toBe('" padded "');
    });
});

describe('outputStyleFileContent (the official `Pf$`)', () => {
    it('writes name, description and the instructions', () => {
        expect(
            outputStyleFileContent({
                name: ' Diagrams first ',
                description: ' Lead with a diagram ',
                instructions: ' Start with a diagram. ',
            })
        ).toBe('---\nname: Diagrams first\ndescription: Lead with a diagram\n---\n\nStart with a diagram.\n');
    });

    it('omits an empty description and adds the coding-instructions key only when set', () => {
        expect(outputStyleFileContent({ name: 'Terse', description: '  ', instructions: 'x' })).toBe(
            '---\nname: Terse\n---\n\nx\n'
        );
        expect(
            outputStyleFileContent({ name: 'Terse', description: '', instructions: 'x', keepCodingInstructions: true })
        ).toBe('---\nname: Terse\nkeep-coding-instructions: true\n---\n\nx\n');
    });

    it('quotes a one-letter name, because the official plain-scalar shape needs two characters', () => {
        expect(outputStyleFileContent({ name: 'A', description: '', instructions: 'x' })).toBe(
            '---\nname: "A"\n---\n\nx\n'
        );
    });
});

// ---------------------------------------------------------------------------
// Where the file goes (`userOutputStylesDir`, `WO$`)
// ---------------------------------------------------------------------------

describe('userOutputStylesDirFrom', () => {
    const fallback = path.join(path.sep === '\\' ? 'C:\\home' : '/home', '.claude', 'output-styles');

    it('trusts an absolute, normalised path named output-styles', () => {
        const good = path.resolve(path.join(path.sep === '\\' ? 'C:\\u' : '/u', '.claude', 'output-styles'));
        expect(userOutputStylesDirFrom({ user_output_styles_dir: good }, fallback)).toBe(good);
    });

    it('falls back for anything else, because the folder is about to be written into', () => {
        for (const bad of [
            undefined,
            null,
            42,
            'relative/output-styles',
            path.resolve('/tmp/styles'),
            path.join(path.resolve('/tmp'), 'output-styles', '..', 'output-styles') + path.sep,
        ]) {
            expect(userOutputStylesDirFrom({ user_output_styles_dir: bad }, fallback)).toBe(fallback);
        }
        expect(userOutputStylesDirFrom(undefined, fallback)).toBe(fallback);
    });

    it('defaults to this host`s own folder', () => {
        expect(hostUserOutputStylesDir()).toContain('output-styles');
    });
});

describe('tildify (the official `WO$`)', () => {
    it('shows the home directory as ~ and leaves anything else alone', () => {
        const home = path.join(path.sep === '\\' ? 'C:\\Users\\x' : '/home/x');
        expect(tildify(home, home)).toBe('~');
        expect(tildify(path.join(home, '.claude'), home)).toBe('~' + path.sep + '.claude');
        expect(tildify(path.join(path.sep === '\\' ? 'D:\\other' : '/other'), home)).toContain('other');
    });
});

describe('PROJECT_OUTPUT_STYLES_DIR', () => {
    it('is relative, as the official sends it', () => {
        expect(path.isAbsolute(PROJECT_OUTPUT_STYLES_DIR)).toBe(false);
        expect(PROJECT_OUTPUT_STYLES_DIR).toBe(path.join('.claude', 'output-styles'));
    });
});

// ---------------------------------------------------------------------------
// The CLI's own answers, read defensively
// ---------------------------------------------------------------------------

describe('effectiveOutputStyle / availableOutputStyles', () => {
    it('only believes the right shapes', () => {
        expect(effectiveOutputStyle({ effective: { outputStyle: 'Explanatory' } })).toBe('Explanatory');
        expect(effectiveOutputStyle({ effective: { outputStyle: 7 } })).toBeUndefined();
        expect(effectiveOutputStyle({})).toBeUndefined();
        expect(effectiveOutputStyle(undefined)).toBeUndefined();

        expect(availableOutputStyles({ available_output_styles: ['a', 'b'] })).toEqual(['a', 'b']);
        expect(availableOutputStyles({ available_output_styles: ['a', 3] })).toBeUndefined();
        expect(availableOutputStyles({ available_output_styles: 'a' })).toBeUndefined();
        expect(availableOutputStyles(undefined)).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// The write itself (`mv` / `Bf$` / the folder probe)
// ---------------------------------------------------------------------------

describe('the hardened write', () => {
    let root: string;

    beforeAll(async () => {
        root = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-styles-'));
    });

    afterAll(async () => {
        await fsp.rm(root, { recursive: true, force: true });
    });

    it('createExclusive writes once and refuses a second time', async () => {
        const dir = path.join(root, 'excl');
        await fsp.mkdir(dir, { recursive: true });
        await createExclusive(dir, 'a.md', 'first');
        expect(await fsp.readFile(path.join(dir, 'a.md'), 'utf8')).toBe('first');
        await expect(createExclusive(dir, 'a.md', 'second')).rejects.toMatchObject({ code: 'EEXIST' });
        expect(await fsp.readFile(path.join(dir, 'a.md'), 'utf8')).toBe('first');
    });

    it('replaceViaTemp overwrites and leaves no temp file behind', async () => {
        const dir = path.join(root, 'replace');
        await fsp.mkdir(dir, { recursive: true });
        await createExclusive(dir, 'a.md', 'first');
        await replaceViaTemp(dir, 'a.md', '.tmp-1', 'second');
        expect(await fsp.readFile(path.join(dir, 'a.md'), 'utf8')).toBe('second');
        expect(await fsp.readdir(dir)).toEqual(['a.md']);
    });

    it('probeOutputStyleFolder tolerates a folder that is not there yet', async () => {
        const cwd = path.join(root, 'fresh');
        await fsp.mkdir(cwd, { recursive: true });
        expect(await probeOutputStyleFolder(cwd, path.join(cwd, PROJECT_OUTPUT_STYLES_DIR))).toBeUndefined();
    });

    it('assertProjectFolderSafe refuses a styles folder outside the session cwd', async () => {
        const cwd = path.join(root, 'proj');
        const outside = path.join(root, 'outside');
        await fsp.mkdir(cwd, { recursive: true });
        await fsp.mkdir(outside, { recursive: true });
        await expect(assertProjectFolderSafe(cwd, outside, undefined)).rejects.toThrow(OUTPUT_STYLE_FOLDER_CHANGED);
    });

    it('assertProjectFolderSafe accepts the real folder inside the cwd', async () => {
        const cwd = path.join(root, 'proj2');
        const styles = path.join(cwd, PROJECT_OUTPUT_STYLES_DIR);
        await fsp.mkdir(styles, { recursive: true });
        const before = await probeOutputStyleFolder(cwd, styles);
        await expect(assertProjectFolderSafe(cwd, styles, before)).resolves.toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// The three requests
// ---------------------------------------------------------------------------

const req = (s: any, request: Record<string, unknown>, channelId?: string) =>
    s.processRequest({ type: 'request', requestId: 'r1', channelId, request }, undefined as any);

function hostFor(
    options: {
        settings?: unknown;
        initResult?: unknown;
        outputStyles?: string[];
        cwd?: string;
        reload?: () => Promise<unknown>;
    } = {}
) {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() };
    const reloadOutputStyles = vi.fn(options.reload ?? (async () => ({ available_output_styles: ['default'] })));
    const query = {
        getSettings: async () => options.settings ?? { effective: {} },
        initializationResult: async () => options.initResult ?? {},
        reloadOutputStyles,
    };
    const s = new (ClaudeAgentService as any)(log, {}, {}, {}, {}, {}, {}, {}, {}, {});
    s.channels = new Map([['ch1', { query, cwd: options.cwd, outputStyles: options.outputStyles }]]);
    return { s, reloadOutputStyles, log };
}

describe('get_output_style', () => {
    it('omits outputStyle unless the CLI reports a string', async () => {
        const { s } = hostFor({ settings: { effective: { outputStyle: 7 } }, initResult: { available_output_styles: ['default'] } });
        const out = await req(s, { type: 'get_output_style' }, 'ch1');
        expect(out).toEqual({ type: 'get_output_style_response', availableStyles: ['default'] });
        expect('outputStyle' in out).toBe(false);
    });

    it('sends the style the CLI reports', async () => {
        const { s } = hostFor({
            settings: { effective: { outputStyle: 'Explanatory' } },
            initResult: { available_output_styles: ['default', 'Explanatory'] },
        });
        expect(await req(s, { type: 'get_output_style' }, 'ch1')).toEqual({
            type: 'get_output_style_response',
            outputStyle: 'Explanatory',
            availableStyles: ['default', 'Explanatory'],
        });
    });

    it('prefers the list a create reloaded over the session`s initial one', async () => {
        const { s } = hostFor({
            initResult: { available_output_styles: ['default'] },
            outputStyles: ['default', 'Mine'],
        });
        expect((await req(s, { type: 'get_output_style' }, 'ch1')).availableStyles).toEqual(['default', 'Mine']);
    });

    it('is channel-scoped', async () => {
        const { s } = hostFor();
        await expect(req(s, { type: 'get_output_style' }, undefined)).rejects.toThrow();
        await expect(req(s, { type: 'get_output_style' }, 'nope')).rejects.toThrow();
    });
});

describe('get_output_style_locations', () => {
    it('sends the relative project path and the tildified user path', async () => {
        const home = os.homedir();
        const dir = path.join(home, '.claude', 'output-styles');
        const { s } = hostFor({ initResult: { user_output_styles_dir: dir } });
        expect(await req(s, { type: 'get_output_style_locations' }, 'ch1')).toEqual({
            type: 'get_output_style_locations_response',
            project: PROJECT_OUTPUT_STYLES_DIR,
            user: tildify(dir),
        });
    });

    it('is channel-scoped', async () => {
        const { s } = hostFor();
        await expect(req(s, { type: 'get_output_style_locations' }, undefined)).rejects.toThrow();
    });
});

describe('create_output_style', () => {
    let root: string;

    beforeAll(async () => {
        root = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-create-'));
    });

    afterAll(async () => {
        await fsp.rm(root, { recursive: true, force: true });
    });

    const draft = { name: 'Diagrams first', description: 'Lead with a diagram', instructions: 'Start with one.' };

    it('writes the file under the project folder and adopts the reloaded list', async () => {
        const cwd = await fsp.mkdtemp(path.join(root, 'ok-'));
        const { s, reloadOutputStyles } = hostFor({
            cwd,
            reload: async () => ({ available_output_styles: ['default', 'Diagrams first'] }),
        });
        const out = await req(s, { type: 'create_output_style', draft, level: 'project' }, 'ch1');
        const file = path.join(cwd, PROJECT_OUTPUT_STYLES_DIR, 'Diagrams first.md');
        expect(out).toEqual({
            type: 'create_output_style_response',
            result: { kind: 'saved', filePath: file, availableStyles: ['default', 'Diagrams first'] },
        });
        expect(await fsp.readFile(file, 'utf8')).toBe(outputStyleFileContent(draft));
        expect(reloadOutputStyles).toHaveBeenCalledTimes(1);
        expect(s.channels.get('ch1').outputStyles).toEqual(['default', 'Diagrams first']);
    });

    it('answers {kind:"exists"} instead of overwriting, and overwrites only with replace', async () => {
        const cwd = await fsp.mkdtemp(path.join(root, 'exists-'));
        const { s } = hostFor({ cwd });
        await req(s, { type: 'create_output_style', draft, level: 'project' }, 'ch1');
        const again = await req(s, { type: 'create_output_style', draft, level: 'project' }, 'ch1');
        expect(again).toEqual({ type: 'create_output_style_response', result: { kind: 'exists' } });

        const changed = { ...draft, instructions: 'Different.' };
        const replaced = await req(
            s,
            { type: 'create_output_style', draft: changed, level: 'project', replace: true },
            'ch1'
        );
        expect(replaced.result.kind).toBe('saved');
        const file = path.join(cwd, PROJECT_OUTPUT_STYLES_DIR, 'Diagrams first.md');
        expect(await fsp.readFile(file, 'utf8')).toBe(outputStyleFileContent(changed));
        // The temp file the replace used is gone.
        expect(await fsp.readdir(path.dirname(file))).toEqual(['Diagrams first.md']);
    });

    it('keeps the style even when the CLI cannot reload, and says the list is missing', async () => {
        const cwd = await fsp.mkdtemp(path.join(root, 'noreload-'));
        const { s, log } = hostFor({ cwd, reload: async () => ({}) });
        const out = await req(s, { type: 'create_output_style', draft, level: 'project' }, 'ch1');
        expect(out.result.kind).toBe('saved');
        expect(out.result.availableStyles).toBeUndefined();
        expect(log.warn).toHaveBeenCalled();
    });

    it('refuses a name that is not a bare file name (B3)', async () => {
        const cwd = await fsp.mkdtemp(path.join(root, 'bad-'));
        const { s } = hostFor({ cwd });
        for (const name of ['', '   ', '..', '../escape', '.hidden', 'a/b', 'a\\b', 'con', 'a---b', 'a\u0000b']) {
            await expect(
                req(s, { type: 'create_output_style', draft: { ...draft, name }, level: 'project' }, 'ch1')
            ).rejects.toThrow('Invalid output style name');
        }
        // Nothing was created by any of them.
        await expect(fsp.readdir(path.join(cwd, PROJECT_OUTPUT_STYLES_DIR))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('refuses a malformed draft, a fenced description and a bad level', async () => {
        const cwd = await fsp.mkdtemp(path.join(root, 'shape-'));
        const { s } = hostFor({ cwd });
        for (const bad of [undefined, null, 'x', 42, {}, { name: 'a' }, { name: 'a', description: 'b' }, { name: 1, description: 'b', instructions: 'c' }]) {
            await expect(
                req(s, { type: 'create_output_style', draft: bad, level: 'project' }, 'ch1')
            ).rejects.toThrow('Invalid output style name');
        }
        await expect(
            req(s, { type: 'create_output_style', draft: { ...draft, description: 'a --- b' }, level: 'project' }, 'ch1')
        ).rejects.toThrow('Invalid output style description');
        for (const level of [undefined, null, 'Project', 'flags', 1]) {
            await expect(req(s, { type: 'create_output_style', draft, level }, 'ch1')).rejects.toThrow(
                'Invalid output style level'
            );
        }
    });

    it('is channel-scoped', async () => {
        const { s } = hostFor();
        await expect(req(s, { type: 'create_output_style', draft, level: 'project' }, undefined)).rejects.toThrow();
    });
});

// ---------------------------------------------------------------------------
// `outputStyle` on the settings whitelist (step 11's gate)
// ---------------------------------------------------------------------------

describe('apply_settings {outputStyle}', () => {
    it('is accepted only at the localSettings layer', () => {
        expect(validateSettingsWrite({ outputStyle: 'Explanatory' }, undefined, 'localSettings')).toBe('localSettings');
    });

    it('is refused anywhere else, and refuses a non-string', () => {
        expect(() => validateSettingsWrite({ outputStyle: 'Explanatory' })).toThrow('unexpected value or target');
        expect(() => validateSettingsWrite({ outputStyle: 'Explanatory' }, undefined, 'userSettings')).toThrow(
            'unexpected value or target'
        );
        expect(() => validateSettingsWrite({ outputStyle: 'Explanatory' }, true)).toThrow('unexpected value or target');
        expect(() => validateSettingsWrite({ outputStyle: null }, undefined, 'localSettings')).toThrow(
            'unexpected value or target'
        );
        expect(() => validateSettingsWrite({ outputStyle: 7 }, undefined, 'localSettings')).toThrow(
            'unexpected value or target'
        );
    });
});

// ---------------------------------------------------------------------------
// The two sides of the wire must stay the same functions
// ---------------------------------------------------------------------------

describe('the webview checks and the host checks agree', () => {
    const names = [
        '',
        '   ',
        'Diagrams first',
        '..',
        '../escape',
        '.hidden',
        'a/b',
        'a\\b',
        'a:b',
        'a*b',
        'a?b',
        'a"b',
        'a<b',
        'a>b',
        'a|b',
        'con',
        'LPT9',
        'nul.md',
        'a---b',
        'a\u0000b',
        'a\u001fb',
        'a\u007fb',
        '  Explanatory  ',
        'explanatory',
    ];
    const existing = ['default', 'Explanatory'];

    it('on every name', () => {
        for (const name of names) {
            expect([name, webviewNameProblem(name, existing)]).toEqual([name, outputStyleNameProblem(name, existing)]);
            expect([name, webviewNameProblem(name)]).toEqual([name, outputStyleNameProblem(name)]);
        }
    });

    it('on the description and the file name', () => {
        for (const description of ['', 'plain', 'a --- b', '--', '-----']) {
            expect(webviewDescriptionProblem(description)).toBe(outputStyleDescriptionProblem(description));
        }
        for (const name of ['a', '  a  ', 'Diagrams first']) {
            expect(webviewFileName(name)).toBe(outputStyleFileName(name));
        }
    });
});

describe('outputStyleLabel (the official `$85`)', () => {
    it('leaves an ordinary name alone', () => {
        expect(outputStyleLabel('Diagrams first')).toBe('Diagrams first');
    });

    it('spells out invisible code points, so a style file cannot repaint the row', () => {
        expect(outputStyleLabel('a\u200bb')).toBe('a\\u{200b}b');
        expect(outputStyleLabel('a\u202eb')).toBe('a\\u{202e}b');
        expect(outputStyleLabel('a\u00a0b')).toBe('a\\u{a0}b');
    });

    it('makes leading, trailing and doubled spaces visible', () => {
        expect(outputStyleLabel(' a')).toBe('\\u{20}a');
        expect(outputStyleLabel('a ')).toBe('a\\u{20}');
        expect(outputStyleLabel('a  b')).toBe('a\\u{20}\\u{20}b');
    });
});

describe('the wizard`s steps', () => {
    it('are the official `lo`, in order', () => {
        expect(OUTPUT_STYLE_STEPS).toEqual(['name', 'description', 'instructions', 'save']);
    });
});

describe('symlinked folders', () => {
    it('refuses a .claude that is a link', async () => {
        const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-link-'));
        try {
            const cwd = path.join(root, 'proj');
            const real = path.join(root, 'elsewhere');
            await fsp.mkdir(cwd, { recursive: true });
            await fsp.mkdir(real, { recursive: true });
            try {
                await fsp.symlink(real, path.join(cwd, '.claude'), 'dir');
            } catch {
                // Windows without developer mode cannot make links; the check
                // itself is exercised by the "outside the cwd" case above.
                return;
            }
            await expect(
                probeOutputStyleFolder(cwd, path.join(cwd, PROJECT_OUTPUT_STYLES_DIR))
            ).rejects.toThrow(OUTPUT_STYLE_FOLDER_CHANGED);
        } finally {
            await fsp.rm(root, { recursive: true, force: true });
        }
    });
});
