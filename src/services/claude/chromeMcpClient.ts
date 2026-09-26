/**
 * Step 28: the official host's Chrome MCP client (`class AF`, extension.js
 * @3181033), ported.
 *
 * `create_new_browser_tab` does **not** go through the session's query. The
 * official opens a second, short-lived MCP stdio connection straight to
 * `claude --claude-in-chrome-mcp` and calls the `tabs_context_mcp` tool with
 * `createIfEmpty:true`, because the webview needs the new tab's ids *before* the
 * turn is sent (the `@browser:` mention carries them).
 *
 * The official calls, verbatim:
 *
 *   this.transport=new q1$({command:Q,args:X,env:{...$.env,USER_TYPE:"external"}}),
 *   this.client=new B1$({name:"claude-vscode-chrome-mcp-client",version:"2.1.270"},{capabilities:{}}),
 *   await this.client.connect(this.transport)
 *   …
 *   let Q=await this.client.callTool({name:"tabs_context_mcp",arguments:{createIfEmpty:!0}},h9)
 *
 * `q1$` / `B1$` / `h9` are the MCP SDK's `StdioClientTransport`, `Client` and
 * `CallToolResultSchema`; `@modelcontextprotocol/sdk` is already a dependency.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { CHROME_MCP_FLAG, claudeCommandLine, type ClaudeBinaryLike } from './chromeMcp';
import type { ILogService } from '../logService';

/** The official tool the browser MCP serves for tab context and creation. */
export const TABS_CONTEXT_TOOL = 'tabs_context_mcp';

export interface BrowserTabRef {
    tabGroupId: string;
    tabId: number;
}

/** A tab as `tabs_context_mcp` lists it (the official `getBrowserTabs`). */
export interface BrowserTab extends BrowserTabRef {
    title: string;
    url: string;
}

/** The official `Ul$`: flatten an MCP content array down to its text. */
export function mcpContentText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map((part) =>
                part && typeof part === 'object' && 'text' in part && typeof (part as { text: unknown }).text === 'string'
                    ? (part as { text: string }).text
                    : undefined
            )
            .join('');
    }
    return '';
}

/**
 * The official `parse` step of `createNewBrowserTab`: the first `text` part of
 * the content is JSON with `tabGroupId` and `tabId`. `tabGroupId` is stringified
 * the way the official stringifies it; `tabId` is passed through as-is.
 *
 * A reply that is not JSON is the browser server saying why it cannot make a
 * tab, in words, without setting `isError` -- "Browser extension is not
 * connected. Please ensure the Claude browser extension is installed and
 * running …" (CLI 2.1.274). The official `JSON.parse`s it anyway and reports
 * `SyntaxError: Unexpected token 'B'`; Forge throws the words themselves, so
 * the chat can say them (production audit, Phase 6, item 4).
 */
export function parseNewTabResult(content: unknown): BrowserTabRef | undefined {
    if (!Array.isArray(content) || content.length === 0) return undefined;
    const textPart = content.find((part) => (part as { type?: string })?.type === 'text');
    if (!textPart || !('text' in (textPart as object))) return undefined;
    const text = (textPart as { text: string }).text;
    let parsed: { tabGroupId?: unknown; tabId?: unknown };
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error(`Failed to create new tab: ${text.trim()}`);
    }
    return { tabGroupId: String(parsed.tabGroupId), tabId: parsed.tabId as number };
}

/**
 * The official `getBrowserTabs` parse step: `availableTabs` carry the group's
 * id, and the official always appends a synthetic "new tab" row so the picker
 * can offer one. An empty group answers with that row alone.
 */
export const NEW_TAB_PLACEHOLDER: BrowserTab = { tabGroupId: '', tabId: 0, title: 'new tab', url: '' };

export function parseBrowserTabs(content: unknown): BrowserTab[] | undefined {
    if (!Array.isArray(content) || content.length === 0) return [];
    const textPart = content.find((part) => (part as { type?: string })?.type === 'text');
    if (!textPart || !('text' in (textPart as object))) return [];
    const text = (textPart as { text: string }).text;
    try {
        const parsed = JSON.parse(text);
        const tabGroupId = String(parsed.tabGroupId);
        const tabs: BrowserTab[] = ((parsed.availableTabs || []) as BrowserTab[]).map((tab) => ({
            ...tab,
            tabGroupId
        }));
        tabs.push(NEW_TAB_PLACEHOLDER);
        return tabs;
    } catch {
        if (text.includes('No MCP tab groups found.')) return [NEW_TAB_PLACEHOLDER];
        return undefined;
    }
}

/**
 * The official `AF`, one connection reused across calls and dropped on any
 * error (the official disconnects in the `catch` so the next call reconnects).
 */
export class ChromeMcpClient {
    private client: Client | null = null;
    private transport: StdioClientTransport | null = null;

    constructor(
        private readonly logService: ILogService,
        private readonly getClaudeBinary: () => Promise<ClaudeBinaryLike>
    ) {}

    async connect(): Promise<boolean> {
        if (this.client) return true;
        try {
            const binary = await this.getClaudeBinary();
            const { command, args } = claudeCommandLine(binary, [CHROME_MCP_FLAG]);
            this.logService.info(`Chrome MCP: Connecting to server with command: ${command} ${args.join(' ')}`);
            // The official passes the binary's own environment plus USER_TYPE.
            // `StdioClientTransport` takes `Record<string,string>`, so the
            // unset entries of the merged environment are dropped here.
            const env: Record<string, string> = {};
            for (const [key, value] of Object.entries(binary.env ?? {})) {
                if (typeof value === 'string') env[key] = value;
            }
            env.USER_TYPE = 'external';
            this.transport = new StdioClientTransport({ command, args, env });
            this.client = new Client({ name: 'forge-vscode-chrome-mcp-client', version: '1.0.0' }, { capabilities: {} });
            await this.client.connect(this.transport);
            this.logService.info('Chrome MCP: Successfully connected to server');
            return true;
        } catch (error) {
            this.logService.error(`Chrome MCP: Failed to connect to server: ${error}`);
            this.client = null;
            this.transport = null;
            return false;
        }
    }

    async disconnect(): Promise<void> {
        if (this.client) {
            try {
                await this.client.close();
                this.logService.info('Chrome MCP: Disconnected from server');
            } catch (error) {
                this.logService.error(`Chrome MCP: Error disconnecting: ${error}`);
            }
            this.client = null;
        }
        if (this.transport) {
            try {
                await this.transport.close();
            } catch {
                /* the official swallows this too */
            }
            this.transport = null;
        }
    }

    /** The official `createNewBrowserTab`. */
    async createNewBrowserTab(): Promise<BrowserTabRef> {
        if (!(await this.connect()) || !this.client) {
            throw new Error('Failed to connect to Chrome MCP server');
        }
        try {
            const result = await this.client.callTool(
                { name: TABS_CONTEXT_TOOL, arguments: { createIfEmpty: true } },
                CallToolResultSchema
            );
            if (result.isError) {
                throw new Error(`Failed to create new tab: ${mcpContentText(result.content)}`);
            }
            const tab = parseNewTabResult(result.content);
            if (!tab) throw new Error('Unexpected response format from tabs_create');
            return tab;
        } catch (error) {
            this.logService.error(`Chrome MCP: Error calling tabs_create: ${error}`);
            await this.disconnect();
            throw error;
        }
    }

    /**
     * The official `getBrowserTabs`: the tabs already open in the group, plus
     * the synthetic "new tab" row. Nothing in Forge's UI lists tabs today (the
     * official's tab picker is not in scope), but the SDK surface is here
     * because the same connection serves it and hiding it would make the client
     * narrower than the official's.
     */
    async getBrowserTabs(): Promise<BrowserTab[]> {
        if (!(await this.connect()) || !this.client) return [];
        try {
            const result = await this.client.callTool(
                { name: TABS_CONTEXT_TOOL, arguments: { createIfEmpty: false } },
                CallToolResultSchema
            );
            if (result.isError) {
                if (mcpContentText(result.content).includes('No tab available')) return [NEW_TAB_PLACEHOLDER];
                this.logService.warn(`Chrome MCP: tabs_context returned error: ${JSON.stringify(result.content)}`);
                return [];
            }
            const tabs = parseBrowserTabs(result.content);
            if (tabs === undefined) {
                this.logService.warn('Chrome MCP: Failed to parse tabs_context response');
                return [];
            }
            return tabs;
        } catch (error) {
            this.logService.error(`Chrome MCP: Error calling tabs_context: ${error}`);
            await this.disconnect();
            return [];
        }
    }
}
