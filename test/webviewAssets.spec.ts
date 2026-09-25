/**
 * A Forge panel whose files cannot be read says so, instead of staying blank.
 *
 * Found on Windows (2026-09-25): the side bar and the editor tab were both
 * empty, and the webview console showed VS Code failing to read
 * `dist/media/main.js` and `style.css` from the installed folder
 * ("Webview.loadLocalResource - Error using fileReader", then 404). The
 * extension code was running; the page it built pointed at two files that were
 * not there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    REINSTALL_ADVICE,
    WEBVIEW_LOAD_GUARD,
    assetsMissingHtml,
    escapeHtml,
    missingWebviewAssets,
} from '../src/services/webviewAssets';

let ext: string;

beforeEach(() => {
    ext = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-assets-'));
});

afterEach(() => {
    fs.rmSync(ext, { recursive: true, force: true });
    vi.restoreAllMocks();
});

function install(...files: string[]): void {
    fs.mkdirSync(path.join(ext, 'dist', 'media'), { recursive: true });
    for (const file of files) fs.writeFileSync(path.join(ext, 'dist', 'media', file), 'x');
}

describe('which of the webview files are missing', () => {
    it('is none in a complete install', () => {
        install('main.js', 'style.css');
        expect(missingWebviewAssets(ext)).toEqual([]);
    });

    it('is both when dist/media is gone, as on the Windows machine', () => {
        expect(missingWebviewAssets(ext)).toEqual([
            path.join(ext, 'dist', 'media', 'main.js'),
            path.join(ext, 'dist', 'media', 'style.css'),
        ]);
    });

    it('is the one file that is gone', () => {
        install('main.js');
        expect(missingWebviewAssets(ext)).toEqual([path.join(ext, 'dist', 'media', 'style.css')]);
    });
});

describe('the page shown instead', () => {
    it('names each missing file, the folder, and the fix', () => {
        const html = assetsMissingHtml('C:\\Users\\me\\.vscode\\extensions\\msaid.forge-0.1.0', [
            'C:\\Users\\me\\.vscode\\extensions\\msaid.forge-0.1.0\\dist\\media\\main.js',
        ]);
        expect(html).toContain('Forge could not load its interface');
        expect(html).toContain('<code>C:\\Users\\me\\.vscode\\extensions\\msaid.forge-0.1.0\\dist\\media\\main.js</code>');
        expect(html).toContain('Delete the folder <code>C:\\Users\\me\\.vscode\\extensions\\msaid.forge-0.1.0</code>');
        expect(html).toContain('Install the Forge VSIX again');
    });

    it('runs no script and loads nothing', () => {
        const html = assetsMissingHtml(ext, [path.join(ext, 'dist', 'media', 'main.js')]);
        expect(html).toContain(`content="default-src 'none'; style-src 'unsafe-inline';"`);
        expect(html).not.toMatch(/<script|<link|src=|href=/);
    });

    it('escapes a path, as the official Wb does', () => {
        expect(escapeHtml(`a<b>"c"&d`)).toBe('a&lt;b&gt;&quot;c&quot;&amp;d');
        const html = assetsMissingHtml('/x/<img src=y onerror=alert(1)>', []);
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;img src=y onerror=alert(1)&gt;');
    });
});

describe('the page the host builds', () => {
    function service(extensionPath: string) {
        const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() };
        const panels: any[] = [];
        vi.spyOn(vscode.window as any, 'createWebviewPanel').mockImplementation(() => {
            const panel = {
                viewColumn: 1,
                webview: { options: {}, html: '', cspSource: 'vscode-resource:', postMessage: vi.fn(), onDidReceiveMessage: vi.fn(), asWebviewUri: (u: any) => u },
                reveal: vi.fn(),
                onDidDispose: vi.fn(),
                onDidChangeViewState: vi.fn(),
            };
            panels.push(panel);
            return panel as never;
        });
        return { log, panels, load: async () => {
            const { WebViewService } = await import('../src/services/webViewService');
            const s = new WebViewService({ extensionPath, extensionMode: 1, subscriptions: [], globalState: { get: () => undefined } } as any, log as any);
            s.openEditorPage('chat', 'Forge', undefined);
            return panels[0].webview.html as string;
        } };
    }

    it('is the app, with the official sentinel and the load guard, when the files are there', async () => {
        install('main.js', 'style.css');
        const { log, load } = service(ext);
        const html = await load();

        expect(html).toContain('<pre id="claude-error"></pre>\n    <div id="app"></div>');
        expect(html).toContain('#claude-error:empty');
        // The guard runs before the stylesheet starts loading, and under the page's nonce.
        const nonce = /'nonce-([^']+)'/.exec(html)![1];
        const guard = html.indexOf(`<script nonce="${nonce}">(function () {`);
        const link = html.indexOf('rel="stylesheet" data-forge-asset');
        expect(guard).toBeGreaterThan(-1);
        expect(link).toBeGreaterThan(guard);
        expect(html).toMatch(/<script type="module" nonce="[^"]+" src="[^"]*main\.js" data-forge-asset><\/script>/);
        expect(log.error).not.toHaveBeenCalled();
    });

    it('explains itself, and logs, when the files are not there', async () => {
        const { log, load } = service(ext);
        const html = await load();

        expect(html).toContain('Forge could not load its interface');
        expect(html).not.toContain('id="app"');
        expect(log.error).toHaveBeenCalledTimes(1);
        const line = log.error.mock.calls[0][0] as string;
        expect(line).toContain(path.join(ext, 'dist', 'media', 'main.js'));
        expect(line).toContain(path.join(ext, 'dist', 'media', 'style.css'));
        expect(line).toContain(REINSTALL_ADVICE);
    });
});

describe('the load guard in the page', () => {
    /** Just enough DOM for the guard: two elements by id, and window's capture listeners. */
    function page() {
        const sentinel = { textContent: '' };
        const app = { childElementCount: 0 };
        let body = false;
        const listeners: Record<string, (e: any) => void> = {};
        const docListeners: Record<string, () => void> = {};
        const document = {
            getElementById: (id: string) => (!body ? null : id === 'claude-error' ? sentinel : id === 'app' ? app : null),
            addEventListener: (type: string, fn: () => void) => { docListeners[type] = fn; },
        };
        const window = {
            addEventListener: (type: string, fn: (e: any) => void, capture: boolean) => {
                expect(capture).toBe(true); // resource errors do not bubble
                listeners[type] = fn;
            },
        };
        new Function('window', 'document', WEBVIEW_LOAD_GUARD)(window, document);
        const element = (attrs: Record<string, string>) => ({
            hasAttribute: (a: string) => a in attrs,
            getAttribute: (a: string) => attrs[a] ?? null,
        });
        return {
            sentinel, app,
            parseBody: () => { body = true; docListeners.DOMContentLoaded?.(); },
            fail: (target: unknown, extra: Record<string, unknown> = {}) => listeners.error({ target, ...extra }),
            element,
        };
    }

    const MAIN = 'https://file%2B.vscode-resource.vscode-cdn.net/c%3A/Users/me/.vscode/extensions/msaid.forge-0.1.0/dist/media/main.js';

    it('shows the script that did not load, decoded', () => {
        const p = page();
        p.parseBody();
        p.fail(p.element({ 'data-forge-asset': '', src: MAIN }));
        expect(p.sentinel.textContent).toContain('Forge could not load its interface: https://file+.vscode-resource.vscode-cdn.net/c:/Users/me/.vscode/extensions/msaid.forge-0.1.0/dist/media/main.js did not load.\n');
        expect(p.sentinel.textContent).toContain(REINSTALL_ADVICE);
    });

    it('keeps a stylesheet failure that arrives before <body> exists', () => {
        const p = page();
        p.fail(p.element({ 'data-forge-asset': '', href: 'https://x/dist/media/style.css' }));
        expect(p.sentinel.textContent).toBe('');
        p.parseBody();
        expect(p.sentinel.textContent).toContain('https://x/dist/media/style.css did not load');
    });

    it('keeps the first failure, not the last', () => {
        const p = page();
        p.parseBody();
        p.fail(p.element({ 'data-forge-asset': '', href: 'https://x/style.css' }));
        p.fail(p.element({ 'data-forge-asset': '', src: 'https://x/main.js' }));
        expect(p.sentinel.textContent).toContain('style.css did not load');
    });

    it('shows an error thrown before the app mounted, and none after', () => {
        const p = page();
        p.parseBody();
        p.app.childElementCount = 1;
        p.fail({}, { error: new Error('late'), message: 'late' });
        expect(p.sentinel.textContent).toBe('');
        p.app.childElementCount = 0;
        p.fail({}, { error: new Error('boom'), message: 'boom' });
        expect(p.sentinel.textContent).toMatch(/^Error: boom\n/);
    });

    it('leaves a lazy chunk that fails after startup alone', () => {
        const p = page();
        p.parseBody();
        p.app.childElementCount = 1;
        p.fail(p.element({ src: 'https://x/dist/media/mermaid-chunk.js' }));
        expect(p.sentinel.textContent).toBe('');
    });
});
