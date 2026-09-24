# Production audit, Phase 5: `pnpm run release:check`

One command runs every gate a release needs, in order, and stops at the first
failure (`scripts/release-check.mjs`, pinned by `test/releaseCheck.spec.ts`):

| # | Step | Command | What it proves |
| --- | --- | --- | --- |
| 1 | lint | `pnpm run lint` | eslint, warnings capped at 390 |
| 2 | typecheck:all | `pnpm run typecheck:all` | extension host and webview |
| 3 | test | `pnpm test` | vitest |
| 4 | lint:forge | `pnpm run lint:forge` | brand, tokens, command registry |
| 5 | build | `pnpm run build` | both bundles |
| 6 | win32 bundle + dist | `build:extension:win32` + `lint:dist:win32` | `claude.exe` alone (MZ, > 10 MB), ripgrep and its licence, the plugin, the manifest fields vsce needs |
| 7 | package | `vsce package --target win32-x64` | the VSIX |
| 8 | smoke install | e2e scenarios 15, 1, 2 on the stub gateway | Restricted Mode, install, first message, in an isolated VS Code |

A step it cannot run is reported **not run**, and the check fails: the smoke
install needs Windows (the VSIX is win32-x64), and `--skip-smoke` is explicit.

## Run here (linux-x64, 2026-09-24)

The SDK's `win32-x64` package (0.3.274, the locked version) was fetched with
`npm pack` and placed where the SDK resolves it, so steps 6 and 7 built the
real Windows package.

| # | Step | Result | Time |
| --- | --- | --- | --- |
| 1 | lint | pass | 6s |
| 2 | typecheck:all | pass | 17s |
| 3 | test | pass (2438 passed, 8 skipped) | 22s |
| 4 | lint:forge | pass | 3s |
| 5 | build | pass | 19s |
| 6 | win32 bundle + dist | pass | 2s |
| 7 | package | pass: `forge-win32-x64.vsix`, 113 MB | 19s |
| 8 | smoke install | **not run**: the win32-x64 VSIX installs only on Windows | — |

**release:check: FAILED here, by design** (step 8 cannot run on Linux).

The VSIX, read back: `extension/resources/native-binary/claude.exe` (233 MB,
the only binary), `extension/resources/ripgrep/x64-win32/rg.exe`,
`extension/resources/forge-plugin/output-styles/expert.md`,
`TargetPlatform="win32-x64"`; no `.claude/`, e2e kit or `test/` file.

The smoke install itself is the kit (Phase 4), which passed scenarios 15, 1
and 2 on the Linux build in code-server. On Windows, with VS Code installed,
`pnpm run release:check` runs all eight steps; that is **unverified** until the
user runs it (expected: eight passes, then `release:check passed`).
