/**
 * Bypass permissions where the CLI refuses it.
 *
 * Found in a Dev Container (2026-09-25): VS Code Server runs as root there.
 * With `forge.allowDangerouslySkipPermissions` on, every launch, in any mode,
 * died with "--dangerously-skip-permissions cannot be used with root/sudo
 * privileges for security reasons". The CLI's rule is ported in
 * `bypassGate.ts`; Forge ignores the setting there and does not offer the row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { BYPASS_REFUSED_AS_ROOT, cliRefusesBypass } from '../src/services/claude/bypassGate';
import { ClaudeSdkService } from '../src/services/claude/ClaudeSdkService';
import { ALLOW_BYPASS_ACTION, handleEnableBypassPermissions } from '../src/services/claude/handlers/handlers';

describe('the CLI rule (isRootOutsideDeliberateSandbox)', () => {
    it('refuses root on Linux outside a sandbox', () => {
        expect(cliRefusesBypass('linux', 0, {})).toBe(true);
    });

    it('allows root in a sandbox the CLI recognises, IS_SANDBOX only as "1"', () => {
        expect(cliRefusesBypass('linux', 0, { IS_SANDBOX: '1' })).toBe(false);
        expect(cliRefusesBypass('linux', 0, { CLAUDE_CODE_BUBBLEWRAP: '1' })).toBe(false);
        expect(cliRefusesBypass('linux', 0, { IS_SANDBOX: 'true' })).toBe(true);
    });

    it('allows a normal user, and Windows', () => {
        expect(cliRefusesBypass('linux', 1000, {})).toBe(false);
        expect(cliRefusesBypass('darwin', 501, {})).toBe(false);
        expect(cliRefusesBypass('win32', undefined, {})).toBe(false);
    });
});

describe('the setting, where the CLI refuses bypass', () => {
    const original = vscode.workspace.getConfiguration;
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    const originalGetuid = Object.getOwnPropertyDescriptor(process, 'getuid');
    let settings: Record<string, unknown>;

    function host(platform: NodeJS.Platform, uid: number | undefined) {
        Object.defineProperty(process, 'platform', { value: platform, configurable: true });
        Object.defineProperty(process, 'getuid', { value: () => uid, configurable: true, writable: true });
    }

    /** The two methods on a stand-in `this`: nothing else of the service is needed. */
    function service() {
        const log = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
        const self: any = { logService: log, bypassIgnoredLogged: false };
        self.getBypassUnavailableReason = ClaudeSdkService.prototype.getBypassUnavailableReason.bind(self);
        self.getAllowDangerouslySkipPermissions = ClaudeSdkService.prototype.getAllowDangerouslySkipPermissions.bind(self);
        return { self, log };
    }

    beforeEach(() => {
        settings = { allowDangerouslySkipPermissions: true, environmentVariables: [] };
        (vscode.workspace as any).getConfiguration = () => ({
            get: (key: string, fallback?: unknown) => (key in settings ? settings[key] : fallback),
        });
    });

    afterEach(() => {
        (vscode.workspace as any).getConfiguration = original;
        Object.defineProperty(process, 'platform', originalPlatform);
        if (originalGetuid) Object.defineProperty(process, 'getuid', originalGetuid);
        else delete (process as any).getuid;
    });

    it('is ignored as root, so the allow option never reaches the CLI, and says why once', () => {
        host('linux', 0);
        const { self, log } = service();
        expect(self.getAllowDangerouslySkipPermissions()).toBe(false);
        expect(self.getAllowDangerouslySkipPermissions()).toBe(false);
        expect(log.warn).toHaveBeenCalledTimes(1);
        expect(log.warn.mock.calls[0][0]).toContain(BYPASS_REFUSED_AS_ROOT);
        expect(self.getBypassUnavailableReason()).toBe(BYPASS_REFUSED_AS_ROOT);
    });

    it('counts IS_SANDBOX set in forge.environmentVariables, which the CLI receives', () => {
        host('linux', 0);
        settings.environmentVariables = [{ name: 'IS_SANDBOX', value: '1' }];
        const { self } = service();
        expect(self.getBypassUnavailableReason()).toBeUndefined();
        expect(self.getAllowDangerouslySkipPermissions()).toBe(true);
    });

    it('still applies for a normal user and on Windows, and stays off when off', () => {
        host('linux', 1000);
        expect(service().self.getAllowDangerouslySkipPermissions()).toBe(true);
        host('win32', undefined);
        expect(service().self.getAllowDangerouslySkipPermissions()).toBe(true);
        settings.allowDangerouslySkipPermissions = false;
        expect(service().self.getAllowDangerouslySkipPermissions()).toBe(false);
    });
});

describe('picking Bypass where the CLI refuses it', () => {
    it('explains, and neither asks nor writes the setting', async () => {
        const update = vi.fn();
        const original = vscode.workspace.getConfiguration;
        (vscode.workspace as any).getConfiguration = () => ({ get: (_k: string, f?: unknown) => f, update });
        const warn = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(ALLOW_BYPASS_ACTION as never);
        try {
            const response = await handleEnableBypassPermissions({ type: 'enable_bypass_permissions' }, {
                logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
                sdkService: {
                    getAllowDangerouslySkipPermissions: () => false,
                    getBypassUnavailableReason: () => BYPASS_REFUSED_AS_ROOT,
                },
                agentService: { getCachedClaudeSettings: () => undefined },
            } as any);
            expect(response.enabled).toBe(false);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0][0]).toBe(`Forge: ${BYPASS_REFUSED_AS_ROOT}`);
            expect(warn.mock.calls[0][1]).toBeUndefined();
            expect(update).not.toHaveBeenCalled();
        } finally {
            (vscode.workspace as any).getConfiguration = original;
            warn.mockRestore();
        }
    });
});
