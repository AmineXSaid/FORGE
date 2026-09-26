import esbuild from "esbuild";
import { createRequire } from "module";
import path from "path";
import fs from "fs/promises";
import { realpathSync } from "fs";
import { isMuslLinux, RELEASE_TARGETS, releaseBinaryName, sdkPlatformBinarySpecifiers } from "./src/services/claude/cliLaunch";

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * `--target <platform>-<arch>` (e.g. `win32-x64`): the platform the VSIX is
 * for, as `vsce package --target` names it. The Claude Code binary copied into
 * resources/native-binary/ is that platform's, and a build that cannot find it
 * fails instead of warning, so a package never ships without a CLI or with
 * the build machine's. Without it, the build machine's binary is copied (dev).
 */
const targetArg = process.argv[process.argv.indexOf('--target') + 1];
const target = process.argv.includes('--target') && targetArg ? parseTarget(targetArg) : undefined;

/**
 * `--universal`: the one VSIX for Windows x64 and Linux x64. Each release
 * target's binary goes to resources/native-binaries/<target>/claude[.exe], the
 * official layout `findClaudeBinary` reads first; a target whose binary cannot
 * be found fails the build. pnpm installs only the build machine's binary, so
 * the others come from the cache `scripts/fetch-native-binaries.mjs` fills
 * (the SDK's own package for that platform, at the SDK's exact version).
 */
const universal = process.argv.includes('--universal');
const NATIVE_CACHE = path.resolve('.forge-cache', 'native-binaries');

function parseTarget(value: string): { platform: string; arch: string } {
	const match = /^(win32|linux|darwin|alpine)-(x64|arm64)$/.exec(value);
	if (!match) {
		console.error(`[build] --target must be <platform>-<arch>, e.g. win32-x64 (got "${value}")`);
		process.exit(1);
	}
	return { platform: match[1] === 'alpine' ? 'linux' : match[1], arch: match[2] };
}

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
                const platform = target?.platform ?? process.platform;
                const arch = target?.arch ?? process.arch;
                const candidates = sdkPlatformBinarySpecifiers(platform, arch, target ? false : isMuslLinux());
                let source: string | undefined;
                for (const specifier of candidates) {
                    try {
                        source = sdkRequire.resolve(specifier);
                        break;
                    } catch {}
                }
                if (!source) {
                    const message = `[build] no Claude Code binary for ${platform}-${arch} (tried ${candidates.join(', ')})`;
                    if (target) {
                        // pnpm installs only the build machine's optional binary: a
                        // Windows VSIX is packaged on Windows.
                        console.error(`${message}. Package on ${platform}-${arch}, where pnpm installs it.`);
                        process.exit(1);
                    }
                    console.warn(message);
                    return;
                }
                const binaryDir = path.resolve('resources', 'native-binary');
                const destination = path.join(binaryDir, path.basename(source));
                if (target) {
                    // Only the target's binary: a leftover `claude` from a dev
                    // build on another OS must not ride along in the VSIX.
                    for (const entry of await fs.readdir(binaryDir).catch(() => [] as string[])) {
                        if (entry !== path.basename(source)) await fs.rm(path.join(binaryDir, entry), { recursive: true, force: true });
                    }
                }
                const [from, to] = await Promise.all([fs.stat(source), fs.stat(destination).catch(() => undefined)]);
                if (to && to.size === from.size) return;
                await fs.mkdir(binaryDir, { recursive: true });
                await fs.copyFile(source, destination);
                await fs.chmod(destination, 0o755);
                console.log(`[build] Copied ${path.relative(process.cwd(), source)} -> ${path.relative(process.cwd(), destination)}`);
            } catch (err: any) {
                if (target) {
                    console.error('[build] copy-native-binary failed:', err?.message || err);
                    process.exit(1);
                }
                console.warn('[build] copy-native-binary failed:', err?.message || err);
            }
        });
    },
};

/** Copy `source` to `destination` unless an identical-size copy is there. */
async function copyBinary(source: string, destination: string): Promise<void> {
    const [from, to] = await Promise.all([fs.stat(source), fs.stat(destination).catch(() => undefined)]);
    if (to && to.size === from.size) return;
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
    await fs.chmod(destination, 0o755);
    console.log(`[build] Copied ${path.relative(process.cwd(), source)} -> ${path.relative(process.cwd(), destination)}`);
}

/**
 * The release build's binaries: every `RELEASE_TARGETS` entry, from the SDK's
 * installed package or the fetch cache, and nothing else in native-binaries/.
 * @type {import('esbuild').Plugin}
 */
const copyUniversalBinariesPlugin = {
    name: 'copy-universal-binaries',
    setup(build: { onEnd: (arg0: () => Promise<void>) => void; }) {
        build.onEnd(async () => {
            const sdkPackageJson = realpathSync(path.resolve('node_modules/@anthropic-ai/claude-agent-sdk/package.json'));
            const sdkRequire = createRequire(sdkPackageJson);
            const root = path.resolve('resources', 'native-binaries');
            const missing: string[] = [];
            for (const releaseTarget of RELEASE_TARGETS) {
                const [platform, arch] = releaseTarget.split('-');
                const name = releaseBinaryName(releaseTarget);
                let source: string | undefined;
                for (const specifier of sdkPlatformBinarySpecifiers(platform, arch, false)) {
                    try {
                        source = sdkRequire.resolve(specifier);
                        break;
                    } catch {}
                }
                if (!source) {
                    const cached = path.join(NATIVE_CACHE, releaseTarget, name);
                    if (await fs.stat(cached).then(() => true, () => false)) source = cached;
                }
                if (!source) {
                    missing.push(releaseTarget);
                    continue;
                }
                await copyBinary(source, path.join(root, releaseTarget, name));
            }
            if (missing.length) {
                console.error(`[build] no Claude Code binary for ${missing.join(', ')}. Run \`node scripts/fetch-native-binaries.mjs\` first.`);
                process.exit(1);
            }
            // Only the release targets: a stray directory would ship as dead weight.
            for (const entry of await fs.readdir(root)) {
                if (!(RELEASE_TARGETS as readonly string[]).includes(entry)) await fs.rm(path.join(root, entry), { recursive: true, force: true });
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
			universal ? copyUniversalBinariesPlugin : copyNativeBinaryPlugin,
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
