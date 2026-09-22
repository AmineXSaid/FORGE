/**
 * `apply_settings`: which settings the webview may write, and where they land.
 *
 * This is the official `tu$` plus the checks `applySettings` runs around it,
 * ported literally. The webview is untrusted, so a write is refused unless the
 * key is on the list *and* the layer the caller is targeting is the one that key
 * belongs to -- `effortLevel` cannot be smuggled into the flag layer by passing
 * `flagsOnly`, and `outputStyle` will not be writable to user settings.
 *
 * Forge carries only the in-scope keys: `effortLevel` (step 11) and `ultracode`
 * (step 13; in scope since 2026-09-18). The official list also has
 * `switchModelsOnFlag` (userSettings) and `remoteControlAtStartup`
 * (userSettings); both are out of scope per `CLAUDE.md`, so they are absent and
 * therefore rejected. `outputStyle` (localSettings) arrives with step 29.
 *
 * Kept free of `vscode` and of `fs` so the specs can import it.
 */

/** The official layer names. */
export type SettingsLayer = 'userSettings' | 'localSettings' | 'flags';

export interface WritableSetting {
  /** The only layer this key may be written to. */
  layer: SettingsLayer;
  /** The official per-key value check. */
  value: (value: unknown) => boolean;
}

/**
 * The official `tu$`, restricted to Forge's scope.
 *
 * `effortLevel`'s check is the official's own: any string. The CLI owns the
 * valid set (it is model-dependent, and it clamps to `maxEffortLevel`), so the
 * host does not second-guess it. It refuses `null`, so effort cannot be
 * cleared from the webview -- as in the official.
 *
 * `ultracode` is session-scoped: it lives on the flag layer only ("interactive
 * toggles never persist it", `Settings.ultracode`, `sdk.d.ts` L8496), so it is written with
 * `applyFlagSettings` and never to a file. `null` switches it off.
 */
export const WEBVIEW_WRITABLE_SETTINGS: Readonly<Record<string, WritableSetting>> = Object.freeze({
  effortLevel: { layer: 'userSettings', value: (value: unknown) => typeof value === 'string' },
  ultracode: { layer: 'flags', value: (value: unknown) => value === null || typeof value === 'boolean' },
  // Step 29. `localSettings` only, as the official has it -- the CLI's own
  // `updateSettings('localSettings', …)` allowlist is itself "currently just
  // outputStyle" (sdk.d.ts:2757), so aiming it anywhere else is refused twice.
  // The value check is the official's: any string. Which strings are real
  // styles is the CLI's business (`available_output_styles`), and the picker
  // only ever offers what the CLI listed.
  outputStyle: { layer: 'localSettings', value: (value: unknown) => typeof value === 'string' },
});

/**
 * Keys `apply_settings` owns, which therefore must never be pinned by the flag
 * settings file Forge launches with (`--settings ~/.claude/forge.json`).
 *
 * Flag settings outrank user settings, so a profile that carried `effortLevel`
 * into forge.json would silently beat the user's own choice on every launch --
 * `CLAUDE.md` B6. The official has no such file: `effortLevel` lives in user
 * settings and reaches a running session only through `applyFlagSettings`, which
 * is session-scoped. Forge matches that by stripping these keys on profile sync,
 * so the flag layer is a live-apply channel and never a store.
 */
export const FLAG_SETTINGS_RESERVED_KEYS: readonly string[] = Object.freeze(
  Object.keys(WEBVIEW_WRITABLE_SETTINGS)
);

/** The official error strings, with Forge's file in place of `hostComms.ts`. */
export const notWritableMessage = (key: string): string =>
  `apply_settings: ${JSON.stringify(key)} cannot be written from the webview; ` +
  'add it to WEBVIEW_WRITABLE_SETTINGS in settingsWhitelist.ts if a webview control needs it';

export const unexpectedValueMessage = (key: string): string =>
  `apply_settings: unexpected value or target for ${JSON.stringify(key)}`;

export const EXCLUSIVE_SCOPE_MESSAGE = 'flagsOnly and localSettings scope are exclusive';

export const MALFORMED_APPLY_SETTINGS = 'apply_settings: malformed request';

/**
 * The official target resolution: `flagsOnly` wins, then an explicit
 * `localSettings` scope, and everything else is user settings.
 */
export function resolveSettingsLayer(flagsOnly?: boolean, scope?: string): SettingsLayer {
  return flagsOnly ? 'flags' : scope === 'localSettings' ? 'localSettings' : 'userSettings';
}

/**
 * The official `applySettings` checks, in the official order:
 *
 * 1. the request shape: `settings` a non-array object, `flagsOnly` a boolean if
 *    present, `scope` `userSettings` or `localSettings` if present;
 * 2. every key must be on the list, aimed at its own layer, and pass its own
 *    value check (`null` passes only where that check allows it -- `ultracode`);
 * 3. `flagsOnly` together with `localSettings` is refused
 *    (`writeUserSettingsAndPush`, after the loop).
 *
 * Throws on the first failure, so a rejected patch writes nothing.
 */
export function validateSettingsWrite(
  settings: unknown,
  flagsOnly?: unknown,
  scope?: unknown
): SettingsLayer {
  if (
    typeof settings !== 'object' ||
    settings === null ||
    Array.isArray(settings) ||
    (flagsOnly !== undefined && typeof flagsOnly !== 'boolean') ||
    (scope !== undefined && scope !== 'userSettings' && scope !== 'localSettings')
  ) {
    throw new Error(MALFORMED_APPLY_SETTINGS);
  }
  const target = resolveSettingsLayer(flagsOnly as boolean | undefined, scope as string | undefined);
  for (const [key, value] of Object.entries(settings)) {
    const entry = Object.hasOwn(WEBVIEW_WRITABLE_SETTINGS, key) ? WEBVIEW_WRITABLE_SETTINGS[key] : undefined;
    if (!entry) throw new Error(notWritableMessage(key));
    if (entry.layer !== target || !entry.value(value)) {
      throw new Error(unexpectedValueMessage(key));
    }
  }
  if (flagsOnly && scope === 'localSettings') throw new Error(EXCLUSIVE_SCOPE_MESSAGE);
  return target;
}

/**
 * The official merge: `null` deletes the key, anything else overwrites it, and
 * every other key in the file is left alone.
 */
export function mergeSettings(
  current: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

/**
 * Drop the keys `apply_settings` owns before a profile is written to forge.json.
 * Everything else a profile carries (env, permissions, mcpServers, model, …)
 * still overlays, because that is what a profile is for.
 */
export function stripFlagReservedKeys(profile: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(profile)) {
    if (!FLAG_SETTINGS_RESERVED_KEYS.includes(key)) out[key] = value;
  }
  return out;
}
