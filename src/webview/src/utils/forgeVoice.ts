/**
 * Voice text that arrives from the CLI -- slash command descriptions -- as
 * Forge. Product names become Forge; a domain such as "Claude.ai" and file names
 * the CLI actually reads (CLAUDE.md, .claude/) are left alone, since renaming
 * those would point people at things that do not exist.
 */
export function forgeVoice(text: string): string {
  return text.replace(/\bClaude Code\b/g, 'Forge').replace(/\bClaude\b(?!\.\w)/g, 'Forge');
}

/**
 * The CLI's own environment variable families, as [what the CLI reads, what Forge
 * shows]. Only these exact prefixes are translated, so a variable of the user's
 * that merely contains either word is never rewritten.
 */
const ENV_FAMILIES: ReadonlyArray<readonly [string, string]> = [
  ['CLAUDE_CODE_', 'FORGE_CODE_'],
  ['CLAUDE_CONFIG_DIR', 'FORGE_CONFIG_DIR'],
  ['CLAUDE_BASH_', 'FORGE_BASH_'],
  ['VERTEX_REGION_CLAUDE_', 'VERTEX_REGION_FORGE_'],
];

/** An environment variable name as Forge shows it. */
export function displayEnvKey(key: string): string {
  for (const [cli, forge] of ENV_FAMILIES) if (key.startsWith(cli)) return forge + key.slice(cli.length);
  return key;
}

/** The name the CLI actually reads, from a name as shown or typed in Forge. */
export function storageEnvKey(key: string): string {
  for (const [cli, forge] of ENV_FAMILIES) if (key.startsWith(forge)) return cli + key.slice(forge.length);
  return key;
}
