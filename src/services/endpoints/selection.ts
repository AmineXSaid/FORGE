/**
 * Choosing the endpoint and model pair a conversation runs on.
 *
 * One place, because three callers write the same setting -- the chat's model
 * picker (`set_model`), "Forge: Select Endpoint Profile" and the setup flow --
 * and they used to disagree about where: two wrote Workspace settings
 * unconditionally, which throws with no folder open and hides a user-wide
 * choice behind a workspace one when there is.
 */
import * as vscode from 'vscode';

/**
 * Where `forge.endpointProfile` is written.
 *
 * Workspace only when a folder is open *and* the workspace already sets it:
 * writing the user value there would change nothing, because the workspace one
 * wins. Otherwise the user's own settings, which exist with or without a folder.
 */
export function selectionTarget(
  workspaceValue: string | undefined,
  hasFolder: boolean,
): vscode.ConfigurationTarget {
  return hasFolder && workspaceValue !== undefined
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

/** Make `name` the pair new conversations and the next message run on. */
export async function selectEndpointProfile(name: string): Promise<void> {
  const config = vscode.workspace.getConfiguration('forge');
  const inspected = config.inspect<string>('endpointProfile');
  const target = selectionTarget(inspected?.workspaceValue, !!vscode.workspace.workspaceFolders?.length);
  await config.update('endpointProfile', name, target);
}
