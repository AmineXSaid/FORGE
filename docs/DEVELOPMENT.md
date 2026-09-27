# Developing Forge

Build, brand-system and release notes for contributors. The user-facing
overview is the [README](../README.md).

## The brand system

Three layers, top is the source of truth:

| Layer | File | Rule |
| --- | --- | --- |
| 1. Primitives | `src/webview/src/styles/forge-pajamas.css` | Generated from `@gitlab/ui`. The only file where raw colour may appear. |
| 2. Semantics | `src/webview/src/styles/forge-tokens.css` | `--forge-brand`, `--forge-accent`, `--forge-danger`… **Change the brand here and it changes everywhere.** |
| 3. Compatibility | same file | `--app-*` (official Claude Code names) and `--cursor-*`, re-pointed onto layer 2. |

Theming is **hybrid**: structural colour (surfaces, lists, inputs, menus) stays
on `--vscode-*` so Forge inherits the user's theme, while brand, accent and
status colour come from Pajamas so Forge reads as Forge everywhere.

- Brand — Pajamas brand purple `#7759c2`. Logo, wordmark, agent, unread.
- Accent — Pajamas blue `#1f75cb`. Interactive and active states.

```bash
pnpm run tokens:pajamas   # regenerate primitives from upstream @gitlab/ui
pnpm run marks            # regenerate the logo SVG + PNG from the icon geometry
```

## Build gates

`pnpm run build` refuses to produce output if either gate fails.

```bash
pnpm run lint:brand      # no raw colour anywhere outside the token layer
pnpm run lint:commands   # package.json matches the command registry exactly
pnpm run lint:forge      # both
```

`lint:brand` is two tools: `scripts/check-brand.mjs` (scans templates, TypeScript
and CSS — stylelint cannot see `fill="…"` in a Vue template, which is exactly
where two brand leaks were hiding) plus stylelint for CSS-grammar depth. Prove it
bites with `pnpm run lint:brand:selftest`.

`lint:commands` compares `src/commands/forgeCommands.ts` against the manifest. A
command declared but not registered appears in the palette and then errors when
invoked; this makes that a build failure.

## Releasing

```bash
pnpm run release:check
```

Runs, in order and stopping at the first failure: lint, `typecheck:all`, the
tests, `lint:forge`, `build`, the universal bundle (`fetch:native` downloads
the other platform's Claude Code binary from npm at the SDK's exact version,
then `check-dist --universal` checks both binaries, both ripgreps, the plugin
and the manifest), `vsce package` into `forge.vsix`, and a smoke install of
that VSIX into an isolated VS Code (end-to-end scenarios 15, 1 and 2 against
the stub gateway; desktop VS Code on Windows, code-server on Linux). It prints
a table; a step it could not run is reported as not run, and the check fails.
The end-to-end kit is `.claude/skills/ui-parity/e2e/` (see its README).

```bash
pnpm run package        # forge.vsix, the same file for Windows and Linux
```

A plain `vsce package` builds the same complete VSIX (about 1300 files and
208 MB), because the build is `vscode:prepublish`, which vsce runs first. A
VSIX of a few dozen files and a few MB is missing the webview and the Claude
Code binaries.

## Development

```bash
pnpm install
pnpm run build       # gates, then webview, then extension
pnpm run watch       # both in watch mode
pnpm run test
pnpm run typecheck:all
```

Press `F5` to launch an Extension Development Host.
