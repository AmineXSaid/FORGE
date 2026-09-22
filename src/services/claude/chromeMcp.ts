/**
 * Step 28: the "Claude in Chrome" MCP server, ported from the official host.
 *
 * Everything here is pure: the paths, the server config and the disconnect
 * notice, so `test/browserIntegration.spec.ts` can check them without a CLI, a
 * browser or a filesystem. The side-effecting parts (the MCP client, the
 * install prompt) live next door in `chromeMcpClient.ts` and
 * `ClaudeAgentService.ts`.
 *
 * The official sources:
 * - `getChromeMcpServerConfig()` (extension.js @3291268):
 *     let{command:$,args:Q}=I8(this.getClaudeBinary(),["--claude-in-chrome-mcp"]);
 *     return{type:"stdio",command:$,args:Q}
 * - `I8($,Q=[])` (@2864719): the binary's own `executableArgs` come first, then
 *   `nodePath` if the binary needs an interpreter, else the bare path.
 * - `ND0` / `ZD0` / `OD0` / `Eb$` (@2860285): where each Chromium-family browser
 *   keeps its profiles per platform, and the extension id to look for inside
 *   `<profile>/Extensions/<id>`.
 */

import * as path from 'path';

/** The official `VD0`: the Claude in Chrome extension id. */
export const CHROME_EXTENSION_ID = 'fcoeoabgfenejglbffodgkkbkcdhcgfn';

/** The official `BD0()`: every extension id that counts as "installed". */
export function chromeExtensionIds(): string[] {
    return [CHROME_EXTENSION_ID];
}

/** The official `Ib$`: where "Install Extension" sends the user. */
export const CHROME_EXTENSION_INSTALL_URL = 'https://claude.ai/chrome';

/** The official MCP server key. Only this one name is ever written. */
export const CHROME_MCP_SERVER_NAME = 'claude-in-chrome';

/** The official flag the CLI is launched with to serve the browser tools. */
export const CHROME_MCP_FLAG = '--claude-in-chrome-mcp';

/**
 * The synthetic user message the official enqueues when a **connected** browser
 * is switched off, so the model stops offering browser tools mid-turn.
 */
export const BROWSER_DISCONNECTED_NOTICE =
    '[Browser disconnected: The browser connection has been closed. Browser tools are no longer available.]';

/** The shape `getClaudeBinary()` hands back (the SDK's `ClaudeBinary`). */
export interface ClaudeBinaryLike {
    pathToClaudeCodeExecutable: string;
    executableArgs: string[];
    nodePath?: string;
    env?: Record<string, string | undefined>;
}

/** The official `I8`: the command line that runs a Claude binary with `args`. */
export function claudeCommandLine(
    binary: ClaudeBinaryLike,
    args: string[] = []
): { command: string; args: string[] } {
    const { pathToClaudeCodeExecutable, executableArgs, nodePath } = binary;
    if (executableArgs.length > 0) {
        return { command: pathToClaudeCodeExecutable, args: [...executableArgs, ...args] };
    }
    if (nodePath) {
        return { command: nodePath, args: [pathToClaudeCodeExecutable, ...args] };
    }
    return { command: pathToClaudeCodeExecutable, args };
}

/** The official `getChromeMcpServerConfig()`, field for field. */
export function chromeMcpServerConfig(binary: ClaudeBinaryLike): {
    type: 'stdio';
    command: string;
    args: string[];
} {
    const { command, args } = claudeCommandLine(binary, [CHROME_MCP_FLAG]);
    return { type: 'stdio', command, args };
}

/** The official `HD0`: the browsers checked, in order. */
export const CHROME_FAMILY_BROWSERS = [
    'chrome',
    'brave',
    'arc',
    'edge',
    'chromium',
    'vivaldi',
    'opera'
] as const;

export type ChromeFamilyBrowser = (typeof CHROME_FAMILY_BROWSERS)[number];

interface BrowserProfileLocation {
    macos: string[];
    linux: string[];
    windows: { path: string[]; useRoaming?: boolean };
}

/** The official `qD0`, verbatim. */
export const BROWSER_PROFILE_LOCATIONS: Record<ChromeFamilyBrowser, BrowserProfileLocation> = {
    chrome: {
        macos: ['Library', 'Application Support', 'Google', 'Chrome'],
        linux: ['.config', 'google-chrome'],
        windows: { path: ['Google', 'Chrome', 'User Data'] }
    },
    brave: {
        macos: ['Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'],
        linux: ['.config', 'BraveSoftware', 'Brave-Browser'],
        windows: { path: ['BraveSoftware', 'Brave-Browser', 'User Data'] }
    },
    arc: {
        macos: ['Library', 'Application Support', 'Arc', 'User Data'],
        linux: [],
        windows: { path: ['Arc', 'User Data'] }
    },
    chromium: {
        macos: ['Library', 'Application Support', 'Chromium'],
        linux: ['.config', 'chromium'],
        windows: { path: ['Chromium', 'User Data'] }
    },
    edge: {
        macos: ['Library', 'Application Support', 'Microsoft Edge'],
        linux: ['.config', 'microsoft-edge'],
        windows: { path: ['Microsoft', 'Edge', 'User Data'] }
    },
    vivaldi: {
        macos: ['Library', 'Application Support', 'Vivaldi'],
        linux: ['.config', 'vivaldi'],
        windows: { path: ['Vivaldi', 'User Data'] }
    },
    opera: {
        macos: ['Library', 'Application Support', 'com.operasoftware.Opera'],
        linux: ['.config', 'opera'],
        windows: { path: ['Opera Software', 'Opera Stable'], useRoaming: true }
    }
};

export interface BrowserProfileRoot {
    browser: ChromeFamilyBrowser;
    path: string;
}

/**
 * The official `ND0()`: every profile root worth reading on this platform.
 * A browser with no path for the platform (arc on linux) is skipped, exactly as
 * the official's `if(Y&&Y.length>0)` skips it.
 */
export function browserProfileRoots(platform: string, homedir: string): BrowserProfileRoot[] {
    const roots: BrowserProfileRoot[] = [];
    for (const browser of CHROME_FAMILY_BROWSERS) {
        const location = BROWSER_PROFILE_LOCATIONS[browser];
        if (platform === 'win32') {
            if (location.windows.path.length > 0) {
                const base = location.windows.useRoaming
                    ? path.join(homedir, 'AppData', 'Roaming')
                    : path.join(homedir, 'AppData', 'Local');
                roots.push({ browser, path: path.join(base, ...location.windows.path) });
            }
            continue;
        }
        const segments =
            platform === 'darwin' ? location.macos : platform === 'linux' ? location.linux : undefined;
        if (segments && segments.length > 0) {
            roots.push({ browser, path: path.join(homedir, ...segments) });
        }
    }
    return roots;
}

/**
 * The official `filterBrowserTabs($,Q)`: turn the MCP's tab list into the
 * `@`-mention rows the composer's dropdown shows, filtered by what the user has
 * typed. Selecting a row inserts `@<path>`, which is why `path` is exactly the
 * form the `@browser` regex parses back (`browser:<group>:<id>:<url>`, or
 * `browser:new_tab` for the synthetic "new tab" row).
 */
export function browserTabEntries(
    tabs: Array<{ tabGroupId: string; tabId: number; title: string; url: string }>,
    query: string | undefined
): Array<{ path: string; name: string; type: 'browser' }> {
    const needle = query?.toLowerCase() ?? '';
    return tabs
        .filter((tab) =>
            !query
                ? true
                : `browser:${tab.title}`.toLowerCase().includes(needle) || tab.url.toLowerCase().includes(needle)
        )
        .map((tab) => ({
            path:
                tab.tabGroupId === '' && tab.tabId === 0
                    ? 'browser:new_tab'
                    : `browser:${tab.tabGroupId}:${tab.tabId}:${tab.url}`,
            name: `browser:${tab.title.replace(/ /g, '_')}`,
            type: 'browser' as const
        }));
}

/** What `findChromeExtension` needs from the filesystem: two `readdir` calls. */
export interface ChromeExtensionProbe {
    /** Directory entries of `dir`, or a rejection. */
    listDirectories(dir: string): Promise<string[]>;
    /** Resolves when `dir` exists (the official uses a bare `readdir`). */
    exists(dir: string): Promise<boolean>;
}

/**
 * The official `ZD0`: walk each root's `Default` / `Profile N` directories and
 * answer on the first `<profile>/Extensions/<id>` that reads. A root that is
 * simply absent is skipped (`VG$(K)` -> continue); anything else the official
 * rethrows, and so does this.
 */
export async function findChromeExtension(
    roots: BrowserProfileRoot[],
    probe: ChromeExtensionProbe
): Promise<{ isInstalled: boolean; browser: ChromeFamilyBrowser | null }> {
    if (roots.length === 0) return { isInstalled: false, browser: null };
    const ids = chromeExtensionIds();
    for (const { browser, path: root } of roots) {
        let entries: string[];
        try {
            entries = await probe.listDirectories(root);
        } catch {
            continue;
        }
        const profiles = entries.filter((name) => name === 'Default' || name.startsWith('Profile '));
        for (const profile of profiles) {
            for (const id of ids) {
                if (await probe.exists(path.join(root, profile, 'Extensions', id))) {
                    return { isInstalled: true, browser };
                }
            }
        }
    }
    return { isInstalled: false, browser: null };
}
