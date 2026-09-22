/**
 * Step 31: the Customize rows open the matching Settings tab.
 *
 * This is the request that replaces `open_config_file` `command:forge.openSettings`.
 * What is under test is the B3 property: the webview names a **tab**, the set of
 * tabs is closed, and an unknown one opens General and runs nothing else.
 */
import { describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { FORGE_SETTINGS_TABS, isForgeSettingsTab } from '../src/shared/messages';
import { handleOpenForgeSettings } from '../src/services/claude/handlers/handlers';

function contextFor() {
    const openEditorPage = vi.fn();
    const warn = vi.fn();
    const context = {
        logService: { info: vi.fn(), warn, error: vi.fn() },
        webViewService: { openEditorPage },
    } as any;
    return { context, openEditorPage, warn };
}

const open = (tab?: unknown) =>
    handleOpenForgeSettings({ type: 'open_forge_settings', tab } as any, contextFor().context);

describe('isForgeSettingsTab', () => {
    it('accepts every real tab id', () => {
        for (const tab of FORGE_SETTINGS_TABS) expect(isForgeSettingsTab(tab)).toBe(true);
    });

    it('rejects anything else', () => {
        for (const bad of ['', 'General', 'mcp', 'settings', '../etc', null, undefined, 1, {}, []]) {
            expect(isForgeSettingsTab(bad)).toBe(false);
        }
    });
});

describe('handleOpenForgeSettings', () => {
    it('opens the Settings page on each tab, as a singleton', async () => {
        for (const tab of FORGE_SETTINGS_TABS) {
            const { context, openEditorPage } = contextFor();
            const response = await handleOpenForgeSettings({ type: 'open_forge_settings', tab } as any, context);
            expect(response).toEqual({ type: 'open_forge_settings_response', tab });
            expect(openEditorPage).toHaveBeenCalledWith('settings', 'Forge Settings', undefined, { tab });
        }
    });

    it('opens General when no tab is given, without warning', async () => {
        const { context, openEditorPage, warn } = contextFor();
        const response = await handleOpenForgeSettings({ type: 'open_forge_settings' } as any, context);
        expect(response).toEqual({ type: 'open_forge_settings_response', tab: 'general' });
        expect(openEditorPage).toHaveBeenCalledWith('settings', 'Forge Settings', undefined, { tab: 'general' });
        expect(warn).not.toHaveBeenCalled();
    });

    it('falls back to General for an unknown tab, says so, and runs nothing else', async () => {
        for (const bad of ['nope', 'General', '../../etc/passwd', 'command:forge.openSettings', 42, null, {}]) {
            const { context, openEditorPage, warn } = contextFor();
            const response = await handleOpenForgeSettings(
                { type: 'open_forge_settings', tab: bad } as any,
                context
            );
            expect(response).toEqual({ type: 'open_forge_settings_response', tab: 'general' });
            expect(openEditorPage).toHaveBeenCalledTimes(1);
            expect(openEditorPage).toHaveBeenCalledWith('settings', 'Forge Settings', undefined, { tab: 'general' });
            expect(warn).toHaveBeenCalledTimes(1);
        }
    });

    it('never reaches a VS Code command', async () => {
        // The handler's only side effect is `openEditorPage`. If a command were
        // ever run from here, this context -- which has no command runner at all
        // -- would throw rather than silently allowing it.
        await expect(open('hooks')).resolves.toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// The two lists must not drift
// ---------------------------------------------------------------------------

describe('FORGE_SETTINGS_TABS', () => {
    const settingsPage = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'webview', 'src', 'pages', 'SettingsPage.vue'),
        'utf8'
    );

    it('is exactly the ids SettingsPage renders', () => {
        const rendered = [...settingsPage.matchAll(/\{ id: '([a-z-]+)', label:/g)].map((m) => m[1]);
        expect(rendered.length).toBeGreaterThan(0);
        expect([...rendered].sort()).toEqual([...FORGE_SETTINGS_TABS].sort());
    });

    it('is exactly the ids SettingsPage can switch to', () => {
        const cases = [...settingsPage.matchAll(/case '([a-z-]+)':\s*\n\s*return SettingsTab/g)].map((m) => m[1]);
        expect([...cases].sort()).toEqual([...FORGE_SETTINGS_TABS].sort());
    });

    it('has a tab for every file in components/settings/tabs', () => {
        const dir = path.join(__dirname, '..', 'src', 'webview', 'src', 'components', 'settings', 'tabs');
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.vue'));
        // One tab component per id, plus `SettingsTabAgent.vue`, which is not a
        // Settings tab -- it is the agent editor reached from the Agents view.
        expect(files.length).toBe(FORGE_SETTINGS_TABS.length + 1);
        expect(files).toContain('SettingsTabAgent.vue');
    });
});

// ---------------------------------------------------------------------------
// The rows the "/" menu wires to it
// ---------------------------------------------------------------------------

describe('the Customize rows', () => {
    const buttonArea = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'webview', 'src', 'components', 'ButtonArea.vue'),
        'utf8'
    );

    it('each send openForgeSettings with the tab they name', () => {
        // Wrapped in `runHostAction` since the merge with the endpoints line: a
        // row whose request the host rejects used to close the menu and do
        // nothing visible at all, so the rejection is surfaced instead.
        const wired = Object.fromEntries(
            [
                ...buttonArea.matchAll(
                    /case '([a-z-]+)': return runHostAction\('[^']*', \(\) => transport\.openForgeSettings\('([a-z-]+)'\)\)/g
                ),
            ].map((m) => [m[1], m[2]])
        );
        expect(wired).toEqual({
            'mcp-config': 'mcp-servers',
            'hooks-config': 'hooks',
            plugins: 'plugins',
            'browse-slash-commands': 'slash-commands',
            // Forge-only, from the endpoints line.
            endpoints: 'endpoints',
        });
        for (const tab of Object.values(wired)) expect(isForgeSettingsTab(tab)).toBe(true);
    });

    it('no longer opens Settings by naming a VS Code command', () => {
        expect(buttonArea).not.toContain('command:forge.openSettings');
    });
});
