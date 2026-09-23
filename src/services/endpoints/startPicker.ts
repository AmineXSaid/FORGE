/**
 * The first step of "Add endpoint": where to start from.
 *
 * It used to wait for the local-runtime probe before showing anything. The
 * probe ran behind a status-bar spinner (`ProgressLocation.Window`), so the
 * click that started it -- "Set up an endpoint" on the welcome page, most
 * often the very first thing a new user presses -- looked like it did nothing
 * for as long as the probe took. On a machine where loopback is slow to refuse,
 * or routed through a proxy, that was many seconds.
 *
 * Now the picker opens on the click, marked busy, with every runtime listed as
 * "checking…", and fills in as each probe settles. It can be answered at any
 * moment: picking a runtime before its probe has answered simply takes the
 * five questions instead of the shortcut.
 *
 * `vscode` is reached only through the `QuickPickLike` the caller hands in, so
 * the spec drives this with a plain object.
 */
import {
    LOCAL_RUNTIMES,
    boundedProbe,
    discoverLocalRuntimes,
    type Discovery,
    type LocalRuntime,
    type ModelProbe,
} from './discover';

export interface StartItem {
    label: string;
    description?: string;
    detail?: string;
    alwaysShow?: boolean;
    /** Set once the runtime has answered. */
    found?: Discovery;
    runtime?: LocalRuntime;
    /** `edit`: open settings.json instead of asking. */
    action?: 'edit';
}

/** Where each runtime's probe stands. */
export type ProbeState = 'checking' | 'running' | 'absent';

/**
 * The rows, in a stable order: what is running first, then what is still
 * being checked or was not found (in `LOCAL_RUNTIMES` order), then the two
 * ways that do not depend on a local server.
 */
export function startItems(
    states: ReadonlyMap<string, ProbeState>,
    found: ReadonlyMap<string, Discovery>,
): StartItem[] {
    const running: StartItem[] = [];
    const rest: StartItem[] = [];
    for (const runtime of LOCAL_RUNTIMES) {
        const state = states.get(runtime.id) ?? 'checking';
        const discovery = found.get(runtime.id);
        if (state === 'running' && discovery) {
            const n = discovery.models.length;
            running.push({
                label: `$(pass-filled) ${runtime.label}`,
                description: 'running now',
                detail: `${n} model${n === 1 ? '' : 's'} on ${runtime.baseUrl}`,
                found: discovery,
                runtime,
            });
        } else {
            rest.push({
                label: `${state === 'checking' ? '$(loading~spin)' : '$(circle-outline)'} ${runtime.label}`,
                description: state === 'checking' ? 'checking…' : 'not detected',
                detail: runtime.hint,
                runtime,
            });
        }
    }
    return [
        ...running,
        ...rest,
        {
            label: '$(cloud) A gateway or hosted endpoint…',
            detail: 'A company gateway, a relay, anything reachable over the network.',
            alwaysShow: true,
        },
        {
            label: '$(json) Edit settings.json instead',
            detail: 'Everything this flow does not ask for: TLS, proxies, header maps, capabilities.',
            action: 'edit',
            alwaysShow: true,
        },
    ];
}

/** Placeholder text for the picker, as the probes stand. */
export function startPlaceholder(done: boolean, runningCount: number): string {
    if (!done) return 'Looking for model servers running here… or pick one below';
    if (runningCount > 0) {
        return `Found ${runningCount} model server${runningCount === 1 ? '' : 's'} running here`;
    }
    return 'Nothing running locally. Pick a runtime, or a gateway';
}

/** The slice of `vscode.QuickPick` this uses. */
export interface QuickPickLike<T> {
    title: string | undefined;
    placeholder: string | undefined;
    items: readonly T[];
    busy: boolean;
    ignoreFocusOut: boolean;
    readonly selectedItems: readonly T[];
    onDidAccept(listener: () => void): { dispose(): unknown };
    onDidHide(listener: () => void): { dispose(): unknown };
    show(): void;
    hide(): void;
    dispose(): void;
}

/**
 * Show the start picker at once and resolve with what was picked, or
 * `undefined` if it was dismissed.
 */
export function pickEndpointStart(
    quickPick: QuickPickLike<StartItem>,
    probe: ModelProbe,
    options: { timeoutMs?: number } = {},
): Promise<StartItem | undefined> {
    const states = new Map<string, ProbeState>(LOCAL_RUNTIMES.map((r) => [r.id, 'checking' as ProbeState]));
    const found = new Map<string, Discovery>();
    let done = false;
    let settled = false;

    const render = () => {
        if (settled) return;
        quickPick.items = startItems(states, found);
        quickPick.placeholder = startPlaceholder(done, found.size);
        quickPick.busy = !done;
    };

    quickPick.title = 'Add endpoint';
    render();
    quickPick.show();

    void discoverLocalRuntimes(boundedProbe(probe, options.timeoutMs), (runtime, discovery) => {
        states.set(runtime.id, discovery ? 'running' : 'absent');
        if (discovery) found.set(runtime.id, discovery);
        render();
    }).finally(() => {
        done = true;
        render();
    });

    return new Promise((resolve) => {
        const finish = (item: StartItem | undefined) => {
            if (settled) return;
            settled = true;
            accept.dispose();
            hide.dispose();
            quickPick.dispose();
            resolve(item);
        };
        const accept = quickPick.onDidAccept(() => {
            const item = quickPick.selectedItems[0];
            if (!item) return;
            finish(item);
            quickPick.hide();
        });
        const hide = quickPick.onDidHide(() => finish(undefined));
    });
}
