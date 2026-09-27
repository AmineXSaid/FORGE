# Packaging Forge — build a hardened `.vsix`

This is a personal-use build guide: how to produce a `.vsix` that ships only the
built, minified bundle — no TypeScript sources, no source maps, no comments — and
how to verify that before you hand the file to anyone.

> **Reality check.** A `.vsix` is a zip, and VS Code has to run plain JavaScript
> from it. You cannot *encrypt* an extension — the runtime would need the key,
> and the key would ship in the same file. What follows *minifies, strips and
> excludes*, which raises the effort to read your code. It does not make it
> secret. Keep the GitHub repo **private**; that is the real protection.

## What hardening is already wired in

| Where | Setting | Effect |
| --- | --- | --- |
| `esbuild.ts` | `minify: production` | Extension host bundle is minified (renamed locals, no whitespace). |
| `esbuild.ts` | `sourcemap: !production` | No `.map` files in a production build. |
| `esbuild.ts` | `sourcesContent: false` | Even a dev map carries no original source text. |
| `esbuild.ts` | `legalComments: 'none'` (production) | All comments / license banners stripped from the bundle. |
| `esbuild.ts` | `drop: ['debugger']` (production) | `debugger` statements removed. |
| `src/webview/vite.config.ts` | `minify: 'esbuild'`, `sourcemap: false` | Webview bundle minified, no maps. |
| `.vscodeignore` | `src/**`, `**/*.ts`, `**/*.map`, `test/**`, `docs/**`, `scripts/**`, `CLAUDE.md`, `TODO.md`, `.claude/**` | Sources, tests, docs and dev files never enter the `.vsix`. |

**Not enabled on purpose:** property-name mangling and third-party obfuscators.
Forge's webview↔host message protocol and VS Code contribution points depend on
exact key names; renaming object keys would break the extension. See the note at
the bottom if you want to push further.

## Build steps

Run these from the repo root.

```bash
# 1. Install dependencies (first time, or after a pull)
pnpm install --frozen-lockfile

# 2. Build the production bundle (webview + minified extension host)
pnpm run build:webview
npx tsx esbuild.ts --production

# 3. Package into forge.vsix (runs verify, excludes dev deps)
pnpm run package
```

`pnpm run package` writes **`forge.vsix`** to the repo root.

> If `pnpm run package` runs a heavier `verify`/`vscode:prepublish` chain
> (universal native binaries), that is expected for a release build. For a quick
> personal build you can skip straight to `vsce`:
>
> ```bash
> npx vsce package --no-dependencies -o forge.vsix
> ```

## Verify before sharing

Confirm no source, maps or comments leaked into the package.

```bash
# List every file that will ship — there should be NO src/, *.ts, *.map, docs/
npx vsce ls --no-dependencies

# Or inspect the finished archive directly
unzip -l forge.vsix | grep -iE '\.ts$|\.map$|/src/|/docs/|/test/' || echo "clean: no sources/maps in vsix"

# Spot-check the shipped bundle is minified and comment-free
head -c 300 dist/extension.cjs
grep -c '/\*' dist/extension.cjs   # only sourceURL string literals from deps, not your comments
ls dist/*.map dist/media/*.map 2>/dev/null || echo "no source maps (good)"
```

Expected: `dist/extension.cjs` is one long minified line, no `.map` files
anywhere, and `vsce ls` shows only `dist/`, `resources/`, `package.json`,
`README`, `CHANGELOG` and `LICENSE`.

## Install locally (no Marketplace)

```bash
code --install-extension forge.vsix
```

Distribute the `.vsix` file directly (never publish to the public Marketplace if
you want it private).

## If you want to go further (optional, and with caveats)

- **`javascript-obfuscator`** — string-array encoding + control-flow flattening.
  Strongest "hide" step, but adds a build dependency, slows startup, complicates
  debugging, and can break subtly. Test the packaged extension thoroughly after.
- **Property mangling** (`mangleProps` in esbuild) — do **not** enable globally;
  it renames the message-protocol keys and breaks the webview↔host bridge. Only
  safe if the whole codebase adopts a mangle-only naming convention.

None of these are encryption, and none make already-shipped code unreadable to a
determined reader.

## Licensing note

Per `CLAUDE.md`, much of this UI/CSS/behaviour is copied from Anthropic's official
Claude Code VS Code extension. That is fine for private, personal use, but those
parts are not yours to relicense or lock down — check Anthropic's terms before
distributing the `.vsix` to anyone else.
