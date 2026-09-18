/**
 * `set_model`: the official request check and the settings patch it writes.
 *
 * The official host (`extension.js`, `setModel`) does exactly this:
 *
 *   if (typeof Q !== "object" || Q === null || typeof Q.value !== "string")
 *     throw Error("set_model: malformed request");
 *   let X = await this.writeUserSettingsAndPush($, {model: Q.value === "default" ? null : Q.value});
 *   return {type: "set_model_response", ...X !== void 0 && {applied: X}};
 *
 * So the model is a *user setting*: it is merged into `~/.claude/settings.json`
 * (Default clears the key rather than writing "default"), and the running CLI is
 * switched through `applyFlagSettings`, whose `model` key performs a real
 * session model switch in CLI 2.1.274 (it sets `mainLoopModelForSession`, and
 * `null` / "default" go back to the default model).
 *
 * The official does not check the value against the model list -- the CLI
 * accepts aliases, full ids, `[1m]` variants and custom model ids, and Forge's
 * custom models (`~/.forge.json`) are exactly such ids. Neither does Forge.
 *
 * Kept free of `vscode` and `fs` so the specs can import it.
 */

export const MALFORMED_SET_MODEL = 'set_model: malformed request';

/** The official check. Returns the model value, or throws the official error. */
export function parseSetModelRequest(model: unknown): string {
  if (typeof model !== 'object' || model === null || typeof (model as { value?: unknown }).value !== 'string') {
    throw new Error(MALFORMED_SET_MODEL);
  }
  return (model as { value: string }).value;
}

/** The user-settings patch `set_model` writes: Default clears the key. */
export function modelSettingsPatch(value: string): { model: string | null } {
  return { model: value === 'default' ? null : value };
}
