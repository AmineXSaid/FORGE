/**
 * VSCode Extension Entry Point
 */

import * as vscode from 'vscode';
import { InstantiationServiceBuilder } from './di/instantiationServiceBuilder';
import { registerServices, ILogService, IClaudeAgentService, IWebViewService, IClaudeSdkService } from './services/serviceRegistry';
import { VSCodeTransport } from './services/claude/transport/VSCodeTransport';
import { registerForgeCommands, FORGE_VIEW_IDS } from './commands/forgeCommands';

/**
 * Extension Activation
 */
export function activate(context: vscode.ExtensionContext) {
	// 1. Create service builder
	const builder = new InstantiationServiceBuilder();

	// 2. Register all services
	registerServices(builder, context);

	// 3. Seal the builder and create DI container
	const instantiationService = builder.seal();

	// 4. Log activation
	instantiationService.invokeFunction(accessor => {
		const logService = accessor.get(ILogService);
		logService.info('');
		logService.info('╔════════════════════════════════════════╗');
		logService.info('║              Forge 已激活               ║');
		logService.info('╚════════════════════════════════════════╝');
		logService.info('');

		// Advisory CLI health check. Forge spawns the real `claude` binary, and its
		// flags drift between versions, so surface the version and any environment
		// problems here rather than as an opaque spawn error mid-conversation.
		if (vscode.workspace.getConfiguration('forge').get<boolean>('runDoctorOnStartup', true)) {
			const sdkService = accessor.get(IClaudeSdkService);
			void sdkService.checkCliHealth().catch((e) => {
				logService.warn(`claude doctor failed: ${e instanceof Error ? e.message : String(e)}`);
			});
		}
	});

	// 5. Connect services
	instantiationService.invokeFunction(accessor => {
		const logService = accessor.get(ILogService);
		const webViewService = accessor.get(IWebViewService);
		const claudeAgentService = accessor.get(IClaudeAgentService);
		const subscriptions = context.subscriptions;

		// Register the provider under every view id Forge contributes. VS Code only
		// instantiates the view whose container is actually visible, so registering
		// all of them is how the primary/secondary side bar fallback works.
		const webviewProviders = FORGE_VIEW_IDS.map((viewId) =>
			vscode.window.registerWebviewViewProvider(
				viewId,
				webViewService,
				{
					webviewOptions: {
						retainContextWhenHidden: true
					}
				}
			)
		);

		// Connect WebView messages to Claude Agent Service
		webViewService.setMessageHandler((message) => {
			claudeAgentService.fromClient(message);
		});

		// Create VSCode Transport
		const transport = instantiationService.createInstance(VSCodeTransport);

		// Set transport on Claude Agent Service
		claudeAgentService.setTransport(transport);

		// Start message loop
		claudeAgentService.start();

		// Register disposables
		context.subscriptions.push(...webviewProviders);

		logService.info('✓ Claude Agent Service 已连接 Transport');
		logService.info('✓ WebView Service 已注册为 View Provider');
	});

	// 6. Register commands. Declared once in commands/forgeCommands.ts; package.json
	//    mirrors that list and scripts/check-commands.mjs fails the build on drift.
	registerForgeCommands(context, instantiationService);

	// 7. Log completion
	instantiationService.invokeFunction(accessor => {
		const logService = accessor.get(ILogService);
		logService.info('✓ Forge 视图已注册');
		logService.info('');
	});

	// Return extension API (if needed to expose to other extensions)
	return {
		getInstantiationService: () => instantiationService
	};
}

/**
 * Extension Deactivation
 */
export function deactivate() {
	// Clean up resources
}
