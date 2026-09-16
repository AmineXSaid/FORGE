import * as path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	// The DI framework uses TypeScript parameter decorators (@IService dep), which
	// are legacy-decorator syntax. Rolldown parses with modern decorator semantics
	// by default and rejects them, so opt the transform back into legacy mode --
	// the same thing tsconfig.json's experimentalDecorators does for the real build.
	oxc: {
		decorator: { legacy: true },
	},
	test: {
		include: ['**/*.spec.ts', '**/*.spec.tsx'],
		exclude: ['**/node_modules/**', '**/dist/**'],
		globals: true,
		environment: 'node',
	},
	resolve: {
		alias: {
			// Mock vscode module for tests
			vscode: path.resolve(__dirname, 'test/mocks/vscode.ts')
		}
	}
});
