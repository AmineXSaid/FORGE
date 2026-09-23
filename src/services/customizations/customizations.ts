/**
 * Skills, subagents, slash commands and MCP servers, as files the CLI reads.
 *
 * Forge adds nothing to the formats. A skill is `<skills dir>/<name>/SKILL.md`
 * with `name` and `description` frontmatter; a subagent is
 * `<agents dir>/<name>.md` with the same two fields (plus an optional `tools`
 * list) and its system prompt as the body; a custom slash command is
 * `<commands dir>/<name>.md`, its prompt as the body, with an optional
 * `description` and `argument-hint`; an MCP server is one entry under
 * `mcpServers`. The CLI discovers them on its own, which is the point:
 * these helpers only make the file a user would otherwise have to write by
 * hand, and read back what is there so the Settings page can list it.
 *
 * Kept free of `vscode` so the spec drives it against a temp directory.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type ItemKind = 'skills' | 'agents' | 'commands';
export type ItemScope = 'user' | 'project';

export interface ForgeItem {
    kind: ItemKind;
    name: string;
    description: string;
    scope: ItemScope;
    /** The file to open: a skill's SKILL.md, an agent's or a command's .md. */
    path: string;
    /** Commands only: what `/name` expects after it, e.g. `[pr-number]`. */
    argumentHint?: string;
}

/** The CLI's config home, honouring `CLAUDE_CONFIG_DIR` as the CLI does. */
export function claudeHome(): string {
    return process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
}

/** Where items of a kind live for a scope. `undefined` for a project scope with no workspace. */
export function itemsDir(kind: ItemKind, scope: ItemScope, workspaceRoot: string | undefined): string | undefined {
    if (scope === 'user') return path.join(claudeHome(), kind);
    return workspaceRoot ? path.join(workspaceRoot, '.claude', kind) : undefined;
}

/**
 * A name the CLI accepts for a skill or an agent: lowercase letters, digits and
 * hyphens, starting with a letter or digit, at most 64 characters. The same
 * rule both formats document; stricter than a filename, so a valid name is
 * always a safe path segment too.
 */
export const ITEM_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function validateItemName(value: string, taken: ReadonlySet<string> = new Set()): string | undefined {
    const name = value.trim();
    if (!name) return 'A name is required.';
    if (!ITEM_NAME.test(name)) return 'Use lowercase letters, digits and hyphens, up to 64 characters.';
    if (taken.has(name)) return `"${name}" already exists here.`;
    return undefined;
}

/** A description is what the model reads to decide when to use the item. */
export function validateDescription(value: string): string | undefined {
    const text = value.trim();
    if (text.length < 8) return 'Say in a sentence when it should be used.';
    if (text.length > 1024) return 'Keep it under 1024 characters.';
    if (/\r|\n/.test(text)) return 'One line, please.';
    return undefined;
}

/** A frontmatter scalar, quoted only when YAML would otherwise misread it. */
function yamlScalar(value: string): string {
    return /^[\w .,()/'-]+$/.test(value) && !/^[-?:,[\]{}#&*!|>'"%@`]/.test(value) && !/: /.test(value)
        ? value
        : JSON.stringify(value);
}

function titleOf(name: string): string {
    return name.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/** The SKILL.md a new skill starts from. */
export function skillMarkdown(name: string, description: string): string {
    return [
        '---',
        `name: ${name}`,
        `description: ${yamlScalar(description.trim())}`,
        '---',
        '',
        `# ${titleOf(name)}`,
        '',
        '## Instructions',
        '',
        'Write the steps the model should follow when this skill applies.',
        '',
        '## Examples',
        '',
        '- Describe a request this skill should handle, and what a good result looks like.',
        '',
    ].join('\n');
}

/** The .md a new subagent starts from. `tools` empty means it inherits every tool. */
export function agentMarkdown(name: string, description: string, tools: readonly string[] = []): string {
    return [
        '---',
        `name: ${name}`,
        `description: ${yamlScalar(description.trim())}`,
        ...(tools.length ? [`tools: ${tools.join(', ')}`] : []),
        '---',
        '',
        `You are ${titleOf(name)}, a focused subagent.`,
        '',
        'Describe its role, how it should work, and what it should hand back.',
        '',
    ].join('\n');
}

/**
 * The .md a new slash command starts from. The body is the prompt `/name`
 * sends; `$ARGUMENTS` is where whatever follows the command goes.
 */
export function commandMarkdown(name: string, description: string, argumentHint = ''): string {
    const hint = argumentHint.trim();
    return [
        '---',
        `description: ${yamlScalar(description.trim())}`,
        ...(hint ? [`argument-hint: ${yamlScalar(hint)}`] : []),
        '---',
        '',
        `Write the prompt /${name} sends.${hint ? ' $ARGUMENTS is replaced with what follows the command.' : ''}`,
        '',
        ...(hint ? ['$ARGUMENTS', ''] : []),
    ].join('\n');
}

type Frontmatter = { name?: string; description?: string; 'argument-hint'?: string };

/** Read `name`, `description` and `argument-hint` out of a frontmatter block. Tolerant: missing fields are empty. */
export function readFrontmatter(text: string): Frontmatter {
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (!match) return {};
    const out: Frontmatter = {};
    for (const line of match[1].split(/\r?\n/)) {
        const m = /^(name|description|argument-hint):\s*(.*)$/.exec(line);
        if (!m) continue;
        let value = m[2].trim();
        if (value.startsWith('"') && value.endsWith('"')) {
            try {
                value = JSON.parse(value);
            } catch {
                value = value.slice(1, -1);
            }
        } else if (value.startsWith("'") && value.endsWith("'")) {
            value = value.slice(1, -1);
        }
        out[m[1] as keyof Frontmatter] = value;
    }
    return out;
}

/**
 * A command's description when its frontmatter has none: the CLI falls back to
 * the first line of the prompt, so the list does too.
 */
function firstBodyLine(text: string): string {
    const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    const line = body.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
    return line.replace(/^#+\s*/, '').slice(0, 160);
}

/**
 * The command files in a directory: `<name>.md` at the top, and one level of
 * sub-folders, which the CLI lists as `folder:name`.
 */
function commandFiles(dir: string): Array<{ file: string; name: string }> {
    const out: Array<{ file: string; name: string }> = [];
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
            out.push({ file: path.join(dir, entry.name), name: entry.name.replace(/\.md$/, '') });
        } else if (entry.isDirectory()) {
            let inner: fs.Dirent[] = [];
            try {
                inner = fs.readdirSync(path.join(dir, entry.name), { withFileTypes: true });
            } catch {
                continue;
            }
            for (const sub of inner) {
                if (sub.isFile() && sub.name.endsWith('.md')) {
                    out.push({ file: path.join(dir, entry.name, sub.name), name: `${entry.name}:${sub.name.replace(/\.md$/, '')}` });
                }
            }
        }
    }
    return out;
}

/** Everything of a kind in one directory. A missing directory is simply none. */
export function listItemsIn(kind: ItemKind, scope: ItemScope, dir: string | undefined): ForgeItem[] {
    if (!dir || !fs.existsSync(dir)) return [];
    if (kind === 'commands') {
        return commandFiles(dir)
            .map(({ file, name }) => {
                let text = '';
                try {
                    text = fs.readFileSync(file, 'utf8');
                } catch {
                    // Unreadable: listed by its file name, without a description.
                }
                const meta = readFrontmatter(text);
                const item: ForgeItem = { kind, scope, name, description: meta.description || firstBodyLine(text), path: file };
                if (meta['argument-hint']) item.argumentHint = meta['argument-hint'];
                return item;
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }
    const items: ForgeItem[] = [];
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    for (const entry of entries) {
        const file = kind === 'skills'
            ? (entry.isDirectory() ? path.join(dir, entry.name, 'SKILL.md') : undefined)
            : (entry.isFile() && entry.name.endsWith('.md') ? path.join(dir, entry.name) : undefined);
        if (!file || !fs.existsSync(file)) continue;
        let meta: { name?: string; description?: string } = {};
        try {
            meta = readFrontmatter(fs.readFileSync(file, 'utf8'));
        } catch {
            // Unreadable: listed by its folder or file name, without a description.
        }
        const fallback = kind === 'skills' ? entry.name : entry.name.replace(/\.md$/, '');
        items.push({ kind, scope, name: meta.name || fallback, description: meta.description ?? '', path: file });
    }
    return items.sort((a, b) => a.name.localeCompare(b.name));
}

/** Project items first (they win when names collide), then the user's. */
export function listItems(kind: ItemKind, workspaceRoot: string | undefined): ForgeItem[] {
    return [
        ...listItemsIn(kind, 'project', itemsDir(kind, 'project', workspaceRoot)),
        ...listItemsIn(kind, 'user', itemsDir(kind, 'user', workspaceRoot)),
    ];
}

/**
 * Write a new item and return its file. Never overwrites: an existing name is
 * an error, because a wizard that silently replaces someone's skill is worse
 * than one that refuses.
 */
export function writeItem(kind: ItemKind, dir: string, name: string, content: string): string {
    if (!ITEM_NAME.test(name)) throw new Error(`Invalid name: ${name}`);
    const file = kind === 'skills' ? path.join(dir, name, 'SKILL.md') : path.join(dir, `${name}.md`);
    if (fs.existsSync(kind === 'skills' ? path.dirname(file) : file)) {
        throw new Error(`"${name}" already exists in ${dir}.`);
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, { encoding: 'utf8', flag: 'wx' });
    return file;
}

/**
 * Copy a skill folder in. The source must hold a SKILL.md at its top; the copy
 * takes the folder's name, which must itself be a valid skill name.
 */
export function importSkillFolder(source: string, dir: string): string {
    const skillFile = path.join(source, 'SKILL.md');
    if (!fs.existsSync(skillFile)) throw new Error('That folder has no SKILL.md at its top level.');
    const meta = readFrontmatter(fs.readFileSync(skillFile, 'utf8'));
    const name = (meta.name && ITEM_NAME.test(meta.name) ? meta.name : path.basename(source)).toLowerCase();
    if (!ITEM_NAME.test(name)) {
        throw new Error(`"${path.basename(source)}" is not a valid skill name. Rename the folder to lowercase letters, digits and hyphens.`);
    }
    const target = path.join(dir, name);
    if (fs.existsSync(target)) throw new Error(`A skill named "${name}" already exists in ${dir}.`);
    fs.mkdirSync(dir, { recursive: true });
    fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
    return path.join(target, 'SKILL.md');
}

// ---------------------------------------------------------------------------
// MCP servers
// ---------------------------------------------------------------------------

export type McpTransport = 'stdio' | 'http' | 'sse';

export type McpServerConfig =
    | { type: 'stdio'; command: string; args: string[]; env?: Record<string, string> }
    | { type: 'http' | 'sse'; url: string; headers?: Record<string, string> };

/** An MCP server name: what `claude mcp add` accepts, and a safe JSON key. */
export const MCP_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export function validateMcpName(value: string, taken: ReadonlySet<string> = new Set()): string | undefined {
    const name = value.trim();
    if (!name) return 'A name is required.';
    if (!MCP_NAME.test(name)) return 'Use letters, digits, dot, dash or underscore.';
    if (taken.has(name)) return `"${name}" is already configured.`;
    return undefined;
}

/**
 * Split a command line the way a shell would for the common cases: spaces
 * separate words, single or double quotes keep them together. No expansion,
 * no operators -- the result is an argv, never run through a shell.
 */
export function splitCommandLine(line: string): string[] {
    const words: string[] = [];
    let current = '';
    let quote: '"' | "'" | undefined;
    let started = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
            if (ch === quote) quote = undefined;
            else if (ch === '\\' && quote === '"' && i + 1 < line.length && /["\\]/.test(line[i + 1])) current += line[++i];
            else current += ch;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            started = true;
        } else if (/\s/.test(ch)) {
            if (started) words.push(current);
            current = '';
            started = false;
        } else {
            current += ch;
            started = true;
        }
    }
    if (quote) throw new Error('Unclosed quote in the command.');
    if (started) words.push(current);
    return words;
}

export function validateCommandLine(value: string): string | undefined {
    try {
        const argv = splitCommandLine(value.trim());
        if (!argv.length) return 'Enter the command that starts the server, e.g. npx -y @modelcontextprotocol/server-memory';
        return undefined;
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}

export function validateServerUrl(value: string): string | undefined {
    try {
        const url = new URL(value.trim());
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Use an http:// or https:// URL.';
        return undefined;
    } catch {
        return 'Enter a full URL, e.g. https://mcp.example.com/mcp';
    }
}

/** `KEY=value` pairs, comma or newline separated. Empty is none. */
export function parseEnvPairs(value: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const part of value.split(/[,\n]/).map((p) => p.trim()).filter(Boolean)) {
        const eq = part.indexOf('=');
        if (eq <= 0) throw new Error(`"${part}" is not KEY=value.`);
        const key = part.slice(0, eq).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`"${key}" is not a valid variable name.`);
        env[key] = part.slice(eq + 1).trim();
    }
    return env;
}

/** `Name: value` for one header. Empty is none. */
export function parseHeader(value: string): Record<string, string> {
    const text = value.trim();
    if (!text) return {};
    const colon = text.indexOf(':');
    if (colon <= 0) throw new Error('Write it as Name: value, e.g. Authorization: Bearer <token>');
    const name = text.slice(0, colon).trim();
    if (!/^[A-Za-z0-9-]+$/.test(name)) throw new Error(`"${name}" is not a valid header name.`);
    return { [name]: text.slice(colon + 1).trim() };
}

export function buildMcpServer(
    transport: McpTransport,
    target: string,
    extra: { env?: Record<string, string>; headers?: Record<string, string> } = {},
): McpServerConfig {
    if (transport === 'stdio') {
        const [command, ...args] = splitCommandLine(target.trim());
        if (!command) throw new Error('A command is required.');
        return { type: 'stdio', command, args, ...(extra.env && Object.keys(extra.env).length ? { env: extra.env } : {}) };
    }
    return {
        type: transport,
        url: target.trim(),
        ...(extra.headers && Object.keys(extra.headers).length ? { headers: extra.headers } : {}),
    };
}

/**
 * Add a server to a project's `.mcp.json`, the file the CLI reads for project
 * scope and the one a team commits. Creates it when absent; refuses a name
 * that is already there; keeps every other key as it was.
 */
export function addToMcpJson(file: string, name: string, server: McpServerConfig): void {
    let doc: { mcpServers?: Record<string, unknown>; [key: string]: unknown } = {};
    if (fs.existsSync(file)) {
        const text = fs.readFileSync(file, 'utf8');
        try {
            doc = text.trim() ? JSON.parse(text) : {};
        } catch {
            throw new Error(`${file} is not valid JSON. Fix it first, then add the server.`);
        }
    }
    const servers = { ...(doc.mcpServers ?? {}) };
    if (Object.prototype.hasOwnProperty.call(servers, name)) throw new Error(`"${name}" is already in ${file}.`);
    servers[name] = server;
    fs.writeFileSync(file, `${JSON.stringify({ ...doc, mcpServers: servers }, null, 2)}\n`, 'utf8');
}
