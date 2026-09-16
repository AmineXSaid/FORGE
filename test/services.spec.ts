/**
 * 服务测试 / Services Tests
 *
 * Exercises the real registration path: registerServices() takes a builder and an
 * ExtensionContext, and the container is produced by sealing the builder. An
 * earlier version of this test called it with a ServiceCollection and a boolean,
 * a signature that no longer exists.
 */

import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import { InstantiationServiceBuilder } from '../src/di/instantiationServiceBuilder';
import { registerServices } from '../src/services/serviceRegistry';
import { ILogService } from '../src/services/logService';

/** Minimal ExtensionContext: only what registerServices actually reads. */
function fakeContext(): vscode.ExtensionContext {
	return {
		extensionMode: vscode.ExtensionMode.Test,
		subscriptions: [],
		extensionPath: process.cwd(),
		asAbsolutePath: (p: string) => p,
		globalState: { get: () => undefined, update: () => Promise.resolve() },
		workspaceState: { get: () => undefined, update: () => Promise.resolve() }
	} as unknown as vscode.ExtensionContext;
}

describe('Services', () => {
	it('should register and retrieve log service', () => {
		const builder = new InstantiationServiceBuilder();
		registerServices(builder, fakeContext());

		const instantiationService = builder.seal();

		instantiationService.invokeFunction(accessor => {
			const logService = accessor.get(ILogService);
			expect(logService).toBeDefined();

			// 测试日志方法不抛出异常
			expect(() => {
				logService.info('Test message');
				logService.warn('Warning');
				logService.error('Error');
			}).not.toThrow();
		});
	});

	it('should expose show() so the forge.showLogs command has something to call', () => {
		const builder = new InstantiationServiceBuilder();
		registerServices(builder, fakeContext());

		builder.seal().invokeFunction(accessor => {
			const logService = accessor.get(ILogService);
			expect(typeof logService.show).toBe('function');
			expect(() => logService.show()).not.toThrow();
		});
	});
});
