/**
 * VSCode API Mock for testing
 *
 * Only the surface the extension touches during service registration is mocked.
 * Add to it as tests reach further into the API rather than mocking speculatively.
 */

export const window = {
	/**
	 * Declared so specs can `vi.spyOn(window, 'activeTextEditor', 'get')`.
	 *
	 * `spyOn` with a getter refuses to stub a property that does not exist, and
	 * the selection handler reads this one on every call.
	 */
	activeTextEditor: undefined as unknown,
	onDidChangeActiveTextEditor: (..._args: unknown[]) => ({ dispose: () => { } }),
	onDidChangeTextEditorSelection: (..._args: unknown[]) => ({ dispose: () => { } }),
	/** Read by the selection tracker (`editorSelection.ts`, the official `xd0`). */
	visibleTextEditors: [] as unknown[],
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
	/**
	 * Present so a test can `vi.spyOn` it. The real one returns a live panel;
	 * this one returns nothing, so every test that opens a page replaces it.
	 */
	createWebviewPanel: (..._args: unknown[]): any => undefined,
	/** Present so a test can `vi.spyOn` it (`open_file`, `open_content`). */
	showTextDocument: (..._args: unknown[]): Promise<any> => Promise.resolve(undefined),
	showInputBox: (_options?: unknown) => Promise.resolve(undefined),
	showQuickPick: (_items?: unknown, _options?: unknown) => Promise.resolve(undefined),
	tabGroups: {
		all: [] as any[],
		/**
		 * Which group has focus. Defaults to an empty one so the "is the active
		 * group all Forge tabs?" test is false until a test says otherwise --
		 * an empty group is not a Forge group (`tabs.length > 0`).
		 */
		activeTabGroup: { viewColumn: 1, tabs: [] as any[] } as any,
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
	onDidChangeConfiguration: () => ({ dispose: () => { } }),
	/** The selection tracker clears the selection when its file closes. */
	onDidCloseTextDocument: (..._args: unknown[]) => ({ dispose: () => { } }),
	/** Present so a test can `vi.spyOn` it (`open_file`, `open_content`). */
	openTextDocument: (..._args: unknown[]): Promise<any> => Promise.resolve(undefined),
	/** `open_content` (editable) waits on these. */
	onDidChangeTextDocument: (..._args: unknown[]) => ({ dispose: () => { } }),
	onDidSaveTextDocument: (..._args: unknown[]) => ({ dispose: () => { } })
};

export const commands = {
	registerCommand: () => ({ dispose: () => { } }),
	executeCommand: (..._args: unknown[]) => Promise.resolve(undefined)
};

/** `env.openExternal` is what `open_url` and `open_help` (step 32) go through. */
export const env = {
	openExternal: (_uri: unknown) => Promise.resolve(true),
	shell: '/bin/bash'
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
	parse: (value: string) => ({ fsPath: value, scheme: 'file', toString: () => value }),
	joinPath: (base: { fsPath: string }, ...parts: string[]) => {
		const fsPath = [base.fsPath, ...parts].join('/');
		return { fsPath, scheme: 'file', toString: () => `file://${fsPath}` };
	}
};

export class TabInputTextDiff {
	constructor(readonly original: unknown, readonly modified: unknown) { }
}

/**
 * The tab input VS Code reports for a webview panel.
 *
 * Its `viewType` is the extension's own view type with a workbench prefix,
 * which is why the production code matches on `includes` rather than equality.
 */
export class TabInputWebview {
	constructor(readonly viewType: string) { }
}

/** Mirrors the real `vscode.ViewColumn` enum values the code compares against. */
export const ViewColumn = {
	Active: -1,
	Beside: -2,
	One: 1,
	Two: 2,
	Three: 3,
	Four: 4,
	Five: 5,
	Six: 6,
	Seven: 7,
	Eight: 8,
	Nine: 9
} as const;

export class EventEmitter<T = unknown> {
	private listeners: Array<(e: T) => void> = [];
	readonly event = (listener: (e: T) => void) => {
		this.listeners.push(listener);
		return { dispose: () => { this.listeners = this.listeners.filter((l) => l !== listener); } };
	};
	fire(data: T) { for (const l of this.listeners) l(data); }
	dispose() { this.listeners = []; }
}

/**
 * The running VS Code build.
 *
 * `let`, so a spec can move the gate: `handleRevealChat` reads `vscode.version`
 * to decide whether the chat is in the secondary side bar, and both answers
 * need covering. Live bindings mean an assignment here is seen by the module
 * under test.
 */
export let version = '1.106.0';

export function __setVersion(next: string): void {
	version = next;
}
