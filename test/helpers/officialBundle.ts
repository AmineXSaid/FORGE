/**
 * The official Claude Code extension, for specs that compare against it.
 *
 * It is not in this repository (it is Anthropic's code). It is looked for in
 * `FORGE_OFFICIAL_DIR`, else next to the checkout
 * (`../Real_Claude_Code_VSCODE_extension_files`, where CLAUDE.md puts it).
 * A spec that needs it uses `it.skipIf(!OFFICIAL_DIR)`, so a checkout without
 * it reports those specs as skipped rather than passing them silently.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function findOfficialDir(): string | undefined {
  const candidates = [
    process.env.FORGE_OFFICIAL_DIR,
    join(__dirname, '..', '..', '..', 'Real_Claude_Code_VSCODE_extension_files'),
  ].filter((dir): dir is string => !!dir);
  return candidates.find((dir) => existsSync(join(dir, 'webview', 'index.js')));
}

export const OFFICIAL_DIR = findOfficialDir();

/** A file of the official extension, e.g. `webview/index.js`; throws when it is not on disk. */
export function readOfficial(relative: string): string {
  if (!OFFICIAL_DIR) throw new Error('The official extension is not on disk (set FORGE_OFFICIAL_DIR).');
  return readFileSync(join(OFFICIAL_DIR, relative), 'utf8');
}
