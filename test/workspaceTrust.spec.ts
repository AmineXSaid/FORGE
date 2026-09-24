/**
 * A repository cannot turn Forge against the person who opens it.
 *
 * Found in the production audit (2026-09-24): a repository's
 * `.vscode/settings.json` could set `forge.cliArgs` (enabling bypass
 * permissions, despite `forge.allowDangerouslySkipPermissions` being
 * machine-only), `forge.endpoints` (an `exec` auth command, a transform module,
 * `${file:…}` reads sent to a URL of its choosing) and
 * `forge.environmentVariables` (e.g. `ANTHROPIC_BASE_URL`). Those settings are
 * now machine-scoped, which VS Code only reads from the user's own settings,
 * and Forge declares that it does not run in Restricted Mode: the CLI loads the
 * folder's `.claude` hooks and MCP servers the moment it starts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
const settings = manifest.contributes.configuration.properties as Record<string, { scope?: string; markdownDescription?: string }>;

describe('settings a repository must not set', () => {
  it.each([
    'forge.allowDangerouslySkipPermissions',
    'forge.cliArgs',
    'forge.endpoints',
    'forge.environmentVariables',
    'forge.endpointProfilesDir',
  ])('%s is machine-scoped', (key) => {
    expect(settings[key]?.scope).toBe('machine');
  });

  it('still lets a workspace pick which of the user\'s endpoints it uses', () => {
    // It only names a profile the user defined; it defines nothing itself.
    expect(settings['forge.endpointProfile']?.scope).toBeUndefined();
  });
});

describe('Restricted Mode', () => {
  it('declares Forge unsupported in an untrusted folder, with the reason', () => {
    expect(manifest.capabilities?.untrustedWorkspaces?.supported).toBe(false);
    expect(manifest.capabilities?.untrustedWorkspaces?.description).toMatch(/hooks and MCP servers/);
  });
});

describe('the transform description', () => {
  it('does not promise a sandbox it is not', () => {
    const text = JSON.stringify(settings['forge.endpoints']);
    expect(text).not.toMatch(/locked-down sandbox/);
    expect(text).toMatch(/not a security sandbox/);
  });
});
