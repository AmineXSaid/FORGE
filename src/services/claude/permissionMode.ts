/**
 * Permission-mode checks, ported from the official host.
 *
 * Kept free of `vscode` so the specs can import it.
 */
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';

/** The official `YI0` / `ou$`: every mode the SDK accepts (`sdk.d.ts` L2366). */
const PERMISSION_MODES: Readonly<Record<PermissionMode, true>> = {
    default: true,
    acceptEdits: true,
    bypassPermissions: true,
    plan: true,
    dontAsk: true,
    auto: true,
};

export function isPermissionMode(value: unknown): value is PermissionMode {
    return typeof value === 'string' && Object.hasOwn(PERMISSION_MODES, value);
}
