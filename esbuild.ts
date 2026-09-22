import esbuild from "esbuild";
import { createRequire } from "module";
import path from "path";
import fs from "fs/promises";
import { realpathSync } from "fs";
import { isMuslLinux, sdkPlatformBinarySpecifiers } from "./src/services/claude/cliLaunch";

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

    setup(build: { onStart: (arg0: () => void) => void; onEnd: (arg0: (result: esbuild.BuildResult) => void) => void; }) {
        build.onStart(() => {
            console.log('[watch] build started');
        });
        build.onEnd((result) => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`);
                if (location) {
                    console.error(`    ${location.file}:${location.line}:${location.column}:`);
                }
            });
            console.log('[watch] build finished');
        });
	},
};


/**
 * Copy the Agent SDK's native Claude Code binary to resources/native-binary/.
 *
 * Since SDK 0.2.113 the CLI is a per-platform optional dependency of the SDK
 * (there is no cli.js), and the SDK's flags follow that CLI's release. The
 * extension host resolves it the way the official host does (`xh0`), which
 * looks under resources/, and node_modules is not packaged. So the build copies
 * the binary the installed SDK would run, resolved from the SDK's own directory
 * in the SDK's own candidate order. Skipped when an identical-size copy is there.
 * @type {import('esbuild').Plugin}
 */
const copyNativeBinaryPlugin = {
    name: 'copy-native-binary',
    setup(build: { onEnd: (arg0: () => Promise<void>) => void; }) {
        build.onEnd(async () => {
            try {
                const sdkPackageJson = realpathSync(path.resolve('node_modules/@anthropic-ai/claude-agent-sdk/package.json'));
                const sdkRequire = createRequire(sdkPackageJson);
                const candidates = sdkPlatformBinarySpecifiers(process.platform, process.arch, isMuslLinux());
                let source: string | undefined;
                for (const specifier of candidates) {
                    try {
                        source = sdkRequire.resolve(specifier);
                        break;
                    } catch {}
                }
                if (!source) {
                    console.warn(`[build] no Claude Code binary for ${process.platform}-${process.arch} (tried ${candidates.join(', ')})`);
                    return;
                }
                const target = path.resolve('resources', 'native-binary', path.basename(source));
                const [from, to] = await Promise.all([fs.stat(source), fs.stat(target).catch(() => undefined)]);
                if (to && to.size === from.size) return;
                await fs.mkdir(path.dirname(target), { recursive: true });
                await fs.copyFile(source, target);
                await fs.chmod(target, 0o755);
                console.log(`[build] Copied ${path.relative(process.cwd(), source)} -> ${path.relative(process.cwd(), target)}`);
            } catch (err: any) {
                console.warn('[build] copy-native-binary failed:', err?.message || err);
            }
        });
    },
};

async function main() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
    outfile: 'dist/extension.cjs',
		external: ['vscode'],
		// `import.meta.url` has no meaning in CJS, so esbuild substitutes an empty
		// object and `import.meta.url` comes out `undefined`. The Agent SDK is ESM
		// and calls `createRequire(import.meta.url)` at module scope, so bundling it
		// this way silently produced `createRequire(undefined)` -- which throws, and
		// takes the rest of that module's initialisation down with it.
		//
		// What that looked like from the outside: every `query()` died on
		// `Cannot read properties of undefined (reading 'propagation')`, because the
		// OpenTelemetry namespace the SDK vendors is bound in the module whose
		// init never finished. The session list died on `hs is not a function` and
		// on the `createRequire` message itself. Three unrelated-looking failures,
		// one missing define -- and none of them reproduce outside a bundle, which
		// is why the specs never saw it.
		banner: { js: 'const __forgeImportMetaUrl = require("url").pathToFileURL(__filename).href;' },
		define: { 'import.meta.url': '__forgeImportMetaUrl' },
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
			copyNativeBinaryPlugin,
		],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
