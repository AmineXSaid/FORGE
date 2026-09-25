# Forge

Forge in VS Code: an agentic coding assistant wearing the [Pajamas design system](https://design.gitlab.com/),
backed by the `claude` CLI, and extended with Hermes agents and custom endpoints.

Personal build. Not published to the Marketplace.

**Platforms: Windows x64 and Linux x64** (glibc). One VSIX, `forge.vsix`,
carries the Claude Code binary and ripgrep for both, and uses the one for the
platform it runs on; on any other platform (macOS, ARM, a musl Linux) Forge
says so at activation and cannot start a session. **Restricted Mode:** Forge does not run in
an untrusted folder, because the CLI loads the folder's `.claude` hooks and MCP
servers as soon as it starts.

## What it is

Forge runs the **real `claude` binary** as its backend, through
`@anthropic-ai/claude-agent-sdk` (`pathToClaudeCodeExecutable`). The CLI *is* the
engine — Forge is the surface around it. Anything the CLI can do, Forge can reach.

Three things it adds:

**A brand that cannot drift.** Every colour resolves through a semantic token.
Components may not name a hex, an `rgb()`, a named colour, or a raw palette
primitive — two build gates enforce it, and both are proven to fail on an
injected violation.

**Full CLI reach.** `forge.cliArgs` passes any `claude` flag through to the
spawned process, gated so that flags the SDK's stream protocol depends on can
never be injected. It is a machine setting: a repository's
`.vscode/settings.json` cannot set it, and bypass permissions is
`forge.allowDangerouslySkipPermissions` alone.

**Hermes agents.** Scoped personas with their own tools, MCP servers and
endpoint profiles.

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

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `forge.cliArgs` | `{}` | Extra flags for the `claude` CLI. `"add-dir": "../shared"`, `"debug": false` to switch off a default. |
| `forge.runDoctorOnStartup` | `true` | Run `claude doctor` on activation and report version/health. |
| `forge.selectedModel` | `default` | Model for the session. |
| `forge.environmentVariables` | `[]` | Environment for the spawned CLI. |
| `forge.autoApproveSafeCommands` | `false` | In Edit automatically, run shell commands Forge's risk check finds harmless (reads, searches, `git log`/`diff`/`show`, alone or chained) without asking. Deleting, overwriting, `sudo`, rewriting or pushing git history, publishing and piping a download into a shell still ask. Machine setting. |
| `forge.enableNewConversationShortcut` | `false` | `Ctrl/Cmd+N` for a new conversation. Off by default — it shadows New File. |

`forge.cliArgs` is gated. `--print`, `--output-format`, `--input-format` and
`--include-partial-messages` are refused outright, because the SDK's stream
transport depends on them. Flags the SDK already sets from its own options
(`--model`, `--permission-mode`, `--resume`, `--settings`) are applied but
logged as duplicates. The Forge output channel shows exactly what was passed.

## Development

```bash
pnpm install
pnpm run build       # gates, then webview, then extension
pnpm run watch       # both in watch mode
pnpm run test
pnpm run typecheck:all
```

Press `F5` to launch an Extension Development Host.

## Credits and licence

Forge is a fork of [Claudix](https://github.com/Haleclipse/Claudix) by Haleclipse,
which supplies the Vue webview scaffold, the DI architecture, and the SDK backend
that spawns the real CLI. Licensed **AGPL-3.0**, same as upstream; see `LICENSE`.

The Pajamas design tokens come from [`@gitlab/ui`](https://gitlab.com/gitlab-org/gitlab-ui)
(MIT). UI structure and the settings schema follow Anthropic's official Claude
Code VS Code extension.
