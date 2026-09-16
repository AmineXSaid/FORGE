/**
 * VSCode API Mock for testing
 *
 * Only the surface the extension touches during service registration is mocked.
 * Add to it as tests reach further into the API rather than mocking speculatively.
 */

export const window = {
	createOutputChannel: (name: string) => ({
		name,
		appendLine: (text: string) => console.log(text),
		append: (_text: string) => { },
		replace: (_text: string) => { },
		clear: () => { },
		show: () => { },
		hide: () => { },
		dispose: () => { },
		// LogOutputChannel surface
		logLevel: 1,
		onDidChangeLogLevel: () => ({ dispose: () => { } }),
		trace: (..._args: unknown[]) => { },
		debug: (..._args: unknown[]) => { },
		info: (..._args: unknown[]) => { },
		warn: (..._args: unknown[]) => { },
		error: (..._args: unknown[]) => { }
	}),
	showInformationMessage: (_message: string) => Promise.resolve(undefined),
	showWarningMessage: (_message: string) => Promise.resolve(undefined),
	showErrorMessage: (_message: string) => Promise.resolve(undefined),
	registerWebviewViewProvider: () => ({ dispose: () => { } }),
	tabGroups: {
		all: [] as unknown[],
		close: () => Promise.resolve(true),
		onDidChangeTabs: () => ({ dispose: () => { } })
	}
};

export const workspace = {
	workspaceFolders: undefined as unknown[] | undefined,
	getConfiguration: (_section?: string) => ({
		get: (_key: string, defaultValue?: any) => defaultValue,
		update: () => Promise.resolve()
	}),
	asRelativePath: (p: any) => String(p),
	onDidChangeConfiguration: () => ({ dispose: () => { } })
};

export const commands = {
	registerCommand: () => ({ dispose: () => { } }),
	executeCommand: () => Promise.resolve(undefined)
};

/** Mirrors the real `vscode.ExtensionMode` enum values. */
export const ExtensionMode = {
	Production: 1,
	Development: 2,
	Test: 3
} as const;

export const ConfigurationTarget = {
	Global: 1,
	Workspace: 2,
	WorkspaceFolder: 3
} as const;

export const Uri = {
	file: (fsPath: string) => ({ fsPath, scheme: 'file', toString: () => `file://${fsPath}` }),
	parse: (value: string) => ({ fsPath: value, scheme: 'file', toString: () => value })
};

export class TabInputTextDiff {
	constructor(readonly original: unknown, readonly modified: unknown) { }
}

export class EventEmitter<T = unknown> {
	private listeners: Array<(e: T) => void> = [];
	readonly event = (listener: (e: T) => void) => {
		this.listeners.push(listener);
		return { dispose: () => { this.listeners = this.listeners.filter((l) => l !== listener); } };
	};
	fire(data: T) { for (const l of this.listeners) l(data); }
	dispose() { this.listeners = []; }
}
