/**
 * Creating skills, agents and MCP servers from the Settings page.
 *
 * The flows are native prompts; what is worth a test is what they write --
 * files the CLI must accept -- and the request that starts them, which is on
 * the endpoint actions' rule: the webview names one of four actions and the
 * host names the command.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    addToMcpJson,
    agentMarkdown,
    buildMcpServer,
    commandMarkdown,
    importSkillFolder,
    listItems,
    parseEnvPairs,
    parseHeader,
    readFrontmatter,
    skillMarkdown,
    splitCommandLine,
    validateCommandLine,
    validateDescription,
    validateItemName,
    validateMcpName,
    validateServerUrl,
    writeItem,
} from '../src/services/customizations/customizations';
import {
    FORGE_ACTION_COMMANDS,
    handleListForgeItems,
    handleRunForgeAction,
} from '../src/services/claude/handlers/handlers';
import * as vscode from 'vscode';

let tmp: string;
let home: string;
let repo: string;
const savedHome = process.env.CLAUDE_CONFIG_DIR;

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-custom-'));
    home = path.join(tmp, 'home');
    repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    process.env.CLAUDE_CONFIG_DIR = home;
});

afterEach(() => {
    if (savedHome === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = savedHome;
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe('names and descriptions', () => {
    it('takes lowercase, digits and hyphens, and refuses a taken one', () => {
        expect(validateItemName('release-notes')).toBeUndefined();
        expect(validateItemName('Release Notes')).toMatch(/lowercase/);
        expect(validateItemName('../escape')).toMatch(/lowercase/);
        expect(validateItemName('')).toMatch(/required/);
        expect(validateItemName('a'.repeat(65))).toMatch(/64/);
        expect(validateItemName('dup', new Set(['dup']))).toMatch(/already exists/);
    });

    it('wants one real sentence as the description', () => {
        expect(validateDescription('Drafts release notes.')).toBeUndefined();
        expect(validateDescription('short')).toBeDefined();
        expect(validateDescription('two\nlines here please')).toBeDefined();
    });
});

describe('what is written is what the CLI reads', () => {
    it('a skill: SKILL.md with name and description frontmatter', () => {
        const text = skillMarkdown('release-notes', 'Drafts release notes: from merged PRs.');
        expect(readFrontmatter(text)).toEqual({ name: 'release-notes', description: 'Drafts release notes: from merged PRs.' });
        expect(text).toContain('# Release Notes');
    });

    it('an agent: frontmatter, an optional tools line, and a prompt body', () => {
        expect(agentMarkdown('code-reviewer', 'Reviews diffs for bugs.')).not.toContain('tools:');
        const scoped = agentMarkdown('code-reviewer', 'Reviews diffs for bugs.', ['Read', 'Grep']);
        expect(scoped).toContain('tools: Read, Grep');
        expect(readFrontmatter(scoped).name).toBe('code-reviewer');
    });

    it('writes into the scope directory and lists it back, project first', () => {
        writeItem('skills', path.join(home, 'skills'), 'personal', skillMarkdown('personal', 'A personal skill here.'));
        writeItem('skills', path.join(repo, '.claude', 'skills'), 'shared', skillMarkdown('shared', 'A shared project skill.'));
        writeItem('agents', path.join(repo, '.claude', 'agents'), 'helper', agentMarkdown('helper', 'Helps with the work.'));
        expect(listItems('skills', repo).map((i) => [i.name, i.scope])).toEqual([['shared', 'project'], ['personal', 'user']]);
        expect(listItems('agents', repo)).toMatchObject([{ name: 'helper', scope: 'project', description: 'Helps with the work.' }]);
    });

    it('never overwrites, and never writes outside the directory', () => {
        const dir = path.join(home, 'skills');
        writeItem('skills', dir, 'once', skillMarkdown('once', 'The first and only.'));
        expect(() => writeItem('skills', dir, 'once', 'x')).toThrow(/already exists/);
        expect(() => writeItem('skills', dir, '../out', 'x')).toThrow(/Invalid name/);
    });

    it('a slash command: description and argument hint frontmatter, the prompt as body', () => {
        const text = commandMarkdown('review-pr', 'Reviews a pull request: bugs first.', '[pr-number]');
        expect(readFrontmatter(text)).toEqual({ description: 'Reviews a pull request: bugs first.', 'argument-hint': '[pr-number]' });
        expect(text).toContain('$ARGUMENTS');
        expect(commandMarkdown('tidy', 'Tidies the imports in a file.')).not.toContain('argument-hint');
    });

    it('lists commands, sub-folders as folder:name, falling back to the first line', () => {
        const user = path.join(home, 'commands');
        writeItem('commands', user, 'review-pr', commandMarkdown('review-pr', 'Reviews a pull request.', '[pr]'));
        fs.mkdirSync(path.join(repo, '.claude', 'commands', 'frontend'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.claude', 'commands', 'frontend', 'component.md'), '# Build a component\n\nMake it.');
        fs.writeFileSync(path.join(repo, '.claude', 'commands', 'notes.txt'), 'not a command');
        expect(listItems('commands', repo)).toMatchObject([
            { name: 'frontend:component', scope: 'project', description: 'Build a component' },
            { name: 'review-pr', scope: 'user', description: 'Reviews a pull request.', argumentHint: '[pr]' },
        ]);
        expect(() => writeItem('commands', user, 'review-pr', 'x')).toThrow(/already exists/);
        expect(() => writeItem('commands', user, '../evil', 'x')).toThrow(/Invalid name/);
    });

    it('a fresh install lists nothing rather than failing', () => {
        expect(listItems('skills', undefined)).toEqual([]);
        expect(listItems('agents', path.join(tmp, 'missing'))).toEqual([]);
    });

    it('imports a skill folder, and refuses one without SKILL.md', () => {
        const src = path.join(tmp, 'downloads', 'pdf-tools');
        fs.mkdirSync(path.join(src, 'scripts'), { recursive: true });
        fs.writeFileSync(path.join(src, 'SKILL.md'), skillMarkdown('pdf-tools', 'Works with PDF files.'));
        fs.writeFileSync(path.join(src, 'scripts', 'run.py'), 'print(1)');
        const file = importSkillFolder(src, path.join(home, 'skills'));
        expect(fs.existsSync(file)).toBe(true);
        expect(fs.existsSync(path.join(home, 'skills', 'pdf-tools', 'scripts', 'run.py'))).toBe(true);
        expect(() => importSkillFolder(src, path.join(home, 'skills'))).toThrow(/already exists/);
        expect(() => importSkillFolder(path.join(tmp, 'downloads'), path.join(home, 'skills'))).toThrow(/SKILL\.md/);
    });
});

describe('MCP servers', () => {
    it('splits a command line into an argv without a shell', () => {
        expect(splitCommandLine('npx -y @modelcontextprotocol/server-filesystem "/My Projects"')).toEqual([
            'npx', '-y', '@modelcontextprotocol/server-filesystem', '/My Projects',
        ]);
        expect(splitCommandLine("node 'a b' c")).toEqual(['node', 'a b', 'c']);
        expect(() => splitCommandLine('node "open')).toThrow(/quote/);
        expect(validateCommandLine('   ')).toBeDefined();
    });

    it('validates names, URLs, variables and headers', () => {
        expect(validateMcpName('memory')).toBeUndefined();
        expect(validateMcpName('has space')).toBeDefined();
        expect(validateServerUrl('https://mcp.example.com/mcp')).toBeUndefined();
        expect(validateServerUrl('ftp://x')).toBeDefined();
        expect(parseEnvPairs('API_KEY=abc, MODE=fast')).toEqual({ API_KEY: 'abc', MODE: 'fast' });
        expect(() => parseEnvPairs('nope')).toThrow();
        expect(parseHeader('Authorization: Bearer t')).toEqual({ Authorization: 'Bearer t' });
        expect(parseHeader('')).toEqual({});
        expect(() => parseHeader('no colon')).toThrow();
    });

    it('builds the config the CLI reads', () => {
        expect(buildMcpServer('stdio', 'npx -y server-memory', { env: { K: 'v' } })).toEqual({
            type: 'stdio', command: 'npx', args: ['-y', 'server-memory'], env: { K: 'v' },
        });
        expect(buildMcpServer('http', ' https://x.dev/mcp ', { headers: {} })).toEqual({ type: 'http', url: 'https://x.dev/mcp' });
    });

    it('adds to .mcp.json, keeping what is there, and refuses a duplicate', () => {
        const file = path.join(repo, '.mcp.json');
        fs.writeFileSync(file, JSON.stringify({ mcpServers: { old: { type: 'http', url: 'https://a' } }, other: 1 }));
        addToMcpJson(file, 'memory', buildMcpServer('stdio', 'npx -y server-memory'));
        const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
        expect(Object.keys(doc.mcpServers)).toEqual(['old', 'memory']);
        expect(doc.other).toBe(1);
        expect(() => addToMcpJson(file, 'memory', buildMcpServer('http', 'https://b'))).toThrow(/already/);
    });

    it('creates .mcp.json when there is none, and will not touch a broken one', () => {
        const file = path.join(repo, '.mcp.json');
        addToMcpJson(file, 'docs', buildMcpServer('http', 'https://docs.example.com/mcp'));
        expect(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers.docs.url).toBe('https://docs.example.com/mcp');
        fs.writeFileSync(file, '{ nope');
        expect(() => addToMcpJson(file, 'x', buildMcpServer('http', 'https://x'))).toThrow(/not valid JSON/);
    });
});

describe('the requests', () => {
    const context = () => ({
        logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        workspaceService: { getDefaultWorkspaceFolder: () => ({ uri: { fsPath: repo } }) },
    }) as any;

    it('maps each action to its command and runs it', async () => {
        const exec = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
        for (const [action, command] of Object.entries(FORGE_ACTION_COMMANDS)) {
            await expect(handleRunForgeAction({ type: 'run_forge_action', action } as any, context()))
                .resolves.toEqual({ type: 'run_forge_action_response' });
            expect(exec).toHaveBeenLastCalledWith(command);
        }
        exec.mockRestore();
    });

    it('refuses anything else, before any command runs (B3)', async () => {
        const exec = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
        for (const action of ['workbench.action.terminal.new', 'toString', '__proto__', '', undefined]) {
            await expect(handleRunForgeAction({ type: 'run_forge_action', action } as any, context())).rejects.toThrow(/Unknown Forge action/);
        }
        expect(exec).not.toHaveBeenCalled();
        exec.mockRestore();
    });

    it('lists by kind, and refuses an unknown kind', async () => {
        writeItem('agents', path.join(repo, '.claude', 'agents'), 'helper', agentMarkdown('helper', 'Helps with the work.'));
        const out = await handleListForgeItems({ type: 'list_forge_items', kind: 'agents' }, context());
        expect(out.items.map((i) => i.name)).toEqual(['helper']);
        writeItem('commands', path.join(repo, '.claude', 'commands'), 'ship', commandMarkdown('ship', 'Ships the current branch.'));
        const commands = await handleListForgeItems({ type: 'list_forge_items', kind: 'commands' }, context());
        expect(commands.items.map((i) => i.name)).toEqual(['ship']);
        await expect(handleListForgeItems({ type: 'list_forge_items', kind: 'hooks' } as any, context())).rejects.toThrow(/unknown kind/);
    });
});
