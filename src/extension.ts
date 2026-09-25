/**
 * VSCode Extension Entry Point
 */

import * as vscode from 'vscode';
import { InstantiationServiceBuilder } from './di/instantiationServiceBuilder';
import { registerServices, ILogService, IClaudeAgentService, IWebViewService, IClaudeSdkService, IEndpointHealthService } from './services/serviceRegistry';
import { VSCodeTransport } from './services/claude/transport/VSCodeTransport';
import { registerForgeCommands, FORGE_VIEW_IDS, applySidebarContextKeys } from './commands/forgeCommands';
import { watchUnhandledRejections } from './services/unhandledRejections';
import { unsupportedPlatformMessage } from './services/claude/cliLaunch';
import { editFollower } from './services/editor/followEdits';

/**
 * Extension Activation
 */
export function activate(context: vscode.ExtensionContext) {
	// 0. Decide which side bar hosts the chat, and light up the sessions list.
	//    Container `when` clauses are static, so this has to happen before the
	//    workbench resolves them -- ahead of anything else in activation.
	applySidebarContextKeys();

	// 1. Create service builder
	const builder = new InstantiationServiceBuilder();

	// 2. Register all services
	registerServices(builder, context);

	// 3. Seal the builder and create DI container
	const instantiationService = builder.seal();

	// 4. Log activation
	instantiationService.invokeFunction(accessor => {
		const logService = accessor.get(ILogService);

		// A rejection nothing caught, from Forge's own code, lands in Forge's
		// output channel rather than only in the extension host's log.
		context.subscriptions.push(
			watchUnhandledRejections(context.extensionPath, (message) => logService.error(message))
		);

		// Following edits reports what it could not show here, and drops its
		// highlight decoration with the extension.
		editFollower.setLog((line) => logService.warn(line));
		context.subscriptions.push(editFollower);

		// Forge ships for Windows x64 and Linux x64 (one VSIX carries both
		// binaries). Anything else is said once, up front, rather than only as
		// the chat's first failed launch.
		const unsupported = unsupportedPlatformMessage();
		if (unsupported && context.extensionMode !== vscode.ExtensionMode.Test) {
			logService.warn(unsupported);
			void vscode.window.showErrorMessage(unsupported);
		}
		logService.info('');
		logService.info('╔════════════════════════════════════════╗');
		logService.info('║            Forge activated             ║');
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

		logService.info('✓ Claude Agent Service connected to the transport');
		logService.info('✓ WebView Service registered as the view provider');
	});

	// 5b. Endpoint health: the interval timer and the settings watchers.
	//     Nothing here is awaited. A sweep is a real completion per model, so it
	//     runs only when the last one is older than
	//     `forge.endpointHealth.syncIntervalMinutes` -- and activation must not
	//     wait on the network in any case. Every surface that needs a verdict
	//     reads the stored one.
	instantiationService.invokeFunction(accessor => {
		context.subscriptions.push(accessor.get(IEndpointHealthService).activate());
	});

	// 6. Register commands. Declared once in commands/forgeCommands.ts; package.json
	//    mirrors that list and scripts/check-commands.mjs fails the build on drift.
	registerForgeCommands(context, instantiationService);

	// 7. Log completion
	instantiationService.invokeFunction(accessor => {
		const logService = accessor.get(ILogService);
		logService.info('✓ Forge views registered');
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
