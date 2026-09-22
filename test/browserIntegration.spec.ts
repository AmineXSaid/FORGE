/**
 * Step 28: @browser tabs and "Browse the web".
 *
 * Host: `chromeMcp.ts` (the server config, the profile roots and the extension
 * probe), `chromeMcpClient.ts`'s parsers, and `ClaudeAgentService`'s three
 * methods with their dispatcher cases.
 * Webview: `core/browserMentions.ts` (the official `Oj0` and its instruction
 * text), `Session.send`'s expansion point and the transport methods.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import {
    BROWSER_DISCONNECTED_NOTICE,
    CHROME_EXTENSION_ID,
    CHROME_EXTENSION_INSTALL_URL,
    CHROME_MCP_FLAG,
    CHROME_MCP_SERVER_NAME,
    browserProfileRoots,
    browserTabEntries,
    chromeMcpServerConfig,
    claudeCommandLine,
    findChromeExtension,
} from '../src/services/claude/chromeMcp';
import {
    NEW_TAB_PLACEHOLDER,
    TABS_CONTEXT_TOOL,
    mcpContentText,
    parseBrowserTabs,
    parseNewTabResult,
} from '../src/services/claude/chromeMcpClient';
import { ClaudeAgentService } from '../src/services/claude/ClaudeAgentService';
import { handleInit, handleListFiles } from '../src/services/claude/handlers/handlers';
import {
    BROWSER_INSTRUCTION,
    BROWSER_MENTION_PATTERN,
    browserMentionBlocks,
} from '../src/webview/src/core/browserMentions';

beforeAll(() => {
    (globalThis as any).window ??= {
        location: new URL('http://localhost/index.html'),
        history: { replaceState: () => {} },
    };
});

// ---------------------------------------------------------------------------
// The server config: the host decides the command, never the webview (B3)
// ---------------------------------------------------------------------------

describe('claudeCommandLine (the official `I8`)', () => {
    it('puts the binary`s own executableArgs first', () => {
        expect(
            claudeCommandLine({ pathToClaudeCodeExecutable: '/bin/claude', executableArgs: ['--x'] }, ['--y'])
        ).toEqual({ command: '/bin/claude', args: ['--x', '--y'] });
    });

    it('runs through nodePath when there are no executableArgs', () => {
        expect(
            claudeCommandLine(
                { pathToClaudeCodeExecutable: '/lib/cli.js', executableArgs: [], nodePath: '/usr/bin/node' },
                ['--y']
            )
        ).toEqual({ command: '/usr/bin/node', args: ['/lib/cli.js', '--y'] });
    });

    it('runs the native binary directly when it needs neither', () => {
        expect(claudeCommandLine({ pathToClaudeCodeExecutable: '/bin/claude', executableArgs: [] })).toEqual({
            command: '/bin/claude',
            args: [],
        });
    });
});

describe('chromeMcpServerConfig', () => {
    it('is the official `{type:"stdio"}` running the binary with --claude-in-chrome-mcp', () => {
        expect(
            chromeMcpServerConfig({ pathToClaudeCodeExecutable: 'C:/claude.exe', executableArgs: [] })
        ).toEqual({ type: 'stdio', command: 'C:/claude.exe', args: [CHROME_MCP_FLAG] });
        expect(CHROME_MCP_FLAG).toBe('--claude-in-chrome-mcp');
        expect(CHROME_MCP_SERVER_NAME).toBe('claude-in-chrome');
    });
});

// ---------------------------------------------------------------------------
// The extension probe (the official `ND0` / `ZD0`)
// ---------------------------------------------------------------------------

describe('browserProfileRoots', () => {
    it('uses LOCALAPPDATA on win32, and Roaming only for opera', () => {
        const roots = browserProfileRoots('win32', 'C:/Users/me');
        const chrome = roots.find((r) => r.browser === 'chrome');
        const opera = roots.find((r) => r.browser === 'opera');
        expect(chrome?.path).toBe(path.join('C:/Users/me', 'AppData', 'Local', 'Google', 'Chrome', 'User Data'));
        expect(opera?.path).toBe(
            path.join('C:/Users/me', 'AppData', 'Roaming', 'Opera Software', 'Opera Stable')
        );
        expect(roots).toHaveLength(7);
    });

    it('drops the browser with no path for the platform (arc on linux)', () => {
        const linux = browserProfileRoots('linux', '/home/me').map((r) => r.browser);
        expect(linux).not.toContain('arc');
        expect(linux).toContain('chrome');
        expect(browserProfileRoots('darwin', '/Users/me')).toHaveLength(7);
    });

    it('answers nothing on a platform the official does not list', () => {
        expect(browserProfileRoots('aix', '/home/me')).toEqual([]);
    });
});

describe('findChromeExtension', () => {
    const probeFor = (tree: Record<string, string[]>, installed: string[]) => ({
        listDirectories: async (dir: string) => {
            if (!(dir in tree)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
            return tree[dir];
        },
        exists: async (dir: string) => installed.includes(dir),
    });

    it('finds the extension under Default and Profile N', async () => {
        const root = path.join('/home/me', '.config', 'google-chrome');
        const installedAt = path.join(root, 'Profile 2', 'Extensions', CHROME_EXTENSION_ID);
        const out = await findChromeExtension(
            [{ browser: 'chrome', path: root }],
            probeFor({ [root]: ['Default', 'Profile 2', 'Crashpad'] }, [installedAt])
        );
        expect(out).toEqual({ isInstalled: true, browser: 'chrome' });
    });

    it('answers not-installed when no profile has it', async () => {
        const root = '/home/me/.config/google-chrome';
        expect(
            await findChromeExtension([{ browser: 'chrome', path: root }], probeFor({ [root]: ['Default'] }, []))
        ).toEqual({ isInstalled: false, browser: null });
    });

    it('skips a root that is simply absent, and keeps looking', async () => {
        const brave = '/home/me/.config/BraveSoftware/Brave-Browser';
        const installedAt = path.join(brave, 'Default', 'Extensions', CHROME_EXTENSION_ID);
        const out = await findChromeExtension(
            [
                { browser: 'chrome', path: '/nope' },
                { browser: 'brave', path: brave },
            ],
            probeFor({ [brave]: ['Default'] }, [installedAt])
        );
        expect(out).toEqual({ isInstalled: true, browser: 'brave' });
    });

    it('ignores directories that are neither Default nor "Profile N"', async () => {
        const root = '/r';
        // `Profile` without a space must not match; the official tests
        // `name==="Default"||name.startsWith("Profile ")`.
        const wrong = path.join(root, 'ProfileX', 'Extensions', CHROME_EXTENSION_ID);
        expect(
            await findChromeExtension(
                [{ browser: 'chrome', path: root }],
                probeFor({ [root]: ['ProfileX', 'System Profile'] }, [wrong])
            )
        ).toEqual({ isInstalled: false, browser: null });
    });

    it('answers not-installed for an empty root list without touching the disk', async () => {
        const probe = { listDirectories: vi.fn(), exists: vi.fn() };
        expect(await findChromeExtension([], probe as any)).toEqual({ isInstalled: false, browser: null });
        expect(probe.listDirectories).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// The MCP client's parsers (the official `AF`)
// ---------------------------------------------------------------------------

describe('chromeMcpClient parsers', () => {
    it('reads the new tab out of the first text part', () => {
        expect(
            parseNewTabResult([
                { type: 'image' },
                { type: 'text', text: JSON.stringify({ tabGroupId: 42, tabId: 7 }) },
            ])
        ).toEqual({ tabGroupId: '42', tabId: 7 });
    });

    it('answers undefined for an empty or text-less content, so the caller throws', () => {
        expect(parseNewTabResult([])).toBeUndefined();
        expect(parseNewTabResult('nope')).toBeUndefined();
        expect(parseNewTabResult([{ type: 'image' }])).toBeUndefined();
    });

    it('flattens MCP content to text the way the official `Ul$` does', () => {
        expect(mcpContentText('plain')).toBe('plain');
        expect(mcpContentText([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }])).toBe(
            'ab'
        );
        expect(mcpContentText(undefined)).toBe('');
    });

    it('stamps the group id onto every listed tab and appends the "new tab" row', () => {
        const tabs = parseBrowserTabs([
            {
                type: 'text',
                text: JSON.stringify({
                    tabGroupId: 9,
                    availableTabs: [{ tabId: 1, title: 'a', url: 'http://a' }],
                }),
            },
        ]);
        expect(tabs).toEqual([
            { tabGroupId: '9', tabId: 1, title: 'a', url: 'http://a' },
            NEW_TAB_PLACEHOLDER,
        ]);
    });

    it('treats "No MCP tab groups found." as an empty group, not a parse failure', () => {
        expect(parseBrowserTabs([{ type: 'text', text: 'No MCP tab groups found.' }])).toEqual([
            NEW_TAB_PLACEHOLDER,
        ]);
        expect(parseBrowserTabs([{ type: 'text', text: 'garbage' }])).toBeUndefined();
    });

    it('calls the official tool name', () => {
        expect(TABS_CONTEXT_TOOL).toBe('tabs_context_mcp');
    });
});

// ---------------------------------------------------------------------------
// The host: withChannel, setMcpServers, and the disconnect notice
// ---------------------------------------------------------------------------

const BINARY = { pathToClaudeCodeExecutable: '/bin/claude', executableArgs: [] as string[] };

function hostFor(options: {
    setMcpServers?: any;
    mcpServers?: Record<string, unknown>;
    chromeMcpState?: any;
    dismissed?: boolean;
    installed?: boolean;
    choice?: string | undefined;
} = {}) {
    const log = { info: () => {}, warn: () => {}, error: () => {} };
    const enqueue = vi.fn();
    const setMcpServers = options.setMcpServers ?? vi.fn(async () => ({ added: [], removed: [], errors: {} }));
    const showInformation = vi.fn(async () => options.choice);
    const dismissChromeExtensionPrompt = vi.fn(async () => {});
    const sdkService = {
        getClaudeBinary: async () => BINARY,
        isChromeExtensionPromptDismissed: () => options.dismissed !== false,
        dismissChromeExtensionPrompt,
    };
    const s = new (ClaudeAgentService as any)(log, {}, {}, {}, { showInformation }, {}, {}, sdkService, {}, {});
    s.channels = new Map([
        [
            'ch1',
            {
                query: { setMcpServers },
                in: { enqueue },
                mcpServers: options.mcpServers,
                chromeMcpState: options.chromeMcpState,
            },
        ],
    ]);
    return { s, setMcpServers, enqueue, showInformation, dismissChromeExtensionPrompt };
}

const req = (s: any, type: string, channelId?: string) =>
    s.processRequest({ type: 'request', requestId: 'r1', channelId, request: { type } }, undefined as any);

describe('ClaudeAgentService.ensureChromeMcpEnabled', () => {
    it('adds only the one server, keeping the others, and reports wasDisabled', async () => {
        const { s, setMcpServers } = hostFor({ mcpServers: { other: { type: 'stdio', command: 'x' } } });
        const out = await req(s, 'ensure_chrome_mcp_enabled', 'ch1');
        expect(setMcpServers).toHaveBeenCalledWith({
            other: { type: 'stdio', command: 'x' },
            [CHROME_MCP_SERVER_NAME]: { type: 'stdio', command: '/bin/claude', args: [CHROME_MCP_FLAG] },
        });
        expect(out).toEqual({ type: 'ensure_chrome_mcp_enabled_response', wasDisabled: true });
        expect(s.channels.get('ch1').chromeMcpState).toEqual({ status: 'connected' });
    });

    it('reports wasDisabled:false once it is already connected', async () => {
        const { s } = hostFor({ chromeMcpState: { status: 'connected' } });
        expect(await s.ensureChromeMcpEnabled('ch1')).toEqual({
            type: 'ensure_chrome_mcp_enabled_response',
            wasDisabled: false,
        });
    });

    it('throws the joined setMcpServers errors and leaves the state in error', async () => {
        const { s } = hostFor({
            setMcpServers: async () => ({ added: [], removed: [], errors: { 'claude-in-chrome': 'spawn failed' } }),
        });
        await expect(s.ensureChromeMcpEnabled('ch1')).rejects.toThrow('claude-in-chrome: spawn failed');
        expect(s.channels.get('ch1').chromeMcpState).toEqual({ status: 'error', error: 'claude-in-chrome: spawn failed' });
        // The failed server is not remembered as installed.
        expect(s.channels.get('ch1').mcpServers).toBeUndefined();
    });

    it('throws for a channel that is not open, and for a missing channelId', async () => {
        const { s, setMcpServers } = hostFor();
        await expect(s.ensureChromeMcpEnabled('nope')).rejects.toThrow('Channel not found: nope');
        await expect(req(s, 'ensure_chrome_mcp_enabled', undefined)).rejects.toThrow(
            'channelId is required for ensure_chrome_mcp_enabled'
        );
        expect(setMcpServers).not.toHaveBeenCalled();
    });

    it('offers the install page when the extension is missing, and remembers "Don\'t Show Again"', async () => {
        const { s, showInformation, dismissChromeExtensionPrompt } = hostFor({
            dismissed: false,
            choice: "Don't Show Again",
        });
        // No browser profile on this machine's temp home -> not installed.
        vi.spyOn(require('os'), 'homedir').mockReturnValue(fs.mkdtempSync(path.join(require('os').tmpdir(), 'fg-')));
        await s.ensureChromeMcpEnabled('ch1');
        expect(showInformation).toHaveBeenCalledWith(
            'Claude in Chrome: Install the browser extension to control Chrome from Claude Code',
            'Install Extension',
            "Don't Show Again"
        );
        expect(dismissChromeExtensionPrompt).toHaveBeenCalled();
        vi.restoreAllMocks();
    });

    it('does not prompt once the user dismissed it', async () => {
        const { s, showInformation } = hostFor({ dismissed: true });
        await s.ensureChromeMcpEnabled('ch1');
        expect(showInformation).not.toHaveBeenCalled();
    });

    it('points "Install Extension" at the official URL', () => {
        expect(CHROME_EXTENSION_INSTALL_URL).toBe('https://claude.ai/chrome');
    });
});

describe('ClaudeAgentService.disableChromeMcp', () => {
    it('removes only the chrome server and enqueues the notice when it was connected', async () => {
        const { s, setMcpServers, enqueue } = hostFor({
            chromeMcpState: { status: 'connected' },
            mcpServers: { other: { type: 'stdio', command: 'x' }, [CHROME_MCP_SERVER_NAME]: { type: 'stdio', command: 'c' } },
        });
        const out = await req(s, 'disable_chrome_mcp', 'ch1');
        expect(setMcpServers).toHaveBeenCalledWith({ other: { type: 'stdio', command: 'x' } });
        expect(out).toEqual({ type: 'disable_chrome_mcp_response', wasEnabled: true });
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(enqueue.mock.calls[0][0]).toMatchObject({
            type: 'user',
            isSynthetic: true,
            message: { role: 'user', content: BROWSER_DISCONNECTED_NOTICE },
        });
    });

    it('stays quiet when it was never connected', async () => {
        const { s, enqueue } = hostFor();
        expect(await s.disableChromeMcp('ch1')).toEqual({ type: 'disable_chrome_mcp_response', wasEnabled: false });
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('throws without a channelId', async () => {
        const { s } = hostFor();
        await expect(req(s, 'disable_chrome_mcp', undefined)).rejects.toThrow(
            'channelId is required for disable_chrome_mcp'
        );
    });
});

describe('ClaudeAgentService.createNewBrowserTab', () => {
    it('is not channel-scoped, and forwards the client`s ids', async () => {
        const { s } = hostFor();
        s.chromeMcpClient = { createNewBrowserTab: async () => ({ tabGroupId: 'g1', tabId: 7 }) };
        expect(await req(s, 'create_new_browser_tab', undefined)).toEqual({
            type: 'create_new_browser_tab_response',
            tabGroupId: 'g1',
            tabId: 7,
        });
    });
});

// ---------------------------------------------------------------------------
// The `@` mention rows (the official `filterBrowserTabs` and `findFiles`)
// ---------------------------------------------------------------------------

describe('browserTabEntries', () => {
    const TABS = [
        { tabGroupId: 'g1', tabId: 4, title: 'Anthropic Docs', url: 'https://docs.anthropic.com/x' },
        { tabGroupId: 'g1', tabId: 5, title: 'GitLab', url: 'https://gitlab.com' },
        NEW_TAB_PLACEHOLDER,
    ];

    it('writes the mention path the `@browser` regex parses back', () => {
        expect(browserTabEntries(TABS, undefined)).toEqual([
            { path: 'browser:g1:4:https://docs.anthropic.com/x', name: 'browser:Anthropic_Docs', type: 'browser' },
            { path: 'browser:g1:5:https://gitlab.com', name: 'browser:GitLab', type: 'browser' },
            { path: 'browser:new_tab', name: 'browser:new_tab', type: 'browser' },
        ]);
    });

    it('filters on the prefixed title or the url, case-insensitively', () => {
        expect(browserTabEntries(TABS, 'browser:gitlab').map((e) => e.path)).toEqual(['browser:g1:5:https://gitlab.com']);
        expect(browserTabEntries(TABS, 'DOCS.ANTHROPIC').map((e) => e.path)).toEqual([
            'browser:g1:4:https://docs.anthropic.com/x',
        ]);
        expect(browserTabEntries(TABS, 'nothing-here')).toEqual([]);
    });

    it('round-trips into a mention the send path resolves', async () => {
        const [entry] = browserTabEntries(TABS, 'browser:gitlab');
        const blocks = await browserMentionBlocks(`look at @${entry.path}`, async () => false, async () => {
            throw new Error('must not create a tab');
        });
        expect(blocks).toEqual([
            { type: 'text', text: '<browser tabGroupId="g1" tabId="5">https://gitlab.com</browser>' },
        ]);
    });
});

describe('handleListFiles (the official `findFiles`)', () => {
    const files = [{ path: 'src/a.ts', name: 'a.ts', type: 'file' as const }];
    const tabs = [{ path: 'browser:new_tab', name: 'browser:new_tab', type: 'browser' as const }];
    const ctx = (calls: any[]) => ({
        workspaceService: { getDefaultWorkspaceFolder: () => ({ uri: { fsPath: '/repo' } }) },
        fileSystemService: { findFiles: async () => files },
        agentService: {
            getMatchingBrowserTabs: async (query: string | undefined, useCache?: boolean) => {
                calls.push({ query, useCache });
                return tabs;
            },
        },
    });

    it('answers a `browser:` query with tabs alone, fetched live', async () => {
        const calls: any[] = [];
        const out = await handleListFiles({ type: 'list_files_request', pattern: 'browser:git' } as any, ctx(calls) as any);
        expect(out.files).toEqual(tabs);
        expect(calls).toEqual([{ query: 'browser:git', useCache: false }]);
    });

    it('floats tabs above files while the query is still a prefix of "browser:"', async () => {
        const calls: any[] = [];
        const out = await handleListFiles({ type: 'list_files_request', pattern: 'bro' } as any, ctx(calls) as any);
        expect(out.files).toEqual([...tabs, ...files]);
        expect(calls).toEqual([{ query: 'bro', useCache: true }]);
    });

    it('keeps files first for every other query, tabs from the cache', async () => {
        const calls: any[] = [];
        const out = await handleListFiles({ type: 'list_files_request', pattern: 'src/' } as any, ctx(calls) as any);
        expect(out.files).toEqual([...files, ...tabs]);
        expect(calls).toEqual([{ query: 'src/', useCache: true }]);
    });

    it('treats an empty pattern as "not typing towards browser:"', async () => {
        const out = await handleListFiles({ type: 'list_files_request', pattern: '' } as any, ctx([]) as any);
        expect(out.files).toEqual([...files, ...tabs]);
    });
});

describe('handleInit', () => {
    const initContext = (supported: boolean) =>
        ({
            logService: { info: () => {}, warn: () => {}, error: () => {} },
            configService: {
                getSetting: async () => 'default',
                getExtensionConfig: async () => ({}),
            },
            workspaceService: { getDefaultWorkspaceFolder: () => ({ uri: { fsPath: '/repo' } }) },
            sdkService: {
                getThinkingLevel: () => 'default_on',
                getAllowDangerouslySkipPermissions: () => false,
                isBrowserIntegrationSupported: () => supported,
            },
            agentService: { sendSessionStates: () => {} },
            // Required on HandlerContext since the endpoints line: `handleInit`
            // reports `endpointProfileCount` so the welcome gate knows whether
            // to offer setting an endpoint up.
            endpointService: { listProfiles: () => ({ profiles: [] }) },
        }) as any;

    it('reports the host`s browserIntegrationSupported, both ways', async () => {
        const on = await handleInit({ type: 'init' } as any, initContext(true));
        expect(on.state.browserIntegrationSupported).toBe(true);
        const off = await handleInit({ type: 'init' } as any, initContext(false));
        expect(off.state.browserIntegrationSupported).toBe(false);
    });
});

describe('ClaudeAgentService.getMatchingBrowserTabs', () => {
    it('answers nothing, and spawns nothing, when the integration is unsupported', async () => {
        const log = { info: () => {}, warn: () => {}, error: () => {} };
        const getClaudeBinary = vi.fn(async () => BINARY);
        const s = new (ClaudeAgentService as any)(
            log, {}, {}, {}, {}, {}, {},
            { isBrowserIntegrationSupported: () => false, getClaudeBinary },
            {}, {}
        );
        expect(await s.getMatchingBrowserTabs('browser:', false)).toEqual([]);
        expect(getClaudeBinary).not.toHaveBeenCalled();
    });

    it('falls back to the cache when the live fetch throws, instead of failing the @ list', async () => {
        const log = { info: () => {}, warn: () => {}, error: () => {} };
        const s = new (ClaudeAgentService as any)(
            log, {}, {}, {}, {}, {}, {},
            { isBrowserIntegrationSupported: () => true, getClaudeBinary: async () => BINARY },
            {}, {}
        );
        s.browserTabsCache = { tabs: [NEW_TAB_PLACEHOLDER], timestamp: 0 };
        s.chromeMcpClient = {
            getBrowserTabs: async () => {
                throw new Error('no chrome');
            },
        };
        expect(await s.getMatchingBrowserTabs(undefined, false)).toEqual([
            { path: 'browser:new_tab', name: 'browser:new_tab', type: 'browser' },
        ]);
    });
});

// ---------------------------------------------------------------------------
// The webview: the official `Oj0`
// ---------------------------------------------------------------------------

describe('browserMentionBlocks (the official `Oj0`)', () => {
    const tab = async () => ({ tabGroupId: 'g9', tabId: 3 });

    it('answers nothing, and asks for nothing, when there is no mention', async () => {
        const ensure = vi.fn(async () => true);
        const create = vi.fn(tab);
        expect(await browserMentionBlocks('just a prompt', ensure, create)).toEqual([]);
        expect(ensure).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
    });

    it('creates a tab for `@browser:new_tab`', async () => {
        const create = vi.fn(tab);
        const blocks = await browserMentionBlocks('open @browser:new_tab please', async () => false, create);
        expect(create).toHaveBeenCalledTimes(1);
        expect(blocks).toEqual([{ type: 'text', text: '<browser tabGroupId="g9" tabId="3"></browser>' }]);
    });

    it('leaves the half-typed `@browser:` alone -- it is not a mention yet', async () => {
        // The "+" row inserts exactly this, and the official regex deliberately
        // does not match it: the composer's `@` dropdown is meant to complete it
        // into `@browser:<group>:<id>:<url>` (or `@browser:new_tab`) first.
        // Alternative 1 needs `:x:<digits>:y`, alternative 2 needs `:new_tab`,
        // and alternative 3's lookahead fails on the trailing colon.
        const create = vi.fn(tab);
        expect(await browserMentionBlocks('open @browser: please', async () => true, create)).toEqual([]);
        expect(create).not.toHaveBeenCalled();
    });

    it('matches a bare `@browser` at a word boundary and at end of input', async () => {
        expect(BROWSER_MENTION_PATTERN.test('@browser')).toBe(true);
        BROWSER_MENTION_PATTERN.lastIndex = 0;
        expect((await browserMentionBlocks('use @browser now', async () => false, tab)).length).toBe(1);
        expect((await browserMentionBlocks('use @browser', async () => false, tab)).length).toBe(1);
        // Not a mention: `@browsers` has no boundary.
        expect(await browserMentionBlocks('@browsers', async () => false, tab)).toEqual([]);
    });

    it('keeps the ids and the label of a fully-specified mention, without creating a tab', async () => {
        const create = vi.fn(tab);
        const blocks = await browserMentionBlocks('see @browser:grp:12:docs.anthropic.com end', async () => false, create);
        expect(create).not.toHaveBeenCalled();
        expect(blocks).toEqual([
            { type: 'text', text: '<browser tabGroupId="grp" tabId="12">docs.anthropic.com</browser>' },
        ]);
    });

    it('sends the instruction block once -- only when the browser was disabled', async () => {
        const withInstruction = await browserMentionBlocks('@browser:new_tab', async () => true, tab);
        expect(withInstruction[0].text).toBe(`<browser_instruction>${BROWSER_INSTRUCTION}</browser_instruction>`);
        expect(withInstruction).toHaveLength(2);
        const without = await browserMentionBlocks('@browser:new_tab', async () => false, tab);
        expect(without).toHaveLength(1);
    });

    it('handles several mentions in one prompt, in order', async () => {
        const blocks = await browserMentionBlocks(
            '@browser:a:1:one and @browser:b:2:two',
            async () => false,
            tab
        );
        expect(blocks.map((b) => b.text)).toEqual([
            '<browser tabGroupId="a" tabId="1">one</browser>',
            '<browser tabGroupId="b" tabId="2">two</browser>',
        ]);
    });

    it('carries the official instruction text byte for byte', () => {
        const bundle = fs.readFileSync(
            'C:/Users/med-a/Music/Real_Claude_Code_VSCODE_extension_files/webview/index.js',
            'utf8'
        );
        // Three anchors from the start, middle and end of `Aj0`, escaped the way
        // the bundle's template literal holds them.
        for (const line of [
            '# Claude in Chrome browser automation',
            'IMPORTANT: At the start of each browser automation session, call mcp__claude-in-chrome__tabs_context_mcp first',
            '4. When a tab is closed by the user or a navigation error occurs, call tabs_context_mcp to see what tabs are available',
        ]) {
            expect(BROWSER_INSTRUCTION).toContain(line);
            expect(bundle).toContain(line);
        }
        expect(BROWSER_INSTRUCTION.split('\n')).toHaveLength(54);
    });
});
