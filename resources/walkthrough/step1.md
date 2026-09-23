## Forge

**Forge, in VS Code, wearing the Pajamas design system.**

Forge drives the real `claude` CLI as its backend, so everything the CLI can do,
Forge can do: read your files, make edits, run commands, and work through a task
alongside you.

What Forge adds on top:

- **Pajamas brand system**: one set of semantic tokens, enforced at build time,
  so nothing drifts off-brand.
- **Full CLI reach**: any `claude` flag can be passed through from settings via
  `forge.cliArgs`.
- **Hermes agents**: scoped personas with their own tools, MCP servers and
  endpoints.

Run **Forge: Run CLI Doctor** from the Command Palette at any time to check which
CLI version Forge is talking to.
