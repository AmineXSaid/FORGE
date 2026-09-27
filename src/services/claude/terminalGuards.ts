/**
 * The small-model guards for "Open Forge in Terminal": the extension as a host
 * of the Forge SDK's CLI guards. It owns the one hook server (started on the
 * first terminal, never keeping VS Code alive), and supplies what only VS Code
 * has: the language servers' diagnostics and a warning when a guard stops a
 * turn, since a terminal has no chat to show it in.
 */
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    EditDiagnostics,
    prepareCliGuards,
    startGuardHookServer,
    type CliGuardLaunch,
    type GuardHookServer,
    type GuardLevel,
} from '../../forge-sdk';
import { vscodeDiagnostics } from './editDiagnosticsVscode';

let server: Promise<GuardHookServer> | undefined;
const editDiagnostics = new EditDiagnostics(vscodeDiagnostics);

export async function terminalGuards(level: GuardLevel, log: (line: string) => void): Promise<CliGuardLaunch> {
    if (level === 'off') return { env: {}, dispose: () => {} };
    server ??= startGuardHookServer(log).catch((error) => {
        server = undefined;
        throw error;
    });
    return prepareCliGuards({
        server: await server,
        level,
        dir: path.join(os.tmpdir(), `forge-guards-${process.pid}`),
        log,
        onStop: (message) => void vscode.window.showWarningMessage(message),
        editDiagnostics,
    });
}

/** On deactivate: stop answering, release the port. */
export async function disposeTerminalGuards(): Promise<void> {
    const running = server;
    server = undefined;
    if (running) await (await running).close();
}
