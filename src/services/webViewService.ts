/**
 * WebView 服务 / WebView Service
 *
 * 职责：
 * 1. 实现 vscode.WebviewViewProvider 接口
 * 2. 管理 WebView 实例和生命周期
 * 3. 生成 WebView HTML 内容
 * 4. 提供消息收发接口
 */

import { readCollapsedPanelSections } from '../shared/sessionGroups';
import { COLLAPSED_PANEL_SECTIONS_KEY } from './claude/sessionGroupStore';
import * as vscode from 'vscode';
import * as path from 'path';
import { createDecorator } from '../di/instantiation';
import { ILogService } from './logService';

export const IWebViewService = createDecorator<IWebViewService>('webViewService');

export type WebviewHost = 'sidebar' | 'editor';

/**
 * The view type every Forge page panel is created with.
 *
 * VS Code prefixes an extension's webview view type when it reports it back on
 * `TabInputWebview`, which is why the tab test below matches on `includes`
 * rather than equality -- the official does the same with `claudeVSCodePanel`.
 */
const PAGE_VIEW_TYPE = 'forge.pageView';

/**
 * The host pushes that describe shared state rather than one conversation.
 *
 * Every open Forge page renders from them -- the sessions list reads the
 * status feed and the store changes, the welcome gate reads `update_state`
 * and the health verdicts, Settings reads the health table -- so they go to
 * every page, side bar or editor tab. They used to reach the side-bar chat
 * only, which is why a list in its own view never refreshed and a welcome page
 * in an editor tab never learned an endpoint had been added.
 */
const STATE_PUSHES = new Set([
	'update_state',
	'session_states_update',
	'session_store_changed',
	'session_renamed',
	'session_groups_changed',
	'endpoint_health_update',
	'extension_config_changed',
]);

/**
 * `visibility_changed`, in the envelope every host message travels in (a bare
 * post is dropped by the webview's transport, which reads only
 * `from-extension`). A webview that has gone away just drops it.
 */
export function postVisibility(webview: vscode.Webview, isVisible: boolean): void {
	void Promise.resolve(
		webview.postMessage({
			type: 'from-extension',
			message: {
				type: 'request',
				channelId: '',
				requestId: `visibility-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				request: { type: 'visibility_changed', isVisible },
			},
		})
	).catch(() => {});
}

/**
 * The context key the side-bar keybinding reads (`forge.newConversation` on
 * Ctrl+N): true while a side-bar chat is showing. (`forge.blur` on Ctrl+Esc
 * read it too; the official binding is only `!editorTextFocus`.)
 * It was declared in package.json but never set, so neither binding could
 * fire (production audit, 2026-09-24).
 */
export const CTX_SIDE_BAR_ACTIVE = 'forge.sideBarActive';

/**
 * Which side-bar chat views are showing, and the context key that follows
 * them. There are two chat views (primary and secondary side bar), so the key
 * is true while either is visible, not whichever reported last.
 */
export class SideBarActiveTracker {
	private readonly visible = new Set<string>();
	private last: boolean | undefined;

	constructor(private readonly setContext: (key: string, value: boolean) => unknown) {}

	update(viewId: string, isVisible: boolean): void {
		if (isVisible) this.visible.add(viewId);
		else this.visible.delete(viewId);
		const active = this.visible.size > 0;
		if (active === this.last) return;
		this.last = active;
		void Promise.resolve(this.setContext(CTX_SIDE_BAR_ACTIVE, active)).catch(() => {});
	}
}

export function isStatePush(message: any): boolean {
	return message?.type === 'request' && STATE_PUSHES.has(message?.request?.type);
}

/** Is this tab one of Forge's own page panels? The official `R6$`. */
function isForgePanelTab(tab: vscode.Tab): boolean {
	return tab.input instanceof vscode.TabInputWebview
		&& tab.input.viewType.includes(PAGE_VIEW_TYPE);
}

/** A group that holds Forge panels and nothing else. The official `Kb`. */
function isForgeOnlyGroup(group: vscode.TabGroup): boolean {
	return group.tabs.length > 0 && group.tabs.every(isForgePanelTab);
}

/**
 * The editor group Forge already owns, if there is one. The official `on$`.
 *
 * Prefers the active group so a second page joins the one being looked at,
 * and otherwise takes the first Forge-only group anywhere in the workbench.
 */
function forgeOnlyGroup(): vscode.TabGroup | undefined {
	const { activeTabGroup, all } = vscode.window.tabGroups;
	return isForgeOnlyGroup(activeTabGroup) ? activeTabGroup : all.find(isForgeOnlyGroup);
}

/** The first column no tab group occupies, else `Beside`. The official `findUnusedColumn`. */
function findUnusedColumn(): vscode.ViewColumn {
	const taken = new Set<vscode.ViewColumn>();
	vscode.window.tabGroups.all.forEach((group) => {
		if (group.viewColumn !== undefined) taken.add(group.viewColumn);
	});
	for (let column = vscode.ViewColumn.One; column <= vscode.ViewColumn.Nine; column++) {
		if (!taken.has(column)) return column;
	}
	return vscode.ViewColumn.Beside;
}

/**
 * Which editor group a Forge page should open in.
 *
 * Ported from the official host step for step: reuse the group Forge already
 * owns, otherwise take a column nobody is using, and only fall back to `Beside`
 * when all nine are occupied. `startedInNewColumn` is what tells the caller to
 * lock the group afterwards, so opening a file from the chat does not land on
 * top of the chat.
 *
 * Exported because this is the decision the reported defect was about: opening
 * on `ViewColumn.Active` put the page in whatever group the user was editing
 * code in, which is what made Forge look like a file rather than like a panel.
 */
export function chooseEditorColumn(): { column: vscode.ViewColumn; startedInNewColumn: boolean } {
	const owned = forgeOnlyGroup();
	if (owned?.viewColumn !== undefined) {
		return { column: owned.viewColumn, startedInNewColumn: false };
	}
	const column = findUnusedColumn();
	return { column, startedInNewColumn: column !== vscode.ViewColumn.Beside };
}

export interface WebviewBootstrapConfig {
	host: WebviewHost;
	page?: string;
	id?: string;
	/**
	 * Step 31: the Settings tab a freshly created panel should open on.
	 *
	 * The Settings page is a singleton, so "MCP servers" and "Hooks" reveal the
	 * same panel. Without this every row landed on General, which is the defect
	 * `CLAUDE.md` describes as "live but unfinished": the row opens something,
	 * just not the thing it names. A panel that already exists cannot be
	 * re-bootstrapped, so `openEditorPage` posts `select_settings_tab` to it.
	 */
	tab?: string;
	/**
	 * The welcome artwork, one URI per theme.
	 *
	 * Passed in rather than imported by the webview because only the host can
	 * turn a path inside the extension into something a webview is allowed to
	 * load. The official does the same thing through `assetUris["welcome-art"]`,
	 * which also carries a light and a dark cut.
	 */
	welcomeArt?: { light: string; dark: string };
	/**
	 * The session manager's collapsed sections, read when the page is built
	 * (the official `data-initial-collapsed-sections`, its
	 * `collapsedPanelSectionsSeed`), so a collapsed section does not open for a
	 * frame before `get_collapsed_panel_sections` answers.
	 */
	collapsedPanelSections?: string[];
}

export interface IWebViewService extends vscode.WebviewViewProvider {
	readonly _serviceBrand: undefined;

	/**
	 * 获取当前的 WebView 实例（用于部分需要 webviewUri 的场景）
	 */
	getWebView(): vscode.Webview | undefined;

	/**
	 * 向所有已注册 WebView 实例广播消息
	 */
	postMessage(message: any): void;

	/**
	 * 设置消息接收处理器，所有 WebView 的消息都会通过该处理器转发
	 */
	setMessageHandler(handler: (message: any) => void): void;

	/**
	 * 打开（或聚焦）主编辑器中的某个页面
	 *
	 * @param page 页面类型标识，例如 'settings'、'diff'
	 * @param title VSCode 标签标题
	 * @param instanceId 页面实例 ID，用于区分多标签（不传则默认为 page，实现单例）
	 */
	/**
	 * `options.tab` (step 31) selects a Settings tab: on the bootstrap for a new
	 * panel, and by a `select_settings_tab` push when an existing one is revealed.
	 */
	openEditorPage(page: string, title: string, instanceId?: string, options?: { tab?: string }): void;

	/**
	 * A panel showing one Forge page on its own message channel -- its messages
	 * are not routed to the transport. The plan preview (step 17) is one: the
	 * official `yS` talks to its page directly.
	 */
	createPagePanel(viewType: string, title: string, page: string, viewColumn: vscode.ViewColumn): vscode.WebviewPanel;

	/**
	 * Where the official opens the plan preview: the column after the chat's
	 * editor tab, or the first column when the chat is in a sidebar.
	 */
	planPreviewColumn(webviewId?: string): vscode.ViewColumn;

	/**
	 * Fired with a webview's routing id when it goes away and no other webview
	 * has taken that id. A request sent to it (a permission prompt) will never
	 * be answered, so its sender settles it.
	 */
	onDidDisposeWebview(listener: (webviewId: string) => void): vscode.Disposable;

	/**
	 * Retitle the editor panel whose webview has this routing id. False when
	 * no panel has it (a side-bar view has no tab to rename).
	 */
	renamePanel(webviewId: string, title: string): boolean;
}

/**
 * WebView 服务实现
 */
export class WebViewService implements IWebViewService {
	readonly _serviceBrand: undefined;

	private readonly webviews = new Set<vscode.Webview>();
	private readonly webviewConfigs = new Map<vscode.Webview, WebviewBootstrapConfig>();
	private readonly webviewIdMap = new Map<string, vscode.Webview>();
	private messageHandler?: (message: any) => void;
	private readonly editorPanels = new Map<string, vscode.WebviewPanel>();
	private readonly disposeListeners = new Set<(webviewId: string) => void>();
	private readonly sideBarActive = new SideBarActiveTracker(
		(key, value) => vscode.commands.executeCommand('setContext', key, value)
	);

	constructor(
		private readonly context: vscode.ExtensionContext,
		@ILogService private readonly logService: ILogService
	) {}

	/**
	 * 实现 WebviewViewProvider.resolveWebviewView（侧边栏宿主）
	 */
	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void | Thenable<void> {
		// Forge contributes the same provider under several view ids -- chat in the
		// primary sidebar, chat in the secondary sidebar, and the sessions list in
		// its own container. The view id decides which page boots.
		const page = webviewView.viewType.endsWith('sessionsView') ? 'sessions' : 'chat';
		this.logService.info(`Resolving side-bar webview: ${webviewView.viewType} (page=${page})`);

		this.registerWebview(webviewView.webview, {
			host: 'sidebar',
			page,
			// The view id, so the primary and the secondary side-bar chat do not
			// share one routing id: replies to one would reach whichever of the
			// two registered last.
			id: webviewView.viewType
		});

		// The official host's `notifyVisibilityChange`: tell the page when its
		// view is shown or hidden. The views are retained while hidden, so this
		// is how the history knows to re-read its list, and to undo the exit it
		// played when it handed off to the chat.
		webviewView.onDidChangeVisibility(
			() => {
				postVisibility(webviewView.webview, webviewView.visible);
				if (page === 'chat') this.sideBarActive.update(webviewView.viewType, webviewView.visible);
			},
			undefined,
			this.context.subscriptions
		);
		if (page === 'chat') this.sideBarActive.update(webviewView.viewType, webviewView.visible);

		// WebviewView 的销毁由 VSCode 管理，这里仅作日志记录
		webviewView.onDidDispose(
			() => {
				if (page === 'chat') this.sideBarActive.update(webviewView.viewType, false);
				this.removeWebview(webviewView.webview);
				this.logService.info('Side-bar webview disposed');
			},
			undefined,
			this.context.subscriptions
		);

		this.logService.info('Side-bar webview resolved');
	}

	/**
	 * 获取当前的 WebView 实例
	 * 对于多 WebView 场景，这里返回任意一个可用实例（当前仅用于获取资源 URI）
	 */
	getWebView(): vscode.Webview | undefined {
		for (const webview of this.webviews) {
			return webview;
		}
		return undefined;
	}

	/**
	 * 广播消息到所有已注册的 WebView
	 */
	postMessage(message: any): void {
		if (this.webviews.size === 0) {
			this.logService.warn('[WebViewService] No webview is open; the message was dropped');
			return;
		}

		const payload = {
			type: 'from-extension',
			message
		};

		const targetId = message?.webviewId as string | undefined;
		if (targetId) {
			const targetWebview = this.webviewIdMap.get(targetId);
			if (!targetWebview) {
				this.logService.warn(`[WebViewService] No webview with id ${targetId}; the message was dropped`);
				return;
			}
			try {
				targetWebview.postMessage(payload);
			} catch (error) {
				this.logService.warn('[WebViewService] Could not post to the target webview; removing it', error as Error);
				this.removeWebview(targetWebview);
			}
			return;
		}

		// Untargeted: a state push reaches every Forge page, anything else only
		// the side-bar chat (the old default, kept so a palette command or a
		// channel message without an owner does not land in every tab at once).
		const everywhere = isStatePush(message);
		const toRemove: vscode.Webview[] = [];

		for (const webview of this.webviews) {
			const config = this.webviewConfigs.get(webview);
			if (!config) continue;
			if (!everywhere && (config.host !== 'sidebar' || (config.page && config.page !== 'chat'))) {
				continue;
			}

			try {
				webview.postMessage(payload);
			} catch (error) {
				this.logService.warn('[WebViewService] Could not post to a webview; removing it', error as Error);
				toRemove.push(webview);
			}
		}

		for (const webview of toRemove) {
			this.removeWebview(webview);
		}
	}

	/**
	 * 设置消息接收处理器
	 */
	setMessageHandler(handler: (message: any) => void): void {
		this.messageHandler = handler;
	}

	/**
	 * 打开（或聚焦）主编辑器中的某个页面
	 */
	openEditorPage(page: string, title: string, instanceId?: string, options?: { tab?: string }): void {
		const key = instanceId || page;
		const existing = this.editorPanels.get(key);
		if (existing) {
			try {
				// Reveal where it already is. Passing `Active` *moves* the panel
				// into whatever group the user is editing code in, which undoes
				// the column choice made when it was created.
				existing.reveal(existing.viewColumn);
				// Step 31: a revealed panel keeps whatever tab it was on, so the
				// tab has to be pushed. The bootstrap only runs once, and telling
				// it where to go is the whole point of the second click.
				if (options?.tab !== undefined) {
					// In the envelope every host message travels in. Posted bare,
					// the webview's transport dropped it (it reads only
					// `from-extension`), so a second row opened Settings on
					// whatever tab the first one had chosen.
					void existing.webview.postMessage({
						type: 'from-extension',
						message: {
							type: 'request',
							channelId: '',
							requestId: `select-settings-tab-${Date.now()}`,
							request: { type: 'select_settings_tab', tab: options.tab },
						},
					});
				}
				this.logService.info(`[WebViewService] Reusing the editor panel: page=${page}, id=${key}, tab=${options?.tab ?? '-'}`);
				return;
			} catch (error) {
				// 可能遇到已被释放但还没从映射中移除的面板
				this.logService.warn(
					`[WebViewService] The editor panel is gone; creating it again: page=${page}, id=${key}`,
					error as Error
				);
				this.editorPanels.delete(key);
			}
		}

		this.logService.info(`[WebViewService] Creating an editor panel: page=${page}, id=${key}`);

		// Where the official puts its panel. `Active` -- what this used to pass --
		// drops the page into whatever group the user is editing code in, which
		// is what made Forge open "like a code file".
		const { column, startedInNewColumn } = chooseEditorColumn();

		const panel = vscode.window.createWebviewPanel(
			PAGE_VIEW_TYPE,
			title,
			column,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				// The official passes this too; without it Ctrl+F inside the page
				// falls through to the editor behind it.
				enableFindWidget: true,
				localResourceRoots: [
					vscode.Uri.file(path.join(this.context.extensionPath, 'dist')),
					vscode.Uri.file(path.join(this.context.extensionPath, 'resources'))
				]
			}
		);
		panel.iconPath = this.panelIcon();

		// The official locks the group it just created, so opening a file from the
		// chat does not land on top of the chat itself.
		if (startedInNewColumn) {
			void vscode.commands.executeCommand('workbench.action.lockEditorGroup');
		}

		const panelWebview = panel.webview;

		this.registerWebview(panelWebview, {
			host: 'editor',
			page,
			id: key,
			...(options?.tab !== undefined && { tab: options.tab })
		});

		// Same as the side-bar views: the page hears when its tab is shown or hidden.
		panel.onDidChangeViewState(
			(event) => postVisibility(panelWebview, event.webviewPanel.visible),
			undefined,
			this.context.subscriptions
		);

		panel.onDidDispose(
			() => {
				this.removeWebview(panelWebview);
				this.editorPanels.delete(key);
				this.logService.info(`[WebViewService] Editor panel disposed: page=${page}, id=${key}`);
			},
			undefined,
			this.context.subscriptions
		);

		this.editorPanels.set(key, panel);
	}

	/**
	 * The mark VS Code puts on a Forge editor tab.
	 *
	 * The brand cut, not `forge-cube.svg`: VS Code masks an activity-bar icon to
	 * the theme foreground, but it draws a tab icon as-is, so a `currentColor`
	 * SVG resolves to black and disappears on a dark theme -- which is how the
	 * tab ended up showing nothing. The official ships a literal `#D97757` for
	 * the same reason and passes the one file as both light and dark.
	 */
	/**
	 * The welcome artwork, as URIs the webview may load.
	 *
	 * Two cuts of one drawing, inverses of each other, exactly as the official
	 * ships `welcome-art-dark.svg` and `welcome-art-light.svg`: white ink on a
	 * dark panel, black ink on a light one, with the accent colour the same in
	 * both.
	 */
	private welcomeArtUris(webview: vscode.Webview): { light: string; dark: string } {
		const extensionUri = vscode.Uri.file(this.context.extensionPath);
		const uri = (file: string) =>
			webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', file)).toString();
		return {
			light: uri('forge-welcome-light.png'),
			dark: uri('forge-welcome-dark.png'),
		};
	}

	private panelIcon(): { light: vscode.Uri; dark: vscode.Uri } {
		const uri = vscode.Uri.file(
			path.join(this.context.extensionPath, 'resources', 'forge-cube-brand.svg')
		);
		return { light: uri, dark: uri };
	}

	createPagePanel(viewType: string, title: string, page: string, viewColumn: vscode.ViewColumn): vscode.WebviewPanel {
		const roots = [
			vscode.Uri.file(path.join(this.context.extensionPath, 'dist')),
			vscode.Uri.file(path.join(this.context.extensionPath, 'resources'))
		];
		// The official: `createWebviewPanel("claudePlanPreview", title, {viewColumn, preserveFocus: true}, {enableScripts: true, retainContextWhenHidden: true})`.
		const panel = vscode.window.createWebviewPanel(
			viewType,
			title,
			{ viewColumn, preserveFocus: true },
			{ enableScripts: true, retainContextWhenHidden: true, localResourceRoots: roots }
		);
		panel.iconPath = this.panelIcon();
		panel.webview.html = this.getHtmlForWebview(panel.webview, { host: 'editor', page, id: `${viewType}:${Date.now()}` });
		this.logService.info(`[WebViewService] page panel created: ${viewType} (page=${page})`);
		return panel;
	}

	planPreviewColumn(webviewId?: string): vscode.ViewColumn {
		const webview = webviewId ? this.webviewIdMap.get(webviewId) : undefined;
		if (webview) {
			for (const panel of this.editorPanels.values()) {
				if (panel.webview === webview && typeof panel.viewColumn === 'number') {
					return panel.viewColumn + 1;
				}
			}
		}
		return vscode.ViewColumn.One;
	}

	/**
	 * 为给定 WebView 配置选项、消息通道和 HTML
	 */
	private registerWebview(webview: vscode.Webview, bootstrap: WebviewBootstrapConfig): void {
		// 配置 WebView 选项
		webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.file(path.join(this.context.extensionPath, 'dist')),
				vscode.Uri.file(path.join(this.context.extensionPath, 'resources'))
			]
		};

		// 保存实例及其配置
		this.webviews.add(webview);
		this.webviewConfigs.set(webview, bootstrap);
		const webviewId = this.getWebviewId(bootstrap);
		this.webviewIdMap.set(webviewId, webview);

		// 连接消息处理器
		webview.onDidReceiveMessage(
			message => {
				this.logService.trace(`[WebView → Extension] ${message.type}`);
				if (this.messageHandler) {
					const taggedMessage =
						message && typeof message === 'object' ? { ...message, webviewId } : message;
					this.messageHandler(taggedMessage);
				}
			},
			undefined,
			this.context.subscriptions
		);

		// 设置 WebView HTML（根据开发/生产模式切换）
		webview.html = this.getHtmlForWebview(webview, bootstrap);
	}

	/**
	 * 生成 WebView HTML
	 */
	private getHtmlForWebview(webview: vscode.Webview, bootstrap: WebviewBootstrapConfig): string {
		const isDev = this.context.extensionMode === vscode.ExtensionMode.Development;
		const nonce = this.getNonce();

		// Resolved here because this is the one place that has both the webview
		// and the extension path. `img-src ${webview.cspSource}` below already
		// allows it, and `resources` is in every panel's localResourceRoots.
		bootstrap = { ...bootstrap, welcomeArt: this.welcomeArtUris(webview) };
		if (bootstrap.page === 'sessions') {
			bootstrap.collapsedPanelSections = readCollapsedPanelSections(
				this.context.globalState.get(COLLAPSED_PANEL_SECTIONS_KEY)
			);
		}

		if (isDev) {
			return this.getDevHtml(webview, nonce, bootstrap);
		}

		const extensionUri = vscode.Uri.file(this.context.extensionPath);
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, 'dist', 'media', 'main.js')
		);
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, 'dist', 'media', 'style.css')
		);

		const csp = [
			`default-src 'none';`,
			`img-src ${webview.cspSource} https: data:;`,
			`style-src ${webview.cspSource} 'unsafe-inline' https://*.vscode-cdn.net;`,
			`font-src ${webview.cspSource} data:;`,
			`script-src ${webview.cspSource} 'nonce-${nonce}';`,
			`connect-src ${webview.cspSource} https:;`,
			`worker-src ${webview.cspSource} blob:;`,
		].join(' ');

		const bootstrapScript = `
    <script nonce="${nonce}">
      window.FORGE_BOOTSTRAP = ${JSON.stringify(bootstrap)};
    </script>`;

		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Forge Chat</title>
    <link href="${styleUri}" rel="stylesheet" />
    ${bootstrapScript}
</head>
<body>
    <div id="app"></div>
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}

	private getDevHtml(webview: vscode.Webview, nonce: string, bootstrap: WebviewBootstrapConfig): string {
		// 读取 dev server 地址（可通过环境变量覆盖）
		const devServer = process.env.VITE_DEV_SERVER_URL
			|| process.env.WEBVIEW_DEV_SERVER_URL
			|| `http://localhost:${process.env.VITE_DEV_PORT || 5173}`;

		let origin = '';
		let wsUrl = '';
		try {
			const u = new URL(devServer);
			origin = `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}`;
			const wsProtocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
			wsUrl = `${wsProtocol}//${u.hostname}${u.port ? `:${u.port}` : ''}`;
		} catch {
			origin = devServer; // 回退（尽量允许）
			wsUrl = 'ws://localhost:5173';
		}

		// Vite 开发场景的 CSP：允许连接 devServer 与 HMR 的 ws
		const csp = [
			`default-src 'none';`,
			`img-src ${webview.cspSource} 'self' https: data: blob: http: ${origin};`,
			`style-src ${webview.cspSource} 'unsafe-inline' ${origin} https://*.vscode-cdn.net;`,
			`font-src ${webview.cspSource} data: ${origin};`,
			`script-src ${webview.cspSource} 'nonce-${nonce}' 'unsafe-eval' ${origin};`,
			`connect-src ${webview.cspSource} ${origin} ${wsUrl} https:;`,
			`worker-src ${webview.cspSource} blob:;`,
		].join(' ');

		const client = `${origin}/@vite/client`;
		const entry = `${origin}/src/main.ts`;

		const bootstrapScript = `
    <script nonce="${nonce}">
      window.FORGE_BOOTSTRAP = ${JSON.stringify(bootstrap)};
    </script>`;

		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <base href="${origin}/" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Forge Chat (Dev)</title>
    ${bootstrapScript}
</head>
<body>
    <div id="app"></div>
    <script type="module" nonce="${nonce}" src="${client}"></script>
    <script type="module" nonce="${nonce}" src="${entry}"></script>
</body>
</html>`;
	}

	private getWebviewId(bootstrap: WebviewBootstrapConfig): string {
		return `${bootstrap.host}:${bootstrap.page ?? ''}:${bootstrap.id ?? ''}`;
	}

	private removeWebview(webview: vscode.Webview): void {
		this.webviews.delete(webview);
		const config = this.webviewConfigs.get(webview);
		if (config) {
			const webviewId = this.getWebviewId(config);
			// Only if the id still names *this* webview. A side-bar view that VS
			// Code re-resolves registers its replacement under the same id, and
			// the old one's dispose must not take the new one's replies with it:
			// every answer to the reopened panel would be dropped as "no target",
			// its `init` included.
			if (this.webviewIdMap.get(webviewId) === webview) {
				this.webviewIdMap.delete(webviewId);
				for (const listener of [...this.disposeListeners]) {
					try {
						listener(webviewId);
					} catch (error) {
						this.logService.error(`[WebViewService] dispose listener failed: ${error}`);
					}
				}
			}
		}
		this.webviewConfigs.delete(webview);
	}

	renamePanel(webviewId: string, title: string): boolean {
		for (const panel of this.editorPanels.values()) {
			const config = this.webviewConfigs.get(panel.webview);
			if (config && this.getWebviewId(config) === webviewId) {
				panel.title = title;
				return true;
			}
		}
		return false;
	}

	onDidDisposeWebview(listener: (webviewId: string) => void): vscode.Disposable {
		this.disposeListeners.add(listener);
		return { dispose: () => { this.disposeListeners.delete(listener); } };
	}

	/**
	 * 生成随机 nonce
	 */
	private getNonce(): string {
		let text = '';
		const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		for (let i = 0; i < 32; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	}
}
