/**
 * `apply_settings`: which settings the webview may write, and where they land.
 *
 * This is the official `tu$` plus the checks `applySettings` runs around it,
 * ported literally. The webview is untrusted, so a write is refused unless the
 * key is on the list *and* the layer the caller is targeting is the one that key
 * belongs to -- `effortLevel` cannot be smuggled into the flag layer by passing
 * `flagsOnly`, and `outputStyle` will not be writable to user settings.
 *
 * Forge carries only the in-scope keys. The official list also has `ultracode`
 * (flags), `switchModelsOnFlag` (userSettings) and `remoteControlAtStartup`
 * (userSettings); all three are out of scope per `CLAUDE.md`, so they are absent
 * and therefore rejected. `outputStyle` (localSettings) arrives with step 29.
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
 * host does not second-guess it.
 */
export const WEBVIEW_WRITABLE_SETTINGS: Readonly<Record<string, WritableSetting>> = Object.freeze({
  effortLevel: { layer: 'userSettings', value: (value: unknown) => typeof value === 'string' },
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

/**
 * The official target resolution: `flagsOnly` wins, then an explicit
 * `localSettings` scope, and everything else is user settings.
 */
export function resolveSettingsLayer(flagsOnly?: boolean, scope?: string): SettingsLayer {
  return flagsOnly ? 'flags' : scope === 'localSettings' ? 'localSettings' : 'userSettings';
}

/**
 * The official validation loop. Throws on the first key that is not writable, or
 * whose value or target layer is wrong.
 */
export function validateSettingsWrite(
  settings: Record<string, unknown>,
  flagsOnly?: boolean,
  scope?: string
): SettingsLayer {
  if (flagsOnly && scope === 'localSettings') throw new Error(EXCLUSIVE_SCOPE_MESSAGE);
  const target = resolveSettingsLayer(flagsOnly, scope);
  for (const [key, value] of Object.entries(settings)) {
    const entry = Object.hasOwn(WEBVIEW_WRITABLE_SETTINGS, key) ? WEBVIEW_WRITABLE_SETTINGS[key] : undefined;
    if (!entry) throw new Error(notWritableMessage(key));
    // A null clears the key, and the official's own value checks reject it, so
    // it is allowed here explicitly -- that is how a setting is unset.
    if (entry.layer !== target || !(value === null || entry.value(value))) {
      throw new Error(unexpectedValueMessage(key));
    }
  }
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
