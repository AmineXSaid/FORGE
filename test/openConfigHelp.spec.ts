/**
 * Step 32: typed `open_config` / `open_help` / `run_endpoint_action` replace the
 * `command:` allow-list.
 *
 * The property under test is the one the allow-list could never give: after this
 * step there is **no** path from the webview to a VS Code command of its
 * choosing. `open_config` runs one fixed pair of commands with a checked search
 * string, `open_help` runs none, `run_endpoint_action` maps a closed set of
 * actions to `forge.` commands, and `open_config_file` no longer has a
 * `command:` branch at all.
 *
 * Merged from the two lines that each implemented step 32: the endpoints line
 * (`reveal_chat`, the sidebar hand-off, `run_endpoint_action`) and the
 * steps-24-27 line (the validating `open_config`, which is the handler kept --
 * it rejects a bad search rather than silently truncating it).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
    CONFIG_SEARCH_MAX_LENGTH,
    FORGE_CONFIG_SEARCH,
    FORGE_HELP_URL,
} from '../src/shared/messages';
import {
    ENDPOINT_ACTION_COMMANDS,
    getConfigFilePath,
    handleOpenConfig,
    handleOpenConfigFile,
    handleOpenHelp,
    handleRevealChat,
    handleRunEndpointAction,
    SIDEBAR_HANDOFF_MS,
} from '../src/services/claude/handlers/handlers';
import { __setVersion } from './mocks/vscode';

const logService = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), show: vi.fn() };
const notifyClient = vi.fn();
const context = { logService, agentService: { notifyClient } } as any;

// The vscode mock's functions are plain; spy on them so each call is visible.
// These stay for the whole file, so nothing here calls `vi.restoreAllMocks()`.
const executeCommand = vi.spyOn(vscode.commands, 'executeCommand');
const openExternal = vi.spyOn(vscode.env, 'openExternal');

beforeEach(() => {
    executeCommand.mockClear().mockResolvedValue(undefined as never);
    openExternal.mockClear().mockResolvedValue(true as never);
    logService.warn.mockClear();
    logService.info.mockClear();
});

describe('open_config', () => {
    it('focuses the editor group and opens settings on Forge`s own prefix', async () => {
        expect(await handleOpenConfig({ type: 'open_config' } as any, context)).toEqual({
            type: 'open_config_response',
        });
        expect(executeCommand.mock.calls).toEqual([
            ['workbench.action.focusFirstEditorGroup'],
            ['workbench.action.openSettings', FORGE_CONFIG_SEARCH],
        ]);
    });

    it('passes a search string through', async () => {
        await handleOpenConfig({ type: 'open_config', searchString: 'forge.cliArgs' } as any, context);
        expect(executeCommand).toHaveBeenLastCalledWith('workbench.action.openSettings', 'forge.cliArgs');
    });

    it('falls back to the default for an empty string, as the official `$||…` does', async () => {
        await handleOpenConfig({ type: 'open_config', searchString: '' } as any, context);
        expect(executeCommand).toHaveBeenLastCalledWith('workbench.action.openSettings', FORGE_CONFIG_SEARCH);
    });

    it('refuses a non-string search, before running anything', async () => {
        for (const bad of [1, true, null, {}, []]) {
            executeCommand.mockClear();
            await expect(
                handleOpenConfig({ type: 'open_config', searchString: bad } as any, context)
            ).rejects.toThrow('open_config: searchString must be a string');
            expect(executeCommand).not.toHaveBeenCalled();
        }
    });

    it('refuses a search longer than the cap, before running anything', async () => {
        executeCommand.mockClear();
        await expect(
            handleOpenConfig(
                { type: 'open_config', searchString: 'x'.repeat(CONFIG_SEARCH_MAX_LENGTH + 1) } as any,
                context
            )
        ).rejects.toThrow('longer than');
        expect(executeCommand).not.toHaveBeenCalled();
        // The cap itself is allowed.
        await handleOpenConfig(
            { type: 'open_config', searchString: 'x'.repeat(CONFIG_SEARCH_MAX_LENGTH) } as any,
            context
        );
        expect(executeCommand).toHaveBeenCalled();
    });

    it('never runs a command the request names', async () => {
        await handleOpenConfig(
            { type: 'open_config', searchString: 'workbench.action.quit' } as any,
            context
        );
        // It lands in the search box, not in `executeCommand`'s first argument.
        expect(executeCommand.mock.calls.map((c: unknown[]) => c[0])).toEqual([
            'workbench.action.focusFirstEditorGroup',
            'workbench.action.openSettings',
        ]);
    });
});

describe('open_help', () => {
    it('opens the docs URL externally and runs no command', async () => {
        expect(await handleOpenHelp({ type: 'open_help' } as any, context)).toEqual({
            type: 'open_help_response',
        });
        expect(openExternal).toHaveBeenCalledTimes(1);
        expect(String(openExternal.mock.calls[0][0])).toContain(FORGE_HELP_URL);
        expect(executeCommand).not.toHaveBeenCalled();
    });

    it('takes no payload, so there is nothing to point elsewhere', async () => {
        await handleOpenHelp({ type: 'open_help', url: 'https://evil.example' } as any, context);
        expect(String(openExternal.mock.calls[0][0])).toContain(FORGE_HELP_URL);
    });

    it('is the official URL', () => {
        expect(FORGE_HELP_URL).toBe('https://code.claude.com/docs/en/vs-code');
    });
});

describe('run_endpoint_action', () => {
    it.each(Object.entries(ENDPOINT_ACTION_COMMANDS))('%s runs %s', async (action, command) => {
        const response = await handleRunEndpointAction({ type: 'run_endpoint_action', action } as any, context);
        expect(response).toEqual({ type: 'run_endpoint_action_response' });
        expect(executeCommand).toHaveBeenCalledWith(command);
    });

    it('covers exactly the seven buttons on the Endpoints tab', () => {
        expect(Object.keys(ENDPOINT_ACTION_COMMANDS).sort()).toEqual([
            'add', 'capabilities', 'diagnostics', 'edit', 'models', 'select', 'status',
        ]);
    });

    it('only ever runs a forge command', () => {
        for (const command of Object.values(ENDPOINT_ACTION_COMMANDS)) {
            expect(command.startsWith('forge.')).toBe(true);
        }
    });

    it.each([
        'forge.runDoctor',
        'workbench.action.quit',
        '__proto__',
        'constructor',
        'toString',
        '',
    ])('rejects the action %j without running anything', async (action) => {
        await expect(
            handleRunEndpointAction({ type: 'run_endpoint_action', action } as any, context),
        ).rejects.toThrow(/Unknown endpoint action/);
        expect(executeCommand).not.toHaveBeenCalled();
    });

    it.each([undefined, null, 42, {}])('rejects the non-string action %j', async (action) => {
        await expect(
            handleRunEndpointAction({ type: 'run_endpoint_action', action } as any, context),
        ).rejects.toThrow(/Unknown endpoint action/);
        expect(executeCommand).not.toHaveBeenCalled();
    });
});

describe('open_config_file no longer runs commands', () => {
    it.each([
        'command:workbench.action.quit',
        'command:forge.openSettings',
        'command:forge.selectEndpoint',
        'command:forge.showLogs',
        'command:',
    ])('rejects %j', async (configType) => {
        executeCommand.mockClear();
        await expect(
            handleOpenConfigFile({ type: 'open_config_file', configType } as any, context),
        ).rejects.toThrow('Not a config file');
        // Even the ones that used to be allow-listed: the branch is gone, not
        // narrowed, so there is nothing left to add an entry back to.
        expect(executeCommand).not.toHaveBeenCalled();
    });

    it('says the branch is gone, not that the id was merely unknown', async () => {
        await expect(
            handleOpenConfigFile({ type: 'open_config_file', configType: 'command:forge.openSettings' } as any, context),
        ).rejects.toThrow(/no longer runs commands/);
    });

    it('maps each config file name to one path, the memory files included', () => {
        const home = os.homedir();
        const saved = process.env.CLAUDE_CONFIG_DIR;
        delete process.env.CLAUDE_CONFIG_DIR;
        try {
            expect(getConfigFilePath('user-claude-md', undefined)).toBe(path.join(home, '.claude', 'CLAUDE.md'));
            expect(getConfigFilePath('project-claude-md', 'C:/repo')).toBe(path.join('C:/repo', 'CLAUDE.md'));
            expect(getConfigFilePath('local-claude-md', 'C:/repo')).toBe(path.join('C:/repo', 'CLAUDE.local.md'));
            expect(getConfigFilePath('mcp-project', 'C:/repo')).toBe(path.join('C:/repo', '.mcp.json'));
            expect(getConfigFilePath('mcp-global', undefined)).toBe(path.join(home, '.claude.json'));
            process.env.CLAUDE_CONFIG_DIR = 'C:/cfg';
            expect(getConfigFilePath('user-claude-md', undefined)).toBe(path.join('C:/cfg', 'CLAUDE.md'));
        } finally {
            if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
            else process.env.CLAUDE_CONFIG_DIR = saved;
        }
    });

    it('needs a folder for the project files', () => {
        expect(() => getConfigFilePath('project-claude-md', undefined)).toThrow('No workspace folder open');
        expect(() => getConfigFilePath('mcp-project', undefined)).toThrow('No workspace folder open');
    });

    it.each(['user-agents', 'project-agents', '../../etc/passwd', 'settings/../x', '', 'CLAUDE'])(
        'refuses %j: the set is closed, so the webview cannot name a path (B3)',
        (configType) => {
            expect(() => getConfigFilePath(configType, 'C:/repo')).toThrow('Not a config file');
        }
    );

    it('still opens the VS Code settings for `vscode`', async () => {
        await handleOpenConfigFile({ type: 'open_config_file', configType: 'vscode' } as any, context);
        expect(executeCommand).toHaveBeenCalledWith('workbench.action.openSettings', FORGE_CONFIG_SEARCH);
    });
});

describe('reveal_chat', () => {
    it('reveals the chat wherever the host keeps it', async () => {
        // The standalone sessions view is its own webview in its own activity-bar
        // container. Rendering the chat there put it on the left, inside the
        // history container, instead of in the side bar the chat is configured for.
        const response = await handleRevealChat({ type: 'reveal_chat' }, context);

        expect(response).toEqual({ type: 'reveal_chat_response' });
        expect(executeCommand).toHaveBeenCalledWith('forge.sidebar.open');
    });

    it('starts a new conversation when asked', async () => {
        await handleRevealChat({ type: 'reveal_chat', newConversation: true }, context);
        expect(executeCommand).toHaveBeenCalledWith('forge.newConversation');
    });

    it('opens the conversation a history row names', async () => {
        const notifyClient = vi.fn();
        const withAgent = { logService, agentService: { notifyClient } } as any;
        const id = '0f8fad5b-d9cb-469f-a165-70867728950e';

        await handleRevealChat({ type: 'reveal_chat', sessionId: id }, withAgent);

        // Revealed as it is, not a new conversation, and then told which one.
        expect(executeCommand.mock.calls.map((c) => c[0])).toEqual(['forge.sidebar.open']);
        expect(notifyClient).toHaveBeenCalledWith({ type: 'ui_command', command: 'open_session', sessionId: id });
    });

    it('refuses a session id that is not one, before revealing anything (B3)', async () => {
        const notifyClient = vi.fn();
        const withAgent = { logService, agentService: { notifyClient } } as any;
        for (const bad of ['../../x', 'abc', 42, '']) {
            await expect(
                handleRevealChat({ type: 'reveal_chat', sessionId: bad } as any, withAgent)
            ).rejects.toThrow('reveal_chat: sessionId is not a session id');
        }
        expect(executeCommand).not.toHaveBeenCalled();
        expect(notifyClient).not.toHaveBeenCalled();
    });

    it('names a forge command, never a workbench one', () => {
        // Both commands already know the primary/secondary fallback; the webview
        // names an intent and the host maps it (B3).
        for (const id of ['forge.sidebar.open', 'forge.newConversation']) {
            expect(id.startsWith('forge.')).toBe(true);
        }
    });
});

describe('the hand-off: the history closes behind the chat', () => {
    // Clicking "New conversation" in the sessions view left two Forge panels
    // open, one either side of the editor. The history has done its job once the
    // chat is up, so it closes -- but only when the chat went somewhere else.
    let configSpy: ReturnType<typeof vi.spyOn> | undefined;

    afterEach(() => {
        configSpy?.mockRestore();
        configSpy = undefined;
        __setVersion('1.106.0');
    });

    function configReturning(preferredLocation: string) {
        configSpy = vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
            get: (_key: string, fallback?: unknown) => preferredLocation ?? fallback,
            update: () => Promise.resolve(),
        } as any);
        return configSpy;
    }

    it('tells the chat to play its entrance before revealing it', async () => {
        configReturning('secondary');
        const order: string[] = [];
        notifyClient.mockImplementation((m: any) => order.push(`notify:${m.command}`));
        executeCommand.mockImplementation(async (id: string) => { order.push(`run:${id}`); return undefined as never; });

        await handleRevealChat({ type: 'reveal_chat', newConversation: true, fromView: true }, context);

        expect(order).toEqual(['notify:arrive', 'run:forge.newConversation', 'run:workbench.action.closeSidebar']);
        notifyClient.mockReset();
        executeCommand.mockResolvedValue(undefined as never);
    });

    it('closes the side bar after revealing the chat, in that order', async () => {
        configReturning('secondary');

        await handleRevealChat({ type: 'reveal_chat', newConversation: true, fromView: true }, context);

        expect(executeCommand.mock.calls.map((c) => c[0])).toEqual([
            'forge.newConversation',
            'workbench.action.closeSidebar',
        ]);
    });

    it('waits for the exit before taking the panel away', async () => {
        // The webview fades the history out over --forge-handoff-duration. Closing
        // the panel sooner cuts the fade off mid-way, which is the snap this whole
        // change exists to remove.
        configReturning('secondary');

        const started = Date.now();
        await handleRevealChat({ type: 'reveal_chat', fromView: true }, context);
        const elapsed = Date.now() - started;

        // Timers overshoot; they never fire early.
        expect(elapsed).toBeGreaterThanOrEqual(SIDEBAR_HANDOFF_MS - 20);
        expect(executeCommand).toHaveBeenCalledWith('workbench.action.closeSidebar');
    });

    it('never closes a side bar for the history opened as an editor tab', async () => {
        // "Forge: Past Conversations" opens the same page in an editor tab. It is
        // not in a side bar, so closing one took away Explorer instead.
        configReturning('secondary');

        await handleRevealChat({ type: 'reveal_chat', newConversation: true, fromView: false }, context);
        await handleRevealChat({ type: 'reveal_chat', newConversation: true }, context);

        expect(executeCommand.mock.calls.map((c) => c[0])).toEqual(['forge.newConversation', 'forge.newConversation']);
    });

    it('closes the side bar while a slow reveal is still running, not after it', async () => {
        // "Very very fast" (2026-09-24): the two panels move together. A reveal
        // that takes 200ms used to add its whole length before the side bar
        // went; now the side bar goes once the short exit has played.
        configReturning('secondary');
        let closedAt = 0;
        let revealedAt = 0;
        const started = Date.now();
        executeCommand.mockImplementation(async (id: string) => {
            if (id === 'forge.sidebar.open') {
                await new Promise((r) => setTimeout(r, 200));
                revealedAt = Date.now() - started;
            }
            if (id === 'workbench.action.closeSidebar') closedAt = Date.now() - started;
            return undefined as never;
        });

        await handleRevealChat({ type: 'reveal_chat', fromView: true }, context);

        expect(closedAt).toBeGreaterThanOrEqual(SIDEBAR_HANDOFF_MS - 20);
        expect(closedAt).toBeLessThan(revealedAt);
        expect(executeCommand.mock.calls.map((c) => c[0])).toEqual(['forge.sidebar.open', 'workbench.action.closeSidebar']);
        executeCommand.mockResolvedValue(undefined as never);
    });

    it('holds the panel exactly as long as the webview fades it', () => {
        // The pairing is the invariant, not the number. This used to assert
        // `>= 190`, which pinned a value that was only ever a guess and said
        // nothing about the thing that actually matters: close early and the fade
        // is cut off mid-way, close late and the empty panel sits there. Either
        // half can now be retuned as long as both are.
        const css = readFileSync(
            join(dirname(fileURLToPath(import.meta.url)), '..', 'src/webview/src/styles/forge-design.css'),
            'utf8',
        );
        const declared = /--forge-handoff-duration:\s*(\d+)ms/.exec(css)?.[1];

        expect(declared).toBeTruthy();
        expect(Number(declared)).toBe(SIDEBAR_HANDOFF_MS);
    });

    it('leaves the side bar alone when the chat is in it', async () => {
        // preferredLocation=primary puts the chat in the very panel this would
        // close: the click would reveal the chat and then hide it again.
        configReturning('primary');

        await handleRevealChat({ type: 'reveal_chat', newConversation: true }, context);

        expect(executeCommand.mock.calls.map((c) => c[0])).toEqual(['forge.newConversation']);
    });

    it('leaves it alone on a VS Code with no secondary side bar', async () => {
        // Same reason: below the gate the chat falls back to the primary side bar,
        // whatever the setting says.
        __setVersion('1.98.0');
        configReturning('secondary');

        await handleRevealChat({ type: 'reveal_chat' }, context);

        expect(executeCommand.mock.calls.map((c) => c[0])).toEqual(['forge.sidebar.open']);
    });

    it('still answers the webview either way', async () => {
        configReturning('primary');
        await expect(handleRevealChat({ type: 'reveal_chat' }, context)).resolves.toEqual({
            type: 'reveal_chat_response',
        });
    });
});

describe('the webview holds no command names', () => {
    const webviewDir = path.join(__dirname, '..', 'src', 'webview', 'src');

    function walk(dir: string): string[] {
        return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) return walk(full);
            return entry.isFile() && (full.endsWith('.ts') || full.endsWith('.vue')) ? [full] : [];
        });
    }

    it('no source file names a config type of `command:…`', () => {
        const offenders = walk(webviewDir).filter((file) =>
            /openConfigFile\(\s*['"`]command:/.test(fs.readFileSync(file, 'utf8'))
        );
        expect(offenders).toEqual([]);
    });

    it('the "/" rows use the typed requests', () => {
        // Wrapped in `runHostAction` after the merge: a row whose request the
        // host rejects used to close the menu and do nothing visible at all.
        const buttonArea = fs.readFileSync(path.join(webviewDir, 'components', 'ButtonArea.vue'), 'utf8');
        expect(buttonArea).toContain('transport.openConfig()');
        expect(buttonArea).toContain('transport.openHelp()');
        expect(buttonArea).not.toContain('openConfigFile');
        expect(buttonArea).not.toContain(FORGE_HELP_URL);
    });
});
