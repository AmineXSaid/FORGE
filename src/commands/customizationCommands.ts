/**
 * The guided flows behind "Create skill", "Add skill from folder", "Add MCP
 * server" and "Create agent".
 *
 * Each is a few native prompts at the top of the window, the same shape as
 * "Add endpoint": no form to learn, every answer validated as it is typed, a
 * sensible default pre-filled, and the file opened at the end so the next step
 * is obvious. Nothing here invents a format -- the output is exactly what the
 * CLI reads (see `services/customizations/customizations.ts`).
 */
import * as vscode from 'vscode';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import {
    addToMcpJson,
    agentMarkdown,
    buildMcpServer,
    commandMarkdown,
    importSkillFolder,
    itemsDir,
    listItems,
    parseEnvPairs,
    parseHeader,
    skillMarkdown,
    validateCommandLine,
    validateDescription,
    validateItemName,
    validateMcpName,
    validateServerUrl,
    writeItem,
    type ItemKind,
    type ItemScope,
    type McpServerConfig,
    type McpTransport,
} from '../services/customizations/customizations';

export interface CustomizationDeps {
    /** The bundled CLI, for `claude mcp add-json`. Throws where there is none. */
    resolveClaudeExecutable(): string;
    log(message: string): void;
}

function workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** "This project" first when there is one; the user scope otherwise. */
async function pickScope(kind: ItemKind, title: string): Promise<ItemScope | undefined> {
    const root = workspaceRoot();
    if (!root) return 'user';
    const picked = await vscode.window.showQuickPick(
        [
            {
                label: '$(repo) This project',
                description: `.claude/${kind}`,
                detail: 'Travels with the repository, so everyone who opens it gets it.',
                scope: 'project' as ItemScope,
            },
            {
                label: '$(account) All my projects',
                description: `~/.claude/${kind}`,
                detail: 'Only on this machine, in every workspace.',
                scope: 'user' as ItemScope,
            },
        ],
        { title, placeHolder: 'Where should it live?' },
    );
    return picked?.scope;
}

async function openFile(file: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.window.showTextDocument(doc, { preview: false });
}

/** "Forge: Create Skill": name, what it is for, where -- then SKILL.md opens. */
export async function createSkill(): Promise<void> {
    const taken = new Set(listItems('skills', workspaceRoot()).map((i) => i.name));
    const name = await vscode.window.showInputBox({
        title: 'Create skill (1/3): name',
        prompt: 'Lowercase letters, digits and hyphens. This is how the skill is named everywhere.',
        placeHolder: 'release-notes',
        ignoreFocusOut: true,
        validateInput: (v) => validateItemName(v, taken),
    });
    if (!name) return;

    const description = await vscode.window.showInputBox({
        title: 'Create skill (2/3): when to use it',
        prompt: 'One sentence. The model reads this to decide when the skill applies.',
        placeHolder: 'Drafts release notes from the merged pull requests since the last tag.',
        ignoreFocusOut: true,
        validateInput: validateDescription,
    });
    if (!description) return;

    const scope = await pickScope('skills', 'Create skill (3/3): where');
    if (!scope) return;
    const dir = itemsDir('skills', scope, workspaceRoot());
    if (!dir) return;

    const file = writeItem('skills', dir, name.trim(), skillMarkdown(name.trim(), description));
    await openFile(file);
    void vscode.window.showInformationMessage(
        `Forge: skill "${name.trim()}" created. Write its instructions, and Forge picks it up in the next conversation.`,
    );
}

/** "Forge: Add Skill from Folder": pick a folder with a SKILL.md, copy it in. */
export async function addSkillFromFolder(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
        title: 'Add a skill: choose its folder (the one holding SKILL.md)',
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Add skill',
    });
    const source = picked?.[0]?.fsPath;
    if (!source) return;

    const scope = await pickScope('skills', 'Add skill: where');
    if (!scope) return;
    const dir = itemsDir('skills', scope, workspaceRoot());
    if (!dir) return;

    const file = importSkillFolder(source, dir);
    await openFile(file);
    void vscode.window.showInformationMessage(`Forge: skill added from ${path.basename(source)}.`);
}

/** "Forge: Create Agent" for the CLI's subagents: name, when to use it, tools, where. */
export async function createSubagent(): Promise<void> {
    const taken = new Set(listItems('agents', workspaceRoot()).map((i) => i.name));
    const name = await vscode.window.showInputBox({
        title: 'Create agent (1/4): name',
        prompt: 'Lowercase letters, digits and hyphens.',
        placeHolder: 'code-reviewer',
        ignoreFocusOut: true,
        validateInput: (v) => validateItemName(v, taken),
    });
    if (!name) return;

    const description = await vscode.window.showInputBox({
        title: 'Create agent (2/4): when to use it',
        prompt: 'One sentence. The main conversation reads this to decide when to hand work to the agent.',
        placeHolder: 'Reviews a diff for bugs and missing tests before it is committed.',
        ignoreFocusOut: true,
        validateInput: validateDescription,
    });
    if (!description) return;

    const TOOLSETS = [
        { label: 'Every tool', detail: 'Inherits everything the main conversation can use.', tools: [] as string[] },
        { label: 'Read-only', detail: 'Read, Grep, Glob: looks, never changes anything.', tools: ['Read', 'Grep', 'Glob'] },
        { label: 'Read and edit', detail: 'Read, Grep, Glob, Edit, Write.', tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write'] },
        { label: 'Read, edit and run', detail: 'Adds Bash, for agents that build and test.', tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'] },
    ];
    const toolset = await vscode.window.showQuickPick(TOOLSETS, {
        title: 'Create agent (3/4): what it may use',
        placeHolder: 'Pick the smallest set that does the job',
    });
    if (!toolset) return;

    const scope = await pickScope('agents', 'Create agent (4/4): where');
    if (!scope) return;
    const dir = itemsDir('agents', scope, workspaceRoot());
    if (!dir) return;

    const file = writeItem('agents', dir, name.trim(), agentMarkdown(name.trim(), description, toolset.tools));
    await openFile(file);
    void vscode.window.showInformationMessage(
        `Forge: agent "${name.trim()}" created. Write its instructions; the next conversation can hand work to it.`,
    );
}

/**
 * "Forge: Create Slash Command": name, what it does, what it takes, where --
 * then the .md opens on its prompt. Typing `/name` in the chat sends that
 * prompt, with what follows the command in place of `$ARGUMENTS`.
 */
export async function createSlashCommand(): Promise<void> {
    const taken = new Set(listItems('commands', workspaceRoot()).map((i) => i.name));
    const name = await vscode.window.showInputBox({
        title: 'Create slash command (1/4): name',
        prompt: 'Lowercase letters, digits and hyphens. You will type it as /name.',
        placeHolder: 'review-pr',
        ignoreFocusOut: true,
        validateInput: (v) => validateItemName(v.replace(/^\//, ''), taken),
    });
    if (!name) return;
    const commandName = name.trim().replace(/^\//, '');

    const description = await vscode.window.showInputBox({
        title: 'Create slash command (2/4): what it does',
        prompt: 'One sentence, shown beside the command in the / menu.',
        placeHolder: 'Reviews a pull request for bugs and missing tests.',
        ignoreFocusOut: true,
        validateInput: validateDescription,
    });
    if (!description) return;

    const argumentHint = await vscode.window.showInputBox({
        title: 'Create slash command (3/4): what it takes (optional)',
        prompt: 'A hint shown after the name, e.g. [pr-number]. Leave empty if it takes nothing.',
        placeHolder: '[pr-number]',
        ignoreFocusOut: true,
        validateInput: (v) => (/\r|\n/.test(v) ? 'One line, please.' : v.length > 120 ? 'Keep it short.' : undefined),
    });
    if (argumentHint === undefined) return;

    const scope = await pickScope('commands', 'Create slash command (4/4): where');
    if (!scope) return;
    const dir = itemsDir('commands', scope, workspaceRoot());
    if (!dir) return;

    const file = writeItem('commands', dir, commandName, commandMarkdown(commandName, description, argumentHint));
    await openFile(file);
    void vscode.window.showInformationMessage(
        `Forge: /${commandName} created. Write its prompt; it is in the / menu of the next conversation.`,
    );
}

type McpScope = 'project' | 'local' | 'user';

/** Run `claude mcp add-json` with a fixed argv: no shell, nothing the webview chose. */
function cliAddJson(binary: string, scope: McpScope, name: string, server: McpServerConfig, cwd: string | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
        execFile(
            binary,
            ['mcp', 'add-json', '--scope', scope, name, JSON.stringify(server)],
            { cwd: cwd ?? process.cwd(), timeout: 20_000, windowsHide: true },
            (error, _stdout, stderr) => {
                if (error) reject(new Error((stderr || error.message).trim()));
                else resolve();
            },
        );
    });
}

/**
 * "Forge: Add MCP Server": how it runs, its name, the command or URL, an
 * optional variable or header, and who gets it. Project scope is written to
 * `.mcp.json` directly -- a plain file a team commits. The two private scopes
 * live inside the CLI's own config, so the CLI writes them (`mcp add-json`).
 */
export async function addMcpServer(deps: CustomizationDeps): Promise<boolean> {
    const transport = await vscode.window.showQuickPick(
        [
            { label: '$(terminal) Local command', detail: 'A program Forge starts, e.g. npx -y @modelcontextprotocol/server-memory', value: 'stdio' as McpTransport },
            { label: '$(globe) Remote server (HTTP)', detail: 'A streamable HTTP endpoint, e.g. https://mcp.example.com/mcp', value: 'http' as McpTransport },
            { label: '$(broadcast) Remote server (SSE)', detail: 'An older server-sent-events endpoint.', value: 'sse' as McpTransport },
        ],
        { title: 'Add MCP server (1/4): how does it run?', placeHolder: 'Pick one' },
    );
    if (!transport) return false;

    const name = await vscode.window.showInputBox({
        title: 'Add MCP server (2/4): name',
        prompt: 'How the server and its tools are named in conversations.',
        placeHolder: transport.value === 'stdio' ? 'memory' : 'docs',
        ignoreFocusOut: true,
        validateInput: (v) => validateMcpName(v),
    });
    if (!name) return false;

    const target = await vscode.window.showInputBox({
        title: transport.value === 'stdio' ? 'Add MCP server (3/4): command' : 'Add MCP server (3/4): URL',
        prompt: transport.value === 'stdio'
            ? 'The command that starts it, with its arguments. Quotes keep a spaced argument together.'
            : 'The server’s full URL.',
        placeHolder: transport.value === 'stdio' ? 'npx -y @modelcontextprotocol/server-memory' : 'https://mcp.example.com/mcp',
        ignoreFocusOut: true,
        validateInput: transport.value === 'stdio' ? validateCommandLine : validateServerUrl,
    });
    if (!target) return false;

    const extraRaw = await vscode.window.showInputBox({
        title: transport.value === 'stdio' ? 'Add MCP server: environment (optional)' : 'Add MCP server: header (optional)',
        prompt: transport.value === 'stdio'
            ? 'KEY=value pairs, comma separated. Leave empty for none.'
            : 'One header as Name: value, e.g. Authorization: Bearer <token>. Leave empty for none.',
        ignoreFocusOut: true,
        password: transport.value !== 'stdio',
        validateInput: (v) => {
            try {
                if (transport.value === 'stdio') parseEnvPairs(v);
                else parseHeader(v);
                return undefined;
            } catch (e) {
                return e instanceof Error ? e.message : String(e);
            }
        },
    });
    if (extraRaw === undefined) return false;

    const root = workspaceRoot();
    const scopes = [
        ...(root
            ? [
                { label: '$(repo) This project, shared', description: '.mcp.json', detail: 'Committed with the repository; teammates are asked to approve it.', value: 'project' as McpScope },
                { label: '$(lock) This project, just me', description: 'local', detail: 'Only you, only in this workspace.', value: 'local' as McpScope },
            ]
            : []),
        { label: '$(account) All my projects', description: 'user', detail: 'Only you, in every workspace.', value: 'user' as McpScope },
    ];
    const scope = await vscode.window.showQuickPick(scopes, { title: 'Add MCP server (4/4): who gets it?', placeHolder: 'Pick a scope' });
    if (!scope) return false;

    const server = buildMcpServer(transport.value, target, transport.value === 'stdio'
        ? { env: parseEnvPairs(extraRaw) }
        : { headers: parseHeader(extraRaw) });

    if (scope.value === 'project' && root) {
        addToMcpJson(path.join(root, '.mcp.json'), name.trim(), server);
    } else {
        let binary: string;
        try {
            binary = deps.resolveClaudeExecutable();
        } catch (e) {
            throw new Error(
                `${e instanceof Error ? e.message : String(e)} Choose "This project, shared" instead: that one is written without the CLI.`,
            );
        }
        await cliAddJson(binary, scope.value, name.trim(), server, root);
    }
    deps.log(`[mcp] added "${name.trim()}" (${transport.value}) at ${scope.value} scope`);
    void vscode.window.showInformationMessage(
        `Forge: MCP server "${name.trim()}" added. New conversations start with it.`,
    );
    return true;
}
