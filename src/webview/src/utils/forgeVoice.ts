/**
 * Voice text that arrives from the CLI -- slash command descriptions -- as
 * Forge. "Claude Code", the product Forge stands in for, becomes Forge.
 * Everything that names a real thing elsewhere is left alone, since renaming
 * it would point people at something that does not exist:
 * - a domain such as "Claude.ai", and files the CLI reads (CLAUDE.md, .claude/);
 * - Anthropic's products: the Claude API, the Claude Agent SDK, the Claude
 *   Developer Platform, the Claude Console;
 * - the model family, which is what a description that also names Anthropic is
 *   about ("/claude-api: Reference for the Claude API / Anthropic SDK", seen
 *   as "the Forge API" in the end-to-end run of 2026-09-24).
 */
const PRODUCT_AFTER = /^\s+(?:API|Agent SDK|SDK|Developer Platform|Console)\b/;

export function forgeVoice(text: string): string {
  const voiced = text.replace(/\bClaude Code\b/g, 'Forge');
  if (/\bAnthropic\b/.test(voiced)) return voiced;
  return voiced.replace(/\bClaude\b(?!\.\w)/g, (word, offset: number, whole: string) =>
    PRODUCT_AFTER.test(whole.slice(offset + word.length)) ? word : 'Forge',
  );
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
